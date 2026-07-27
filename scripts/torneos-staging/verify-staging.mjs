#!/usr/bin/env node

import process from 'node:process';

import pg from 'pg';

import { KNOWN_PRODUCTION_PROJECT_REFS, MIGRATIONS } from './manifest.mjs';

const confirmation = process.env.TORNEOS_STAGING_VERIFY_CONFIRM;
const projectRef = String(process.env.REACT_APP_TORNEOS_STAGING_PROJECT_REF || '').toLowerCase();
const databaseUrl = String(process.env.TORNEOS_STAGING_DATABASE_URL || '');
const expectedConfirmation = `VERIFY_READ_ONLY_${projectRef}`;

if (!projectRef || !databaseUrl || confirmation !== expectedConfirmation) {
  console.error(
    'STAGING_VERIFY_GUARD: configure project ref, database URL y '
    + `TORNEOS_STAGING_VERIFY_CONFIRM=${expectedConfirmation || 'VERIFY_READ_ONLY_<ref>'}`,
  );
  process.exit(2);
}
if (KNOWN_PRODUCTION_PROJECT_REFS.includes(projectRef)) {
  console.error('STAGING_VERIFY_GUARD: el project ref productivo está prohibido');
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  console.error('STAGING_VERIFY_GUARD: URL de Postgres inválida');
  process.exit(2);
}
const isDirectHost = parsed.hostname === `db.${projectRef}.supabase.co`;
const isPoolerHost = (
  parsed.hostname.endsWith('.pooler.supabase.com')
  && parsed.username.split('.')[1] === projectRef
);
if (!isDirectHost && !isPoolerHost) {
  console.error('STAGING_VERIFY_GUARD: la URL de Postgres no coincide con el project ref');
  process.exit(2);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: 'arma2_torneos_staging_read_only_verifier',
});

try {
  await client.connect();
  await client.query('begin read only');
  await client.query("set local statement_timeout = '15s'");

  const installed = await client.query(
    `select version
       from supabase_migrations.schema_migrations
      where version = any($1::text[])
         or name like '%tournament%'
      order by version`,
    [MIGRATIONS.map(({ version }) => version)],
  );
  const actualVersions = installed.rows.map(({ version }) => version);
  const expectedVersions = MIGRATIONS.map(({ version }) => version);
  if (JSON.stringify(actualVersions) !== JSON.stringify(expectedVersions)) {
    throw new Error(`migraciones divergentes: ${actualVersions.join(',')}`);
  }

  const rls = await client.query(
    `select count(*)::int as count
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname like 'tournament_%'
        and c.relkind = 'r'
        and not c.relrowsecurity`,
  );
  if (rls.rows[0].count !== 0) throw new Error(`${rls.rows[0].count} tablas tournament sin RLS`);

  const publicExecute = await client.query(
    `select count(*)::int as count
       from information_schema.routine_privileges
      where specific_schema = 'public'
        and routine_name like '%tournament%'
        and grantee = 'PUBLIC'
        and privilege_type = 'EXECUTE'`,
  );
  if (publicExecute.rows[0].count !== 0) {
    throw new Error(`${publicExecute.rows[0].count} funciones tournament ejecutables por PUBLIC`);
  }

  const exposedTables = await client.query(
    `select count(*)::int as count
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name like 'tournament_%'
        and grantee in ('anon', 'authenticated')
        and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')`,
  );
  if (exposedTables.rows[0].count !== 0) {
    throw new Error('existen grants de tablas fuera del contrato esperado');
  }
  await client.query('rollback');
  console.log(
    `STAGING_READ_ONLY_VERIFY_OK migrations=${expectedVersions.length}`
    + ' rlsMissing=0 publicExecute=0',
  );
} catch (error) {
  try { await client.query('rollback'); } catch {}
  console.error(`STAGING_READ_ONLY_VERIFY_FAILED ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
