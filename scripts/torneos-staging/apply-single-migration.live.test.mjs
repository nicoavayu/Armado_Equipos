import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  cleanupMatchOperationsHarness,
  connect,
  setup,
  value,
} from '../db-integration/torneos-match-operations.mjs';
import {
  A1_FILE,
  A1_VERSION,
  buildTransactionalSql,
} from './single-migration-executor-lib.mjs';
import { loadManifest } from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HISTORY_BEFORE = ['20260801090000'];
const HISTORY_AFTER = [...HISTORY_BEFORE, A1_VERSION];

let admin;
let execution;
let canonicalSql;

test.before(async () => {
  admin = await setup([
    '20260726200000_tournament_standings_discipline.sql',
    '20260726230000_tournament_participant_hub.sql',
    '20260727010000_tournament_communications.sql',
    '20260727060000_tournament_media_galleries.sql',
  ]);
  await admin.query(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      statements text[]
    );
    insert into supabase_migrations.schema_migrations(version, name, statements)
    values ('20260801090000', 'tournament_context_reads_are_pure', array[]::text[]);
  `);
  const manifest = loadManifest(ROOT);
  execution = manifest.migrationPolicy.migrations[0].execution;
  canonicalSql = fs.readFileSync(path.join(ROOT, A1_FILE), 'utf8');
});

test.after(async () => {
  await cleanupMatchOperationsHarness();
});

const generated = (migrationSql = canonicalSql) => buildTransactionalSql({
  migrationSql,
  execution,
  historyBefore: HISTORY_BEFORE,
  historyAfter: HISTORY_AFTER,
});

const rollbackQuietly = async (client) => {
  try { await client.query('rollback'); } catch {}
};

test('incompatible history lock aborts near 5 seconds with no partial schema or history', async () => {
  const blocker = await connect();
  await blocker.query('begin; lock table supabase_migrations.schema_migrations in access exclusive mode;');
  const started = Date.now();
  let elapsed;
  try {
    await assert.rejects(admin.query(generated()), /lock timeout|canceling statement due to lock timeout/i);
    elapsed = Date.now() - started;
  } finally {
    await rollbackQuietly(admin);
    await blocker.query('rollback');
  }
  assert.ok(elapsed >= 4300 && elapsed < 9000, `lock timeout elapsed ${elapsed}ms`);
  assert.equal(await value(admin, `select to_regclass('public.tournament_media_service_attestations') is null`), true);
  assert.equal(Number(await value(admin, 'select count(*) from supabase_migrations.schema_migrations')), 1);
});

test('SQL failure rolls back objects and history', async () => {
  const failing = `BEGIN;
CREATE TABLE public.a1_partial_object(id integer primary key);
SELECT 1 / 0;
COMMIT;`;
  await assert.rejects(admin.query(generated(failing)), /division by zero/i);
  await rollbackQuietly(admin);
  assert.equal(await value(admin, `select to_regclass('public.a1_partial_object') is null`), true);
  assert.equal(Number(await value(admin, 'select count(*) from supabase_migrations.schema_migrations')), 1);
});

test('history registration failure rolls back migration objects', async () => {
  await admin.query(`
    create function public.reject_a1_history() returns trigger language plpgsql as $$
    begin
      if new.version = '${A1_VERSION}' then raise exception 'A1_HISTORY_REJECTED'; end if;
      return new;
    end $$;
    create trigger reject_a1_history before insert on supabase_migrations.schema_migrations
    for each row execute function public.reject_a1_history();
  `);
  const createsObject = `BEGIN;
CREATE TABLE public.a1_history_atomicity(id integer primary key);
COMMIT;`;
  await assert.rejects(admin.query(generated(createsObject)), /A1_HISTORY_REJECTED/);
  await rollbackQuietly(admin);
  assert.equal(await value(admin, `select to_regclass('public.a1_history_atomicity') is null`), true);
  assert.equal(Number(await value(admin, 'select count(*) from supabase_migrations.schema_migrations')), 1);
  await admin.query(`
    drop trigger reject_a1_history on supabase_migrations.schema_migrations;
    drop function public.reject_a1_history();
  `);
});

test('unexpected history aborts before A1 and leaves zero partial application', async () => {
  await admin.query(`insert into supabase_migrations.schema_migrations(version, name, statements)
    values ('20990101000000', 'unexpected', array[]::text[])`);
  await assert.rejects(admin.query(generated()), /unexpected migration history before A1/);
  await rollbackQuietly(admin);
  assert.equal(await value(admin, `select to_regclass('public.tournament_media_service_attestations') is null`), true);
  await admin.query(`delete from supabase_migrations.schema_migrations where version = '20990101000000'`);
});

test('happy path applies and records only A1 while A2, Social, Storage, Functions, and readiness remain closed', async () => {
  await admin.query(generated());
  assert.deepEqual((await admin.query(
    'select version from supabase_migrations.schema_migrations order by version',
  )).rows.map(({ version }) => version), HISTORY_AFTER);
  assert.equal(await value(admin, `select to_regclass('public.tournament_media_service_attestations') is not null`), true);
  assert.equal(await value(admin, `select to_regclass('public.tournament_media_processing_jobs') is null`), true);
  assert.equal(await value(admin, `select to_regclass('public.tournament_social_permissions') is null`), true);
  assert.equal(await value(admin, `select to_regclass('storage.buckets') is null`), true);
  assert.equal(await value(admin, `select to_regprocedure('public.tournament_media_backend_fingerprint()') is null`), true);
  const readiness = await value(admin, 'select public.tournament_media_pipeline_readiness()');
  assert.equal(readiness.uploadReady, false);
  assert.ok(readiness.blockers.includes('storage.bucket_absent'));
  assert.equal(Number(await value(admin,
    `select count(*) from supabase_migrations.schema_migrations where version = '${A1_VERSION}'`)), 1);
});

test('repetition rejects reapplication and never duplicates history or replaces objects', async () => {
  const objectOid = await value(admin, `select 'public.tournament_media_service_attestations'::regclass::oid`);
  await assert.rejects(admin.query(generated()), /unexpected migration history before A1/);
  await rollbackQuietly(admin);
  assert.equal(Number(await value(admin,
    `select count(*) from supabase_migrations.schema_migrations where version = '${A1_VERSION}'`)), 1);
  assert.equal(await value(admin, `select 'public.tournament_media_service_attestations'::regclass::oid`), objectOid);
});
