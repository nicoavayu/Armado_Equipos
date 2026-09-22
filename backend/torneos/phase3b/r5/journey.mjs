// R5 hybrid end-to-end producer: ONE real user journey through the certified hybrid gateway
// (Core staging hhyvmhgpapyuzjgxfnqv over HTTPS through the R4.1 proxy → local Edge gateway
// 127.0.0.1:58431 → Torneos REST/DB of R2), plus the negative/security journey around it.
// Dedicated Core staging QA users log in with GoTrue (password grant), exchange their Core bearer
// for a Torneos bridge bearer (shadow identity), and run the staging-v1 owner journey (flow.mjs)
// with real Core contracts (verified_email, directory_players, directory_teams, team_snapshot on a
// Core team the owner creates in Core staging the way the app does). Credentials arrive from the
// operator in memory; every persisted byte passes the known-secret registry; fault injection touches
// only the run-owned proxy/gateway namespace (never Core staging, never R2). Output: R5.journey.v1.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {r4, repo, evidence, runtime, d, dAsync, inspect, psql, sqlOne, lit, tableCounts, catalogSHA256, r2Snapshot, readJSON, registerSecret, containsSecret, knownCount, redact,
  guardedFetch, bridgeToken, tokenVariants, decodeJwt, decodeHeader, writeEvidence, artifact, fileSHA, log, Stop, GATEWAY, GATEWAY_ORIGIN, REST_ORIGIN, CORE_ORIGIN, CORE_REF,
  ISOLATED_NETWORK, ISSUER, AUDIENCE, TTL, UUID} from '../r42/lib.mjs';
import {coreClient, assertAnonKey, assertServiceKey} from '../r42/core.mjs';
import {cleanupFixtures, createRunRegistry} from '../r42/fixtures.mjs';
import {runOutageHarnessAsync} from '../r42/outage.mjs';
import {routeFault} from '../r42/route-fault.mjs';
import {createFlow, slugs, entryState, countRows, assert, eq, P0} from './flow.mjs';

export const REQUIRED_BLOCKS = ['core_login', 'exchange', 'shadow_identity', 'workspace', 'season', 'tournament', 'collaborator', 'team_registration', 'roster', 'invitation', 'core_team_import',
  'p0_review', 'cross_user', 'cross_workspace', 'cross_season', 'bearer_invalid', 'bearer_expired', 'logout_revocation', 'core_unavailable', 'core_contract_failure', 'torneos_unavailable',
  'gated_off', 'not_allowlisted', 'no_fallback', 'secret_boundary'];
export const QA_TAG = 'r5', QA_PURPOSE = 'phase3b-r5', QA_LABEL = 'R5';
/** A bridge bearer is refused only after exp + the certified clock tolerance (token.ts `clockTolerance: 5`,
 * private.current_identity_id() `exp <= now − 5`): the real-expiry boundary is TTL + 5 s after iat. Run
 * 20260921T043550Z asserted 401 at 124 s and got the certified 200 (harness threshold, not a product fault). */
export const CLOCK_TOLERANCE_SECONDS = 5;
export const EXPIRY_BOUNDARY_SECONDS = TTL + CLOCK_TOLERANCE_SECONDS;
export const EXPIRY_MARGIN_SECONDS = 3;
export const ROLES = ['owner', 'admin', 'captain', 'outsider'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Core team the owner creates in Core staging, exactly the insert the app performs (teams_insert_owner_only RLS). */
export function coreTeamPayload(owner, RUN) {
  if (!UUID.test(owner?.coreUserId ?? '')) throw new Stop('CORE_TEAM_OWNER_REQUIRED');
  return {owner_user_id: owner.coreUserId, name: `QA R5 Team ${RUN}`, format: 5, is_active: true};
}
/** Pure assembly of the R5.journey.v1 document (unit-tested): PASS only with every required block PASS, none missing, not aborted. */
export function assembleJourney({run, stamp, gatewayBundleSHA256, blocks, detail, cleanup, coreFixtures, artifacts, gatewayResponses = 0, outageTests = 0}) {
  const cases = blocks.filter((b) => !b.informative).map((b) => ({name: b.name, status: b.status, checks: b.checks.length}));
  const missing = REQUIRED_BLOCKS.filter((n) => !cases.some((c) => c.name === n));
  return {schema: 'R5.journey.v1', run, stamp, gatewayBundleSHA256, status: cases.every((c) => c.status === 'PASS') && missing.length === 0 && !detail.aborted ? 'PASS' : 'FAIL',
    cleanup: {qa: cleanup.qa === true, fixtures: cleanup.fixtures === true, coreFixtures: cleanup.coreFixtures === true, sessions: false, complete: false},
    cases, missingRequired: missing, informative: blocks.filter((b) => b.informative).map((b) => ({name: b.name, status: b.status, checks: b.checks.length})),
    totals: {blocks: blocks.length, checks: blocks.reduce((n, b) => n + b.checks.length, 0), failedChecks: blocks.reduce((n, b) => n + b.checks.filter((c) => !c.pass).length, 0), gatewayResponses, outageTests},
    rpcsExercised: detail.rpcsExercised ?? [], identityMap: detail.identityMap ?? null, liveContracts: detail.liveContracts ?? null, coreFixtures, artifacts, aborted: detail.aborted ?? null,
    blocks, noStore: detail.noStore ?? null, noFallback: detail.noFallback ?? null, qaUsers: cleanup.detail?.users ?? []};
}

export async function runJourney({stamp, anonKey, serviceKey, contractSecret}) {
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
  const core = coreClient({http, anonKey, serviceKey, run, tag: QA_TAG, purpose: QA_PURPOSE, label: QA_LABEL});

  // ───────── transport (same shape as the certified matrix producer) ─────────
  const noStore = {responses: 0, violations: [], classes: {}};
  async function gw(path, {token, method = 'GET', body, headers = {}} = {}) {
    const r = await http(`${GATEWAY}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000)});
    noStore.responses++;
    const cacheControl = r.headers['cache-control'] ?? null;
    const cls = `${path.split('?')[0]} | ${r.status} | ${typeof r.body?.error === 'string' ? r.body.error : ''}`;
    noStore.classes[cls] = {count: (noStore.classes[cls]?.count ?? 0) + 1, cacheControl};
    if (!cacheControl?.includes('no-store')) noStore.violations.push({path, status: r.status, cacheControl});
    return r;
  }
  const rest = (path, {token, method = 'GET', body} = {}) => http(`${REST_ORIGIN}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
  const coreRest = (path, session, {method = 'GET', body, prefer} = {}) => http(`${CORE_ORIGIN}/rest/v1${path}`, {method, headers: {apikey: anonKey, authorization: `Bearer ${session.accessToken}`, ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...(prefer ? {prefer} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
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
  const memberships = (token) => gw('/torneos/rest/v1/rpc/get_my_tournament_memberships', {token, method: 'POST', body: {}});

  // ───────── result model ─────────
  const blocks = [];
  const detail = {schema: 'R5.journey-detail.v1', run, stamp, blocks, noFallback: {writesDuringFaults: [], recoveries: []}};
  let current = null;
  function block(name, meta = {}) { current = {name, status: 'PASS', checks: [], startedAt: new Date().toISOString(), ...meta}; blocks.push(current); log(`block ${name}`); return current; }
  async function check(name, fn) {
    try { const out = await fn(); current.checks.push({name, pass: true, detail: out ?? null}); }
    catch (e) { current.status = 'FAIL'; current.checks.push({name, pass: false, error: redact(String(e?.message ?? e)).slice(0, 700)}); log(`  FAIL ${name}: ${redact(String(e?.message ?? e)).slice(0, 240)}`); if (current.name !== 'cleanup') throw new Stop('JOURNEY_STOP_ON_FAILURE', name); }
  }
  const cleanup = {qa: false, fixtures: false, coreFixtures: false, sessionsLoggedOut: false, usersDeleted: false, detail: {}};
  const coreFixtures = {teams: []};
  const baseline = {counts: tableCounts(), catalogSHA256: catalogSHA256(), r2: r2Snapshot(), torneosAuthUsers: sqlOne('select count(*) from auth.users')};
  const users = {};
  const registry = createRunRegistry(RUN);
  const exercised = new Set();
  const artifacts = {};
  let flow = null, F = null, outage = null, coreTeam = null, routes = null, originalRoutes = null;

  try {
    // ═══════════════════════ 1. QA users on Core staging (dedicated, per run) ═══════════════════════
    block('qa_users', {informative: true});
    await check('four dedicated synthetic QA users created on Core staging (purpose phase3b-r5) — never a real or pre-existing account', async () => {
      for (const role of ROLES) users[role] = await core.createUser(role);
      return Object.values(users).map((u) => ({role: u.role, email: u.emailMasked, id: u.coreUserId.slice(0, 8)}));
    });
    if (current.status !== 'PASS') throw new Stop('QA_USERS_FAILED');
    const {owner, admin, captain, outsider} = users;

    // ═══════════════════════ 2. Core login (GoTrue password grant) → valid Core identity ═══════════════════════
    block('core_login');
    await check('every QA user signs in to Core staging (password grant): access token, session_id claim, aud/role authenticated; GET /auth/v1/user returns the same user id', async () => {
      const out = [];
      for (const u of Object.values(users)) {
        const s = await core.login(u);
        const info = await core.userInfo(s);
        eq([info.status, info.id, s.aud, s.role, s.iss, UUID.test(s.sessionId)], [200, u.coreUserId, 'authenticated', 'authenticated', `${CORE_ORIGIN}/auth/v1`, true], {role: u.role, info});
        out.push({role: u.role, id: u.coreUserId.slice(0, 8), session: s.sessionId.slice(0, 8)});
      }
      return out;
    });
    await check('wrong password → Core refuses the grant (400 invalid credentials); no session is created', async () => {
      const r = await http(`${CORE_ORIGIN}/auth/v1/token?grant_type=password`, {method: 'POST', headers: {apikey: anonKey, 'content-type': 'application/json'}, body: JSON.stringify({email: owner.email, password: 'not-the-password-' + RUN})});
      assert([400, 401].includes(r.status), {status: r.status, body: r.body?.error_code ?? r.body?.error});
      return {status: r.status, code: r.body?.error_code ?? r.body?.error ?? null};
    });

    // ═══════════════════════ 3–4. exchange Core → Torneos bridge token ═══════════════════════
    block('exchange');
    await check('POST /exchange with the live Core bearer → 200 bridge bearer: RS256 p3b-k1 (local ring, not Core), certified claims, TTL 120', async () => {
      const r = await exchange(owner);
      owner.firstToken = owner.token; owner.firstTokenAt = Date.now();
      const h = decodeHeader(owner.token), c = owner.claims;
      eq([r.body.token_type, r.body.expires_in, h.alg, h.typ, h.kid], ['Bearer', TTL, 'RS256', 'JWT', 'p3b-k1'], 'token shape');
      assert(UUID.test(c.sub) && c.core_user_id === owner.coreUserId && c.session_id === owner.sessions[0].sessionId && c.iss === ISSUER && c.aud === AUDIENCE && c.role === 'authenticated' && c.exp - c.iat === TTL && c.nbf === c.iat && UUID.test(c.jti), c);
      assert(c.sub !== owner.coreUserId, 'the Torneos subject is a shadow identity, not the Core user id');
      return {sub: c.sub.slice(0, 8), coreUserId: owner.coreUserId.slice(0, 8), kid: h.kid, ttl: c.exp - c.iat, issuer: c.iss};
    });
    await check('exchange without bearer / garbage / unsigned Core-shaped bearer → 401; identity or role input in the body → 400', async () => {
      const none = await gw('/exchange', {method: 'POST'});
      const garbage = await gw('/exchange', {method: 'POST', token: 'x.y.z'});
      const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const forged = await gw('/exchange', {method: 'POST', token: `${b64u({alg: 'none', typ: 'JWT'})}.${b64u({sub: owner.coreUserId, aud: 'authenticated', role: 'authenticated', iss: `${CORE_ORIGIN}/auth/v1`, session_id: owner.sessions[0].sessionId, exp: Math.floor(Date.now() / 1000) + 600})}.`});
      const roleBody = await gw('/exchange', {method: 'POST', token: owner.sessions[0].accessToken, body: {role: 'service_role'}});
      eq([none.status, garbage.status, forged.status, roleBody.status], [401, 401, 401, 400], {none: none.body, garbage: garbage.body, forged: forged.body, roleBody: roleBody.body});
      return {none: none.body, forged: forged.body, roleBody: roleBody.body};
    });

    // ═══════════════════════ 5. shadow identity: Core user → Torneos identity ═══════════════════════
    block('shadow_identity');
    await check('one torneos_identity row {id = sub, core_user_id}; re-exchange and a NEW Core session resolve the SAME identity', async () => {
      const sub = owner.identity;
      eq(sqlOne(`select count(*) from public.torneos_identity where id=${lit(sub)} and core_user_id=${lit(owner.coreUserId)}`), '1', 'identity row');
      await exchange(owner); eq(owner.identity, sub, 'same identity on re-exchange');
      const s2 = await core.login(owner); await exchange(owner, s2);
      eq([owner.identity, owner.claims.session_id, owner.claims.session_id === owner.sessions[0].sessionId], [sub, s2.sessionId, false], 'same identity, new session binding');
      eq(sqlOne(`select count(*) from public.torneos_identity where core_user_id=${lit(owner.coreUserId)}`), '1', 'still one row');
      return {identity: sub.slice(0, 8), sessions: owner.sessions.length};
    });
    await check('the other three Core users resolve three DISTINCT Torneos identities, each bound to its own core_user_id', async () => {
      for (const u of [admin, captain, outsider]) await exchange(u);
      const subs = new Set(Object.values(users).map((u) => u.identity));
      eq(subs.size, 4, 'four distinct identities');
      for (const u of Object.values(users)) eq(sqlOne(`select core_user_id from public.torneos_identity where id=${lit(u.identity)}`), u.coreUserId, u.role);
      detail.identityMap = Object.values(users).map((u) => ({role: u.role, coreUserId: u.coreUserId, torneosIdentity: u.identity}));
      return detail.identityMap.map((m) => ({role: m.role, core: m.coreUserId.slice(0, 8), torneos: m.torneosIdentity.slice(0, 8)}));
    });
    await check('no second login: Torneos has no auth users/sessions for these users (auth.users stays 0, no auth.sessions relation, no GoTrue); a Core access token is refused by Torneos REST directly (401); the gateway publishes no Torneos anon key', async () => {
      eq(sqlOne('select count(*) from auth.users'), baseline.torneosAuthUsers, 'torneos auth.users unchanged'); eq(baseline.torneosAuthUsers, '0');
      eq(sqlOne("select to_regclass('auth.sessions') is null"), 't', 'no auth.sessions');
      eq(sqlOne("select count(*) from pg_stat_activity where usename like 'supabase_auth%'"), '0', 'no GoTrue connected');
      const direct = await rest('/rpc/get_my_tournament_memberships', {token: owner.sessions[0].accessToken, method: 'POST', body: {}});
      eq(direct.status, 401, {direct: direct.body});
      const cfg = await gw('/config'); eq([cfg.status, cfg.body.coreUrl, cfg.body.anonKey], [200, CORE_ORIGIN, ''], cfg.body);
      const bridge = await memberships(await tok(owner)); eq(bridge.status, 200, bridge.body);
      return {torneosAuthUsers: 0, coreTokenAtTorneosRest: direct.status, coreTokenCode: direct.body?.code ?? null, bridgeTokenAtGateway: bridge.status};
    });

    // ═══════════════════════ 6–7. the owner journey (staging-v1 allowlist through the gateway) ═══════════════════════
    flow = createFlow({rpc, actors: users, RUN, registry, exercised}); F = flow.F;
    block('workspace');
    await check('organizations/workspaces: slug check → create org → workspace preference → workspace context (role owner) → rename → membership/capability predicates; outsider creates a second workspace', flow.workspace);
    block('season');
    await check('seasons: two seasons in the org → rename one → active context; outsider season in the other workspace', flow.seasons);
    block('tournament');
    await check('tournaments: eligibility → create with defaults → category → registration open → configuration patch → competition context; second tournament (season B) and the outsider tournament', flow.tournaments);
    block('collaborator');
    await check('collaborators: membership seeded (staging v1 has no membership RPC — Phase 2D contract) → season seat assigned by RPC → listed → season access A true / B false → review capability → teams context', flow.collaborator);
    block('team_registration');
    await check('team registration: manual entry (draft → in_progress) → registration context → read predicate (owner true, outsider false); a second entry withdrawn', flow.teamRegistration);
    block('roster');
    await check('basic roster: 4 provisional players + the captain\'s Core-backed Torneos identity → edit shirt → add/remove a sixth → 5 active', flow.roster);
    await check('directory_players (live Core contract): searching the captain by name returns the captain\'s shadow identity (linkedAccount) → attestation consumed', async () => {
      const out = await flow.searchPlayers();
      eq(sqlOne(`select count(*) from private.core_contract_attestations where identity_id=${lit(owner.identity)} and contract='directory_players' and consumed_at is not null`) !== '0', true, 'consumed attestation');
      return out;
    });
    block('invitation');
    await check('invitation: owner invites the captain (Core email) → captain accepts through the gateway (live verified_email) → manager predicates → captain edits the roster and submits the entry', flow.invitation);

    // ═══════════════════════ Core team import (real Core team, real contracts) ═══════════════════════
    block('core_fixture', {informative: true});
    await check('owner creates a Core team in Core staging the way the app does (POST /rest/v1/teams as the owner; RLS teams_insert_owner_only), tagged by run', async () => {
      const r = await coreRest('/teams?select=id,name,owner_user_id,is_active', owner.sessions.at(-1), {method: 'POST', body: coreTeamPayload(owner, RUN), prefer: 'return=representation'});
      const row = Array.isArray(r.body) ? r.body[0] : null;
      if (r.status !== 201 || !UUID.test(row?.id ?? '')) throw new Stop('CORE_TEAM_CREATE_FAILED', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      eq([row.owner_user_id, row.is_active, row.name], [owner.coreUserId, true, `QA R5 Team ${RUN}`], row);
      coreTeam = {id: row.id, name: row.name, players: 0};
      coreFixtures.teams.push({id: row.id, name: row.name, ownerCoreUserId: owner.coreUserId, deleted: false});
      return {id: row.id.slice(0, 8), name: row.name};
    });
    block('core_team_import');
    await check('directory_teams (live) lists the owner\'s Core team → create_tournament_team_entry with p_arma2_team_id → team_snapshot (live) frozen into the entry; a second import is refused; then roster + invitation + submit on the imported entry', async () => {
      const out = await flow.coreTeamImport(coreTeam);
      eq(sqlOne(`select count(*) from private.core_contract_attestations where identity_id=${lit(owner.identity)} and contract='team_snapshot' and consumed_at is not null`), '1', 'one consumed snapshot attestation');
      return out;
    });
    await check('cross-user Core authority: the outsider imports the OWNER\'s Core team into their own workspace → Core answers NOT_FOUND → gateway 404 CORE_DENIED, no attestation, zero writes', async () => flow.coreTeamImportByOutsider(coreTeam, [404, 'CORE_DENIED']));
    const live = F.acceptance.filter((a) => a.live).length;
    detail.liveContracts = {verified_email: live, directory_players: 1, directory_teams: 1, team_snapshot: 1, seededAcceptances: F.acceptance.length - live};

    // ═══════════════════════ P0 ═══════════════════════
    block('p0_review');
    await check('review_tournament_team_entry: owner changes_requested (issue) → fix → resubmit → seated admin approves the manual entry → owner approves the imported entry; denials (re-review, captain, outsider ×2, invalid payload) write nothing', flow.review);
    await check('anonymous review through the gateway → 401', async () => { const r = await gw(`/torneos/rest/v1/rpc/${P0}`, {method: 'POST', body: {}}); eq(r.status, 401, r.body); return r.body; });

    // ═══════════════════════ RLS / tenancy ═══════════════════════
    block('cross_user');
    await check('outsider reads the org members table → []; owner → rows; every actor sees only its own identity row; the captain (manager, not a member) gets no teams context; outsider\'s workspace context names only their own org', async () => {
      const o = await gw(`/torneos/rest/v1/tournament_organization_members?organization_id=eq.${F.org}&select=id`, {token: await tok(outsider)});
      const w = await gw(`/torneos/rest/v1/tournament_organization_members?organization_id=eq.${F.org}&select=id`, {token: await tok(owner)});
      const own = [];
      for (const u of Object.values(users)) { const ids = await gw('/torneos/rest/v1/torneos_identity?select=id', {token: await tok(u)}); own.push([ids.status, ids.body?.length, ids.body?.[0]?.id === u.identity]); }
      eq([o.status, o.body.length, w.status, w.body.length >= 2], [200, 0, 200, true], {o: o.body, w: w.body});
      eq(own, ROLES.map(() => [200, 1, true]), own);
      const ctx = await rpc('get_tournament_teams_context', captain, {p_organization_id: F.org, p_tournament_id: F.tournamentA});
      assert(ctx.status !== 200 || ctx.body === null || (typeof ctx.body === 'object' && Object.keys(ctx.body).length === 0), {ctx: ctx.status, body: ctx.body});
      const ws = await rpc('get_tournament_workspace_context', outsider, {});
      assert(ws.status === 200 && JSON.stringify(ws.body).includes(F.org2) && !JSON.stringify(ws.body).includes(F.org), {ws: ws.body});
      return {outsiderRows: 0, ownerRows: w.body.length, captainTeamsContext: ctx.status};
    });
    block('cross_workspace');
    await check('outsider: tournaments/entries of the owner\'s workspace → []; teams context refused; owner writing into the outsider\'s workspace (season) → 403 zero writes; outsider renaming the owner\'s org → 403 unchanged', async () => {
      const t = await gw(`/torneos/rest/v1/tournaments?organization_id=eq.${F.org}&select=id`, {token: await tok(outsider)});
      const e = await gw(`/torneos/rest/v1/tournament_team_entries?organization_id=eq.${F.org}&select=id`, {token: await tok(outsider)});
      const tw = await gw(`/torneos/rest/v1/tournaments?organization_id=eq.${F.org}&select=id`, {token: await tok(owner)});
      const ctx = await rpc('get_tournament_teams_context', outsider, {p_organization_id: F.org, p_tournament_id: F.tournamentA});
      eq([t.body.length, e.body.length, tw.body.length], [0, 0, 2], {t: t.body, e: e.body});
      assert(ctx.status !== 200 || ctx.body === null || Object.keys(ctx.body ?? {}).length === 0, {ctx: ctx.body});
      const seasonsBefore = countRows('public.tournament_seasons', `organization_id=${lit(F.org2)}`);
      await flow.refused('create_tournament_season', owner, {p_organization_id: F.org2, p_name: 'Intrusa', p_slug: `intrusa-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID()}, 403, 'TORNEOS_RESOURCE_FORBIDDEN');
      eq(countRows('public.tournament_seasons', `organization_id=${lit(F.org2)}`), seasonsBefore, 'zero writes');
      const name = sqlOne(`select name from public.tournament_organizations where id=${lit(F.org)}`);
      const ren = await flow.call('update_tournament_organization', outsider, {p_organization_id: F.org, p_name: 'Hackeada'});
      eq([ren.status, ren.body?.message], [403, 'TORNEOS_ORGANIZATION_FORBIDDEN'], {ren: ren.body}); eq(sqlOne(`select name from public.tournament_organizations where id=${lit(F.org)}`), name, 'unchanged');
      return {outsiderTournaments: 0, outsiderEntries: 0, ownerTournaments: 2, crossWrite: 403, crossRename: ren.status};
    });
    block('cross_season');
    await check('seated admin: season A yes / season B no; registering a team in the season-B tournament → 403 zero writes; teams context B refused; after the owner revokes the seat, season A is refused immediately (no cached grant)', async () => {
      const before = countRows('public.tournament_team_entries', `tournament_id=${lit(F.tournamentB)}`);
      const r = await flow.call('create_tournament_team_entry', admin, {p_organization_id: F.org, p_tournament_id: F.tournamentB, p_category_id: F.categoryB, p_arma2_team_id: null, p_name: `Cross Season FC ${RUN}`, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: crypto.randomUUID()});
      eq([r.status, r.body?.message], [403, 'TORNEOS_RESOURCE_FORBIDDEN'], r.body);
      eq(countRows('public.tournament_team_entries', `tournament_id=${lit(F.tournamentB)}`), before, 'zero writes');
      const ctxB = await rpc('get_tournament_teams_context', admin, {p_organization_id: F.org, p_tournament_id: F.tournamentB});
      assert(ctxB.status !== 200 || ctxB.body === null || Object.keys(ctxB.body ?? {}).length === 0, {ctxB: ctxB.body});
      const ctxA = await rpc('get_tournament_teams_context', admin, {p_organization_id: F.org, p_tournament_id: F.tournamentA}); eq(ctxA.status, 200, ctxA.body);
      const revoked = await flow.revokeCollaborator();
      const ctxAfter = await rpc('get_tournament_teams_context', admin, {p_organization_id: F.org, p_tournament_id: F.tournamentA});
      assert(ctxAfter.status !== 200 || ctxAfter.body === null || Object.keys(ctxAfter.body ?? {}).length === 0, {ctxAfter: ctxAfter.body});
      return {crossSeasonWrite: r.status, teamsContextB: ctxB.status, teamsContextABeforeRevoke: ctxA.status, ...revoked, teamsContextAAfterRevoke: ctxAfter.status};
    });

    // ═══════════════════════ bearer negatives ═══════════════════════
    block('bearer_invalid');
    const variants = tokenVariants(ring, identityOf(owner));
    await check('forged/invalid bridge bearers → 401 access denied at the gateway (garbage, empty, alg none, wrong issuer/audience, unknown and standby kid, service_role/anon role, non-uuid sub, unknown session, identity↔user mismatch, another user\'s session)', async () => {
      const out = {};
      for (const name of ['garbage', 'empty', 'alg_none', 'wrong_issuer', 'wrong_audience', 'unknown_kid', 'standby_kid_p3b_k2', 'role_service_role', 'role_anon', 'sub_not_uuid', 'jti_missing']) {
        const v = variants.find((x) => x.name === name);
        const g = await memberships(v.token); out[name] = g.status; eq([g.status, g.body?.error], [401, 'access denied'], {name, body: g.body});
      }
      for (const [name, t] of [['unknown_session', bridgeToken(K1, {...identityOf(owner), sessionId: crypto.randomUUID()})], ['identity_of_owner_with_outsider_user', bridgeToken(K1, {sub: owner.identity, coreUserId: outsider.coreUserId, sessionId: outsider.sessions[0].sessionId})],
        ['owner_user_with_admin_session', bridgeToken(K1, {sub: owner.identity, coreUserId: owner.coreUserId, sessionId: admin.sessions[0].sessionId})], ['unknown_identity', bridgeToken(K1, {sub: crypto.randomUUID(), coreUserId: owner.coreUserId, sessionId: owner.sessions.at(-1).sessionId})]]) {
        const g = await memberships(t); out[name] = g.status; eq(g.status, 401, {name, body: g.body});
      }
      return out;
    });
    block('bearer_expired');
    await check('forged expired bearer → 401; the REAL first bridge bearer of the run is refused once its 120 s TTL plus the certified 5 s clock tolerance have elapsed (measured), while the owner\'s fresh bearer works', async () => {
      const forged = await memberships(variants.find((x) => x.name === 'expired').token); eq(forged.status, 401, forged.body);
      // firstTokenAt was taken after the exchange response (≥ iat): waiting TTL + tolerance + margin from it is past exp + tolerance.
      const wait = owner.firstTokenAt + (EXPIRY_BOUNDARY_SECONDS + EXPIRY_MARGIN_SECONDS) * 1000 - Date.now(); if (wait > 0) await sleep(wait);
      const elapsed = Math.round((Date.now() - owner.firstTokenAt) / 1000);
      assert(elapsed >= EXPIRY_BOUNDARY_SECONDS + EXPIRY_MARGIN_SECONDS, {elapsed});
      const stale = await memberships(owner.firstToken); eq([stale.status, stale.body?.error], [401, 'access denied'], {stale: typeof stale.body === 'object' ? Object.keys(stale.body ?? {}) : stale.body, elapsed});
      const fresh = await memberships(await tok(owner)); eq(fresh.status, 200, fresh.body);
      return {forged: forged.status, ttl: TTL, clockToleranceSeconds: CLOCK_TOLERANCE_SECONDS, realExpiredAfterSeconds: elapsed, realExpired: stale.status, fresh: fresh.status};
    });

    // ═══════════════════════ logout / revocation (Core is the session authority) ═══════════════════════
    block('logout_revocation');
    await check('revoked session: admin signs in twice more (s2, s3), exchanges both; logout(scope=others) from s3 → bearer bound to s2 401 immediately, bearer bound to s3 200', async () => {
      const s2 = await core.login(admin); await exchange(admin, s2); const t2 = admin.token;
      const s3 = await core.login(admin); await exchange(admin, s3); const t3 = admin.token;
      eq((await memberships(t2)).status, 200, 's2 before');
      eq(await core.logout(s3, 'others'), 204, 'logout others');
      const r2 = await memberships(t2), r3 = await memberships(t3);
      eq([r2.status, r3.status], [401, 200], {r2: r2.body, r3: r3.body});
      admin.token = t3; admin.tokenAt = Date.now();
      return {s2: r2.status, s3: r3.status};
    });
    await check('logout: captain bearer 200 → GoTrue logout(local) → same bearer 401 ×3 immediately (ms recorded) → the logged-out Core token cannot exchange → a forged bearer naming the logged-out session → 401', async () => {
      const before = await memberships(await tok(captain)); eq(before.status, 200, before.body);
      const t = captain.token, s = captain.sessions.at(-1);
      eq(await core.logout(s, 'local'), 204, 'logout');
      const after = [];
      for (let i = 0; i < 3; i++) { const t0 = Date.now(); const r = await memberships(t); after.push({status: r.status, ms: Date.now() - t0}); }
      eq(after.map((x) => x.status), [401, 401, 401], after);
      const ex = await gw('/exchange', {method: 'POST', token: s.accessToken}); eq(ex.status, 401, ex.body);
      const forged = await memberships(bridgeToken(K1, {sub: captain.identity, coreUserId: captain.coreUserId, sessionId: s.sessionId})); eq(forged.status, 401, forged.body);
      captain.token = null; captain.loggedOut = true;
      return {afterLogout: after, exchangeWithLoggedOutCoreToken: ex.status, forgedLoggedOutSession: forged.status};
    });

    // ═══════════════════════ outages (run-owned proxy faults / route removal; real modules offline) ═══════════════════════
    const gwName = state.gateway;
    const restIP = baseline.r2.rest.networks[ISOLATED_NETWORK].IPAddress;
    const fault = routeFault({run, gateway: gwName, routes: state.routes, exec: dAsync}); routes = fault.routes;
    const {withRouteRemoved} = fault;
    originalRoutes = await routes();
    async function withCoreFault(mode, fn) {
      assert(['auth', 'contract'].includes(mode), mode);
      const ctl = (code) => d(['exec', state.proxy, 'node', '-e', code]);
      ctl(`require('fs').writeFileSync('/fault/mode','${mode}',{flag:'wx',mode:0o600})`);
      try { return await fn(); } finally { ctl("require('fs').unlinkSync('/fault/mode')"); }
    }
    const orgName = () => sqlOne(`select name from public.tournament_organizations where id=${lit(F.org)}`);
    const rename = (token, suffix) => gw('/torneos/rest/v1/rpc/update_tournament_organization', {token, method: 'POST', body: {p_organization_id: F.org, p_name: `R5 League ${RUN} ${suffix}`}});
    const noFallback = (blockName, changed, extra) => { detail.noFallback.writesDuringFaults.push({block: blockName, changed, ...extra}); eq(changed, false, `${blockName}: write during fault must not land`); };
    const recovered = async (blockName, fn, want = 200) => { const r = await fn(); detail.noFallback.recoveries.push({block: blockName, status: r.status, attempt: 1}); eq(r.status, want, 'first request after fault removal'); return {status: r.status, attempt: 1}; };
    block('core_unavailable');
    await check('Core Auth transport reset at the run-owned proxy (ingress preserved): /health, /exchange, RPC and a WRITE with a valid bearer → 503 access denied; nothing lands in Torneos; first request after recovery → 200', async () => {
      const t = await tok(owner); const before = orgName();
      const during = await withCoreFault('auth', async () => {
        const h = await gw('/health'); const ex = await gw('/exchange', {method: 'POST', token: owner.sessions.at(-1).accessToken});
        const rp = await memberships(t); const wr = await rename(t, 'during-core-outage');
        return {health: h.status, exchange: ex.status, rpc: rp.status, write: wr.status, bodies: [h.body?.error, ex.body?.error, rp.body?.error, wr.body?.error], cacheControl: [h.headers['cache-control'], rp.headers['cache-control'], wr.headers['cache-control']]};
      });
      eq([during.health, during.exchange, during.rpc, during.write], [503, 503, 503, 503], during);
      eq(during.bodies, ['access denied', 'access denied', 'access denied', 'access denied'], during);
      noFallback('core_unavailable', orgName() !== before, {before, after: orgName()});
      eq(await routes(), originalRoutes, 'Core fault never modifies routes');
      const recovery = await recovered('core_unavailable', () => gw('/health'));
      return {...during, recovery};
    });
    block('core_contract_failure');
    await check('Core contract transport reset (Auth and ingress reachable): RPC and a WRITE with a verified bearer → 503 CORE_UNAVAILABLE no-store, zero writes, no fallback; first request after recovery → 200', async () => {
      const t = await tok(owner); const before = orgName();
      const during = await withCoreFault('contract', async () => {
        const h = await gw('/health'); eq(h.status, 200, 'Auth and ingress remain reachable');
        const rp = await memberships(t); const wr = await rename(t, 'during-contract-fault');
        return {health: h.status, rpc: rp.status, rpcError: rp.body?.error, write: wr.status, writeError: wr.body?.error, cacheControl: rp.headers['cache-control']};
      });
      eq([during.rpc, during.rpcError, during.write, during.writeError, during.cacheControl], [503, 'CORE_UNAVAILABLE', 503, 'CORE_UNAVAILABLE', 'no-store'], during);
      noFallback('core_contract_failure', orgName() !== before, {before, after: orgName()});
      const recovery = await recovered('core_contract_failure', () => rpc('get_my_tournament_memberships', owner));
      return {...during, recovery};
    });
    await check('offline harness (real gateway modules, certified Edge image, --network none): contract 500/502/timeout/stale/future/malformed/schema/active:false, Auth health 503, user 500, Torneos DB unreachable → fail closed', async () => {
      outage = await runOutageHarnessAsync({label: run});
      for (const n of ['core_contract_500', 'core_contract_502', 'core_contract_timeout', 'core_contract_stale', 'core_contract_future', 'core_contract_malformed_json', 'core_contract_schema_violation', 'core_contract_200_active_false', 'core_auth_health_503 (rpc)', 'core_auth_user_500', 'exchange with active Core but Torneos DB unreachable', 'rpc with active Core but Torneos DB unreachable']) assert(outage.tests.find((x) => x.name.startsWith(n))?.pass, n);
      assert(outage.pass, outage.tests.filter((x) => !x.pass));
      return {tests: outage.tests.length, pass: outage.pass, bundleSHA256: outage.bundleSHA256};
    });
    block('torneos_unavailable');
    await check('Torneos REST unreachable from the gateway namespace (REST /32 removed): RPC, table read and a WRITE with a verified bearer + live Core → 503 access denied no-store, zero writes; route restored; first request after → 200', async () => {
      const t = await tok(owner); const before = countRows('public.tournament_seasons', `organization_id=${lit(F.org)}`);
      const during = await withRouteRemoved(restIP, async (r) => {
        const rp = await memberships(t);
        const tbl = await gw('/torneos/rest/v1/torneos_identity?select=id', {token: t});
        const wr = await gw('/torneos/rest/v1/rpc/create_tournament_season', {token: t, method: 'POST', body: {p_organization_id: F.org, p_name: 'Durante corte', p_slug: `corte-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID()}});
        return {rpc: rp.status, rpcBody: rp.body, table: tbl.status, write: wr.status, writeBody: wr.body, cacheControl: [rp.headers['cache-control'], wr.headers['cache-control']], routesDuring: r};
      });
      eq([during.rpc, during.table, during.write, during.rpcBody, during.writeBody, during.cacheControl], [503, 503, 503, {error: 'access denied'}, {error: 'access denied'}, ['no-store', 'no-store']], during);
      noFallback('torneos_unavailable', countRows('public.tournament_seasons', `organization_id=${lit(F.org)}`) !== before, {seasonsBefore: before});
      eq(await routes(), originalRoutes, 'routes restored');
      const recovery = await recovered('torneos_unavailable', () => rpc('get_my_tournament_memberships', owner));
      return {...during, recovery};
    });

    // ═══════════════════════ gate / allowlist boundary ═══════════════════════
    const argsOf = {};
    for (const line of psql(`select proname||'|'||coalesce(pg_get_function_arguments(oid),'') from pg_proc where pronamespace='public'::regnamespace and proname = any(array[${gated.map(lit).join(',')}]) order by 1`).trim().split('\n').filter(Boolean)) { const [n, a] = line.split('|'); if (!argsOf[n]) argsOf[n] = a; }
    const nullArgs = (name) => Object.fromEntries((argsOf[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((p) => [p.split(/\s+/)[0], null]));
    block('gated_off');
    await check('the 33 gated RPCs (32 OFF + auto_schedule_tournament_matches parent gate) stay inaccessible for a fully valid owner session: gateway → 403 rpc not enabled; direct PostgREST anon → 42501; catalog: no anon/authenticated EXECUTE', async () => {
      const bad = [], gate = {};
      for (const name of gated) {
        const post = await gw(`/torneos/rest/v1/rpc/${name}`, {token: await tok(owner), method: 'POST', body: nullArgs(name)});
        const anon = await rest(`/rpc/${name}`, {method: 'POST', body: nullArgs(name)});
        gate[name] = {gateway: post.status, anon: anon.status, anonCode: anon.body?.code};
        if (!(post.status === 403 && post.body?.error === 'rpc not enabled' && [401, 403].includes(anon.status) && anon.body?.code === '42501')) bad.push({name, ...gate[name]});
      }
      eq(bad, [], 'gate holds for all 33'); eq(Object.keys(gate).length, 33); assert(gated.includes('auto_schedule_tournament_matches'), 'parent gate in scope');
      const leaks = psql(`select proname from pg_proc where pronamespace='public'::regnamespace and proname = any(array[${gated.map(lit).join(',')}]) and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))`).trim();
      eq(leaks, '', 'no catalog leak'); eq(allowed.filter((n) => gated.includes(n)), [], 'allowlist ∩ gate = ∅');
      return {gated: 33, allowlist: allowed.length, gate};
    });
    block('not_allowlisted');
    await check('an existing RPC outside the staging-v1 allowlist (create_tournament_venue) and a nonexistent name are refused by the gateway before PostgREST (403 rpc not enabled) even with a valid bearer', async () => {
      const t = await tok(owner);
      const venue = await gw('/torneos/rest/v1/rpc/create_tournament_venue', {token: t, method: 'POST', body: {p_organization_id: F.org, p_name: 'Sede', p_address: 'Calle 1'}});
      const nope = await gw('/torneos/rest/v1/rpc/r5_no_such_function', {token: t, method: 'POST', body: {}});
      eq([venue.status, venue.body?.error, nope.status, nope.body?.error], [403, 'rpc not enabled', 403, 'rpc not enabled'], {venue: venue.body, nope: nope.body});
      eq(countRows('public.tournament_venues', `organization_id=${lit(F.org)}`), 0, 'no venue created');
      assert(!allowed.includes('create_tournament_venue') && !gated.includes('create_tournament_venue'), 'venue RPC is neither allowlisted nor gated');
      return {venue: venue.status, unknown: nope.status};
    });

    // ═══════════════════════ no fallback / no cache ═══════════════════════
    block('no_fallback');
    await check('every gateway response carried cache-control: no-store; revocations and outages took effect on the very next request; every write attempted during a fault landed nowhere; every recovery was the first request (no retry hid an error); Core is reached only through the proxy, Torneos only locally', async () => {
      eq(noStore.violations, []); assert(noStore.responses > 150, noStore.responses);
      const keys = Object.keys(noStore.classes);
      const coverage = {health200: keys.some((k) => k.startsWith('/health | 200')), exchange200: keys.some((k) => k.startsWith('/exchange | 200')), rest200: keys.some((k) => k.startsWith('/torneos/rest/') && k.includes(' | 200 |')),
        rest401: keys.some((k) => k.startsWith('/torneos/rest/') && k.includes(' | 401 |')), rest403: keys.some((k) => k.startsWith('/torneos/rest/') && k.includes(' | 403 |')), rest503: keys.some((k) => k.startsWith('/torneos/rest/') && k.includes(' | 503 |')),
        coreUnavailable: keys.some((k) => k.endsWith(' | 503 | CORE_UNAVAILABLE')), coreDenied: keys.some((k) => k.endsWith(' | 404 | CORE_DENIED'))};
      assert(Object.values(coverage).every(Boolean), coverage);
      eq(detail.noFallback.writesDuringFaults.map((w) => [w.block, w.changed]), [['core_unavailable', false], ['core_contract_failure', false], ['torneos_unavailable', false]], detail.noFallback.writesDuringFaults);
      eq(detail.noFallback.recoveries.map((r) => [r.block, r.status, r.attempt]), [['core_unavailable', 200, 1], ['core_contract_failure', 200, 1], ['torneos_unavailable', 200, 1]], detail.noFallback.recoveries);
      const cfg = await gw('/config'); eq([cfg.body.coreUrl, cfg.body.torneosUrl], [CORE_ORIGIN, `${GATEWAY}/torneos`], cfg.body);
      eq(sqlOne('select count(*) from pg_foreign_server'), '0'); eq(sqlOne("select count(*) from pg_extension where extname in ('dblink','postgres_fdw')"), '0');
      return {responses: noStore.responses, violations: 0, coverage, classes: noStore.classes};
    });

    // ═══════════════════════ secret boundary ═══════════════════════
    block('secret_boundary');
    await check('no known secret (Core keys, QA passwords, Core tokens, bridge bearers, invitation tokens, ring keys, DB logins, HMAC) in docker inspect / process args / logs / evidence / runtime; the gateway env carries no secret-named variable and no QA credential', async () => {
      const inspectText = d(['inspect', gwName, state.proxy]).stdout;
      const top = d(['top', gwName, '-eo', 'pid,args']).stdout;
      const logs = d(['logs', gwName], {ok: true}); const plogs = d(['logs', state.proxy], {ok: true});
      const files = [...fs.readdirSync(evidence).filter((f) => /^r[45]-/.test(f)).map((f) => evidence + '/' + f), ...(fs.existsSync(runtime) ? fs.readdirSync(runtime).map((f) => runtime + '/' + f) : []), r4 + '/.runtime/run.json'];
      const leaks = [];
      if (containsSecret(inspectText)) leaks.push('docker inspect'); if (containsSecret(top)) leaks.push('process args');
      if (containsSecret((logs.stdout ?? '') + (logs.stderr ?? '') + (plogs.stdout ?? '') + (plogs.stderr ?? ''))) leaks.push('logs');
      for (const f of files) if (containsSecret(fs.readFileSync(f, 'utf8'))) leaks.push(f);
      eq(leaks, []);
      const envNames = inspect(gwName).Config.Env.map((s) => s.split('=')[0]);
      assert(!envNames.some((n) => /SECRET|PASSWORD|KEY|TOKEN|CORE_|TORNEOS_/.test(n)), envNames);
      assert(!Object.values(users).some((u) => inspectText.includes(u.password) || inspectText.includes(u.email) || top.includes(u.email)), 'no QA credential in the gateway');
      return {envNames, scannedFiles: files.length, knownSecrets: knownCount()};
    });
  } catch (e) {
    log(`journey aborted: ${redact(String(e?.message ?? e))}`);
    detail.aborted = redact(String(e?.message ?? e)).slice(0, 500);
    if (current && current.status === 'PASS') { current.status = 'FAIL'; current.checks.push({name: 'aborted', pass: false, error: detail.aborted}); }
  } finally {
    // ═══════════════════════ cleanup (always): Core fixtures, sessions, users, Torneos rows ═══════════════════════
    block('cleanup', {informative: true});
    await check('a bridge bearer issued before deletion is kept to prove it is refused once the QA users are gone', async () => {
      const u = users.owner; if (!u?.sessions?.length || !u.identity) return 'skipped';
      u.preDeleteBearer = bridgeToken(K1, identityOf(u)); return 'issued';
    });
    await check('Core: the owner deletes the run\'s Core team (DELETE /rest/v1/teams as the owner, RLS teams_delete_owner_only) and can no longer read it', async () => {
      const out = [];
      for (const team of coreFixtures.teams) {
        const s = users.owner?.sessions?.at(-1); if (!s) { out.push({id: team.id.slice(0, 8), deleted: false, reason: 'NO_OWNER_SESSION'}); continue; }
        const del = await coreRest(`/teams?id=eq.${team.id}&owner_user_id=eq.${team.ownerCoreUserId}&select=id`, s, {method: 'DELETE', prefer: 'return=representation'});
        const gone = await coreRest(`/teams?id=eq.${team.id}&select=id`, s);
        team.deleted = del.status === 200 && Array.isArray(del.body) && del.body.length === 1 && gone.status === 200 && Array.isArray(gone.body) && gone.body.length === 0;
        out.push({id: team.id.slice(0, 8), deleteStatus: del.status, deletedRows: Array.isArray(del.body) ? del.body.length : null, readAfter: Array.isArray(gone.body) ? gone.body.length : gone.status, deleted: team.deleted});
      }
      cleanup.coreFixtures = coreFixtures.teams.every((t) => t.deleted);
      assert(cleanup.coreFixtures, out); return out;
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
    await check('pre-deletion bearer → 401 through the gateway (no stale identity)', async () => {
      const t = users.owner?.preDeleteBearer; if (!t) return 'skipped';
      const r = await memberships(t); eq(r.status, 401, r.body); return r.status;
    });
    await check('Torneos: every row this run created removed in one count-verified transaction (registry + run slugs); catalog SHA unchanged; auth.users still 0', async () => {
      const identities = Object.values(users).map((u) => u.identity).filter(Boolean);
      const coreIds = Object.values(users).map((u) => u.coreUserId);
      const S = slugs(RUN);
      const discovered = psql(`select id from public.tournament_organizations where slug in (${lit(S.league)}, ${lit(S.other)}) order by created_at`).trim().split('\n').filter(Boolean);
      const res = cleanupFixtures({baseline: baseline.counts, orgs: [...new Set([...registry.orgs, ...discovered])], identities, coreUserIds: coreIds});
      cleanup.fixtures = res.ok; cleanup.detail.fixtures = {ok: res.ok, executed: res.executed, planned: res.planned, mismatches: res.mismatches, unplanned: res.unplanned, error: res.error, scope: res.scope, discoveredOrgs: discovered.length};
      cleanup.detail.registry = {flowCompleted: F !== null, counts: registry.counts(), orgs: registry.orgs};
      assert(res.ok, cleanup.detail.fixtures);
      eq(catalogSHA256(), baseline.catalogSHA256, 'catalog unchanged'); eq(sqlOne('select count(*) from auth.users'), '0', 'torneos auth.users');
      return {tables: res.planned?.length ?? 0, discoveredOrgs: discovered.length};
    });
    if (routes && originalRoutes) { try { cleanup.detail.routesRestored = (await routes()) === originalRoutes; } catch { cleanup.detail.routesRestored = null; } }
  }

  // ───────── artifacts ─────────
  artifacts.outage = artifact(writeEvidence('r5-outage', {...(outage ?? {status: 'NOT_RUN'}), run, stamp}, stamp));
  detail.rpcsExercised = [...exercised].sort(); detail.noStore = noStore;
  detail.baseline = {catalogSHA256: baseline.catalogSHA256, r2: {db: baseline.r2.db.id, rest: baseline.r2.rest.id}};
  const doc = assembleJourney({run, stamp, gatewayBundleSHA256: state.gatewayBundleSHA256, blocks, detail, cleanup, coreFixtures, artifacts, gatewayResponses: noStore.responses, outageTests: outage?.tests?.length ?? 0});
  doc.allowlistCount = allowed.length; doc.gatedCount = gated.length; doc.rpcsOutsideAllowlist = detail.rpcsExercised.filter((n) => !allowed.includes(n));
  return {doc, cleanup, artifacts};
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  let s = ''; for await (const c of process.stdin) s += c;
  const input = JSON.parse(s); s = '';
  const result = await runJourney(input);
  process.stdout.write(redact(JSON.stringify(result.doc)) + '\n');
  process.exitCode = result.doc.status === 'PASS' ? 0 : 1;
}
