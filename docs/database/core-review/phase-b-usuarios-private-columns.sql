-- PHASE B — NOT A MIGRATION. Apply by hand, with a GO, only when:
--   1. 20261010124000_core_usuarios_profile_rpcs.sql is applied (phase A), and
--   2. no app version in use still reads usuarios with select('*') (web is always
--      current; Android/iOS: the minimum supported build includes the phase A client).
-- Effect: other accounts can no longer read usuarios.email, fecha_nacimiento, latitud,
-- longitud or location_accuracy_m through the API; the owner reads them through
-- get_my_profile(). Rows stay readable (names, avatars, stats). Writes are unchanged.
-- Rollback: grant select on table public.usuarios to anon, authenticated;
-- NOTE for later migrations once applied: SELECT on usuarios is granted per column. A new
-- public column needs `grant select (<column>) on public.usuarios to anon, authenticated`.
-- Verified in the Core lab: integration/core-lab/tests/profile-privacy.test.mjs applies
-- this file inside a rolled-back transaction.

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
  if to_regprocedure('public.get_my_profile()') is null then
    raise exception 'apply phase A (20261010124000) first';
  end if;
end
$usuarios_private_columns_check$;
