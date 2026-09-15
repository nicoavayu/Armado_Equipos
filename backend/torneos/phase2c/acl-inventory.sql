-- Phase 2C effective-privilege inventory of an installed candidate (one JSON document).
-- Read-only; evaluates has_*_privilege for the API roles, the platform role and the
-- baseline's NOLOGIN roles on every public/private function, sequence and relation.
SELECT jsonb_pretty(jsonb_build_object(
 'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'schema',n.nspname,'type',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY r.rolname,n.nspname,d.defaclobjtype),'[]')
   FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
   WHERE n.nspname IN ('public','private') OR n.nspname IS NULL),
 'functions',(SELECT jsonb_agg(jsonb_build_object(
   'function',p.oid::regprocedure::text,'schema',n.nspname,'name',p.proname,'security_definer',p.prosecdef,
   'owner',pg_get_userbyid(p.proowner),'settings',p.proconfig,'acl',p.proacl::text,
   'public',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
   'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
   'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'),
   'postgres',has_function_privilege('postgres',p.oid,'EXECUTE'),
   'torneos_core_adapter',has_function_privilege('torneos_core_adapter',p.oid,'EXECUTE'),
   'torneos_identity_writer',has_function_privilege('torneos_identity_writer',p.oid,'EXECUTE'),
   'trigger_used',EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal)
  ) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'),
 'sequences',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'sequence',n.nspname||'.'||c.relname,'acl',c.relacl::text,
   'anon',ARRAY(SELECT x FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) x WHERE has_sequence_privilege('anon',c.oid,x)),
   'authenticated',ARRAY(SELECT x FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) x WHERE has_sequence_privilege('authenticated',c.oid,x)),
   'service_role',ARRAY(SELECT x FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) x WHERE has_sequence_privilege('service_role',c.oid,x)),
   'postgres',ARRAY(SELECT x FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) x WHERE has_sequence_privilege('postgres',c.oid,x))
  ) ORDER BY n.nspname,c.relname),'[]')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind='S'),
 'relations',(SELECT jsonb_agg(jsonb_build_object(
   'relation',n.nspname||'.'||c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'acl',c.relacl::text,
   'anon',ARRAY(SELECT x FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) x WHERE has_table_privilege('anon',c.oid,x)),
   'authenticated',ARRAY(SELECT x FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) x WHERE has_table_privilege('authenticated',c.oid,x)),
   'service_role',ARRAY(SELECT x FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) x WHERE has_table_privilege('service_role',c.oid,x)),
   'postgres',ARRAY(SELECT x FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) x WHERE has_table_privilege('postgres',c.oid,x))
  ) ORDER BY n.nspname,c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','v','m')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('role',rolname,'superuser',rolsuper,'createrole',rolcreaterole,'bypassrls',rolbypassrls,'login',rolcanlogin,'inherit',rolinherit,
   'member_of',(SELECT coalesce(jsonb_agg(g.rolname ORDER BY g.rolname),'[]') FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid)) ORDER BY rolname)
  FROM pg_roles r WHERE rolname IN ('anon','authenticated','service_role','authenticator','postgres','supabase_admin','torneos_core_adapter','torneos_identity_writer')),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','private','extensions'))
));
