// R4.2 operator: one process holds the PAT (Management API, read-only + api-keys reveal), the
// Core staging public anon key and service key (QA users only), and the contract secret (nonce
// replay probe) in memory, and drives the certified R4.1 runner: preflight → start-gateway
// (audit.mjs provisioning) → smoke → matrix → certify → cleanup, then verifies Core sessions and
// R2 and writes r4-cleanup / r4-summary. Input on stdin: {pat, secret, stamp}. Never argv/env/disk.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {r4, evidence, repo, runtime, root, d, call, readJSON, sha, fileSHA, registerSecret, redact, containsSecret, writeEvidence, r2Snapshot, catalogSHA256, tableCounts, log, Stop, CORE_REF, PROD_REF} from './lib.mjs';
import {assertAnonKey, assertServiceKey} from './core.mjs';
import {runMatrix} from './matrix.mjs';
import {runMinimalProbe} from './minimal.mjs';
import {runTransportProbe} from './transport-probe.mjs';
import {runRouteProbe} from './route-probe.mjs';
import {runJourney} from '../r5/journey.mjs';
import {run as mgmt, httpsRequest} from '../remote/mgmt.mjs';
import {validateAuthorization, validatePublicCoreKey} from '../r4/authorization.mjs';

const SEED_TABLES = ['public.tournament_commercial_offers', 'public.tournament_commercial_products', 'public.tournament_competition_formats', 'public.tournament_entitlement_capabilities', 'public.tournament_legacy_subscription_plans', 'public.tournament_media_pipeline_configuration', 'public.tournament_organization_role_capabilities', 'public.tournament_plan_catalog', 'public.tournament_pricing_config', 'public.tournament_sport_modalities'];

/** Same gate the sealed runner applies: newest R4.1A preflight → its hashes file → seal SHA. */
export function r41aSeal() {
  const candidates = fs.readdirSync(evidence).filter((f) => /^r4-preflight-\d+T\d+Z\.json$/.test(f)).sort().reverse();
  const newest = candidates.map((f) => ({f, doc: readJSON(path.join(evidence, f))})).find(({doc}) => doc.r41bExecuted === false);
  if (!newest || newest.doc.status !== 'R4_1A_PASS') throw new Stop('R4_1A_NOT_PASS');
  const stamp = newest.doc.utc;
  return {stamp, sealSHA256: sha(fs.readFileSync(`${evidence}/r4-hashes-${stamp}.json`))};
}
/** Pure: the explicit R4.2 authorization the sealed runner requires (validated by its own validator). */
export function buildAuthorization({sealSHA256, coreAnonKey, now = Date.now(), ttlMinutes = 120}) {
  validatePublicCoreKey(coreAnonKey);
  const doc = {phase: 'R4.2', userAuthorized: true, commands: ['start-gateway', 'smoke', 'certify'], r41aSealSHA256: sealSHA256,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMinutes * 60000).toISOString(), coreAnonKey,
    authorizedBy: 'operator message "ARMA2 TORNEOS — R4.2 HYBRID GATEWAY CERTIFICATION" (2026-09-18): start the prepared R4 gateway only; no DB/REST recreate, no reset, no destroy, no Production',
    scope: {noProduction: true, noRedesign: true, coreRef: CORE_REF}};
  for (const c of doc.commands) validateAuthorization(doc, c, sealSHA256);
  return doc;
}
/** The certified runner / audit as child processes; their last stdout line is the JSON verdict. */
function runner(cmd, extra = [], timeout = 90000) {
  const r = call(process.execPath, [r4 + '/runner.mjs', cmd, ...extra], {ok: true, timeout});
  const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '{}';
  let doc; try { doc = JSON.parse(line); } catch { doc = {status: 'BLOCKED', raw: redact(line).slice(0, 400)}; }
  log(`runner ${cmd}: ${doc.status ?? '?'} ${doc.reason ?? ''}`);
  return {...doc, exit: r.status};
}
function auditStart() {
  const r = call(process.execPath, [r4 + '/audit.mjs', 'start-gateway'], {ok: true, timeout: 240000});
  const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '{}';
  let doc; try { doc = JSON.parse(line); } catch { doc = {status: 'BLOCKED', raw: redact(line + (r.stderr ?? '')).slice(-600)}; }
  log(`audit start-gateway: ${doc.status ?? '?'} ${doc.raw ?? ''}`);
  return {...doc, exit: r.status, stderr: redact((r.stderr ?? '').slice(-800))};
}
const portFree = () => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(58431, '127.0.0.1', () => s.close(() => res(true))); });
/** Read-only R2 identity check against the R4.1A baselineAfter the sealed runner also uses. */
function r2Check(r41aStamp) {
  const iso = readJSON(`${evidence}/r4-isolation-design-${r41aStamp}.json`).baselineAfter;
  const now = r2Snapshot();
  const same = (k) => JSON.stringify(now.db[k]) === JSON.stringify(iso.db[k]);
  return {dbId: now.db.id === iso.db.id, dbImage: same('image'), dbStarted: same('started'), dbNetworks: same('networks'), dbMounts: same('mounts'), dbHealthy: now.db.health === 'healthy',
    restId: now.rest.id === iso.rest.id, restStarted: now.rest.started === iso.rest.started, restNetworks: JSON.stringify(now.rest.networks) === JSON.stringify(iso.rest.networks),
    catalog: now.catalogSHA256 === iso.catalogSHA256, ring: now.ringSHA256 === iso.ringSHA256, jwks: now.jwksSHA256 === iso.jwksSHA256, catalogSHA256: now.catalogSHA256};
}

/** mode 'matrix' (the certified R4.2 run), 'minimal' (post-fix clock-skew reproduction: 1 QA user, exchanges + session verdicts, 0 fixtures, no certify),
 * 'transport' (R4.2 targeted diagnostics) or 'r5' (R5 hybrid end-to-end journey: same handoff/guards/gateway lifecycle, journey producer instead of the matrix, no sealed certify; evidence r5-*). */
export async function operate({pat, secret, stamp, mode = 'matrix', transportVariant = 'diagnosis'}) {
  if (!['matrix', 'minimal', 'transport', 'r5'].includes(mode)) throw new Stop('MODE_UNKNOWN', String(mode));
  const ev = mode === 'r5' ? 'r5' : 'r4';
  if (mode === 'transport' && !['diagnosis','postfix','worker','route','route-loaded','route-postfix'].includes(transportVariant)) throw new Stop('TRANSPORT_VARIANT_UNKNOWN');
  const routeVariant = mode === 'transport' && transportVariant.startsWith('route');
  registerSecret(pat); registerSecret(secret);
  if (!/^sbp_[A-Za-z0-9_]{20,160}$/.test(pat ?? '')) throw new Stop('PAT_MALFORMED');
  if (!/^[0-9a-f]{64}$/.test(secret ?? '')) throw new Stop('CONTRACT_SECRET_MALFORMED');
  if (pat.includes(PROD_REF)) throw new Stop('PRODUCTION_REF_IN_TOKEN');
  const summary = {schema: mode === 'r5' ? 'R5.summary.v1' : 'R4.2.summary.v1', stamp, mode, utc: new Date().toISOString(), verdict: mode === 'r5' ? 'R5_FAIL' : 'R4_FAIL', steps: [], blockers: [], evidence: {}};
  const step = (name, doc) => { summary.steps.push({name, ...doc}); log(`step ${name}: ${doc.status}`); if (doc.status !== 'PASS') { summary.blockers.push(name + (doc.reason ? ': ' + doc.reason : '')); throw new Stop('STEP_FAILED', name); } };
  let seal, matrixResult = null, matrixPath = null, gatewayStarted = false, authPath = r4 + '/.runtime/authorization.json', r2Before = null, minimal = null, journey = null;
  try {
    // 0. handoff / preflight (read-only)
    seal = r41aSeal();
    const pre = {free: await portFree(), r2: r2Check(seal.stamp), prepared: fs.existsSync(r4 + '/.runtime/prepared.json'), runJson: fs.existsSync(r4 + '/.runtime/run.json'), auth: fs.existsSync(authPath),
      r4containers: d(['ps', '-a', '--filter', 'label=arma2.r4.run', '--format', '{{.ID}}']).stdout.trim(), r4networks: d(['network', 'ls', '--filter', 'label=arma2.r4.run', '--format', '{{.Name}}']).stdout.trim()};
    const r2ok = Object.entries(pre.r2).filter(([k]) => k !== 'catalogSHA256').every(([, v]) => v === true);
    r2Before = pre.r2;
    step('handoff_check', {status: pre.free && r2ok && pre.prepared && !pre.runJson && !pre.auth && !pre.r4containers && !pre.r4networks ? 'PASS' : 'FAIL', r41aStamp: seal.stamp, r41aSealSHA256: seal.sealSHA256, ...pre});
    // 1. Core staging guards + public/service keys (Management API, PAT in memory)
    const p = await mgmt({op: 'project', pat, ref: CORE_REF});
    step('core_project_guard', {status: p.project?.name === 'arma2-torneos-staging' && p.project?.status === 'ACTIVE_HEALTHY' ? 'PASS' : 'FAIL', project: p.project?.name, projectStatus: p.project?.status});
    const f = await mgmt({op: 'function', pat, ref: CORE_REF, slug: 'torneos-core-contract'});
    step('core_contract_function_guard', {status: f.fn?.status === 'ACTIVE' ? 'PASS' : 'FAIL', fn: f.fn?.slug, fnStatus: f.fn?.status, ezbr_sha256: f.fn?.ezbr_sha256});
    const keys = await httpsRequest({pat, method: 'GET', path: `/v1/projects/${CORE_REF}/api-keys?reveal=true`});
    if (keys.status !== 200 || !Array.isArray(keys.body)) throw new Stop('API_KEYS_UNAVAILABLE', String(keys.status));
    const dec = (k) => { try { return JSON.parse(Buffer.from(String(k).split('.')[1], 'base64url')); } catch { return null; } };
    const anonKey = keys.body.find((k) => dec(k.api_key)?.role === 'anon' && dec(k.api_key)?.ref === CORE_REF)?.api_key ?? keys.body.find((k) => /^sb_publishable_/.test(k.api_key ?? ''))?.api_key;
    const serviceKey = keys.body.find((k) => dec(k.api_key)?.role === 'service_role' && dec(k.api_key)?.ref === CORE_REF)?.api_key;
    for (const k of keys.body) registerSecret(k.api_key);
    step('core_keys', {status: anonKey && serviceKey ? 'PASS' : 'FAIL', anonKind: anonKey ? assertAnonKey(anonKey) : null, serviceKind: serviceKey ? assertServiceKey(serviceKey) : null, keysListed: keys.body.length});
    // 2. explicit R4.2 authorization bound to the R4.1A seal (public anon key only; removed at the end)
    const authorization = buildAuthorization({sealSHA256: seal.sealSHA256, coreAnonKey: anonKey});
    if (mode === 'transport') { authorization.commands = ['start-gateway', 'smoke']; authorization.authorizedBy = routeVariant ? '2026-09-20 user: R4.2 torneos_rest_unavailable targeted diagnosis / post-fix validation only; no matrix, no certify' : '2026-09-20 user: R4.2 Blocker 1 targeted transport diagnosis only; no matrix, no certify'; }
    if (mode === 'r5') { authorization.commands = ['start-gateway', 'smoke']; authorization.authorizedBy = 'operator message "ARMA2 TORNEOS — R5 HYBRID END-TO-END CERTIFICATION" (2026-09-21): start the R4-certified gateway unchanged for the E2E journey; no matrix, no certify, no DB/REST recreate, no Production'; }
    fs.mkdirSync(r4 + '/.runtime', {recursive: true, mode: 0o700});
    fs.writeFileSync(authPath, JSON.stringify(authorization, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    step('authorization', {status: 'PASS', expiresAt: authorization.expiresAt, commands: authorization.commands});
    // 3. runner preflight (fresh evidence) + audit start-gateway (same provisioning the runner's start-gateway calls, without its 45 s SIGKILL window)
    const pf = runner('preflight');
    step('runner_preflight', {status: pf.status === 'PASS' ? 'PASS' : 'FAIL', reason: pf.reason, evidence: pf.evidence});
    const st = auditStart();
    gatewayStarted = st.gatewayStarted === true;
    summary.evidence.gatewayStart = st.evidence ? {path: path.relative(evidence, st.evidence), sha256: fileSHA(st.evidence)} : null;
    step('start_gateway', {status: st.status === 'STARTED_PENDING_SMOKE' && gatewayStarted ? 'PASS' : 'FAIL', reason: st.status !== 'STARTED_PENDING_SMOKE' ? (st.raw ?? st.stderr ?? st.status) : undefined, evidence: st.evidence});
    const runState = readJSON(r4 + '/.runtime/run.json');
    summary.run = runState.run; summary.gatewayBundleSHA256 = runState.gatewayBundleSHA256;
    // 4. smoke (config / JWKS p3b-k1 only / health with the live Core)
    const sm = runner('smoke');
    summary.evidence.smoke = sm.evidence ? {path: path.relative(evidence, sm.evidence), sha256: fileSHA(sm.evidence)} : null;
    step('smoke', {status: sm.status === 'PASS' ? 'PASS' : 'FAIL', reason: sm.reason, evidence: sm.evidence});
    if (mode === 'r5') {
      // 5''. R5 journey (in-process; credentials stay here): Core QA users → exchange → shadow identity → staging-v1 owner journey → negatives → cleanup.
      journey = await runJourney({stamp, anonKey, serviceKey, contractSecret: secret});
      const j = journey.doc;
      for (const [k, v] of Object.entries(journey.artifacts)) summary.evidence[k] = v;
      // 6''. Core verified read-only through the Management API: auth.sessions of every QA user, no QA leftover, the Core team fixture gone.
      const sessions = [];
      for (const u of j.qaUsers) {
        const s = await mgmt({op: 'core-session-exists', pat, ref: CORE_REF, user_id: u.id, session_id: u.lastSession ?? '00000000-0000-0000-0000-000000000000'});
        sessions.push({role: u.role, id: u.id.slice(0, 8), sessionPresent: s.session_present, userSessions: s.user_sessions, deleted: u.deleted});
      }
      const qaList = await mgmt({op: 'core-qa-users', pat, ref: CORE_REF});
      const leftovers = (qaList.users ?? qaList.rows ?? []).filter((u) => j.qaUsers.some((q) => u.id_prefix && q.id.startsWith(u.id_prefix)));
      const teams = [];
      for (const t of j.coreFixtures?.teams ?? []) { const r = await mgmt({op: 'core-team-exists', pat, ref: CORE_REF, team_id: t.id}); teams.push({id: t.id.slice(0, 8), present: r.team_present, members: r.team_members, deletedByOwner: t.deleted}); }
      j.cleanup.sessions = sessions.length === j.qaUsers.length && sessions.every((s) => s.sessionPresent === false && s.userSessions === 0 && s.deleted === true) && leftovers.length === 0;
      j.cleanup.coreFixtures = j.cleanup.coreFixtures === true && teams.every((t) => t.present === false && t.members === 0);
      j.cleanup.complete = j.cleanup.qa && j.cleanup.fixtures && j.cleanup.sessions && j.cleanup.coreFixtures;
      j.coreVerification = {sessions, leftovers: leftovers.length, teams, source: 'Management API read-only SQL (core-session-exists, core-qa-users, core-team-exists)'};
      const journeyPath = writeEvidence('r5-journey', j, stamp);
      summary.evidence.journey = {path: path.relative(evidence, journeyPath), sha256: fileSHA(journeyPath)};
      step('journey', {status: j.status, blocks: j.cases.map((c) => `${c.name}:${c.status}`), informative: j.informative.map((c) => `${c.name}:${c.status}`), totals: j.totals, cleanup: j.cleanup, missingRequired: j.missingRequired, aborted: j.aborted});
      step('core_sessions_zero', {status: j.cleanup.sessions ? 'PASS' : 'FAIL', sessions, leftovers: leftovers.length});
      step('core_fixtures_zero', {status: j.cleanup.coreFixtures ? 'PASS' : 'FAIL', teams});
    } else if (mode === 'minimal' || mode === 'transport') {
      // 5'. minimal reproduction (in-process): exchanges + session verdicts only; then Core sessions verified read-only.
      minimal = await (routeVariant ? runRouteProbe : mode === 'transport' ? runTransportProbe : runMinimalProbe)({stamp, anonKey, serviceKey, variant:transportVariant});
      summary.evidence[mode === 'transport' ? 'transport' : 'minimal'] = minimal.artifact;
      const sessions = [];
      for (const u of minimal.doc.qaUsers) {
        const s = await mgmt({op: 'core-session-exists', pat, ref: CORE_REF, user_id: u.id, session_id: u.lastSession ?? '00000000-0000-0000-0000-000000000000'});
        sessions.push({role: u.role, id: u.id.slice(0, 8), sessionPresent: s.session_present, userSessions: s.user_sessions, deleted: u.deleted});
      }
      step(mode === 'transport' ? 'transport_probe' : 'minimal_probe', {status: minimal.doc.status, steps: minimal.doc.steps.map((x) => `${x.name}:${x.status}`), verdicts: minimal.doc.calls.length, cleanup: minimal.doc.cleanup, aborted: minimal.doc.aborted});
      step('core_sessions_zero', {status: sessions.length === minimal.doc.qaUsers.length && sessions.every((x) => x.sessionPresent === false && x.userSessions === 0 && x.deleted === true) ? 'PASS' : 'FAIL', sessions});
    } else {
    // 5. matrix (in-process; credentials stay here)
    matrixResult = await runMatrix({stamp, anonKey, serviceKey, contractSecret: secret});
    const m = matrixResult.matrix;
    // 6. Core sessions verified read-only through the Management API (auth.sessions of every QA user)
    const sessions = [];
    for (const u of m.qaUsers) {
      const s = await mgmt({op: 'core-session-exists', pat, ref: CORE_REF, user_id: u.id, session_id: u.lastSession ?? '00000000-0000-0000-0000-000000000000'});
      sessions.push({role: u.role, id: u.id.slice(0, 8), sessionPresent: s.session_present, userSessions: s.user_sessions, deleted: u.deleted});
    }
    const qaList = await mgmt({op: 'core-qa-users', pat, ref: CORE_REF});
    const leftovers = (qaList.users ?? qaList.rows ?? []).filter((u) => m.qaUsers.some((q) => u.id_prefix && q.id.startsWith(u.id_prefix)));
    m.cleanup.sessions = sessions.length === m.qaUsers.length && sessions.every((s) => s.sessionPresent === false && s.userSessions === 0 && s.deleted === true) && leftovers.length === 0;
    m.coreSessionVerification = {sessions, leftovers: leftovers.length, source: 'Management API read-only SQL (core-session-exists, core-qa-users)'};
    matrixPath = writeEvidence('r4-matrix', m, stamp);
    summary.evidence.matrix = {path: path.relative(evidence, matrixPath), sha256: fileSHA(matrixPath)};
    for (const [k, v] of Object.entries(matrixResult.artifacts)) summary.evidence[k] = v;
    step('matrix', {status: m.status, blocks: m.cases.map((c) => `${c.name}:${c.status}`), totals: m.totals, cleanup: m.cleanup, missingRequired: m.missingRequired});
    step('core_sessions_zero', {status: m.cleanup.sessions ? 'PASS' : 'FAIL', sessions});
    // 7. certify with the sealed validator (gateway still live), then runner cleanup
    const ce = runner('certify', [matrixPath]);
    summary.evidence.certify = ce.evidence ? {path: path.relative(evidence, ce.evidence), sha256: fileSHA(ce.evidence)} : null;
    step('certify', {status: ce.status === 'PASS' ? 'PASS' : 'FAIL', reason: ce.reason, evidence: ce.evidence});
    }
  } catch (e) {
    const msg = redact(String(e?.message ?? e)).slice(0, 500);
    if (!summary.blockers.includes(msg) && !(e instanceof Stop && e.code === 'STEP_FAILED')) summary.blockers.push(msg);
    log(`operator aborted: ${msg}`);
  } finally {
    // 8. runtime cleanup (only the recorded run's labeled resources), authorization removal, R2 final state
    const cl = fs.existsSync(r4 + '/.runtime/run.json') ? runner('cleanup', [], 120000) : {status: 'PASS', removed: [], note: 'no run.json'};
    try { fs.rmSync(authPath, {force: true}); } catch {}
    const remaining = {containers: d(['ps', '-a', '--filter', 'label=arma2.r4.run', '--format', '{{.Names}}'], {ok: true}).stdout.trim(), networks: d(['network', 'ls', '--filter', 'label=arma2.r4.run', '--format', '{{.Name}}'], {ok: true}).stdout.trim()};
    const r2After = seal ? r2Check(seal.stamp) : null;
    const counts = tableCounts();
    const nonSeedRows = Object.entries(counts).filter(([t, n]) => n > 0 && !SEED_TABLES.includes(t)).map(([t, n]) => `${t}=${n}`);
    const free = await portFree();
    const cleanupDoc = {schema: mode === 'r5' ? 'R5.cleanup.v1' : 'R4.2.cleanup.v1', stamp, run: summary.run ?? null,
      qa: matrixResult?.cleanup ?? journey?.doc?.cleanup ?? minimal?.doc?.cleanup ?? null, coreSessions: matrixResult?.matrix?.coreSessionVerification ?? journey?.doc?.coreVerification ?? null,
      runtime: {status: cl.status, removed: cl.removed ?? [], reason: cl.reason, remaining, authorizationRemoved: !fs.existsSync(authPath), runJsonRemoved: !fs.existsSync(r4 + '/.runtime/run.json'), port58431Free: free},
      r2: r2After, torneosRowsOutsideSeed: nonSeedRows,
      complete: cl.status === 'PASS' && !remaining.containers && !remaining.networks && !fs.existsSync(authPath) && free
        && (mode === 'r5' ? journey?.doc?.cleanup?.complete === true : mode !== 'matrix' ? minimal?.doc?.complete === true : matrixResult?.cleanup?.qa === true && matrixResult?.cleanup?.fixtures === true && matrixResult?.matrix?.cleanup?.sessions === true)
        && nonSeedRows.length === 0 && r2After && Object.entries(r2After).filter(([k]) => k !== 'catalogSHA256').every(([, v]) => v === true)};
    const cleanupPath = writeEvidence(ev + '-cleanup', cleanupDoc, stamp);
    summary.evidence.cleanup = {path: path.relative(evidence, cleanupPath), sha256: fileSHA(cleanupPath)};
    summary.steps.push({name: 'cleanup', status: cleanupDoc.complete ? 'PASS' : 'FAIL', runtime: cleanupDoc.runtime, r2: r2After, torneosRowsOutsideSeed: nonSeedRows});
    if (!cleanupDoc.complete) summary.blockers.push('cleanup incomplete');
    const m = matrixResult?.matrix;
    const stepsPass = summary.steps.every((s) => s.status === 'PASS');
    summary.verdict = mode !== 'matrix'
      ? (stepsPass && minimal?.doc?.status === 'PASS' && cleanupDoc.complete ? 'R4_MINIMAL_PASS' : 'R4_MINIMAL_FAIL')
      : (stepsPass && m?.status === 'PASS' && cleanupDoc.complete ? 'R4_HYBRID_GATEWAY_CERTIFIED' : 'R4_FAIL');
    if (mode === 'transport') summary.verdict = stepsPass && minimal?.doc?.status === 'PASS' && cleanupDoc.complete ? 'R42_TRANSPORT_PASS' : 'R42_TRANSPORT_FAIL';
    if (mode === 'r5') { summary.verdict = stepsPass && journey?.doc?.status === 'PASS' && journey.doc.missingRequired.length === 0 && cleanupDoc.complete ? 'R5_HYBRID_E2E_CERTIFIED' : 'R5_FAIL'; summary.journey = journey?.doc ? {status: journey.doc.status, blocks: journey.doc.cases, informative: journey.doc.informative, totals: journey.doc.totals, rpcsExercised: journey.doc.rpcsExercised, rpcsOutsideAllowlist: journey.doc.rpcsOutsideAllowlist, identityMap: journey.doc.identityMap, liveContracts: journey.doc.liveContracts, coreFixtures: journey.doc.coreFixtures, cleanup: journey.doc.cleanup, coreVerification: journey.doc.coreVerification} : null; }
    if (routeVariant) {
      // Diagnosis verdict names what was observed (controls valid + reproduced or not); post-fix is a plain PASS/FAIL.
      const ok = stepsPass && minimal?.doc?.status === 'PASS' && cleanupDoc.complete;
      summary.verdict = transportVariant !== 'route-postfix' ? (ok ? (minimal.doc.diagnosis?.reproduced ? 'R42_ROUTE_DIAGNOSIS_REPRODUCED' : 'R42_ROUTE_DIAGNOSIS_NOT_REPRODUCED') : 'R42_ROUTE_DIAGNOSIS_FAIL') : (ok ? 'R42_ROUTE_TARGETED_PASS' : 'R42_ROUTE_TARGETED_FAIL');
      summary.routeDiagnosis = minimal?.doc?.diagnosis ?? null; summary.routeExpectations = minimal?.doc?.expectations ?? null;
    }
    summary.blocks = m ? m.cases.map((c) => ({name: c.name, status: c.status, checks: c.checks})) : [];
    summary.informative = m?.informative ?? [];
    summary.totals = m ? {...m.totals, requiredCases: m.cases.length, allowlistCovered: m.allowlistCovered.length, gatedCovered: m.gatedCovered.length} : null;
    summary.liveContracts = m?.liveContracts ?? null;
    summary.r2 = {before: r2Before, after: r2After};
    summary.r41a = seal ?? null; summary.gatewayStarted = gatewayStarted;
    summary.differencesFromHistoricalLab = [
      'Core is the REAL remote staging project (GoTrue password grant on admin-created QA users; Core contract over HTTPS through the R4.1 exact-SNI proxy) instead of the local Core lab with signup.',
      'Manager acceptance ran through the live verified_email contract (Phase 2D seeded it); directory_players / directory_teams ran live; team_snapshot was not exercised (no Core team fixture on staging).',
      'Outages: Core Auth/contract faults injected as path-scoped connection resets in the run-owned proxy, preserving ingress; Torneos REST unreachability injected as /32 route removal inside the run-owned gateway namespace (no fault injected into Core staging or R2 services); contract-specific 5xx/timeout/stale/malformed cases ran on the real gateway modules in the certified Edge runtime with --network none (r4-outage).',
      'start-gateway invoked as runner preflight + audit.mjs start-gateway (the same provisioning the runner delegates to) to avoid the runner\'s 45 s child timeout; smoke/certify/cleanup used the sealed runner.',
      'Direct database-side probes went to the R2 loopback PostgREST (127.0.0.1:58430) instead of an in-network exec.'];
    summary.evidenceHashes = Object.fromEntries(fs.readdirSync(evidence).filter((f) => f.includes(stamp) || (summary.run && f.includes(summary.run.replace('arma2-r42-', '').toUpperCase()))).sort().map((f) => [f, fileSHA(evidence + '/' + f)]));
    const summaryPath = writeEvidence(ev + '-summary', summary, stamp);
    log(`summary ${summaryPath}`);
    log(`VERDICT ${summary.verdict}`);
    process.stdout.write(redact(JSON.stringify({verdict: summary.verdict, blockers: summary.blockers, summary: path.relative(evidence, summaryPath), evidence: summary.evidence})) + '\n');
    process.exitCode = ['R4_HYBRID_GATEWAY_CERTIFIED', 'R4_MINIMAL_PASS', 'R42_TRANSPORT_PASS', 'R42_ROUTE_DIAGNOSIS_REPRODUCED', 'R42_ROUTE_DIAGNOSIS_NOT_REPRODUCED', 'R42_ROUTE_TARGETED_PASS', 'R5_HYBRID_E2E_CERTIFIED'].includes(summary.verdict) ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  let s = ''; for await (const c of process.stdin) s += c;
  let input; try { input = JSON.parse(s); } catch { console.log('{"verdict":"R4_FAIL","blockers":["stdin_not_json"]}'); process.exit(1); }
  s = '';
  if (!/^\d{8}T\d{6}Z$/.test(input.stamp ?? '')) { console.log('{"verdict":"R4_FAIL","blockers":["stamp_missing"]}'); process.exit(1); }
  await operate(input);
}
