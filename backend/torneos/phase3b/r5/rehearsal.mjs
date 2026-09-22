// LOCAL rehearsal of the R5 owner journey on R2 (direct PostgREST on loopback with lab-signed bridge
// bearers): the SAME flow.mjs steps the live journey runs through the gateway, with the Core contracts
// replaced by attestations seeded exactly the way the adapter writes them (private.authorize_core_contract
// as torneos_core_adapter → request_hash → INSERT into private.core_contract_attestations) and a synthetic
// Core team. Purpose: prove the RPC sequence, its arguments and the count-verified cleanup BEFORE the single
// authorized live run. No Core request, no gateway, no Docker change; R2 left exactly as found.
import crypto from 'node:crypto';
import {repo, psql, psqlTry, lit, tableCounts, catalogSHA256, readJSON, registerSecret, guardedFetch, bridgeToken, decodeJwt, REST_ORIGIN, log, redact} from '../r42/lib.mjs';
import {cleanupFixtures, createRunRegistry} from '../r42/fixtures.mjs';
import {createFlow, slugs, FLOW_RPCS, assert, eq} from './flow.mjs';

const ring = readJSON(repo + '/integration/torneos-isolated-local/.runtime/config.json');
for (const v of [ring.dbPassword, ring.writerPassword, ring.adapterPassword, ...ring.keys.map((k) => k.privateKey)]) registerSecret(v);
const K1 = ring.keys.find((k) => k.kid === ring.activeKid);
const http = guardedFetch([REST_ORIGIN]);
const rest = (path, {token, method = 'GET', body} = {}) => http(`${REST_ORIGIN}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
const RUN = 'rh' + crypto.randomBytes(2).toString('hex');
const results = [];
async function check(name, fn) { try { results.push({name, pass: true, detail: await fn()}); log(`PASS ${name}`); } catch (e) { results.push({name, pass: false, error: redact(String(e?.message ?? e)).slice(0, 500)}); log(`FAIL ${name}: ${redact(String(e?.message ?? e)).slice(0, 400)}`); } }

const baseline = {counts: tableCounts(), catalog: catalogSHA256()};
const actors = {};
for (const role of ['owner', 'admin', 'captain', 'outsider']) {
  const a = {role, identity: crypto.randomUUID(), coreUserId: crypto.randomUUID(), sessionId: crypto.randomUUID(), email: `qa-r5-${RUN}-${role}@accounts.invalid`};
  // the adapter sets the FULL verified bridge claims (private.current_identity_id() checks iss/aud/jti/iat/exp/nbf too)
  a.claims = () => decodeJwt(a.tok());
  a.tok = () => { if (!a.token || Date.now() - a.tokenAt > 80_000) { a.token = bridgeToken(K1, {sub: a.identity, coreUserId: a.coreUserId, sessionId: a.sessionId}); a.tokenAt = Date.now(); } return a.token; };
  actors[role] = a;
}
const coreTeam = {id: crypto.randomUUID(), name: `QA R5 Team ${RUN}`, players: 0};
// The adapter's CONTRACTS[rpc].request(body) mapping (torneos-gateway/adapter.ts), replicated for seeding.
const CONTRACT_REQUEST = {
  accept_tournament_team_invitation: (b) => ['verified_email', {token: b.p_token}],
  search_tournament_players: (b) => ['directory_players', {organization_id: b.p_organization_id, tournament_id: b.p_tournament_id, team_entry_id: b.p_team_entry_id ?? null, query: b.p_query, limit: b.p_limit ?? 8}],
  search_tournament_arma2_teams: (b) => ['directory_teams', {organization_id: b.p_organization_id, tournament_id: b.p_tournament_id, query: b.p_query, limit: b.p_limit ?? 8}],
  create_tournament_team_entry: (b) => b.p_arma2_team_id ? ['team_snapshot', {organization_id: b.p_organization_id, tournament_id: b.p_tournament_id, category_id: b.p_category_id, core_team_id: b.p_arma2_team_id}] : null,
};
const now = () => Math.floor(Date.now() / 1000);
const seededResponse = {
  verified_email: () => ({verified: true, matches: true, checked_at: now()}),
  directory_players: () => ({items: [{core_user_id: actors.captain.coreUserId, display_name: `QA R5 captain ${RUN}`, avatar_url: null, positions: []}], next_cursor: null}),
  directory_teams: () => ({items: [{core_team_id: coreTeam.id, name: coreTeam.name, crest_url: null}], next_cursor: null}),
  team_snapshot: () => ({core_team_id: coreTeam.id, name: coreTeam.name, crest_url: null, players: [], source_revision: 1, captured_at: now()}),
};
/** Seed one attestation as the adapter role: local authorization first (same function, same hash), then the INSERT-only write. */
function seedAttestation(actor, contract, request) {
  const claims = JSON.stringify(actor.claims());
  const sql = `BEGIN; SET LOCAL ROLE torneos_core_adapter; SELECT set_config('request.jwt.claims', ${lit(claims)}, true);
    WITH a AS (SELECT private.authorize_core_contract(${lit(contract)}, ${lit(JSON.stringify(request))}::jsonb) AS auth)
    INSERT INTO private.core_contract_attestations (identity_id, session_id, contract, request_hash, response, observed_at)
    SELECT ${lit(actor.identity)}, ${lit(actor.sessionId)}, ${lit(contract)}, a.auth->>'request_hash', ${lit(JSON.stringify(seededResponse[contract]()))}::jsonb, now() FROM a; COMMIT;`;
  const r = psqlTry(sql);
  return r.ok ? {seeded: true} : {seeded: false, error: r.error};
}
/** Direct PostgREST rpc with the contract step in front of it, as the gateway would do; the outsider's
 * cross-user import is answered the way the live Core answers it (404 CORE_DENIED) without any write. */
async function rpc(name, actor, params = {}) {
  const map = CONTRACT_REQUEST[name]?.(params);
  if (map) {
    const [contract, request] = map;
    if (contract === 'team_snapshot' && actor.role === 'outsider') return {status: 404, body: {error: 'CORE_DENIED'}};
    const seeded = seedAttestation(actor, contract, request);
    if (!seeded.seeded) return {status: 403, body: {error: 'TORNEOS_RESOURCE_FORBIDDEN', seedError: seeded.error}};
  }
  return rest(`/rpc/${name}`, {token: actor.tok(), method: 'POST', body: params});
}

const registry = createRunRegistry(RUN);
const exercised = new Set();
let flow = null;
try {
  await check('local identities inserted as torneos_identity_writer (the live run allocates them at /exchange)', async () => {
    for (const a of Object.values(actors)) psql(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(a.identity)}, ${lit(a.coreUserId)}); RESET ROLE;`);
    return Object.keys(actors).length;
  });
  flow = createFlow({rpc, actors, RUN, registry, exercised});
  await check('workspace', flow.workspace);
  await check('seasons', flow.seasons);
  await check('tournaments', flow.tournaments);
  await check('collaborator', flow.collaborator);
  await check('team registration', flow.teamRegistration);
  await check('roster', flow.roster);
  await check('directory_players (seeded attestation)', flow.searchPlayers);
  await check('invitation (seeded verified_email)', flow.invitation);
  await check('core team import (seeded directory_teams + team_snapshot)', () => flow.coreTeamImport(coreTeam));
  await check('cross-user core team import refused (simulated Core NOT_FOUND → 404 CORE_DENIED, zero writes)', () => flow.coreTeamImportByOutsider(coreTeam, [404, 'CORE_DENIED']));
  await check('P0 review journey', flow.review);
  await check('collaborator seat revoked', flow.revokeCollaborator);
  await check('every RPC the flow dispatched is in FLOW_RPCS and every FLOW_RPCS name was exercised with a 200', async () => {
    const missing = FLOW_RPCS.filter((n) => !exercised.has(n));
    eq(missing, [], 'unexercised planned RPCs'); return {exercised: exercised.size};
  });
} finally {
  await check('cleanup: every run row removed (registry + run slugs), counts back to baseline, catalog SHA unchanged', async () => {
    const S = slugs(RUN);
    const discovered = psql(`select id from public.tournament_organizations where slug in (${lit(S.league)}, ${lit(S.other)})`).trim().split('\n').filter(Boolean);
    const res = cleanupFixtures({baseline: baseline.counts, orgs: [...new Set([...registry.orgs, ...discovered])], identities: Object.values(actors).map((a) => a.identity), coreUserIds: Object.values(actors).map((a) => a.coreUserId)});
    assert(res.ok, {executed: res.executed, mismatches: res.mismatches, unplanned: res.unplanned, error: res.error, planned: res.planned});
    eq(catalogSHA256(), baseline.catalog, 'catalog');
    return {planned: res.planned, registry: registry.counts()};
  });
}
const pass = results.every((r) => r.pass);
console.log(JSON.stringify({pass, RUN, results}, null, 1));
process.exitCode = pass ? 0 : 1;
