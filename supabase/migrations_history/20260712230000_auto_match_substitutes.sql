begin;

-- ============================================================================
-- Gestación automática: convocados pendientes al materializar + reapertura de
-- vacantes del partido ya creado (spec §10 y §12).
--
-- Incremental sobre 20260712220000 (ya aplicada); solo CREATE OR REPLACE + una
-- RPC nueva. Reutiliza el modelo posicional de suplentes del partido real:
-- jugadores se ordena por created_at asc (getJugadoresDelPartido), así los
-- primeros `cupo_jugadores` son titulares y el resto suplentes; un jugador
-- insertado después queda suplente y la auto-promoción posicional del partido
-- cubre las bajas de titulares.
--
--  §10  Cuando se materializa el partido, los CONFIRMADOS entran como jugadores
--       (titulares/suplentes por orden), pero los PENDIENTES no se vuelven
--       suplentes automáticos: reciben "los titulares ya están completos,
--       ¿querés sumarte como suplente?" y recién al aceptar entran al partido.
--
--  §12  Si tras materializar el partido se abre una vacante de titular y no
--       quedan suplentes ni convocados pendientes, se reabre la búsqueda:
--       Arma2 invita compatibles disponibles como suplentes (mismo mecanismo).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Notificaciones: nuevos tipos de suplente/vacante.
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
    'auto_match_invite_expired',
    'auto_match_substitute_invite',
    'auto_match_substitute_joined',
    'auto_match_vacancy_reopened'
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
-- 2. Materialización (§10): igual que 20260712220000, pero al final NO deja a
--    los pendientes afuera en silencio: les manda la invitación de suplente.
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
  v_pending uuid[];
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
    array(
      select m.user_id from public.auto_match_proposal_members m
      where m.proposal_id = p_proposal_id and m.response = 'accepted'
    ),
    'created',
    jsonb_build_object('match_id', v_partido_id, 'partido_id', v_partido_id, 'route', '/partido-publico/' || v_partido_id)
  );

  -- §10: los pendientes NO entran como suplentes automáticos. Se les refresca la
  -- fecha límite y reciben una invitación clara para sumarse como suplente; solo
  -- al aceptar entran al partido. Los declinados/vencidos no reciben nada.
  select array_agg(m.user_id) into v_pending
  from public.auto_match_proposal_members m
  where m.proposal_id = p_proposal_id and m.response = 'pending';

  if v_pending is not null and array_length(v_pending, 1) > 0 then
    update public.auto_match_proposal_members
    set invite_expires_at = public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
    where proposal_id = p_proposal_id and response = 'pending';

    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_substitute_invite',
      'Los titulares ya están completos',
      '¿Querés sumarte como suplente? Entrá para confirmar tu lugar.',
      v_pending,
      'substitute_invite',
      jsonb_build_object('partido_id', v_partido_id, 'route', '/quiero-jugar?auto=1&proposal=' || p_proposal_id)
    );
  end if;

  return v_proposal;
end;
$$;

revoke all on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) from public, anon;
grant execute on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Aceptar/rechazar la invitación de suplente sobre un partido ya creado.
-- ---------------------------------------------------------------------------

create or replace function public.respond_to_auto_match_substitute(
  p_proposal_id bigint,
  p_response text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_member public.auto_match_proposal_members;
  v_partido public.partidos;
  v_count integer;
  v_kickoff timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_response not in ('accepted', 'declined') then raise exception 'invalid_response'; end if;

  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null then raise exception 'proposal_not_found'; end if;
  if v_proposal.status <> 'created' or v_proposal.partido_id is null then
    raise exception 'proposal_not_materialized';
  end if;

  select * into v_member
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id and user_id = auth.uid();

  if v_member.proposal_id is null then raise exception 'proposal_member_not_found'; end if;
  -- Idempotente: si ya aceptó (ya es jugador), devuelve el partido.
  if v_member.response = 'accepted' then
    return v_proposal.partido_id;
  end if;
  if v_member.response <> 'pending' then raise exception 'substitute_invite_closed'; end if;

  if p_response = 'declined' then
    update public.auto_match_proposal_members
    set response = 'declined', responded_at = now()
    where proposal_id = p_proposal_id and user_id = auth.uid();
    return null;
  end if;

  select * into v_partido from public.partidos where id = v_proposal.partido_id;
  if v_partido.id is null then raise exception 'match_not_found'; end if;

  v_kickoff := public.partido_kickoff_at(v_partido.fecha, v_partido.hora);
  if v_kickoff is not null and v_kickoff <= now() then
    raise exception 'match_already_started';
  end if;

  -- Respeta el banco del partido real: titulares + hasta 4 suplentes
  -- (useAdminPanelState: maxRosterSlots = cupo_jugadores + 4).
  select count(*) into v_count from public.jugadores where partido_id = v_partido.id;
  if v_count >= coalesce(v_partido.cupo_jugadores, 0) + 4 then
    raise exception 'match_roster_full';
  end if;

  -- Entra como suplente: created_at = now() lo posiciona detrás de los
  -- titulares (jugadores se ordena por created_at asc).
  insert into public.jugadores (partido_id, match_ref, usuario_id, nombre, avatar_url, score, is_goalkeeper)
  select v_partido.id, v_partido.match_ref, u.id,
         coalesce(nullif(trim(u.nombre), ''), 'Jugador'), u.avatar_url, 5, false
  from public.usuarios u
  where u.id = auth.uid()
    and not exists (
      select 1 from public.jugadores j where j.partido_id = v_partido.id and j.usuario_id = auth.uid()
    );

  update public.auto_match_proposal_members
  set response = 'accepted', confirmed_at = now(), responded_at = now()
  where proposal_id = p_proposal_id and user_id = auth.uid();

  perform public.enqueue_auto_match_notification(
    p_proposal_id,
    'auto_match_substitute_joined',
    'Se sumó un suplente',
    format('%s se sumó como suplente al partido.', coalesce((select nombre from public.usuarios where id = auth.uid()), 'Un jugador')),
    array[v_proposal.organizer_id]::uuid[],
    format('substitute_joined:%s', auth.uid()),
    jsonb_build_object('partido_id', v_partido.id, 'route', '/partido-publico/' || v_partido.id)
  );

  return v_partido.id;
end;
$$;

revoke all on function public.respond_to_auto_match_substitute(bigint, text) from public, anon;
grant execute on function public.respond_to_auto_match_substitute(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Invitar compatibles nuevos como suplentes de un partido creado (§12).
-- ---------------------------------------------------------------------------

create or replace function public.invite_auto_match_substitutes(
  p_proposal_id bigint,
  p_needed integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_added integer := 0;
begin
  if p_needed is null or p_needed <= 0 then return 0; end if;

  select * into v_proposal from public.auto_match_proposals where id = p_proposal_id;
  if v_proposal.id is null or v_proposal.status <> 'created' or v_proposal.partido_id is null then
    return 0;
  end if;

  for v_candidate in
    select a.id as availability_id, a.user_id
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
      and not exists (
        select 1 from public.jugadores j
        where j.partido_id = v_proposal.partido_id and j.usuario_id = a.user_id
      )
    order by a.created_at asc
  loop
    exit when v_added >= p_needed;
    if public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposal.proposed_starts_at, v_proposal.id) then
      continue;
    end if;
    if public.user_declined_auto_match_slot(v_candidate.user_id, v_proposal.format, v_proposal.proposed_starts_at) then
      continue;
    end if;

    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response, invite_expires_at
    ) values (
      v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending',
      public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
    ) on conflict do nothing;

    if found then
      v_added := v_added + 1;
      perform public.enqueue_auto_match_notification(
        v_proposal.id,
        'auto_match_substitute_invite',
        'Se abrió un lugar de suplente',
        format('Se liberó un lugar en un %s ya confirmado. ¿Te sumás como suplente?', v_proposal.format),
        array[v_candidate.user_id]::uuid[],
        format('substitute_reopen:%s', v_candidate.user_id),
        jsonb_build_object('partido_id', v_proposal.partido_id, 'route', '/quiero-jugar?auto=1&proposal=' || v_proposal.id)
      );
    end if;
  end loop;

  return v_added;
end;
$$;

revoke all on function public.invite_auto_match_substitutes(bigint, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reapertura de vacantes (§12): partido creado, en el futuro, con menos
--    jugadores que el cupo (bajó un titular y no hay suplentes) y sin
--    convocados pendientes => invita compatibles nuevos como suplentes.
-- ---------------------------------------------------------------------------

create or replace function public.reopen_auto_match_vacancies()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_jugadores integer;
  v_pending integer;
  v_needed integer;
  v_added integer;
begin
  for v_row in
    select p.id, p.partido_id, p.organizer_id, pa.cupo_jugadores
    from public.auto_match_proposals p
    join public.partidos pa on pa.id = p.partido_id
    where p.status = 'created'
      and p.partido_id is not null
      and coalesce(pa.estado, '') not in ('deleted', 'cancelado', 'cancelled')
      and public.partido_kickoff_at(pa.fecha, pa.hora) is not null
      and public.partido_kickoff_at(pa.fecha, pa.hora) > now()
    for update skip locked
  loop
    select count(*) into v_jugadores from public.jugadores where partido_id = v_row.partido_id;
    -- Sin vacante de titular (o hay suplentes que la auto-promoción cubre).
    if v_jugadores >= coalesce(v_row.cupo_jugadores, 0) then continue; end if;

    -- Todavía hay convocados pendientes que podrían aceptar: no reabrir aún.
    select count(*) into v_pending
    from public.auto_match_proposal_members m
    where m.proposal_id = v_row.id and m.response = 'pending';
    if v_pending > 0 then continue; end if;

    v_needed := coalesce(v_row.cupo_jugadores, 0) - v_jugadores + 2;
    v_added := public.invite_auto_match_substitutes(v_row.id, v_needed);

    if v_added > 0 then
      perform public.enqueue_auto_match_notification(
        v_row.id,
        'auto_match_vacancy_reopened',
        'Se reabrió la búsqueda',
        'Se liberó un lugar y estamos buscando un suplente para tu partido.',
        array[v_row.organizer_id]::uuid[],
        format('vacancy_reopened:%s:%s', v_row.partido_id, (extract(epoch from now())::bigint / 3600)),
        jsonb_build_object('partido_id', v_row.partido_id, 'route', '/partido-publico/' || v_row.partido_id)
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.reopen_auto_match_vacancies() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Barridos: el vencimiento individual también cubre las invitaciones de
--    suplente (propuestas 'created'); el sweep programado reabre vacantes.
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
    select m.proposal_id, m.user_id, p.status
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.response = 'pending'
      and m.invite_expires_at is not null
      and m.invite_expires_at <= now()
      and p.status in ('collecting', 'ready', 'created')
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
      -- Gestación viva: libera capacidad y busca reemplazo. Un partido ya
      -- creado no necesita recálculo acá (la reapertura corre en el sweep).
      if v_row.status in ('collecting', 'ready') then
        perform public.process_auto_match_member_exit(v_row.proposal_id);
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_auto_match_invites() from public, anon, authenticated;

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

  -- Reintento de reemplazos en gestaciones activas por debajo de la capacidad.
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

  -- Reapertura de vacantes de partidos ya materializados (§12).
  perform public.reopen_auto_match_vacancies();
end;
$$;

revoke all on function public.auto_match_scheduled_sweep() from public, anon, authenticated;

commit;
