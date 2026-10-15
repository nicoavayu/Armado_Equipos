// PREMIUM SPONSORS 0020: the migration's and the rollback's own guarantees (static) and the operator driver, offline (fake
// catalogs). The real transitions — apply, refused re-apply, rollback with and without rows, re-apply, as the hosted
// installer — run on the lab (sponsors-0020-rollback.test.mjs); the rules themselves in sponsors-0020.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ACL, BODIES, FILES, FORCE_SQL, REF, RPC_DELTA, TABLE, BRANDING_BUCKET, changedOutside, classify, phraseFor, run } from './remote/db-0020.mjs';

const MIGRATION = fs.readFileSync(FILES['apply-0020'].path, 'utf8');
const ROLLBACK = fs.readFileSync(FILES['rollback-0020'].path, 'utf8');
const M0017 = fs.readFileSync(new URL('../supabase/migrations/00000000000017_media_store_v1.sql', import.meta.url), 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const bodyIn = (text, head) => { const i = text.indexOf(head); assert.ok(i >= 0, head); const j = text.indexOf('as $$', i) + 5; return text.slice(j, text.indexOf('$$;', j)); };
const HEADS = {
  in_use: 'create or replace function private.tournament_branding_object_in_use',
  entitled: 'create function private.tournament_sponsors_entitled',
  get: 'create function public.get_tournament_organization_sponsors',
  upsert: 'create function public.upsert_tournament_organization_sponsor',
  archive: 'create function public.archive_tournament_organization_sponsor',
  authorize: 'create function public.authorize_tournament_social_sponsors',
};
const statements = (text) => text.replace(/--[^\n]*/g, '');

test('the pinned files and bodies are the ones in the tree; the migration\'s own pins agree with the driver\'s', () => {
  assert.equal(sha256(MIGRATION), FILES['apply-0020'].sha256);
  assert.equal(sha256(ROLLBACK), FILES['rollback-0020'].sha256);
  for (const [name, head] of Object.entries(HEADS)) {
    const pin = BODIES.POST_0020[name];
    assert.equal(md5(bodyIn(MIGRATION, head)), pin, name);
    assert.ok(MIGRATION.includes(`', '${pin}'`), `${name} pinned in the migration's postcondition`);
  }
  assert.equal(md5(bodyIn(M0017, 'create function private.tournament_branding_object_in_use')), BODIES.PRE_0020.in_use);
  // The rollback puts back the 0017 body byte for byte, and pins both ends.
  assert.equal(bodyIn(ROLLBACK, 'create or replace function private.tournament_branding_object_in_use'),
    bodyIn(M0017, 'create function private.tournament_branding_object_in_use'));
  assert.ok(ROLLBACK.includes(BODIES.POST_0020.in_use) && ROLLBACK.includes(BODIES.PRE_0020.in_use));
  assert.ok(MIGRATION.includes(`'private.tournament_branding_object_in_use(text)', '${BODIES.PRE_0020.in_use}'`), 'precondition pin');
  assert.equal(phraseFor('apply-0020'), `APPLY TORNEOS 0020 ${REF} ${FILES['apply-0020'].sha256.slice(0, 12)}`);
  assert.equal(phraseFor('rollback-0020', { force: true }), `ROLLBACK TORNEOS 0020 ${REF} ${FILES['rollback-0020'].sha256.slice(0, 12)} DISCARD SPONSOR ROWS`);
  assert.throws(() => phraseFor('apply-0020', { force: true }), /FORCE_ONLY_FOR_ROLLBACK/);
});

test('0020: one table (RLS, no API grant, no policy), four authenticated-only RPCs, one private rule; nothing else', () => {
  const s = statements(MIGRATION);
  assert.match(MIGRATION, /^-- Applies after 00000000000017/m);
  assert.match(MIGRATION, /^BEGIN;/m); assert.match(MIGRATION, /^COMMIT;/m);
  assert.equal((s.match(/create function/gi) || []).length, 5);
  assert.equal((s.match(/create or replace function/gi) || []).length, 1);
  assert.equal((s.match(/create table/gi) || []).length, 1);
  for (const forbidden of [/create policy/i, /drop policy/i, /alter policy/i, /grant\s+(select|insert|update|delete|all)\s+on/i,
    /update\s+storage\.buckets/i, /insert\s+into\s+storage/i, /alter\s+role/i, /create\s+role/i, /security\s+invoker/i, /set\s+role/i,
    /drop\s+function/i, /authorize_tournament_social_export\(p_/i, /to\s+current_user/i, /\bto\s+anon\b/i, /\bto\s+service_role\b/i]) {
    assert.doesNotMatch(s, forbidden, String(forbidden));
  }
  assert.match(s, /alter table public\.tournament_organization_sponsors enable row level security;/);
  assert.match(s, /revoke all on table public\.tournament_organization_sponsors from public, anon, authenticated, service_role;/);
  assert.match(s, /revoke all on function private\.tournament_sponsors_entitled\(uuid, uuid, uuid\) from public, anon, authenticated, service_role;/);
  const grants = s.match(/^grant [^\n]*$/gmi) || [];
  assert.deepEqual(grants.map((g) => g.replace(/^grant execute on function public\.(\w+)\(.*\) to authenticated;$/, '$1')), [
    'get_tournament_organization_sponsors', 'upsert_tournament_organization_sponsor', 'archive_tournament_organization_sponsor',
    'authorize_tournament_social_sponsors']);
  for (const name of ['get_tournament_organization_sponsors(uuid, uuid)', 'upsert_tournament_organization_sponsor(uuid, uuid, text, text, integer)',
    'archive_tournament_organization_sponsor(uuid, uuid)', 'authorize_tournament_social_sponsors(uuid, uuid, text, uuid[])']) {
    assert.ok(s.includes(`revoke all on function public.${name} from public, anon, service_role;`), name);
  }
  // Every RPC: identity first; then the access check, before any input is judged.
  for (const name of ['get', 'upsert', 'archive', 'authorize']) {
    const b = bodyIn(MIGRATION, HEADS[name]);
    assert.match(b, /(private\.current_identity_id\(\)|v_uid) is null[\s\S]*?TORNEOS_AUTH_REQUIRED/, name);
    const access = b.search(/TORNEOS_(SPONSORS_FORBIDDEN|SOCIAL_EXPORT_FORBIDDEN)/);
    for (const later of ['TORNEOS_SPONSOR_INVALID', 'TORNEOS_SOCIAL_THEME_UNKNOWN', 'TORNEOS_SPONSORS_PREMIUM_REQUIRED', 'TORNEOS_SPONSOR_NOT_FOUND']) {
      if (b.includes(later)) assert.ok(b.indexOf(later) > access, `${name}: ${later} after the access check`);
    }
  }
  // The trap: has_tournament_capability is a role check, never an entitlement. The entitlement is the resolver's.
  assert.doesNotMatch(s, /has_tournament_capability\(/);
  assert.match(bodyIn(MIGRATION, HEADS.entitled), /resolve_effective_tournament_season_entitlements_at\([\s\S]*'capabilities'->>'sponsors'/);
  assert.match(bodyIn(MIGRATION, HEADS.upsert), /organization\.update[\s\S]*tournament_sponsors_entitled\(p_organization_id, null, null\)/);
  assert.doesNotMatch(bodyIn(MIGRATION, HEADS.archive), /entitled/, 'archiving never needs Premium');
  assert.match(bodyIn(MIGRATION, HEADS.authorize), /'social\.export'[\s\S]*tournament_sponsors_entitled\(v_organization_id, p_season_id, p_tournament_id\)/);
  assert.match(bodyIn(MIGRATION, HEADS.in_use), /tournament_organization_sponsors sponsor\s+where sponsor\.logo_path = p_name and sponsor\.archived_at is null/);
  assert.ok(bodyIn(MIGRATION, HEADS.in_use).startsWith(bodyIn(M0017, 'create function private.tournament_branding_object_in_use').replace(/;\n$/, '')),
    'the 0017 body, extended');
  // The rollback: drops exactly what 0020 added, refuses with rows unless forced, touches no other data.
  const r = statements(ROLLBACK);
  for (const drop of ['drop function public.authorize_tournament_social_sponsors(uuid, uuid, text, uuid[]);',
    'drop function public.archive_tournament_organization_sponsor(uuid, uuid);',
    'drop function public.upsert_tournament_organization_sponsor(uuid, uuid, text, text, integer);',
    'drop function public.get_tournament_organization_sponsors(uuid, uuid);',
    'drop function private.tournament_sponsors_entitled(uuid, uuid, uuid);', 'drop table public.tournament_organization_sponsors;']) {
    assert.ok(r.includes(drop), drop);
  }
  assert.equal((r.match(/\bdrop\b/gi) || []).length, 6);
  assert.match(r, /TORNEOS_0020_ROLLBACK_REFUSED/);
  assert.match(r, /current_setting\('torneos\.sponsors_rollback_force', true\), ''\) <> 'DISCARD SPONSOR ROWS'/);
  assert.doesNotMatch(r, /policy|storage\.objects|delete from|truncate|grant /i);
  assert.equal(FORCE_SQL, "SET torneos.sponsors_rollback_force = 'DISCARD SPONSOR ROWS';\n");
});

const kept = { kept_fn: { count: 900, digest: 'f' }, kept_relations: { count: 120, digest: 'r' }, kept_policies: { count: 300, digest: 'p' } };
const catalogAt = (state, mutate = (c) => c, rows = 0) => mutate({
  torneos_tables: true, prerequisites: { media_store: true, season_lifecycle: true, sponsors_capability: true },
  buckets: JSON.parse(JSON.stringify(BRANDING_BUCKET)), bodies: { ...BODIES[state] }, acl: JSON.parse(JSON.stringify(ACL[state])),
  table: TABLE[state] && { ...TABLE[state] }, rows: state === 'POST_0020' ? rows : null,
  counts: { authenticated: state === 'POST_0020' ? 207 + RPC_DELTA : 207, anon: 16 }, ...JSON.parse(JSON.stringify(kept)),
});

test('classify: the two states, and every drift by name', () => {
  assert.deepEqual(classify(catalogAt('PRE_0020')), { state: 'PRE_0020', failures: [] });
  assert.deepEqual(classify(catalogAt('POST_0020')), { state: 'POST_0020', failures: [] });
  assert.deepEqual(classify(catalogAt('POST_0020', (c) => c, 7)), { state: 'POST_0020', failures: [] });
  assert.equal(classify(null).state, 'DRIFT');
  const drift = (mutate, state = 'POST_0020') => classify(catalogAt(state, (c) => { mutate(c); return c; })).failures.join();
  assert.match(drift((c) => { c.acl.get.anon = true; }), /acl\.get/, 'anon may never execute');
  assert.match(drift((c) => { c.acl.authorize.service_role = true; }), /acl\.authorize/);
  assert.match(drift((c) => { c.acl.entitled.authenticated = true; }), /acl\.entitled/);
  assert.match(drift((c) => { c.acl.in_use.authenticated = true; }), /acl\.in_use/);
  assert.match(drift((c) => { c.table.api_grants = true; }), /table/, 'an API grant on the table is drift');
  assert.match(drift((c) => { c.table.rls = false; }), /table/);
  assert.match(drift((c) => { c.table.policies = 1; }), /table/);
  assert.match(drift((c) => { c.rows = null; }), /rows/);
  assert.match(drift((c) => { c.buckets['tournament-branding'].public = true; }), /buckets/, 'a public bucket is drift');
  assert.match(drift((c) => { c.bodies.upsert = 'x'; }), /bodies/);
  assert.match(drift((c) => { c.bodies.in_use = BODIES.PRE_0020.in_use; }), /bodies/, 'half applied');
  assert.match(drift((c) => { c.prerequisites.season_lifecycle = false; }, 'PRE_0020'), /season_lifecycle_0018_missing/);
  assert.match(drift((c) => { c.prerequisites.sponsors_capability = false; }, 'PRE_0020'), /sponsors_capability/);
  assert.match(drift((c) => { c.table = { rls: true, api_grants: false, policies: 0 }; }, 'PRE_0020'), /table/, 'a table without the functions');
});

test('run: phrase, hash, states, rows and "nothing else moved" gate every write; the rollback goes back exactly', async () => {
  let current = 'PRE_0020';
  let rows = 0;
  const applied = [];
  const deps = (opts = {}) => ({
    catalog: async () => catalogAt(current, opts.mutate ?? ((c) => c), rows),
    applySql: async (sql) => { applied.push(sql.slice(0, 80)); current = /drop table/.test(sql) ? 'PRE_0020' : 'POST_0020'; if (current === 'PRE_0020') rows = 0; return { code: 0 }; },
  });
  await assert.rejects(run('apply-0020', ['APPLY', 'TORNEOS', '0020'], deps()), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply-0020', phraseFor('apply-0020').split(' '), { ...deps(), readFile: () => Buffer.from('tampered') }), /FILE_HASH_MISMATCH/);
  await assert.rejects(run('rollback-0020', phraseFor('rollback-0020').split(' '), deps()), /PRE_STATE_PRE_0020/, 'nothing to roll back');
  await assert.rejects(run('apply-0020', [...phraseFor('apply-0020').split(' '), 'DISCARD', 'SPONSOR', 'ROWS'], deps()), /PHRASE_REQUIRED/);
  const ok = await run('apply-0020', phraseFor('apply-0020').split(' '), deps());
  assert.deepEqual([ok.verdict, ok.before, ok.after, ok.changedOutside, ok.forced], ['APPLY_0020_DONE', 'PRE_0020', 'POST_0020', [], false]);
  await assert.rejects(run('apply-0020', phraseFor('apply-0020').split(' '), deps()), /PRE_STATE_POST_0020/, 'never re-applied');
  // Rows: refused without the force phrase, before any write.
  rows = 3;
  await assert.rejects(run('rollback-0020', phraseFor('rollback-0020').split(' '), deps()), /ROLLBACK_REFUSED 3 sponsor rows/);
  assert.equal(applied.length, 1);
  const forced = await run('rollback-0020', phraseFor('rollback-0020', { force: true }).split(' '), deps());
  assert.deepEqual([forced.verdict, forced.after, forced.forced, forced.changedOutside], ['ROLLBACK_0020_DONE', 'PRE_0020', true, []]);
  assert.ok(applied[1].startsWith(FORCE_SQL.trim()), 'the force setting precedes the file in the same session');
  await run('apply-0020', phraseFor('apply-0020').split(' '), deps());
  const back = await run('rollback-0020', phraseFor('rollback-0020').split(' '), deps());
  assert.deepEqual([back.verdict, back.after, back.forced], ['ROLLBACK_0020_DONE', 'PRE_0020', false]);
  assert.ok(!applied[3].startsWith('SET '), 'no force setting without the force phrase');
  // Something else moving during the write makes the step FAILED (the file's own transaction already committed: evidence).
  current = 'PRE_0020';
  let calls = 0;
  const moving = { catalog: async () => catalogAt(current, (c) => { if (calls++ > 0) c.kept_fn.digest = 'changed'; return c; }),
    applySql: async () => { current = 'POST_0020'; return { code: 0 }; } };
  const failed = await run('apply-0020', phraseFor('apply-0020').split(' '), moving);
  assert.deepEqual([failed.verdict, failed.changedOutside], ['APPLY_0020_FAILED', ['kept_fn']]);
  assert.deepEqual(changedOutside(catalogAt('PRE_0020'), catalogAt('POST_0020', (c) => { c.counts.anon = 17; return c; }), 'apply'), ['counts'], 'anon never gains anything');
  assert.deepEqual(changedOutside(catalogAt('PRE_0020'), catalogAt('POST_0020', (c) => { c.counts.authenticated += 1; return c; }), 'apply'), ['counts'], 'exactly +4');
  const psqlFailed = await run('rollback-0020', phraseFor('rollback-0020').split(' '), { catalog: async () => catalogAt('POST_0020'), applySql: async () => ({ code: 3 }) });
  assert.equal(psqlFailed.verdict, 'ROLLBACK_0020_FAILED');
  const observed = await run('observe', [], deps());
  assert.equal(observed.verdict.state, 'POST_0020');
});

test('with 0020 installed, the 0017 driver sees its in_use body changed (DRIFT): rollback-0017 is refused until 0020 is rolled back', async () => {
  const D17 = await import('../media-store-v1/remote/db-0017.mjs');
  assert.equal(D17.BODIES.POST_0017.in_use, BODIES.PRE_0020.in_use, 'PRE_0020 is exactly POST_0017');
  const catalog17 = {
    torneos_tables: true, prerequisites: { branding: true, media: true }, buckets: JSON.parse(JSON.stringify(D17.PRIVATE_BUCKETS)),
    bodies: { ...D17.BODIES.POST_0017, in_use: BODIES.POST_0020.in_use }, acl: JSON.parse(JSON.stringify(D17.ACL)),
    counts: { authenticated: 211, anon: 16 }, kept_fn: { count: 1, digest: 'f' }, kept_relations: { count: 1, digest: 'r' }, kept_policies: { count: 1, digest: 'p' },
  };
  assert.equal(D17.classify(catalog17).state, 'DRIFT');
  await assert.rejects(D17.run('rollback-0017', D17.phraseFor('rollback-0017').split(' '), { catalog: async () => catalog17, applySql: async () => { throw new Error('never'); } }),
    /PRE_STATE_DRIFT/);
});

test('the catalog is one read-only JSON select that passes the real transport guard, naming every pinned object', async () => {
  const C = await import('../infra/torneos-officialization-error-v1/oec-remote-contract.mjs');
  const sql = fs.readFileSync(new URL('./remote/sql-catalog-0020.sql', import.meta.url), 'utf8').trim();
  const script = C.readOnlyScript(sql);
  assert.match(script, /^BEGIN TRANSACTION READ ONLY;\nwith\b/);
  assert.match(script, /\n\)::text;\nROLLBACK;\n$/);
  for (const name of ['tournament_branding_object_in_use', 'tournament_sponsors_entitled', 'get_tournament_organization_sponsors',
    'upsert_tournament_organization_sponsor', 'archive_tournament_organization_sponsor', 'authorize_tournament_social_sponsors',
    'tournament_organization_sponsors', 'storage.buckets', "'storage'"]) {
    assert.ok(sql.includes(name), name);
  }
  assert.doesNotMatch(sql, /logo_path|sponsor\.name|archived_at/i, "never reads sponsor names or paths");
  assert.deepEqual(sql.match(/from public\.tournament_organization_sponsors\b[^']*/g), ["from public.tournament_organization_sponsors"], "the table is read only by its row count");
});
