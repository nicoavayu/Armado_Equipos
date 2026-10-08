-- #193 promotion — prechecks. READ-ONLY: run right before applying 20261010120000…138000.
-- Every line is one JSON object {check, pass, value}. Any "pass": false → do not apply.
-- psql -X -A -t -q -v ON_ERROR_STOP=1 -f precheck.sql   (connected as postgres)
begin read only;

select json_build_object('check', 'connected as postgres, can create the reader role, can act as the API roles',
  'pass', current_user = 'postgres' and r.rolcreaterole and r.rolbypassrls
    and pg_has_role('postgres', 'authenticated', 'member') and pg_has_role('postgres', 'anon', 'member'),
  'value', json_build_object('user', current_user, 'createrole', r.rolcreaterole, 'bypassrls', r.rolbypassrls, 'superuser', r.rolsuper))::text
from pg_roles r where r.rolname = current_user;

select json_build_object('check', 'Postgres 15 or newer (security_invoker views)',
  'pass', current_setting('server_version_num')::int >= 150000, 'value', current_setting('server_version'))::text;

select json_build_object('check', 'database writable',
  'pass', current_setting('default_transaction_read_only') = 'off' and not pg_is_in_recovery(),
  'value', current_setting('default_transaction_read_only'))::text;

select json_build_object('check', 'database size leaves room on the Free plan (< 350 MB)',
  'pass', pg_database_size(current_database()) < 350 * 1024 * 1024,
  'value', pg_size_pretty(pg_database_size(current_database())))::text;

select json_build_object('check', 'ledger: Torneos contract and ops retention present, none of 20261010120000…138000 yet',
  'pass', exists (select 1 from supabase_migrations.schema_migrations where version = '20260915120000')
    and exists (select 1 from supabase_migrations.schema_migrations where version = '20261009120000')
    and not exists (select 1 from supabase_migrations.schema_migrations where version between '20261010120000' and '20261010139999'),
  'value', (select json_agg(version order by version) from supabase_migrations.schema_migrations where version >= '20260914120000'))::text;

select json_build_object('check', 'postgres owns the tables and match views the stack changes',
  'pass', bool_and(pg_get_userbyid(c.relowner) = 'postgres'),
  'value', json_object_agg(c.relname, pg_get_userbyid(c.relowner)))::text
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('usuarios', 'profiles', 'partidos', 'jugadores', 'notifications', 'match_join_requests', 'amigos',
                    'voting_photo_slot_claims', 'partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2');

select json_build_object('check', 'match views run as the caller today (security_invoker)',
  'pass', bool_and(coalesce(c.reloptions @> array['security_invoker=on'], false) or coalesce(c.reloptions @> array['security_invoker=true'], false)),
  'value', json_object_agg(c.relname, c.reloptions))::text
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relname in ('partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2');

select json_build_object('check', 'nothing of the stack exists yet (private tables, reader role, template link, roster added_by)',
  'pass', to_regclass('app_private.usuarios_private') is null
    and not exists (select 1 from pg_roles where rolname = 'core_match_public_reader')
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partidos' and column_name = 'template_id')
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jugadores' and column_name = 'added_by')
    and to_regclass('app_private.jugadores_added_by') is null,
  'value', json_build_object('usuarios_private', to_regclass('app_private.usuarios_private') is not null,
    'reader_role', exists (select 1 from pg_roles where rolname = 'core_match_public_reader'),
    'partidos_template_id', (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'partidos' and column_name = 'template_id'),
    'jugadores_added_by', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jugadores' and column_name = 'added_by')))::text;

select json_build_object('check', 'pg_cron available (20261010131000 schedules the survey finalization)',
  'pass', exists (select 1 from pg_extension where extname = 'pg_cron'),
  'value', (select count(*) from cron.job where active))::text;

select json_build_object('check', 'no long transaction that could hold the ALTER/CREATE POLICY locks',
  'pass', not exists (select 1 from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid() and state <> 'idle'),
  'value', (select count(*) from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid() and state <> 'idle'))::text;

select json_build_object('check', 'no account holds a single coordinate (135000 keeps a location only as a lat/long pair)',
  'pass', (select count(*) from public.usuarios where (latitud is null) <> (longitud is null)) = 0,
  'value', (select count(*) from public.usuarios where (latitud is null) <> (longitud is null)))::text;

select json_build_object('check', 'informative: profiles phones that differ from the account phone (135000 keeps the account one; the other stays only in the backup)',
  'pass', true,
  'value', json_build_object(
    'both_set_and_different', (select count(*) from public.profiles pr join public.usuarios u on u.id = pr.id
       where nullif(btrim(pr.telefono), '') is not null and nullif(btrim(u.telefono), '') is not null and btrim(pr.telefono) <> btrim(u.telefono)),
    'only_in_usuarios', (select count(*) from public.profiles pr join public.usuarios u on u.id = pr.id
       where nullif(btrim(pr.telefono), '') is null and nullif(btrim(u.telefono), '') is not null)))::text;

-- Baseline to compare after 135000 (counts only, no values).
select json_build_object('check', 'baseline: private values in the shared rows (must all move after 135000)', 'pass', true,
  'value', json_build_object(
    'usuarios', (select count(*) from public.usuarios),
    'with_email', (select count(*) from public.usuarios where nullif(btrim(email), '') is not null),
    'with_phone', (select count(*) from public.usuarios where nullif(btrim(telefono), '') is not null),
    'with_birth_date', (select count(*) from public.usuarios where fecha_nacimiento is not null),
    'with_location', (select count(*) from public.usuarios where latitud is not null and longitud is not null),
    'profiles_with_phone', (select count(*) from public.profiles where nullif(btrim(telefono), '') is not null),
    'partidos', (select count(*) from public.partidos),
    'jugadores', (select count(*) from public.jugadores),
    'shared_photo_slots', (select count(*) from (select 1 from public.voting_photo_slot_claims group by match_id, player_id having count(*) > 1) s)))::text;

rollback;
