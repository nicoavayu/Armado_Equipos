// COMMERCE-PRODUCTION — the Production DB driver (remote/db-0013.mjs) run against a disposable database of its own
// (arma2-commerce-production-lab-drv-<checkout tag>, a port Docker picks) with the REAL catalog SQL and the REAL statements; only the transport
// (psql over the pooler) and the Keychain are replaced. POST_0011 → apply → switch / allowlist → login → refusals →
// drop-login → rollback → POST_0011.
//   node --test backend/torneos/commerce-production/db-0013.test.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = 'arma2-commerce-production-lab-drv';
const lab = await import('./lab/pg-lab.mjs');
const fx = await import('./lab/fixtures.mjs');
const D = await import('./remote/db-0013.mjs');
const P = await import('../infra/torneos-payments-production/production-contract.mjs');
const { scramVerifier } = await import('../infra/torneos-gateway-auth/gateway-auth-contract.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_SQL = fs.readFileSync(path.join(HERE, 'remote/sql-catalog.sql'), 'utf8').trim();
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// The Keychain, in memory: generate once, never overwrite (the helper's contract).
function memoryKeychain() {
  let value = null;
  return { dbPassword: { check: () => (value ? 'PRESENT' : 'ABSENT'), generate: () => { if (value) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_OVERWRITE'); value = crypto.randomBytes(30).toString('base64url'); return 'KEYCHAIN_GENERATED'; }, read: () => value } };
}
const keychain = memoryKeychain();
const deps = {
  catalog: async () => JSON.parse(lab.sql(CATALOG_SQL).trim().split('\n').filter(Boolean).pop()),
  applySql: async (text) => { const r = lab.sqlTry(text); return { code: r.ok ? 0 : 1, stderr_tail: r.error ?? '' }; },
  keychain,
  scram: (password) => P.renderProductionLoginSql(scramVerifier(password)),
};
const phrase = (...words) => words.join(' ').split(' ');
const run = (mode, ...args) => D.run(mode, args.flatMap((a) => String(a).split(' ')), deps);

before(async () => { await lab.up({ fresh: true, upTo: lab.BEFORE_0013 }); });
after(() => lab.down());

test('the driver pins exactly the files of this branch and the Torneos data plane', () => {
  assert.equal(D.REF, 'onzpwnqxnvlgsevivngf');
  for (const f of Object.values(D.FILES)) assert.equal(sha256(fs.readFileSync(f.path)), f.sha256, f.rel);
});

test('classify fails closed on partial states, a foreign login or a changed TEST chain', async () => {
  const pre = await deps.catalog();
  assert.equal(D.classify(pre).state, 'PRE_0013');
  assert.equal(D.classify({ ...pre, production_role: true }).state, 'DRIFT');
  assert.equal(D.classify({ ...pre, test_chain: { ...pre.test_chain, 'public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)': '0'.repeat(32) } }).state, 'DRIFT');
  assert.equal(D.classify({ ...pre, production_logins: [{ name: 'someone', login: true, inherit: false, super: false, bypassrls: false }] }).state, 'DRIFT');
  assert.equal(D.classify(null).state, 'DRIFT');
});

test('the whole operator life cycle on a real database', async () => {
  // wrong phrase: nothing happens
  await assert.rejects(run('apply-0013', 'APPLY TORNEOS 0013'), /PHRASE_REQUIRED/);
  assert.equal(D.classify(await deps.catalog()).state, 'PRE_0013');
  const sha12 = D.FILES['apply-0013'].sha256.slice(0, 12);
  const applied = await run('apply-0013', `APPLY TORNEOS 0013 ${D.REF} ${sha12}`);
  assert.deepEqual([applied.verdict, applied.before, applied.after, applied.outsideUnchanged, applied.scope], ['APPLY_0013_DONE', 'PRE_0013', 'POST_0013', true, 'off']);
  await assert.rejects(run('apply-0013', `APPLY TORNEOS 0013 ${D.REF} ${sha12}`), /PRE_STATE_POST_0013/);

  // the switch and the allowlist
  const w = fx.world('driver');
  assert.equal((await run('scope', 'allowlist', `SET TORNEOS COMMERCE PRODUCTION SCOPE allowlist ${D.REF}`)).verdict, 'SCOPE_DONE');
  assert.equal((await run('allow', w.org, `ALLOW TORNEOS COMMERCE PRODUCTION ORG ${w.org} ${D.REF}`)).verdict, 'ALLOW_DONE');
  await assert.rejects(run('allow', 'not-a-uuid', `ALLOW TORNEOS COMMERCE PRODUCTION ORG not-a-uuid ${D.REF}`), /ORGANIZATION_ID_INVALID/);
  await assert.rejects(run('scope', 'live', `SET TORNEOS COMMERCE PRODUCTION SCOPE live ${D.REF}`), /SCOPE_INVALID/);
  assert.equal(fx.checkout(w.owner, w).providerEnvironment, 'production');
  assert.equal((await run('disallow', w.org, `DISALLOW TORNEOS COMMERCE PRODUCTION ORG ${w.org} ${D.REF}`)).verdict, 'DISALLOW_DONE');
  assert.equal((await run('scope', 'off', `SET TORNEOS COMMERCE PRODUCTION SCOPE off ${D.REF}`)).scope, 'off');

  // the production login: generated into the Keychain, only the SCRAM verifier reaches the database, and it works
  const login = await run('login', `CREATE TORNEOS PAYMENTS PRODUCTION LOGIN ${P.PRODUCTION_LOGIN} ${D.REF}`);
  assert.equal(login.verdict, 'LOGIN_DONE');
  await assert.rejects(run('login', `CREATE TORNEOS PAYMENTS PRODUCTION LOGIN ${P.PRODUCTION_LOGIN} ${D.REF}`), /ALREADY_PRESENT/);
  const client = new pg.Client({ connectionString: `postgres://${P.PRODUCTION_LOGIN}:${encodeURIComponent(keychain.dbPassword.read())}@127.0.0.1:${lab.state().port}/postgres` });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${P.PRODUCTION_ROLE}`);
    const { rows } = await client.query('SELECT public.list_production_tournament_purchases_to_reconcile(5) AS result');
    assert.ok(Array.isArray(rows[0].result));
    await client.query('ROLLBACK');
    await assert.rejects(client.query('SELECT count(*) FROM public.tournament_purchases'), /permission denied/);
    await assert.rejects(client.query('SET ROLE torneos_payment_service'), /permission denied/);
  } finally {
    await client.end();
  }

  // rollback refuses while a login or a production purchase exists
  const rsha12 = D.FILES['rollback-0013'].sha256.slice(0, 12);
  await assert.rejects(run('rollback-0013', `ROLLBACK TORNEOS 0013 ${D.REF} ${rsha12}`), /ROLLBACK_REFUSED/);
  assert.equal((await run('drop-login', `DROP TORNEOS PAYMENTS PRODUCTION LOGIN ${P.PRODUCTION_LOGIN} ${D.REF}`)).verdict, 'DROP_LOGIN_DONE');
  await assert.rejects(run('rollback-0013', `ROLLBACK TORNEOS 0013 ${D.REF} ${rsha12}`), /ROLLBACK_REFUSED/, 'the purchase created above is history');
});

test('rollback on a database that never sold anything returns to the state before 0013', async () => {
  await lab.up({ fresh: true, upTo: lab.BEFORE_0013 });
  const pristine = await deps.catalog();
  const sha12 = D.FILES['apply-0013'].sha256.slice(0, 12);
  await run('apply-0013', `APPLY TORNEOS 0013 ${D.REF} ${sha12}`);
  const out = await run('rollback-0013', `ROLLBACK TORNEOS 0013 ${D.REF} ${D.FILES['rollback-0013'].sha256.slice(0, 12)}`);
  assert.deepEqual([out.verdict, out.after, out.outsideUnchanged], ['ROLLBACK_0013_DONE', 'PRE_0013', true]);
  const back = await deps.catalog();
  assert.deepEqual({ ...back, production_purchases: null }, { ...pristine, production_purchases: null });
});
