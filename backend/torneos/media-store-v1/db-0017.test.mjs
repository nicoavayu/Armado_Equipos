// MEDIA-STORE-V1 0017: the migration's own guarantees (static) and the operator driver, offline (fake catalogs). The real
// transitions — apply, rollback, re-apply on POST_0016 with Storage — run on the hosted-like lab (REPORT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ACL, BODIES, FILES, PRIVATE_BUCKETS, REF, changedOutside, classify, phraseFor, run } from './remote/db-0017.mjs';

const MIGRATION = fs.readFileSync(FILES['apply-0017'].path, 'utf8');
const ROLLBACK = fs.readFileSync(FILES['rollback-0017'].path, 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const body = (name) => { const i = MIGRATION.indexOf(`create function ${name}`); const j = MIGRATION.indexOf('as $$', i) + 5; return MIGRATION.slice(j, MIGRATION.indexOf('$$;', j)); };

test('the pinned files and bodies are the ones in the tree', () => {
  assert.equal(sha256(MIGRATION), FILES['apply-0017'].sha256);
  assert.equal(sha256(ROLLBACK), FILES['rollback-0017'].sha256);
  assert.equal(crypto.createHash('md5').update(body('public.authorize_tournament_storage_objects')).digest('hex'), BODIES.POST_0017.authorize);
  assert.equal(crypto.createHash('md5').update(body('private.tournament_branding_object_in_use')).digest('hex'), BODIES.POST_0017.in_use);
  assert.equal(phraseFor('apply-0017'), `APPLY TORNEOS 0017 ${REF} ${FILES['apply-0017'].sha256.slice(0, 12)}`);
});

test('0017 adds exactly two functions: no policy, table grant, bucket or role change; anon never; buckets stay private', () => {
  const statements = MIGRATION.replace(/--[^\n]*/g, '');
  assert.equal((statements.match(/create function/gi) || []).length, 2);
  for (const forbidden of [/create policy/i, /drop policy/i, /alter policy/i, /grant\s+(select|insert|update|delete|all)\s+on\s+(table|storage)/i,
    /update\s+storage\.buckets/i, /insert\s+into\s+storage/i, /alter\s+role/i, /create\s+role/i, /security\s+invoker/i, /set\s+role/i]) {
    assert.doesNotMatch(statements, forbidden, String(forbidden));
  }
  assert.match(statements, /revoke all on function public\.authorize_tournament_storage_objects\(text, text, text\[\]\) from public, anon, service_role;/);
  assert.match(statements, /grant execute on function public\.authorize_tournament_storage_objects\(text, text, text\[\]\) to authenticated;/);
  assert.match(statements, /revoke all on function private\.tournament_branding_object_in_use\(text\) from public, anon, authenticated, service_role;/);
  assert.equal((statements.match(/^grant /gmi) || []).length, 1, 'one grant only');
  // The decisions are the EXISTING storage predicates, nothing new decides access.
  for (const predicate of ['can_read_tournament_branding_object', 'can_write_tournament_branding_object', 'is_tournament_branding_path',
    'can_write_tournament_media_gateway_object', 'can_delete_tournament_media_gateway_object', 'can_read_tournament_media_object']) {
    assert.ok(body('public.authorize_tournament_storage_objects').includes(`public.${predicate}(v_name)`), predicate);
  }
  assert.match(body('public.authorize_tournament_storage_objects'), /'delete'[\s\S]*not private\.tournament_branding_object_in_use\(v_name\)/,
    'a branding object in use is never removable');
  assert.match(body('public.authorize_tournament_storage_objects'), /private\.current_identity_id\(\) is null[\s\S]*TORNEOS_AUTH_REQUIRED/);
  assert.match(body('public.authorize_tournament_storage_objects'), /cardinality\(p_names\) not between 1 and 200/);
  for (const column of ['tournament_organizations organization where organization.logo_path', 'tournaments tournament where tournament.logo_path',
    'tournament_team_entries entry where entry.shield_path', 'participant.snapshot_shield_path']) {
    assert.ok(body('private.tournament_branding_object_in_use').includes(column), column);
  }
  assert.match(MIGRATION, /^BEGIN;/m); assert.match(MIGRATION, /^COMMIT;/m);
  assert.match(ROLLBACK, /drop function public\.authorize_tournament_storage_objects\(text, text, text\[\]\);/);
  assert.match(ROLLBACK, /drop function private\.tournament_branding_object_in_use\(text\);/);
  assert.doesNotMatch(ROLLBACK.replace(/--[^\n]*/g, ''), /policy|storage\.objects|delete from|truncate/i, 'the rollback touches no data');
});

const kept = { kept_fn: { count: 420, digest: 'f' }, kept_relations: { count: 90, digest: 'r' }, kept_policies: { count: 300, digest: 'p' } };
const catalogAt = (state, mutate = (c) => c) => mutate({
  torneos_tables: true, prerequisites: { branding: true, media: true }, buckets: JSON.parse(JSON.stringify(PRIVATE_BUCKETS)),
  bodies: { ...BODIES[state] }, acl: state === 'POST_0017' ? JSON.parse(JSON.stringify(ACL)) : { authorize: null, in_use: null },
  counts: { authenticated: state === 'POST_0017' ? 205 : 204, anon: 16 }, ...JSON.parse(JSON.stringify(kept)),
});

test('classify: the two states, and every drift by name', () => {
  assert.deepEqual(classify(catalogAt('PRE_0017')), { state: 'PRE_0017', failures: [] });
  assert.deepEqual(classify(catalogAt('POST_0017')), { state: 'POST_0017', failures: [] });
  assert.equal(classify(null).state, 'DRIFT');
  const drift = (mutate) => classify(catalogAt('POST_0017', (c) => { mutate(c); return c; }));
  assert.match(drift((c) => { c.acl.authorize.anon = true; }).failures.join(), /acl\.authorize/, 'anon may never execute');
  assert.match(drift((c) => { c.acl.in_use.authenticated = true; }).failures.join(), /acl\.in_use/);
  assert.match(drift((c) => { c.buckets['tournament-media'].public = true; }).failures.join(), /bucket tournament-media/, 'a public bucket is drift');
  assert.match(drift((c) => { c.bodies.authorize = 'x'; }).failures.join(), /bodies/);
  assert.match(drift((c) => { c.prerequisites.media = false; }).failures.join(), /media_v1_missing/);
});

test('run: phrase, hash, states and "nothing else moved" gate every write; the rollback goes back exactly', async () => {
  let current = 'PRE_0017';
  const applied = [];
  const deps = (opts = {}) => ({
    catalog: async () => catalogAt(current, opts.mutate ?? ((c) => c)),
    applySql: async (sql) => { applied.push(sql.slice(0, 40)); current = sql.includes('drop function') ? 'PRE_0017' : 'POST_0017'; return { code: 0 }; },
  });
  await assert.rejects(run('apply-0017', ['APPLY', 'TORNEOS', '0017'], deps()), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply-0017', phraseFor('apply-0017').split(' '), { ...deps(), readFile: () => Buffer.from('tampered') }), /FILE_HASH_MISMATCH/);
  await assert.rejects(run('rollback-0017', phraseFor('rollback-0017').split(' '), deps()), /PRE_STATE_PRE_0017/, 'nothing to roll back');
  const ok = await run('apply-0017', phraseFor('apply-0017').split(' '), deps());
  assert.deepEqual([ok.verdict, ok.before, ok.after, ok.changedOutside], ['APPLY_0017_DONE', 'PRE_0017', 'POST_0017', []]);
  await assert.rejects(run('apply-0017', phraseFor('apply-0017').split(' '), deps()), /PRE_STATE_POST_0017/, 'never re-applied');
  const back = await run('rollback-0017', phraseFor('rollback-0017').split(' '), deps());
  assert.deepEqual([back.verdict, back.after, back.changedOutside], ['ROLLBACK_0017_DONE', 'PRE_0017', []]);
  assert.equal(applied.length, 2);
  // Something else moving during the write makes the step FAILED (the file's own transaction already committed: evidence).
  current = 'PRE_0017';
  let calls = 0;
  const moving = { catalog: async () => catalogAt(current, (c) => { if (calls++ > 0) c.kept_policies.digest = 'changed'; return c; }),
    applySql: async () => { current = 'POST_0017'; return { code: 0 }; } };
  const failed = await run('apply-0017', phraseFor('apply-0017').split(' '), moving);
  assert.deepEqual([failed.verdict, failed.changedOutside], ['APPLY_0017_FAILED', ['kept_policies']]);
  assert.deepEqual(changedOutside(catalogAt('PRE_0017'), catalogAt('POST_0017', (c) => { c.counts.anon = 17; return c; }), 'apply'), ['counts'], 'anon never gains anything');
  const observed = await run('observe', [], deps());
  assert.equal(observed.verdict.state, 'POST_0017');
});

test('the catalog is one read-only JSON select that passes the real transport guard, naming every pinned object', async () => {
  const C = await import('../infra/torneos-officialization-error-v1/oec-remote-contract.mjs');
  const sql = fs.readFileSync(new URL('./remote/sql-catalog-0017.sql', import.meta.url), 'utf8').trim();
  const script = C.readOnlyScript(sql);
  assert.match(script, /^BEGIN TRANSACTION READ ONLY;\nwith\b/);
  assert.match(script, /\n\)::text;\nROLLBACK;\n$/);
  for (const name of ['authorize_tournament_storage_objects', 'tournament_branding_object_in_use', 'storage.buckets', "'storage'",
    'can_write_tournament_media_gateway_object', 'can_write_tournament_branding_object']) {
    assert.ok(sql.includes(name), name);
  }
});
