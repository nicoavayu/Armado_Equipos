with tracked(name, sig) as (values
  -- ACCOUNT ERASURE 0021 operator catalog (read only): one JSON row consumed by db-0021.mjs classify() / changedOutside().
  ('erase', 'private.erase_tournament_account(uuid,uuid)'),
  ('confirm', 'private.confirm_tournament_account_erasure(uuid,uuid)'),
  ('label', 'private.account_erasure_label(text,uuid,uuid)')),
erasure_role as (select r.* from pg_roles r where r.rolname = 'torneos_erasure_writer'),
guards(rel, trigger) as (values
  ('public.torneos_identity', 'torneos_identity_immutable'),
  ('public.tournament_organization_members', 'tournament_organization_members_protect_owner'),
  ('public.tournament_match_squad_players', 'tournament_match_squad_players_history_guard'),
  ('public.tournament_match_squad_players', 'tournament_squad_player_suspension_guard'),
  ('public.tournament_match_squad_players', 'tournament_match_squad_players_scope_guard'),
  ('public.tournament_match_operation_players', 'tournament_match_operation_players_completed_guard'),
  ('public.tournament_match_operation_players', 'tournament_match_operation_players_history_guard'),
  ('public.tournament_match_operation_players', 'tournament_operation_player_suspension_guard'),
  ('public.tournament_match_availability_responses', 'tournament_match_availability_scope_guard')),
fns as (select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private'))
select json_build_object(
 'db', current_database(), 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null,
 'prerequisites', json_build_object(
   'connected_v1', to_regclass('public.tournament_user_profiles') is not null and to_regclass('public.tournament_team_applications') is not null,
   'core_adapter_role', exists (select 1 from pg_roles where rolname = 'torneos_core_adapter'),
   'identity_trigger', to_regprocedure('private.prevent_identity_reassignment()') is not null,
   -- Every guard the erasure toggles exists, is enabled, and sits on a table the installer (this session) owns.
   'guards', (select json_agg(json_build_object('rel', g.rel, 'trigger', g.trigger,
       'enabled', (select t.tgenabled::text from pg_trigger t where t.tgrelid = to_regclass(g.rel) and t.tgname = g.trigger),
       'owned_by_installer', (select pg_get_userbyid(c.relowner) = current_user from pg_class c where c.oid = to_regclass(g.rel)))
     order by g.rel, g.trigger) from guards g),
   'sponsors_0020', to_regclass('public.tournament_organization_sponsors') is not null),
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind = 'f'),
 'bodies', (select json_object_agg(t.name, (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'acl', (select json_object_agg(t.name, (select json_build_object(
     'secdef', p.prosecdef, 'config', p.proconfig,
     'owner_is_installer', pg_get_userbyid(p.proowner) = current_user,
     'erasure_writer', coalesce((select has_function_privilege(r.oid, p.oid, 'EXECUTE') from erasure_role r), false),
     'core_adapter', has_function_privilege('torneos_core_adapter', p.oid, 'EXECUTE'),
     'identity_writer', has_function_privilege('torneos_identity_writer', p.oid, 'EXECUTE'),
     'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
     'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'))
   from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'table', (select json_build_object(
     'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
     'client_grants', has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('torneos_core_adapter', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('torneos_identity_writer', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or coalesce((select has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') from erasure_role r), false),
     'policies', (select count(*) from pg_policies where schemaname = 'private' and tablename = 'tournament_account_erasures'))
   from pg_class c where c.oid = to_regclass('private.tournament_account_erasures')),
 -- The erasure role (0021): its attributes and EVERY privilege it holds in public / private / storage, by name. Its
 -- logins (members) are provisioned out of band: counted for the operator, never part of the state.
 'erasure_role', (select json_build_object(
     'login', r.rolcanlogin, 'inherit', r.rolinherit,
     'attributes', r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls,
     'member_of', (select count(*) from pg_auth_members m where m.member = r.oid),
     'schemas', (select coalesce(json_agg(n.nspname order by n.nspname), '[]') from pg_namespace n
       where n.nspname in ('public', 'private', 'storage') and exists (select 1 from aclexplode(n.nspacl) a where a.grantee = r.oid)),
     'functions', (select coalesce(json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '[]') from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private', 'storage') and exists (select 1 from aclexplode(p.proacl) a where a.grantee = r.oid)),
     'relations', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private', 'storage') and exists (select 1 from aclexplode(c.relacl) a where a.grantee = r.oid)))
   from erasure_role r),
 -- (the installer's own ADMIN membership from CREATE ROLE, PostgreSQL 16+, is not a login of the role: left out)
 'erasure_role_logins', (select coalesce(json_agg(l.rolname order by l.rolname), '[]') from pg_auth_members m join erasure_role r on m.roleid = r.oid
   join pg_roles l on l.oid = m.member where l.rolname <> current_user),
 -- A row count only (never ids or hashes): undoing 0021 is refused while the ledger has rows.
 'rows', case when to_regclass('private.tournament_account_erasures') is null then null
   else (xpath('/row/c/text()', query_to_xml('select count(*) as c from private.tournament_account_erasures', false, true, '')))[1]::text::bigint end,
 -- What 0021 must never move: every other function (body, ACL, owner, secdef flag, config), relation, policy, trigger.
 'kept_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(f.sig || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-'), ',' order by f.sig)))
   from fns f join pg_proc p on p.oid = f.oid
   where f.oid not in (select to_regprocedure(t.sig) from tracked t where to_regprocedure(t.sig) is not null)),
 'kept_relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '-') || ':' || pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private', 'storage') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
     and c.oid is distinct from to_regclass('private.tournament_account_erasures')),
 'kept_policies', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' order by schemaname, tablename, policyname), '')))
   from pg_policies where schemaname in ('public', 'private', 'storage')),
 'kept_triggers', (select json_build_object('count', count(*), 'digest', md5(string_agg(t.tgrelid::regclass::text || '.' || t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), ',' order by t.tgrelid::regclass::text, t.tgname)))
   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public', 'private'))
)::text
