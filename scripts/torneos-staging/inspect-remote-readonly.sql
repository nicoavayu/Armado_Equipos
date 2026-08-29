-- Arma2 Torneos Staging remote inspector.
-- Parsed as named statements by inspect-remote-readonly.mjs. Every statement is
-- statically validated before a network connection is opened.
-- node-postgres throws on the first query error, providing ON_ERROR_STOP
-- semantics without executing psql meta-commands.

-- inspector:statement begin_read_only
BEGIN READ ONLY;

-- inspector:statement statement_timeout
SET LOCAL statement_timeout = '5s';

-- inspector:statement lock_timeout
SET LOCAL lock_timeout = '1s';

-- inspector:statement idle_timeout
SET LOCAL idle_in_transaction_session_timeout = '20s';

-- inspector:statement search_path
SET LOCAL search_path = pg_catalog, information_schema, public, storage, supabase_migrations;

-- inspector:statement transaction_guard
SELECT current_setting('transaction_read_only') AS transaction_read_only;

-- inspector:statement role_privileges
SELECT
  current_user AS role_name,
  role_row.rolsuper AS superuser,
  role_row.rolbypassrls AS bypass_rls,
  role_row.rolcreaterole AS create_role,
  role_row.rolcreatedb AS create_database,
  role_row.rolreplication AS replication,
  role_row.rolinherit AS inherit,
  has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
  EXISTS (
    SELECT 1 FROM pg_namespace namespace_row
    WHERE namespace_row.nspname NOT LIKE 'pg_%'
      AND namespace_row.nspname <> 'information_schema'
      AND has_schema_privilege(current_user, namespace_row.oid, 'CREATE')
  ) AS schema_create,
  EXISTS (
    SELECT 1 FROM pg_class relation_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
    WHERE relation_row.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND namespace_row.nspname NOT LIKE 'pg_%'
      AND namespace_row.nspname <> 'information_schema'
      AND has_schema_privilege(current_user, namespace_row.oid, 'USAGE')
      AND (
        has_table_privilege(current_user, relation_row.oid, 'INSERT')
        OR has_table_privilege(current_user, relation_row.oid, 'UPDATE')
        OR has_table_privilege(current_user, relation_row.oid, 'DELETE')
        OR has_table_privilege(current_user, relation_row.oid, 'TRUNCATE')
        OR has_table_privilege(current_user, relation_row.oid, 'REFERENCES')
        OR has_table_privilege(current_user, relation_row.oid, 'TRIGGER')
      )
  ) AS relation_write
FROM pg_roles role_row
WHERE role_row.rolname = current_user;

-- inspector:statement migration_history
SELECT version::text AS version, name::text AS name
FROM supabase_migrations.schema_migrations
ORDER BY version::text, name::text;

-- inspector:statement tables
SELECT namespace_row.nspname AS schema_name, relation_row.relname AS table_name,
  relation_row.relrowsecurity AS rls_enabled, relation_row.relforcerowsecurity AS rls_forced
FROM pg_class relation_row
JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
WHERE relation_row.relkind IN ('r', 'p')
  AND ((namespace_row.nspname = 'public' AND relation_row.relname LIKE 'tournament_%')
    OR (namespace_row.nspname = 'storage' AND relation_row.relname IN ('buckets', 'objects'))
    OR (namespace_row.nspname = 'supabase_migrations' AND relation_row.relname = 'schema_migrations'))
ORDER BY namespace_row.nspname, relation_row.relname;

-- inspector:statement columns
SELECT table_schema AS schema_name, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE (table_schema = 'public' AND table_name LIKE 'tournament_%')
  OR (table_schema = 'storage' AND table_name IN ('buckets', 'objects'))
ORDER BY table_schema, table_name, ordinal_position;

-- inspector:statement functions
SELECT namespace_row.nspname AS schema_name, procedure_row.proname AS function_name,
  pg_get_function_identity_arguments(procedure_row.oid) AS arguments,
  procedure_row.provolatile AS volatility,
  procedure_row.prosecdef AS security_definer,
  owner_row.rolname AS owner,
  COALESCE(procedure_row.proconfig, ARRAY[]::text[]) AS settings
FROM pg_proc procedure_row
JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
JOIN pg_roles owner_row ON owner_row.oid = procedure_row.proowner
WHERE namespace_row.nspname = 'public' AND procedure_row.proname LIKE '%tournament_%'
ORDER BY procedure_row.proname, arguments;

-- inspector:statement grants
SELECT namespace_row.nspname AS schema_name, relation_row.relname AS object_name,
  COALESCE(grantee_row.rolname, 'PUBLIC') AS grantee, acl_row.privilege_type, 'table' AS object_type
FROM pg_class relation_row
JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(relation_row.relacl, acldefault('r', relation_row.relowner))) acl_row
LEFT JOIN pg_roles grantee_row ON grantee_row.oid = acl_row.grantee
WHERE (namespace_row.nspname = 'public' AND relation_row.relname LIKE 'tournament_%')
   OR (namespace_row.nspname = 'storage' AND relation_row.relname = 'objects')
UNION ALL
SELECT namespace_row.nspname, procedure_row.proname,
  COALESCE(grantee_row.rolname, 'PUBLIC'), acl_row.privilege_type, 'routine'
FROM pg_proc procedure_row
JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))) acl_row
LEFT JOIN pg_roles grantee_row ON grantee_row.oid = acl_row.grantee
WHERE namespace_row.nspname = 'public' AND procedure_row.proname LIKE '%tournament_%'
ORDER BY schema_name, object_name, grantee, privilege_type;

-- inspector:statement policies
SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name,
  permissive, roles::text[] AS roles, cmd
FROM pg_policies
WHERE (schemaname = 'public' AND tablename LIKE 'tournament_%')
   OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'tournament_media_%')
ORDER BY schemaname, tablename, policyname;

-- inspector:statement indexes
SELECT namespace_row.nspname AS schema_name, table_row.relname AS table_name,
  index_row.relname AS index_name, index_meta.indisunique AS is_unique,
  index_meta.indisvalid AS is_valid
FROM pg_index index_meta
JOIN pg_class table_row ON table_row.oid = index_meta.indrelid
JOIN pg_class index_row ON index_row.oid = index_meta.indexrelid
JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
WHERE namespace_row.nspname = 'public' AND table_row.relname LIKE 'tournament_%'
ORDER BY table_row.relname, index_row.relname;

-- inspector:statement triggers
SELECT trigger_schema AS schema_name, event_object_table AS table_name,
  trigger_name, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public' AND event_object_table LIKE 'tournament_%'
ORDER BY event_object_table, trigger_name, event_manipulation;

-- inspector:statement constraints
SELECT namespace_row.nspname AS schema_name, table_row.relname AS table_name,
  constraint_row.conname AS constraint_name, constraint_row.contype AS constraint_type,
  CASE WHEN constraint_row.contype = 'f' THEN constraint_row.confrelid::regclass::text ELSE NULL END AS references_table
FROM pg_constraint constraint_row
JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
WHERE namespace_row.nspname = 'public' AND table_row.relname LIKE 'tournament_%'
ORDER BY table_row.relname, constraint_row.conname;

-- inspector:statement storage_bucket
SELECT id::text AS bucket, public, file_size_limit::bigint AS max_file_bytes,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'tournament-media';

-- inspector:statement storage_objects
SELECT
  count(*)::bigint AS total,
  count(*) FILTER (WHERE lower(name) ~ '\.(svg|svgz)$')::bigint AS svg,
  count(*) FILTER (WHERE lower(name) ~ '\.(part|partial|tmp)$')::bigint AS partial,
  count(*) FILTER (WHERE lower(name) ~ '/(thumbnail|grid|detail|original)\.(jpg|jpeg|png|webp)$')::bigint AS variants,
  count(*) FILTER (WHERE lower(name) !~ '/(thumbnail|grid|detail|original)\.(jpg|jpeg|png|webp)$')::bigint AS quarantine
FROM storage.objects
WHERE bucket_id = 'tournament-media';

-- inspector:statement attestations
SELECT service, attested_at, expires_at, capabilities
FROM public.tournament_media_service_attestations
WHERE service IN ('signer', 'processor')
ORDER BY service;

-- inspector:statement readiness
SELECT public.tournament_media_pipeline_readiness() AS readiness;

-- inspector:statement jobs
SELECT status, count(*)::bigint AS count,
  max(EXTRACT(EPOCH FROM (now() - created_at)))::bigint AS maximum_age_seconds,
  count(*) FILTER (WHERE status = 'leased' AND lease_expires_at < now())::bigint AS expired_leases
FROM public.tournament_media_processing_jobs
GROUP BY status
ORDER BY status;

-- inspector:statement sessions
SELECT status, count(*)::bigint AS count,
  max(EXTRACT(EPOCH FROM (now() - created_at)))::bigint AS maximum_age_seconds
FROM public.tournament_media_upload_sessions
GROUP BY status
ORDER BY status;

-- inspector:statement assets
SELECT status, count(*)::bigint AS count
FROM public.tournament_media_assets
GROUP BY status
ORDER BY status;

-- inspector:statement variants
SELECT status, kind, count(*)::bigint AS count
FROM public.tournament_media_variants
GROUP BY status, kind
ORDER BY status, kind;

-- inspector:statement social_permissions
SELECT count(*)::bigint AS count
FROM public.tournament_social_permissions;

-- inspector:statement commit_read_only
COMMIT;
