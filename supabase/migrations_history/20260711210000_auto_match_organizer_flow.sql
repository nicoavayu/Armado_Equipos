begin;

-- ============================================================================
-- Gestación automática: organizador voluntario + conversión a partido real
--
-- Completa el ciclo Disponibilidad -> Gestación -> Cupo completo ->
-- Organizador -> Partido normal de Arma2. Corrige además dos reglas del MVP:
--
--   * Rechazar YA NO cancela la propuesta: sale solo quien rechazó, se busca
--     reemplazo compatible al instante (backfill) y la propuesta sigue. Solo
--     se cancela si vence, si pierde la masa crítica (gestation_threshold) o
--     si nadie toma la organización a tiempo.
--   * El bloqueo por rechazo deja de ser "24 h desde responded_at": ahora
--     bloquea exactamente esa ocurrencia (mismo formato y mismo bucket de
--     15 min de horario propuesto) hasta que el horario del slot pase. Otros
--     días u horarios nunca quedan bloqueados.
--
-- Regla de reserva de organización (documentada aquí a propósito):
--   expires_at sigue siendo proposed_starts_at - 30 min (regla del MVP).
--   Cuando el cupo se completa sin voluntario, la propuesta queda reservada
--   esperando organizador hasta organizer_deadline_at =
--   least(now() + 12 horas, expires_at): 12 horas de reserva, o el margen
--   restante hasta 30 min antes del comienzo si el partido está más cerca.
--   Si vence sin organizador se cancela con cancelled_reason='no_organizer'.
--
-- Idempotencia de notificaciones: cada transición registra un event_key en
-- auto_match_proposal_events (PK proposal_id+event_key). La transacción que
-- gana el INSERT es la única que notifica; reintentos y llamadas concurrentes
-- no duplican pushes.
--
-- Anti doble-propuesta por bucket: además de los advisory locks (ahora sobre
-- los 3 buckets de 15 min que cubren la ventana de ±15 min), una constraint
-- de exclusión (btree_gist) impide a nivel de datos dos propuestas activas
-- del mismo formato con horarios a menos de 15 min entre sí.
-- ============================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------

alter table public.player_availability
  add column if not exists can_organize boolean not null default false;

alter table public.auto_match_proposals
  add column if not exists organizer_id uuid references public.usuarios(id) on delete set null,
  add column if not exists organizer_deadline_at timestamptz;

alter table public.auto_match_proposal_members
  add column if not exists can_organize boolean not null default false;

-- ---------------------------------------------------------------------------
-- Registro idempotente de transiciones notificadas
-- ---------------------------------------------------------------------------

create table if not exists public.auto_match_proposal_events (
  proposal_id bigint not null references public.auto_match_proposals(id) on delete cascade,
  event_key text not null,
  created_at timestamptz not null default now(),
  primary key (proposal_id, event_key)
);

-- Solo lo tocan las funciones security definer; sin policies no hay acceso
-- directo de clientes.
alter table public.auto_match_proposal_events enable row level security;

-- ---------------------------------------------------------------------------
-- Constraint de exclusión por bucket horario (con saneo previo de duplicados
-- activos que hubiera dejado la ventana de carrera del MVP)
-- ---------------------------------------------------------------------------

update public.auto_match_proposals p
set status = 'cancelled',
    cancelled_reason = 'duplicate_slot',
    updated_at = now()
where p.status in ('collecting', 'ready')
  and exists (
    select 1
    from public.auto_match_proposals q
    where q.status in ('collecting', 'ready')
      and q.format = p.format
      and q.id < p.id
      and abs(extract(epoch from (q.proposed_starts_at - p.proposed_starts_at))) < 900
  );

-- El epoch de un timestamptz no depende del timezone de sesión, así que este
-- helper puede marcarse IMMUTABLE y usarse en la constraint de exclusión
-- (timestamptz +/- interval está marcado STABLE y no sirve para índices).
create or replace function public.auto_match_slot_bucket_range(p_starts_at timestamptz)
returns int8range
language sql
immutable
as $$
  select int8range(
    extract(epoch from p_starts_at)::bigint - 450,
    extract(epoch from p_starts_at)::bigint + 450,
    '[)'
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'auto_match_proposals_slot_bucket_excl'
  ) then
    alter table public.auto_match_proposals
      add constraint auto_match_proposals_slot_bucket_excl
      exclude using gist (
        format with =,
        public.auto_match_slot_bucket_range(proposed_starts_at) with &&
      ) where (status in ('collecting', 'ready'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bloqueo por rechazo: misma ocurrencia (formato + bucket de horario) hasta
-- que el horario propuesto pase. Nunca bloquea otros días/franjas.
-- ---------------------------------------------------------------------------

create or replace function public.user_declined_auto_match_slot(
  p_user_id uuid,
  p_format text,
  p_starts_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.auto_match_proposal_members dm
    join public.auto_match_proposals dp on dp.id = dm.proposal_id
    where dm.user_id = p_user_id
      and dm.response = 'declined'
      and dp.format = p_format
      and abs(extract(epoch from (dp.proposed_starts_at - p_starts_at))) < 900
      -- El bloqueo vive hasta que el horario rechazado pasa, sin importar
      -- cuándo se rechazó.
      and dp.proposed_starts_at > now()
  );
$$;

-- ---------------------------------------------------------------------------
-- Superposición: propuestas activas Y partidos reales donde la persona juega
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
      and m.response <> 'declined'
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
    -- Partidos reales (incluidos los ya convertidos desde una gestación) en
    -- los que la persona figura como jugador cerca del mismo horario.
    select 1
    from public.jugadores j
    join public.partidos pa on pa.id = j.partido_id
    where j.usuario_id = p_user_id
      and coalesce(pa.estado, '') not in ('deleted', 'cancelado', 'cancelled')
      and public.partido_kickoff_at(pa.fecha, pa.hora) is not null
      and abs(extract(epoch from (public.partido_kickoff_at(pa.fecha, pa.hora) - p_starts_at))) < 7200
  );
$$;

-- ---------------------------------------------------------------------------
-- Notificaciones idempotentes
--   * p_event_key: si viene, solo la transacción que registra el evento
--     notifica (reintentos/concurrencia => 0 duplicados).
--   * p_recipient_ids: si viene, SOLO esas personas reciben (antes se sumaba
--     a todos los miembros y cada "join" espameaba al grupo entero). Si es
--     null, reciben todos los miembros que no rechazaron.
-- ---------------------------------------------------------------------------

drop function if exists public.enqueue_auto_match_notification(bigint,text,text,text,uuid[]);

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
    'auto_match_cancelled'
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
        and m.response <> 'declined'
    ) x
    where x.user_id is not null
  loop
    insert into public.notifications (
      user_id, type, title, message, data, read, partido_id, created_at
    ) values (
      v_recipient, p_type, p_title, p_message, v_payload, false, v_partido_id, now()
    );

    insert into public.notification_delivery_log (
      user_id,
      partido_id,
      notification_type,
      payload_json,
      channel,
      status,
      correlation_id,
      created_at
    ) values (
      v_recipient,
      v_partido_id,
      p_type,
      v_payload,
      'push',
      'queued',
      gen_random_uuid(),
      now()
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vencimientos (lazy sweep): se ejecuta al entrar a cualquier RPC de
-- gestación. Idempotente vía event keys + FOR UPDATE SKIP LOCKED.
-- ---------------------------------------------------------------------------

create or replace function public.expire_stale_auto_match_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
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
      set status = 'expired',
          cancelled_reason = coalesce(cancelled_reason, 'expired'),
          updated_at = now()
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
      set status = 'cancelled',
          cancelled_reason = 'no_organizer',
          updated_at = now()
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

-- ---------------------------------------------------------------------------
-- Backfill de reemplazos: invita disponibilidades compatibles hasta volver a
-- cubrir el cupo. Interno (lo llama respond al procesar un rechazo).
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
  v_added integer := 0;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id;

  if v_proposal.id is null or v_proposal.status not in ('collecting', 'ready') then
    return 0;
  end if;

  select count(*) into v_active
  from public.auto_match_proposal_members m
  where m.proposal_id = v_proposal.id and m.response <> 'declined';

  for v_candidate in
    select a.id as availability_id, a.user_id, a.can_organize
    from public.player_availability a
    where a.status = 'active'
      and v_proposal.format = any(a.formats)
      and extract(isodow from (v_proposal.proposed_starts_at at time zone a.timezone))::smallint = any(a.days_of_week)
      and (v_proposal.proposed_starts_at at time zone a.timezone)::time >= a.time_start
      -- time - time da interval; time + interval envuelve en 24:00
      and a.time_end - (v_proposal.proposed_starts_at at time zone a.timezone)::time >= interval '60 minutes'
      and not exists (
        select 1 from public.auto_match_proposal_members m
        where m.proposal_id = v_proposal.id and m.user_id = a.user_id
      )
    order by a.created_at asc
  loop
    exit when v_active >= v_proposal.max_players;

    if public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposal.proposed_starts_at, v_proposal.id) then
      continue;
    end if;
    if public.user_declined_auto_match_slot(v_candidate.user_id, v_proposal.format, v_proposal.proposed_starts_at) then
      continue;
    end if;

    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response, can_organize
    ) values (
      v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending', v_candidate.can_organize
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

-- ---------------------------------------------------------------------------
-- Resolución de organizador al completarse el cupo (bajo el lock de la fila
-- de la propuesta, así dos aceptaciones simultáneas no eligen dos veces).
-- ---------------------------------------------------------------------------

create or replace function public.resolve_auto_match_full_cupo(p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_volunteer record;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id;

  if v_proposal.id is null then return; end if;

  if v_proposal.organizer_id is null then
    -- Primer voluntario que se ofreció (por responded_at) queda como
    -- organizador; nadie es convertido a la fuerza.
    select m.user_id, u.nombre
    into v_volunteer
    from public.auto_match_proposal_members m
    join public.usuarios u on u.id = m.user_id
    where m.proposal_id = p_proposal_id
      and m.response = 'accepted'
      and m.can_organize
    order by m.responded_at asc nulls last, m.user_id
    limit 1;

    if v_volunteer.user_id is not null then
      update public.auto_match_proposals
      set organizer_id = v_volunteer.user_id,
          organizer_deadline_at = null,
          updated_at = now()
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

    -- Sin voluntario: reserva de organización (regla documentada arriba).
    update public.auto_match_proposals
    set organizer_deadline_at = least(now() + interval '12 hours', expires_at),
        updated_at = now()
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

-- ---------------------------------------------------------------------------
-- Responder: aceptar (con o sin intención de organizar) o rechazar.
-- Rechazar saca SOLO a esa persona, dispara backfill y nunca cancela por sí
-- solo salvo pérdida de masa crítica.
-- ---------------------------------------------------------------------------

drop function if exists public.respond_to_auto_match_proposal(bigint,text);

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
  v_active integer;
  v_threshold integer;
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

  if p_response = 'accepted' then
    select count(*) filter (where response = 'accepted')
    into v_accepted
    from public.auto_match_proposal_members
    where proposal_id = p_proposal_id;

    if v_member.response <> 'accepted' and v_accepted >= v_proposal.max_players then
      raise exception 'proposal_full';
    end if;

    update public.auto_match_proposal_members
    set response = 'accepted',
        -- "Me sumo y puedo organizar" o la intención que ya traía desde su
        -- disponibilidad: nunca se pisa hacia false.
        can_organize = can_organize or coalesce(p_can_organize, false),
        responded_at = coalesce(responded_at, now())
    where proposal_id = p_proposal_id and user_id = auth.uid()
    returning * into v_member;

    select
      count(*) filter (where response = 'accepted'),
      count(*) filter (where response = 'pending')
    into v_accepted, v_pending
    from public.auto_match_proposal_members
    where proposal_id = p_proposal_id;

    if v_accepted >= v_proposal.max_players then
      if v_proposal.status = 'collecting' then
        update public.auto_match_proposals
        set status = 'ready', updated_at = now()
        where id = p_proposal_id and status = 'collecting';
      end if;
      perform public.resolve_auto_match_full_cupo(p_proposal_id);
    elsif v_proposal.max_players - v_accepted <= 2 and v_pending > 0 then
      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_almost_full',
        'Faltan muy pocos',
        format('Faltan %s confirmaciones para completar el partido.', v_proposal.max_players - v_accepted),
        null,
        format('almost_full:%s', v_proposal.max_players - v_accepted),
        null
      );
    end if;

    return v_member;
  end if;

  -- Rechazo: sale solo esta persona.
  update public.auto_match_proposal_members
  set response = 'declined', responded_at = now()
  where proposal_id = p_proposal_id and user_id = auth.uid()
  returning * into v_member;

  update public.auto_match_proposals
  set organizer_id = case when organizer_id = auth.uid() then null else organizer_id end,
      -- Al perder el cupo completo vuelve a juntar gente; la reserva de
      -- organización (si corría) deja de aplicar hasta el próximo cupo lleno.
      status = case when status = 'ready' then 'collecting' else status end,
      organizer_deadline_at = null,
      updated_at = now()
  where id = p_proposal_id;

  perform public.backfill_auto_match_proposal_members(p_proposal_id);

  select count(*) into v_active
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id and response <> 'declined';

  v_threshold := coalesce(v_proposal.gestation_threshold, public.auto_match_threshold(v_proposal.format));

  if v_active < v_threshold then
    -- Causa realmente definitiva: quedó por debajo de la masa crítica que
    -- justificó la gestación y no hubo reemplazos disponibles.
    update public.auto_match_proposals
    set status = 'cancelled',
        cancelled_reason = 'below_threshold',
        updated_at = now()
    where id = p_proposal_id;

    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_cancelled',
      'La propuesta se canceló',
      'Se bajaron varios jugadores y no encontramos reemplazos. Tu disponibilidad sigue activa y Arma2 buscará otra combinación.',
      null,
      'cancelled_below_threshold',
      null
    );
  end if;

  return v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- "Yo lo organizo": el primero que llega gana, bajo lock de la propuesta.
-- ---------------------------------------------------------------------------

create or replace function public.claim_auto_match_organizer(p_proposal_id bigint)
returns public.auto_match_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_member public.auto_match_proposal_members;
  v_nombre text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  perform public.expire_stale_auto_match_proposals();

  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null then raise exception 'proposal_not_found'; end if;
  if v_proposal.status <> 'ready' or v_proposal.expires_at <= now() then
    raise exception 'proposal_not_open';
  end if;
  if v_proposal.organizer_id is not null then
    if v_proposal.organizer_id = auth.uid() then
      return v_proposal;
    end if;
    raise exception 'organizer_already_assigned';
  end if;

  select * into v_member
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id and user_id = auth.uid() and response = 'accepted';

  if v_member.proposal_id is null then raise exception 'proposal_member_not_found'; end if;

  update public.auto_match_proposal_members
  set can_organize = true
  where proposal_id = p_proposal_id and user_id = auth.uid();

  update public.auto_match_proposals
  set organizer_id = auth.uid(),
      organizer_deadline_at = null,
      updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  select nombre into v_nombre from public.usuarios where id = auth.uid();

  perform public.enqueue_auto_match_notification(
    p_proposal_id,
    'auto_match_organizing',
    'Alguien tomó la organización',
    format('%s va a organizar el partido: cancha, hora exacta y precio en camino.', coalesce(nullif(trim(v_nombre), ''), 'Un jugador')),
    null,
    format('organizer_assigned:%s', auth.uid()),
    null
  );

  return v_proposal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Convertir la gestación en partido real. Idempotente: la fila de la
-- propuesta se lockea y, si partido_id ya existe, se devuelve tal cual
-- (doble toque / reintento / concurrencia => siempre el mismo partido).
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

  -- Idempotencia dura ante doble toque / reintentos.
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

  -- El organizador puede ajustar el horario por la cancha conseguida, pero
  -- dentro de +/- 2 h de la ocurrencia gestada: fuera de eso ya no es el
  -- mismo compromiso que confirmaron los jugadores.
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
    match_ref,
    codigo,
    nombre,
    fecha,
    hora,
    sede,
    sede_place_id,
    sede_direccion_normalizada,
    sede_latitud,
    sede_longitud,
    modalidad,
    cupo_jugadores,
    falta_jugadores,
    player_invites_enabled,
    tipo_partido,
    creado_por,
    precio_cancha_por_persona
  ) values (
    v_match_ref,
    v_codigo,
    v_nombre,
    v_fecha,
    v_hora,
    nullif(trim(coalesce(p_sede, '')), ''),
    nullif(trim(coalesce(p_sede_place_id, '')), ''),
    nullif(trim(coalesce(p_sede_direccion, '')), ''),
    p_sede_latitud,
    p_sede_longitud,
    v_proposal.format,
    v_proposal.max_players,
    false,
    false,
    coalesce(nullif(trim(coalesce(p_tipo_partido, '')), ''), 'Masculino'),
    auth.uid(),
    p_precio
  ) returning id into v_partido_id;

  -- Los confirmados de la gestación entran como jugadores del partido, sin
  -- volver a aceptar nada.
  insert into public.jugadores (
    partido_id, match_ref, usuario_id, nombre, avatar_url, score, is_goalkeeper
  )
  select
    v_partido_id,
    v_match_ref,
    m.user_id,
    coalesce(nullif(trim(u.nombre), ''), 'Jugador'),
    u.avatar_url,
    5,
    false
  from public.auto_match_proposal_members m
  join public.usuarios u on u.id = m.user_id
  where m.proposal_id = p_proposal_id
    and m.response = 'accepted'
    and not exists (
      select 1 from public.jugadores j
      where j.partido_id = v_partido_id and j.usuario_id = m.user_id
    );

  update public.auto_match_proposals
  set status = 'created',
      partido_id = v_partido_id,
      updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  perform public.enqueue_auto_match_notification(
    p_proposal_id,
    'auto_match_created',
    '¡Partido confirmado!',
    format('%s ya tiene cancha, fecha y hora. Entrá para ver los detalles.', v_nombre),
    null,
    'created',
    jsonb_build_object(
      'match_id', v_partido_id,
      'partido_id', v_partido_id,
      'route', '/partido-publico/' || v_partido_id
    )
  );

  return v_proposal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roster visible para miembros (sin coordenadas ni datos privados; la
-- ubicación exacta recién existe cuando el organizador publica el partido).
-- ---------------------------------------------------------------------------

create or replace function public.get_auto_match_proposal_members(p_proposal_id bigint)
returns table (
  user_id uuid,
  nombre text,
  avatar_url text,
  response text,
  can_organize boolean,
  is_organizer boolean,
  responded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.user_id,
    u.nombre,
    u.avatar_url,
    m.response,
    m.can_organize,
    (p.organizer_id = m.user_id) as is_organizer,
    m.responded_at
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  join public.usuarios u on u.id = m.user_id
  where m.proposal_id = p_proposal_id
    and exists (
      select 1 from public.auto_match_proposal_members me
      where me.proposal_id = p_proposal_id and me.user_id = auth.uid()
    )
  order by (p.organizer_id = m.user_id) desc,
           case m.response when 'accepted' then 0 when 'pending' then 1 else 2 end,
           m.responded_at asc nulls last,
           m.created_at asc;
$$;

-- ---------------------------------------------------------------------------
-- Listado propio, ahora con organizador, partido y estados finales recientes
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_auto_match_proposals();

create or replace function public.get_my_auto_match_proposals()
returns table (
  id bigint,
  format text,
  proposed_starts_at timestamptz,
  max_players integer,
  status text,
  expires_at timestamptz,
  gestation_started_at timestamptz,
  gestation_threshold integer,
  my_response text,
  my_can_organize boolean,
  member_count integer,
  accepted_count integer,
  pending_count integer,
  declined_count integer,
  missing_count integer,
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
    p.status,
    p.expires_at,
    p.gestation_started_at,
    p.gestation_threshold,
    mine.response as my_response,
    mine.can_organize as my_can_organize,
    count(all_members.user_id) filter (where all_members.response <> 'declined')::integer as member_count,
    count(all_members.user_id) filter (where all_members.response = 'accepted')::integer as accepted_count,
    count(all_members.user_id) filter (where all_members.response = 'pending')::integer as pending_count,
    count(all_members.user_id) filter (where all_members.response = 'declined')::integer as declined_count,
    greatest(0, p.max_players - count(all_members.user_id) filter (where all_members.response = 'accepted'))::integer as missing_count,
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
    and mine.response <> 'declined'
    and (
      (p.status in ('collecting', 'ready') and p.expires_at > now())
      or (p.status = 'created' and p.proposed_starts_at > now() - interval '3 hours')
      or (p.status in ('cancelled', 'expired') and p.updated_at > now() - interval '24 hours')
    )
  group by p.id, mine.response, mine.can_organize, org.nombre
  order by
    case p.status when 'ready' then 0 when 'collecting' then 1 when 'created' then 2 else 3 end,
    p.proposed_starts_at asc;
$$;

-- ---------------------------------------------------------------------------
-- Disponibilidad: nueva opción "Puedo organizar el partido"
-- ---------------------------------------------------------------------------

drop function if exists public.upsert_my_availability(smallint[],time,time,text[],integer,double precision,double precision);

create or replace function public.upsert_my_availability(
  p_days smallint[],
  p_time_start time,
  p_time_end time,
  p_formats text[],
  p_max_distance_km integer default 8,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_can_organize boolean default false
)
returns public.player_availability
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.player_availability;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ array[1,2,3,4,5,6,7]::smallint[]) then raise exception 'invalid_days'; end if;
  if p_time_start is null or p_time_end is null or p_time_end <= p_time_start then raise exception 'invalid_time_window'; end if;
  if p_time_end - p_time_start < interval '60 minutes' then raise exception 'window_too_short'; end if;
  if p_max_distance_km not between 1 and 50 then raise exception 'invalid_distance'; end if;
  if p_latitude is not null and p_latitude not between -90 and 90 then raise exception 'invalid_latitude'; end if;
  if p_longitude is not null and p_longitude not between -180 and 180 then raise exception 'invalid_longitude'; end if;
  if cardinality(p_formats) = 0 or not (p_formats <@ array['F5','F6','F7','F8','F9','F11']::text[]) then raise exception 'invalid_formats'; end if;

  update public.player_availability
  set status = 'cancelled', updated_at = now()
  where user_id = auth.uid() and status = 'active';

  insert into public.player_availability (
    user_id, days_of_week, time_start, time_end, formats, max_distance_km, latitude, longitude, can_organize
  ) values (
    auth.uid(),
    array(select distinct unnest(p_days) order by 1),
    p_time_start,
    p_time_end,
    array(select distinct unnest(p_formats)),
    p_max_distance_km,
    p_latitude,
    p_longitude,
    coalesce(p_can_organize, false)
  ) returning * into v_row;

  perform public.sync_my_auto_match_gestations();
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sync de gestaciones: sweep de vencidos, intención de organizar heredada,
-- locks por bucket de 15 min (3 buckets cubren la ventana de +/-15 min) y
-- backstop ante la constraint de exclusión.
-- ---------------------------------------------------------------------------

create or replace function public.sync_my_auto_match_gestations()
returns table (
  proposal_id bigint,
  action text,
  format text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mine public.player_availability;
  v_format text;
  v_required integer;
  v_threshold integer;
  v_group_mask integer;
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
  v_created boolean;
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

  foreach v_format in array v_mine.formats loop
    v_required := substring(v_format from 2)::integer * 2;
    v_threshold := public.auto_match_threshold(v_format);
    v_created := false;

    -- Sumarse a una gestación compatible existente primero.
    select p.* into v_proposal
    from public.auto_match_proposals p
    where p.status = 'collecting'
      and p.format = v_format
      and p.expires_at > now()
      and extract(isodow from (p.proposed_starts_at at time zone v_mine.timezone))::smallint = any(v_mine.days_of_week)
      and (p.proposed_starts_at at time zone v_mine.timezone)::time >= v_mine.time_start
      -- time - time da interval; time + interval envuelve en 24:00
      and v_mine.time_end - (p.proposed_starts_at at time zone v_mine.timezone)::time >= interval '60 minutes'
      and not public.user_has_overlapping_auto_match(auth.uid(), p.proposed_starts_at, p.id)
      and not public.user_declined_auto_match_slot(auth.uid(), v_format, p.proposed_starts_at)
      and not exists (
        select 1 from public.auto_match_proposal_members m
        where m.proposal_id = p.id and m.user_id = auth.uid()
      )
      and (select count(*) from public.auto_match_proposal_members m where m.proposal_id = p.id and m.response <> 'declined') < p.max_players
    order by p.created_at asc
    limit 1
    for update skip locked;

    if v_proposal.id is not null then
      insert into public.auto_match_proposal_members (
        proposal_id, availability_id, user_id, response, can_organize
      ) values (
        v_proposal.id, v_mine.id, auth.uid(), 'pending', v_mine.can_organize
      ) on conflict do nothing;

      perform public.enqueue_auto_match_notification(
        v_proposal.id,
        'auto_match_gestating',
        'Se está armando un partido',
        format('Se está armando un %s compatible con tus horarios. Entrá para ver el estado.', v_format),
        array[auth.uid()]::uuid[],
        format('joined:%s', auth.uid()),
        null
      );

      proposal_id := v_proposal.id;
      action := 'joined';
      format := v_format;
      return next;
      continue;
    end if;

    -- Armar el mejor grupo compatible alrededor del usuario actual.
    create temporary table if not exists tmp_auto_match_gestation_candidates (
      availability_id bigint,
      user_id uuid,
      days_mask integer,
      overlap_start time,
      overlap_end time,
      distance_km double precision,
      can_organize boolean
    ) on commit drop;
    truncate tmp_auto_match_gestation_candidates;

    insert into tmp_auto_match_gestation_candidates
    select c.availability_id, c.user_id, c.days_mask, c.overlap_start, c.overlap_end, c.distance_km, c.can_organize
    from (
      select
        other.id as availability_id,
        other.user_id as user_id,
        public.availability_days_mask(v_mine.days_of_week) & public.availability_days_mask(other.days_of_week) as days_mask,
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
        and other.days_of_week && v_mine.days_of_week
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
    limit v_required - 1;

    if (select count(*) from tmp_auto_match_gestation_candidates) + 1 < v_threshold then
      continue;
    end if;

    select bit_and(t.days_mask), max(t.overlap_start), min(t.overlap_end)
      into v_group_mask, v_group_start, v_group_end
    from tmp_auto_match_gestation_candidates t;

    if coalesce(v_group_mask, 0) = 0 or v_group_end - v_group_start < interval '60 minutes' then
      continue;
    end if;

    v_local_today := (now() at time zone v_mine.timezone)::date;
    v_proposed := null;
    for v_offset in 0..14 loop
      v_slot_date := v_local_today + v_offset;
      if (v_group_mask & (1 << extract(isodow from v_slot_date)::integer)) <> 0 then
        v_proposed := (v_slot_date + v_group_start) at time zone v_mine.timezone;
        if v_proposed > now() + interval '90 minutes' then exit; end if;
        v_proposed := null;
      end if;
    end loop;

    if v_proposed is null then continue; end if;
    if public.user_has_overlapping_auto_match(auth.uid(), v_proposed, null) then continue; end if;
    if public.user_declined_auto_match_slot(auth.uid(), v_format, v_proposed) then continue; end if;

    -- Serializa a todos los creadores cuyo horario cae a menos de 15 min:
    -- cualquier par dentro de la ventana comparte al menos un bucket.
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
          format,
          proposed_starts_at,
          latitude,
          longitude,
          max_players,
          status,
          created_by,
          expires_at,
          gestation_started_at,
          gestation_threshold
        ) values (
          v_format,
          v_proposed,
          null,
          null,
          v_required,
          'collecting',
          auth.uid(),
          v_expires,
          now(),
          v_threshold
        ) returning * into v_proposal;
        v_created := true;
      exception when exclusion_violation then
        -- Backstop de la constraint: otro proceso ganó el bucket; sumarse a
        -- su propuesta en lugar de fallar.
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
      -- Quien inicia la gestación queda confirmado de entrada.
      insert into public.auto_match_proposal_members (
        proposal_id, availability_id, user_id, response, responded_at, can_organize
      ) values (
        v_proposal.id, v_mine.id, auth.uid(), 'accepted', now(), v_mine.can_organize
      ) on conflict do nothing;
    else
      -- La propuesta ya existía (otro proceso ganó el bucket): se entra como
      -- pendiente, nadie queda confirmado sin tocar "Me sumo". Solo si queda
      -- lugar: el roster nunca supera el cupo del formato.
      if (
        select count(*) from public.auto_match_proposal_members m
        where m.proposal_id = v_proposal.id and m.response <> 'declined'
      ) >= v_proposal.max_players then
        continue;
      end if;

      insert into public.auto_match_proposal_members (
        proposal_id, availability_id, user_id, response, can_organize
      ) values (
        v_proposal.id, v_mine.id, auth.uid(), 'pending', v_mine.can_organize
      ) on conflict do nothing;

      perform public.enqueue_auto_match_notification(
        v_proposal.id,
        'auto_match_gestating',
        'Se está armando un partido',
        format('Se está armando un %s compatible con tus horarios. Entrá para ver el estado.', v_format),
        array[auth.uid()]::uuid[],
        format('joined:%s', auth.uid()),
        null
      );
    end if;

    for v_candidate in
      select * from tmp_auto_match_gestation_candidates
    loop
      exit when (select count(*) from public.auto_match_proposal_members m where m.proposal_id = v_proposal.id and m.response <> 'declined') >= v_required;
      if not public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposed, v_proposal.id)
        and not public.user_declined_auto_match_slot(v_candidate.user_id, v_format, v_proposed) then
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, can_organize
        ) values (
          v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending', v_candidate.can_organize
        ) on conflict do nothing;
      end if;
    end loop;

    select count(*) into v_member_count
    from public.auto_match_proposal_members m
    where m.proposal_id = v_proposal.id and m.response <> 'declined';

    if v_created then
      perform public.enqueue_auto_match_notification(
        v_proposal.id,
        'auto_match_gestating',
        format('Se está armando un %s', v_format),
        format('Ya hay %s de %s jugadores compatibles. Entrá para confirmar si te sumás.', v_member_count, v_required),
        null,
        'gestation_created',
        null
      );
    end if;

    proposal_id := v_proposal.id;
    action := case when v_created then 'created' else 'joined' end;
    format := v_format;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

revoke all on function public.user_declined_auto_match_slot(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.user_has_overlapping_auto_match(uuid,timestamptz,bigint) from public, anon, authenticated;
revoke all on function public.enqueue_auto_match_notification(bigint,text,text,text,uuid[],text,jsonb) from public, anon, authenticated;
revoke all on function public.auto_match_slot_bucket_range(timestamptz) from public, anon;
revoke all on function public.expire_stale_auto_match_proposals() from public, anon, authenticated;
revoke all on function public.backfill_auto_match_proposal_members(bigint) from public, anon, authenticated;
revoke all on function public.resolve_auto_match_full_cupo(bigint) from public, anon, authenticated;

revoke all on function public.sync_my_auto_match_gestations() from public, anon;
revoke all on function public.get_my_auto_match_proposals() from public, anon;
revoke all on function public.get_auto_match_proposal_members(bigint) from public, anon;
revoke all on function public.respond_to_auto_match_proposal(bigint,text,boolean) from public, anon;
revoke all on function public.claim_auto_match_organizer(bigint) from public, anon;
revoke all on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) from public, anon;
revoke all on function public.upsert_my_availability(smallint[],time,time,text[],integer,double precision,double precision,boolean) from public, anon;

grant execute on function public.sync_my_auto_match_gestations() to authenticated;
grant execute on function public.get_my_auto_match_proposals() to authenticated;
grant execute on function public.get_auto_match_proposal_members(bigint) to authenticated;
grant execute on function public.respond_to_auto_match_proposal(bigint,text,boolean) to authenticated;
grant execute on function public.claim_auto_match_organizer(bigint) to authenticated;
grant execute on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) to authenticated;
grant execute on function public.upsert_my_availability(smallint[],time,time,text[],integer,double precision,double precision,boolean) to authenticated;

commit;
