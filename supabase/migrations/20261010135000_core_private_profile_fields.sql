-- Core: other accounts can no longer read a user's email, phone, birth date or exact
-- location — and the installed apps (1.1.21, select('*') on usuarios) keep working.
--
-- public.usuarios was readable by any signed-in account (usuarios_select_authenticated
-- USING true), and so were email, telefono, fecha_nacimiento, latitud/longitud and
-- location_accuracy_m of everyone (also profiles.telefono). Revoking those columns (the old
-- "phase B") breaks every installed app that reads the profile with select('*').
-- Instead the VALUES leave the shared row and the columns stay:
--   * app_private.usuarios_private holds them (no API grants);
--   * public.usuarios keeps every column: email, telefono, fecha_nacimiento and
--     location_accuracy_m are NULL for every row, latitud/longitud hold the same ~1 km
--     approximation get_usuarios_approx_location already serves;
--   * a BEFORE INSERT/UPDATE trigger moves whatever an app (old or new) or the server writes
--     into those columns to the private table and leaves the shared row masked, so upserts,
--     RETURNING, realtime payloads and embeddings keep their shape and never carry them;
--     a NULL/blank value means "not provided" (an old app re-saving a form it read masked
--     never wipes the stored value); clearing is clear_my_profile_fields();
--   * profiles.telefono is handled the same way;
--   * the owner reads the full row through get_my_profile(); the server functions that need
--     the real values read the private table.
-- Not covered here: rosters (jugadores) and partidos.codigo (separate migration).

create table if not exists app_private.usuarios_private (
  user_id uuid primary key
    references public.usuarios(id) on delete cascade deferrable initially deferred,
  email text,
  telefono text,
  fecha_nacimiento date,
  latitud double precision,
  longitud double precision,
  location_accuracy_m double precision,
  updated_at timestamptz not null default now()
);
revoke all on table app_private.usuarios_private from public, anon, authenticated;

create or replace function app_private.approx_coordinate(p_value double precision)
returns double precision
language sql
immutable
set search_path to ''
as $function$
  select case when p_value is null then null else round(p_value::numeric, 2)::double precision end
$function$;

-- 1) Copy what the shared rows hold today (usuarios first, profiles.telefono as fallback).
insert into app_private.usuarios_private as p
  (user_id, email, telefono, fecha_nacimiento, latitud, longitud, location_accuracy_m)
select
  u.id,
  nullif(btrim(u.email), ''),
  coalesce(nullif(btrim(u.telefono), ''), nullif(btrim(pr.telefono), '')),
  u.fecha_nacimiento,
  case when u.latitud is not null and u.longitud is not null then u.latitud end,
  case when u.latitud is not null and u.longitud is not null then u.longitud end,
  u.location_accuracy_m
from public.usuarios u
left join public.profiles pr on pr.id = u.id
on conflict (user_id) do update set
  email = coalesce(excluded.email, p.email),
  telefono = coalesce(excluded.telefono, p.telefono),
  fecha_nacimiento = coalesce(excluded.fecha_nacimiento, p.fecha_nacimiento),
  latitud = coalesce(excluded.latitud, p.latitud),
  longitud = coalesce(excluded.longitud, p.longitud),
  location_accuracy_m = coalesce(excluded.location_accuracy_m, p.location_accuracy_m),
  updated_at = now();

-- 2) Mask the shared rows (before the trigger exists, so nothing is re-captured).
update public.usuarios
set email = null,
    telefono = null,
    fecha_nacimiento = null,
    location_accuracy_m = null,
    latitud = app_private.approx_coordinate(latitud),
    longitud = app_private.approx_coordinate(longitud)
where email is not null or telefono is not null or fecha_nacimiento is not null
   or location_accuracy_m is not null
   or latitud is distinct from app_private.approx_coordinate(latitud)
   or longitud is distinct from app_private.approx_coordinate(longitud);

update public.profiles set telefono = null where telefono is not null;

-- 3) From now on every write is captured and masked.
create or replace function app_private.tg_usuarios_private_fields()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_email text := nullif(btrim(new.email), '');
  v_phone text := nullif(btrim(new.telefono), '');
  v_birth date := new.fecha_nacimiento;
  -- The shared row holds the ~1 km approximation: a coordinate counts as written only when
  -- it differs from what the row held (an app re-saving what it read changes nothing), and
  -- the one left untouched keeps its exact stored value.
  v_lat_changed boolean := new.latitud is not null
    and (tg_op = 'INSERT' or new.latitud is distinct from old.latitud);
  v_lng_changed boolean := new.longitud is not null
    and (tg_op = 'INSERT' or new.longitud is distinct from old.longitud);
  v_coords_provided boolean;
  v_stored app_private.usuarios_private;
  v_private app_private.usuarios_private;
begin
  select * into v_stored from app_private.usuarios_private where user_id = new.id;
  v_coords_provided := (v_lat_changed or v_lng_changed)
    and coalesce(case when v_lat_changed then new.latitud end, v_stored.latitud, new.latitud) is not null
    and coalesce(case when v_lng_changed then new.longitud end, v_stored.longitud, new.longitud) is not null;

  if v_email is not null or v_phone is not null or v_birth is not null or v_coords_provided then
    insert into app_private.usuarios_private as p
      (user_id, email, telefono, fecha_nacimiento, latitud, longitud, location_accuracy_m, updated_at)
    values (
      new.id, v_email, v_phone, v_birth,
      case when v_coords_provided then
        case when v_lat_changed then new.latitud else coalesce(v_stored.latitud, new.latitud) end end,
      case when v_coords_provided then
        case when v_lng_changed then new.longitud else coalesce(v_stored.longitud, new.longitud) end end,
      case when v_coords_provided then new.location_accuracy_m end,
      now()
    )
    on conflict (user_id) do update set
      email = coalesce(excluded.email, p.email),
      telefono = coalesce(excluded.telefono, p.telefono),
      fecha_nacimiento = coalesce(excluded.fecha_nacimiento, p.fecha_nacimiento),
      latitud = case when v_coords_provided then excluded.latitud else p.latitud end,
      longitud = case when v_coords_provided then excluded.longitud else p.longitud end,
      location_accuracy_m = case when v_coords_provided then excluded.location_accuracy_m else p.location_accuracy_m end,
      updated_at = now()
    returning * into v_private;
  else
    v_private := v_stored;
  end if;

  new.email := null;
  new.telefono := null;
  new.fecha_nacimiento := null;
  new.location_accuracy_m := null;
  new.latitud := app_private.approx_coordinate(v_private.latitud);
  new.longitud := app_private.approx_coordinate(v_private.longitud);
  return new;
end;
$function$;

revoke all on function app_private.tg_usuarios_private_fields() from public, anon, authenticated;

drop trigger if exists trg_usuarios_private_fields on public.usuarios;
create trigger trg_usuarios_private_fields
  before insert or update on public.usuarios
  for each row execute function app_private.tg_usuarios_private_fields();

create or replace function app_private.tg_profiles_private_phone()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_phone text := nullif(btrim(new.telefono), '');
begin
  if v_phone is not null and exists (select 1 from public.usuarios where id = new.id) then
    insert into app_private.usuarios_private as p (user_id, telefono, updated_at)
    values (new.id, v_phone, now())
    on conflict (user_id) do update set telefono = excluded.telefono, updated_at = now();
  end if;
  new.telefono := null;
  return new;
end;
$function$;

revoke all on function app_private.tg_profiles_private_phone() from public, anon, authenticated;

drop trigger if exists trg_profiles_private_phone on public.profiles;
create trigger trg_profiles_private_phone
  before insert or update on public.profiles
  for each row execute function app_private.tg_profiles_private_phone();

-- 4) The owner's full profile.
create or replace function public.get_my_profile()
returns setof public.usuarios
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_row public.usuarios;
  v_private app_private.usuarios_private;
begin
  select * into v_row from public.usuarios where id = auth.uid();
  if not found then
    return;
  end if;
  select * into v_private from app_private.usuarios_private where user_id = v_row.id;
  if found then
    v_row.email := v_private.email;
    v_row.telefono := v_private.telefono;
    v_row.fecha_nacimiento := v_private.fecha_nacimiento;
    v_row.latitud := coalesce(v_private.latitud, v_row.latitud);
    v_row.longitud := coalesce(v_private.longitud, v_row.longitud);
    v_row.location_accuracy_m := v_private.location_accuracy_m;
  end if;
  return next v_row;
end;
$function$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- 5) The owner clears a value (a blank write only means "not provided").
create or replace function public.clear_my_profile_fields(p_fields text[])
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_fields text[] := coalesce(p_fields, '{}'::text[]);
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(v_fields) f where f not in ('telefono', 'fecha_nacimiento', 'ubicacion')) then
    raise exception 'clear_my_profile_fields: only telefono, fecha_nacimiento, ubicacion' using errcode = '22023';
  end if;
  update app_private.usuarios_private
  set telefono = case when 'telefono' = any(v_fields) then null else telefono end,
      fecha_nacimiento = case when 'fecha_nacimiento' = any(v_fields) then null else fecha_nacimiento end,
      latitud = case when 'ubicacion' = any(v_fields) then null else latitud end,
      longitud = case when 'ubicacion' = any(v_fields) then null else longitud end,
      location_accuracy_m = case when 'ubicacion' = any(v_fields) then null else location_accuracy_m end,
      updated_at = now()
  where user_id = v_uid;
  if 'ubicacion' = any(v_fields) then
    -- The shared approximation follows the private value (the trigger recomputes it).
    update public.usuarios set latitud = null, longitud = null where id = v_uid;
  end if;
end;
$function$;

revoke all on function public.clear_my_profile_fields(text[]) from public, anon;
grant execute on function public.clear_my_profile_fields(text[]) to authenticated;

-- 6) Server functions that need the real values read the private table.
CREATE OR REPLACE FUNCTION public.get_match_contact_phone(p_partido_id bigint, p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_phone text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_user_id is null then
    return null;
  end if;

  if p_user_id <> v_uid then
    if p_partido_id is null or not app_private.is_match_admin(p_partido_id, v_uid) then
      raise exception 'not_authorized: solo el organizador del partido ve el contacto'
        using errcode = '42501';
    end if;
    -- Only the player's own actions link them: a roster row they inserted themselves
    -- (added_by is set by the server), a join request (only its user can insert it, and its
    -- user_id/match_id cannot be rewritten), or an invitation they accepted (only the invitee
    -- can mark it 'accepted': send_match_invite always writes 'pending' and notifications
    -- are insert-self-only).
    if not (
      exists (
        select 1 from public.jugadores roster_player
        where roster_player.partido_id = p_partido_id and roster_player.usuario_id = p_user_id
          and roster_player.added_by = p_user_id
      )
      or exists (
        select 1 from public.match_join_requests join_request
        where join_request.match_id = p_partido_id and join_request.user_id = p_user_id
          and join_request.status in ('pending', 'approved')
      )
      or exists (
        select 1 from public.notifications invite_notice
        where invite_notice.user_id = p_user_id
          and invite_notice.type = 'match_invite'
          and lower(btrim(coalesce(invite_notice.data ->> 'status', ''))) = 'accepted'
          and (
            invite_notice.partido_id = p_partido_id
            or coalesce(invite_notice.data ->> 'match_id', '') = p_partido_id::text
            or coalesce(invite_notice.data ->> 'matchId', '') = p_partido_id::text
          )
      )
    ) then
      raise exception 'not_authorized: el jugador no se sumó, no pidió sumarse ni aceptó una invitación a este partido'
        using errcode = '42501';
    end if;
  end if;

  select nullif(btrim(private_row.telefono), '')
  into v_phone
  from app_private.usuarios_private private_row
  where private_row.user_id = p_user_id;

  return v_phone;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_usuarios(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, nombre text, avatar_url text, localidad text, ranking numeric, posicion text, partidos_jugados integer, latitud double precision, longitud double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if auth.uid() is null or char_length(v_query) < 2 then
    return;
  end if;

  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    profile_row.id,
    profile_row.nombre,
    profile_row.avatar_url,
    profile_row.localidad,
    profile_row.ranking,
    profile_row.posicion,
    profile_row.partidos_jugados,
    round(profile_row.latitud::numeric, 2)::double precision,
    round(profile_row.longitud::numeric, 2)::double precision
  from public.usuarios profile_row
  where profile_row.id <> auth.uid()
    and (
      profile_row.nombre ilike v_pattern
      or exists (
        select 1 from app_private.usuarios_private private_row
        where private_row.user_id = profile_row.id
          and lower(private_row.email) = lower(v_query)
      )
    )
  order by profile_row.nombre
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_my_auto_match_location_from_profile()
 RETURNS player_availability
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_latitude double precision;
  v_longitude double precision;
  v_row public.player_availability;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  -- The exact location lives in app_private.usuarios_private (20261010135000).
  select coalesce(p.latitud, u.latitud), coalesce(p.longitud, u.longitud)
  into v_latitude, v_longitude
  from public.usuarios u
  left join app_private.usuarios_private p on p.user_id = u.id
  where u.id = auth.uid();

  if not public.auto_match_has_valid_coordinates(v_latitude, v_longitude) then
    raise exception 'auto_match_location_required';
  end if;

  -- Primer lock de la transaccion, antes de tocar player_availability.
  perform public.auto_match_lock_user(auth.uid());

  update public.player_availability a
  set latitude = v_latitude,
      longitude = v_longitude,
      updated_at = case
        when a.latitude is distinct from v_latitude or a.longitude is distinct from v_longitude
          then now()
        else a.updated_at
      end
  where a.user_id = auth.uid() and a.status = 'active'
  returning a.* into v_row;

  if v_row.id is not null and public.auto_match_availability_is_eligible(v_row.id) then
    perform * from public.sync_my_auto_match_gestations();
  end if;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public._notify_goalkeepers_for_match(p_match_id bigint, p_actor uuid, p_max_distance_km integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match public.partidos%ROWTYPE;
  v_kickoff timestamptz;
  v_max int := GREATEST(1, LEAST(COALESCE(p_max_distance_km, 30), 30));
  v_match_has_coords boolean;
  v_notified int := 0;
BEGIN
  SELECT * INTO v_match
  FROM public.partidos
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'match_not_found');
  END IF;

  -- Only fan out for a match actively searching a goalkeeper and still in the future.
  IF COALESCE(v_match.busca_arquero, false) <> true THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'not_searching_goalkeeper');
  END IF;

  v_kickoff := public.partido_kickoff_at(v_match.fecha, v_match.hora);
  IF v_kickoff IS NULL OR v_kickoff <= now() THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'match_not_future');
  END IF;

  v_match_has_coords := public.coordinates_are_valid(v_match.sede_latitud, v_match.sede_longitud);

  WITH eligible AS (
    SELECT
      u.id,
      CASE
        WHEN v_match_has_coords AND public.coordinates_are_valid(COALESCE(up.latitud, u.latitud), COALESCE(up.longitud, u.longitud))
          THEN public.haversine_km(v_match.sede_latitud, v_match.sede_longitud, COALESCE(up.latitud, u.latitud), COALESCE(up.longitud, u.longitud))
        ELSE NULL
      END AS dist
    FROM public.usuarios u
    LEFT JOIN app_private.usuarios_private up ON up.user_id = u.id
    WHERE u.disponible_arquero = true
      AND 'ARQ' = ANY(COALESCE(u.posiciones, '{}'::text[]))
      AND u.id IS DISTINCT FROM p_actor
      AND NOT EXISTS (
        SELECT 1 FROM public.jugadores j
        WHERE j.partido_id = p_match_id AND j.usuario_id = u.id
      )
  ),
  recipients AS (
    SELECT id
    FROM eligible
    WHERE
      NOT v_match_has_coords
      OR (dist IS NOT NULL AND dist <= v_max)
  ),
  inserted AS (
    INSERT INTO public.notifications (
      user_id, type, title, message, partido_id, data, read, created_at
    )
    SELECT
      r.id,
      'match_needs_goalkeeper',
      'Buscan arquero cerca tuyo',
      trim(both ' ·' FROM concat_ws(' · ',
        NULLIF(
          concat_ws(' ',
            to_char(v_match.fecha, 'DD/MM'),
            NULLIF(left(COALESCE(v_match.hora, ''), 5), '')
          ), ''),
        NULLIF(v_match.modalidad, ''),
        NULLIF(btrim(COALESCE(v_match.sede_direccion_normalizada, v_match.sede, '')), '')
      )),
      p_match_id,
      jsonb_build_object(
        'match_id', p_match_id,
        'matchId', p_match_id,
        'type', 'match_needs_goalkeeper',
        'link', '/partido-publico/' || p_match_id
      ),
      false,
      now()
    FROM recipients r
    ON CONFLICT (user_id, partido_id) WHERE (type = 'match_needs_goalkeeper')
    DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_notified FROM inserted;

  RETURN jsonb_build_object('ok', true, 'notified', v_notified);
END;
$function$;


do $$
begin
  if exists (
    select 1 from public.usuarios
    where email is not null or telefono is not null or fecha_nacimiento is not null
       or location_accuracy_m is not null
       or latitud is distinct from app_private.approx_coordinate(latitud)
       or longitud is distinct from app_private.approx_coordinate(longitud)
  ) then
    raise exception 'public.usuarios still holds private values';
  end if;
  if exists (select 1 from public.profiles where telefono is not null) then
    raise exception 'public.profiles still holds phone numbers';
  end if;
  if has_table_privilege('authenticated', 'app_private.usuarios_private', 'select')
     or has_table_privilege('anon', 'app_private.usuarios_private', 'select') then
    raise exception 'app_private.usuarios_private must not be readable through the API';
  end if;
end;
$$;
