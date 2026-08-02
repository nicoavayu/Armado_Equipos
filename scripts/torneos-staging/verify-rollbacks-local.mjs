#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DATABASE_URL = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const parsed = new URL(DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !LOOPBACK.has(parsed.hostname)) {
  throw new Error('Rollback verification is loopback-only; there is no override.');
}

const files = [
  '20260803090000_tournament_social_studio.safe.sql',
  '20260802120000_tournament_media_trusted_processing.safe.sql',
  '20260802090000_tournament_media_upload_pipeline.safe.sql',
];
const preservedTables = [
  'tournament_media_service_attestations',
  'tournament_media_upload_sessions',
  'tournament_media_assets',
  'tournament_media_variants',
  'tournament_media_processing_jobs',
  'tournament_social_permissions',
];
const serviceBlocked = [
  'public.attest_tournament_media_service(text,text,jsonb,integer)',
  'public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)',
  'public.authorize_tournament_media_upload_target(uuid,text,uuid)',
  'public.finalize_tournament_media_variants(uuid,jsonb)',
  'public.complete_tournament_media_upload_for_actor(uuid,uuid,text,text,bigint,integer,integer,text)',
  'public.enqueue_tournament_media_processing_job(uuid,text,uuid)',
  'public.lease_tournament_media_processing_jobs(text,integer,integer)',
  'public.complete_tournament_media_processing_job(uuid,text,uuid)',
  'public.fail_tournament_media_processing_job(uuid,text,text)',
  'public.complete_tournament_media_upload_for_job(uuid,text,text,bigint,integer,integer,text)',
];
const clientBlocked = [
  'public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)',
  'public.get_tournament_social_studio_context(uuid)',
  'public.set_tournament_social_permission(uuid,uuid,boolean)',
];

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const before = await client.query(`
    select c.relname, (select count(*) from pg_catalog.pg_class marker where marker.oid = c.oid) as present
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
  `, [preservedTables]);
  if (before.rowCount !== preservedTables.length) throw new Error('Expected preserved tables are missing before rollback.');

  for (const file of files) {
    await client.query(await fs.readFile(path.join(ROOT, 'supabase', 'rollbacks', file), 'utf8'));
  }

  for (const signature of serviceBlocked) {
    const { rows } = await client.query(
      'select has_function_privilege($1, $2, $3) as allowed',
      ['service_role', signature, 'EXECUTE'],
    );
    if (rows[0].allowed) throw new Error(`service_role still executes ${signature}`);
  }
  for (const signature of clientBlocked) {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await client.query(
        'select has_function_privilege($1, $2, $3) as allowed',
        [role, signature, 'EXECUTE'],
      );
      if (rows[0].allowed) throw new Error(`${role} still executes ${signature}`);
    }
  }

  const cleanup = await client.query(
    `select
      has_function_privilege('service_role', 'public.cleanup_tournament_media_upload_sessions(integer)', 'EXECUTE') as upload_cleanup,
      has_function_privilege('service_role', 'public.cleanup_tournament_media_processing_jobs(integer)', 'EXECUTE') as job_cleanup`,
  );
  if (!cleanup.rows[0].upload_cleanup || !cleanup.rows[0].job_cleanup) {
    throw new Error('Approved cleanup access was removed.');
  }
  const readiness = await client.query('select public.tournament_media_pipeline_readiness() as value');
  if (readiness.rows[0].value?.uploadReady !== false) throw new Error('uploadReady did not fail closed.');

  const after = await client.query(`
    select count(*)::int as count
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
  `, [preservedTables]);
  if (after.rows[0].count !== preservedTables.length) throw new Error('Rollback removed preserved tables.');
  process.stdout.write(`ROLLBACK_LOCAL_OK files=${files.length} tablesPreserved=${preservedTables.length} uploadReady=false\n`);
} finally {
  await client.end();
}
