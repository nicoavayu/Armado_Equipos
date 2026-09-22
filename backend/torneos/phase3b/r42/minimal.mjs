// R4.2 MINIMAL post-fix reproduction (clock-skew freshness, gateway core-client.ts): one dedicated Core
// staging QA user, one valid exchange, immediate re-exchanges, session-bound RPC calls (each one is a live
// /v1/session verdict), enough rounds to walk through every fractional phase of the second, ZERO Torneos
// fixtures. Pass = no CORE_UNAVAILABLE across the whole sequence while Core stays healthy. The negative
// sides (Core down / too old / too far in the future → 503) cannot be induced on the live Core and are
// certified by outage-harness/ (real gateway modules, --network none). Same guards, secrets and cleanup as
// the matrix producer; leaves R2 at its pre-run counts and Core without the QA user or its sessions.
import {readJSON, sha, repo, r4, guardedFetch, registerSecret, decodeJwt, tableCounts, catalogSHA256, writeEvidence, artifact, log, Stop, GATEWAY, GATEWAY_ORIGIN, CORE_ORIGIN, REST_ORIGIN, UUID} from './lib.mjs';
import {coreClient, assertAnonKey, assertServiceKey} from './core.mjs';
import {cleanupFixtures} from './fixtures.mjs';
import fs from 'node:fs';

export const DEFAULT_ROUNDS = {reExchanges: 20, sessionCalls: 40};

export async function runMinimalProbe({stamp, anonKey, serviceKey, rounds = DEFAULT_ROUNDS}) {
  assertAnonKey(anonKey); assertServiceKey(serviceKey);
  registerSecret(anonKey); registerSecret(serviceKey);
  const state = readJSON(r4 + '/.runtime/run.json');
  const run = state.run, RUN = run.replace('arma2-r42-', '').slice(0, 15);
  const http = guardedFetch([GATEWAY_ORIGIN, REST_ORIGIN, CORE_ORIGIN]);
  const core = coreClient({http, anonKey, serviceKey, run});
  const calls = [];
  async function gw(path, {token, method = 'GET', body} = {}) {
    const t0 = performance.now();
    const r = await http(`${GATEWAY}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000)});
    calls.push({path, status: r.status, error: r.body?.error ?? null, ms: Math.round(performance.now() - t0), noStore: !!r.headers['cache-control']?.includes('no-store'), at: new Date().toISOString()});
    return r;
  }
  const doc = {schema: 'R4.2.minimal.v1', run, stamp, gatewayBundleSHA256: state.gatewayBundleSHA256,
    coreClientSHA256: sha(fs.readFileSync(repo + '/backend/torneos/supabase/functions/torneos-gateway/core-client.ts')),
    rounds, steps: [], calls, cleanup: {qa: false, sessions: false, rows: false}, status: 'FAIL'};
  const step = (name, detail) => { doc.steps.push({name, ...detail}); log(`minimal ${name}: ${detail.status}`); if (detail.status !== 'PASS') throw new Stop('MINIMAL_STEP_FAILED', name); };
  const baseline = tableCounts(), catalog = catalogSHA256();
  let user = null;
  try {
    user = await core.createUser('probe'); await core.login(user);
    step('qa_user', {status: UUID.test(user.coreUserId) ? 'PASS' : 'FAIL', email: user.emailMasked, id: user.coreUserId.slice(0, 8)});
    // 1. one valid exchange
    const first = await gw('/exchange', {token: user.sessions[0].accessToken, method: 'POST'});
    if (first.status === 200) { registerSecret(first.body.access_token); user.token = first.body.access_token; user.claims = decodeJwt(user.token); }
    step('exchange_valid', {status: first.status === 200 && first.body?.token_type === 'Bearer' ? 'PASS' : 'FAIL', http: first.status, error: first.body?.error ?? null});
    // 2. immediate re-exchanges (the R4.2 failure happened on the very next exchange)
    const re = [];
    for (let i = 0; i < rounds.reExchanges; i += 1) { const r = await gw('/exchange', {token: user.sessions[0].accessToken, method: 'POST'}); if (r.status === 200) { registerSecret(r.body.access_token); user.token = r.body.access_token; } re.push(r.status === 200 ? 200 : `${r.status} ${r.body?.error}`); }
    step('re_exchanges', {status: re.every((s) => s === 200) ? 'PASS' : 'FAIL', outcomes: [...new Set(re)], count: re.length});
    // 3. session-bound calls: every one runs the live /v1/session verdict inside the gateway (no cache)
    const sc = [];
    for (let i = 0; i < rounds.sessionCalls; i += 1) { const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: user.token, method: 'POST', body: {}}); sc.push(r.status === 200 ? 200 : `${r.status} ${r.body?.error}`); }
    step('session_calls', {status: sc.every((s) => s === 200) ? 'PASS' : 'FAIL', outcomes: [...new Set(sc)], count: sc.length});
    const unavailable = calls.filter((c) => c.error === 'CORE_UNAVAILABLE').length;
    step('no_core_unavailable', {status: unavailable === 0 ? 'PASS' : 'FAIL', unavailable, verdicts: calls.length, noStoreViolations: calls.filter((c) => !c.noStore).length, msMax: Math.max(...calls.map((c) => c.ms))});
    doc.status = 'PASS';
  } catch (e) {
    doc.aborted = String(e?.message ?? e).slice(0, 300); log(`minimal aborted: ${doc.aborted}`);
  } finally {
    if (user) {
      const live = user.sessions.at(-1);
      const logout = live ? await core.logout(live, 'global') : null;
      const del = await core.deleteUser(user);
      doc.cleanup.qa = del.deleted === true; doc.cleanup.sessions = [204, 401, 403].includes(logout);
      doc.cleanup.detail = {logout, ...del, id: user.coreUserId, lastSession: live?.sessionId ?? null};
      const rows = cleanupFixtures({baseline, orgs: [], identities: [user.claims?.sub].filter(Boolean), coreUserIds: [user.coreUserId], RUN});
      doc.cleanup.rows = rows.ok === true; doc.cleanup.rowsDetail = {ok: rows.ok, executed: rows.executed, planned: rows.planned, mismatches: rows.mismatches, error: rows.error};
      doc.cleanup.catalogUnchanged = catalogSHA256() === catalog;
    }
    doc.qaUsers = user ? [{role: 'probe', id: user.coreUserId, lastSession: user.sessions.at(-1)?.sessionId ?? null, deleted: doc.cleanup.qa}] : [];
    doc.complete = doc.cleanup.qa && doc.cleanup.sessions && doc.cleanup.rows && doc.cleanup.catalogUnchanged === true;
  }
  const evidencePath = writeEvidence('r4-minimal', doc, stamp);
  return {doc, artifact: artifact(evidencePath), evidencePath};
}
