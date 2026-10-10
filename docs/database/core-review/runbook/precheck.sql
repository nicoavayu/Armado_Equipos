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

select json_build_object('check', 'ledger: Torneos contract and ops retention present, none of 20261010119000…146000 yet',
  'pass', exists (select 1 from supabase_migrations.schema_migrations where version = '20260915120000')
    and exists (select 1 from supabase_migrations.schema_migrations where version = '20261009120000')
    and not exists (select 1 from supabase_migrations.schema_migrations where version between '20261010119000' and '20261010149999'),
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

select json_build_object('check', 'nothing of the stack exists yet (private tables, reader role, roster added_by)',
  'pass', to_regclass('app_private.usuarios_private') is null
    and not exists (select 1 from pg_roles where rolname = 'core_match_public_reader')
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jugadores' and column_name = 'added_by')
    and to_regclass('app_private.jugadores_added_by') is null
    and to_regclass('app_private.match_link_access') is null,
  'value', json_build_object('usuarios_private', to_regclass('app_private.usuarios_private') is not null,
    'reader_role', exists (select 1 from pg_roles where rolname = 'core_match_public_reader'),
    'jugadores_added_by', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jugadores' and column_name = 'added_by')))::text;

-- Known drift of Core Production vs the repository (2026-10-09): both are handled by the stack.
select json_build_object('check', 'partidos.template_id: absent, or of the type of partidos_frecuentes.id (Production: uuid with its foreign key, kept by 134000)',
  'pass', c.data_type is null
      or format_type(a.atttypid, a.atttypmod) = (select format_type(f.atttypid, f.atttypmod) from pg_attribute f
                                                  where f.attrelid = 'public.partidos_frecuentes'::regclass and f.attname = 'id' and not f.attisdropped),
  'value', json_build_object('type', coalesce(c.data_type, 'absent'),
    'template_id_type_of', (select format_type(f.atttypid, f.atttypmod) from pg_attribute f
                            where f.attrelid = 'public.partidos_frecuentes'::regclass and f.attname = 'id' and not f.attisdropped),
    'non_null', (select count(*) from public.partidos p where to_jsonb(p) ->> 'template_id' is not null)))::text
from (select 1) one
left join information_schema.columns c on c.table_schema = 'public' and c.table_name = 'partidos' and c.column_name = 'template_id'
left join pg_attribute a on a.attrelid = 'public.partidos'::regclass and a.attname = 'template_id' and not a.attisdropped;

select json_build_object('check', 'informative: what 20261010119000 will align (Production differs from the repository here; expected on Core Production: 18 policies to replace, untouched_policies n=192 md5 86fa2f8a…)',
  'pass', true,
  'value', json_build_object(
    'partidos_admin_id', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partidos' and column_name = 'admin_id'),
    'missing_helpers', (select coalesce(json_agg(f), '[]') from unnest(array['app_private.is_match_admin(bigint,uuid)', 'app_private.is_match_player(bigint,uuid)',
                         'app_private.is_public_match_visible(bigint)']) f where to_regprocedure(f) is null),
    'policies_to_replace', (select coalesce(json_agg(tablename || '.' || policyname || ' (' || cmd || ')' order by tablename, policyname), '[]') from pg_policies
      where schemaname = 'public'
        and ((tablename = 'partidos' and cmd in ('SELECT', 'INSERT', 'ALL')
              and policyname not in ('partidos_insert_creator', 'partidos_insert_own', 'partidos_select_authenticated', 'partidos_select_public_shared'))
          or (tablename = 'jugadores' and cmd in ('SELECT', 'INSERT', 'ALL')
              and policyname not in ('jugadores_insert_self_or_admin', 'jugadores_select_authenticated', 'jugadores_select_public_shared'))
          or (tablename in ('public_voters', 'votos_publicos') and cmd in ('SELECT', 'INSERT') and (qual = 'true' or with_check = 'true')))),
    'untouched_policies', (select jsonb_build_object('n', count(*), 'md5', md5(string_agg(format('%s.%s %s %s %s u=%s c=%s', tablename, policyname, permissive, cmd, roles::text, qual, with_check), E'\n' order by tablename, policyname)))
      from pg_policies
      where schemaname = 'public'
        and not (tablename in ('partidos', 'jugadores') and cmd in ('SELECT', 'INSERT', 'ALL'))
        and not (tablename in ('public_voters', 'votos_publicos') and cmd in ('SELECT', 'INSERT')))))::text;

select json_build_object('check', 'informative: urgent fix 20261010118000 already applied alone? (apply-193 then skips it)',
  'pass', true,
  'value', json_build_object('in_ledger', exists (select 1 from supabase_migrations.schema_migrations where version = '20261010118000'),
    'cancel_guarded', (select prosrc ~ '20261010118000' from pg_proc where oid = to_regprocedure('public.cancel_partido_with_notification(bigint,text)'))))::text;

select json_build_object('check', 'informative: profiles.telefono exists? (absent in Production; 135000 then skips it)',
  'pass', true,
  'value', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'telefono'))::text;

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
  'value', case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'telefono')
    then to_json('n/a: profiles has no telefono'::text) else json_build_object(
    'both_set_and_different', (select count(*) from public.profiles pr join public.usuarios u on u.id = pr.id
       where nullif(btrim(to_jsonb(pr) ->> 'telefono'), '') is not null and nullif(btrim(u.telefono), '') is not null and btrim(to_jsonb(pr) ->> 'telefono') <> btrim(u.telefono)),
    'only_in_usuarios', (select count(*) from public.profiles pr join public.usuarios u on u.id = pr.id
       where nullif(btrim(to_jsonb(pr) ->> 'telefono'), '') is null and nullif(btrim(u.telefono), '') is not null)) end)::text;

select json_build_object('check', 'informative: join requests duplicated per account and match today (140000 refuses new duplicates; existing ones are kept)',
  'pass', true,
  'value', (select count(*) from (select 1 from public.match_join_requests group by match_id, user_id having count(*) > 1) d))::text;

select json_build_object('check', 'informative, how Prod is today: can organizers approve join requests? (approve-join-request calls approve_join_request as the organizer; false = every approval answers "forbidden" now; 20261010141000 fixes it)',
  'pass', true,
  'value', has_function_privilege('authenticated', 'public.approve_join_request(bigint)', 'execute'))::text;

-- Baseline to compare after 135000 (counts only, no values).
select json_build_object('check', 'baseline: private values in the shared rows (must all move after 135000)', 'pass', true,
  'value', json_build_object(
    'usuarios', (select count(*) from public.usuarios),
    'with_email', (select count(*) from public.usuarios where nullif(btrim(email), '') is not null),
    'with_phone', (select count(*) from public.usuarios where nullif(btrim(telefono), '') is not null),
    'with_birth_date', (select count(*) from public.usuarios where fecha_nacimiento is not null),
    'with_location', (select count(*) from public.usuarios where latitud is not null and longitud is not null),
    'profiles_with_phone', (select count(*) from public.profiles pr where nullif(btrim(to_jsonb(pr) ->> 'telefono'), '') is not null),
    'partidos', (select count(*) from public.partidos),
    'jugadores', (select count(*) from public.jugadores),
    'shared_photo_slots', (select count(*) from (select 1 from public.voting_photo_slot_claims group by match_id, player_id having count(*) > 1) s)))::text;

rollback;
