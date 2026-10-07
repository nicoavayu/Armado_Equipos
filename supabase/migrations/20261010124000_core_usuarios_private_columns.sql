-- Core: other accounts no longer read a user's email, birth date or exact location.
--
-- usuarios_select_authenticated is USING (true) and every column was granted, so any
-- signed-in account (sign-up is open) could list everyone's email, birth date and home
-- coordinates. Rows stay readable (names, avatars, stats and positions are the public
-- profile the app shows everywhere); the private columns become unreadable through the
-- API for everyone, the owner included, and the app reads them through RPCs instead:
--   * get_my_profile()                       → the caller's own full row (profile, editor);
--   * get_public_profiles(uuid[])            → other users' rows without the private keys
--                                              (replaces `select('*')` on others);
--   * get_usuarios_approx_location(uuid[])   → others' coordinates rounded to 0.01°
--                                              (~1 km): enough to sort and show "a 3 km",
--                                              not enough to find a home;
--   * search_usuarios(text, integer)         → name search, or an exact email match
--                                              (finding a friend by email keeps working;
--                                              emails are never returned or partially matched).
-- Writes are unchanged (UPDATE/INSERT privileges and the own-row policies stay).
-- Kept readable on purpose, pending a client change: telefono (the admin contact on the
-- player card reads it directly; see the Core report).
-- NOTE for later migrations: SELECT on usuarios is granted per column now. A new public
-- column needs `grant select (<column>) on public.usuarios to anon, authenticated`.

do $usuarios_private_columns$
declare
  v_private constant text[] := array['email', 'fecha_nacimiento', 'latitud', 'longitud', 'location_accuracy_m'];
  v_public_columns text;
begin
  select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
  into v_public_columns
  from pg_attribute attribute
  where attribute.attrelid = 'public.usuarios'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attname <> all (v_private);

  -- Revoking the table privilege also revokes every column privilege of that role.
  revoke select on table public.usuarios from anon, authenticated;
  execute format('grant select (%s) on table public.usuarios to anon, authenticated', v_public_columns);
end
$usuarios_private_columns$;

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

do $usuarios_private_columns_check$
declare
  v_column text;
begin
  foreach v_column in array array['email', 'fecha_nacimiento', 'latitud', 'longitud', 'location_accuracy_m'] loop
    if has_column_privilege('authenticated', 'public.usuarios', v_column, 'select')
       or has_column_privilege('anon', 'public.usuarios', v_column, 'select') then
      raise exception 'usuarios.% is still readable through the API', v_column;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.usuarios', 'nombre', 'select')
     or not has_column_privilege('authenticated', 'public.usuarios', 'avatar_url', 'select')
     or not has_column_privilege('authenticated', 'public.usuarios', 'email', 'update') then
    raise exception 'usuarios public columns or own-row writes lost their privileges';
  end if;
  if has_function_privilege('anon', 'public.get_my_profile()', 'execute')
     or has_function_privilege('anon', 'public.search_usuarios(text,integer)', 'execute') then
    raise exception 'usuarios profile RPCs must not be executable by anon';
  end if;
end
$usuarios_private_columns_check$;
