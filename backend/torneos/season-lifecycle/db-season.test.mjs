// SEASON operator driver (0018 / 0019 / runner): offline gates with fakes, then the real transitions through the SAME
// run() on the season lab (pg-lab container, 0000→0017 + 0018 as the other season suites leave it).
//   COMMERCE_PRODUCTION_LAB_CONTAINER=arma2-season-lab-db node --test backend/torneos/season-lifecycle/db-season.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FILES, REF, RUNNER_JOBS, budgetSql, changedOutside, classify, phraseFor, run } from './remote/db-season.mjs';

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const CATALOG_SQL = fs.readFileSync(new URL('./remote/sql-catalog-season.sql', import.meta.url), 'utf8');

test('pins: each file of this branch, its phrase, and the catalog passes the real read-only transport guard', async () => {
  assert.equal(REF, 'onzpwnqxnvlgsevivngf');
  for (const f of Object.values(FILES)) assert.equal(sha256(f.path), f.sha256, f.rel);
  assert.equal(phraseFor('apply-0018'), `APPLY TORNEOS 0018 ${REF} ${FILES['apply-0018'].sha256.slice(0, 12)}`);
  assert.equal(phraseFor('rollback-runner'), `ROLLBACK TORNEOS RUNNER ${REF} ${FILES['rollback-runner'].sha256.slice(0, 12)}`);
  const C = await import('../infra/torneos-officialization-error-v1/oec-remote-contract.mjs');
  assert.match(C.readOnlyScript(CATALOG_SQL.trim()), /^BEGIN TRANSACTION READ ONLY;\n(with|select)\b/);
  assert.doesNotMatch(CATALOG_SQL.replace(/--[^\n]*/g, ''), /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|set )\b/i);
});

test('budget: literal values only, ≤ 1 GB, gallery ≤ project', () => {
  assert.match(budgetSql(471859200, 419430400), /SET project_max_bytes = 471859200, gallery_max_bytes = 419430400/);
  for (const [p, g] of [[2 * 1024 ** 3, 1048576], [1048576, 2097152], ['12.5', 1048576], [1048576, '1; drop table x']]) {
    assert.throws(() => budgetSql(p, g), /BUDGET_INVALID/);
  }
});

const BASE = {
  torneos_tables: true, counts: { authenticated: 1, anon: 1 }, kept_fn: { d: 1 }, kept_relations: { d: 1 }, kept_policies: { d: 1 },
  season: { columns: [], not_activated: 0, premium_limit: 1000, free_limit: 25 }, offer: { amount: 39900, list: 49900, label: 'Precio lanzamiento' },
  cron: { extension: false, jobs: null }, acl: {},
  bodies: { enforce: '4c985973a92c677919703bbfc0bfbca2', season9: '3e6a6f6a5fa220ec1b83471b128eed62', season10: null,
    can_read: '5316ae2ddb16f714071d43dc76b5c704', usage: '27bd920bcb72052296f31016dcd4cc97', entitlements: 'bf263acafb185ee0993117d5805bc701',
    lifecycle: null, purge_claim: null, purge_complete: null, checkout: null, activation: null, status_policy: null,
    reversal_policy: null, purchases: null, purge_request: null },
};

test('classify: Production today, and every leftover or half state is DRIFT', () => {
  assert.equal(classify(BASE).state, 'PRE_0018+NONE+RUNNER_OFF');
  assert.equal(classify({ torneos_tables: false }).state, 'DRIFT');
  assert.equal(classify({ ...BASE, bodies: { ...BASE.bodies, enforce: 'x' } }).state, 'DRIFT');
  assert.equal(classify({ ...BASE, season: { ...BASE.season, columns: ['activated_at'] } }).state, 'DRIFT');
  assert.equal(classify({ ...BASE, cron: { extension: true, jobs: RUNNER_JOBS } }).state, 'DRIFT', 'jobs without the runner function');
  assert.deepEqual(changedOutside(BASE, { ...BASE, counts: { authenticated: 2, anon: 1 } }), ['counts']);
});

function fakeDb(catalogs, { code = 0 } = {}) {
  let i = 0; const applied = [];
  return { applied, deps: {
    readFile: (p) => fs.readFileSync(p),
    catalog: async () => catalogs[Math.min(i, catalogs.length - 1)],
    applySql: async (text) => { applied.push(text); i += 1; return { code }; },
  } };
}

test('gates: phrase, file hash, the state of its own axis before, and nothing else moving', async () => {
  await assert.rejects(run('apply-0018', ['APPLY', 'TORNEOS', '0018'], fakeDb([BASE]).deps), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply-0018', phraseFor('apply-0018').split(' '), { ...fakeDb([BASE]).deps, readFile: () => Buffer.from('x') }), /FILE_HASH_MISMATCH/);
  const early = fakeDb([BASE]);
  await assert.rejects(run('apply-0019', phraseFor('apply-0019').split(' '), early.deps), /PRE_STATE_PRE_0018\+NONE/);
  // 0019 on 0013 but without 0018: refused by the order rule (its own axis would allow it).
  const no18 = fakeDb([{ ...BASE, offer: BASE.offer, bodies: { ...BASE.bodies, checkout: 'fc9559b0c1fb1b070c13ab1be0bda395',
    activation: 'abe70db7fc988f0e06a505f63aeca330', status_policy: '071388d5357883a14066f95cc633f1e7',
    reversal_policy: '80a0fe7a8fec2f34a8219d9b6514d82e', purchases: '484f63507d2e789bf0d15381c0a5d9ac' } }]);
  await assert.rejects(run('apply-0019', phraseFor('apply-0019').split(' '), no18.deps), /PRE_STATE_PRE_0018\+POST_0013\+RUNNER_OFF order/);
  assert.equal(no18.applied.length, 0);
  assert.equal(early.applied.length, 0);
  await assert.rejects(run('budget', ['471859200', '419430400', 'SET', 'TORNEOS'], fakeDb([BASE]).deps), /PHRASE_REQUIRED/);
  const moved = fakeDb([BASE, { ...BASE, kept_fn: { d: 2 } }]);
  const out = await run('budget', ['471859200', '419430400', ...phraseFor('budget', ['471859200', '419430400']).split(' ')], moved.deps);
  assert.equal(out.verdict, 'BUDGET_FAILED'); assert.deepEqual(out.changedOutside, ['kept_fn']);
});

// ---------------------------------------------------------------- the real transitions on the season lab
test('rehearsal on the lab: rollback-0018 → apply-0018 → apply-0019 → apply-runner → budget → back', { timeout: 600000 }, async (t) => {
  let lab;
  try { lab = await import('../commerce-production/lab/pg-lab.mjs'); await lab.up({ upTo: '00000000000017' }); } catch (error) {
    t.skip(`lab unavailable: ${error.message}`); return;
  }
  const deps = {
    readFile: (p) => fs.readFileSync(p),
    catalog: async () => JSON.parse(lab.sql(CATALOG_SQL).trim().split('\n').filter(Boolean).pop()),
    applySql: async (text) => { const r = lab.sqlTry(text); return { code: r.ok ? 0 : 3, error: r.error }; },
  };
  // The login of the payments role is irrelevant here (0013 is never rolled back by this driver).
  const step = async (mode) => {
    const out = await run(mode, phraseFor(mode).split(' '), deps);
    assert.equal(out.verdict, `${mode.toUpperCase().replace('-', '_')}_DONE`, `${mode}: ${JSON.stringify({ before: out.before, after: out.after, moved: out.changedOutside, failures: out.failures, psql: out.psql })}`);
    return out;
  };
  const start = classify(await deps.catalog());
  assert.notEqual(start.state, 'DRIFT', JSON.stringify(start));
  if (start.runner === 'ON') await step('rollback-runner');
  if (start.commerce === 'POST_0019') await step('rollback-0019');
  if (start.media === 'POST_0018') await step('rollback-0018');
  assert.equal(classify(await deps.catalog()).media, 'PRE_0018');
  await step('apply-0018');
  await step('apply-0019');
  await step('apply-runner');
  const before = (await deps.catalog()).budget;
  const set = await run('budget', ['400000000', '350000000', ...phraseFor('budget', ['400000000', '350000000']).split(' ')], deps);
  assert.equal(set.verdict, 'BUDGET_DONE');
  const restore = await run('budget', [String(before.project), String(before.gallery), ...phraseFor('budget', [String(before.project), String(before.gallery)]).split(' ')], deps);
  assert.equal(restore.verdict, 'BUDGET_DONE');
  // A wrong-order step is refused before any write: 0018 cannot be rolled back under 0019 or the runner.
  await assert.rejects(run('rollback-0018', phraseFor('rollback-0018').split(' '), deps), /PRE_STATE_POST_0018\+POST_0019\+RUNNER_ON order/);
  await step('rollback-runner');
  await step('rollback-0019');
  assert.equal(classify(await deps.catalog()).state, 'POST_0018+POST_0013+RUNNER_OFF');
});
