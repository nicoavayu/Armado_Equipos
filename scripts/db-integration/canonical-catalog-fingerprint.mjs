#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const MAX_BUFFER = 64 * 1024 * 1024;

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with ${result.status}`);
  }
  return result.stdout;
};

export const resolveLocalDatabase = (repoRoot = process.cwd()) => {
  const status = run(
    'npx',
    ['--no-install', 'supabase', 'status', '-o', 'env'],
    { cwd: repoRoot },
  );
  const localEnv = Object.fromEntries(
    status
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
  if (!localEnv.DB_URL) throw new Error('Supabase local did not expose DB_URL.');

  const parsed = new URL(localEnv.DB_URL);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('Catalog fingerprinting is restricted to a loopback Supabase database.');
  }
  const container = run(
    'docker',
    ['ps', '--filter', `publish=${parsed.port}`, '--format', '{{.Names}}'],
  )
    .split('\n')
    .find((name) => name.startsWith('supabase_db_'));
  if (!container) throw new Error(`No local Supabase database publishes port ${parsed.port}.`);

  return { dbUrl: localEnv.DB_URL, container };
};

const queryJson = (container, query) => {
  const output = run('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ]).trim();
  return JSON.parse(output || '[]');
};

const queries = {
  relations: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        relation.relname as relation_name,
        relation.relkind::text as relation_kind,
        relation.relpersistence::text as persistence,
        relation.relrowsecurity as row_security,
        relation.relforcerowsecurity as force_row_security,
        case
          when relation.relkind in ('v', 'm') then pg_get_viewdef(relation.oid, false)
          else null
        end as view_definition
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm', 'S')
    ) item;
  `,
  columns: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name, item.ordinal), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        relation.relname as relation_name,
        attribute.attnum as ordinal,
        attribute.attname as column_name,
        format_type(attribute.atttypid, attribute.atttypmod) as data_type,
        attribute.attnotnull as not_null,
        attribute.attidentity::text as identity_kind,
        attribute.attgenerated::text as generated_kind,
        pg_get_expr(default_value.adbin, default_value.adrelid) as default_expression,
        collation_row.collname as collation_name
      from pg_attribute attribute
      join pg_class relation on relation.oid = attribute.attrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      left join pg_attrdef default_value
        on default_value.adrelid = attribute.attrelid
       and default_value.adnum = attribute.attnum
      left join pg_collation collation_row on collation_row.oid = attribute.attcollation
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm')
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) item;
  `,
  constraints: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name, item.constraint_name), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        relation.relname as relation_name,
        constraint_row.conname as constraint_name,
        constraint_row.contype::text as constraint_type,
        constraint_row.condeferrable as deferrable,
        constraint_row.condeferred as initially_deferred,
        constraint_row.convalidated as validated,
        pg_get_constraintdef(constraint_row.oid, false) as definition
      from pg_constraint constraint_row
      join pg_class relation on relation.oid = constraint_row.conrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
    ) item;
  `,
  types: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.type_name, item.enum_order), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        type_row.typname as type_name,
        type_row.typtype::text as type_kind,
        format_type(type_row.typbasetype, type_row.typtypmod) as base_type,
        type_row.typnotnull as not_null,
        pg_get_expr(type_row.typdefaultbin, 0) as default_expression,
        enum_row.enumsortorder as enum_order,
        enum_row.enumlabel as enum_label
      from pg_type type_row
      join pg_namespace namespace on namespace.oid = type_row.typnamespace
      left join pg_enum enum_row on enum_row.enumtypid = type_row.oid
      where namespace.nspname = 'public'
        and type_row.typtype in ('d', 'e')
    ) item;
  `,
  functions: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.function_name, item.identity_arguments), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        procedure_row.proname as function_name,
        pg_get_function_identity_arguments(procedure_row.oid) as identity_arguments,
        pg_get_function_result(procedure_row.oid) as result_type,
        language.lanname as language,
        procedure_row.prokind::text as procedure_kind,
        procedure_row.prosecdef as security_definer,
        procedure_row.proleakproof as leakproof,
        procedure_row.proisstrict as strict,
        procedure_row.provolatile::text as volatility,
        procedure_row.proparallel::text as parallel_safety,
        procedure_row.proconfig as runtime_config,
        pg_get_functiondef(procedure_row.oid) as definition
      from pg_proc procedure_row
      join pg_namespace namespace on namespace.oid = procedure_row.pronamespace
      join pg_language language on language.oid = procedure_row.prolang
      where namespace.nspname = 'public'
    ) item;
  `,
  relation_grants: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name, item.grantee, item.privilege_type, item.grantor), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        relation.relname as relation_name,
        coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
        grantor_role.rolname as grantor,
        privilege.privilege_type,
        privilege.is_grantable
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral aclexplode(
        coalesce(
          relation.relacl,
          acldefault(case when relation.relkind = 'S' then 's'::"char" else 'r'::"char" end, relation.relowner)
        )
      ) privilege
      left join pg_roles grantee_role on grantee_role.oid = privilege.grantee
      join pg_roles grantor_role on grantor_role.oid = privilege.grantor
      where (
        namespace.nspname = 'public'
        or (namespace.nspname = 'storage' and relation.relname in ('buckets', 'objects'))
      )
        and relation.relkind in ('r', 'p', 'v', 'm', 'S')
    ) item;
  `,
  function_grants: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.function_name, item.identity_arguments, item.grantee, item.privilege_type, item.grantor), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        procedure_row.proname as function_name,
        pg_get_function_identity_arguments(procedure_row.oid) as identity_arguments,
        coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
        grantor_role.rolname as grantor,
        privilege.privilege_type,
        privilege.is_grantable
      from pg_proc procedure_row
      join pg_namespace namespace on namespace.oid = procedure_row.pronamespace
      cross join lateral aclexplode(
        coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))
      ) privilege
      left join pg_roles grantee_role on grantee_role.oid = privilege.grantee
      join pg_roles grantor_role on grantor_role.oid = privilege.grantor
      where namespace.nspname = 'public'
    ) item;
  `,
  schema_and_default_grants: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.object_kind, item.schema_name, item.object_type, item.grantee, item.privilege_type, item.grantor), '[]'::jsonb)
    from (
      select
        'schema'::text as object_kind,
        namespace.nspname as schema_name,
        null::text as object_type,
        coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
        grantor_role.rolname as grantor,
        privilege.privilege_type,
        privilege.is_grantable
      from pg_namespace namespace
      cross join lateral aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) privilege
      left join pg_roles grantee_role on grantee_role.oid = privilege.grantee
      join pg_roles grantor_role on grantor_role.oid = privilege.grantor
      where namespace.nspname in ('public', 'storage')

      union all

      select
        'default_acl'::text as object_kind,
        namespace.nspname as schema_name,
        default_acl.defaclobjtype::text as object_type,
        coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
        grantor_role.rolname as grantor,
        privilege.privilege_type,
        privilege.is_grantable
      from pg_default_acl default_acl
      left join pg_namespace namespace on namespace.oid = default_acl.defaclnamespace
      cross join lateral aclexplode(default_acl.defaclacl) privilege
      left join pg_roles grantee_role on grantee_role.oid = privilege.grantee
      join pg_roles grantor_role on grantor_role.oid = privilege.grantor
      where namespace.nspname = 'public'
    ) item;
  `,
  policies: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name, item.policy_name), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        relation.relname as relation_name,
        policy.polname as policy_name,
        policy.polpermissive as permissive,
        policy.polcmd::text as command,
        (
          select array_agg(coalesce(role_row.rolname, 'PUBLIC') order by coalesce(role_row.rolname, 'PUBLIC'))
          from unnest(policy.polroles) role_oid
          left join pg_roles role_row on role_row.oid = role_oid
        ) as roles,
        pg_get_expr(policy.polqual, policy.polrelid) as using_expression,
        pg_get_expr(policy.polwithcheck, policy.polrelid) as check_expression
      from pg_policy policy
      join pg_class relation on relation.oid = policy.polrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'storage', 'auth')
    ) item;
  `,
  triggers: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name, item.trigger_name), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        relation.relname as relation_name,
        trigger_row.tgname as trigger_name,
        trigger_row.tgenabled::text as enabled,
        pg_get_triggerdef(trigger_row.oid, false) as definition
      from pg_trigger trigger_row
      join pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where not trigger_row.tgisinternal
        and namespace.nspname in ('public', 'storage', 'auth')
    ) item;
  `,
  indexes: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name, item.index_name), '[]'::jsonb)
    from (
      select
        namespace.nspname as schema_name,
        relation.relname as relation_name,
        index_relation.relname as index_name,
        index_row.indisunique as is_unique,
        index_row.indisprimary as is_primary,
        index_row.indisexclusion as is_exclusion,
        index_row.indisvalid as is_valid,
        pg_get_indexdef(index_row.indexrelid, 0, false) as definition,
        pg_get_expr(index_row.indpred, index_row.indrelid) as predicate
      from pg_index index_row
      join pg_class relation on relation.oid = index_row.indrelid
      join pg_class index_relation on index_relation.oid = index_row.indexrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
    ) item;
  `,
  cron_jobs: `
    select coalesce(jsonb_agg(to_jsonb(item) order by item.job_name), '[]'::jsonb)
    from (
      select
        jobname as job_name,
        schedule,
        command,
        database,
        username,
        active
      from cron.job
    ) item;
  `,
  realtime: `
    select jsonb_build_object(
      'publications',
      coalesce((
        select jsonb_agg(to_jsonb(item) order by item.publication_name)
        from (
          select
            pubname as publication_name,
            puballtables as all_tables,
            pubinsert as publishes_insert,
            pubupdate as publishes_update,
            pubdelete as publishes_delete,
            pubtruncate as publishes_truncate,
            pubviaroot as publish_via_partition_root
          from pg_publication
          where pubname = 'supabase_realtime'
        ) item
      ), '[]'::jsonb),
      'tables',
      coalesce((
        select jsonb_agg(to_jsonb(item) order by item.schema_name, item.relation_name)
        from (
          select
            schemaname as schema_name,
            tablename as relation_name,
            attnames as columns,
            rowfilter as row_filter
          from pg_publication_tables
          where pubname = 'supabase_realtime'
        ) item
      ), '[]'::jsonb)
    );
  `,
  buckets: `
    select coalesce(
      jsonb_agg(
        to_jsonb(bucket) - 'created_at' - 'updated_at' - 'owner' - 'owner_id'
        order by bucket.id
      ),
      '[]'::jsonb
    )
    from storage.buckets bucket;
  `,
  declarative_rows: `
    select jsonb_build_object(
      'modalities',
      coalesce((
        select jsonb_agg(to_jsonb(row_value) - 'created_at' - 'updated_at' order by row_value.code)
        from public.tournament_sport_modalities row_value
      ), '[]'::jsonb),
      'competition_formats',
      coalesce((
        select jsonb_agg(to_jsonb(row_value) - 'created_at' - 'updated_at' order by row_value.code)
        from public.tournament_competition_formats row_value
      ), '[]'::jsonb)
    );
  `,
};

export const buildCanonicalCatalog = ({ container }) => {
  const hasCronJobs = queryJson(
    container,
    `select to_jsonb(to_regclass('cron.job') is not null);`,
  );
  return Object.fromEntries(
    Object.entries(queries).map(([name, query]) => [
      name,
      name === 'cron_jobs' && !hasCronJobs ? [] : queryJson(container, query),
    ]),
  );
};

export const hashCanonicalCatalog = (catalog) => {
  const componentHashes = Object.fromEntries(
    Object.entries(catalog).map(([name, value]) => [
      name,
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    ]),
  );
  return {
    sha256: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),
    componentHashes,
  };
};

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isMain) {
  const database = resolveLocalDatabase();
  const catalog = buildCanonicalCatalog(database);
  const fingerprint = hashCanonicalCatalog(catalog);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...fingerprint, catalog }, null, 2));
  } else {
    console.log(JSON.stringify(fingerprint, null, 2));
  }
}
