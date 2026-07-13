begin;

-- ============================================================================
-- Gestación automática: plantel final acotado (titulares + 4 suplentes), lista
-- de espera para los confirmados excedentes, promoción de suplente a titular con
-- aviso, invitación diferenciada titular/suplente y varias gestaciones sin
-- throttle por formato.
--
-- Incremental sobre 20260712220000 y 20260712230000 (ambas aplicadas a prod).
-- Solo CREATE OR REPLACE + funciones/trigger nuevos + una columna de estado. No
-- edita ninguna migración previa.
--
--  §3  DOS capacidades distintas, centralizadas:
--        invitation_capacity   = ceil(required * 1.5)   (ya existía)
--        final_roster_capacity = required + 4           (nueva, un solo lugar)
--      Al materializar entran SOLO los primeros required titulares + 4 suplentes
--      por confirmed_at; los confirmados que exceden quedan 'waitlisted' (no
--      entran al partido ni a su chat, no se marcan como rechazados, siguen
--      disponibles para otras gestaciones) y reciben "El plantel se completó".
--
--  §5  Cuando un titular se baja del partido real, el primer suplente confirmado
--      asciende posicionalmente (jugadores se ordena por created_at asc). Un
--      trigger AFTER DELETE detecta la promoción por CUALQUIER camino de baja y
--      notifica al promovido y al organizador (idempotente por partido+usuario).
--
--  §6  Se distingue una VACANTE DE TITULAR ("hay un lugar, ¿te sumás?") de una
--      invitación de SUPLENTE ("los titulares están completos, ¿de suplente?"):
--      distinto tipo, título, mensaje, CTA (slot_kind) y deep link.
--
--  §4  El sync deja de limitar "una sala nueva por formato por corrida": una
--      sola activación con disponibilidad amplia gesta TODOS los días elegibles
--      de una vez (la dedup por bucket/slot sigue evitando salas equivalentes).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. final_roster_capacity centralizado (un solo lugar para el "+4").
-- ---------------------------------------------------------------------------

create or replace function public.auto_match_max_substitutes()
returns integer
language sql
immutable
as $$
  select 4;
$$;

create or replace function public.auto_match_final_roster_capacity(p_format text)
returns integer
language sql
immutable
as $$
  select public.auto_match_required_players(p_format) + public.auto_match_max_substitutes();
$$;

revoke all on function public.auto_match_max_substitutes() from public, anon;
revoke all on function public.auto_match_final_roster_capacity(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Estado 'waitlisted' (confirmó pero el plantel se completó). Distinto de
--    'declined' (rechazó) y 'expired' (venció): no bloquea otras gestaciones,
--    pero no accede al partido ni a su chat.
-- ---------------------------------------------------------------------------

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
    check (response in ('pending', 'accepted', 'declined', 'expired', 'waitlisted'));
end;
$$;

-- La membresía viva para el chat de la gestación excluye también 'waitlisted'.
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
      and m.response not in ('declined', 'expired', 'waitlisted')
  );
$$;

revoke all on function public.auto_match_user_in_proposal(bigint, uuid) from public, anon;
grant execute on function public.auto_match_user_in_proposal(bigint, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Notificaciones: tipos nuevos (lista de espera, vacante de titular,
--    promoción) + 'waitlisted' no recibe los avisos de difusión de la sala.
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
    'auto_match_vacancy_reopened',
    'auto_match_waitlisted',
    'auto_match_starter_invite',
    'auto_match_promoted'
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
        and m.response not in ('declined', 'expired', 'waitlisted')
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
-- 4. Materialización (§3/§10): plantel acotado a required + 4. Los confirmados
--    excedentes quedan 'waitlisted'; los pendientes reciben invitación de
--    suplente solo si queda banco libre, si no van a lista de espera.
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
  v_final_cap integer;
  v_roster_count integer;
  v_waitlist uuid[];
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
  v_final_cap := public.auto_match_final_roster_capacity(v_proposal.format);

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

  -- Entran SOLO los primeros required + 4 confirmados por confirmed_at. El
  -- created_at se desplaza 1 ms por asiento para que el modelo posicional del
  -- partido (titulares = primeros cupo por created_at asc) sea determinista y
  -- respete el orden de confirmación aún con timestamps iguales.
  insert into public.jugadores (
    partido_id, match_ref, usuario_id, nombre, avatar_url, score, is_goalkeeper, created_at
  )
  select
    v_partido_id, v_match_ref, ordered.user_id,
    coalesce(nullif(trim(ordered.nombre), ''), 'Jugador'), ordered.avatar_url, 5, false,
    now() + make_interval(secs => (ordered.rn - 1) * 0.001)
  from (
    select
      m.user_id, u.nombre, u.avatar_url,
      row_number() over (order by m.confirmed_at asc nulls last, m.user_id) as rn
    from public.auto_match_proposal_members m
    join public.usuarios u on u.id = m.user_id
    where m.proposal_id = p_proposal_id and m.response = 'accepted'
  ) ordered
  where ordered.rn <= v_final_cap
    and not exists (
      select 1 from public.jugadores j
      where j.partido_id = v_partido_id and j.usuario_id = ordered.user_id
    );

  -- Confirmados excedentes (rn > final_cap): lista de espera. No entran, no se
  -- marcan como rechazados, siguen disponibles para otras combinaciones.
  select array_agg(r.user_id order by r.rn) into v_waitlist
  from (
    select m.user_id, row_number() over (order by m.confirmed_at asc nulls last, m.user_id) as rn
    from public.auto_match_proposal_members m
    where m.proposal_id = p_proposal_id and m.response = 'accepted'
  ) r
  where r.rn > v_final_cap;

  if v_waitlist is not null and array_length(v_waitlist, 1) > 0 then
    update public.auto_match_proposal_members
    set response = 'waitlisted', responded_at = now()
    where proposal_id = p_proposal_id and user_id = any(v_waitlist);
  end if;

  update public.auto_match_proposals
  set status = 'created', partido_id = v_partido_id, updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;

  -- El aviso de "partido confirmado" va SOLO al plantel real (los que quedaron
  -- 'accepted' tras mover a los excedentes a lista de espera).
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

  if v_waitlist is not null and array_length(v_waitlist, 1) > 0 then
    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_waitlisted',
      'El plantel se completó',
      'El partido se cerró con los primeros confirmados. Quedaste en lista de espera; tu disponibilidad sigue activa para otras combinaciones.',
      v_waitlist,
      'waitlisted_finalize',
      jsonb_build_object('route', '/quiero-jugar?auto=1')
    );
  end if;

  select count(*) into v_roster_count
  from public.jugadores where partido_id = v_partido_id;

  -- Pendientes: si queda banco libre (< final_cap) reciben invitación de
  -- SUPLENTE (los titulares ya están completos); si el plantel ya está lleno,
  -- van a lista de espera con el mismo aviso discreto.
  select array_agg(m.user_id) into v_pending
  from public.auto_match_proposal_members m
  where m.proposal_id = p_proposal_id and m.response = 'pending';

  if v_pending is not null and array_length(v_pending, 1) > 0 then
    if v_roster_count < v_final_cap then
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
        jsonb_build_object(
          'partido_id', v_partido_id,
          'route', '/quiero-jugar?auto=1&invite=' || p_proposal_id,
          'slot_kind', 'suplente'
        )
      );
    else
      update public.auto_match_proposal_members
      set response = 'waitlisted', responded_at = now()
      where proposal_id = p_proposal_id and response = 'pending';

      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_waitlisted',
        'El plantel se completó',
        'El partido se cerró con el banco lleno. Quedaste en lista de espera; tu disponibilidad sigue activa.',
        v_pending,
        'waitlisted_pending',
        jsonb_build_object('route', '/quiero-jugar?auto=1')
      );
    end if;
  end if;

  return v_proposal;
end;
$$;

revoke all on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) from public, anon;
grant execute on function public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Aceptar la invitación (titular o suplente) sobre un partido creado. El
--    tope es final_roster_capacity centralizado; idempotente; atómico.
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

  select * into v_partido from public.partidos where id = v_proposal.partido_id for update;
  if v_partido.id is null then raise exception 'match_not_found'; end if;

  v_kickoff := public.partido_kickoff_at(v_partido.fecha, v_partido.hora);
  if v_kickoff is not null and v_kickoff <= now() then
    raise exception 'match_already_started';
  end if;

  -- Tope del plantel real: titulares + hasta 4 suplentes (centralizado).
  select count(*) into v_count from public.jugadores where partido_id = v_partido.id;
  if v_count >= public.auto_match_final_roster_capacity(v_proposal.format) then
    raise exception 'match_roster_full';
  end if;

  -- Entra al final por created_at: si hay vacante de titular (jugadores < cupo)
  -- el modelo posicional lo ubica como titular; si no, como suplente.
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
    'Se sumó un jugador',
    format('%s se sumó al partido.', coalesce((select nombre from public.usuarios where id = auth.uid()), 'Un jugador')),
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
-- 6. Invitar a cubrir un lugar de un partido creado (§6/§12): primero la LISTA
--    DE ESPERA (confirmados excedentes) por orden de confirmación, luego
--    compatibles nuevos. Diferencia vacante de titular vs banco de suplente.
-- ---------------------------------------------------------------------------

drop function if exists public.invite_auto_match_substitutes(bigint, integer);

create or replace function public.invite_auto_match_substitutes(
  p_proposal_id bigint,
  p_needed integer,
  p_allow_new boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_partido public.partidos;
  v_cupo integer;
  v_jugadores integer;
  v_final_cap integer;
  v_slot_kind text;
  v_type text;
  v_title text;
  v_msg text;
  v_route text;
  v_candidate record;
  v_added integer := 0;
begin
  if p_needed is null or p_needed <= 0 then return 0; end if;

  select * into v_proposal from public.auto_match_proposals where id = p_proposal_id;
  if v_proposal.id is null or v_proposal.status <> 'created' or v_proposal.partido_id is null then
    return 0;
  end if;

  select * into v_partido from public.partidos where id = v_proposal.partido_id;
  v_cupo := coalesce(v_partido.cupo_jugadores, v_proposal.max_players);
  v_final_cap := public.auto_match_final_roster_capacity(v_proposal.format);

  select count(*) into v_jugadores from public.jugadores where partido_id = v_proposal.partido_id;
  -- No superar nunca el plantel máximo (titulares + 4 suplentes).
  p_needed := least(p_needed, v_final_cap - v_jugadores);
  if p_needed <= 0 then return 0; end if;

  if v_jugadores < v_cupo then
    v_slot_kind := 'titular';
    v_type := 'auto_match_starter_invite';
    v_title := 'Hay un lugar en el partido';
    v_msg := format('Hay un lugar disponible en un %s ya confirmado. ¿Querés sumarte al partido?', v_proposal.format);
  else
    v_slot_kind := 'suplente';
    v_type := 'auto_match_substitute_invite';
    v_title := 'Se abrió un lugar de suplente';
    v_msg := format('Los titulares ya están completos. ¿Querés sumarte como suplente a un %s ya confirmado?', v_proposal.format);
  end if;
  v_route := '/quiero-jugar?auto=1&invite=' || v_proposal.id;

  -- (a) Prioridad: lista de espera (confirmaron y quedaron afuera), por orden.
  for v_candidate in
    select m.user_id
    from public.auto_match_proposal_members m
    where m.proposal_id = v_proposal.id
      and m.response = 'waitlisted'
      and not exists (
        select 1 from public.jugadores j
        where j.partido_id = v_proposal.partido_id and j.usuario_id = m.user_id
      )
    order by m.confirmed_at asc nulls last, m.user_id
  loop
    exit when v_added >= p_needed;
    update public.auto_match_proposal_members
    set response = 'pending', responded_at = null, confirmed_at = null,
        invite_expires_at = public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
    where proposal_id = v_proposal.id and user_id = v_candidate.user_id and response = 'waitlisted';
    if found then
      v_added := v_added + 1;
      perform public.enqueue_auto_match_notification(
        v_proposal.id, v_type, v_title, v_msg,
        array[v_candidate.user_id]::uuid[],
        format('roster_invite:%s:%s:%s', v_slot_kind, v_proposal.partido_id, v_candidate.user_id),
        jsonb_build_object('partido_id', v_proposal.partido_id, 'route', v_route, 'slot_kind', v_slot_kind)
      );
    end if;
  end loop;

  -- (b) Luego, compatibles nuevos disponibles (solo si se permite ampliar).
  if p_allow_new then
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
          v_proposal.id, v_type, v_title, v_msg,
          array[v_candidate.user_id]::uuid[],
          format('roster_invite:%s:%s:%s', v_slot_kind, v_proposal.partido_id, v_candidate.user_id),
          jsonb_build_object('partido_id', v_proposal.partido_id, 'route', v_route, 'slot_kind', v_slot_kind)
        );
      end if;
    end loop;
  end if;

  return v_added;
end;
$$;

revoke all on function public.invite_auto_match_substitutes(bigint, integer, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reapertura de vacantes (§12): partido creado, futuro, con lugares libres y
--    sin convocados pendientes => reoferta a la lista de espera y, si es vacante
--    de titular, además a compatibles nuevos. Nunca supera titulares + 4.
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
  v_waitlisted integer;
  v_final_cap integer;
  v_needed integer;
  v_added integer;
begin
  for v_row in
    select p.id, p.partido_id, p.organizer_id, p.format, pa.cupo_jugadores
    from public.auto_match_proposals p
    join public.partidos pa on pa.id = p.partido_id
    where p.status = 'created'
      and p.partido_id is not null
      and coalesce(pa.estado, '') not in ('deleted', 'cancelado', 'cancelled')
      and public.partido_kickoff_at(pa.fecha, pa.hora) is not null
      and public.partido_kickoff_at(pa.fecha, pa.hora) > now()
    for update skip locked
  loop
    v_final_cap := public.auto_match_final_roster_capacity(v_row.format);
    select count(*) into v_jugadores from public.jugadores where partido_id = v_row.partido_id;

    -- Plantel completo: nada que reabrir.
    if v_jugadores >= v_final_cap then continue; end if;

    -- Todavía hay convocados pendientes que podrían aceptar: no reabrir aún.
    select count(*) into v_pending
    from public.auto_match_proposal_members m
    where m.proposal_id = v_row.id and m.response = 'pending';
    if v_pending > 0 then continue; end if;

    select count(*) into v_waitlisted
    from public.auto_match_proposal_members m
    where m.proposal_id = v_row.id and m.response = 'waitlisted';

    if v_jugadores < coalesce(v_row.cupo_jugadores, 0) then
      -- Vacante de titular: reoferta lista de espera y, si falta, compatibles.
      v_needed := least(coalesce(v_row.cupo_jugadores, 0) - v_jugadores + 2, v_final_cap - v_jugadores);
      v_added := public.invite_auto_match_substitutes(v_row.id, v_needed, true);
    elsif v_waitlisted > 0 then
      -- Banco de suplente incompleto: solo reoferta a la lista de espera.
      v_added := public.invite_auto_match_substitutes(v_row.id, v_final_cap - v_jugadores, false);
    else
      v_added := 0;
    end if;

    if v_added > 0 then
      perform public.enqueue_auto_match_notification(
        v_row.id,
        'auto_match_vacancy_reopened',
        'Se reabrió la búsqueda',
        'Se liberó un lugar y estamos buscando quién lo cubra en tu partido.',
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
-- 8. Promoción de suplente a titular (§5). Trigger AFTER DELETE sobre jugadores:
--    cubre CUALQUIER camino de baja (admin, autobaja, limpieza). Solo actúa en
--    partidos originados en gestación automática, futuros y vivos. Idempotente.
-- ---------------------------------------------------------------------------

create or replace function public.auto_match_notify_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partido public.partidos;
  v_proposal public.auto_match_proposals;
  v_cupo integer;
  v_kickoff timestamptz;
  v_promoted record;
begin
  -- El partido pudo borrarse en cascada: si ya no existe, no hay promoción.
  select * into v_partido from public.partidos where id = OLD.partido_id;
  if v_partido.id is null then return null; end if;
  if coalesce(v_partido.estado, '') in ('deleted', 'cancelado', 'cancelled') then return null; end if;
  if v_partido.deleted_at is not null then return null; end if;

  v_kickoff := public.partido_kickoff_at(v_partido.fecha, v_partido.hora);
  if v_kickoff is null or v_kickoff <= now() then return null; end if;

  select * into v_proposal from public.auto_match_proposals where partido_id = v_partido.id;
  if v_proposal.id is null then return null; end if;

  v_cupo := coalesce(v_partido.cupo_jugadores, 0);
  if v_cupo <= 0 then return null; end if;

  -- El jugador que AHORA ocupa el asiento cupo (1-indexed por created_at asc).
  select j.usuario_id, j.nombre, j.created_at
  into v_promoted
  from public.jugadores j
  where j.partido_id = v_partido.id
  order by j.created_at asc, j.id asc
  offset (v_cupo - 1) limit 1;

  -- Sin jugador en el asiento cupo: no hubo suplente que ascienda (la baja solo
  -- dejó una vacante de titular; la reapertura la cubre por otra vía).
  if v_promoted.usuario_id is null then return null; end if;

  -- Hubo promoción solo si el borrado estaba DELANTE del nuevo titular #cupo
  -- (era titular). Si estaba detrás (era suplente), el asiento cupo no cambió.
  if OLD.created_at >= v_promoted.created_at then return null; end if;

  perform public.enqueue_auto_match_notification(
    v_proposal.id,
    'auto_match_promoted',
    'Pasaste a titular',
    format('Se liberó un lugar y pasaste a ser titular en %s.', coalesce(nullif(trim(v_partido.nombre), ''), 'tu partido')),
    array[v_promoted.usuario_id]::uuid[],
    format('promoted:%s:%s', v_partido.id, v_promoted.usuario_id),
    jsonb_build_object('partido_id', v_partido.id, 'route', '/partido-publico/' || v_partido.id)
  );

  if v_proposal.organizer_id is not null and v_proposal.organizer_id <> v_promoted.usuario_id then
    perform public.enqueue_auto_match_notification(
      v_proposal.id,
      'auto_match_promoted',
      'Un suplente pasó a titular',
      format('%s pasó a ser titular en %s tras liberarse un lugar.',
             coalesce(nullif(trim(v_promoted.nombre), ''), 'Un jugador'),
             coalesce(nullif(trim(v_partido.nombre), ''), 'el partido')),
      array[v_proposal.organizer_id]::uuid[],
      format('promoted_org:%s:%s', v_partido.id, v_promoted.usuario_id),
      jsonb_build_object('partido_id', v_partido.id, 'route', '/partido-publico/' || v_partido.id)
    );
  end if;

  return null;
end;
$$;

revoke all on function public.auto_match_notify_promotion() from public, anon, authenticated;

drop trigger if exists auto_match_promotion_after_delete on public.jugadores;
create trigger auto_match_promotion_after_delete
  after delete on public.jugadores
  for each row
  execute function public.auto_match_notify_promotion();

-- ---------------------------------------------------------------------------
-- 9. Sweep programado: agrega la reapertura de vacantes (ya estaba) y mantiene
--    el resto. Se redefine para no depender del orden de migraciones.
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

  for v_row in
    select p.id
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready')
      and p.expires_at > now()
      and (
        select count(*) from public.auto_match_proposal_members m
        where m.proposal_id = p.id and m.response not in ('declined', 'expired', 'waitlisted')
      ) < public.auto_match_invitation_capacity(p.format)
    for update skip locked
  loop
    perform public.backfill_auto_match_proposal_members(v_row.id);
  end loop;

  perform public.reopen_auto_match_vacancies();
end;
$$;

revoke all on function public.auto_match_scheduled_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Sync (§4): SIN throttle por formato. Una activación con disponibilidad
--     amplia gesta todos los días elegibles de una sola corrida. La dedup por
--     bucket/slot (locks + ventana de 900 s) sigue evitando salas equivalentes.
--     Copia de sync_my_auto_match_gestations (20260712220000) sin el guard
--     v_created_this_format.
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

    -- Cada día elegible por separado: una disponibilidad sáb+dom gesta una
    -- propuesta el sábado Y otra el domingo, y toda combinación de formato/día
    -- en una sola corrida (sin límite artificial por formato).
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
          where m.proposal_id = p.id and m.response not in ('declined', 'expired', 'waitlisted')
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
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, responded_at, confirmed_at, can_organize
        ) values (
          v_proposal.id, v_mine.id, auth.uid(), 'accepted', now(), now(), v_mine.can_organize
        ) on conflict do nothing;
      else
        if (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired', 'waitlisted')
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

      for v_candidate in select * from tmp_auto_match_gestation_candidates loop
        exit when (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired', 'waitlisted')
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
      where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired', 'waitlisted');

      if v_created then
        perform public.enqueue_auto_match_notification(
          v_proposal.id, 'auto_match_gestating',
          format('Se está armando un %s', v_format),
          format('Ya hay %s de %s jugadores compatibles. Entrá para confirmar si te sumás.', v_member_count, v_required),
          null, 'gestation_created', null
        );
      end if;

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
-- 11. Listado propio: excluye 'waitlisted' (no deja card de "gestación") y
--     expone roster_slot_kind para la invitación de un partido ya creado.
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_auto_match_proposals();

create or replace function public.get_my_auto_match_proposals()
returns table (
  id bigint,
  format text,
  proposed_starts_at timestamptz,
  max_players integer,
  invitation_capacity integer,
  final_roster_capacity integer,
  status text,
  expires_at timestamptz,
  gestation_started_at timestamptz,
  gestation_threshold integer,
  my_response text,
  my_can_organize boolean,
  my_seat text,
  my_invite_expires_at timestamptz,
  roster_slot_kind text,
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
    public.auto_match_final_roster_capacity(p.format) as final_roster_capacity,
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
    case
      when p.status = 'created' and p.partido_id is not null and mine.response = 'pending' then
        case when (
          select count(*) from public.jugadores j where j.partido_id = p.partido_id
        ) < p.max_players then 'titular' else 'suplente' end
      else null
    end as roster_slot_kind,
    count(all_members.user_id) filter (where all_members.response not in ('declined', 'expired', 'waitlisted'))::integer as member_count,
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
    and mine.response not in ('declined', 'expired', 'waitlisted')
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

commit;
