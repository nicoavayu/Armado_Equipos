select json_build_object(
 'db', current_database(), 'user', current_user, 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null and to_regclass('public.tournament_organizations') is not null,
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'social', (select json_object_agg(p.oid::regprocedure::text, json_build_object('md5', md5(p.prosrc), 'secdef', p.prosecdef, 'volatile', p.provolatile,
     'config', p.proconfig, 'owner', pg_get_userbyid(p.proowner),
     'exec', json_build_object('anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
       'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%social%'),
 'other_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,'-')||':'||pg_get_userbyid(p.proowner)||':'||p.prosecdef::text||':'||coalesce(p.proconfig::text,'-'), ',' order by p.oid::regprocedure::text)))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.oid <> 'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)'::regprocedure),
 'relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname||'.'||c.relname||':'||c.relkind::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'-')||':'||pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m','p','f','S')),
 'policies', (select json_build_object('count', count(*), 'digest', md5(string_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'-')||':'||coalesce(with_check,'-'), ',' order by schemaname, tablename, policyname)))
   from pg_policies where schemaname in ('public','private'))
)
