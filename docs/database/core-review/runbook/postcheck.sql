-- #193 promotion — post-checks. Writes nothing (one transaction, rolled back): run after
-- 20261010138000, and again after any rollback/re-apply. Every line is {check, pass, value};
-- values are counts or true/false, never personal data or codes.
-- It acts as a brand-new account (random id, involved in nothing), as anon, as the organizer
-- of the latest match and as an account that has a phone, through the same roles and claims
-- PostgREST uses.
-- psql -X -A -t -q -v ON_ERROR_STOP=1 -f postcheck.sql   (connected as postgres)
begin;

-- ---------- as postgres: structure and data ----------
select json_build_object('check', 'ledger holds the 19 migrations 20261010120000…138000',
  'pass', (select count(*) from supabase_migrations.schema_migrations where version between '20261010120000' and '20261010138000') = 19,
  'value', (select count(*) from supabase_migrations.schema_migrations where version between '20261010120000' and '20261010138000'))::text;

select json_build_object('check', '135000: no email, phone or birth date left in the shared rows',
  'pass', (select count(*) from public.usuarios where email is not null or telefono is not null or fecha_nacimiento is not null) = 0
      and (select count(*) from public.profiles where telefono is not null) = 0,
  'value', json_build_object('usuarios', (select count(*) from public.usuarios where email is not null or telefono is not null or fecha_nacimiento is not null),
    'profiles', (select count(*) from public.profiles where telefono is not null)))::text;

select json_build_object('check', '135000: every account has its private row; counts match the precheck baseline',
  'pass', (select count(*) from app_private.usuarios_private) = (select count(*) from public.usuarios),
  'value', json_build_object('usuarios', (select count(*) from public.usuarios), 'private_rows', (select count(*) from app_private.usuarios_private),
    'with_email', (select count(*) from app_private.usuarios_private where email is not null),
    'with_phone', (select count(*) from app_private.usuarios_private where telefono is not null),
    'with_birth_date', (select count(*) from app_private.usuarios_private where fecha_nacimiento is not null),
    'with_location', (select count(*) from app_private.usuarios_private where latitud is not null or longitud is not null)))::text;

select json_build_object('check', '135000: shared coordinates are approximate (2 decimals)',
  'pass', (select count(*) from public.usuarios where latitud is distinct from round(latitud::numeric, 2)::double precision
                                                  or longitud is distinct from round(longitud::numeric, 2)::double precision) = 0,
  'value', (select count(*) from public.usuarios where latitud is not null))::text;

select json_build_object('check', '136000/137000: table policies are per involvement (no open clause, no USING true)',
  'pass', (select pg_get_expr(polqual, polrelid) !~* 'partido_is_operationally_open' from pg_policy where polrelid = 'public.partidos'::regclass and polname = 'partidos_select_authenticated')
      and (select pg_get_expr(polqual, polrelid) <> 'true' from pg_policy where polrelid = 'public.jugadores'::regclass and polname = 'jugadores_select_authenticated'),
  'value', (select count(*) from pg_policy where polrelid in ('public.partidos'::regclass, 'public.jugadores'::regclass)))::text;

select json_build_object('check', '137000: views read as core_match_public_reader (nologin, no bypass), not as the caller',
  'pass', (select count(*) from pg_class where relnamespace = 'public'::regnamespace
             and relname in ('partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2')
             and pg_get_userbyid(relowner) = 'core_match_public_reader' and reloptions @> array['security_invoker=false']) = 3
      and (select not rolcanlogin and not rolbypassrls and not rolsuper from pg_roles where rolname = 'core_match_public_reader'),
  'value', (select json_object_agg(relname, pg_get_userbyid(relowner)) from pg_class where relnamespace = 'public'::regnamespace
             and relname in ('partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2')))::text;

select json_build_object('check', 'grants: own-profile RPCs for accounts only; photo binding for the server only',
  'pass', has_function_privilege('authenticated', 'public.get_my_profile()', 'execute')
      and not has_function_privilege('anon', 'public.get_my_profile()', 'execute')
      and has_function_privilege('authenticated', 'public.clear_my_profile_fields(text[])', 'execute')
      and not has_function_privilege('anon', 'public.clear_my_profile_fields(text[])', 'execute')
      and has_function_privilege('authenticated', 'public.get_match_access_codes(bigint[])', 'execute')
      and not has_function_privilege('anon', 'public.get_match_access_codes(bigint[])', 'execute')
      and has_function_privilege('service_role', 'public.bind_voting_photo_slot(bigint,text,bigint)', 'execute')
      and not has_function_privilege('anon', 'public.bind_voting_photo_slot(bigint,text,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.bind_voting_photo_slot(bigint,text,bigint)', 'execute'),
  'value', null)::text;

select json_build_object('check', '138000: a guest photo slot belongs to its first session',
  'pass', (select prosrc ~ 'pg_advisory_xact_lock' and prosrc ~ 'public_voters' from pg_proc where oid = 'public.bind_voting_photo_slot(bigint,text,bigint)'::regprocedure),
  'value', null)::text;

select json_build_object('check', '131000: survey finalization scheduled every 5 minutes',
  'pass', exists (select 1 from cron.job where jobname = 'survey_finalization_backend_scheduler' and active and schedule = '*/5 * * * *'),
  'value', (select count(*) from cron.job where active))::text;

-- Expected values for the role checks, computed with full visibility and stashed in this
-- transaction (set_config(..., true) ends with it). Nothing is printed.
select set_config('postcheck.open_matches', (select count(*) from public.partidos p where p.deleted_at is null
    and public.partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at, p.fecha, p.hora,
      coalesce(p.falta_jugadores, false) or coalesce(p.busca_arquero, false), now()))::text, true) is not null as stashed \gset
select set_config('postcheck.visible_roster', (select count(*) from public.jugadores j
    where j.partido_id is null or app_private.match_is_publicly_open(j.partido_id))::text, true) is not null as stashed \gset
select set_config('postcheck.organizer', coalesce((select creado_por::text from public.partidos where creado_por is not null and deleted_at is null order by id desc limit 1), ''), true) is not null as stashed \gset
select set_config('postcheck.organizer_matches', (select count(*) from public.partidos where creado_por::text = current_setting('postcheck.organizer'))::text, true) is not null as stashed \gset
select set_config('postcheck.link_match', coalesce((select id::text from public.partidos where deleted_at is null and codigo is not null
    and coalesce(estado, '') not in ('cancelado', 'cancelled', 'deleted') order by id desc limit 1), ''), true) is not null as stashed \gset
select set_config('postcheck.link_code', coalesce((select codigo from public.partidos where id::text = current_setting('postcheck.link_match')), ''), true) is not null as stashed \gset
select set_config('postcheck.phone_owner', coalesce((select user_id::text from app_private.usuarios_private where telefono is not null order by user_id limit 1), ''), true) is not null as stashed \gset

-- Writing through a view now runs as its owner (the reader can only read): an account must
-- be refused, never write the table as somebody else.
create function pg_temp.view_write_refused() returns boolean language plpgsql as $f$
begin
  update public.partidos_view set nombre = nombre where id = -1;
  return false;
exception when insufficient_privilege then
  return true;
end;
$f$;

-- ---------- as a brand-new account (involved in nothing) ----------
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true) is not null as stashed \gset
set local role authenticated;

select json_build_object('check', 'new account: the table returns no match (it is involved in none)',
  'pass', (select count(*) from public.partidos) = 0, 'value', (select count(*) from public.partidos))::text;

select json_build_object('check', 'new account: partidos_view lists exactly the published matches, every code masked',
  'pass', (select count(*) from public.partidos_view) = current_setting('postcheck.open_matches')::bigint
      and (select count(*) from public.partidos_view where codigo is not null) = 0,
  'value', json_build_object('listed', (select count(*) from public.partidos_view), 'expected', current_setting('postcheck.open_matches')::bigint,
    'codes', (select count(*) from public.partidos_view where codigo is not null)))::text;

select json_build_object('check', 'new account: rosters only of published matches and of teams',
  'pass', (select count(*) from public.jugadores) = current_setting('postcheck.visible_roster')::bigint,
  'value', json_build_object('visible', (select count(*) from public.jugadores), 'expected', current_setting('postcheck.visible_roster')::bigint))::text;

select json_build_object('check', 'new account: other people''s email, phone and birth date read as NULL',
  'pass', (select count(*) from public.usuarios where email is not null or telefono is not null or fecha_nacimiento is not null) = 0
      and (select count(*) from public.usuarios) > 0,
  'value', (select count(*) from public.usuarios))::text;

select json_build_object('check', 'new account: get_match_access_codes gives nothing for a match it is not in',
  'pass', current_setting('postcheck.link_match') = ''
      or (select count(*) from public.get_match_access_codes(array[current_setting('postcheck.link_match')::bigint])) = 0,
  'value', null)::text;

select json_build_object('check', 'new account: cannot write through partidos_view',
  'pass', pg_temp.view_write_refused(), 'value', null)::text;

-- ---------- as anon ----------
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true) is not null as stashed \gset
set local role anon;

select json_build_object('check', 'anon: no rows from partidos, partidos_view or jugadores (and no error)',
  'pass', (select count(*) from public.partidos) = 0 and (select count(*) from public.partidos_view) = 0 and (select count(*) from public.jugadores) = 0,
  'value', null)::text;

select json_build_object('check', 'anon: a WhatsApp/voting link (code + id) still opens its own match',
  'pass', current_setting('postcheck.link_match') = ''
      or (public.resolve_match_by_code(current_setting('postcheck.link_code'))::text = current_setting('postcheck.link_match')
          and (public.public_get_match_by_code(current_setting('postcheck.link_code'), current_setting('postcheck.link_match')::bigint) -> 'partido' ->> 'id') = current_setting('postcheck.link_match')),
  'value', current_setting('postcheck.link_match') <> '')::text;

-- ---------- as the organizer of the latest match ----------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('postcheck.organizer'), 'role', 'authenticated')::text, true) is not null as stashed \gset
set local role authenticated;

select json_build_object('check', 'organizer: reads every match it created, with its code, from the table and the view',
  'pass', current_setting('postcheck.organizer') = ''
      or ((select count(*) from public.partidos where creado_por::text = current_setting('postcheck.organizer')) = current_setting('postcheck.organizer_matches')::bigint
          and (select count(*) from public.partidos where creado_por::text = current_setting('postcheck.organizer') and codigo is null) = 0
          and (select count(*) from public.partidos_view where creado_por::text = current_setting('postcheck.organizer') and codigo is null) = 0),
  'value', current_setting('postcheck.organizer_matches')::bigint)::text;

-- ---------- as an account that has a phone ----------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('postcheck.phone_owner'), 'role', 'authenticated')::text, true) is not null as stashed \gset
set local role authenticated;

select json_build_object('check', 'owner: get_my_profile returns its own phone; the shared row does not',
  'pass', current_setting('postcheck.phone_owner') = ''
      or ((select telefono from public.get_my_profile()) is not null
          and (select telefono from public.usuarios where id::text = current_setting('postcheck.phone_owner')) is null),
  'value', current_setting('postcheck.phone_owner') <> '')::text;

reset role;
rollback;
