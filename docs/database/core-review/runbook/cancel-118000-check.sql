-- Checks for 20261010118000 (only the organizer cancels a match), read-only: one transaction
-- that is rolled back. Run as postgres before and after applying it. Prints one JSON line per
-- check; "pass" must be true for the phase being run (see CANCEL-URGENT.md).
-- No match is cancelled: the refusals stop before anything is written, and the organizer path
-- is exercised only in the rehearsal (integration/prod-schema/cancel-118000-smoke.sql).
\set ON_ERROR_STOP on
begin;
create function pg_temp.refused(p_role text, p_sub uuid, p_match bigint) returns boolean language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  execute format('set local role %I', p_role);
  perform public.cancel_partido_with_notification(p_match, 'check');
  execute 'reset role';
  return false;
exception when insufficient_privilege then
  return true;
end;
$f$;

select json_build_object('phase', 'before', 'check', 'body is the reviewed one (md5 3651c2dc…) or already guarded',
  'pass', (select md5(prosrc) = '3651c2dc0a7d0543730dbb541eeaa91a' or prosrc ~ '20261010118000' from pg_proc where oid = 'public.cancel_partido_with_notification(bigint,text)'::regprocedure),
  'value', (select md5(prosrc) from pg_proc where oid = 'public.cancel_partido_with_notification(bigint,text)'::regprocedure))::text;
select json_build_object('phase', 'before', 'check', 'informative: today''s ACL and owner (the rollback restores this ACL)',
  'pass', true,
  'value', (select json_build_object('acl', coalesce(proacl::text, 'default'), 'owner', pg_get_userbyid(proowner), 'oid', oid::bigint)
            from pg_proc where oid = 'public.cancel_partido_with_notification(bigint,text)'::regprocedure))::text;
select json_build_object('phase', 'before', 'check', 'informative: 20261010118000 in the ledger?',
  'pass', true, 'value', exists (select 1 from supabase_migrations.schema_migrations where version = '20261010118000'))::text;

select json_build_object('phase', 'after', 'check', 'ledger has 20261010118000; the body carries the organizer guard; still SECURITY DEFINER',
  'pass', exists (select 1 from supabase_migrations.schema_migrations where version = '20261010118000')
      and (select prosrc ~ '20261010118000' and prosecdef from pg_proc where oid = 'public.cancel_partido_with_notification(bigint,text)'::regprocedure),
  'value', null)::text;
select json_build_object('phase', 'after', 'check', 'anon (and PUBLIC) cannot execute it; service_role still can',
  'pass', not has_function_privilege('anon', 'public.cancel_partido_with_notification(bigint,text)', 'execute')
      and has_function_privilege('service_role', 'public.cancel_partido_with_notification(bigint,text)', 'execute'),
  'value', json_build_object('authenticated', has_function_privilege('authenticated', 'public.cancel_partido_with_notification(bigint,text)', 'execute')))::text;
select json_build_object('phase', 'after', 'check', 'a signed-in account that is not the organizer is refused (42501) on the latest match',
  'pass', pg_temp.refused('authenticated', gen_random_uuid(), (select max(id) from public.partidos)),
  'value', null)::text;
rollback;
