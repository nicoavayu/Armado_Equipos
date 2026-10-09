-- PHASE B — NOT A MIGRATION. Apply by hand, with a GO, only when the readiness criteria in
-- PROMOTION.md are met (phase A migrations applied; no active session still on an app
-- build that reads usuarios with select('*')). Readiness query (20261010130000):
--   select * from app_private.privacy_phase_b_readiness(<min Android build>, <min iOS build>, 30);
--
-- Effect: the only usuarios columns readable through the API are the explicit public list
-- app_private.usuarios_public_columns() (20261010128000). email, telefono,
-- fecha_nacimiento, exact location, activity timestamps, push settings and any column not
-- in that list stop being readable by other accounts; the owner reads them through
-- get_my_profile(), organizers read a player's phone through get_match_contact_phone().
-- The legacy profiles table keeps only its public columns too (telefono included there).
-- Rows stay readable; writes are unchanged.
-- Rollback: grant select on table public.usuarios, public.profiles to anon, authenticated;
-- NOTE once applied: SELECT on usuarios/profiles is granted per column. A new public column
-- must be added to app_private.usuarios_public_columns() AND granted explicitly.
-- Verified in the Core lab: integration/core-lab/tests/profile-privacy.test.mjs applies this
-- file inside rolled-back transactions.

do $usuarios_private_columns$
declare
  v_public_columns text;
  v_profiles_public text;
  v_becoming_private text;
begin
  if to_regprocedure('public.get_my_profile()') is null
     or to_regprocedure('app_private.usuarios_public_columns()') is null then
    raise exception 'apply phase A (20261010124000 and 20261010128000) first';
  end if;

  select
    string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
      filter (where attribute.attname = any (app_private.usuarios_public_columns())),
    string_agg(attribute.attname, ', ' order by attribute.attnum)
      filter (where attribute.attname <> all (app_private.usuarios_public_columns()))
  into v_public_columns, v_becoming_private
  from pg_attribute attribute
  where attribute.attrelid = 'public.usuarios'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  raise notice 'usuarios columns that stop being readable by other accounts: %', v_becoming_private;

  -- Revoking the table privilege also revokes every column privilege of that role.
  revoke select on table public.usuarios from anon, authenticated;
  execute format('grant select (%s) on table public.usuarios to anon, authenticated', v_public_columns);

  if to_regclass('public.profiles') is not null then
    select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
    into v_profiles_public
    from pg_attribute attribute
    where attribute.attrelid = 'public.profiles'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attname in ('id', 'nombre', 'avatar_url', 'ciudad', 'posicion', 'created_at', 'updated_at');
    revoke select on table public.profiles from anon, authenticated;
    execute format('grant select (%s) on table public.profiles to anon, authenticated', v_profiles_public);
  end if;
end
$usuarios_private_columns$;

do $usuarios_private_columns_check$
declare
  v_column text;
begin
  foreach v_column in array array['email', 'telefono', 'fecha_nacimiento', 'latitud', 'longitud', 'location_accuracy_m'] loop
    if has_column_privilege('authenticated', 'public.usuarios', v_column, 'select')
       or has_column_privilege('anon', 'public.usuarios', v_column, 'select') then
      raise exception 'usuarios.% is still readable through the API', v_column;
    end if;
  end loop;
  if to_regclass('public.profiles') is not null
     and has_column_privilege('authenticated', 'public.profiles', 'telefono', 'select') then
    raise exception 'profiles.telefono is still readable through the API';
  end if;
  if not has_column_privilege('authenticated', 'public.usuarios', 'nombre', 'select')
     or not has_column_privilege('authenticated', 'public.usuarios', 'avatar_url', 'select')
     or not has_column_privilege('authenticated', 'public.usuarios', 'telefono', 'update') then
    raise exception 'usuarios public columns or own-row writes lost their privileges';
  end if;
end
$usuarios_private_columns_check$;
