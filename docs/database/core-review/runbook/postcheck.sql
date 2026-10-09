-- #193 promotion — post-checks. Writes nothing (one transaction, rolled back): run after
-- 20261010138000, and again after any rollback/re-apply. Every line is {check, pass, value};
-- values are counts or true/false, never personal data or codes.
-- It acts as a brand-new account (random id, involved in nothing), as anon, as the organizer
-- of the latest match and as an account that has a phone, through the same roles and claims
-- PostgREST uses.
-- psql -X -A -t -q -v ON_ERROR_STOP=1 -f postcheck.sql   (connected as postgres)
begin;

-- ---------- as postgres: structure and data ----------
select json_build_object('check', 'ledger holds the 26 migrations 20261010119000…145000 (no 144000)',
  'pass', (select count(*) from supabase_migrations.schema_migrations where version between '20261010119000' and '20261010145000') = 26,
  'value', (select count(*) from supabase_migrations.schema_migrations where version between '20261010119000' and '20261010145000'))::text;

select json_build_object('check', '119000: partidos/jugadores SELECT/INSERT carry only the repository policies, the voting tables are not open',
  'pass', not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('partidos', 'jugadores')
             and cmd in ('SELECT', 'INSERT', 'ALL')
             and policyname not in ('partidos_select_authenticated', 'partidos_select_public_shared', 'partidos_select_public_reader',
               'partidos_insert_creator', 'partidos_insert_own', 'jugadores_select_authenticated', 'jugadores_select_public_shared',
               'jugadores_select_public_reader', 'jugadores_insert_self_or_admin'))
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('public_voters', 'votos_publicos')
             and cmd in ('SELECT', 'INSERT') and (qual = 'true' or with_check = 'true'))
      and to_regprocedure('app_private.is_match_admin(bigint,uuid)') is not null,
  'value', (select json_agg(kind || ':' || coalesce(table_name || '.', '') || object_name order by id) from app_private.production_alignment_log
            where kind <> 'untouched_policies_digest'))::text;

select json_build_object('check', '119000: every other policy (UPDATE/DELETE of partidos/jugadores, profiles, amigos, notifications, post_match_surveys, partidos_frecuentes, usuarios…) is exactly as before',
  'pass', not exists (select 1 from app_private.production_alignment_log where kind = 'untouched_policies_digest')
          or (select definition from app_private.production_alignment_log where kind = 'untouched_policies_digest' order by id desc limit 1)
             = (select jsonb_build_object('n', count(*), 'md5', md5(string_agg(format('%s.%s %s %s %s u=%s c=%s', tablename, policyname, permissive, cmd, roles::text, qual, with_check), E'\n' order by tablename, policyname)))
             from pg_policies
             where schemaname = 'public'
               and not (tablename in ('partidos', 'jugadores') and cmd in ('SELECT', 'INSERT', 'ALL'))
               and not (tablename in ('public_voters', 'votos_publicos') and cmd in ('SELECT', 'INSERT'))),
  'value', json_build_object('before', (select definition from app_private.production_alignment_log where kind = 'untouched_policies_digest' order by id desc limit 1),
    'now', (select jsonb_build_object('n', count(*), 'md5', md5(string_agg(format('%s.%s %s %s %s u=%s c=%s', tablename, policyname, permissive, cmd, roles::text, qual, with_check), E'\n' order by tablename, policyname)))
             from pg_policies
             where schemaname = 'public'
               and not (tablename in ('partidos', 'jugadores') and cmd in ('SELECT', 'INSERT', 'ALL'))
               and not (tablename in ('public_voters', 'votos_publicos') and cmd in ('SELECT', 'INSERT')))))::text;

select json_build_object('check', '145000: match notifications only from the organizer and the people of the match (anon cannot call them; checked wrappers; originals moved unchanged)',
  'pass', not has_function_privilege('anon', 'public.enqueue_partido_notification(bigint,text,text,text,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)', 'execute')
      and (to_regprocedure('public.add_creator_to_match(uuid)') is null or not has_function_privilege('anon', 'public.add_creator_to_match(uuid)', 'execute'))
      and (select not prosecdef and prosrc ~ 'assert_match_notification_allowed' from pg_proc where oid = 'public.enqueue_partido_notification(bigint,text,text,text,jsonb)'::regprocedure)
      and (select not prosecdef and prosrc ~ 'assert_match_notification_allowed' from pg_proc where oid = 'public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)'::regprocedure)
      and (select prosecdef from pg_proc where oid = 'app_private.enqueue_partido_notification_unchecked(bigint,text,text,text,jsonb)'::regprocedure)
      and not has_function_privilege('anon', 'app_private.enqueue_partido_notification_unchecked(bigint,text,text,text,jsonb)', 'execute'),
  'value', json_build_object('authenticated_can_call', has_function_privilege('authenticated', 'public.enqueue_partido_notification(bigint,text,text,text,jsonb)', 'execute')))::text;

select json_build_object('check', '143000: full roster entries only for organizer and roster (views, both RPCs, the table)',
  'pass', to_regprocedure('app_private.match_roster_identity_visible(bigint,uuid)') is not null
      and (select pg_get_expr(polqual, polrelid) ~ 'match_roster_identity_visible' and pg_get_expr(polqual, polrelid) !~ 'match_involves_user'
           from pg_policy where polrelid = 'public.jugadores'::regclass and polname = 'jugadores_select_authenticated')
      and (select prosrc ~ 'match_roster_identity_visible' from pg_proc where oid = 'public.public_get_match_by_code(text,bigint)'::regprocedure)
      and (select prosrc ~ 'match_roster_identity_visible' from pg_proc where oid = 'public.get_public_match_roster(bigint)'::regprocedure)
      and (select prosrc ~ 'responsabilidad_score' from pg_proc where oid = 'app_private.roster_entry_json(jsonb,uuid,boolean)'::regprocedure)
      and not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
                      and pg_get_viewdef(oid) ~ 'roster_entry_json' and pg_get_viewdef(oid) !~ 'match_roster_identity_visible'),
  'value', null)::text;

select json_build_object('check', '142000: request-scoped notices keep no partido_id (one notice per join request)',
  'pass', to_regprocedure('public.fn_notifications_fill_partido_id()') is null
      or position('match_join_request' in pg_get_functiondef('public.fn_notifications_fill_partido_id()'::regprocedure)) > 0,
  'value', to_regprocedure('public.fn_notifications_fill_partido_id()') is not null)::text;

select json_build_object('check', '141000: organizers can approve join requests (approve_join_request executable by accounts, not anon; it keeps its own creator check)',
  'pass', has_function_privilege('authenticated', 'public.approve_join_request(bigint)', 'execute')
      and not has_function_privilege('anon', 'public.approve_join_request(bigint)', 'execute'),
  'value', has_function_privilege('authenticated', 'public.approve_join_request(bigint)', 'execute'))::text;

select json_build_object('check', '140000: published rosters per involvement; entries built for the viewer; self-join, self-update and request guards in place',
  'pass', (select pg_get_expr(polqual, polrelid) !~ 'match_is_publicly_open' from pg_policy where polrelid = 'public.jugadores'::regclass and polname = 'jugadores_select_authenticated')
      and (select pg_get_expr(polwithcheck, polrelid) ~ 'may_self_join_match' from pg_policy where polrelid = 'public.jugadores'::regclass and polname = 'jugadores_insert_self_or_admin')
      and (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2')
             and pg_get_viewdef(oid) ~ 'roster_entry' and pg_get_userbyid(relowner) = 'core_match_public_reader') = 2
      and (select prosrc ~ 'roster_entry' from pg_proc where oid = 'public.public_get_match_by_code(text,bigint)'::regprocedure)
      and exists (select 1 from pg_trigger where tgname = 'trg_jugadores_self_update_guard' and tgrelid = 'public.jugadores'::regclass)
      and exists (select 1 from pg_trigger where tgname = 'trg_match_join_request_insert_guard' and tgrelid = 'public.match_join_requests'::regclass)
      and not (select prosecdef from pg_proc where oid = 'app_private.tg_jugadores_self_update_guard()'::regprocedure)
      and not (select prosecdef from pg_proc where oid = 'app_private.tg_match_join_request_insert_guard()'::regprocedure)
      and has_function_privilege('authenticated', 'public.get_public_match_roster(bigint)', 'execute')
      and not has_function_privilege('anon', 'public.get_public_match_roster(bigint)', 'execute'),
  'value', null)::text;

select json_build_object('check', '135000: no email, phone or birth date left in the shared rows',
  'pass', (select count(*) from public.usuarios where email is not null or telefono is not null or fecha_nacimiento is not null) = 0
      and (select count(*) from public.profiles pr where to_jsonb(pr) ->> 'telefono' is not null) = 0,
  'value', json_build_object('usuarios', (select count(*) from public.usuarios where email is not null or telefono is not null or fecha_nacimiento is not null),
    'profiles', (select count(*) from public.profiles pr where to_jsonb(pr) ->> 'telefono' is not null)))::text;

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

-- A function inside a view runs with the caller's EXECUTE: without these, anon reading
-- partidos_view gets "permission denied" instead of no rows (e.g. if 136000's helpers were
-- created by another role, 137000's grants as postgres would be no-ops).
select json_build_object('check', '137000: anon and authenticated can execute every function the match views call',
  'pass', bool_and(has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute')),
  'value', json_object_agg(f::text, has_function_privilege('anon', f, 'execute')))::text
from unnest(array[
  'public.partido_is_operationally_open(text,timestamp with time zone,text,text,timestamp with time zone,date,text,boolean,timestamp with time zone)'::regprocedure,
  'public.partido_kickoff_at(date,text)'::regprocedure, 'public.normalize_partido_estado(text)'::regprocedure,
  'app_private.request_user_id()'::regprocedure, 'app_private.match_involves_user(bigint,uuid)'::regprocedure,
  'app_private.match_is_publicly_open(bigint)'::regprocedure, 'app_private.match_access_code(bigint)'::regprocedure]) f;

select json_build_object('check', '138000: a guest photo slot belongs to its first session',
  'pass', (select prosrc ~ 'pg_advisory_xact_lock' and prosrc ~ 'public_voters' from pg_proc where oid = 'public.bind_voting_photo_slot(bigint,text,bigint)'::regprocedure),
  'value', null)::text;

select json_build_object('check', '139000: no added_by in public.jugadores; who added whom lives only in app_private, recorded by an AFTER INSERT trigger',
  'pass', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jugadores' and column_name = 'added_by')
      and to_regclass('app_private.jugadores_added_by') is not null
      and not has_table_privilege('authenticated', 'app_private.jugadores_added_by', 'select')
      and not has_table_privilege('anon', 'app_private.jugadores_added_by', 'select')
      and exists (select 1 from pg_trigger where tgname = 'trg_jugadores_added_by' and tgrelid = 'public.jugadores'::regclass and not tgisinternal and (tgtype & 2) = 0 and (tgtype & 1) = 1),
  'value', (select count(*) from app_private.jugadores_added_by))::text;

select json_build_object('check', '134000: partidos.template_id has the type of partidos_frecuentes.id, references it, owner trigger in place',
  'pass', (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.partidos'::regclass and a.attname = 'template_id' and not a.attisdropped)
          = (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.partidos_frecuentes'::regclass and a.attname = 'id' and not a.attisdropped)
      and exists (select 1 from pg_constraint where conname = 'partidos_template_id_fkey' and conrelid = 'public.partidos'::regclass)
      and exists (select 1 from pg_trigger where tgname = 'partidos_template_owner' and tgrelid = 'public.partidos'::regclass),
  'value', (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.partidos'::regclass and a.attname = 'template_id' and not a.attisdropped))::text;

select json_build_object('check', '131000: survey finalization scheduled every 5 minutes',
  'pass', exists (select 1 from cron.job where jobname = 'survey_finalization_backend_scheduler' and active and schedule = '*/5 * * * *'),
  'value', (select count(*) from cron.job where active))::text;

-- Expected values for the role checks, computed with full visibility and stashed in this
-- transaction (set_config(..., true) ends with it). Nothing is printed.
select set_config('postcheck.open_matches', (select count(*) from public.partidos p where p.deleted_at is null
    and public.partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at, p.fecha, p.hora,
      coalesce(p.falta_jugadores, false) or coalesce(p.busca_arquero, false), now()))::text, true) is not null as stashed \gset
select set_config('postcheck.visible_roster', (select count(*) from public.jugadores j where j.partido_id is null and j.match_ref is null)::text, true) is not null as stashed \gset
-- an account with a pending join request that is neither organizer nor in the roster (143000)
select set_config('postcheck.pending_requester', coalesce((select r.user_id::text || ':' || r.match_id from public.match_join_requests r
    where r.status = 'pending' and not app_private.match_roster_identity_visible(r.match_id, r.user_id) order by r.id desc limit 1), ''), true) is not null as stashed \gset
select set_config('postcheck.open_match', coalesce((select p.id::text from public.partidos p where p.deleted_at is null
    and public.partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at, p.fecha, p.hora,
      coalesce(p.falta_jugadores, false) or coalesce(p.busca_arquero, false), now()) order by p.id desc limit 1), ''), true) is not null as stashed \gset
select set_config('postcheck.organizer', coalesce((select creado_por::text from public.partidos where creado_por is not null and deleted_at is null order by id desc limit 1), ''), true) is not null as stashed \gset
select set_config('postcheck.organizer_matches', (select count(*) from public.partidos where creado_por::text = current_setting('postcheck.organizer'))::text, true) is not null as stashed \gset
select set_config('postcheck.link_match', coalesce((select id::text from public.partidos where deleted_at is null and codigo is not null
    and coalesce(estado, '') not in ('cancelado', 'cancelled', 'deleted') order by id desc limit 1), ''), true) is not null as stashed \gset
select set_config('postcheck.link_code', coalesce((select codigo from public.partidos where id::text = current_setting('postcheck.link_match')), ''), true) is not null as stashed \gset
select set_config('postcheck.phone_owner', coalesce((select user_id::text from app_private.usuarios_private where telefono is not null order by user_id limit 1), ''), true) is not null as stashed \gset

-- Writing through a view now runs as its owner (the reader can only read): an account must
-- be refused, never write the table as somebody else.
-- 140000: an account outside a published match can neither insert itself into its roster nor
-- file a request that is already approved (both refused with insufficient_privilege).
create function pg_temp.self_join_refused(p_match bigint) returns boolean language plpgsql as $f$
begin
  insert into public.jugadores (partido_id, usuario_id, nombre) values (p_match, auth.uid(), 'Postcheck');
  return false;
exception when insufficient_privilege then
  return true;
end;
$f$;
create function pg_temp.approved_request_refused(p_match bigint) returns boolean language plpgsql as $f$
begin
  insert into public.match_join_requests (match_id, user_id, status, role) values (p_match, auth.uid(), 'approved', 'player');
  return false;
exception when insufficient_privilege then
  return true;
end;
$f$;

create function pg_temp.view_write_refused() returns boolean language plpgsql as $f$
begin
  update public.partidos_view set nombre = nombre where id = -1;
  return false;
exception when insufficient_privilege then
  return true;
end;
$f$;

-- A roster entry as an outsider sees it (143000): no usuario_id/score/responsabilidad_score, and
-- the uuid key is md5('arma2-roster-entry:' || id), never the stored value.
create function pg_temp.entry_not_opaque(p_entry jsonb) returns boolean language sql as $f$
  select p_entry ? 'usuario_id' or p_entry ? 'score' or p_entry ? 'responsabilidad_score'
      or (p_entry ? 'uuid' and p_entry ->> 'uuid' is distinct from md5('arma2-roster-entry:' || (p_entry ->> 'id'))::uuid::text)
$f$;
grant execute on function pg_temp.entry_not_opaque(jsonb) to public;

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

select json_build_object('check', 'new account: no usuario_id or score in any roster entry (views, Quiero jugar, public roster RPC, link code)',
  'pass', (select count(*) from public.partidos_abiertos_operativos_v2 v, jsonb_array_elements(v.jugadores) e where e ? 'usuario_id' or e ? 'score') = 0
      and (select count(*) from public.partidos_abiertos_operativos v, jsonb_array_elements(v.jugadores) e where e ? 'usuario_id' or e ? 'score') = 0
      and (select count(*) from public.partidos_abiertos_operativos_v2 v, jsonb_array_elements(public.get_public_match_roster(v.id)) e where e ? 'usuario_id' or e ? 'score') = 0
      and (current_setting('postcheck.link_match') = ''
           or (select count(*) from jsonb_array_elements(public.public_get_match_by_code(current_setting('postcheck.link_code'), current_setting('postcheck.link_match')::bigint) -> 'jugadores') e
               where e ? 'usuario_id' or e ? 'score') = 0),
  'value', json_build_object('entries_in_views', (select count(*) from public.partidos_abiertos_operativos_v2 v, jsonb_array_elements(v.jugadores) e)))::text;

select json_build_object('check', '143000 new account: no responsabilidad_score, and every roster uuid is the opaque per-row key (never an account id)',
  'pass', (select count(*) from public.partidos_abiertos_operativos_v2 v, jsonb_array_elements(v.jugadores) e where pg_temp.entry_not_opaque(e)) = 0
      and (select count(*) from public.partidos_view v, jsonb_array_elements(coalesce(to_jsonb(v) -> 'jugadores', '[]'::jsonb)) e where pg_temp.entry_not_opaque(e)) = 0
      and (select count(*) from public.partidos_abiertos_operativos_v2 v, jsonb_array_elements(public.get_public_match_roster(v.id)) e where pg_temp.entry_not_opaque(e)) = 0
      and (current_setting('postcheck.link_match') = ''
           or (select count(*) from jsonb_array_elements(public.public_get_match_by_code(current_setting('postcheck.link_code'), current_setting('postcheck.link_match')::bigint) -> 'jugadores') e
               where pg_temp.entry_not_opaque(e)) = 0),
  'value', null)::text;

select json_build_object('check', 'new account: cannot join a published match by inserting itself, nor file an approved request',
  'pass', current_setting('postcheck.open_match') = ''
      or (pg_temp.self_join_refused(current_setting('postcheck.open_match')::bigint)
          and pg_temp.approved_request_refused(current_setting('postcheck.open_match')::bigint)),
  'value', current_setting('postcheck.open_match') <> '')::text;

select json_build_object('check', 'new account: no match roster from the table, only team rows',
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

select json_build_object('check', 'anon: the link code gives roster entries without usuario_id or score',
  'pass', current_setting('postcheck.link_match') = ''
      or (select count(*) from jsonb_array_elements(public.public_get_match_by_code(current_setting('postcheck.link_code'), current_setting('postcheck.link_match')::bigint) -> 'jugadores') e
          where e ? 'usuario_id' or e ? 'score') = 0,
  'value', null)::text;

select json_build_object('check', '143000 anon: link entries carry no account id or responsabilidad_score',
  'pass', current_setting('postcheck.link_match') = ''
      or (select count(*) from jsonb_array_elements(public.public_get_match_by_code(current_setting('postcheck.link_code'), current_setting('postcheck.link_match')::bigint) -> 'jugadores') e
          where pg_temp.entry_not_opaque(e)) = 0,
  'value', null)::text;

select json_build_object('check', 'anon: a WhatsApp/voting link (code + id) still opens its own match',
  'pass', current_setting('postcheck.link_match') = ''
      or (public.resolve_match_by_code(current_setting('postcheck.link_code'))::text = current_setting('postcheck.link_match')
          and (public.public_get_match_by_code(current_setting('postcheck.link_code'), current_setting('postcheck.link_match')::bigint) -> 'partido' ->> 'id') = current_setting('postcheck.link_match')),
  'value', current_setting('postcheck.link_match') <> '')::text;

-- ---------- as an account with only a pending join request (143000) ----------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', split_part(current_setting('postcheck.pending_requester'), ':', 1), 'role', 'authenticated')::text, true) is not null as stashed \gset
set local role authenticated;

select json_build_object('check', '143000 pending requester: masked entries from the roster RPC and no roster rows from the table',
  'pass', current_setting('postcheck.pending_requester') = ''
      or ((select count(*) from jsonb_array_elements(public.get_public_match_roster(split_part(current_setting('postcheck.pending_requester'), ':', 2)::bigint)) e
           where pg_temp.entry_not_opaque(e) and not coalesce((e ->> 'is_me')::boolean, false)) = 0
          and (select count(*) from public.jugadores where partido_id = split_part(current_setting('postcheck.pending_requester'), ':', 2)::bigint
               and usuario_id is distinct from auth.uid()) = 0),
  'value', current_setting('postcheck.pending_requester') <> '')::text;

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
