#!/usr/bin/env node
// INFRA-0.5 — Core PRODUCTION contract deployment runner (operator-run through
// deploy-core-contract-prod.sh; never by an agent, never unattended).
//
//   --preflight-only   pins → custody check → READ-ONLY observation of Production → plan → evidence → STOP
//   --dry-run          the same + the exact write requests that WOULD be sent (computed locally) → STOP
//   --apply            the same → phrase typed on /dev/tty → re-observation (must be identical) →
//                      local custody (generate once / read / ≠ Staging) → arm → writer context →
//                      v1 → v1.1 → set-secrets → deploy → signed harness 9/9 → ACL → app_private →
//                      catalog unchanged outside the contract → ledger = baseline + our 2 rows → evidence
//   --acl-only         READ-ONLY post-deploy certification (ACL, app_private, ledger) of an installed contract
//   --harness-only     certification only, for an installed contract: pins → Keychain custody (present, ≠ Staging)
//                      → the --acl-only certification + certified ezbr → signed harness 9/9 (one attempt) →
//                      the --acl-only certification again + state identical + RPC reach corroborated. The
//                      Management API is read-only by construction (read-only transport and view); no
//                      migration, writer context, secret write or deploy is reachable. Evidence goes to
//                      infra-1-core-prod-apikey-recert/.
//
// stdin: exactly {"pat": "sbp_…"} (piped by the wrapper from the printf builtin). Any other key — a ref,
// a confirmation, a force flag, a secret — is refused: the target is a constant and the confirmation
// only exists on /dev/tty. Every STOP is fail-closed and persisted (never a secret) before exit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as P from './prod-contract.mjs';
import * as C from '../../phase3b/remote/core-contract.mjs';
import { resolveFiles, buildDeployBody } from '../../phase3b/remote/mgmt-write.mjs';
import { prodClient, httpsTransport, assertProdRequest } from './mgmt-prod.mjs';
import { probeProd, responseSensitiveFindings, PROD_ENDPOINT } from './probe-prod.mjs';
import { systemKeychain } from './keychain-prod.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLING_REPO = path.resolve(HERE, '../../../..');
export const RUNTIME_EVIDENCE_DIR = path.join(TOOLING_REPO, 'backend/torneos/mp-b/evidence/infra-1-core-prod');
export const HARNESS_ONLY_EVIDENCE_DIR = path.join(TOOLING_REPO, 'backend/torneos/mp-b/evidence/infra-1-core-prod-apikey-recert');
export const MODES = ['--preflight-only', '--dry-run', '--apply', '--acl-only', '--harness-only'];
export const evidenceDirFor = (mode) => (mode === '--harness-only' ? HARNESS_ONLY_EVIDENCE_DIR : RUNTIME_EVIDENCE_DIR);
export const REQUEST_KEYS = ['pat'];
export const TOOLING_FILES = ['prod-contract.mjs', 'mgmt-prod.mjs', 'probe-prod.mjs', 'keychain-prod.mjs', 'keychain-prod.py', 'core-prod-deploy.mjs', 'deploy-core-contract-prod.sh', 'pins/production-ledger-baseline.json'];

export class StopError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; }
}
const stop = (code, detail) => { throw new StopError(code, detail); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** Writes one evidence file: secret gate first, never overwrites, 0600. */
function writeEvidence(ctx, baseName, body) {
  // An offline rehearsal labels every file (prefix + annotation) so it can never pass for a real run.
  const name = `${ctx.deps.evidencePrefix ?? ''}${baseName}`;
  const obj = ctx.deps.annotation ? { annotation: ctx.deps.annotation, ...body } : body;
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  try { P.assertNoSecrets(text, ctx.known); } catch { stop('EVIDENCE_REJECTED_SECRET_LEAK', { file: name }); }
  fs.mkdirSync(ctx.deps.evidenceDir, { recursive: true, mode: 0o700 });
  const file = path.join(ctx.deps.evidenceDir, name);
  try { fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' }); } catch (e) { stop(e.code === 'EEXIST' ? 'EVIDENCE_EXISTS' : 'EVIDENCE_WRITE_FAILED', { file: name }); }
  const digest = sha(text);
  ctx.evidence.push({ file: name, sha256: digest });
  ctx.say(`EVIDENCE ${name} ${digest}`);
  return digest;
}

function readValidatedSecret(kc) {
  const v = kc.read();
  if (typeof v !== 'string' || !P.SECRET_PATTERN.test(v)) throw new Error('keychain_value_malformed');
  return v;
}

// ── --harness-only: the Management API surface is read-only by construction ──
/** Wraps a transport so that only requests classified `read` (unarmed) ever reach it. */
export function readOnlyTransport(transport) {
  return async (req) => {
    let kind;
    try { kind = assertProdRequest({ method: req.method, path: req.path, body: req.body, armed: false }); } catch (e) { stop('HARNESS_ONLY_WRITE_REFUSED', { error: e.message }); }
    if (kind !== 'read' || req.armed !== false) stop('HARNESS_ONLY_WRITE_REFUSED', { kind, armed: req.armed ?? null });
    return transport(req);
  };
}
export const READ_ONLY_VIEW_METHODS = Object.freeze(['project', 'ledger', 'installed', 'prerequisites', 'appPrivate', 'acl', 'catalog', 'secretNames', 'fn', 'rpcStats']);
/** The only handle harness-only code receives: the client's read operations, nothing that arms or writes. */
export function readOnlyView(client) {
  const view = Object.fromEntries(READ_ONLY_VIEW_METHODS.map((k) => [k, (...a) => client[k](...a)]));
  Object.defineProperty(view, 'writes', { get: () => client.writes, enumerable: true });
  return Object.freeze(view);
}

/** Everything the plan depends on, read-only. Any unreadable/ambiguous answer is a STOP. */
async function observe(client) {
  try {
    const project = await client.project();
    const ledger = await client.ledger();
    const installed = await client.installed();
    const prerequisites = await client.prerequisites();
    const app_private = await client.appPrivate();
    const acl = await client.acl();
    const catalog = await client.catalog();
    const secret_names = await client.secretNames();
    const fn = await client.fn();
    return { project, ledger, installed, prerequisites, app_private, acl, catalog, secret_names, fn };
  } catch (e) {
    if (e instanceof StopError) throw e;
    return stop('PREFLIGHT_AMBIGUOUS', { error: e?.message ?? 'error', detail: e?.detail ?? null });
  }
}
/** What must not change between the preflight and the phrase (and what the plan was computed from). */
const fingerprint = (o) => sha(JSON.stringify({ status: o.project?.status, ledger: o.ledger, installed: o.installed, prerequisites: o.prerequisites, app_private: o.app_private, acl: o.acl, catalog: o.catalog, secret_names: o.secret_names, fn: o.fn }));

/** Every read-only gate, in order. Returns the evaluation or STOPs with its specific code. */
function evaluate(obs, { mode, custody }) {
  const identity = P.projectIdentityFailures(obs.project);
  if (identity.length) stop('PROJECT_IDENTITY_MISMATCH', { failures: identity });
  if (obs.project.status !== P.REQUIRED_STATUS) stop('PROJECT_NOT_ACTIVE_HEALTHY', { status: obs.project.status ?? null });
  const ledger = P.evaluateLedger({ shape: obs.ledger.shape, rows: obs.ledger.rows });
  if (!ledger.ok) stop('LEDGER_UNEXPECTED', ledger);
  const writer_failures = C.writerPrivilegeFailures(obs.ledger.writer);
  const states = P.AUTHORIZED_MIGRATIONS.map((m) => ({ version: m.version, installed: obs.installed[m.version], ledger: ledger.contract[m.version] }));
  const migrations = P.planMigrations(states);
  if (migrations.stop) stop('MIGRATION_STATE_STOP', migrations);
  const installed_v1 = obs.installed[P.AUTHORIZED_VERSIONS[0]] === true;
  const fully_installed = migrations.decisions.every((d) => d.decision === 'skip');
  if (mode === '--acl-only' || mode === '--harness-only') return { ledger, migrations, fully_installed, writer_failures };
  if (writer_failures.length) stop('WRITER_PRIVILEGES_INSUFFICIENT', { failures: writer_failures });
  const prereq = P.prerequisiteFailures(obs.prerequisites);
  if (prereq.length) stop('PREREQUISITES_UNMET', { failures: prereq });
  const app_private = P.appPrivateFailures(obs.app_private, { installed: installed_v1 });
  if (app_private.length) stop('APP_PRIVATE_UNEXPECTED', { failures: app_private });
  if (!P.catalogShapeOk(obs.catalog)) stop('PREFLIGHT_AMBIGUOUS', { error: 'catalog_digest_unreadable' });
  let acl_before;
  if (!installed_v1) {
    const present = [...(obs.acl?.functions ?? []), ...(obs.acl?.tables ?? [])].filter((o) => o.present !== false).map((o) => o.signature ?? o.name);
    acl_before = [...present.map((p) => `${p}: present before the apply`), ...(Number(obs.acl?.stray_objects) !== 0 || Number(obs.acl?.stray_relations) !== 0 ? ['stray torneos_contract_* objects'] : [])];
    if (!Array.isArray(obs.acl?.functions) || !Array.isArray(obs.acl?.tables)) acl_before.push('acl_unreadable');
  } else {
    acl_before = P.prodAclFailures(obs.acl).filter((f) => fully_installed || !/session branch/.test(f));
  }
  if (acl_before.length) stop('ACL_BEFORE_UNEXPECTED', { failures: acl_before });
  if (obs.fn && !installed_v1) stop('FUNCTION_STATE_UNEXPECTED', { reason: 'torneos-core-contract exists while the contract is not installed' });
  const remote = obs.secret_names.includes(P.SECRET_NAME) ? 'PRESENT' : 'absent';
  const secret = P.secretDecision(custody.keychain, remote, { contractInstalled: installed_v1 });
  if (secret.startsWith('STOP:')) stop('SECRET_STATE_STOP', { decision: secret, keychain: custody.keychain, remote });
  return { ledger, migrations, fully_installed, writer_failures, remote_secret: remote, secret };
}

/** The --acl-only certification of an installed contract (also the pre/post gate of --harness-only). */
function aclOnlyFailures(obs) {
  const failures = [...P.prodAclFailures(obs.acl), ...P.appPrivateFailures(obs.app_private, { installed: true }).map((f) => `app_private ${f}`)];
  if (!obs.fn || obs.fn.verify_jwt !== false || obs.fn.status !== 'ACTIVE') failures.push(`function: ${JSON.stringify(obs.fn && { status: obs.fn.status, verify_jwt: obs.fn.verify_jwt })}`);
  if (!obs.secret_names.includes(P.SECRET_NAME)) failures.push(`${P.SECRET_NAME}: not set on Core`);
  return failures;
}
const observationOf = (obs, ev) => ({
  project: obs.project,
  ledger: { rows: ev.ledger.observed_rows, max_version: ev.ledger.observed_max_version, baseline_rows: ev.ledger.baseline.rows, missing: ev.ledger.baseline.missing, added: ev.ledger.baseline.added, changed: ev.ledger.baseline.changed, contract: ev.ledger.contract, shape_ok: ev.ledger.shape_diff.length === 0, writer: obs.ledger.writer, standard_conforming_strings: obs.ledger.shape?.standard_conforming_strings ?? null },
  installed: obs.installed, prerequisites: obs.prerequisites, app_private: obs.app_private, acl: obs.acl, catalog: obs.catalog,
  secret: { name: P.SECRET_NAME, remote: obs.secret_names.includes(P.SECRET_NAME) ? 'PRESENT' : 'absent', project_secret_count: obs.secret_names.length },
  function: obs.fn,
  fingerprint: fingerprint(obs),
});
/** Persistent-contract differences between two observations. Only the function `version` counter may move. */
function stateDiff(a, b) {
  const fnSansVersion = (f) => (f ? { ...f, version: undefined } : f);
  const parts = {
    project: [a.project, b.project], ledger_rows: [a.ledger.rows, b.ledger.rows], ledger_shape: [a.ledger.shape, b.ledger.shape], ledger_writer: [a.ledger.writer, b.ledger.writer],
    installed: [a.installed, b.installed], prerequisites: [a.prerequisites, b.prerequisites], app_private: [a.app_private, b.app_private], acl: [a.acl, b.acl],
    catalog: [a.catalog, b.catalog], secret_names: [a.secret_names, b.secret_names], function: [fnSansVersion(a.fn), fnSansVersion(b.fn)],
  };
  return Object.entries(parts).filter(([, [x, y]]) => JSON.stringify(x) !== JSON.stringify(y)).map(([k]) => k);
}
function rpcStatsOf(r) {
  const calls = Number(r?.calls);
  if (!r || typeof r !== 'object' || !Number.isSafeInteger(calls) || calls < 0 || typeof r.stats_reset !== 'string') throw new Error('rpc_stats_ambiguous');
  return { calls, stats_reset: r.stats_reset, dealloc: r.dealloc ?? null };
}

/**
 * --harness-only after the shared pins/custody/observation stages. Receives the read-only view only; the
 * remote side effects are those of the certified harness itself (nonce rows of the contract, 61 s TTL).
 */
export async function harnessOnly(ctx, { view, obs, ev, observation, pins, custody, secret, deps, now }) {
  const certified = P.FUNCTION_ARTIFACT.certified_staging_evidence.ezbr_sha256;
  const tool = 'backend/torneos/infra/core-prod-contract/core-prod-deploy.mjs';
  ctx.stage = 'harness-only-pre-acl';
  if (PROD_ENDPOINT !== `https://${P.PROD_REF}.supabase.co/functions/v1/${P.FUNCTION_ARTIFACT.slug}`) stop('TARGET_MISMATCH', { endpoint: PROD_ENDPOINT });
  if (!ev.fully_installed) stop('CONTRACT_NOT_INSTALLED', { migrations: ev.migrations.decisions });
  const expected_rows = pins.ledger_baseline.rows + P.AUTHORIZED_VERSIONS.length;
  if (ev.ledger.observed_rows !== expected_rows) stop('LEDGER_UNEXPECTED', { observed_rows: ev.ledger.observed_rows, expected_rows });
  const pre_failures = aclOnlyFailures(obs);
  if (pre_failures.length) stop('ACL_EXPECTATIONS_UNMET', { phase: 'pre', failures: pre_failures });
  if (obs.fn.ezbr_sha256 !== certified) stop('FUNCTION_ARTIFACT_MISMATCH', { phase: 'pre', observed: obs.fn.ezbr_sha256 ?? null, certified });
  let rpc_before;
  try { rpc_before = rpcStatsOf(await view.rpcStats()); } catch (e) { stop('PREFLIGHT_AMBIGUOUS', { error: e?.message ?? 'rpc_stats' }); }
  writeEvidence(ctx, `core-prod-harness-only-pre-acl-${ctx.stamp}.json`, { generated_at: now().toISOString(), tool, mode: '--harness-only', phase: 'pre-harness', read_only: true, target: P.PRODUCTION_PROJECT, pins, custody, observation, rpc_stats: rpc_before, function_artifact: { ezbr_sha256: obs.fn.ezbr_sha256, certified_ezbr_sha256: certified, equal: true }, management_writes: view.writes.length, verdict: 'CORE_PROD_ACL_PASS' });
  ctx.say(`[ok] pre-harness ACL: CORE_PROD_ACL_PASS · ledger ${ev.ledger.observed_rows} · fn ${obs.fn.status} v${obs.fn.version} ezbr ${obs.fn.ezbr_sha256.slice(0, 12)}… == certified · RPC calls ${rpc_before.calls}`);

  ctx.stage = 'harness';
  const probe = await probeProd({ secret, retries: 0, fetchImpl: deps.fetchImpl });
  const sensitive = responseSensitiveFindings(probe.checks, { secret });
  const probeEvidence = { endpoint: probe.endpoint, verdict: probe.verdict, attempts: probe.attempts, checks: probe.checks.map((c) => ({ name: c.name, expected: c.expected, observed: { status: c.observed.status, body: c.observed.body, headers: c.observed.headers }, ok: c.ok })), sensitive_findings: sensitive };
  if (!probe.pass) stop(`SIGNED_HARNESS_${probe.verdict}`, { probe: probeEvidence });
  if (sensitive.length) stop('SIGNED_HARNESS_SENSITIVE_MATERIAL', { probe: probeEvidence });
  const previously_failing = P.HARNESS_RPC_CASES.map((i) => probeEvidence.checks[i]);
  ctx.say(`[ok] signed harness 9/9 exact answers (${previously_failing.map((c) => `${c.observed.status} ${c.observed.body?.error}`).join(', ')} from the RPC)`);

  ctx.stage = 'harness-only-post-acl';
  const obs2 = await observe(view);
  const ev2 = evaluate(obs2, { mode: '--harness-only' });
  if (!ev2.fully_installed) stop('CONTRACT_NOT_INSTALLED', { phase: 'post', migrations: ev2.migrations.decisions });
  const post_failures = aclOnlyFailures(obs2);
  if (post_failures.length) stop('ACL_EXPECTATIONS_UNMET', { phase: 'post', failures: post_failures });
  if (obs2.fn.ezbr_sha256 !== certified) stop('FUNCTION_ARTIFACT_MISMATCH', { phase: 'post', observed: obs2.fn.ezbr_sha256 ?? null, certified });
  const state_diff = stateDiff(obs, obs2);
  if (state_diff.length) stop('POST_STATE_CHANGED', { changed: state_diff });
  let rpc_after;
  try { rpc_after = rpcStatsOf(await view.rpcStats()); } catch (e) { stop('POSTFLIGHT_UNREADABLE', { error: e?.message ?? 'rpc_stats' }); }
  const rpc = { before: rpc_before.calls, after: rpc_after.calls, delta: rpc_after.calls - rpc_before.calls, expected_delta: P.HARNESS_RPC_CALLS, stats_reset_unchanged: rpc_after.stats_reset === rpc_before.stats_reset };
  if (!rpc.stats_reset_unchanged || rpc.delta !== P.HARNESS_RPC_CALLS) stop('RPC_REACH_NOT_CORROBORATED', { rpc, before: rpc_before, after: rpc_after });
  if (view.writes.length !== 0) stop('HARNESS_ONLY_WRITE_REFUSED', { writes: view.writes });
  const observation_after = observationOf(obs2, ev2);
  writeEvidence(ctx, `core-prod-harness-only-post-acl-${ctx.stamp}.json`, { generated_at: now().toISOString(), tool, mode: '--harness-only', phase: 'post-harness', read_only: true, target: P.PRODUCTION_PROJECT, observation: observation_after, rpc_stats: rpc_after, management_writes: 0, verdict: 'CORE_PROD_ACL_PASS' });
  ctx.say(`[ok] post-harness ACL: CORE_PROD_ACL_PASS · state identical (function version ${obs.fn.version} → ${obs2.fn.version}) · RPC calls +${rpc.delta}`);

  ctx.stage = 'evidence';
  const fnKeys = ['slug', 'status', 'version', 'verify_jwt', 'updated_at', 'ezbr_sha256', 'entrypoint_path'];
  const func = {
    before: obs.fn, after: obs2.fn, certified_ezbr_sha256: certified, ezbr_equals_certified: obs2.fn.ezbr_sha256 === certified && obs.fn.ezbr_sha256 === certified,
    unchanged: fnKeys.filter((k) => k !== 'version' && obs.fn[k] === obs2.fn[k]), version: { before: obs.fn.version, after: obs2.fn.version },
  };
  const result = {
    generated_at: now().toISOString(), tool, mode: '--harness-only', target: P.PRODUCTION_PROJECT, endpoint: PROD_ENDPOINT,
    pre_acl: `${deps.evidencePrefix ?? ''}core-prod-harness-only-pre-acl-${ctx.stamp}.json`, post_acl: `${deps.evidencePrefix ?? ''}core-prod-harness-only-post-acl-${ctx.stamp}.json`,
    management_api: { writes: 0, requests: 'GET + database/query read_only:true only (read-only transport)', migrations: 0, deploys: 0, secret_writes: 0 },
    custody, probe: probeEvidence, previously_failing, rpc, state_diff, function: func,
    catalog: { before: obs.catalog, after: obs2.catalog, identical: JSON.stringify(obs.catalog) === JSON.stringify(obs2.catalog) },
    ledger: { before: ev.ledger.observed_rows, after: ev2.ledger.observed_rows, contract: ev2.ledger.contract },
    remote_side_effects: 'nonce rows of the contract only (61 s TTL); fixtures are random UUIDs and example.invalid',
    verdict: 'CORE_PROD_TORNEOS_CONTRACT_PASS',
  };
  writeEvidence(ctx, `core-prod-harness-only-result-${ctx.stamp}.json`, result);
  ctx.say('CORE_PROD_TORNEOS_CONTRACT_PASS');
  return { verdict: 'CORE_PROD_TORNEOS_CONTRACT_PASS', writes: view.writes.length, probe: { verdict: probe.verdict, checks: probe.checks.map((c) => ({ name: c.name, ok: c.ok })) }, previously_failing, rpc, state_diff, function: func, evidence: ctx.evidence };
}

export async function runProd({ mode, request, deps }) {
  const now = deps.now ?? (() => new Date());
  const ctx = { deps, known: [], evidence: [], stamp: stampOf(now()), armed: false, stage: 'mode', say: (l) => (deps.out ?? (() => {}))(String(l)) };
  let client = null;
  try {
    if (!MODES.includes(mode)) stop('MODE_NOT_ACCEPTED', { accepted: MODES });

    // ── 0. pins: before any credential is used ──
    ctx.stage = 'pins';
    try { P.assertProdKeychainNamespace(deps.keychain?.namespace); } catch (e) { stop('KEYCHAIN_NAMESPACE_REFUSED', { error: e.message }); }
    for (const [rel, want] of Object.entries(P.CERTIFIED_STAGING_TOOLING_SHA256)) {
      let got = null; try { got = sha(fs.readFileSync(path.join(TOOLING_REPO, rel))); } catch { got = null; }
      if (got !== want) stop('PINS_MISMATCH', { reason: 'certified Staging tooling differs from d62039c7', file: rel });
    }
    let rendered;
    try { rendered = P.renderAuthorized(deps.repo); } catch (e) { stop('PINS_MISMATCH', { error: e.code ?? e.message }); }
    let artifact;
    try { artifact = P.localArtifact(deps.repo); } catch (e) { stop('ARTIFACT_MISMATCH', { error: e.code ?? e.message }); }
    const artifact_diff = P.artifactDiff(artifact);
    if (artifact_diff.length) stop('ARTIFACT_MISMATCH', { diff: artifact_diff });
    let baseline;
    try { baseline = P.loadLedgerBaseline(); } catch (e) { stop('PINS_MISMATCH', { error: e.message }); }
    const pins = {
      migrations: rendered.map((m) => ({ version: m.version, name: m.name, sha256: m.migration_sha256, apply_sql_sha256: m.apply_sql_sha256, apply_sql_bytes: Buffer.byteLength(m.apply_sql), ledger: { statements_count: m.row.statements_count, statements_digest: m.row.statements_digest, statements_bytes: m.row.statements_bytes } })),
      artifact: { slug: P.FUNCTION_ARTIFACT.slug, verify_jwt: false, files: artifact.files, certified_staging_evidence: P.FUNCTION_ARTIFACT.certified_staging_evidence },
      ledger_baseline: { sha256: P.LEDGER_BASELINE_SHA256, rows: baseline.rows.length, max_version: baseline.totals.max_version, source: baseline.source },
      tooling: Object.fromEntries(TOOLING_FILES.map((f) => { try { return [f, sha(fs.readFileSync(path.join(HERE, f)))]; } catch { return [f, null]; } })),
    };
    ctx.say(`[ok] pins: 2 authorized migrations, artifact 3 files == certified Staging deploy, ledger baseline ${baseline.rows.length} rows`);

    // ── request: the PAT and nothing else ──
    ctx.stage = 'request';
    if (!request || typeof request !== 'object' || Array.isArray(request)) stop('REQUEST_MALFORMED');
    const extra = Object.keys(request).filter((k) => !REQUEST_KEYS.includes(k));
    if (extra.length) stop('REQUEST_KEY_NOT_ACCEPTED', { keys: extra });
    if (typeof request.pat === 'string') ctx.known.push(request.pat);
    const harnessMode = mode === '--harness-only';
    try { client = prodClient({ pat: request.pat, transport: harnessMode ? readOnlyTransport(deps.transport) : deps.transport }); } catch (e) { stop('PAT_REFUSED', { error: e.message }); }

    // ── custody (local, read-only): presence; a present value must be readable, well-formed and ≠ Staging ──
    ctx.stage = 'custody';
    const custody = { namespace: P.KEYCHAIN_PROD, keychain: null, value_checked: false, distinct_from_nonprod: null };
    let harnessSecret = null;
    if (harnessMode) {
      // Certification only: the value must already exist (never generated here) and provably differ from Staging.
      try { custody.keychain = deps.keychain.check(); } catch { stop('HARNESS_ONLY_SECRET_CUSTODY', { reason: 'keychain_check_ambiguous' }); }
      if (custody.keychain !== 'PRESENT') stop('HARNESS_ONLY_SECRET_CUSTODY', { reason: 'production_keychain_not_present', keychain: custody.keychain ?? null });
      try { harnessSecret = readValidatedSecret(deps.keychain); } catch { stop('HARNESS_ONLY_SECRET_CUSTODY', { reason: 'keychain_value_unreadable_or_malformed' }); }
      ctx.known.push(harnessSecret);
      let n; try { n = deps.keychain.readNonprod(); } catch { stop('HARNESS_ONLY_SECRET_CUSTODY', { reason: 'nonprod_entry_unreadable' }); }
      if (typeof n !== 'string') stop('HARNESS_ONLY_SECRET_CUSTODY', { reason: 'nonprod_entry_absent_distinctness_unprovable' });
      ctx.known.push(n);
      if (P.secretEqualsNonprod(harnessSecret, n)) stop('SECRET_EQUALS_NONPROD');
      custody.value_checked = true; custody.distinct_from_nonprod = true;
      n = null;
    } else if (mode !== '--acl-only') {
      try { custody.keychain = deps.keychain.check(); } catch (e) { stop('SECRET_CUSTODY_FAILED', { reason: 'keychain_check_ambiguous' }); }
      if (!['ABSENT', 'PRESENT'].includes(custody.keychain)) stop('SECRET_CUSTODY_FAILED', { reason: 'keychain_state_unknown' });
      if (custody.keychain === 'PRESENT') {
        let v; let n;
        try { v = readValidatedSecret(deps.keychain); } catch { stop('SECRET_CUSTODY_FAILED', { reason: 'keychain_value_unreadable_or_malformed' }); }
        ctx.known.push(v);
        try { n = deps.keychain.readNonprod(); } catch { stop('SECRET_CUSTODY_FAILED', { reason: 'nonprod_entry_unreadable' }); }
        if (typeof n === 'string') ctx.known.push(n);
        if (P.secretEqualsNonprod(v, n)) stop('SECRET_EQUALS_NONPROD');
        custody.value_checked = true; custody.distinct_from_nonprod = n === null ? 'nonprod_entry_absent' : true;
        v = null; n = null;
      }
    }

    // ── observation (read-only) + gates ──
    ctx.stage = 'observe';
    const view = harnessMode ? readOnlyView(client) : null;
    const obs = await observe(view ?? client);
    ctx.say(`[ok] project ${obs.project.ref} ${obs.project.name} ${obs.project.status} ${obs.project.region} (Postgres ${obs.project.database_version})`);
    const ev = evaluate(obs, { mode, custody });
    const observation = observationOf(obs, ev);

    if (harnessMode) {
      const res = await harnessOnly(ctx, { view, obs, ev, observation, pins, custody, secret: harnessSecret, deps, now });
      harnessSecret = null;
      return res;
    }

    if (mode === '--acl-only') {
      ctx.stage = 'acl-only';
      if (!ev.fully_installed) stop('CONTRACT_NOT_INSTALLED', { migrations: ev.migrations.decisions });
      const failures = aclOnlyFailures(obs);
      if (failures.length) stop('ACL_EXPECTATIONS_UNMET', { failures });
      writeEvidence(ctx, `core-prod-acl-${ctx.stamp}.json`, { generated_at: now().toISOString(), tool: 'backend/torneos/infra/core-prod-contract/core-prod-deploy.mjs', mode, read_only: true, target: P.PRODUCTION_PROJECT, pins, observation, verdict: 'CORE_PROD_ACL_PASS' });
      return { verdict: 'CORE_PROD_ACL_PASS', writes: 0, evidence: ctx.evidence };
    }

    const plan = {
      target: { ...P.PRODUCTION_PROJECT, status: obs.project.status },
      migrations: ev.migrations.decisions.map((d) => ({ version: d.version, installed: d.installed, ledger: d.ledger, decision: d.decision })),
      ledger_strategy: 'A (certified): file bytes + CLI-shaped ledger INSERT in ONE transaction per version; never ON CONFLICT; no ledger-only INSERT in Production',
      secret: ev.secret, keychain: custody.keychain, remote_secret: ev.remote_secret,
      function: { slug: P.FUNCTION_ARTIFACT.slug, present_before: Boolean(obs.fn), action: 'deploy (verify_jwt=false, 3 pinned files)' },
      verification: ['signed harness 9/9 (certified PROBE_EXPECT)', 'ACL (certified aclFailures + app_private owner-only)', 'app_private == exact contract set', 'catalog digests outside the contract unchanged', 'ledger == baseline + 2 own rows'],
      rollback: 'NOT part of this tooling: a Production rollback needs its own authorization',
    };
    const preflight = { generated_at: now().toISOString(), tool: 'backend/torneos/infra/core-prod-contract/core-prod-deploy.mjs', mode, read_only: true, target: P.PRODUCTION_PROJECT, target_source: P.PRODUCTION_PROJECT_SOURCE, pins, custody, observation, plan };
    const preflightSha = writeEvidence(ctx, `core-prod-preflight-${ctx.stamp}.json`, preflight);
    const planId = preflightSha.slice(0, 12);
    for (const m of plan.migrations) ctx.say(`  ${m.version}: objects ${m.installed ? 'INSTALLED' : 'absent'}, ledger ${m.ledger} → ${m.decision}`);
    ctx.say(`  secret: Keychain ${custody.keychain} / Core ${ev.remote_secret} → ${ev.secret}`);
    ctx.say(`  plan id ${planId}`);

    if (mode === '--preflight-only') {
      ctx.say('CORE_PROD_PREFLIGHT_ONLY_STOP (0 writes)');
      return { verdict: 'CORE_PROD_PREFLIGHT_ONLY_STOP', writes: client.writes.length, plan, plan_id: planId, evidence: ctx.evidence };
    }

    if (mode === '--dry-run') {
      ctx.stage = 'dry-run';
      const files = resolveFiles(path.join(deps.repo, P.FUNCTION_ARTIFACT.root), P.FUNCTION_ARTIFACT.entrypoint);
      const { body } = buildDeployBody(P.FUNCTION_ARTIFACT.slug, P.FUNCTION_ARTIFACT.entrypoint, P.FUNCTION_ARTIFACT.verify_jwt, files);
      const requests = [{ what: 'writer-context', method: 'POST', path: `/v1/projects/${P.PROD_REF}/database/query`, read_only: false, sql: 'WRITER_CONTEXT_SQL (a SELECT)' }];
      for (const m of rendered) if (ev.migrations.decisions.find((d) => d.version === m.version).decision === 'apply') requests.push({ what: `apply ${m.version}`, method: 'POST', path: `/v1/projects/${P.PROD_REF}/database/query`, read_only: false, sql_sha256: m.apply_sql_sha256, sql_bytes: Buffer.byteLength(m.apply_sql) });
      if (['generate-store-set', 'set-from-keychain'].includes(ev.secret)) requests.push({ what: `set-secrets ${P.SECRET_NAME}`, method: 'POST', path: `/v1/projects/${P.PROD_REF}/secrets`, body: `[{"name":"${P.SECRET_NAME}","value":"<Keychain ${P.KEYCHAIN_PROD.service}, withheld>"}]`, keychain_generation: ev.secret === 'generate-store-set' });
      requests.push({ what: `deploy ${P.FUNCTION_ARTIFACT.slug}`, method: 'POST', path: `/v1/projects/${P.PROD_REF}/functions/deploy?slug=${P.FUNCTION_ARTIFACT.slug}`, body_bytes: body.length, files: artifact.files });
      const dry_run = { requests, writes_performed: 0 };
      writeEvidence(ctx, `core-prod-dryrun-${ctx.stamp}.json`, { generated_at: now().toISOString(), tool: 'backend/torneos/infra/core-prod-contract/core-prod-deploy.mjs', mode, read_only: true, preflight: `${deps.evidencePrefix ?? ''}core-prod-preflight-${ctx.stamp}.json`, plan_id: planId, dry_run });
      ctx.say('CORE_PROD_DRYRUN_STOP (0 writes)');
      return { verdict: 'CORE_PROD_DRYRUN_STOP', writes: client.writes.length, plan, plan_id: planId, dry_run, evidence: ctx.evidence };
    }

    // ── --apply: human authorization on /dev/tty, never a flag or a variable ──
    ctx.stage = 'confirmation';
    if (deps.env && (deps.env.CI || deps.env.GITHUB_ACTIONS || deps.env.CONTINUOUS_INTEGRATION)) stop('NON_INTERACTIVE_WRITE_REFUSED', { reason: 'CI environment' });
    const phrase = P.confirmationPhrase(planId);
    const prompt = `\nCore PRODUCTION ${P.PROD_REF} (${P.PRODUCTION_PROJECT.name}) — plan ${planId}\n${plan.migrations.map((m) => `  ${m.version} → ${m.decision}`).join('\n')}\n  secret → ${plan.secret}\n  function → deploy ${P.FUNCTION_ARTIFACT.slug}\nType exactly:  ${phrase}\n> `;
    let typed;
    try { typed = await deps.readConfirmation(prompt, planId); } catch (e) { stop('NON_INTERACTIVE_WRITE_REFUSED', { reason: e?.code ?? 'tty_unavailable' }); }
    if (!P.confirmationMatches(typed, planId)) stop('CONFIRMATION_REFUSED', { planId });
    ctx.authorized = true;

    ctx.stage = 're-observe';
    const obs2 = await observe(client);
    if (fingerprint(obs2) !== observation.fingerprint) stop('PREFLIGHT_STATE_CHANGED', { before: observation.fingerprint, after: fingerprint(obs2) });

    // Local custody BEFORE the first remote write: the value exists, is readable, well-formed and ≠ Staging.
    ctx.stage = 'custody-apply';
    let secret;
    if (ev.secret === 'generate-store-set') {
      let st; try { st = deps.keychain.check(); } catch { stop('SECRET_CUSTODY_FAILED', { reason: 'keychain_check_ambiguous' }); }
      if (st !== 'ABSENT') stop('SECRET_CUSTODY_FAILED', { reason: 'keychain_changed_since_preflight' });
      try { deps.keychain.generate(); } catch (e) { stop('SECRET_CUSTODY_FAILED', { reason: 'keychain_generate_failed' }); }
    }
    try { secret = readValidatedSecret(deps.keychain); } catch { stop('SECRET_CUSTODY_FAILED', { reason: 'keychain_value_unreadable_or_malformed' }); }
    ctx.known.push(secret); client.registerSecret(secret);
    let nonprod; try { nonprod = deps.keychain.readNonprod(); } catch { stop('SECRET_CUSTODY_FAILED', { reason: 'nonprod_entry_unreadable' }); }
    if (typeof nonprod === 'string') ctx.known.push(nonprod);
    if (P.secretEqualsNonprod(secret, nonprod)) stop('SECRET_EQUALS_NONPROD');
    nonprod = null;

    ctx.stage = 'writer-context';
    client.arm(); ctx.armed = true;
    let writer;
    try { writer = await client.writerContext(); } catch (e) { stop('WRITER_CONTEXT_UNAVAILABLE', { error: e.message, detail: e.detail ?? null }); }

    ctx.stage = 'migrations';
    const applied = [];
    for (const m of rendered) {
      const d = ev.migrations.decisions.find((x) => x.version === m.version);
      if (d.decision === 'skip') { applied.push({ version: m.version, decision: 'skip', applied: false }); continue; }
      let r;
      try { r = await client.applyMigration(m); } catch (e) { stop('APPLY_FAILED', { version: m.version, error: e.message, detail: e.detail ?? null }); }
      let inst; let led;
      try { inst = (await client.installed())[m.version]; const l = await client.ledger(); led = P.evaluateLedger({ shape: l.shape, rows: l.rows }); } catch (e) { stop('APPLY_NOT_VERIFIABLE', { version: m.version, error: e.message }); }
      if (inst !== true || led.contract[m.version] !== 'ours' || !led.ok) stop('APPLY_NOT_EFFECTIVE', { version: m.version, installed_after: inst, ledger_after: led.contract[m.version], ledger_ok: led.ok });
      applied.push({ version: m.version, decision: 'apply', applied: true, status: r.status, elapsed_ms: r.elapsed_ms, installed_after: true, ledger_after: 'ours' });
      ctx.say(`[ok] ${m.version} applied (${r.elapsed_ms ?? '?'} ms), ledger row ours`);
    }

    ctx.stage = 'secret';
    let secret_action = 'reused (verify by probe)';
    if (['generate-store-set', 'set-from-keychain'].includes(ev.secret)) {
      try { await client.setSecret(secret); } catch (e) { stop('SET_SECRET_FAILED', { error: e.message }); }
      let names; try { names = await client.secretNames(); } catch (e) { stop('SET_SECRET_NOT_VERIFIABLE', { error: e.message }); }
      if (!names.includes(P.SECRET_NAME)) stop('SET_SECRET_NOT_EFFECTIVE');
      secret_action = ev.secret === 'generate-store-set' ? 'generated in Keychain + set on Core' : 'set on Core from Keychain';
      ctx.say(`[ok] ${P.SECRET_NAME}: ${secret_action} (value never printed)`);
    }

    ctx.stage = 'deploy';
    const files = resolveFiles(path.join(deps.repo, P.FUNCTION_ARTIFACT.root), P.FUNCTION_ARTIFACT.entrypoint);
    if (P.artifactDiff({ files: files.map((f) => ({ path: f.relPath, bytes: f.bytes.length, sha256: f.sha256 })), metadata: artifact.metadata }).length) stop('ARTIFACT_MISMATCH', { stage: 'deploy' });
    let dep;
    try { dep = await client.deploy(files); } catch (e) { stop('DEPLOY_FAILED', { error: e.message, detail: e.detail ?? null }); }
    let fnAfter; try { fnAfter = await client.fn(); } catch (e) { stop('DEPLOY_READBACK_FAILED', { error: e.message }); }
    if (!fnAfter || fnAfter.status !== 'ACTIVE' || fnAfter.verify_jwt !== false || !/^[0-9a-f]{64}$/.test(fnAfter.ezbr_sha256 ?? '')) stop('DEPLOY_READBACK_FAILED', { fn: fnAfter });
    ctx.say(`[ok] deployed ${P.FUNCTION_ARTIFACT.slug} version ${fnAfter.version} ezbr ${fnAfter.ezbr_sha256.slice(0, 12)}… verify_jwt=false ACTIVE`);

    ctx.stage = 'harness';
    const probe = await probeProd({ secret, retries: deps.probe?.retries ?? 8, interval_ms: deps.probe?.interval_ms ?? 10000, fetchImpl: deps.fetchImpl });
    const sensitive = responseSensitiveFindings(probe.checks, { secret });
    secret = null;
    const probeEvidence = { endpoint: probe.endpoint, verdict: probe.verdict, attempts: probe.attempts, checks: probe.checks.map((c) => ({ name: c.name, expected: c.expected, observed: { status: c.observed.status, body: c.observed.body, headers: c.observed.headers }, ok: c.ok })), sensitive_findings: sensitive };
    if (probe.verdict === 'SECRET_MISMATCH') stop('SIGNED_HARNESS_SECRET_MISMATCH', { probe: probeEvidence, note: 'Production never reconciles: Core holds another value than the Keychain' });
    if (!probe.pass) stop(`SIGNED_HARNESS_${probe.verdict}`, { probe: probeEvidence });
    if (sensitive.length) stop('SIGNED_HARNESS_SENSITIVE_MATERIAL', { probe: probeEvidence });
    ctx.say('[ok] signed harness 9/9 exact answers');

    ctx.stage = 'acl';
    let after;
    try { after = { acl: await client.acl(), app_private: await client.appPrivate(), catalog: await client.catalog(), ledger: await client.ledger(), installed: await client.installed() }; } catch (e) { stop('POSTFLIGHT_UNREADABLE', { error: e.message }); }
    const acl_failures = P.prodAclFailures(after.acl);
    if (acl_failures.length) stop('ACL_EXPECTATIONS_UNMET', { failures: acl_failures });
    const app_private_failures = P.appPrivateFailures(after.app_private, { installed: true });
    if (app_private_failures.length) stop('APP_PRIVATE_AFTER_UNEXPECTED', { failures: app_private_failures });
    const catalog_changed = P.catalogDiff(obs.catalog, after.catalog);
    if (catalog_changed.length) stop('CATALOG_CHANGED_OUTSIDE_CONTRACT', { categories: catalog_changed });
    const ledgerAfter = P.evaluateLedger({ shape: after.ledger.shape, rows: after.ledger.rows });
    if (!ledgerAfter.ok || P.AUTHORIZED_VERSIONS.some((v) => ledgerAfter.contract[v] !== 'ours' || after.installed[v] !== true)) stop('LEDGER_AFTER_UNEXPECTED', ledgerAfter);
    ctx.say('[ok] ACL, app_private, catalog (outside the contract unchanged) and ledger (baseline + 2 own rows)');

    ctx.stage = 'evidence';
    const result = {
      generated_at: now().toISOString(), tool: 'backend/torneos/infra/core-prod-contract/core-prod-deploy.mjs', mode, target: P.PRODUCTION_PROJECT,
      authorized_by: 'operator typed the confirmation phrase on /dev/tty', preflight: `${deps.evidencePrefix ?? ''}core-prod-preflight-${ctx.stamp}.json`, plan_id: planId,
      writer_context: writer, migrations: applied, secret: { name: P.SECRET_NAME, custody: `keychain:${P.KEYCHAIN_PROD.service}/${P.KEYCHAIN_PROD.account}`, action: secret_action, distinct_from_nonprod: true },
      deploy: { files: artifact.files, body_bytes: dep.body_bytes, fn: fnAfter, staging_certified_ezbr: P.FUNCTION_ARTIFACT.certified_staging_evidence.ezbr_sha256, ezbr_equals_staging: fnAfter.ezbr_sha256 === P.FUNCTION_ARTIFACT.certified_staging_evidence.ezbr_sha256 },
      probe: probeEvidence, acl: { failures: [], acl: after.acl }, app_private: after.app_private, catalog: { before: obs.catalog, after: after.catalog, changed: [] },
      ledger_after: { rows: ledgerAfter.observed_rows, contract: ledgerAfter.contract }, writes: client.writes,
    };
    writeEvidence(ctx, `core-prod-deployed-${ctx.stamp}.json`, result);
    ctx.say('CORE_PROD_CONTRACT_DEPLOYED');
    return { verdict: 'CORE_PROD_CONTRACT_DEPLOYED', writes: client.writes.length, plan, plan_id: planId, probe: { verdict: probe.verdict, checks: probe.checks.map((c) => ({ name: c.name, ok: c.ok })) }, acl_failures, catalog_changed, evidence: ctx.evidence };
  } catch (e) {
    const err = e instanceof StopError ? e : new StopError('INTERNAL_ERROR', { error: e?.message ?? String(e) });
    const family = mode === '--harness-only' ? 'core-prod-harness-only-failed' : (ctx.authorized ? 'core-prod-failed' : 'core-prod-preflight-failed');
    const pre = !['mode'].includes(ctx.stage) && err.code !== 'EVIDENCE_REJECTED_SECRET_LEAK' && deps.evidenceDir;
    if (pre) {
      try {
        writeEvidence(ctx, `${family}-${ctx.stamp}.json`, { generated_at: now().toISOString(), tool: 'backend/torneos/infra/core-prod-contract/core-prod-deploy.mjs', mode, read_only: !ctx.armed, stop: err.code, stage: ctx.stage, detail: err.detail, writes: client ? client.writes : [], server_state: ctx.armed ? 'writes may have happened: re-observe with --preflight-only before anything else' : (mode === '--harness-only' ? '0 Management API writes' : '0 writes') });
      } catch { /* the STOP itself is what matters; a leak refusal already prevented the file */ }
    }
    ctx.say(`!! STOP ${err.code} (stage ${ctx.stage}; ${ctx.armed ? `${client?.writes.length ?? 0} write request(s) sent` : '0 writes'})`);
    throw err;
  }
}

/** Reads one line from the controlling terminal. Throws (ENXIO/ENOENT) when there is none. */
export function readTtyLine(prompt) {
  const fd = fs.openSync('/dev/tty', 'r+');
  try {
    fs.writeSync(fd, prompt);
    const buf = Buffer.alloc(1); const bytes = [];
    for (;;) {
      const n = fs.readSync(fd, buf, 0, 1, null);
      if (n === 0 || buf[0] === 0x0a || bytes.length > 512) break;
      bytes.push(buf[0]);
    }
    return Buffer.from(bytes).toString('utf8');
  } finally { fs.closeSync(fd); }
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const stdin = await new Promise((resolve) => { const chunks = []; process.stdin.on('data', (c) => chunks.push(c)); process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
  let request = null;
  try { request = JSON.parse(stdin); } catch { request = null; }
  const deps = {
    repo: TOOLING_REPO, transport: httpsTransport, keychain: systemKeychain(), fetchImpl: fetch, evidenceDir: evidenceDirFor(mode),
    out: (l) => process.stdout.write(`${l}\n`), probe: { retries: 8, interval_ms: 10000 }, env: process.env,
    readConfirmation: (prompt) => readTtyLine(prompt),
  };
  try {
    if (rest.length) throw new StopError('MODE_NOT_ACCEPTED');
    await runProd({ mode, request, deps });
    process.exit(0);
  } catch (e) {
    process.stderr.write(`CORE_PROD_STOP ${e?.code ?? 'INTERNAL_ERROR'}\n`);
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
