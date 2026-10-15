with tracked(name, sig) as (values
  -- PREMIUM SPONSORS 0020 operator catalog (read only): one JSON row consumed by db-0020.mjs classify() / changedOutside().
  ('in_use', 'private.tournament_branding_object_in_use(text)'),
  ('entitled', 'private.tournament_sponsors_entitled(uuid,uuid,uuid)'),
  ('get', 'public.get_tournament_organization_sponsors(uuid,uuid)'),
  ('upsert', 'public.upsert_tournament_organization_sponsor(uuid,uuid,text,text,integer)'),
  ('archive', 'public.archive_tournament_organization_sponsor(uuid,uuid)'),
  ('authorize', 'public.authorize_tournament_social_sponsors(uuid,uuid,text,uuid[])')),
fns as (select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private'))
select json_build_object(
 'db', current_database(), 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null,
 'prerequisites', json_build_object(
   'media_store', to_regprocedure('public.authorize_tournament_storage_objects(text,text,text[])') is not null,
   'season_lifecycle', to_regprocedure('private.tournament_season_media_open(uuid,uuid)') is not null,
   'sponsors_capability', exists (select 1 from public.tournament_entitlement_capabilities
     where capability = 'sponsors' and premium_enabled and not free_enabled)),
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'bodies', (select json_object_agg(t.name, (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'acl', (select json_object_agg(t.name, (select json_build_object(
     'secdef', p.prosecdef, 'config', p.proconfig,
     'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
     'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'))
   from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'table', (select json_build_object(
     'rls', c.relrowsecurity,
     'api_grants', has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
     'policies', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tournament_organization_sponsors'))
   from pg_class c where c.oid = to_regclass('public.tournament_organization_sponsors')),
 -- A row count only (never names or paths): undoing 0020 is refused while any row exists.
 'rows', case when to_regclass('public.tournament_organization_sponsors') is null then null
   else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.tournament_organization_sponsors', false, true, '')))[1]::text::bigint end,
 'buckets', (select json_object_agg(b.id, json_build_object('public', b.public, 'limit', b.file_size_limit, 'mime', b.allowed_mime_types))
   from storage.buckets b where b.id = 'tournament-branding'),
 -- What 0020 must never move: every other function (body, ACL, owner, secdef flag, config), relation and policy.
 'kept_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(f.sig || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-'), ',' order by f.sig)))
   from fns f join pg_proc p on p.oid = f.oid
   where f.oid not in (select to_regprocedure(t.sig) from tracked t where to_regprocedure(t.sig) is not null)),
 'kept_relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '-') || ':' || pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private', 'storage') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
     and c.oid is distinct from to_regclass('public.tournament_organization_sponsors')),
 'kept_policies', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' order by schemaname, tablename, policyname), '')))
   from pg_policies where schemaname in ('public', 'private', 'storage'))
)::text
