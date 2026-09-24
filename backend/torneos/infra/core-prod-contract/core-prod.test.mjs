#!/usr/bin/env node
// INFRA-0.5 — OFFLINE tests of the Core PRODUCTION contract tooling. No socket is opened: the
// Management API transport, the Keychain, the tty and fetch are injected. The signed harness runs
// against the REAL certified handler (supabase/functions/_shared/torneosCoreContract.ts, imported
// by Node's type stripping) with an injected SQL executor. Run:
//   node --test backend/torneos/infra/core-prod-contract/core-prod.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as P from './prod-contract.mjs';
import { prodClient, assertProdRequest, ProdRequestError } from './mgmt-prod.mjs';
import { probeProd, probeOnceProd, PROD_ENDPOINT, responseSensitiveFindings } from './probe-prod.mjs';
import { runProd, StopError, REQUEST_KEYS } from './core-prod-deploy.mjs';
import { systemKeychain } from './keychain-prod.mjs';
import * as C from '../../phase3b/remote/core-contract.mjs';
import { assertReadOnlySql } from '../../phase3b/remote/mgmt.mjs';
import { WRITER_CONTEXT_SQL } from '../../phase3b/remote/mgmt-write.mjs';
import { probeOnce as certifiedProbeOnce } from '../../phase3b/remote/probe-core-contract.mjs';
import { handleContractRequest, parseServiceSecret } from '../../../../supabase/functions/_shared/torneosCoreContract.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const PROD = 'rcyuuoaqfwcembdajcss';
const STAGING = 'hhyvmhgpapyuzjgxfnqv';
const PAT = 'sbp_0123456789abcdef0123456789abcdef01234567';
const PROD_SECRET = crypto.createHash('sha256').update('infra-0.5 synthetic production secret').digest('hex');
const NONPROD_SECRET = crypto.createHash('sha256').update('infra-0.5 synthetic nonprod secret').digest('hex');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const V1 = '20260914120000';
const V11 = '20260915120000';

// ─────────────────────────── fakes ───────────────────────────
const BASELINE = JSON.parse(fs.readFileSync(path.join(HERE, 'pins/production-ledger-baseline.json'), 'utf8'));
const PREREQ_OK = () => JSON.parse(JSON.stringify(P.PREREQUISITES_EXPECTED));
const CATALOG = { public_functions: { count: 900, digest: 'a'.repeat(32) }, public_relations: { count: 300, digest: 'b'.repeat(32) }, public_columns: { count: 3000, digest: 'c'.repeat(32) }, public_policies: { count: 200, digest: 'd'.repeat(32) }, public_triggers: { count: 100, digest: 'e'.repeat(32) }, namespaces: { count: 10, digest: 'f'.repeat(32) }, default_acl: { count: 27, digest: '1'.repeat(32) }, roles: { count: 31, digest: '2'.repeat(32) }, memberships: { count: 19, digest: '4'.repeat(32) }, ledger_other: { count: 236, digest: '3'.repeat(32) } };
const contractRow = (m, kind) => ({ version: m.version, name: m.name, statements_is_null: false, statements_count: kind === 'ours' ? m.statements_count : 1, statements_digest: kind === 'ours' ? m.ledger_digest : '0'.repeat(32), statements_bytes: kind === 'ours' ? m.ledger_bytes : 10, created_by_is_null: true, idempotency_key_is_null: true, rollback_is_null: true });
function shapeRow(bad) {
  const o = JSON.parse(JSON.stringify(C.LEDGER_SHAPE_EXPECTED));
  o.relation.owner = 'postgres'; o.columns = o.columns.map((c) => ({ ...c, identity: '', generated: '' }));
  o.totals = { total_rows: 236 }; o.standard_conforming_strings = 'on';
  if (bad) o.columns = o.columns.slice(0, 3);
  return o;
}
function aclOf(installed) {
  return {
    functions: C.CONTRACT_OBJECTS.functions.map((f) => ({ signature: f.signature, present: installed.v1, security_definer: installed.v1 ? f.security_definer : null, search_path_empty: installed.v1, owner: installed.v1 ? 'postgres' : null, execute: installed.v1 ? f.execute : { anon: null, authenticated: null, service_role: null } })),
    tables: C.CONTRACT_OBJECTS.tables.map((t) => ({ name: t.name, present: installed.v1, rls: installed.v1 ? true : null, owner: installed.v1 ? 'postgres' : null, privileges: installed.v1 ? t.privileges : { anon: null, authenticated: null, service_role: null }, indexes: installed.v1 ? t.indexes : [] })),
    schema: { app_private_present: installed.v1, usage: installed.v1 ? { anon: false, authenticated: false, service_role: false } : { anon: null, authenticated: null, service_role: null } },
    session_branch: Boolean(installed.v1 && installed.v11), stray_objects: 0, stray_relations: 0,
  };
}
function fakeProd(over = {}) {
  const s = {
    project: { ...P.PRODUCTION_PROJECT, status: 'ACTIVE_HEALTHY', database_version: '17.4.1.048' },
    badShape: false, rows: BASELINE.rows.map((r) => ({ ...r })), contract: { [V1]: null, [V11]: null }, installed: { v1: false, v11: false },
    writer: { writer: 'postgres', database_create: true, public_create: true, ledger_insert: true, ledger_delete: true, app_private_present: false, app_private_create: null, database_owner: 'postgres', ledger_owner: 'postgres' },
    prereq: PREREQ_OK(), secretNames: ['OTHER_FUNCTION_SECRET'], secretValue: null, fn: null, catalog: JSON.parse(JSON.stringify(CATALOG)),
    writerContext: { api_role: 'postgres', session_role: 'postgres', transaction_read_only: 'off', in_recovery: false },
    failApply: false, catalogDriftAfterApply: false, ambiguous: null, appPrivateOverride: null, aclOverride: null,
    ...over,
  };
  const log = [];
  const writes = [];
  const q = (body) => body.query;
  const transport = async (req) => {
    log.push({ method: req.method, path: req.path, read_only: req.body?.read_only ?? null, query_sha256: req.body?.query ? sha(req.body.query) : null });
    const base = `/v1/projects/${PROD}`;
    if (req.method === 'GET' && req.path === base) return { status: 200, body: { id: PROD, ref: PROD, name: s.project.name, organization_id: s.project.organization_slug, organization_slug: s.project.organization_slug, region: s.project.region, status: s.project.status, created_at: s.project.created_at, database: { version: s.project.database_version } } };
    if (req.method === 'GET' && req.path === `${base}/secrets`) return { status: 200, body: s.secretNames.map((name) => ({ name, value: 'digest-not-a-secret' })) };
    if (req.method === 'GET' && req.path === `${base}/functions/torneos-core-contract`) return s.fn ? { status: 200, body: s.fn } : { status: 404, body: { message: 'Function not found' } };
    if (req.method === 'POST' && req.path === `${base}/database/query`) {
      const query = q(req.body);
      if (req.body.read_only === true) {
        assertReadOnlySql(query);
        if (s.ambiguous === query) return { status: 200, body: { unexpected: true } };
        if (query === C.LEDGER_SHAPE_SQL) return { status: 200, body: [{ shape: shapeRow(s.badShape) }] };
        if (query === P.LEDGER_ALL_ROWS_SQL) {
          const rows = [...s.rows];
          for (const m of P.AUTHORIZED_MIGRATIONS) if (s.contract[m.version]) rows.push(contractRow(m, s.contract[m.version]));
          return { status: 200, body: rows.sort((a, b) => Buffer.compare(Buffer.from(a.version), Buffer.from(b.version))) };
        }
        if (query === C.WRITER_PRIVILEGES_SQL) return { status: 200, body: [{ writer: { ...s.writer, app_private_present: s.installed.v1, app_private_create: s.installed.v1 ? true : null } }] };
        if (query === C.MIGRATIONS[0].probe) return { status: 200, body: [{ installed: s.installed.v1 }] };
        if (query === C.MIGRATIONS[1].probe) return { status: 200, body: [{ installed: s.installed.v1 && s.installed.v11 }] };
        if (query === P.PREREQUISITES_SQL) return { status: 200, body: [{ prerequisites: s.prereq }] };
        if (query === P.APP_PRIVATE_SQL) return { status: 200, body: [{ app_private: s.appPrivateOverride ?? (s.installed.v1 ? P.APP_PRIVATE_AFTER : P.APP_PRIVATE_BEFORE) }] };
        if (query === P.CATALOG_DIGEST_SQL) return { status: 200, body: [{ catalog: JSON.parse(JSON.stringify(s.catalog)) }] };
        if (query === C.CONTRACT_ACL_SQL) return { status: 200, body: [{ acl: s.aclOverride ?? aclOf(s.installed) }] };
        return { status: 400, body: { message: 'unknown probe' } };
      }
      assert.equal(req.body.read_only, false);
      if (query === WRITER_CONTEXT_SQL) return { status: 201, body: [s.writerContext] };
      writes.push({ kind: 'sql', sha256: sha(query) });
      if (s.failApply) return { status: 400, body: { message: 'boom' }, raw: 'boom' };
      const m = P.AUTHORIZED_MIGRATIONS.find((x) => x.apply_sql_sha256 === sha(query));
      if (m?.version === V1) { s.installed.v1 = true; s.contract[V1] = 'ours'; }
      if (m?.version === V11) { s.installed.v11 = true; s.contract[V11] = 'ours'; }
      if (s.catalogDriftAfterApply) s.catalog.public_functions.digest = '9'.repeat(32);
      return { status: 201, body: [] };
    }
    if (req.method === 'POST' && req.path === `${base}/secrets`) {
      writes.push({ kind: 'secrets', names: req.body.map((x) => x.name) });
      for (const x of req.body) { if (!s.secretNames.includes(x.name)) s.secretNames.push(x.name); s.secretValue = x.value; }
      return { status: 201, body: null };
    }
    if (req.method === 'POST' && req.path === `${base}/functions/deploy?slug=torneos-core-contract`) {
      writes.push({ kind: 'deploy', bytes: req.body.length });
      s.fn = { slug: 'torneos-core-contract', name: 'torneos-core-contract', status: 'ACTIVE', version: (s.fn?.version ?? 0) + 1, verify_jwt: false, ezbr_sha256: 'e'.repeat(64), entrypoint_path: 'file:///tmp/source/functions/torneos-core-contract/index.ts', updated_at: 1 };
      return { status: 201, body: s.fn };
    }
    return { status: 404, body: null };
  };
  return { s, log, writes, transport };
}
function fakeKeychain({ state = 'ABSENT', value = null, nonprod = NONPROD_SECRET, generateValue = PROD_SECRET, checkThrows = false, readThrows = false } = {}) {
  const st = { state, value };
  const calls = [];
  return {
    calls, st,
    kc: {
      namespace: P.KEYCHAIN_PROD,
      check() { calls.push('check'); if (checkThrows) throw new Error('keychain_check_ambiguous'); return st.state; },
      read() { calls.push('read'); if (readThrows || st.state !== 'PRESENT') throw new Error('keychain_read_failed'); return st.value; },
      readNonprod() { calls.push('readNonprod'); return nonprod; },
      generate() { calls.push('generate'); if (st.state === 'PRESENT') throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_REGENERATE'); st.state = 'PRESENT'; st.value = generateValue; return 'KEYCHAIN_GENERATED'; },
    },
  };
}
// The platform in front of the REAL certified handler: the secret the fake Management API received,
// the deployed flag, and an SQL executor with the durable-nonce semantics of torneos_contract_execute.
function fakeEdge(prod) {
  const nonces = new Set();
  return async (url, init) => {
    assert.ok(url.startsWith(PROD_ENDPOINT), `probe must target ${PROD_ENDPOINT}`);
    if (!prod.s.fn) return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const req = new Request(url, { method: init.method, headers: init.headers, body: init.body });
    return handleContractRequest(req, {
      functionName: 'torneos-core-contract',
      secret: parseServiceSecret(prod.s.secretValue ?? undefined),
      async execute(operation, nonce) {
        if (nonces.has(nonce)) return { status: 401, body: { error: 'REPLAY' } };
        nonces.add(nonce);
        assert.ok(['session', 'verified_email'].includes(operation));
        return { status: 403, body: { error: 'FORBIDDEN' } };
      },
    });
  };
}
function harness(over = {}, kcOver = {}, depsOver = {}) {
  const prod = fakeProd(over);
  const k = fakeKeychain(kcOver);
  const out = [];
  const evDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra05-ev-'));
  const prompts = [];
  const deps = {
    repo: REPO, transport: prod.transport, keychain: k.kc, fetchImpl: fakeEdge(prod), evidenceDir: evDir, out: (l) => out.push(l),
    probe: { retries: 0, interval_ms: 1 }, env: {},
    readConfirmation: (prompt, planId) => { prompts.push(prompt); return P.confirmationPhrase(planId); },
    ...depsOver,
  };
  return { prod, k, out, evDir, deps, prompts };
}
const evidenceText = (dir) => fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const run = (mode, h, request = { pat: PAT }) => runProd({ mode, request, deps: h.deps });
const stopCode = async (p) => { try { await p; } catch (e) { if (e instanceof StopError) return e.code; throw e; } return 'NO_STOP'; };

// ─────────────────────────── 1–3: Production target guard ───────────────────────────
test('target: the Production ref is pinned in the contract and is the only accepted target', () => {
  assert.equal(P.PROD_REF, PROD);
  assert.equal(P.PRODUCTION_PROJECT.ref, PROD);
  assert.equal(P.assertProductionRef(PROD), PROD);
  assert.equal(PROD_ENDPOINT, `https://${PROD}.supabase.co/functions/v1/torneos-core-contract`);
  assert.deepEqual(P.projectIdentityFailures({ ...P.PRODUCTION_PROJECT, status: 'ACTIVE_HEALTHY' }), []);
  assert.doesNotThrow(() => assertProdRequest({ method: 'GET', path: `/v1/projects/${PROD}` }));
});

test('target: the Staging ref is refused everywhere (guard, request path, body, token, request key)', async () => {
  assert.throws(() => P.assertProductionRef(STAGING), /ref_is_staging/);
  assert.throws(() => assertProdRequest({ method: 'GET', path: `/v1/projects/${STAGING}` }), ProdRequestError);
  assert.throws(() => assertProdRequest({ method: 'POST', path: `/v1/projects/${PROD}/database/query`, body: { query: `select '${STAGING}' as x`, read_only: true } }), /staging/);
  assert.throws(() => prodClient({ pat: `sbp_${STAGING}0123456789`, transport: async () => ({}) }), /staging|pat/);
  const h = harness();
  assert.equal(await stopCode(run('--preflight-only', h, { pat: PAT, ref: STAGING })), 'REQUEST_KEY_NOT_ACCEPTED');
  assert.equal(h.prod.log.length, 0);
});

test('target: an arbitrary, empty, malformed or unvalidated ref is refused; the tooling takes no ref input at all', async () => {
  for (const bad of ['', null, undefined, 'abcdefghijklmnopqrst', 'RCYUUOAQFWCEMBDAJCSS', `${PROD} `, `${PROD}x`, 'giaeztyghmhzcngskjmw']) {
    assert.throws(() => P.assertProductionRef(bad), P.ProdContractError, String(bad));
  }
  assert.throws(() => assertProdRequest({ method: 'GET', path: '/v1/projects/abcdefghijklmnopqrst' }), ProdRequestError);
  assert.throws(() => assertProdRequest({ method: 'GET', path: '/v1/projects' }), ProdRequestError);
  assert.throws(() => assertProdRequest({ method: 'GET', path: `/v1/organizations/gwqrborhnqjdzzmpxulh` }), ProdRequestError);
  assert.deepEqual(REQUEST_KEYS, ['pat']);
  for (const key of ['ref', 'project', 'target', 'confirm', 'confirmation', 'force', 'yes', 'secret']) {
    const h = harness();
    assert.equal(await stopCode(run('--preflight-only', h, { pat: PAT, [key]: 'x' })), 'REQUEST_KEY_NOT_ACCEPTED', key);
    assert.equal(h.prod.log.length, 0);
  }
  const h = harness({ project: { ...P.PRODUCTION_PROJECT, name: 'another project', status: 'ACTIVE_HEALTHY' } });
  assert.equal(await stopCode(run('--preflight-only', h)), 'PROJECT_IDENTITY_MISMATCH');
});

test('target: Production must be ACTIVE_HEALTHY', async () => {
  for (const status of ['INACTIVE', 'PAUSED', 'COMING_UP', 'RESTORING', 'UNKNOWN', null]) {
    const h = harness({ project: { ...P.PRODUCTION_PROJECT, status } });
    assert.equal(await stopCode(run('--preflight-only', h)), 'PROJECT_NOT_ACTIVE_HEALTHY', String(status));
    assert.equal(h.prod.writes.length, 0);
  }
});

// ─────────────────────────── 4–6: migration contract ───────────────────────────
test('migrations: exactly the two authorized versions, hashes frozen and equal to the certified Staging pins', () => {
  assert.deepEqual(P.AUTHORIZED_MIGRATIONS.map((m) => `${m.version}_${m.name}`), ['20260914120000_torneos_core_contract_v1', '20260915120000_torneos_core_contract_v1_1_session']);
  assert.equal(P.AUTHORIZED_MIGRATIONS[0].sha256, '2967ae6f67e36877c4931cb7821535eab10c5b7312026846f619b14fb045672c');
  assert.equal(P.AUTHORIZED_MIGRATIONS[1].sha256, '5256413839ad0abe9c9533a675461cc6589fd720e6b2bede3bc8d201a75ce422');
  assert.equal(P.AUTHORIZED_MIGRATIONS[0].apply_sql_sha256, '3d3e2845987ccdfd74b77ace51195865234066bb5828280fb0c8114969b84485');
  assert.equal(P.AUTHORIZED_MIGRATIONS[1].apply_sql_sha256, '859fa7a30dee4a03376a662ab74427927c6a8b8a404556abdd3bfa59e5e5b78c');
  for (const [i, m] of P.AUTHORIZED_MIGRATIONS.entries()) {
    const s = C.MIGRATIONS[i];
    assert.deepEqual([m.version, m.name, m.file, m.sha256, m.statements_count, m.ledger_digest, m.ledger_bytes], [s.version, s.name, s.file, s.sha256, s.statements_count, s.ledger_digest, s.ledger_bytes]);
    assert.equal(m.apply_sql_sha256, C.APPLY_SQL_SHA256[m.version]);
    assert.equal(sha(fs.readFileSync(path.join(REPO, m.file))), m.sha256);
  }
  const r = P.renderAuthorized(REPO);
  assert.deepEqual(r.map((m) => m.apply_sql_sha256), P.AUTHORIZED_MIGRATIONS.map((m) => m.apply_sql_sha256));
  assert.doesNotThrow(() => P.assertAuthorizedPlan([V1, V11]));
});

function tempRepo(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra05-repo-'));
  for (const rel of [...P.AUTHORIZED_MIGRATIONS.map((m) => m.file), ...P.FUNCTION_ARTIFACT.files.map((f) => path.join(P.FUNCTION_ARTIFACT.root, f.path))]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  }
  mutate(dir);
  return dir;
}

test('migrations: a modified or missing migration file is refused before the PAT is used (0 requests)', async () => {
  const modified = tempRepo((d) => fs.appendFileSync(path.join(d, P.AUTHORIZED_MIGRATIONS[1].file), '\n-- drift\n'));
  assert.throws(() => P.renderAuthorized(modified), /hash_mismatch/);
  const h = harness({}, {}, { repo: modified });
  assert.equal(await stopCode(run('--preflight-only', h)), 'PINS_MISMATCH');
  assert.equal(h.prod.log.length, 0);
  assert.equal(h.k.calls.length, 0);
  const missing = tempRepo((d) => fs.rmSync(path.join(d, P.AUTHORIZED_MIGRATIONS[0].file)));
  const h2 = harness({}, {}, { repo: missing });
  assert.equal(await stopCode(run('--preflight-only', h2)), 'PINS_MISMATCH');
  assert.equal(h2.prod.log.length, 0);
});

test('migrations: an extra, missing or reordered migration in the plan is refused; the transport refuses any non-pinned write SQL', () => {
  assert.throws(() => P.assertAuthorizedPlan([V1, V11, '20260916120000']), /migration_not_authorized/);
  assert.throws(() => P.assertAuthorizedPlan([V1]), /plan_must_be_exactly/);
  assert.throws(() => P.assertAuthorizedPlan([V11, V1]), /plan_order/);
  assert.throws(() => P.assertAuthorizedPlan([V1, V1]), /plan_order|duplicate/);
  const q = (query) => ({ method: 'POST', path: `/v1/projects/${PROD}/database/query`, body: { query, read_only: false }, armed: true });
  const rendered = P.renderAuthorized(REPO);
  assert.doesNotThrow(() => assertProdRequest(q(rendered[0].apply_sql)));
  assert.doesNotThrow(() => assertProdRequest(q(rendered[1].apply_sql)));
  assert.throws(() => assertProdRequest(q(`${rendered[1].apply_sql}\nselect 1;`)), /write_sql_not_pinned/);
  assert.throws(() => assertProdRequest(q('begin;\ncreate table public.x (id int);\ncommit;\n')), /write_sql_not_pinned/);
  assert.throws(() => assertProdRequest(q(C.ledgerInsertSql(rendered[0].row))), /write_sql_not_pinned/, 'no ledger-only INSERT (no mark-as-applied) in Production');
  assert.throws(() => assertProdRequest({ ...q(rendered[0].apply_sql), armed: false }), /not_armed/);
});

// ─────────────────────────── 7: ledger model ───────────────────────────
test('ledger: the pinned Production baseline (236 rows, read-only capture 2026-09-11) is frozen by hash', () => {
  const text = fs.readFileSync(P.LEDGER_BASELINE_FILE);
  assert.equal(sha(text), P.LEDGER_BASELINE_SHA256);
  const b = P.loadLedgerBaseline();
  assert.equal(b.rows.length, 236);
  assert.equal(b.totals.max_version, '20260903213456');
  assert.equal(b.source.sha256, 'd00faa708ab6e6659882d897511bc60930b1872e230112b07ba8bd9aadd5162d');
  assert.ok(b.rows.every((r) => r.version < V1), 'every baseline version precedes the contract versions');
  assert.ok(!b.rows.some((r) => [V1, V11].includes(r.version)));
  assert.doesNotMatch(text.toString(), /"statements"\s*:/, 'digests only, never statements text');
});

test('ledger: evaluateLedger accepts the baseline (+ our own contract rows) and rejects every deviation', () => {
  const base = { shape: shapeRow(false), rows: BASELINE.rows };
  assert.equal(P.evaluateLedger(base).ok, true);
  assert.deepEqual(P.evaluateLedger(base).contract, { [V1]: 'absent', [V11]: 'absent' });
  const withOurs = { ...base, rows: [...BASELINE.rows, contractRow(P.AUTHORIZED_MIGRATIONS[0], 'ours')] };
  assert.equal(P.evaluateLedger(withOurs).ok, true);
  assert.equal(P.evaluateLedger(withOurs).contract[V1], 'ours');
  const cases = {
    shape: { ...base, shape: shapeRow(true) },
    missing_row: { ...base, rows: BASELINE.rows.slice(1) },
    added_row: { ...base, rows: [...BASELINE.rows, { ...BASELINE.rows[0], version: '20260910120000', name: 'unexpected' }] },
    changed_digest: { ...base, rows: BASELINE.rows.map((r, i) => (i === 7 ? { ...r, statements_digest: '0'.repeat(32) } : r)) },
    changed_name: { ...base, rows: BASELINE.rows.map((r, i) => (i === 9 ? { ...r, name: 'renamed' } : r)) },
    changed_flag: { ...base, rows: BASELINE.rows.map((r, i) => (i === 3 ? { ...r, created_by_is_null: !r.created_by_is_null } : r)) },
    non_boolean_flag: { ...base, rows: BASELINE.rows.map((r, i) => (i === 3 ? { ...r, rollback_is_null: 't' } : r)) },
    newer_foreign_version: { ...base, rows: [...BASELINE.rows, { ...BASELINE.rows[0], version: '20260920120000', name: 'later' }] },
    contract_row_foreign: { ...base, rows: [...BASELINE.rows, contractRow(P.AUTHORIZED_MIGRATIONS[0], 'foreign')] },
    duplicate_version: { ...base, rows: [...BASELINE.rows, BASELINE.rows[5]] },
    rows_not_array: { ...base, rows: { error: 'status_500' } },
  };
  for (const [name, input] of Object.entries(cases)) assert.equal(P.evaluateLedger(input).ok, false, name);
});

test('ledger: Production decision table — apply | skip | STOP (no reconcile, no mark-as-applied, no repair), in order', () => {
  assert.equal(P.prodApplyDecision(false, 'absent'), 'apply');
  assert.equal(P.prodApplyDecision(true, 'ours'), 'skip');
  assert.match(P.prodApplyDecision(true, 'absent'), /^STOP:objects_without_ledger_row/);
  assert.match(P.prodApplyDecision(true, 'foreign'), /^STOP:/);
  assert.match(P.prodApplyDecision(false, 'ours'), /^STOP:/);
  assert.match(P.prodApplyDecision(false, 'foreign'), /^STOP:/);
  assert.deepEqual(P.planMigrations([{ version: V1, installed: false, ledger: 'absent' }, { version: V11, installed: false, ledger: 'absent' }]).decisions.map((d) => d.decision), ['apply', 'apply']);
  assert.deepEqual(P.planMigrations([{ version: V1, installed: true, ledger: 'ours' }, { version: V11, installed: false, ledger: 'absent' }]).decisions.map((d) => d.decision), ['skip', 'apply']);
  assert.match(P.planMigrations([{ version: V1, installed: false, ledger: 'absent' }, { version: V11, installed: true, ledger: 'ours' }]).stop, /order/);
  assert.match(P.planMigrations([{ version: V1, installed: true, ledger: 'absent' }, { version: V11, installed: false, ledger: 'absent' }]).stop, /objects_without_ledger_row/);
});

test('ledger: an unexpected Production ledger STOPs the preflight with evidence and 0 writes', async () => {
  const variants = {
    missing: { rows: BASELINE.rows.slice(0, -1) },
    extra: { rows: [...BASELINE.rows, { ...BASELINE.rows[0], version: '20260912000000', name: 'surprise' }] },
    changed: { rows: BASELINE.rows.map((r, i) => (i === 100 ? { ...r, statements_bytes: r.statements_bytes + 1 } : r)) },
    shape: { badShape: true },
    foreign_contract_row: { contract: { [V1]: 'foreign', [V11]: null }, installed: { v1: true, v11: false } },
    objects_without_row: { installed: { v1: true, v11: false } },
  };
  for (const [name, over] of Object.entries(variants)) {
    const h = harness(over);
    const code = await stopCode(run('--preflight-only', h));
    assert.match(code, /^(LEDGER_UNEXPECTED|MIGRATION_STATE_STOP)$/, name);
    assert.equal(h.prod.writes.length, 0, name);
    assert.ok(h.prod.log.every((r) => r.method === 'GET' || r.read_only === true), name);
    assert.ok(fs.readdirSync(h.evDir).some((f) => f.startsWith('core-prod-preflight-failed-')), `${name}: stop evidence persisted`);
  }
});

// ─────────────────────────── prerequisites / ambiguity ───────────────────────────
test('prerequisites: the Core objects the contract compiles against must exist with the Production types', async () => {
  assert.deepEqual(P.prerequisiteFailures(PREREQ_OK()), []);
  const missingCol = PREREQ_OK(); delete missingCol.relations['public.usuarios'].acepta_invitaciones;
  const wrongType = PREREQ_OK(); wrongType.relations['public.jugadores'].id = 'integer';
  const missingRel = PREREQ_OK(); missingRel.relations['public.team_members'] = null;
  const missingFn = PREREQ_OK(); missingFn.functions['public.team_user_is_admin_or_owner(uuid,uuid)'] = null;
  for (const bad of [missingCol, wrongType, missingRel, missingFn]) assert.notDeepEqual(P.prerequisiteFailures(bad), []);
  const h = harness({ prereq: missingCol });
  assert.equal(await stopCode(run('--preflight-only', h)), 'PREREQUISITES_UNMET');
});

test('preflight: any ambiguous answer (wrong shape, error, non-JSON) is a STOP, never a guess', async () => {
  for (const sql of [P.LEDGER_ALL_ROWS_SQL, C.LEDGER_SHAPE_SQL, P.PREREQUISITES_SQL, P.APP_PRIVATE_SQL, P.CATALOG_DIGEST_SQL, C.CONTRACT_ACL_SQL, C.MIGRATIONS[0].probe]) {
    const h = harness({ ambiguous: sql });
    const code = await stopCode(run('--preflight-only', h));
    assert.notEqual(code, 'NO_STOP', sql.slice(0, 40));
    assert.equal(h.prod.writes.length, 0);
  }
  // The {result: [...]} envelope the certified reader also accepts is not ambiguous; a bare object is.
  const wrapped = harness();
  const inner = wrapped.deps.transport;
  wrapped.deps.transport = async (req) => { const r = await inner(req); return req.body?.read_only === true && Array.isArray(r.body) ? { ...r, body: { result: r.body } } : r; };
  assert.equal((await run('--preflight-only', wrapped)).verdict, 'CORE_PROD_PREFLIGHT_ONLY_STOP');
  const h = harness({ appPrivateOverride: { present: true, owner: 'postgres', acl: null, relations: ['something|r'], functions: [], policies: 0 } });
  assert.equal(await stopCode(run('--preflight-only', h)), 'APP_PRIVATE_UNEXPECTED');
});

test('preflight SQL: every Production probe passes the certified read-only guard (single SELECT, no write verb, no `;`)', () => {
  for (const sql of [P.LEDGER_ALL_ROWS_SQL, P.PREREQUISITES_SQL, P.APP_PRIVATE_SQL, P.CATALOG_DIGEST_SQL]) assert.doesNotThrow(() => assertReadOnlySql(sql));
  for (const sql of [P.LEDGER_ALL_ROWS_SQL, P.PREREQUISITES_SQL, P.APP_PRIVATE_SQL, P.CATALOG_DIGEST_SQL]) { assert.doesNotMatch(sql, new RegExp(STAGING)); assert.doesNotMatch(sql, new RegExp(PROD)); }
});

// ─────────────────────────── 8–9: Keychain namespace ───────────────────────────
test('custody: the Production Keychain namespace is its own, distinct from every non-production entry', () => {
  assert.deepEqual(P.KEYCHAIN_PROD, { service: 'arma2-torneos-prod-core-contract', account: 'contract-secret' });
  assert.notEqual(P.KEYCHAIN_PROD.service, C.KEYCHAIN.service);
  const lib = fs.readFileSync(path.join(REPO, 'backend/torneos/phase3b/remote/lib.sh'), 'utf8');
  for (const s of ['arma2-torneos-nonprod-core', 'arma2-torneos-nonprod-db', 'arma2-torneos-nonprod-bridge']) { assert.ok(lib.includes(`"${s}"`)); assert.ok(P.FORBIDDEN_KEYCHAIN_SERVICES.includes(s)); }
  assert.doesNotThrow(() => P.assertProdKeychainNamespace(P.KEYCHAIN_PROD));
  const py = fs.readFileSync(path.join(HERE, 'keychain-prod.py'), 'utf8');
  assert.match(py, /SERVICE = "arma2-torneos-prod-core-contract"/);
  assert.match(py, /ACCOUNT = "contract-secret"/);
  assert.doesNotMatch(py, /nonprod/, 'the Production helper never names a non-production entry');
  assert.doesNotMatch(py, /"-U"|'-U'|\bdelete-generic-password\b/, 'no silent overwrite, no delete, no rotation');
});

test('custody: the non-production namespace (and any other) is refused by the guard and by the Keychain helper', () => {
  for (const ns of [{ service: 'arma2-torneos-nonprod-core', account: 'contract-secret' }, { service: 'arma2-torneos-nonprod-db', account: 'x' }, { service: 'arma2-torneos-prod-core-contract', account: 'other' }, { service: 'arma2-torneos-prod-core', account: 'contract-secret' }, {}]) {
    assert.throws(() => P.assertProdKeychainNamespace(ns), P.ProdContractError, JSON.stringify(ns));
  }
  const py = path.join(HERE, 'keychain-prod.py');
  for (const argv of [['check', 'arma2-torneos-nonprod-core', 'contract-secret'], ['generate', 'arma2-torneos-nonprod-core'], ['add'], ['read'], ['rotate'], ['delete']]) {
    const r = spawnSync('python3', [py, ...argv], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(r.status, 2, argv.join(' '));
    assert.match(r.stderr, /KEYCHAIN_BAD_ARGS|KEYCHAIN_UNKNOWN_OP/);
  }
  // The Node wrapper binds the same namespace and never passes a value in argv.
  const seen = [];
  const kc = systemKeychain({ spawnSync: (cmd, args, opts) => { seen.push([cmd, ...args]); return { status: 44, stdout: '', stderr: '' }; } });
  assert.equal(kc.check(), 'ABSENT');
  assert.deepEqual(seen[0], ['/usr/bin/security', 'find-generic-password', '-s', 'arma2-torneos-prod-core-contract', '-a', 'contract-secret']);
});

test('custody: secret state machine — generate only when both absent; never regenerate, never reconcile, never copy Staging', () => {
  assert.equal(P.secretDecision('ABSENT', 'absent', { contractInstalled: false }), 'generate-store-set');
  assert.equal(P.secretDecision('PRESENT', 'absent', { contractInstalled: false }), 'set-from-keychain');
  assert.equal(P.secretDecision('PRESENT', 'PRESENT', { contractInstalled: true }), 'verify-by-probe');
  assert.match(P.secretDecision('ABSENT', 'PRESENT', { contractInstalled: true }), /^STOP:SECRET_REMOTE_PRESENT_KEYCHAIN_ABSENT/);
  assert.match(P.secretDecision('PRESENT', 'PRESENT', { contractInstalled: false }), /^STOP:SECRET_PRESENT_WITHOUT_CONTRACT/);
  assert.match(P.secretDecision('UNKNOWN', 'absent', { contractInstalled: false }), /^STOP:/);
  assert.equal(P.secretEqualsNonprod(PROD_SECRET, NONPROD_SECRET), false);
  assert.equal(P.secretEqualsNonprod(NONPROD_SECRET, NONPROD_SECRET), true);
  assert.equal(P.secretEqualsNonprod(PROD_SECRET, null), false);
});

test('custody: a generated value equal to the Staging secret, an unreadable or malformed Keychain value STOPs before any remote write', async () => {
  const same = harness({}, { generateValue: NONPROD_SECRET });
  assert.equal(await stopCode(run('--apply', same)), 'SECRET_EQUALS_NONPROD');
  assert.equal(same.prod.writes.length, 0);
  assert.ok(!same.prod.log.some((r) => r.read_only === false), 'not even the writer-context request');
  const unreadable = harness({}, { state: 'PRESENT', value: PROD_SECRET, readThrows: true });
  assert.equal(await stopCode(run('--preflight-only', unreadable)), 'SECRET_CUSTODY_FAILED');
  const malformed = harness({}, { state: 'PRESENT', value: 'not-hex' });
  assert.equal(await stopCode(run('--preflight-only', malformed)), 'SECRET_CUSTODY_FAILED');
  const ambiguous = harness({}, { checkThrows: true });
  assert.equal(await stopCode(run('--preflight-only', ambiguous)), 'SECRET_CUSTODY_FAILED');
  const remoteOnly = harness({ secretNames: ['TORNEOS_CONTRACT_SERVICE_SECRET'], installed: { v1: true, v11: true }, contract: { [V1]: 'ours', [V11]: 'ours' } });
  assert.equal(await stopCode(run('--preflight-only', remoteOnly)), 'SECRET_STATE_STOP');
});

// ─────────────────────────── 10: secret never exposed ───────────────────────────
test('secret: never in output, evidence, errors or any request other than the single set-secrets body', async () => {
  const h = harness();
  const res = await run('--apply', h);
  assert.equal(res.verdict, 'CORE_PROD_CONTRACT_DEPLOYED');
  const everything = [h.out.join('\n'), evidenceText(h.evDir), JSON.stringify(res), JSON.stringify(h.prod.log)].join('\n');
  for (const s of [PROD_SECRET, NONPROD_SECRET, PAT]) assert.ok(!everything.includes(s), 'leak');
  assert.equal(h.prod.s.secretValue, PROD_SECRET, 'Core received the Keychain value');
  assert.notEqual(h.prod.s.secretValue, NONPROD_SECRET);
  // A failing run after the secret is known still redacts it.
  const f = harness({ failApply: true }, { state: 'PRESENT', value: PROD_SECRET });
  assert.equal(await stopCode(run('--apply', f)), 'APPLY_FAILED');
  const all2 = [f.out.join('\n'), evidenceText(f.evDir)].join('\n');
  for (const s of [PROD_SECRET, NONPROD_SECRET, PAT]) assert.ok(!all2.includes(s));
  // The evidence writer is the last gate.
  assert.throws(() => P.assertNoSecrets(JSON.stringify({ x: `a${PROD_SECRET}b` }), [PROD_SECRET]), /EVIDENCE_REJECTED_SECRET_LEAK/);
  for (const pattern of ['sbp_abcdefghijklmnopqrstuvwxyz0123', 'sb_secret_abcdefghijklmnop', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'postgresql://postgres:pw@db.example.com:5432/postgres']) {
    assert.throws(() => P.assertNoSecrets(`{"x":"${pattern}"}`, []), /EVIDENCE_REJECTED_SECRET_LEAK/, pattern);
  }
});

// ─────────────────────────── 11–12: confirmation / non-interactive ───────────────────────────
test('confirmation: the exact phrase with the plan id is mandatory; y / yes / --force / partial / stale plan id write nothing', async () => {
  assert.equal(P.CONFIRMATION_PREFIX, 'DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION');
  const planId = 'abcdef012345';
  assert.equal(P.confirmationPhrase(planId), `DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION ${PROD} ${planId}`);
  assert.equal(P.confirmationMatches(`DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION ${PROD} ${planId}`, planId), true);
  for (const typed of ['y', 'yes', 'YES', '--force', '', 'DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION', `DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION ${PROD}`, `deploy torneos core contract to production ${PROD} ${planId}`, `DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION ${STAGING} ${planId}`, `DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION ${PROD} 000000000000`, ` DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION ${PROD} ${planId}`]) {
    assert.equal(P.confirmationMatches(typed, planId), false, typed);
    const h = harness({}, {}, { readConfirmation: () => typed });
    assert.equal(await stopCode(run('--apply', h)), 'CONFIRMATION_REFUSED', typed);
    assert.equal(h.prod.writes.length, 0);
    assert.ok(!h.prod.log.some((r) => r.read_only === false));
    assert.ok(!h.k.calls.includes('generate'));
  }
  const ok = harness();
  const res = await run('--apply', ok);
  assert.equal(res.verdict, 'CORE_PROD_CONTRACT_DEPLOYED');
  assert.equal(ok.prompts.length, 1);
  assert.ok(ok.prompts[0].includes(P.confirmationPhrase(res.plan_id)));
});

test('non-interactive: no tty, CI, or any flag substitute refuses the write before anything is written', async () => {
  const notty = harness({}, {}, { readConfirmation: () => { const e = new Error('ENXIO: no such device or address, open \'/dev/tty\''); e.code = 'ENXIO'; throw e; } });
  assert.equal(await stopCode(run('--apply', notty)), 'NON_INTERACTIVE_WRITE_REFUSED');
  assert.equal(notty.prod.writes.length, 0);
  const ci = harness({}, {}, { env: { CI: 'true' } });
  assert.equal(await stopCode(run('--apply', ci)), 'NON_INTERACTIVE_WRITE_REFUSED');
  assert.equal(ci.prod.writes.length, 0);
  for (const mode of ['--force', '-y', '--yes', 'yes', 'apply', '', undefined, '--apply --force']) {
    const h = harness();
    assert.equal(await stopCode(runProd({ mode, request: { pat: PAT }, deps: h.deps })), 'MODE_NOT_ACCEPTED', String(mode));
    assert.equal(h.prod.log.length, 0);
  }
});

test('non-interactive: the shell wrapper refuses flags, needs an explicit mode and stops without a tty before reading anything', () => {
  const sh = path.join(HERE, 'deploy-core-contract-prod.sh');
  const text = fs.readFileSync(sh, 'utf8');
  assert.doesNotMatch(text, /phase3b\/remote\/lib\.sh/, 'does not source the non-production lib');
  assert.match(text, /set -euo pipefail/);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const args of [[], ['--force'], ['-y'], ['--yes'], ['apply'], ['--apply', '--force'], ['--preflight-only', 'hhyvmhgpapyuzjgxfnqv']]) {
    const r = spawnSync('bash', [sh, ...args], { encoding: 'utf8', env, input: `${PAT}\n`, timeout: 20000 });
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /CORE_PROD_(USAGE|REFUSED)/, args.join(' '));
  }
  // No controlling terminal here (the agent shell): every valid mode stops at the tty check, before the PAT prompt.
  for (const mode of ['--preflight-only', '--dry-run', '--apply', '--acl-only']) {
    const r = spawnSync('bash', [sh, mode], { encoding: 'utf8', env, input: `${PAT}\n`, timeout: 20000, detached: true });
    assert.equal(r.status, 1, mode);
    assert.match(r.stderr, /CORE_PROD_BLOCKED_NO_TTY|CORE_PROD_REFUSED_NON_INTERACTIVE/, mode);
    assert.doesNotMatch(r.stdout + r.stderr, /PAT \(sbp_/, 'never prompted');
  }
  const ci = spawnSync('bash', [sh, '--preflight-only'], { encoding: 'utf8', env: { ...env, CI: '1' }, timeout: 20000 });
  assert.equal(ci.status, 1);
  assert.match(ci.stderr, /CORE_PROD_REFUSED_NON_INTERACTIVE/);
});

// ─────────────────────────── 13: preflight / dry-run are read-only ───────────────────────────
test('preflight-only and dry-run: 0 writes — only GET and read_only:true queries, Keychain never written, client never armed', async () => {
  for (const mode of ['--preflight-only', '--dry-run']) {
    for (const kc of [{}, { state: 'PRESENT', value: PROD_SECRET }]) {
      const h = harness({}, kc);
      const res = await run(mode, h);
      assert.equal(res.verdict, mode === '--dry-run' ? 'CORE_PROD_DRYRUN_STOP' : 'CORE_PROD_PREFLIGHT_ONLY_STOP');
      assert.equal(res.writes, 0);
      assert.equal(h.prod.writes.length, 0);
      assert.ok(h.prod.log.length > 0);
      for (const r of h.prod.log) assert.ok(r.method === 'GET' || (r.method === 'POST' && r.read_only === true), JSON.stringify(r));
      assert.ok(!h.k.calls.includes('generate'));
      assert.equal(h.prompts.length, 0, 'no confirmation asked outside --apply');
    }
  }
  const h = harness();
  const res = await run('--dry-run', h);
  assert.deepEqual(res.plan.migrations.map((m) => `${m.version}:${m.decision}`), [`${V1}:apply`, `${V11}:apply`]);
  assert.equal(res.plan.secret, 'generate-store-set');
  assert.deepEqual(res.dry_run.requests.map((r) => r.what), ['writer-context', `apply ${V1}`, `apply ${V11}`, 'set-secrets TORNEOS_CONTRACT_SERVICE_SECRET', 'deploy torneos-core-contract']);
  const client = prodClient({ pat: PAT, transport: h.prod.transport });
  await assert.rejects(client.applyMigration(P.renderAuthorized(REPO)[0]), /not_armed/);
});

// ─────────────────────────── 14: artifact contract ───────────────────────────
test('artifact: torneos-core-contract is byte-identical to the certified Staging deploy; any difference STOPs before the PAT', async () => {
  assert.deepEqual(P.FUNCTION_ARTIFACT.files, [
    { path: 'functions/_shared/supabaseApiKeys.ts', bytes: 3622, sha256: '5d6cc3aec5fbcd2a3b5d46b254957d2275c811b4660ff2e8afdcfa30fc94170a' },
    { path: 'functions/_shared/torneosCoreContract.ts', bytes: 16849, sha256: '83d129020be52dbc0e28ca4aa97d27a28fe9b2eded700f9ca6af0e69507812d7' },
    { path: 'functions/torneos-core-contract/index.ts', bytes: 2828, sha256: '41e012f03b72d24e1f386ce3902bbab6aff2b2bdcf7ec96a325f588a77b0d269' },
  ]);
  assert.equal(P.FUNCTION_ARTIFACT.verify_jwt, false);
  assert.equal(P.FUNCTION_ARTIFACT.entrypoint, 'functions/torneos-core-contract/index.ts');
  assert.equal(P.FUNCTION_ARTIFACT.certified_staging_evidence.sha256, '5255249af48a6a8714c018f9fc53f601e949210323666ff8eb82fdaa6a9e4c88');
  assert.deepEqual(P.artifactDiff(P.localArtifact(REPO)), []);
  const drift = tempRepo((d) => fs.appendFileSync(path.join(d, P.FUNCTION_ARTIFACT.root, 'functions/_shared/torneosCoreContract.ts'), '\n// drift\n'));
  assert.notDeepEqual(P.artifactDiff(P.localArtifact(drift)), []);
  const h = harness({}, {}, { repo: drift });
  assert.equal(await stopCode(run('--preflight-only', h)), 'ARTIFACT_MISMATCH');
  assert.equal(h.prod.log.length, 0);
  assert.notDeepEqual(P.artifactDiff({ ...P.localArtifact(REPO), metadata: { ...P.localArtifact(REPO).metadata, verify_jwt: true } }), []);
});

// ─────────────────────────── full apply (offline) ───────────────────────────
test('apply (offline): writer-context → v1 → v1.1 → set-secrets → deploy, then 9/9 harness, ACL, app_private, catalog and ledger all certified', async () => {
  const h = harness();
  const res = await run('--apply', h);
  assert.equal(res.verdict, 'CORE_PROD_CONTRACT_DEPLOYED');
  const rendered = P.renderAuthorized(REPO);
  assert.deepEqual(h.prod.writes, [{ kind: 'sql', sha256: rendered[0].apply_sql_sha256 }, { kind: 'sql', sha256: rendered[1].apply_sql_sha256 }, { kind: 'secrets', names: ['TORNEOS_CONTRACT_SERVICE_SECRET'] }, { kind: 'deploy', bytes: h.prod.writes[3].bytes }]);
  assert.deepEqual(h.k.calls.filter((c) => c === 'generate'), ['generate']);
  assert.equal(res.probe.verdict, 'SIGNED_HARNESS_PASS');
  assert.equal(res.probe.checks.length, 9);
  assert.deepEqual(res.acl_failures, []);
  assert.deepEqual(res.catalog_changed, []);
  // A re-run is idempotent: skip/skip, no generation, the probe verifies the Keychain value.
  const h2 = harness({ installed: { v1: true, v11: true }, contract: { [V1]: 'ours', [V11]: 'ours' }, secretNames: ['OTHER_FUNCTION_SECRET', 'TORNEOS_CONTRACT_SERVICE_SECRET'], secretValue: PROD_SECRET, fn: { ...h.prod.s.fn } }, { state: 'PRESENT', value: PROD_SECRET });
  const res2 = await run('--apply', h2);
  assert.equal(res2.verdict, 'CORE_PROD_CONTRACT_DEPLOYED');
  assert.deepEqual(h2.prod.writes.map((w) => w.kind), ['deploy']);
});

test('apply (offline): a Core secret that differs from the Keychain is a STOP (no reconcile in Production)', async () => {
  const h = harness({ installed: { v1: true, v11: true }, contract: { [V1]: 'ours', [V11]: 'ours' }, secretNames: ['TORNEOS_CONTRACT_SERVICE_SECRET'], secretValue: 'cd'.repeat(32), fn: { slug: 'torneos-core-contract', status: 'ACTIVE', verify_jwt: false, ezbr_sha256: 'e'.repeat(64) } }, { state: 'PRESENT', value: PROD_SECRET });
  assert.equal(await stopCode(run('--apply', h)), 'SIGNED_HARNESS_SECRET_MISMATCH');
  assert.ok(!h.prod.writes.some((w) => w.kind === 'secrets'));
});

test('apply (offline): state that changes between the preflight and the phrase is a STOP with 0 writes', async () => {
  const h = harness();
  h.deps.readConfirmation = (prompt, planId) => { h.prod.s.rows.push({ ...BASELINE.rows[0], version: '20260924000000', name: 'raced' }); return P.confirmationPhrase(planId); };
  assert.equal(await stopCode(run('--apply', h)), 'PREFLIGHT_STATE_CHANGED');
  assert.equal(h.prod.writes.length, 0);
});

test('apply (offline): a catalog change outside the contract after the apply is detected (no other Core object may change)', async () => {
  const h = harness({ catalogDriftAfterApply: true });
  assert.equal(await stopCode(run('--apply', h)), 'CATALOG_CHANGED_OUTSIDE_CONTRACT');
  assert.ok(fs.readdirSync(h.evDir).some((f) => f.startsWith('core-prod-failed-')));
});

// ─────────────────────────── certification harness ───────────────────────────
test('harness: the 9 certified answers against the REAL handler — PASS, and the same request sequence as the certified Staging probe', async () => {
  const prod = fakeProd({ fn: { slug: 'torneos-core-contract' }, secretValue: PROD_SECRET });
  const r = await probeProd({ secret: PROD_SECRET, fetchImpl: fakeEdge(prod) });
  assert.equal(r.verdict, 'SIGNED_HARNESS_PASS');
  assert.deepEqual(r.checks.map((c) => c.name), C.PROBE_EXPECT.map((e) => e.name));
  assert.deepEqual(responseSensitiveFindings(r.checks, { secret: PROD_SECRET }), []);
  // Same requests as probe-core-contract.mjs (the certified Staging harness), host aside.
  const record = (sink) => async (url, init) => { sink.push({ path: new URL(url).pathname, method: init.method ?? 'GET', header_names: Object.keys(init.headers ?? {}).sort(), body_keys: init.body ? Object.keys(JSON.parse(Buffer.from(init.body).toString())).sort() : null }); return new Response('{"error":"NOT_FOUND"}', { status: 404, headers: { 'content-type': 'application/json' } }); };
  const a = []; const b = [];
  await probeOnceProd({ secret: PROD_SECRET, fetchImpl: record(a) });
  await certifiedProbeOnce({ ref: STAGING, secret: PROD_SECRET, fetchImpl: record(b) });
  assert.equal(a.length, 9);
  assert.deepEqual(a, b);
});

test('harness: classification — no secret, not deployed, wrong secret, Core down, and a response echoing material is flagged', async () => {
  const notDeployed = fakeProd({ fn: null, secretValue: PROD_SECRET });
  assert.equal((await probeOnceProd({ secret: PROD_SECRET, fetchImpl: fakeEdge(notDeployed) })).verdict, 'FUNCTION_NOT_FOUND');
  const noSecret = fakeProd({ fn: { slug: 'x' }, secretValue: null });
  assert.equal((await probeOnceProd({ secret: PROD_SECRET, fetchImpl: fakeEdge(noSecret) })).verdict, 'SECRET_NOT_CONFIGURED');
  const other = fakeProd({ fn: { slug: 'x' }, secretValue: 'cd'.repeat(32) });
  assert.equal((await probeOnceProd({ secret: PROD_SECRET, fetchImpl: fakeEdge(other) })).verdict, 'SECRET_MISMATCH');
  const leaky = [{ name: 'x', observed: { status: 403, body: { error: 'FORBIDDEN', debug: PROD_SECRET }, raw: undefined } }];
  assert.notDeepEqual(responseSensitiveFindings(leaky, { secret: PROD_SECRET }), []);
  await assert.rejects(probeProd({ secret: 'zz', fetchImpl: fakeEdge(other) }), /secret_malformed/);
});

// ─────────────────────────── ACL / permissions ───────────────────────────
test('ACL: Production expectations — service_role-only RPC, owner-only app_private (no API-role USAGE), exact object set, no strays', () => {
  const acl = aclOf({ v1: true, v11: true });
  assert.deepEqual(P.prodAclFailures(acl), []);
  const mut = (f) => { const a = JSON.parse(JSON.stringify(acl)); f(a); return P.prodAclFailures(a); };
  assert.notDeepEqual(mut((a) => { a.functions[0].execute.anon = true; }), []);
  assert.notDeepEqual(mut((a) => { a.functions[0].execute.authenticated = true; }), []);
  assert.notDeepEqual(mut((a) => { a.functions[0].execute.service_role = false; }), []);
  assert.notDeepEqual(mut((a) => { a.functions[1].execute.service_role = true; }), []);
  assert.notDeepEqual(mut((a) => { a.tables[0].privileges.service_role = true; }), []);
  assert.notDeepEqual(mut((a) => { a.tables[1].rls = false; }), []);
  assert.notDeepEqual(mut((a) => { a.schema.usage.anon = true; }), [], 'Production app_private is new: no API-role USAGE');
  assert.notDeepEqual(mut((a) => { a.schema.usage.service_role = true; }), []);
  assert.notDeepEqual(mut((a) => { a.stray_objects = 1; }), []);
  assert.notDeepEqual(mut((a) => { a.session_branch = false; }), []);
  assert.deepEqual(P.appPrivateFailures(P.APP_PRIVATE_AFTER, { installed: true }), []);
  assert.deepEqual(P.appPrivateFailures(P.APP_PRIVATE_BEFORE, { installed: false }), []);
  assert.notDeepEqual(P.appPrivateFailures({ ...P.APP_PRIVATE_AFTER, relations: [...P.APP_PRIVATE_AFTER.relations, 'extra_table|r'] }, { installed: true }), []);
  assert.notDeepEqual(P.appPrivateFailures({ ...P.APP_PRIVATE_AFTER, acl: 'anon=U/postgres' }, { installed: true }), []);
  assert.deepEqual(P.appPrivateFailures({ ...P.APP_PRIVATE_AFTER, acl: '{postgres=UC/postgres}' }, { installed: true }), [], 'explicit owner-only ACL == NULL');
  assert.notDeepEqual(P.appPrivateFailures({ ...P.APP_PRIVATE_AFTER, acl: '{postgres=UC/postgres,anon=U/postgres}' }, { installed: true }), []);
  assert.notDeepEqual(P.appPrivateFailures({ ...P.APP_PRIVATE_AFTER, acl: '{postgres=U/postgres}' }, { installed: true }), []);
  assert.notDeepEqual(P.appPrivateFailures({ ...P.APP_PRIVATE_AFTER, owner: 'supabase_admin' }, { installed: true }), []);
  assert.deepEqual(P.catalogDiff(CATALOG, JSON.parse(JSON.stringify(CATALOG))), []);
  assert.deepEqual(P.catalogDiff(CATALOG, { ...CATALOG, public_policies: { count: 201, digest: '0'.repeat(32) } }), ['public_policies']);
});

test('ACL: --acl-only is read-only and certifies an installed contract (and refuses to certify an absent one)', async () => {
  const installed = { installed: { v1: true, v11: true }, contract: { [V1]: 'ours', [V11]: 'ours' }, fn: { slug: 'torneos-core-contract', status: 'ACTIVE', verify_jwt: false, ezbr_sha256: 'e'.repeat(64) }, secretNames: ['TORNEOS_CONTRACT_SERVICE_SECRET'] };
  const h = harness(installed);
  const res = await run('--acl-only', h);
  assert.equal(res.verdict, 'CORE_PROD_ACL_PASS');
  assert.equal(h.prod.writes.length, 0);
  assert.ok(h.prod.log.every((r) => r.method === 'GET' || r.read_only === true));
  const bad = harness({ ...installed, aclOverride: { ...aclOf({ v1: true, v11: true }), schema: { app_private_present: true, usage: { anon: true, authenticated: false, service_role: false } } } });
  assert.equal(await stopCode(run('--acl-only', bad)), 'ACL_EXPECTATIONS_UNMET');
  assert.equal(await stopCode(run('--acl-only', harness())), 'CONTRACT_NOT_INSTALLED');
});

// ─────────────────────────── invariants on the certified Staging tooling ───────────────────────────
test('invariant: the certified Staging tooling is byte-identical to d62039c7 (behaviour unchanged)', () => {
  for (const [rel, want] of Object.entries(P.CERTIFIED_STAGING_TOOLING_SHA256)) assert.equal(sha(fs.readFileSync(path.join(REPO, rel))), want, rel);
  assert.ok(Object.keys(P.CERTIFIED_STAGING_TOOLING_SHA256).length >= 8);
});
