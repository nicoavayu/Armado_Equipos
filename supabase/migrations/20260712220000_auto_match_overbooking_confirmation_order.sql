begin;

-- ============================================================================
-- Gestación automática: sala cerrada con SOBRECONVOCATORIA + orden de
-- confirmación + vencimiento individual + varias gestaciones simultáneas.
--
-- Migración incremental sobre 20260711210000_auto_match_organizer_flow.sql y
-- 20260712120000_auto_match_proposal_chat.sql (ambas ya aplicadas a prod). No
-- edita ninguna migración previa: solo agrega columnas y redefine funciones.
--
-- Qué cambia, y por qué:
--
--  1) SOBRECONVOCATORIA. Los titulares necesarios siguen siendo formato*2
--     (F5=10, F7=14, F11=22). La sala ahora convoca hasta un 50 % extra:
--     invitation_capacity = ceil(required * 1.5) (F5=15). El factor 1.5 vive en
--     UN solo lugar (auto_match_invitation_capacity) para poder ajustarlo sin
--     tocar componentes ni RPCs sueltos.
--
--  2) VARIAS GESTACIONES SIMULTÁNEAS. Antes sync_my_auto_match_gestations
--     colapsaba cada formato a UNA sola ocurrencia (el primer día elegible), así
--     que un jugador disponible sáb+dom para F5 solo llegaba a gestar el sábado:
--     el domingo nunca se generaba porque el guard de superposición ya lo daba
--     por ocupado en el sábado. Ahora sync recorre CADA día elegible de la
--     disponibilidad y arma/join-ea una gestación por ocurrencia. Una gestación
--     activa deja de bloquear búsquedas compatibles de otro día/horario/formato.
--
--  3) ORDEN DE CONFIRMACIÓN. Se guarda confirmed_at (hora del servidor) al
--     aceptar. Los lugares titulares se asignan por ese orden: los primeros
--     `required` confirmados son titulares, el resto suplentes. La asignación es
--     derivada (row_number sobre confirmed_at) => nunca hay 11 titulares aunque
--     dos confirmen a la vez; el 11.º simplemente queda suplente. Ya no se
--     rechaza aceptar por "cupo lleno": aceptar de más entra como suplente.
--
--  4) VENCIMIENTO INDIVIDUAL. Cada convocado tiene invite_expires_at =
--     least(invited_at + 10 h, kickoff - 2 h). Al vencer, su invitación pasa a
--     'expired' (estado nuevo, distinto de 'declined'): pierde la gestación y el
--     chat, libera capacidad y se busca reemplazo. No cuenta como rechazo
--     voluntario y no puede confirmar después. El barrido corre en backend
--     (lazy en cada RPC + un job pg_cron), sin depender de que la app esté
--     abierta.
--
--  5) SUPERPOSICIÓN AL CONFIRMAR. El guard de superposición ahora solo mira
--     confirmaciones ('accepted'), no pendientes: un jugador puede estar
--     pendiente en varias gestaciones que se pisan. Al CONFIRMAR una, se lo
--     retira automáticamente (atómico) de las otras propuestas activas cuyo
--     horario realmente se superpone, y esas liberan capacidad.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Constantes centralizadas
-- ---------------------------------------------------------------------------

create or replace function public.auto_match_required_players(p_format text)
returns integer
language sql
immutable
as $$
  select substring(p_format from 2)::integer * 2;
$$;

-- Único lugar donde vive el factor de sobreconvocatoria (1.5 = +50 %).
create or replace function public.auto_match_invitation_capacity(p_format text)
returns integer
language sql
immutable
as $$
  select ceil(public.auto_match_required_players(p_format) * 1.5)::integer;
$$;

-- Mínimo de compatibles para arrancar una gestación (regla: "al menos cuatro").
create or replace function public.auto_match_min_candidates()
returns integer
language sql
immutable
as $$
  select 4;
$$;

-- Umbral de gestación centralizado: se mantiene la firma previa, ahora delega
-- en el mínimo de candidatos (4 para todos los formatos, por objetivo).
create or replace function public.auto_match_threshold(p_format text)
returns integer
language sql
immutable
as $$
  select public.auto_match_min_candidates();
$$;

-- Fecha límite de una invitación individual: 10 h desde la convocatoria o el
-- límite operativo (2 h antes del comienzo), lo que ocurra primero.
create or replace function public.auto_match_invite_deadline(
  p_invited_at timestamptz,
  p_starts_at timestamptz
)
returns timestamptz
language sql
immutable
as $$
  select least(p_invited_at + interval '10 hours', p_starts_at - interval '2 hours');
$$;

revoke all on function public.auto_match_required_players(text) from public, anon;
revoke all on function public.auto_match_invitation_capacity(text) from public, anon;
revoke all on function public.auto_match_min_candidates() from public, anon;
revoke all on function public.auto_match_invite_deadline(timestamptz, timestamptz) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Columnas nuevas + estado 'expired' de la invitación
-- ---------------------------------------------------------------------------

alter table public.auto_match_proposal_members
  add column if not exists confirmed_at timestamptz,
  add column if not exists invite_expires_at timestamptz;

-- Backfill: quienes ya estaban confirmados heredan su responded_at como orden.
update public.auto_match_proposal_members
set confirmed_at = responded_at
where response = 'accepted' and confirmed_at is null;

-- Backfill de la fecha límite para pendientes vivos ya convocados.
update public.auto_match_proposal_members m
set invite_expires_at = public.auto_match_invite_deadline(m.created_at, p.proposed_starts_at)
from public.auto_match_proposals p
where p.id = m.proposal_id
  and m.response = 'pending'
  and m.invite_expires_at is null;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'auto_match_member_response_check'
  ) then
    alter table public.auto_match_proposal_members
      drop constraint auto_match_member_response_check;
  end if;
  alter table public.auto_match_proposal_members
    add constraint auto_match_member_response_check
    check (response in ('pending', 'accepted', 'declined', 'expired'));
end;
$$;

create index if not exists auto_match_members_invite_expiry_idx
  on public.auto_match_proposal_members(invite_expires_at)
  where response = 'pending';

-- ---------------------------------------------------------------------------
-- 3. Membresía viva para el chat: 'expired' pierde acceso igual que 'declined'
--    (redefine el helper que usan la policy SELECT y el RPC de envío de chat).
-- ---------------------------------------------------------------------------

create or replace function public.auto_match_user_in_proposal(
  p_proposal_id bigint,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.auto_match_proposal_members m
    where m.proposal_id = p_proposal_id
      and m.user_id = p_user_id
      and m.response not in ('declined', 'expired')
  );
$$;

revoke all on function public.auto_match_user_in_proposal(bigint, uuid) from public, anon;
grant execute on function public.auto_match_user_in_proposal(bigint, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Superposición: solo bloquea por CONFIRMACIONES (no pendientes) y por
--    partidos reales. Permite estar pendiente en varias gestaciones que se
--    pisan; la doble reserva se resuelve al confirmar (ver respond).
-- ---------------------------------------------------------------------------

create or replace function public.user_has_overlapping_auto_match(
  p_user_id uuid,
  p_starts_at timestamptz,
  p_exclude_proposal_id bigint default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.user_id = p_user_id
      and m.response = 'accepted'
      and p.status in ('collecting', 'ready')
      and p.expires_at > now()
      and (p_exclude_proposal_id is null or p.id <> p_exclude_proposal_id)
      and tstzrange(
        p.proposed_starts_at - interval '30 minutes',
        p.proposed_starts_at + interval '150 minutes',
        '[)'
      ) && tstzrange(
        p_starts_at - interval '30 minutes',
        p_starts_at + interval '150 minutes',
        '[)'
      )
  )
  or exists (
    select 1
    from public.jugadores j
    join public.partidos pa on pa.id = j.partido_id
    where j.usuario_id = p_user_id
      and coalesce(pa.estado, '') not in ('deleted', 'cancelado', 'cancelled')
      and public.partido_kickoff_at(pa.fecha, pa.hora) is not null
      and abs(extract(epoch from (public.partido_kickoff_at(pa.fecha, pa.hora) - p_starts_at))) < 7200
  );
$$;

revoke all on function public.user_has_overlapping_auto_match(uuid, timestamptz, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Notificaciones: se amplía el whitelist con los avisos nuevos.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_auto_match_notification(
  p_proposal_id bigint,
  p_type text,
  p_title text,
  p_message text,
  p_recipient_ids uuid[] default null,
  p_event_key text default null,
  p_data jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_count integer := 0;
  v_payload jsonb;
  v_route text;
  v_partido_id bigint;
  v_rows integer;
begin
  if p_type not in (
    'auto_match_gestating',
    'auto_match_almost_full',
    'auto_match_ready',
    'auto_match_organizing',
    'auto_match_created',
    'auto_match_cancelled',
    'auto_match_invite_expired'
  ) then
    raise exception 'invalid_auto_match_notification_type';
  end if;

  if p_event_key is not null then
    insert into public.auto_match_proposal_events (proposal_id, event_key)
    values (p_proposal_id, p_event_key)
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return 0;
    end if;
  end if;

  v_partido_id := nullif(p_data ->> 'partido_id', '')::bigint;
  v_route := coalesce(p_data ->> 'route', '/quiero-jugar?auto=1');
  v_payload := jsonb_build_object(
    'proposal_id', p_proposal_id,
    'route', v_route,
    'link', v_route,
    'source', 'auto_match_gestation',
    'title', p_title,
    'message', p_message
  ) || coalesce(p_data, '{}'::jsonb);

  for v_recipient in
    select distinct x.user_id
    from (
      select unnest(p_recipient_ids) as user_id
      where p_recipient_ids is not null
      union all
      select m.user_id
      from public.auto_match_proposal_members m
      where p_recipient_ids is null
        and m.proposal_id = p_proposal_id
        and m.response not in ('declined', 'expired')
    ) x
    where x.user_id is not null
  loop
    insert into public.notifications (
      user_id, type, title, message, data, read, partido_id, created_at
    ) values (
      v_recipient, p_type, p_title, p_message, v_payload, false, v_partido_id, now()
    );

    insert into public.notification_delivery_log (
      user_id, partido_id, notification_type, payload_json, channel, status, correlation_id, created_at
    ) values (
      v_recipient, v_partido_id, p_type, v_payload, 'push', 'queued', gen_random_uuid(), now()
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.enqueue_auto_match_notification(bigint,text,text,text,uuid[],text,jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backfill de reemplazos: ahora completa hasta la CAPACIDAD de convocatoria
--    (sobreconvocatoria), no hasta el cupo de titulares.
-- ---------------------------------------------------------------------------

create or replace function public.backfill_auto_match_proposal_members(p_proposal_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_active integer;
  v_capacity integer;
  v_added integer := 0;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id;

  if v_proposal.id is null or v_proposal.status not in ('collecting', 'ready') then
    return 0;
  end if;

  v_capacity := public.auto_match_invitation_capacity(v_proposal.format);

  select count(*) into v_active
  from public.auto_match_proposal_members m
  where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired');

  for v_candidate in
    select a.id as availability_id, a.user_id, a.can_organize
    from public.player_availability a
    where a.status = 'active'
      and v_proposal.format = any(a.formats)
      and extract(isodow from (v_proposal.proposed_starts_at at time zone a.timezone))::smallint = any(a.days_of_week)
      and (v_proposal.proposed_starts_at at time zone a.timezone)::time >= a.time_start
      and a.time_end - (v_proposal.proposed_starts_at at time zone a.timezone)::time >= interval '60 minutes'
      and not exists (
        select 1 from public.auto_match_proposal_members m
        where m.proposal_id = v_proposal.id and m.user_id = a.user_id
      )
    order by a.created_at asc
  loop
    exit when v_active >= v_capacity;

    if public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposal.proposed_starts_at, v_proposal.id) then
      continue;
    end if;
    if public.user_declined_auto_match_slot(v_candidate.user_id, v_proposal.format, v_proposal.proposed_starts_at) then
      continue;
    end if;

    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
    ) values (
      v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending', v_candidate.can_organize,
      public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
    ) on conflict do nothing;

    if found then
      v_active := v_active + 1;
      v_added := v_added + 1;

      perform public.enqueue_auto_match_notification(
        v_proposal.id,
        'auto_match_gestating',
        'Se liberó un lugar',
        format('Se liberó un lugar en un %s compatible con tus horarios. Entrá para confirmar si te sumás.', v_proposal.format),
        array[v_candidate.user_id]::uuid[],
        format('joined:%s', v_candidate.user_id),
        null
      );
    end if;
  end loop;

  return v_added;
end;
$$;

revoke all on function public.backfill_auto_match_proposal_members(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Recalculo tras la salida de un miembro (rechazo, vencimiento o retiro por
--    superposición). Único lugar con la lógica de reemplazo + degradación
--    ready->collecting + cancelación por debajo del umbral + organizador
--    huérfano. Idempotente y bajo lock de la propuesta.
-- ---------------------------------------------------------------------------

create or replace function public.process_auto_match_member_exit(p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_required integer;
  v_threshold integer;
  v_accepted integer;
  v_active integer;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null or v_proposal.status not in ('collecting', 'ready') then
    return;
  end if;

  -- Organizador huérfano: si dejó de estar confirmado, la propuesta vuelve a
  -- necesitar organización.
  if v_proposal.organizer_id is not null
     and not exists (
       select 1 from public.auto_match_proposal_members m
       where m.proposal_id = p_proposal_id and m.user_id = v_proposal.organizer_id and m.response = 'accepted'
     ) then
    update public.auto_match_proposals
    set organizer_id = null, organizer_deadline_at = null, updated_at = now()
    where id = p_proposal_id;
    v_proposal.organizer_id := null;
  end if;

  perform public.backfill_auto_match_proposal_members(p_proposal_id);

  v_required := v_proposal.max_players;
  v_threshold := coalesce(v_proposal.gestation_threshold, public.auto_match_threshold(v_proposal.format));

  select
    count(*) filter (where response = 'accepted'),
    count(*) filter (where response not in ('declined', 'expired'))
  into v_accepted, v_active
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id;

  if v_active < v_threshold then
    update public.auto_match_proposals
    set status = 'cancelled', cancelled_reason = 'below_threshold', updated_at = now()
    where id = p_proposal_id and status in ('collecting', 'ready');

    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_cancelled',
      'La propuesta se canceló',
      'Se bajaron varios jugadores y no encontramos reemplazos. Tu disponibilidad sigue activa y Arma2 buscará otra combinación.',
      null,
      'cancelled_below_threshold',
      null
    );
    return;
  end if;

  -- Si perdió titulares y estaba lista, vuelve a juntar confirmaciones.
  if v_proposal.status = 'ready' and v_accepted < v_required then
    update public.auto_match_proposals
    set status = 'collecting', organizer_deadline_at = null, updated_at = now()
    where id = p_proposal_id and status = 'ready';
  end if;
end;
$$;

revoke all on function public.process_auto_match_member_exit(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Resolución de organizador al completarse el cupo de titulares. El
--    organizador debe ser un TITULAR: se elige el voluntario confirmado más
--    temprano entre los primeros `required` por orden de confirmación.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_auto_match_full_cupo(p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_required integer;
  v_volunteer record;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id;

  if v_proposal.id is null then return; end if;
  v_required := v_proposal.max_players;

  if v_proposal.organizer_id is null then
    -- Voluntario más temprano entre los titulares (rank <= required por
    -- confirmed_at). Nadie es convertido a la fuerza.
    select ranked.user_id, ranked.nombre
    into v_volunteer
    from (
      select
        m.user_id,
        u.nombre,
        m.can_organize,
        row_number() over (order by m.confirmed_at asc nulls last, m.user_id) as seat
      from public.auto_match_proposal_members m
      join public.usuarios u on u.id = m.user_id
      where m.proposal_id = p_proposal_id and m.response = 'accepted'
    ) ranked
    where ranked.seat <= v_required and ranked.can_organize
    order by ranked.seat
    limit 1;

    if v_volunteer.user_id is not null then
      update public.auto_match_proposals
      set organizer_id = v_volunteer.user_id, organizer_deadline_at = null, updated_at = now()
      where id = p_proposal_id;

      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_organizing',
        '¡Ya somos todos!',
        format('El cupo está completo y %s organiza el partido: va a definir cancha, hora exacta y precio.', coalesce(v_volunteer.nombre, 'un jugador')),
        null,
        format('organizer_assigned:%s', v_volunteer.user_id),
        null
      );
      return;
    end if;

    update public.auto_match_proposals
    set organizer_deadline_at = least(now() + interval '12 hours', expires_at), updated_at = now()
    where id = p_proposal_id;

    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_ready',
      'Ya están todos los jugadores',
      'Falta que alguien organice el partido. El primero que toque "Yo lo organizo" define cancha y precio.',
      null,
      'ready_awaiting_organizer',
      null
    );
  else
    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_organizing',
      '¡Ya somos todos!',
      'El cupo volvió a completarse. La organización sigue en marcha.',
      null,
      format('refull:%s', extract(epoch from now())::bigint / 3600),
      null
    );
  end if;
end;
$$;

revoke all on function public.resolve_auto_match_full_cupo(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Responder: aceptar (entra por orden de confirmación; de más = suplente y
--    retiro de superpuestas) o rechazar (sale solo esa persona + recálculo).
-- ---------------------------------------------------------------------------

drop function if exists public.respond_to_auto_match_proposal(bigint,text,boolean);

create or replace function public.respond_to_auto_match_proposal(
  p_proposal_id bigint,
  p_response text,
  p_can_organize boolean default false
)
returns public.auto_match_proposal_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_member public.auto_match_proposal_members;
  v_accepted integer;
  v_pending integer;
  v_required integer;
  v_overlap record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_response not in ('accepted','declined') then raise exception 'invalid_response'; end if;

  perform public.expire_stale_auto_match_proposals();

  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null then raise exception 'proposal_not_found'; end if;
  if v_proposal.status not in ('collecting', 'ready') or v_proposal.expires_at <= now() then
    raise exception 'proposal_not_open';
  end if;

  select * into v_member
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id and user_id = auth.uid();

  if v_member.proposal_id is null then raise exception 'proposal_member_not_found'; end if;
  if v_member.response = 'declined' then raise exception 'proposal_member_declined'; end if;
  -- Una invitación vencida no permite confirmar tarde.
  if v_member.response = 'expired' then raise exception 'proposal_member_expired'; end if;

  v_required := v_proposal.max_players;

  if p_response = 'accepted' then
    -- Aceptar SIEMPRE es posible mientras la propuesta esté viva: los primeros
    -- `required` por confirmed_at son titulares, el resto suplentes. No se
    -- rechaza por "cupo lleno".
    update public.auto_match_proposal_members
    set response = 'accepted',
        can_organize = can_organize or coalesce(p_can_organize, false),
        confirmed_at = coalesce(confirmed_at, now()),
        responded_at = coalesce(responded_at, now())
    where proposal_id = p_proposal_id and user_id = auth.uid()
    returning * into v_member;

    -- Retiro de otras propuestas activas superpuestas donde estaba pendiente o
    -- confirmado: evita la doble reserva. Atómico, dentro de esta transacción.
    for v_overlap in
      select p.id
      from public.auto_match_proposal_members m
      join public.auto_match_proposals p on p.id = m.proposal_id
      where m.user_id = auth.uid()
        and m.response in ('pending', 'accepted')
        and p.id <> p_proposal_id
        and p.status in ('collecting', 'ready')
        and p.expires_at > now()
        and tstzrange(p.proposed_starts_at - interval '30 minutes', p.proposed_starts_at + interval '150 minutes', '[)')
            && tstzrange(v_proposal.proposed_starts_at - interval '30 minutes', v_proposal.proposed_starts_at + interval '150 minutes', '[)')
    loop
      update public.auto_match_proposal_members
      set response = 'declined', responded_at = now(), confirmed_at = null
      where proposal_id = v_overlap.id and user_id = auth.uid();
      perform public.process_auto_match_member_exit(v_overlap.id);
    end loop;

    select
      count(*) filter (where response = 'accepted'),
      count(*) filter (where response = 'pending')
    into v_accepted, v_pending
    from public.auto_match_proposal_members
    where proposal_id = p_proposal_id;

    if v_accepted >= v_required then
      if v_proposal.status = 'collecting' then
        update public.auto_match_proposals
        set status = 'ready', updated_at = now()
        where id = p_proposal_id and status = 'collecting';
      end if;
      perform public.resolve_auto_match_full_cupo(p_proposal_id);
    elsif v_required - v_accepted <= 2 and v_pending > 0 then
      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_almost_full',
        'Faltan muy pocos',
        format('Faltan %s confirmaciones para completar el partido.', v_required - v_accepted),
        null,
        format('almost_full:%s', v_required - v_accepted),
        null
      );
    end if;

    return v_member;
  end if;

  -- Rechazo: sale solo esta persona.
  update public.auto_match_proposal_members
  set response = 'declined', responded_at = now(), confirmed_at = null
  where proposal_id = p_proposal_id and user_id = auth.uid()
  returning * into v_member;

  perform public.process_auto_match_member_exit(p_proposal_id);

  return v_member;
end;
$$;

revoke all on function public.respond_to_auto_match_proposal(bigint,text,boolean) from public, anon;
grant execute on function public.respond_to_auto_match_proposal(bigint,text,boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Vencimiento individual de invitaciones (backend, sin app abierta).
-- ---------------------------------------------------------------------------

create or replace function public.expire_stale_auto_match_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select m.proposal_id, m.user_id
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.response = 'pending'
      and m.invite_expires_at is not null
      and m.invite_expires_at <= now()
      and p.status in ('collecting', 'ready')
    for update skip locked
  loop
    update public.auto_match_proposal_members
    set response = 'expired', responded_at = now()
    where proposal_id = v_row.proposal_id and user_id = v_row.user_id and response = 'pending';

    if found then
      v_count := v_count + 1;
      perform public.enqueue_auto_match_notification(
        v_row.proposal_id,
        'auto_match_invite_expired',
        'Se venció tu invitación',
        'No llegaste a responder a tiempo y tu lugar se liberó. Tu disponibilidad sigue activa para otras combinaciones.',
        array[v_row.user_id]::uuid[],
        format('invite_expired:%s', v_row.user_id),
        null
      );
      -- Libera capacidad y busca reemplazo.
      perform public.process_auto_match_member_exit(v_row.proposal_id);
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_auto_match_invites() from public, anon, authenticated;

-- Vencimiento a nivel propuesta (expires_at + reserva de organización), ahora
-- también barre invitaciones individuales vencidas.
create or replace function public.expire_stale_auto_match_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  perform public.expire_stale_auto_match_invites();

  for v_row in
    select p.id, p.expires_at, p.organizer_id, p.organizer_deadline_at, p.status
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready')
      and (
        p.expires_at <= now()
        or (
          p.status = 'ready'
          and p.organizer_id is null
          and p.organizer_deadline_at is not null
          and p.organizer_deadline_at <= now()
        )
      )
    for update skip locked
  loop
    if v_row.expires_at <= now() then
      update public.auto_match_proposals
      set status = 'expired', cancelled_reason = coalesce(cancelled_reason, 'expired'), updated_at = now()
      where id = v_row.id;

      perform public.enqueue_auto_match_notification(
        v_row.id,
        'auto_match_cancelled',
        'La propuesta venció',
        'No se llegó a completar el partido a tiempo. Tu disponibilidad sigue activa y Arma2 buscará otra combinación.',
        null,
        'expired',
        null
      );
    else
      update public.auto_match_proposals
      set status = 'cancelled', cancelled_reason = 'no_organizer', updated_at = now()
      where id = v_row.id;

      perform public.enqueue_auto_match_notification(
        v_row.id,
        'auto_match_cancelled',
        'Faltó quien organice',
        'Nadie tomó la organización a tiempo y la propuesta se canceló. Tu disponibilidad sigue activa.',
        null,
        'cancelled_no_organizer',
        null
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.expire_stale_auto_match_proposals() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Barrido programado (pg_cron): vencimientos + reintento de reemplazos.
--     Reutiliza el patrón guardado de los demás schedulers: si pg_cron no está
--     instalado (p. ej. en el harness embebido) simplemente se omite.
-- ---------------------------------------------------------------------------

create or replace function public.auto_match_scheduled_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  perform public.expire_stale_auto_match_proposals();

  -- Reintento de reemplazos: propuestas activas por debajo de la capacidad de
  -- convocatoria vuelven a invitar compatibles disponibles.
  for v_row in
    select p.id
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready')
      and p.expires_at > now()
      and (
        select count(*) from public.auto_match_proposal_members m
        where m.proposal_id = p.id and m.response not in ('declined', 'expired')
      ) < public.auto_match_invitation_capacity(p.format)
    for update skip locked
  loop
    perform public.backfill_auto_match_proposal_members(v_row.id);
  end loop;
end;
$$;

revoke all on function public.auto_match_scheduled_sweep() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('auto_match_sweep')
    where exists (select 1 from cron.job where jobname = 'auto_match_sweep');
    perform cron.schedule(
      'auto_match_sweep',
      '*/5 * * * *',
      $cron$select public.auto_match_scheduled_sweep();$cron$
    );
  else
    raise notice 'Skipping auto_match sweep cron schedule because pg_cron is not enabled.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Materialización: los confirmados entran por ORDEN DE CONFIRMACIÓN. Los
--     primeros `required` (cupo_jugadores) son titulares, el resto suplentes —
--     el modelo posicional del partido real (titulares = primeros cupo, resto
--     suplentes) se respeta insertando en ese orden. Los pendientes NO entran
--     automáticamente. Idempotente (parte inalterada respecto de la previa).
-- ---------------------------------------------------------------------------

create or replace function public.finalize_auto_match_proposal(
  p_proposal_id bigint,
  p_nombre text,
  p_fecha date default null,
  p_hora text default null,
  p_tipo_partido text default 'Masculino',
  p_precio numeric default null,
  p_sede text default null,
  p_sede_place_id text default null,
  p_sede_direccion text default null,
  p_sede_latitud double precision default null,
  p_sede_longitud double precision default null
)
returns public.auto_match_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_proposal public.auto_match_proposals;
  v_local timestamp;
  v_fecha date;
  v_hora text;
  v_new_start timestamptz;
  v_nombre text;
  v_codigo text;
  v_partido_id bigint;
  v_match_ref uuid;
  v_attempt integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null then raise exception 'proposal_not_found'; end if;

  if v_proposal.partido_id is not null then
    return v_proposal;
  end if;

  if v_proposal.organizer_id is null or v_proposal.organizer_id <> auth.uid() then
    raise exception 'not_the_organizer';
  end if;
  if v_proposal.status <> 'ready' then
    raise exception 'proposal_not_ready';
  end if;
  if v_proposal.expires_at <= now() then
    raise exception 'proposal_not_open';
  end if;

  v_nombre := nullif(trim(coalesce(p_nombre, '')), '');
  if v_nombre is null then raise exception 'match_name_required'; end if;
  if p_precio is not null and p_precio < 0 then raise exception 'invalid_price'; end if;

  v_local := v_proposal.proposed_starts_at at time zone v_tz;
  v_fecha := coalesce(p_fecha, v_local::date);
  v_hora := coalesce(nullif(trim(coalesce(p_hora, '')), ''), to_char(v_local, 'HH24:MI'));
  if v_hora !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'invalid_time'; end if;

  v_new_start := (v_fecha + v_hora::time) at time zone v_tz;
  if abs(extract(epoch from (v_new_start - v_proposal.proposed_starts_at))) > 7200 then
    raise exception 'time_out_of_range';
  end if;

  for v_attempt in 1..5 loop
    v_codigo := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from public.partidos where codigo = v_codigo);
    if v_attempt = 5 then raise exception 'match_code_generation_failed'; end if;
  end loop;

  v_match_ref := gen_random_uuid();

  insert into public.partidos (
    match_ref, codigo, nombre, fecha, hora, sede, sede_place_id, sede_direccion_normalizada,
    sede_latitud, sede_longitud, modalidad, cupo_jugadores, falta_jugadores, player_invites_enabled,
    tipo_partido, creado_por, precio_cancha_por_persona
  ) values (
    v_match_ref, v_codigo, v_nombre, v_fecha, v_hora,
    nullif(trim(coalesce(p_sede, '')), ''),
    nullif(trim(coalesce(p_sede_place_id, '')), ''),
    nullif(trim(coalesce(p_sede_direccion, '')), ''),
    p_sede_latitud, p_sede_longitud, v_proposal.format, v_proposal.max_players, false, false,
    coalesce(nullif(trim(coalesce(p_tipo_partido, '')), ''), 'Masculino'), auth.uid(), p_precio
  ) returning id into v_partido_id;

  -- Confirmados en ORDEN DE CONFIRMACIÓN: los primeros `cupo_jugadores` quedan
  -- titulares, el resto suplentes (modelo posicional del partido). El id de
  -- jugador se asigna en ese orden para que el split titular/suplente coincida.
  insert into public.jugadores (
    partido_id, match_ref, usuario_id, nombre, avatar_url, score, is_goalkeeper
  )
  select
    v_partido_id, v_match_ref, ordered.user_id,
    coalesce(nullif(trim(ordered.nombre), ''), 'Jugador'), ordered.avatar_url, 5, false
  from (
    select m.user_id, u.nombre, u.avatar_url
    from public.auto_match_proposal_members m
    join public.usuarios u on u.id = m.user_id
    where m.proposal_id = p_proposal_id and m.response = 'accepted'
    order by m.confirmed_at asc nulls last, m.user_id
  ) ordered
  where not exists (
    select 1 from public.jugadores j
    where j.partido_id = v_partido_id and j.usuario_id = ordered.user_id
  );

  update public.auto_match_proposals
  set status = 'created', partido_id = v_partido_id, updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  perform public.enqueue_auto_match_notification(
    p_proposal_id,
    'auto_match_created',
    '¡Partido confirmado!',
    format('%s ya tiene cancha, fecha y hora. Entrá para ver los detalles.', v_nombre),
    null,
    'created',
    jsonb_build_object('match_id', v_partido_id, 'partido_id', v_partido_id, 'route', '/partido-publico/' || v_partido_id)
  );

  return v_proposal;
end;
$$;

revoke all on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) from public, anon;
grant execute on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Sync: VARIAS gestaciones simultáneas. Recorre CADA día elegible de la
--     disponibilidad (no solo el más próximo) y arma/join-ea una gestación por
--     ocurrencia, convocando hasta la capacidad de sobreconvocatoria.
-- ---------------------------------------------------------------------------

create or replace function public.sync_my_auto_match_gestations()
returns table (proposal_id bigint, action text, format text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mine public.player_availability;
  v_format text;
  v_required integer;
  v_capacity integer;
  v_min integer;
  v_day smallint;
  v_group_start time;
  v_group_end time;
  v_local_today date;
  v_slot_date date;
  v_proposed timestamptz;
  v_expires timestamptz;
  v_offset integer;
  v_bucket bigint;
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_member_count integer;
  v_cand_count integer;
  v_created boolean;
  v_created_this_format boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  perform pg_advisory_xact_lock(hashtext('auto_match_sync:' || auth.uid()::text));
  perform public.expire_stale_auto_match_proposals();

  select * into v_mine
  from public.player_availability
  where user_id = auth.uid() and status = 'active'
  order by created_at desc
  limit 1;

  if v_mine.id is null then return; end if;

  v_local_today := (now() at time zone v_mine.timezone)::date;

  foreach v_format in array v_mine.formats loop
    v_required := public.auto_match_required_players(v_format);
    v_capacity := public.auto_match_invitation_capacity(v_format);
    v_min := public.auto_match_min_candidates();
    v_created_this_format := false;

    -- Cada día elegible por separado: una disponibilidad sáb+dom puede gestar
    -- una propuesta el sábado Y otra el domingo. Antes solo se generaba el día
    -- más próximo (causa concreta del bloqueo entre gestaciones).
    foreach v_day in array v_mine.days_of_week loop
      v_created := false;

      -- FASE A: sumarse a una gestación existente compatible para ESE día.
      select p.* into v_proposal
      from public.auto_match_proposals p
      where p.status in ('collecting', 'ready')
        and p.format = v_format
        and p.expires_at > now()
        and extract(isodow from (p.proposed_starts_at at time zone v_mine.timezone))::smallint = v_day
        and (p.proposed_starts_at at time zone v_mine.timezone)::time >= v_mine.time_start
        and v_mine.time_end - (p.proposed_starts_at at time zone v_mine.timezone)::time >= interval '60 minutes'
        and not public.user_has_overlapping_auto_match(auth.uid(), p.proposed_starts_at, p.id)
        and not public.user_declined_auto_match_slot(auth.uid(), v_format, p.proposed_starts_at)
        and not exists (
          select 1 from public.auto_match_proposal_members m
          where m.proposal_id = p.id and m.user_id = auth.uid()
        )
        and (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = p.id and m.response not in ('declined', 'expired')
        ) < v_capacity
      order by p.created_at asc
      limit 1
      for update skip locked;

      if v_proposal.id is not null then
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
        ) values (
          v_proposal.id, v_mine.id, auth.uid(), 'pending', v_mine.can_organize,
          public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
        ) on conflict do nothing;

        perform public.enqueue_auto_match_notification(
          v_proposal.id, 'auto_match_gestating', 'Se está armando un partido',
          format('Se está armando un %s compatible con tus horarios. Entrá para ver el estado.', v_format),
          array[auth.uid()]::uuid[], format('joined:%s', auth.uid()), null
        );

        proposal_id := v_proposal.id; action := 'joined'; format := v_format;
        return next;
        continue;
      end if;

      -- Anti-spam: se CREA a lo sumo una gestación nueva por formato y por sync
      -- (el sumarse a existentes de otros días sigue sin límite arriba). Evita
      -- que una sola activación con disponibilidad amplia dispare muchas salas a
      -- la vez; el resto de los días se van gestando en syncs sucesivos.
      if v_created_this_format then continue; end if;

      -- FASE B: armar el mejor grupo compatible disponible ESE día.
      create temporary table if not exists tmp_auto_match_gestation_candidates (
        availability_id bigint,
        user_id uuid,
        overlap_start time,
        overlap_end time,
        distance_km double precision,
        can_organize boolean
      ) on commit drop;
      truncate tmp_auto_match_gestation_candidates;

      insert into tmp_auto_match_gestation_candidates
      select c.availability_id, c.user_id, c.overlap_start, c.overlap_end, c.distance_km, c.can_organize
      from (
        select
          other.id as availability_id,
          other.user_id as user_id,
          greatest(v_mine.time_start, other.time_start) as overlap_start,
          least(v_mine.time_end, other.time_end) as overlap_end,
          case
            when v_mine.latitude is null or v_mine.longitude is null or other.latitude is null or other.longitude is null then null
            else 6371 * 2 * asin(sqrt(
              power(sin(radians(other.latitude - v_mine.latitude) / 2), 2)
              + cos(radians(v_mine.latitude)) * cos(radians(other.latitude))
              * power(sin(radians(other.longitude - v_mine.longitude) / 2), 2)
            ))
          end as distance_km,
          other.can_organize as can_organize
        from public.player_availability other
        where other.status = 'active'
          and other.user_id <> auth.uid()
          and v_format = any(other.formats)
          and v_day = any(other.days_of_week)
          and least(v_mine.time_end, other.time_end) - greatest(v_mine.time_start, other.time_start) >= interval '60 minutes'
          and (
            v_mine.latitude is null or v_mine.longitude is null or other.latitude is null or other.longitude is null
            or (6371 * 2 * asin(sqrt(
              power(sin(radians(other.latitude - v_mine.latitude) / 2), 2)
              + cos(radians(v_mine.latitude)) * cos(radians(other.latitude))
              * power(sin(radians(other.longitude - v_mine.longitude) / 2), 2)
            ))) <= least(v_mine.max_distance_km, other.max_distance_km)
          )
      ) c
      order by c.overlap_end - c.overlap_start desc, c.distance_km asc nulls last
      limit v_capacity - 1;

      select count(*) into v_cand_count from tmp_auto_match_gestation_candidates;
      if v_cand_count + 1 < v_min then continue; end if;

      select max(overlap_start), min(overlap_end)
        into v_group_start, v_group_end
      from tmp_auto_match_gestation_candidates;

      if v_group_start is null or v_group_end - v_group_start < interval '60 minutes' then continue; end if;

      -- Próxima ocurrencia concreta de v_day, a la hora del grupo.
      v_proposed := null;
      for v_offset in 0..14 loop
        v_slot_date := v_local_today + v_offset;
        if extract(isodow from v_slot_date)::smallint = v_day then
          v_proposed := (v_slot_date + v_group_start) at time zone v_mine.timezone;
          if v_proposed > now() + interval '90 minutes' then exit; end if;
          v_proposed := null;
        end if;
      end loop;

      if v_proposed is null then continue; end if;
      if public.user_has_overlapping_auto_match(auth.uid(), v_proposed, null) then continue; end if;
      if public.user_declined_auto_match_slot(auth.uid(), v_format, v_proposed) then continue; end if;

      v_bucket := floor(extract(epoch from v_proposed) / 900)::bigint;
      perform pg_advisory_xact_lock(hashtextextended('auto_match_slot:' || v_format || ':' || (v_bucket - 1)::text, 0));
      perform pg_advisory_xact_lock(hashtextextended('auto_match_slot:' || v_format || ':' || v_bucket::text, 0));
      perform pg_advisory_xact_lock(hashtextextended('auto_match_slot:' || v_format || ':' || (v_bucket + 1)::text, 0));

      select p.* into v_proposal
      from public.auto_match_proposals p
      where p.status in ('collecting', 'ready')
        and p.format = v_format
        and abs(extract(epoch from (p.proposed_starts_at - v_proposed))) < 900
      order by p.created_at asc
      limit 1
      for update;

      if v_proposal.id is null then
        v_expires := v_proposed - interval '30 minutes';
        begin
          insert into public.auto_match_proposals (
            format, proposed_starts_at, latitude, longitude, max_players, status, created_by,
            expires_at, gestation_started_at, gestation_threshold
          ) values (
            v_format, v_proposed, null, null, v_required, 'collecting', auth.uid(),
            v_expires, now(), v_min
          ) returning * into v_proposal;
          v_created := true;
        exception when exclusion_violation then
          select p.* into v_proposal
          from public.auto_match_proposals p
          where p.status in ('collecting', 'ready')
            and p.format = v_format
            and abs(extract(epoch from (p.proposed_starts_at - v_proposed))) < 900
          order by p.created_at asc
          limit 1
          for update;
          if v_proposal.id is null then continue; end if;
        end;
      end if;

      if v_created then
        -- Quien inicia la gestación queda confirmado de entrada, con su orden.
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, responded_at, confirmed_at, can_organize
        ) values (
          v_proposal.id, v_mine.id, auth.uid(), 'accepted', now(), now(), v_mine.can_organize
        ) on conflict do nothing;
      else
        if (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired')
        ) >= v_capacity then
          continue;
        end if;

        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
        ) values (
          v_proposal.id, v_mine.id, auth.uid(), 'pending', v_mine.can_organize,
          public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
        ) on conflict do nothing;

        perform public.enqueue_auto_match_notification(
          v_proposal.id, 'auto_match_gestating', 'Se está armando un partido',
          format('Se está armando un %s compatible con tus horarios. Entrá para ver el estado.', v_format),
          array[auth.uid()]::uuid[], format('joined:%s', auth.uid()), null
        );
      end if;

      -- Convoca compatibles hasta la capacidad de sobreconvocatoria.
      for v_candidate in select * from tmp_auto_match_gestation_candidates loop
        exit when (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired')
        ) >= v_capacity;
        if not public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposed, v_proposal.id)
           and not public.user_declined_auto_match_slot(v_candidate.user_id, v_format, v_proposed) then
          insert into public.auto_match_proposal_members (
            proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
          ) values (
            v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending', v_candidate.can_organize,
            public.auto_match_invite_deadline(now(), v_proposed)
          ) on conflict do nothing;
        end if;
      end loop;

      select count(*) into v_member_count
      from public.auto_match_proposal_members m
      where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired');

      if v_created then
        perform public.enqueue_auto_match_notification(
          v_proposal.id, 'auto_match_gestating',
          format('Se está armando un %s', v_format),
          format('Ya hay %s de %s jugadores compatibles. Entrá para confirmar si te sumás.', v_member_count, v_required),
          null, 'gestation_created', null
        );
      end if;

      if v_created then v_created_this_format := true; end if;

      proposal_id := v_proposal.id;
      action := case when v_created then 'created' else 'joined' end;
      format := v_format;
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function public.sync_my_auto_match_gestations() from public, anon;
grant execute on function public.sync_my_auto_match_gestations() to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Listado propio con capacidad, orden de confirmación y asiento propio.
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_auto_match_proposals();

create or replace function public.get_my_auto_match_proposals()
returns table (
  id bigint,
  format text,
  proposed_starts_at timestamptz,
  max_players integer,
  invitation_capacity integer,
  status text,
  expires_at timestamptz,
  gestation_started_at timestamptz,
  gestation_threshold integer,
  my_response text,
  my_can_organize boolean,
  my_seat text,
  my_invite_expires_at timestamptz,
  member_count integer,
  accepted_count integer,
  pending_count integer,
  declined_count integer,
  missing_count integer,
  titular_slots_left integer,
  organizer_id uuid,
  organizer_nombre text,
  organizer_deadline_at timestamptz,
  partido_id bigint,
  cancelled_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.format,
    p.proposed_starts_at,
    p.max_players,
    public.auto_match_invitation_capacity(p.format) as invitation_capacity,
    p.status,
    p.expires_at,
    p.gestation_started_at,
    p.gestation_threshold,
    mine.response as my_response,
    mine.can_organize as my_can_organize,
    case
      when mine.response = 'accepted' then
        case when (
          select count(*) from public.auto_match_proposal_members m2
          where m2.proposal_id = p.id and m2.response = 'accepted'
            and (
              coalesce(m2.confirmed_at, m2.responded_at) < coalesce(mine.confirmed_at, mine.responded_at)
              or (coalesce(m2.confirmed_at, m2.responded_at) = coalesce(mine.confirmed_at, mine.responded_at) and m2.user_id <= mine.user_id)
            )
        ) <= p.max_players then 'titular' else 'suplente' end
      else null
    end as my_seat,
    mine.invite_expires_at as my_invite_expires_at,
    count(all_members.user_id) filter (where all_members.response not in ('declined', 'expired'))::integer as member_count,
    count(all_members.user_id) filter (where all_members.response = 'accepted')::integer as accepted_count,
    count(all_members.user_id) filter (where all_members.response = 'pending')::integer as pending_count,
    count(all_members.user_id) filter (where all_members.response in ('declined', 'expired'))::integer as declined_count,
    greatest(0, p.max_players - count(all_members.user_id) filter (where all_members.response = 'accepted'))::integer as missing_count,
    greatest(0, p.max_players - count(all_members.user_id) filter (where all_members.response = 'accepted'))::integer as titular_slots_left,
    p.organizer_id,
    org.nombre as organizer_nombre,
    p.organizer_deadline_at,
    p.partido_id,
    p.cancelled_reason
  from public.auto_match_proposal_members mine
  join public.auto_match_proposals p on p.id = mine.proposal_id
  left join public.usuarios org on org.id = p.organizer_id
  join public.auto_match_proposal_members all_members on all_members.proposal_id = p.id
  where mine.user_id = auth.uid()
    and mine.response not in ('declined', 'expired')
    and (
      (p.status in ('collecting', 'ready') and p.expires_at > now())
      or (p.status = 'created' and p.proposed_starts_at > now())
      or (p.status in ('cancelled', 'expired') and p.updated_at > now() - interval '24 hours')
    )
  group by p.id, mine.response, mine.can_organize, mine.confirmed_at, mine.responded_at, mine.user_id, mine.invite_expires_at, org.nombre
  order by
    case p.status when 'ready' then 0 when 'collecting' then 1 when 'created' then 2 else 3 end,
    p.proposed_starts_at asc;
$$;

revoke all on function public.get_my_auto_match_proposals() from public, anon;
grant execute on function public.get_my_auto_match_proposals() to authenticated;

-- ---------------------------------------------------------------------------
-- 15. Roster con confirmed_at + asiento titular/suplente por orden.
-- ---------------------------------------------------------------------------

drop function if exists public.get_auto_match_proposal_members(bigint);

create or replace function public.get_auto_match_proposal_members(p_proposal_id bigint)
returns table (
  user_id uuid,
  nombre text,
  avatar_url text,
  response text,
  can_organize boolean,
  is_organizer boolean,
  responded_at timestamptz,
  confirmed_at timestamptz,
  seat text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.user_id,
    t.nombre,
    t.avatar_url,
    t.response,
    t.can_organize,
    t.is_organizer,
    t.responded_at,
    t.confirmed_at,
    case
      when t.response = 'accepted' and t.accepted_rank <= t.max_players then 'titular'
      when t.response = 'accepted' then 'suplente'
      else null
    end as seat
  from (
    select
      m.user_id,
      u.nombre,
      u.avatar_url,
      m.response,
      m.can_organize,
      (p.organizer_id = m.user_id) as is_organizer,
      m.responded_at,
      m.confirmed_at,
      p.max_players,
      row_number() over (
        partition by (m.response = 'accepted')
        order by coalesce(m.confirmed_at, m.responded_at) asc nulls last, m.user_id
      ) as accepted_rank
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    join public.usuarios u on u.id = m.user_id
    where m.proposal_id = p_proposal_id
      and exists (
        select 1 from public.auto_match_proposal_members me
        where me.proposal_id = p_proposal_id and me.user_id = auth.uid()
      )
  ) t
  order by
    t.is_organizer desc,
    case t.response when 'accepted' then 0 when 'pending' then 1 else 2 end,
    coalesce(t.confirmed_at, t.responded_at) asc nulls last,
    t.user_id;
$$;

revoke all on function public.get_auto_match_proposal_members(bigint) from public, anon;
grant execute on function public.get_auto_match_proposal_members(bigint) to authenticated;

commit;
