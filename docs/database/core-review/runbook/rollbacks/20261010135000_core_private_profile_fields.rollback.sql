-- Rollback of 20261010135000 (private profile fields). Run as postgres, in one transaction, after
-- the rollbacks of 137000 and 136000. Puts every value back in the shared rows from
-- app_private.usuarios_private, which holds the latest value of each field (changes made after
-- 135000 included; a field the owner cleared stays empty). Effect: any signed-in account reads
-- email, phone, birth date and exact location of every account again.
-- Data notes:
--   * profiles.telefono gets the account's phone. A profiles copy that differed from the
--     usuarios phone before 135000 is only in the pre-promotion backup (precheck counts them).
--   * app_private.usuarios_private is kept (drop it only after the rollback is verified).
drop trigger if exists trg_usuarios_private_fields on public.usuarios;
drop trigger if exists trg_profiles_private_phone on public.profiles;

update public.usuarios u
set email = coalesce(p.email, u.email),
    telefono = coalesce(p.telefono, u.telefono),
    fecha_nacimiento = coalesce(p.fecha_nacimiento, u.fecha_nacimiento),
    latitud = coalesce(p.latitud, u.latitud),
    longitud = coalesce(p.longitud, u.longitud),
    location_accuracy_m = coalesce(p.location_accuracy_m, u.location_accuracy_m)
from app_private.usuarios_private p
where p.user_id = u.id;

-- Only where profiles.telefono exists (it does not in Core Production).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'telefono') then
    execute 'update public.profiles pr set telefono = p.telefono
             from app_private.usuarios_private p
             where p.user_id = pr.id and p.telefono is not null';
  end if;
end;
$$;

-- The functions as they were before 135000.
CREATE OR REPLACE FUNCTION public.get_my_profile()
 RETURNS SETOF usuarios
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select profile_row.*
  from public.usuarios profile_row
  where profile_row.id = auth.uid()
$function$;

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

  select nullif(btrim(profile_row.telefono), '')
  into v_phone
  from public.usuarios profile_row
  where profile_row.id = p_user_id;

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
      or lower(profile_row.email) = lower(v_query)
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

  select u.latitud, u.longitud
  into v_latitude, v_longitude
  from public.usuarios u
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
        WHEN v_match_has_coords AND public.coordinates_are_valid(u.latitud, u.longitud)
          THEN public.haversine_km(v_match.sede_latitud, v_match.sede_longitud, u.latitud, u.longitud)
        ELSE NULL
      END AS dist
    FROM public.usuarios u
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

drop function if exists public.clear_my_profile_fields(text[]);
drop function if exists app_private.tg_usuarios_private_fields();
drop function if exists app_private.tg_profiles_private_phone();
drop function if exists app_private.approx_coordinate(double precision);
delete from supabase_migrations.schema_migrations where version = '20261010135000';
