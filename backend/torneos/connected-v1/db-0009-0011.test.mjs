// Operator driver for 0009 + 0010 + 0011 on the Torneos Production DB, offline: the state machine, the gates before every
// write and the "nothing that existed before moves" rule. The driver itself was also run on the promotion rehearsal lab
// (real Postgres + Storage), rolling back to POST_0008 and re-applying (docs/torneos/connected-product/DEPLOY.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  BRANDING_BUCKET, BRANDING_POLICIES, CONNECTED_FUNCTIONS, CONNECTED_TABLES, CONNECTED_TRIGGERS, FILES, REF, ROSTER_SEARCH, STATES, classify, run,
} from './remote/db-0009-0011.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function catalogAt(state, mutate = (c) => c) {
  const s = STATES[state];
  return mutate({
    torneos_tables: true, storage_ready: true, roster_search: { ...ROSTER_SEARCH[s.search] },
    counts: { authenticated: s.counts[0], anon: s.counts[1] },
    connected: s.connected
      ? { tables: [...CONNECTED_TABLES], triggers: [...CONNECTED_TRIGGERS], attestation_my_teams: true, functions: CONNECTED_FUNCTIONS }
      : { tables: [], triggers: [], attestation_my_teams: false, functions: 0 },
    branding: s.branding ? { bucket: { ...BRANDING_BUCKET, allowed_mime_types: [...BRANDING_BUCKET.allowed_mime_types] }, policies: [...BRANDING_POLICIES], functions: 2 }
      : { bucket: null, policies: [], functions: 0 },
    kept_fn: { count: 382, digest: 'a' }, kept_relations: { count: 115, digest: 'b' }, kept_policies: { count: 64, digest: 'c' }, other_buckets: { count: 0, digest: 'd' },
  });
}
const phrase = (mode) => `${mode.split('-')[0].toUpperCase()} TORNEOS ${FILES[mode].phase} ${REF} ${FILES[mode].sha256.slice(0, 12)}`.split(' ');

test('db 0009–0011 pins the exact files of this branch and the target ref', () => {
  assert.equal(REF, 'onzpwnqxnvlgsevivngf');
  for (const f of Object.values(FILES)) assert.equal(sha256(fs.readFileSync(f.rel)), f.sha256, f.rel);
  assert.deepEqual(STATES.POST_0008.counts, [172, 12], 'Production is POST_0008 at 172/12 (runbook §4)');
});

test('db 0009–0011 classify: POST_0008, POST_0009, POST_0010 and every drift fails closed', () => {
  for (const state of Object.keys(STATES)) assert.equal(classify(catalogAt(state)).state, state);
  for (const [state, mutate] of [
    ['POST_0010', (c) => { c.roster_search.search_md5 = ROSTER_SEARCH.fixed.search_md5; return c; }],
    ['POST_0011', (c) => { c.roster_search.authorize_md5 = '0'.repeat(32); return c; }],
    ['POST_0008', (c) => { c.roster_search = ROSTER_SEARCH.fixed; c.counts = { authenticated: 172, anon: 12 }; return c; }],
  ]) assert.equal(classify(catalogAt(state, mutate)).state, 'DRIFT', `${state} roster search drift`);
  for (const [state, mutate] of [
    ['POST_0008', (c) => { c.counts.authenticated = 173; return c; }],
    ['POST_0008', (c) => { c.connected.tables = ['tournament_user_profiles']; return c; }],
    ['POST_0009', (c) => { c.connected.triggers.pop(); return c; }],
    ['POST_0009', (c) => { c.connected.attestation_my_teams = false; return c; }],
    ['POST_0009', (c) => { c.connected.functions = 32; return c; }],
    ['POST_0009', (c) => { c.counts.anon = 16; return c; }],
    ['POST_0010', (c) => { c.branding.bucket.public = true; return c; }],
    ['POST_0010', (c) => { c.branding.bucket.file_size_limit = 10485760; return c; }],
    ['POST_0010', (c) => { c.branding.policies.pop(); return c; }],
    ['POST_0010', (c) => { c.branding.functions = 1; return c; }],
    ['POST_0008', (c) => { c.branding.bucket = { ...BRANDING_BUCKET }; c.branding.policies = [...BRANDING_POLICIES]; c.branding.functions = 2; return c; }],
    ['POST_0008', (c) => { c.torneos_tables = false; return c; }],
  ]) assert.equal(classify(catalogAt(state, mutate)).state, 'DRIFT', `${state} drift`);
  assert.equal(classify(null).state, 'DRIFT');
});

test('db 0009–0011 apply/rollback: phrase, file hash, exact states and order gate every write', async () => {
  let current = 'POST_0008';
  const sent = [];
  const next = { 'apply-0009': 'POST_0009', 'apply-0010': 'POST_0010', 'apply-0011': 'POST_0011', 'rollback-0011': 'POST_0010',
    'rollback-0010': 'POST_0009', 'rollback-0009': 'POST_0008' };
  const deps = (mode) => ({
    catalog: async () => catalogAt(current),
    applySql: async () => { sent.push(mode); current = next[mode]; return { code: 0 }; },
  });
  await assert.rejects(run('apply-0009', ['APPLY', 'TORNEOS', '0009'], deps('apply-0009')), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply-0009', phrase('apply-0009'), { ...deps('apply-0009'), readFile: () => Buffer.from('tampered') }), /FILE_HASH_MISMATCH/);
  await assert.rejects(run('apply-0010', phrase('apply-0010'), deps('apply-0010')), /PRE_STATE_POST_0008/, '0010 never before 0009');
  await assert.rejects(run('rollback-0009', phrase('rollback-0009'), deps('rollback-0009')), /PRE_STATE_POST_0008/);
  assert.deepEqual(sent, [], 'nothing sent before every gate passes');
  assert.equal((await run('apply-0009', phrase('apply-0009'), deps('apply-0009'))).verdict, 'APPLY_0009_DONE');
  await assert.rejects(run('apply-0009', phrase('apply-0009'), deps('apply-0009')), /PRE_STATE_POST_0009/, 'never re-applied');
  await assert.rejects(run('apply-0010', phrase('apply-0010'), { ...deps('apply-0010'), catalog: async () => catalogAt(current, (c) => { c.storage_ready = false; return c; }) }), /STORAGE_SCHEMA_MISSING/);
  assert.equal((await run('apply-0010', phrase('apply-0010'), deps('apply-0010'))).verdict, 'APPLY_0010_DONE');
  await assert.rejects(run('rollback-0009', phrase('rollback-0009'), deps('rollback-0009')), /PRE_STATE_POST_0010/, '0009 is never rolled back under 0010');
  await assert.rejects(run('rollback-0011', phrase('rollback-0011'), deps('rollback-0011')), /PRE_STATE_POST_0010/);
  assert.equal((await run('apply-0011', phrase('apply-0011'), deps('apply-0011'))).verdict, 'APPLY_0011_DONE');
  await assert.rejects(run('rollback-0010', phrase('rollback-0010'), deps('rollback-0010')), /PRE_STATE_POST_0011/, '0010 is never rolled back under 0011');
  assert.equal((await run('rollback-0011', phrase('rollback-0011'), deps('rollback-0011'))).verdict, 'ROLLBACK_0011_DONE');
  assert.equal((await run('rollback-0010', phrase('rollback-0010'), deps('rollback-0010'))).verdict, 'ROLLBACK_0010_DONE');
  assert.equal((await run('rollback-0009', phrase('rollback-0009'), deps('rollback-0009'))).verdict, 'ROLLBACK_0009_DONE');
  assert.deepEqual(sent, ['apply-0009', 'apply-0010', 'apply-0011', 'rollback-0011', 'rollback-0010', 'rollback-0009']);
  // A write that moves anything that existed before 0009, or lands in the wrong state, is FAILED.
  current = 'POST_0008';
  const moved = await run('apply-0009', phrase('apply-0009'), { ...deps('apply-0009'),
    catalog: async () => catalogAt(current, (c) => { if (current === 'POST_0009') c.kept_fn.digest = 'changed'; return c; }) });
  assert.equal(moved.verdict, 'APPLY_0009_FAILED'); assert.deepEqual(moved.changedOutside, ['kept_fn']);
  current = 'POST_0008';
  const failed = await run('apply-0009', phrase('apply-0009'), { ...deps('apply-0009'), applySql: async () => ({ code: 3 }) });
  assert.equal(failed.verdict, 'APPLY_0009_FAILED');
  assert.equal((await run('observe', [], deps('observe'))).verdict.state, 'POST_0008');
});
