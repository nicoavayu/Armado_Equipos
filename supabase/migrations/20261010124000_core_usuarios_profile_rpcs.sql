-- Core: private profile data gets its own read path (phase A of 2).
--
-- usuarios_select_authenticated is USING (true) with every column granted, so any
-- signed-in account (sign-up is open) can list everyone's email, birth date and home
-- coordinates. Closing it means revoking SELECT on those columns (phase B), but every app
-- version in use reads its own profile with select('*') and would stop loading it. So:
--   * phase A (this migration, additive): the reads the app needs without those columns —
--       get_my_profile()                     → the caller's own full row;
--       get_public_profiles(uuid[])          → others' rows without the private keys;
--       get_usuarios_approx_location(uuid[]) → others' coordinates rounded to ~1 km;
--       search_usuarios(text, integer)       → by name or the exact email, no emails back;
--     the new client uses them (and falls back to the table where they do not exist yet);
--   * phase B (docs/database/core-review/phase-b-usuarios-private-columns.sql): the revoke,
--     applied by hand once no installed app version still reads select('*') on usuarios.
-- telefono stays readable in both phases (the admin contact on the player card reads it
-- directly; see the Core report).

create or replace function public.get_my_profile()
returns setof public.usuarios
language sql
stable
security definer
set search_path to ''
as $function$
  select profile_row.*
  from public.usuarios profile_row
  where profile_row.id = auth.uid()
$function$;

create or replace function public.get_public_profiles(p_user_ids uuid[])
returns setof jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select to_jsonb(profile_row) - array['email', 'fecha_nacimiento', 'latitud', 'longitud', 'location_accuracy_m']
  from public.usuarios profile_row
  where auth.uid() is not null
    and profile_row.id = any ((coalesce(p_user_ids, '{}'::uuid[]))[1:500])
$function$;

create or replace function public.get_usuarios_approx_location(p_user_ids uuid[])
returns table (id uuid, latitud double precision, longitud double precision)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    profile_row.id,
    round(profile_row.latitud::numeric, 2)::double precision,
    round(profile_row.longitud::numeric, 2)::double precision
  from public.usuarios profile_row
  where auth.uid() is not null
    and profile_row.id = any ((coalesce(p_user_ids, '{}'::uuid[]))[1:500])
    and profile_row.latitud is not null
    and profile_row.longitud is not null
$function$;

create or replace function public.search_usuarios(p_query text, p_limit integer default 10)
returns table (
  id uuid,
  nombre text,
  avatar_url text,
  localidad text,
  ranking numeric,
  posicion text,
  partidos_jugados integer,
  latitud double precision,
  longitud double precision
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
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

revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.get_public_profiles(uuid[]) from public, anon;
revoke all on function public.get_usuarios_approx_location(uuid[]) from public, anon;
revoke all on function public.search_usuarios(text, integer) from public, anon;
grant execute on function public.get_my_profile() to authenticated, service_role;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, service_role;
grant execute on function public.get_usuarios_approx_location(uuid[]) to authenticated, service_role;
grant execute on function public.search_usuarios(text, integer) to authenticated, service_role;

do $usuarios_profile_rpcs_check$
begin
  if has_function_privilege('anon', 'public.get_my_profile()', 'execute')
     or has_function_privilege('anon', 'public.get_public_profiles(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.get_usuarios_approx_location(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.search_usuarios(text,integer)', 'execute') then
    raise exception 'usuarios profile RPCs must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_profile()', 'execute')
     or not has_function_privilege('authenticated', 'public.search_usuarios(text,integer)', 'execute') then
    raise exception 'usuarios profile RPCs must be executable by authenticated';
  end if;
end
$usuarios_profile_rpcs_check$;
