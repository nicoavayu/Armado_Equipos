// R4.2 matrix producer: the REAL hybrid gateway (127.0.0.1:58431 → Core staging remote + Torneos
// REST/DB local) exercised block by block. Output: the R4.2.matrix.v1 document the certified
// runner validates (certify), plus detail/isolation/outage artifacts it hashes. Credentials arrive
// on stdin from the operator (never argv/env/disk); every persisted byte is checked against the
// run's known-secret registry. Fault injection touches only the run's own gateway namespace.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {r4, repo, evidence, runtime, root, d, dAsync, inspect, psql, psqlTry, sqlOne, lit, asRole, tableCounts, catalogSHA256, r2Snapshot, readJSON, registerSecret, containsSecret, knownCount, redact,
  guardedFetch, bridgeToken, tokenVariants, decodeJwt, decodeHeader, writeEvidence, artifact, fileSHA, log, Stop, GATEWAY, GATEWAY_ORIGIN, REST_ORIGIN, CORE_ORIGIN, CORE_REF, PROD_REF,
  DB_CONTAINER, ISOLATED_NETWORK, ROUTE_IMAGE, NODE_IMAGE_TAG, ISSUER, AUDIENCE, TTL, UUID} from './lib.mjs';
import {coreClient, assertAnonKey, assertServiceKey} from './core.mjs';
import {buildFixtures, entryState, lastReview, lastAudit, cleanupFixtures, createRunRegistry, ENTRY_NAMES} from './fixtures.mjs';
import {runOutageHarnessAsync} from './outage.mjs';
import {routeFault, normalizeHostRoute} from './route-fault.mjs';
import {REQUIRED_CASES} from '../r4/certification.mjs';

const P0 = 'review_tournament_team_entry';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pure assembly of the R4.2.matrix.v1 document the sealed runner validates (unit-tested). */
export function assembleMatrix({run, stamp, gatewayBundleSHA256, blocks, detail, cleanup, artifacts, outageTests = 0, gatewayResponses = 0}) {
  const caseArtifacts = (name) => name === 'isolation' ? [artifacts.isolation, artifacts.detail] : (['core_contract_unavailable', 'core_response_stale', 'core_auth_unavailable'].includes(name) ? [artifacts.detail, artifacts.outage] : [artifacts.detail]);
  const cases = blocks.filter((b) => !b.informative).map((b) => ({name: b.name, status: b.status, checks: b.checks.length, artifacts: caseArtifacts(b.name)}));
  const missing = REQUIRED_CASES.filter((n) => !cases.some((c) => c.name === n));
  return {schema: 'R4.2.matrix.v1', run, stamp, gatewayBundleSHA256, status: cases.every((c) => c.status === 'PASS') && missing.length === 0 && !detail.aborted ? 'PASS' : 'FAIL',
    cleanup: {qa: cleanup.qa === true, fixtures: cleanup.fixtures === true, sessions: false}, cases, missingRequired: missing,
    allowlistCovered: Object.keys(detail.dispatch ?? {}), gatedCovered: Object.keys(detail.gate ?? {}),
    informative: blocks.filter((b) => b.informative).map((b) => ({name: b.name, status: b.status, checks: b.checks.length})),
    totals: {blocks: blocks.length, checks: blocks.reduce((n, b) => n + b.checks.length, 0), failedChecks: blocks.reduce((n, b) => n + b.checks.filter((c) => !c.pass).length, 0), gatewayResponses, outageTests},
    liveContracts: detail.liveContracts ?? null, qaUsers: cleanup.detail?.users ?? []};
}

export async function runMatrix({stamp, anonKey, serviceKey, contractSecret}) {
  assertAnonKey(anonKey); assertServiceKey(serviceKey);
  registerSecret(anonKey); registerSecret(serviceKey); if (contractSecret) registerSecret(contractSecret);
  const state = readJSON(r4 + '/.runtime/run.json');
  const run = state.run;
  const RUN = run.replace('arma2-r42-', '').slice(0, 15);
  const ring = readJSON(repo + '/integration/torneos-isolated-local/.runtime/config.json');
  for (const v of [ring.dbPassword, ring.writerPassword, ring.adapterPassword, ...ring.keys.map((k) => k.privateKey)]) registerSecret(v);
  const K1 = ring.keys.find((k) => k.kid === ring.activeKid);
  const allowed = [...new Set(Object.values(readJSON(repo + '/backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json').features).flat())];
  const gated = readJSON(repo + '/backend/torneos/phase2d/staging-v1-rpc-gate.json').functions.map((f) => f.name);
  const http = guardedFetch([GATEWAY_ORIGIN, REST_ORIGIN, CORE_ORIGIN]);
  const core = coreClient({http, anonKey, serviceKey, run});

  // ───────── transport ─────────
  const noStore = {responses: 0, violations: [], classes: {}};
  async function gw(path, {token, method = 'GET', body, headers = {}} = {}) {
    const r = await http(`${GATEWAY}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000)});
    noStore.responses++;
    const cacheControl = r.headers['cache-control'] ?? null;
    const cls = `${path.split('?')[0]} | ${r.status} | ${typeof r.body?.error === 'string' ? r.body.error : ''}`;
    noStore.classes[cls] = {count:(noStore.classes[cls]?.count ?? 0)+1, cacheControl};
    if (!cacheControl?.includes('no-store')) noStore.violations.push({path,status:r.status,cacheControl});
    return r;
  }
  const rest = (path, {token, method = 'GET', body} = {}) => http(`${REST_ORIGIN}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
  async function exchange(user, session = user.sessions.at(-1)) {
    const r = await gw('/exchange', {token: session.accessToken, method: 'POST'});
    if (r.status !== 200) throw new Stop('EXCHANGE_FAILED', `${user.role} ${r.status} ${JSON.stringify(r.body)}`);
    registerSecret(r.body.access_token);
    user.token = r.body.access_token; user.tokenAt = Date.now(); user.claims = decodeJwt(user.token); user.identity = user.claims.sub;
    return r;
  }
  async function tok(user) { if (!user.token || Date.now() - user.tokenAt > 80_000) await exchange(user); return user.token; }
  const rpc = async (name, actor, params = {}) => gw(`/torneos/rest/v1/rpc/${name}`, {token: await tok(actor), method: 'POST', body: params});
  const identityOf = (user) => ({sub: user.identity, coreUserId: user.coreUserId, sessionId: user.sessions.at(-1).sessionId});

  // ───────── result model ─────────
  const blocks = [];
  const detail = {schema: 'R4.2.matrix-detail.v1', run, stamp, blocks};
  let current = null;
  function block(name, meta = {}) { current = {name, status: 'PASS', checks: [], ...meta}; blocks.push(current); log(`block ${name}`); return current; }
  async function check(name, fn) {
    try { const out = await fn(); current.checks.push({name, pass: true, detail: out ?? null}); }
    catch (e) { current.status = 'FAIL'; current.checks.push({name, pass: false, error: redact(String(e?.message ?? e)).slice(0, 600)}); log(`  FAIL ${name}: ${redact(String(e?.message ?? e)).slice(0, 200)}`); if(current.name !== 'cleanup') throw new Stop('MATRIX_STOP_ON_FAILURE',name); }
  }
  const assert = (ok, detail) => { if (!ok) throw new Error('ASSERT ' + JSON.stringify(detail ?? null).slice(0, 500)); };
  const eq = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), {label, actual: a, expected: b});
  const exercised = new Set();
  const cleanup = {qa: false, fixtures: false, sessions: false, sessionsLoggedOut: false, usersDeleted: false, detail: {}};
  const baseline = {counts: tableCounts(), catalogSHA256: catalogSHA256(), r2: r2Snapshot()};
  const users = {};
  let F = null, outage = null, isolationDoc = null;
  // Run registry: every fixture resource is journaled the moment it is created; cleanup scopes by it, not by F.
  const registry = createRunRegistry(RUN);
  const artifacts = {};

  try {
    // ═══════════════════════ QA users (Core staging, dedicated, per run) ═══════════════════════
    block('qa_users', {informative: true});
    await check('five dedicated synthetic QA users created on Core staging with purpose phase3b-r42', async () => {
      for (const role of ['owner', 'admin', 'member', 'outsider', 'captain']) { users[role] = await core.createUser(role); await core.login(users[role]); }
      return Object.values(users).map((u) => ({role: u.role, email: u.emailMasked, id: u.coreUserId.slice(0, 8), session: u.sessions[0].sessionId.slice(0, 8), aud: u.sessions[0].aud, iss: u.sessions[0].iss}));
    });
    if (current.status !== 'PASS') throw new Stop('QA_USERS_FAILED');
    const {owner, admin, member, outsider, captain} = users;

    // ═══════════════════════ AUTH / TOKEN ═══════════════════════
    block('exchange_valid');
    await check('POST /exchange with a live Core bearer → 200, RS256 p3b-k1, certified claim contract, identity allocated', async () => {
      const r = await exchange(owner);
      eq([r.body.token_type, r.body.expires_in], ['Bearer', TTL], 'token shape');
      const h = decodeHeader(owner.token), c = owner.claims;
      eq([h.alg, h.typ, h.kid], ['RS256', 'JWT', 'p3b-k1'], 'header');
      assert(UUID.test(c.sub) && c.core_user_id === owner.coreUserId && c.session_id === owner.sessions[0].sessionId && c.iss === ISSUER && c.aud === AUDIENCE && c.role === 'authenticated' && c.exp - c.iat === TTL && c.nbf === c.iat && UUID.test(c.jti), c);
      eq(sqlOne(`select count(*) from public.torneos_identity where id=${lit(c.sub)} and core_user_id=${lit(owner.coreUserId)}`), '1', 'identity row');
      const again = await exchange(owner);
      eq(again.body.token_type, 'Bearer'); eq(owner.claims.sub, c.sub, 'same identity on re-exchange');
      return {sub: c.sub.slice(0, 8), kid: h.kid, ttl: c.exp - c.iat};
    });
    await check('exchange without / with garbage / with unsigned Core-shaped bearer → 401; identity or role input → 400', async () => {
      const none = await gw('/exchange', {method: 'POST'});
      const garbage = await gw('/exchange', {method: 'POST', token: 'x.y.z'});
      const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const forgedCore = `${b64u({alg: 'none', typ: 'JWT'})}.${b64u({sub: owner.coreUserId, aud: 'authenticated', role: 'authenticated', iss: `${CORE_ORIGIN}/auth/v1`, session_id: owner.sessions[0].sessionId, exp: Math.floor(Date.now() / 1000) + 600})}.`;
      const forged = await gw('/exchange', {method: 'POST', token: forgedCore});
      const roleBody = await gw('/exchange', {method: 'POST', token: owner.sessions[0].accessToken, body: {role: 'service_role'}});
      eq([none.status, garbage.status, forged.status, roleBody.status], [401, 401, 401, 400]);
      return {none: none.body, forged: forged.body, roleBody: roleBody.body};
    });
    for (const u of [admin, member, outsider, captain]) await exchange(u);

    block('token_valid');
    await check('valid bridge bearer → allowlisted RPC 200 and table read through the proxy (own identity row only)', async () => {
      const r = await rpc('get_my_tournament_memberships', owner);
      eq(r.status, 200, r.body);
      const me = await gw('/torneos/rest/v1/torneos_identity?select=id', {token: await tok(owner)});
      eq([me.status, me.body.length, me.body[0]?.id], [200, 1, owner.identity], 'own row only');
      exercised.add('get_my_tournament_memberships');
      return {rpc: r.status, identityRows: me.body.length};
    });

    const variants = tokenVariants(ring, identityOf(owner));
    const variantCase = {wrong_issuer: ['wrong_issuer'], wrong_audience: ['wrong_audience'], wrong_kid: ['unknown_kid', 'standby_kid_p3b_k2'], expired: ['expired'],
      wrong_ttl: ['ttl_121', 'ttl_60', 'nbf_not_iat', 'iat_future'],
      claim_validation: ['role_service_role', 'role_anon', 'alg_none', 'typ_not_jwt', 'sub_not_uuid', 'core_user_id_not_uuid', 'session_id_not_uuid', 'jti_missing', 'session_id_missing', 'core_user_id_missing', 'garbage', 'empty']};
    for (const [caseName, names] of Object.entries(variantCase)) {
      block(caseName);
      for (const name of names) {
        const v = variants.find((x) => x.name === name);
        // The database contract (private.current_identity_id + PostgREST JWKS) covers claims and
        // signatures; typ and the session_id format are gateway-only checks (recorded, not asserted).
        const dbCovered = !['typ_not_jwt', 'session_id_not_uuid', 'empty'].includes(name);
        await check(`${name}: gateway RPC → 401${dbCovered ? ' and direct PostgREST → 401/403' : ' (gateway-only strictness; direct recorded)'}`, async () => {
          const g = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: v.token, method: 'POST', body: {}});
          const direct = await rest('/rpc/get_my_tournament_memberships', {token: v.token || undefined, method: 'POST', body: {}});
          eq(g.status, 401, {gateway: g.body}); eq(g.body?.error, 'access denied');
          if (dbCovered) assert([401, 403].includes(direct.status), {direct: direct.status, body: direct.body});
          return {gateway: g.status, direct: direct.status, directCode: direct.body?.code ?? null, dbCovered};
        });
      }
    }

    // ═══════════════════════ BINDING / REPLAY ═══════════════════════
    block('session_identity_binding');
    await check('valid signature, real identity, unknown Core session → 401 (Core session authority)', async () => {
      const t = bridgeToken(K1, {...identityOf(owner), sessionId: crypto.randomUUID()});
      const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq(r.status, 401, r.body); return r.body;
    });
    await check('owner identity bound to the outsider Core user/session → 401 (identity ≠ core_user_id)', async () => {
      const t = bridgeToken(K1, {sub: owner.identity, coreUserId: outsider.coreUserId, sessionId: outsider.sessions[0].sessionId});
      const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq(r.status, 401, r.body); return r.body;
    });
    await check('owner Core user with the admin live session id → 401 (session belongs to another user)', async () => {
      const t = bridgeToken(K1, {sub: owner.identity, coreUserId: owner.coreUserId, sessionId: admin.sessions[0].sessionId});
      const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq(r.status, 401, r.body); return r.body;
    });
    await check('unknown local identity with the owner Core user/session → 401', async () => {
      const t = bridgeToken(K1, {sub: crypto.randomUUID(), coreUserId: owner.coreUserId, sessionId: owner.sessions[0].sessionId});
      const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq(r.status, 401, r.body); return r.body;
    });

    // ═══════════════════════ FIXTURES (through the gateway; live verified_email acceptance) ═══════════════════════
    block('fixtures', {informative: true});
    await check('P0 fixture through the allowlisted RPCs with real Core sessions: org, 2 seasons, 2 tournaments in registration, seats, 7 submitted entries', async () => {
      F = await buildFixtures({rpc, actors: users, RUN, exercised, registry, accept: async (token) => rpc('accept_tournament_team_invitation', captain, {p_token: token})});
      return {org: F.org.slice(0, 8), org2: F.org2.slice(0, 8), entries: Object.keys(F.entries).length, acceptance: F.acceptance};
    });
    if (!F) throw new Stop('FIXTURES_FAILED');
    const live = F.acceptance.filter((a) => a.live).length;
    detail.liveContracts = {verified_email: live, seededAcceptances: F.acceptance.length - live};

    block('live_contracts', {informative: true});
    await check('verified_email: every manager acceptance was attested live by Core staging (no seeding)', async () => { eq(live, F.acceptance.length, F.acceptance); return {accepted: live}; });

    block('request_binding');
    const searchParams = {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_query: `r42 ${RUN}`, p_limit: 8, p_team_entry_id: null};
    const pending = () => sqlOne(`select count(*) from private.core_contract_attestations where identity_id=${lit(owner.identity)} and contract='directory_players' and consumed_at is null and expires_at > now()`);
    await check('directory_players through the gateway: Core attested → RPC consumed the attestation (live contract, 200)', async () => {
      const r = await rpc('search_tournament_players', owner, searchParams);
      eq(r.status, 200, r.body); exercised.add('search_tournament_players');
      eq(sqlOne(`select count(*) from private.core_contract_attestations where identity_id=${lit(owner.identity)} and contract='directory_players' and consumed_at is not null`) !== '0', true, 'consumed attestation exists');
      return {status: r.status, items: Array.isArray(r.body) ? r.body.length : r.body};
    });
    async function pendingAttestation() {
      // PostgREST refuses the unknown argument after the adapter attested → an unconsumed, 10 s attestation for the exact hash.
      const r = await rpc('search_tournament_players', owner, {...searchParams, p_extra: 1});
      assert([404, 400].includes(r.status) && r.body?.code?.startsWith('PGRST'), {status: r.status, body: r.body});
      assert(Number(pending()) >= 1, 'pending attestation exists');
      return r;
    }
    await check('attestation is bound to the request hash: same actor/session, different query → TORNEOS_CORE_ATTESTATION_REQUIRED', async () => {
      await pendingAttestation();
      const r = await rest('/rpc/search_tournament_players', {token: await tok(owner), method: 'POST', body: {...searchParams, p_query: `other ${RUN}`}});
      eq([r.status, r.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], r.body); return r.body;
    });
    await check('attestation is bound to the Core session: same identity+hash, another session id → REQUIRED', async () => {
      const t = bridgeToken(K1, {...identityOf(owner), sessionId: crypto.randomUUID()});
      const r = await rest('/rpc/search_tournament_players', {token: t, method: 'POST', body: searchParams});
      eq([r.status, r.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], r.body); return r.body;
    });
    await check('attestation is bound to the contract: same params on directory_teams → REQUIRED', async () => {
      const r = await rest('/rpc/search_tournament_arma2_teams', {token: await tok(owner), method: 'POST', body: {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_query: `r42 ${RUN}`, p_limit: 8}});
      eq([r.status, r.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], r.body); return r.body;
    });
    await check('exact identity+session+hash within TTL consumes the pending attestation → 200; a second use → REQUIRED (single use)', async () => {
      const ok = await rest('/rpc/search_tournament_players', {token: await tok(owner), method: 'POST', body: searchParams});
      eq(ok.status, 200, ok.body); eq(pending(), '0');
      const replay = await rest('/rpc/search_tournament_players', {token: await tok(owner), method: 'POST', body: searchParams});
      eq([replay.status, replay.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], replay.body);
      return {first: ok.status, replay: replay.body?.message};
    });
    await check('time binding: pending attestation older than 10 s → REQUIRED', async () => {
      await pendingAttestation();
      await sleep(11000);
      const r = await rest('/rpc/search_tournament_players', {token: await tok(owner), method: 'POST', body: searchParams});
      eq([r.status, r.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], r.body); return r.body;
    });

    block('replay');
    await check('attestation replay (consumed) → REQUIRED; no gateway path re-uses an attestation', async () => {
      const r = await rest('/rpc/search_tournament_players', {token: await tok(owner), method: 'POST', body: searchParams});
      eq([r.status, r.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], r.body); return r.body;
    });
    await check('Core nonce replay: the same signed /v1/session request twice → 200 then 401 REPLAY (operator-held HMAC, direct Core probe)', async () => {
      assert(contractSecret, 'contract secret not provided to the matrix');
      const path = '/v1/session', body = JSON.stringify({core_user_id: owner.coreUserId, session_id: owner.sessions.at(-1).sessionId});
      const time = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString('hex');
      const signature = crypto.createHmac('sha256', Buffer.from(contractSecret, 'hex')).update(`${path}\n${time}\n${nonce}\n`).update(body).digest('hex');
      const send = () => http(`${CORE_ORIGIN}/functions/v1/torneos-core-contract${path}`, {method: 'POST', headers: {'content-type': 'application/json', 'x-time': time, 'x-nonce': nonce, 'x-signature': signature, apikey: anonKey}, body});
      const first = await send(), second = await send();
      eq([first.status, first.body?.active, second.status, second.body?.error], [200, true, 401, 'REPLAY'], {first: first.body, second: second.body});
      return {first: first.status, second: second.body};
    });
    await check('a bridge bearer is a bearer within its 120 s TTL (two uses → 200, 200); revocation is session-bound (next block)', async () => {
      const t = await tok(owner);
      const a = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      const b = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq([a.status, b.status], [200, 200]); return {uses: 2};
    });

    // ═══════════════════════ SESSION AUTHORITY ═══════════════════════
    block('logout_revocation');
    await check('member: bearer 200 → GoTrue logout(local) → same bearer 401 ×3 immediately → old Core token cannot exchange', async () => {
      const before = await rpc('get_my_tournament_memberships', member); eq(before.status, 200, before.body);
      const t = member.token, coreSession = member.sessions.at(-1);
      eq(await core.logout(coreSession, 'local'), 204, 'logout');
      const results = [];
      for (let i = 0; i < 3; i++) { const t0 = Date.now(); const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}}); results.push({status: r.status, ms: Date.now() - t0}); }
      eq(results.map((r) => r.status), [401, 401, 401], results);
      const ex = await gw('/exchange', {method: 'POST', token: coreSession.accessToken});
      eq(ex.status, 401, ex.body);
      member.token = null;
      return {afterLogout: results, exchangeWithLoggedOutCoreToken: ex.status};
    });
    block('core_session_inactive');
    await check('nonexistent Core session (valid signature) → 401', async () => {
      const t = bridgeToken(K1, {...identityOf(owner), sessionId: crypto.randomUUID()});
      const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq(r.status, 401, r.body); return r.body;
    });
    await check('revoked session: member logs in twice; logout(others) from s2 → bearer bound to s1 401, bearer bound to s2 200', async () => {
      const s1 = await core.login(member); await exchange(member, s1); const t1 = member.token;
      const s2 = await core.login(member); await exchange(member, s2); const t2 = member.token;
      eq((await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t1, method: 'POST', body: {}})).status, 200, 's1 before');
      eq(await core.logout(s2, 'others'), 204, 'logout others');
      const r1 = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t1, method: 'POST', body: {}});
      const r2 = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t2, method: 'POST', body: {}});
      eq([r1.status, r2.status], [401, 200], {r1: r1.body, r2: r2.body});
      return {s1: r1.status, s2: r2.status};
    });
    await check('logged-out session id inside an otherwise valid bearer → 401 (no stale verdict)', async () => {
      const t = bridgeToken(K1, {sub: member.identity, coreUserId: member.coreUserId, sessionId: member.sessions[0].sessionId});
      const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq(r.status, 401, r.body); return r.body;
    });

    // ═══════════════════════ OUTAGES (live: run-owned routes; offline: real modules) ═══════════════════════
    const gwName = state.gateway;
    const internalNet = state.networks.find((n) => n.endsWith('-internal'));
    const proxyIP = inspect(state.proxy).NetworkSettings.Networks[internalNet].IPAddress;
    const dbIP = baseline.r2.db.networks[ISOLATED_NETWORK].IPAddress, restIP = baseline.r2.rest.networks[ISOLATED_NETWORK].IPAddress;
    // Route helpers run their docker children off the event loop (R4.2 20260920T230313Z: two spawnSync helpers
    // between the last response and the next dispatch let the ingress proxy close the pooled socket unseen).
    const {routes, withRouteRemoved} = routeFault({run, gateway: gwName, routes: state.routes, exec: dAsync});
    const originalRoutes = await routes();
    async function withCoreFault(mode, fn) {
      assert(['auth','contract'].includes(mode), mode);
      const ctl = (code) => d(['exec', state.proxy, 'node', '-e', code]);
      ctl(`require('fs').writeFileSync('/fault/mode','${mode}',{flag:'wx',mode:0o600})`);
      try { return await fn(); }
      finally { ctl("require('fs').unlinkSync('/fault/mode')"); }
    }
    // Recovery is a single observation, without retries.
    async function recovered(fn, want = 200) {
      const r = await fn(); eq(r.status, want, 'first request after fault removal'); return {status:r.status,attempt:1,attempts:[r.status]};
    }
    /** Transport failure in the REST fault block: capture run-owned state BEFORE cleanup removes the containers. */
    async function restFaultDiagnostics(e, extra = {}) {
      const diag = {at: new Date().toISOString(), error: redact(String(e?.message ?? e)).slice(0, 1500), ...extra};
      const containerState = async (name) => { try { const x = JSON.parse((await dAsync(['inspect', name])).stdout)[0]; return {id: x.Id.slice(0, 12), running: x.State.Running, status: x.State.Status, restartCount: x.RestartCount, startedAt: x.State.StartedAt, finishedAt: x.State.FinishedAt, exitCode: x.State.ExitCode, oomKilled: x.State.OOMKilled}; } catch (err) { return {error: redact(String(err?.message ?? err)).slice(0, 300)}; } };
      diag.gateway = await containerState(gwName); diag.proxy = await containerState(state.proxy);
      try { diag.routes = await routes(); diag.routesRestored = diag.routes === originalRoutes; } catch (err) { diag.routes = null; diag.routesError = redact(String(err?.message ?? err)).slice(0, 300); }
      try { const h = await gw('/health'); diag.health = {status: h.status, cacheControl: h.headers['cache-control']}; } catch (err) { diag.health = {error: redact(String(err?.message ?? err)).slice(0, 600)}; }
      return diag;
    }
    block('core_auth_unavailable');
    await check('Core Auth transport reset at run-owned proxy; ingress preserved: /health, exchange, RPC return gateway JSON 503; first recovery → 200', async () => {
      const t = await tok(owner); // issued while Core is reachable; the outage must not be masked by a re-exchange
      const during = await withCoreFault('auth', async () => {
        const h = await gw('/health'); const ex = await gw('/exchange', {method: 'POST', token: owner.sessions.at(-1).accessToken});
        const rp = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
        eq([h.body?.error,ex.body?.error,rp.body?.error],['access denied','access denied','access denied']);
        return {health: h.status, exchange: ex.status, rpc: rp.status, rpcBody: rp.body, fault:'auth transport reset', ingressPreserved:true};
      });
      eq([during.health, during.exchange, during.rpc], [503, 503, 503], during);
      eq(await routes(), originalRoutes, 'routes restored');
      const after = await recovered(() => gw('/health'));
      return {...during, recovery: after};
    });
    block('core_contract_unavailable');
    await check('offline harness: real gateway modules, contract 500/502/timeout → 503 CORE_UNAVAILABLE (see r4-outage artifact)', async () => {
      outage = await runOutageHarnessAsync({label: run});
      const names = outage.tests.map((t) => t.name);
      for (const n of ['core_contract_500', 'core_contract_502', 'core_contract_timeout']) assert(outage.tests.find((t) => t.name.startsWith(n))?.pass, n);
      assert(outage.pass, outage.tests.filter((t) => !t.pass));
      return {tests: names.length, pass: outage.pass, bundleSHA256: outage.bundleSHA256};
    });
    await check('live: with Core unreachable a verified bearer never reaches Torneos (503, no fallback)', async () => {
      const t = await tok(owner);
      const during = await withCoreFault('contract', async () => {
        const h = await gw('/health'); eq(h.status,200,'Auth and ingress remain reachable');
        return gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token:t,method:'POST',body:{}});
      });
      eq([during.status,during.body?.error],[503,'CORE_UNAVAILABLE'],during.body);
      eq(await routes(),originalRoutes,'Core fault never modifies routes');
      const recovery=await recovered(() => rpc('get_my_tournament_memberships',owner));
      return {status:during.status,body:during.body,cacheControl:during.headers['cache-control'],fault:'contract transport reset',ingressPreserved:true,recovery};
    });
    block('core_response_stale');
    await check('offline harness: stale / future / malformed / schema-violating / active:false contract responses → 503 CORE_UNAVAILABLE', async () => {
      for (const n of ['core_contract_stale', 'core_contract_future', 'core_contract_malformed_json', 'core_contract_schema_violation', 'core_contract_200_active_false']) assert(outage.tests.find((t) => t.name.startsWith(n))?.pass, n);
      return {covered: 5};
    });
    await check('offline harness: Core auth health 503 / user 500 → fail closed (503 / 401); Torneos DB unreachable → 503', async () => {
      for (const n of ['core_auth_health_503 (rpc)', 'core_auth_health_503 (/health)', 'core_auth_user_500', 'core_auth_user_401', 'exchange with active Core but Torneos DB unreachable', 'rpc with active Core but Torneos DB unreachable']) assert(outage.tests.find((t) => t.name.startsWith(n))?.pass, n);
      return {covered: 6};
    });
    block('torneos_rest_unavailable');
    await check('Torneos REST unreachable from the gateway namespace (REST /32 removed): verified bearer + live Core → 503 access denied no-store; restored → 200', async () => {
      const t = await tok(owner);
      let routesDuring = null, during;
      try {
        during = await withRouteRemoved(restIP, async (r) => {
          routesDuring = r;
          const rp = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
          const tbl = await gw('/torneos/rest/v1/torneos_identity?select=id', {token: t});
          return {rpc: rp.status, rpcBody: rp.body, rpcCacheControl: rp.headers['cache-control'] ?? null, table: tbl.status, routesDuring: r};
        });
      } catch (e) { detail.restUnavailableFailure = await restFaultDiagnostics(e, {routesDuring}); throw e; }
      // Certified wire contract for this call site only (README «Torneos REST unavailability», FINAL-BLOCKERS §2):
      // get_my_tournament_memberships is not in CONTRACTS, so the sealed gateway answers its passthrough failure with
      // 503 {"error":"access denied"} no-store. TORNEOS_UNAVAILABLE names the scenario (summary key), never a wire code.
      eq([during.rpc, during.table, during.rpcBody, during.rpcCacheControl], [503, 503, {error: 'access denied'}, 'no-store'], during);
      eq(await routes(), originalRoutes, 'routes restored');
      const after = await recovered(() => rpc('get_my_tournament_memberships', owner));
      return {...during, recovery: after};
    });

    // ═══════════════════════ ALLOWLIST / GATE ═══════════════════════
    const argsOf = {};
    for (const line of psql(`select proname||'|'||coalesce(pg_get_function_arguments(oid),'') from pg_proc where pronamespace='public'::regnamespace and proname = any(array[${[...allowed, ...gated].map(lit).join(',')}]) order by 1`).trim().split('\n').filter(Boolean)) {
      const [name, args] = line.split('|'); if (!argsOf[name]) argsOf[name] = args;
    }
    const nullArgs = (name) => Object.fromEntries((argsOf[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((p) => [p.split(/\s+/)[0], null]));
    const realArgs = {
      get_tournament_competition_context: {p_organization_id: F.org},
      get_tournament_teams_context: {p_organization_id: F.org, p_tournament_id: F.tournamentA}, get_team_registration_context: {p_organization_id: F.org, p_team_entry_id: F.entries.matrix.entry},
      has_tournament_season_access: {p_organization_id: F.org, p_season_id: F.seasonA}, has_tournament_season_capability: {p_organization_id: F.org, p_season_id: F.seasonA, p_capability: 'team_entries.review'},
      has_tournament_organization_capability: {p_organization_id: F.org, p_capability: 'team_entries.review'}, has_tournament_capability: {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_capability: 'team_entries.review'},
      is_tournament_organization_member: {p_organization_id: F.org}, is_tournament_organization_slug_available: {p_slug: `r42-free-${RUN}`}, tournament_role_capabilities: {p_role: 'owner'},
      get_tournament_creation_eligibility: {p_organization_id: F.org}, has_organization_consumed_free_tournament: {p_organization_id: F.org},
      can_read_tournament_team_entry: {p_organization_id: F.org, p_team_entry_id: F.entries.matrix.entry}, is_tournament_team_manager: {p_team_entry_id: F.entries.matrix.entry, p_require_edit: false},
      search_tournament_arma2_teams: {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_query: `r42 ${RUN}`, p_limit: 8},
    };
    const declared = (name) => new Set((argsOf[name] ?? '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean));
    for (const [name, params] of Object.entries(realArgs)) if (!Object.keys(params).every((k) => declared(name).has(k))) { detail.realArgsFallback = [...(detail.realArgsFallback ?? []), name]; delete realArgs[name]; }
    block('allowlist');
    const dispatch = {};
    await check('all 43 allowlisted RPCs dispatch through the gateway (none refused by the gateway; each reaches PostgREST or the Core-contract adapter)', async () => {
      const failed = [];
      for (const name of allowed) {
        const params = realArgs[name] ?? nullArgs(name);
        const r = await rpc(name, owner, params);
        const gatewayRefusal = r.status === 401 || (r.status === 403 && r.body?.error === 'rpc not enabled') || (r.status === 404 && r.body?.error === 'not found');
        const layer = r.body?.code ? 'postgrest' : (r.body?.error && /^TORNEOS_|^CORE_/.test(r.body.error) ? 'adapter' : (r.status === 200 ? 'postgrest' : 'unknown'));
        dispatch[name] = {status: r.status, code: r.body?.code ?? null, message: (r.body?.message ?? r.body?.error ?? '').slice(0, 80), layer, args: Object.keys(params).length, real: !!realArgs[name] || exercised.has(name)};
        if (gatewayRefusal || layer === 'unknown') failed.push({name, ...dispatch[name]});
        if (r.status === 200) exercised.add(name);
      }
      eq(failed, [], 'every allowlisted name dispatched');
      eq(Object.keys(dispatch).length, 43);
      return {dispatched: 43, executed200: Object.values(dispatch).filter((x) => x.status === 200).length, byLayer: Object.values(dispatch).reduce((a, x) => ({...a, [x.layer]: (a[x.layer] ?? 0) + 1}), {}), exercisedWithRealParams: [...exercised].sort()};
    });
    await check('directory_teams through the gateway → live Core contract attested and consumed (200)', async () => { eq(dispatch.search_tournament_arma2_teams?.status, 200, dispatch.search_tournament_arma2_teams); return dispatch.search_tournament_arma2_teams; });
    detail.dispatch = dispatch;
    block('gated');
    const gate = {};
    await check('33 gated RPCs: gateway POST → 403 rpc not enabled, gateway GET → 403; direct PostgREST anon → 42501 before body; direct authenticated → 42501 before body', async () => {
      const bad = [];
      for (const name of gated) {
        const post = await gw(`/torneos/rest/v1/rpc/${name}`, {token: await tok(owner), method: 'POST', body: nullArgs(name)});
        const get = await gw(`/torneos/rest/v1/rpc/${name}`, {token: await tok(owner)});
        const anon = await rest(`/rpc/${name}`, {method: 'POST', body: nullArgs(name)});
        const auth = await rest(`/rpc/${name}`, {token: await tok(owner), method: 'POST', body: nullArgs(name)});
        const before = (r) => [401, 403].includes(r.status) && r.body?.code === '42501' && /permission denied for function/.test(r.body?.message ?? '');
        gate[name] = {gatewayPost: post.status, gatewayGet: get.status, anon: anon.status, anonCode: anon.body?.code, auth: auth.status, authCode: auth.body?.code};
        if (!(post.status === 403 && post.body?.error === 'rpc not enabled' && get.status === 403 && get.body?.error === 'rpc not enabled' && before(anon) && before(auth))) bad.push({name, ...gate[name]});
      }
      eq(bad, [], 'gate holds for all 33'); eq(Object.keys(gate).length, 33);
      return {gated: 33};
    });
    await check('catalog: no gated function is executable by anon or authenticated; service_role keeps it; allowlist ∩ gate = ∅', async () => {
      const rows = psql(`select proname||'|'||has_function_privilege('anon', oid, 'EXECUTE')||'|'||has_function_privilege('authenticated', oid, 'EXECUTE')||'|'||has_function_privilege('service_role', oid, 'EXECUTE') from pg_proc where pronamespace='public'::regnamespace and proname = any(array[${gated.map(lit).join(',')}]) order by 1`).trim().split('\n');
      const leaks = rows.filter((l) => { const [, a, b] = l.split('|'); return a === 't' || b === 't'; });
      eq(leaks, []); eq(allowed.filter((n) => gated.includes(n)), []);
      return {functions: rows.length, serviceRoleKept: rows.filter((l) => l.split('|')[3] === 't').length};
    });
    detail.gate = gate;

    // ═══════════════════════ P0 review_tournament_team_entry ═══════════════════════
    block('p0_review_tournament_team_entry');
    const E = F.entries;
    const review = (actor, entry, decision, reason = 'R4.2 review reason', issues = [], organization = F.org) => rpc(P0, actor, {p_organization_id: organization, p_team_entry_id: entry, p_decision: decision, p_reason: reason, p_issues: issues});
    const unchanged = (before, after, label) => eq(after, before, `${label}: no partial writes`);
    await check('DENY (403 TORNEOS_RESOURCE_FORBIDDEN, zero writes): admin without seat; seated admin cross-season (approve/changes/reject); other-workspace owner with entry org / own org; owner with foreign org; anon → 401', async () => {
      const before = entryState(E.matrix.entry), beforeBravo = entryState(E.bravo.entry);
      const cases = [
        ['admin unassigned (member, no season seat)', await review(member, E.matrix.entry, 'approved')],
        ['admin seated on season A reviews a season B entry: approve', await review(admin, E.bravo.entry, 'approved')],
        ['admin seated on season A, changes_requested on season B entry', await review(admin, E.bravo.entry, 'changes_requested')],
        ['admin seated on season A, rejected on season B entry', await review(admin, E.bravo.entry, 'rejected')],
        ['other workspace owner with the entry org id', await review(outsider, E.matrix.entry, 'approved')],
        ['other workspace owner with their own org id', await review(outsider, E.matrix.entry, 'approved', undefined, [], F.org2)],
        ['owner with a foreign org id', await review(owner, E.matrix.entry, 'approved', undefined, [], F.org2)],
      ];
      const out = [];
      for (const [label, r] of cases) { out.push({label, status: r.status, message: r.body?.message}); assert(r.status === 403 && r.body?.message === 'TORNEOS_RESOURCE_FORBIDDEN', {label, r: r.body}); }
      const anon = await gw(`/torneos/rest/v1/rpc/${P0}`, {method: 'POST', body: {}}); eq(anon.status, 401, anon.body);
      unchanged(before, entryState(E.matrix.entry), 'matrix'); unchanged(beforeBravo, entryState(E.bravo.entry), 'bravo');
      return out;
    });
    await check('invalid payload (22023 TORNEOS_INVALID_REVIEW, zero writes): unknown decision, short/long reason, non-array issues; missing entry → forbidden', async () => {
      const before = entryState(E.matrix.entry);
      const cases = [['decision maybe', await review(owner, E.matrix.entry, 'maybe')], ['reason too short', await review(owner, E.matrix.entry, 'approved', 'no')], ['reason too long', await review(owner, E.matrix.entry, 'approved', 'x'.repeat(1201))], ['issues object', await review(owner, E.matrix.entry, 'changes_requested', 'valid reason', {code: 'x'})]];
      for (const [label, r] of cases) assert(r.status === 400 && r.body?.message === 'TORNEOS_INVALID_REVIEW', {label, r: r.body});
      const missing = await review(owner, crypto.randomUUID(), 'approved'); eq([missing.status, missing.body?.message], [403, 'TORNEOS_RESOURCE_FORBIDDEN']);
      unchanged(before, entryState(E.matrix.entry), 'invalid payload');
      return cases.map(([label, r]) => ({label, status: r.status}));
    });
    await check('invalid roster (goalkeeper removed after submission): approve → 23514 TORNEOS_ROSTER_INCOMPLETE with detail, zero writes; changes_requested → 200', async () => {
      psql(`update public.tournament_roster_players set status='removed', removed_at=now() where team_entry_id=${lit(E.invalid.entry)} and is_goalkeeper`);
      const before = entryState(E.invalid.entry); eq(before.players.filter((p) => p.status === 'active').length, 4);
      const r = await review(owner, E.invalid.entry, 'approved');
      eq([r.body?.code, r.body?.message], ['23514', 'TORNEOS_ROSTER_INCOMPLETE'], r.body);
      const det = JSON.parse(r.body.details); eq([det.valid, [...det.errors].sort()], [false, ['minimum_goalkeepers', 'minimum_players']]);
      unchanged(before, entryState(E.invalid.entry), 'invalid roster');
      const cr = await review(owner, E.invalid.entry, 'changes_requested', 'Falta arquero', [{code: 'minimum_goalkeepers'}]);
      eq([cr.status, cr.body?.status], [200, 'changes_requested'], cr.body);
      return {approve: r.status, errors: det.errors, changesRequested: cr.status};
    });
    const expectAudit = (entry, decision, actor, rosterId, issueCount, tournament) => {
      const a = lastAudit(entry);
      eq([a.action, a.resource_type, a.resource_id, a.team_entry_id, a.tournament_id, a.actor_user_id, a.actor_type, a.metadata], ['team_entry.' + decision, 'team_entry', entry, entry, tournament, actor, 'user', {rosterId, issueCount}], 'audit row');
      const v = lastReview(entry); eq([v.decision, v.created_by, v.roster_id, v.organization_id], [decision, actor, rosterId, F.org], 'review row');
      return v;
    };
    await check('approve (owner): 200, entry+roster approved, pending players → eligible, review + audit rows correct; second review refused', async () => {
      const before = entryState(E.approve.entry);
      const r = await review(owner, E.approve.entry, 'approved', 'Plantel completo');
      eq(r.status, 200, r.body); eq([r.body.entryId, r.body.rosterId, r.body.status, r.body.validation.valid], [E.approve.entry, E.approve.roster, 'approved', true]);
      const after = entryState(E.approve.entry);
      assert(after.entry.status === 'approved' && after.entry.reviewed_by === owner.identity && after.entry.approved_at && after.entry.reviewed_at && after.entry.rejected_at === null, after.entry);
      eq(after.rosters.map((x) => [x.status, !!x.approved_at]), [['approved', true]]); eq(after.players.map((p) => p.eligibility), ['eligible', 'eligible', 'eligible', 'eligible', 'eligible']);
      eq([after.reviews, after.audit], [before.reviews + 1, before.audit + 1]);
      const v = expectAudit(E.approve.entry, 'approved', owner.identity, E.approve.roster, 0, F.tournamentA); eq([v.reason, v.issues], ['Plantel completo', []]);
      const again = await review(owner, E.approve.entry, 'approved'); eq([again.status, again.body?.message], [403, 'TORNEOS_RESOURCE_FORBIDDEN']);
      exercised.add(P0);
      return {status: r.status, audit: 'team_entry.approved'};
    });
    await check('changes_requested (owner): 200, entry and roster changes_requested, no approval timestamps, issues persisted and counted; roster editable again', async () => {
      const issues = [{code: 'shirt_number', playerShirt: 3}, {code: 'name'}];
      const r = await review(owner, E.changes.entry, 'changes_requested', 'Revisar dorsal y nombre', issues);
      eq([r.status, r.body?.status, r.body?.validation], [200, 'changes_requested', null], r.body);
      const after = entryState(E.changes.entry);
      assert(after.entry.status === 'changes_requested' && after.entry.reviewed_by === owner.identity && after.entry.approved_at === null && after.entry.rejected_at === null, after.entry);
      eq(after.rosters.map((x) => x.status), ['changes_requested']);
      const v = expectAudit(E.changes.entry, 'changes_requested', owner.identity, E.changes.roster, 2, F.tournamentA); eq(v.issues, issues);
      const p = sqlOne(`select id from public.tournament_roster_players where team_entry_id=${lit(E.changes.entry)} and shirt_number=3`);
      const upd = await rpc('update_tournament_roster_player', owner, {p_organization_id: F.org, p_team_entry_id: E.changes.entry, p_roster_player_id: p, p_shirt_number: 13, p_primary_position: 'MED', p_secondary_position: null, p_is_goalkeeper: false});
      eq(upd.status, 200, upd.body); exercised.add('update_tournament_roster_player');
      return {status: r.status, rosterEditable: upd.status};
    });
    await check('reject (owner): 200, rejected_at set, roster stays submitted, review + audit rows correct', async () => {
      const r = await review(owner, E.reject.entry, 'rejected', 'No cumple');
      eq([r.status, r.body?.status], [200, 'rejected'], r.body);
      const after = entryState(E.reject.entry);
      assert(after.entry.status === 'rejected' && after.entry.rejected_at && after.entry.approved_at === null && after.entry.reviewed_by === owner.identity, after.entry);
      eq(after.rosters.map((x) => x.status), ['submitted']);
      expectAudit(E.reject.entry, 'rejected', owner.identity, E.reject.roster, 0, F.tournamentA);
      return {status: r.status};
    });
    await check('approve (admin seated on the entry season, real Core session): 200; audit actor is the admin identity', async () => {
      const r = await review(admin, E.admin.entry, 'approved', 'Plantel completo (admin)');
      eq([r.status, r.body?.status], [200, 'approved'], r.body);
      expectAudit(E.admin.entry, 'approved', admin.identity, E.admin.roster, 0, F.tournamentA);
      return {status: r.status, actor: 'admin'};
    });

    // ═══════════════════════ RLS / TENANCY ═══════════════════════
    block('cross_user');
    await check('outsider reads the org members table through the proxy → [] ; owner → rows; identities: each actor sees only its own row', async () => {
      const o = await gw(`/torneos/rest/v1/tournament_organization_members?organization_id=eq.${F.org}&select=id`, {token: await tok(outsider)});
      const w = await gw(`/torneos/rest/v1/tournament_organization_members?organization_id=eq.${F.org}&select=id`, {token: await tok(owner)});
      const ids = await gw('/torneos/rest/v1/torneos_identity?select=id', {token: await tok(outsider)});
      eq([o.status, o.body.length, w.status, w.body.length >= 3, ids.body.length, ids.body[0]?.id], [200, 0, 200, true, 1, outsider.identity], {o: o.body, w: w.body, ids: ids.body});
      eq(sqlOne('select count(*) from public.torneos_identity') !== '1', true, 'several identities exist');
      return {outsiderRows: 0, ownerRows: w.body.length};
    });
    block('cross_workspace');
    await check('outsider: tournaments/entries of the other workspace filtered ([]); workspace/teams context refused; owner sees them', async () => {
      const t = await gw(`/torneos/rest/v1/tournaments?organization_id=eq.${F.org}&select=id`, {token: await tok(outsider)});
      const e = await gw(`/torneos/rest/v1/tournament_team_entries?organization_id=eq.${F.org}&select=id`, {token: await tok(outsider)});
      const tw = await gw(`/torneos/rest/v1/tournaments?organization_id=eq.${F.org}&select=id`, {token: await tok(owner)});
      const ctx = await rpc('get_tournament_teams_context', outsider, {p_organization_id: F.org, p_tournament_id: F.tournamentA});
      const ctxOwner = await rpc('get_tournament_teams_context', owner, {p_organization_id: F.org, p_tournament_id: F.tournamentA});
      eq([t.body.length, e.body.length, tw.body.length, ctxOwner.status], [0, 0, 2, 200], {t: t.body, e: e.body, ctx: ctx.body});
      assert(ctx.status !== 200 || ctx.body === null || (typeof ctx.body === 'object' && Object.keys(ctx.body).length === 0), {ctx: ctx.status, body: ctx.body});
      return {outsiderTournaments: 0, outsiderEntries: 0, ownerTournaments: 2, outsiderTeamsContext: ctx.status};
    });
    block('cross_season');
    await check('season scope: seated admin has season A access, not season B; member without seat has neither; owner both; teams context follows the seat', async () => {
      const access = async (u, season) => (await rpc('has_tournament_season_access', u, {p_organization_id: F.org, p_season_id: season})).body;
      const m = {adminA: await access(admin, F.seasonA), adminB: await access(admin, F.seasonB), memberA: await access(member, F.seasonA), memberB: await access(member, F.seasonB), ownerA: await access(owner, F.seasonA), ownerB: await access(owner, F.seasonB)};
      eq(m, {adminA: true, adminB: false, memberA: false, memberB: false, ownerA: true, ownerB: true});
      const ctxB = await rpc('get_tournament_teams_context', admin, {p_organization_id: F.org, p_tournament_id: F.tournamentB});
      const ctxA = await rpc('get_tournament_teams_context', admin, {p_organization_id: F.org, p_tournament_id: F.tournamentA});
      eq(ctxA.status, 200, ctxA.body); assert(ctxB.status !== 200 || ctxB.body === null || Object.keys(ctxB.body ?? {}).length === 0, ctxB.body);
      return {...m, adminTeamsContextA: ctxA.status, adminTeamsContextB: ctxB.status};
    });

    // ═══════════════════════ NO CACHE ═══════════════════════
    block('no_cache');
    await check('every gateway response carried cache-control: no-store; revocations and outages took effect on the very next request (no cached verdict, no stale failure)', async () => {
      eq(noStore.violations, []); assert(noStore.responses > 100, noStore.responses);
      const keys=Object.keys(noStore.classes);
      const coverage={health:keys.some(k=>k.startsWith('/health | 200')),exchange:keys.some(k=>k.startsWith('/exchange | 200')),
        restSuccess:keys.some(k=>k.startsWith('/torneos/rest/')&&k.includes(' | 200 |')),
        rest401:keys.some(k=>k.startsWith('/torneos/rest/')&&k.includes(' | 401 |')),
        rest403:keys.some(k=>k.startsWith('/torneos/rest/')&&k.includes(' | 403 |')),
        rest503:keys.some(k=>k.startsWith('/torneos/rest/')&&k.includes(' | 503 |')),
        CORE_UNAVAILABLE:keys.some(k=>k.endsWith(' | 503 | CORE_UNAVAILABLE')),
        TORNEOS_UNAVAILABLE:blocks.find(b=>b.name==='torneos_rest_unavailable')?.status==='PASS'};
      assert(Object.values(coverage).every(Boolean),coverage);
      return {responses: noStore.responses, violations: 0, coverage, classes:noStore.classes,
        torneosUnavailableWireCode:'access denied'};
    });

    // ═══════════════════════ SECRET BOUNDARY + ISOLATION ═══════════════════════
    block('secret_boundary');
    await check('no known secret (HMAC, Core keys, QA passwords, Core tokens, bridge bearers, ring keys, DB logins) in docker inspect / process args / logs / evidence / r42 runtime', async () => {
      const inspectText = d(['inspect', gwName, state.proxy]).stdout;
      const top = d(['top', gwName, '-eo', 'pid,args']).stdout;
      const logs = d(['logs', gwName], {ok: true}); const plogs = d(['logs', state.proxy], {ok: true});
      const files = [...fs.readdirSync(evidence).filter((f) => f.startsWith('r4-')).map((f) => evidence + '/' + f), ...(fs.existsSync(runtime) ? fs.readdirSync(runtime).map((f) => runtime + '/' + f) : []), r4 + '/.runtime/run.json'];
      const leaks = [];
      if (containsSecret(inspectText)) leaks.push('docker inspect'); if (containsSecret(top)) leaks.push('process args');
      if (containsSecret((logs.stdout ?? '') + (logs.stderr ?? '') + (plogs.stdout ?? '') + (plogs.stderr ?? ''))) leaks.push('logs');
      for (const f of files) if (containsSecret(fs.readFileSync(f, 'utf8'))) leaks.push(f);
      eq(leaks, []);
      const gwi = inspect(gwName);
      const envNames = gwi.Config.Env.map((s) => s.split('=')[0]);
      assert(!envNames.some((n) => /SECRET|PASSWORD|KEY|TOKEN|CORE_|TORNEOS_/.test(n)), envNames);
      return {envNames, scannedFiles: files.length, knownSecrets: knownCount()};
    });
    block('isolation');
    const authorization = readJSON(r4 + '/.runtime/authorization.json');
    isolationDoc = {schema: 'R4.2.isolation.v1', run, stamp, checks: []};
    const iso = async (name, fn) => { await check(name, async () => { const r = await fn(); isolationDoc.checks.push({name, pass: true, detail: r}); return r; }); if (!current.checks.at(-1).pass) isolationDoc.checks.push({name, pass: false, error: current.checks.at(-1).error}); };
    await iso('gateway container: no published ports, internal networks only, ALL caps dropped, read-only rootfs, no docker socket, tmpfs custody; proxy publishes 127.0.0.1:58431 only, ip_forward=0', async () => {
      const g = inspect(gwName), p = inspect(state.proxy);
      eq(Object.keys(g.HostConfig.PortBindings ?? {}), []); eq(g.HostConfig.CapDrop, ['ALL']); eq(g.HostConfig.ReadonlyRootfs, true);
      assert(g.HostConfig.SecurityOpt?.includes('no-new-privileges'), g.HostConfig.SecurityOpt);
      assert(!g.Mounts.some((m) => /docker\.sock/.test(m.Source ?? '')), g.Mounts.map((m) => m.Source));
      eq(Object.keys(g.NetworkSettings.Networks).sort(), [internalNet, ISOLATED_NETWORK].sort());
      eq(p.HostConfig.PortBindings, {'9000/tcp': [{HostIp: '127.0.0.1', HostPort: '58431'}]}); eq(p.HostConfig.Sysctls, {'net.ipv4.ip_forward': '0'});
      eq(Object.keys(p.NetworkSettings.Networks).sort(), state.networks.slice().sort());
      const lsof = d(['ps', '--filter', 'publish=58431', '--format', '{{.Ports}}']).stdout.trim();
      assert(lsof.includes('127.0.0.1:58431') && !lsof.includes('0.0.0.0'), lsof);
      return {gatewayNetworks: Object.keys(g.NetworkSettings.Networks), proxyPorts: p.HostConfig.PortBindings, dockerPorts: lsof, gatewayTmpfs: g.HostConfig.Tmpfs};
    });
    await iso('gateway routes: exactly DB /32, REST /32, proxy /32 and unreachable IPv4/IPv6 defaults', async () => {
      const text = await routes();
      const v4 = text.split('---')[0].trim().split('\n').filter(Boolean), v6 = text.split('---')[1].trim().split('\n').filter(Boolean);
      const dsts = v4.filter((l) => !l.startsWith('unreachable')).map((l) => normalizeHostRoute(l.split(' ')[0])).sort();
      eq(dsts, [dbIP + '/32', restIP + '/32', proxyIP + '/32'].sort(), v4);
      assert(v4.some((l) => l.startsWith('unreachable default')) && v6.some((l) => l.startsWith('unreachable default')), {v4, v6});
      return {v4, v6};
    });
    await iso('from inside the gateway namespace: Production / other ref / google / github / npm / esm / deno.land pinned to TEST-NET-1 and unreachable; public IPs and host bridges unreachable; DNS answers nothing; only proxy, REST and DB connect', async () => {
      const script = `const net=require('net'),dns=require('dns'),tls=require('tls');const out={};
const tcp=(h,p)=>new Promise(r=>{const s=net.connect({host:h,port:p});const t=setTimeout(()=>{s.destroy();r('TIMEOUT')},2500);s.on('connect',()=>{clearTimeout(t);s.destroy();r('CONNECTED')});s.on('error',e=>{clearTimeout(t);r(e.code||'ERR')})});
const look=h=>new Promise(r=>dns.lookup(h,{family:4},(e,a)=>r(e?e.code:a)));
(async()=>{for(const h of ['rcyuuoaqfwcembdajcss.supabase.co','abcdefghijklmnopqrst.supabase.co','google.com','github.com','registry.npmjs.org','esm.sh','deno.land'])out['pinned_'+h]={resolved:await look(h),tcp443:await tcp(h,443)};
for(const [h,p] of [['1.1.1.1',443],['8.8.8.8',53],['192.0.2.1',443],[process.argv[1],443],[process.argv[2],80]])out['deny_'+h+':'+p]=await tcp(h,p);
dns.setServers(['127.0.0.11']);out.dns_127_0_0_11=await new Promise(r=>{const t=setTimeout(()=>r('TIMEOUT'),3000);dns.resolve4('example.org',(e,a)=>{clearTimeout(t);r(e?e.code:'RECORDS_'+a.length)})});
out.allow_proxy=await tcp(process.argv[3],443);out.allow_rest=await tcp(process.argv[4],3000);out.allow_db=await tcp(process.argv[5],5432);
out.proxy_host_production=await new Promise(r=>{const s=tls.connect({host:process.argv[3],port:443,servername:'hhyvmhgpapyuzjgxfnqv.supabase.co',rejectUnauthorized:false});const t=setTimeout(()=>{s.destroy();r('TIMEOUT')},4000);s.on('secureConnect',()=>s.write('GET /auth/v1/health HTTP/1.1\\r\\nHost: rcyuuoaqfwcembdajcss.supabase.co\\r\\nConnection: close\\r\\n\\r\\n'));let b='';s.on('data',c=>b+=c);s.on('end',()=>{clearTimeout(t);r(b.split('\\r\\n')[0])});s.on('error',e=>{clearTimeout(t);r(e.code||'ERR')})});
out.proxy_sni_google=await new Promise(r=>{const s=tls.connect({host:process.argv[3],port:443,servername:'google.com',rejectUnauthorized:false});const t=setTimeout(()=>{s.destroy();r('TIMEOUT')},4000);s.on('secureConnect',()=>{clearTimeout(t);s.destroy();r('SNI_ACCEPTED')});s.on('error',e=>{clearTimeout(t);r('TLS_REJECTED')});s.on('close',()=>{clearTimeout(t);r('TLS_REJECTED')})});
console.log(JSON.stringify(out))})();`;
      const isolatedNet = JSON.parse(d(['network', 'inspect', ISOLATED_NETWORK]).stdout)[0];
      const hostGw = baseline.r2.db.networks[ISOLATED_NETWORK].Gateway || isolatedNet.IPAM.Config[0].Gateway, proxyGw = JSON.parse(d(['network', 'inspect', internalNet]).stdout)[0].IPAM.Config[0].Gateway;
      const nodeImage = JSON.parse(d(['image', 'inspect', NODE_IMAGE_TAG]).stdout)[0].Id;
      const r = d(['run', '--rm', '--pull', 'never', '--label', 'arma2.r4.run=' + run, '--network', 'container:' + gwName, '--cap-drop', 'ALL', '--read-only', '--security-opt', 'no-new-privileges', nodeImage, 'node', '-e', script, hostGw, proxyGw, proxyIP, restIP, dbIP], {timeout: 90000});
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      for (const [k, v] of Object.entries(out)) {
        if (k.startsWith('pinned_')) assert(v.resolved === '192.0.2.1' && v.tcp443 !== 'CONNECTED', {k, v});
        if (k.startsWith('deny_')) assert(v !== 'CONNECTED', {k, v});
      }
      assert(!String(out.dns_127_0_0_11).startsWith('RECORDS_'), out.dns_127_0_0_11);
      eq([out.allow_proxy, out.allow_rest, out.allow_db], ['CONNECTED', 'CONNECTED', 'CONNECTED']);
      assert(/ 403 /.test(out.proxy_host_production), out.proxy_host_production); eq(out.proxy_sni_google, 'TLS_REJECTED');
      return out;
    });
    await iso('Core is reached only through the proxy with the exact staging origin; gateway config names no Production, no Core database, no service role; Torneos data plane is local', async () => {
      const cfg = await gw('/config');
      eq([cfg.status, cfg.body.coreUrl, cfg.body.torneosUrl, cfg.body.anonKey], [200, CORE_ORIGIN, `${GATEWAY}/torneos`, '']);
      eq(assertAnonKey(authorization.coreAnonKey) !== undefined, true, 'authorized Core key is a public anon/publishable key');
      assert(!/service_role|sb_secret_/.test(authorization.coreAnonKey), 'not a service key');
      const src = fs.readFileSync(r4 + '/custody.ts', 'utf8');
      assert(src.includes(`CORE_CONTRACT_URL:'https://${CORE_REF}.supabase.co/functions/v1/torneos-core-contract'`) && src.includes("TORNEOS_REST_URL:'http://torneos-rest:3000'") && src.includes('@torneos-db:5432/postgres') && !src.includes(PROD_REF), 'custody targets');
      eq(sqlOne('select count(*) from pg_foreign_server'), '0'); eq(sqlOne("select count(*) from pg_extension where extname in ('dblink','postgres_fdw')"), '0');
      return {config: cfg.body, foreignServers: 0, fdwExtensions: 0, coreKeyKind: assertAnonKey(authorization.coreAnonKey)};
    });
    await iso('no second login: Core user credentials exist only in this producer; the gateway container env/args carry none; Core sessions were created by GoTrue password grant here, never by the gateway', async () => {
      const inspectText = d(['inspect', gwName]).stdout + d(['top', gwName, '-eo', 'pid,args']).stdout;
      assert(!Object.values(users).some((u) => inspectText.includes(u.password) || inspectText.includes(u.email)), 'no QA credential in gateway');
      return {qaUsers: Object.keys(users).length};
    });
    await iso('dependencies: the gateway bundle is the prepared eszip (sha256 pinned by run.json); the gateway has no route to any registry; cache mounted read-only', async () => {
      const g = inspect(gwName);
      eq(fileSHA(r4 + '/.runtime/gateway.eszip'), state.gatewayBundleSHA256);
      const cache = g.Mounts.find((m) => m.Destination === '/cache'); assert(cache && cache.RW === false, cache);
      assert(g.Args.join(' ').includes('gateway.eszip'), g.Args);
      return {bundle: state.gatewayBundleSHA256, cacheRW: cache.RW, args: g.Args.join(' ').slice(0, 200)};
    });
    await iso('Production is impossible from the gateway: DNS pinned to TEST-NET-1, no route, proxy Host allowlist, config validators refuse the ref', async () => {
      const cfgSrc = fs.readFileSync(repo + '/backend/torneos/supabase/functions/torneos-gateway/config.ts', 'utf8');
      assert(cfgSrc.includes('names Production') && cfgSrc.includes('PRODUCTION_REF'), 'config validators');
      const hosts = d(['exec', gwName, 'cat', '/etc/hosts'], {ok: true}).stdout;
      assert(hosts.includes(`192.0.2.1\t${PROD_REF}.supabase.co`) || hosts.includes(`192.0.2.1 ${PROD_REF}.supabase.co`) || /192\.0\.2\.1\s+rcyuuoaqfwcembdajcss/.test(hosts), hosts);
      return {productionPinned: true};
    });
  } catch (e) {
    log(`matrix aborted: ${redact(String(e?.message ?? e))}`);
    detail.aborted = redact(String(e?.message ?? e)).slice(0, 500);
    if (current && current.status === 'PASS') { current.status = 'FAIL'; current.checks.push({name: 'aborted', pass: false, error: detail.aborted}); }
  } finally {
    // ═══════════════════════ CLEANUP (always) ═══════════════════════
    block('cleanup', {informative: true});
    await check('a bridge bearer issued before deletion is refused after the QA users are gone (no stale session)', async () => {
      const u = users.owner; if (!u?.sessions?.length) return 'skipped';
      const t = bridgeToken(K1, identityOf(u)); u.preDeleteBearer = t; return 'issued';
    });
    await check('Core: every QA session logged out (scope=global)', async () => {
      const out = {};
      for (const u of Object.values(users)) { const live = u.sessions.at(-1); if (!live) continue; out[u.role] = await core.logout(live, 'global'); }
      cleanup.sessionsLoggedOut = Object.values(out).every((s) => [204, 401, 403].includes(s));
      assert(cleanup.sessionsLoggedOut, out); return out;
    });
    await check('Core: every QA user hard-deleted after an identity/purpose guard (only users this run created)', async () => {
      const out = {};
      for (const u of Object.values(users)) out[u.role] = await core.deleteUser(u);
      cleanup.usersDeleted = Object.keys(users).length > 0 && Object.values(out).every((r) => r.deleted);
      cleanup.qa = cleanup.usersDeleted; cleanup.detail.users = Object.values(users).map((u) => ({role: u.role, email: u.emailMasked, id: u.coreUserId, lastSession: u.sessions.at(-1)?.sessionId ?? null, ...out[u.role]}));
      assert(cleanup.qa, out); return out;
    });
    await check('pre-deletion bearer → 401 through the gateway', async () => {
      const t = users.owner?.preDeleteBearer; if (!t) return 'skipped';
      const r = await gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token: t, method: 'POST', body: {}});
      eq(r.status, 401, r.body); return r.status;
    });
    await check('Torneos: every row this run created removed (count-verified against the pre-run baseline, one transaction); catalog SHA unchanged', async () => {
      const identities = Object.values(users).map((u) => u.identity).filter(Boolean);
      const coreIds = Object.values(users).map((u) => u.coreUserId);
      const res = cleanupFixtures({baseline: baseline.counts, orgs: registry.orgs, identities, coreUserIds: coreIds, RUN});
      cleanup.fixtures = res.ok; cleanup.detail.fixtures = {ok: res.ok, executed: res.executed, planned: res.planned, mismatches: res.mismatches, unplanned: res.unplanned, error: res.error, scope: res.scope};
      cleanup.detail.registry = {fixturesCompleted: F !== null, counts: registry.counts(), orgs: registry.orgs};
      assert(res.ok, cleanup.detail.fixtures);
      eq(catalogSHA256(), baseline.catalogSHA256, 'catalog unchanged');
      return {tables: res.planned?.length ?? 0};
    });
    if (state.routes) { try { const now = await routes(); cleanup.detail.routesRestored = now === originalRoutes; } catch { cleanup.detail.routesRestored = null; } }
  }

  // ───────── artifacts ─────────
  const outageDoc = outage ?? {status: 'NOT_RUN'};
  artifacts.outage = artifact(writeEvidence('r4-outage', {...outageDoc, run, stamp}, stamp));
  artifacts.isolation = artifact(writeEvidence('r4-isolation', isolationDoc ?? {schema: 'R4.2.isolation.v1', run, stamp, checks: [], status: 'NOT_RUN'}, stamp));
  detail.cleanup = cleanup; detail.noStore = noStore; detail.baseline = {catalogSHA256: baseline.catalogSHA256, r2: {db: baseline.r2.db.id, rest: baseline.r2.rest.id}};
  artifacts.detail = artifact(writeEvidence('r4-matrix-detail', detail, stamp));
  const matrix = assembleMatrix({run, stamp, gatewayBundleSHA256: state.gatewayBundleSHA256, blocks, detail, cleanup, artifacts, outageTests: outage?.tests?.length ?? 0, gatewayResponses: noStore.responses});
  return {matrix, cleanup, artifacts};
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  let s = ''; for await (const c of process.stdin) s += c;
  const input = JSON.parse(s); s = '';
  const result = await runMatrix(input);
  process.stdout.write(redact(JSON.stringify(result)) + '\n');
  process.exitCode = result.matrix.status === 'PASS' ? 0 : 1;
}
