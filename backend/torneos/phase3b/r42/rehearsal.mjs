// LOCAL rehearsal of the R4.2 producer pieces that do not need Core or the gateway: fixtures and
// count-verified cleanup on R2 (direct PostgREST on loopback with lab-signed bearers), the P0
// helpers, the token-variant expectations at the database contract, the 33-gate direct denial,
// the 43 null-argument dispatch shapes and the PGRST202 behaviour the attestation checks rely on.
// Leaves R2 exactly as found (counts + catalog SHA verified). No Core request, no Docker change.
import crypto from 'node:crypto';
import {repo, psql, sqlOne, lit, tableCounts, catalogSHA256, readJSON, registerSecret, guardedFetch, bridgeToken, tokenVariants, REST_ORIGIN, Stop, log, redact} from './lib.mjs';
import {buildFixtures, entryState, lastAudit, lastReview, cleanupFixtures, createRunRegistry} from './fixtures.mjs';

const ring = readJSON(repo + '/integration/torneos-isolated-local/.runtime/config.json');
for (const v of [ring.dbPassword, ring.writerPassword, ring.adapterPassword, ...ring.keys.map((k) => k.privateKey)]) registerSecret(v);
const K1 = ring.keys.find((k) => k.kid === ring.activeKid);
const http = guardedFetch([REST_ORIGIN]);
const rest = (path, {token, method = 'GET', body} = {}) => http(`${REST_ORIGIN}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
const RUN = 'rh' + crypto.randomBytes(2).toString('hex');
const results = [];
async function check(name, fn) { try { results.push({name, pass: true, detail: await fn()}); log(`PASS ${name}`); } catch (e) { results.push({name, pass: false, error: redact(String(e?.message ?? e)).slice(0, 400)}); log(`FAIL ${name}: ${redact(String(e?.message ?? e)).slice(0, 300)}`); } }
const assert = (ok, detail) => { if (!ok) throw new Error('ASSERT ' + JSON.stringify(detail ?? null).slice(0, 400)); };
const eq = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), {label, actual: a, expected: b});

const baseline = {counts: tableCounts(), catalog: catalogSHA256()};
const actors = {};
for (const role of ['owner', 'admin', 'member', 'outsider', 'captain']) {
  const a = {role, identity: crypto.randomUUID(), coreUserId: crypto.randomUUID(), sessionId: crypto.randomUUID(), email: `qa-r42-${RUN}-${role}@accounts.invalid`};
  a.tok = () => { if (!a.token || Date.now() - a.tokenAt > 80_000) { a.token = bridgeToken(K1, {sub: a.identity, coreUserId: a.coreUserId, sessionId: a.sessionId}); a.tokenAt = Date.now(); } return a.token; };
  actors[role] = a;
}
let F = null;
const registry = createRunRegistry(RUN);
try {
  await check('local identities inserted as torneos_identity_writer', async () => {
    for (const a of Object.values(actors)) psql(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(a.identity)}, ${lit(a.coreUserId)}); RESET ROLE;`);
    return Object.keys(actors).length;
  });
  const rpc = (name, actor, params = {}) => rest(`/rpc/${name}`, {token: actor.tok(), method: 'POST', body: params});
  await check('fixtures through the allowlisted RPCs (direct PostgREST, seeded acceptance)', async () => {
    F = await buildFixtures({rpc, actors, RUN, exercised: new Set(), registry});
    return {entries: Object.keys(F.entries).length, acceptance: F.acceptance.every((a) => a.seeded)};
  });
  await check('P0 approve via direct PostgREST + audit/review readers', async () => {
    const r = await rpc('review_tournament_team_entry', actors.owner, {p_organization_id: F.org, p_team_entry_id: F.entries.approve.entry, p_decision: 'approved', p_reason: 'rehearsal', p_issues: []});
    eq(r.status, 200, r.body);
    const s = entryState(F.entries.approve.entry); eq(s.entry.status, 'approved'); eq(s.players.map((p) => p.eligibility), ['eligible', 'eligible', 'eligible', 'eligible', 'eligible']);
    const a = lastAudit(F.entries.approve.entry); eq([a.action, a.actor_user_id], ['team_entry.approved', actors.owner.identity]);
    const v = lastReview(F.entries.approve.entry); eq(v.decision, 'approved');
    const deny = await rpc('review_tournament_team_entry', actors.member, {p_organization_id: F.org, p_team_entry_id: F.entries.matrix.entry, p_decision: 'approved', p_reason: 'rehearsal', p_issues: []});
    eq([deny.status, deny.body?.message], [403, 'TORNEOS_RESOURCE_FORBIDDEN']);
    const cross = await rpc('review_tournament_team_entry', actors.admin, {p_organization_id: F.org, p_team_entry_id: F.entries.bravo.entry, p_decision: 'approved', p_reason: 'rehearsal', p_issues: []});
    eq([cross.status, cross.body?.message], [403, 'TORNEOS_RESOURCE_FORBIDDEN']);
    return {approve: r.status, deny: deny.status, cross: cross.status};
  });
  await check('token variants at the database contract (direct PostgREST): every DB-covered variant → 401/403; typ/session_id format are gateway-only', async () => {
    const out = {};
    for (const v of tokenVariants(ring, {sub: actors.owner.identity, coreUserId: actors.owner.coreUserId, sessionId: actors.owner.sessionId})) {
      const r = await rest('/rpc/get_my_tournament_memberships', {token: v.token || undefined, method: 'POST', body: {}});
      out[v.name] = r.status;
      const dbCovered = !['typ_not_jwt', 'session_id_not_uuid', 'empty'].includes(v.name);
      if (dbCovered) assert([401, 403].includes(r.status), {variant: v.name, status: r.status, body: r.body});
    }
    return out;
  });
  await check('PGRST202 on an unknown argument (the attestation checks rely on it) and TORNEOS_CORE_ATTESTATION_REQUIRED without an attestation', async () => {
    const params = {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_query: `r42 ${RUN}`, p_limit: 8, p_team_entry_id: null};
    const extra = await rpc('search_tournament_players', actors.owner, {...params, p_extra: 1});
    assert([404, 400].includes(extra.status) && String(extra.body?.code).startsWith('PGRST'), extra);
    const req = await rpc('search_tournament_players', actors.owner, params);
    eq([req.status, req.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], req.body);
    const teams = await rpc('search_tournament_arma2_teams', actors.owner, {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_query: `r42 ${RUN}`, p_limit: 8});
    eq([teams.status, teams.body?.message], [403, 'TORNEOS_CORE_ATTESTATION_REQUIRED'], teams.body);
    return {extra: extra.body?.code, required: req.body?.message, teams: teams.body?.message};
  });
  const allowed = [...new Set(Object.values(readJSON(repo + '/backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json').features).flat())];
  const gated = readJSON(repo + '/backend/torneos/phase2d/staging-v1-rpc-gate.json').functions.map((f) => f.name);
  const argsOf = {};
  for (const line of psql(`select proname||'|'||coalesce(pg_get_function_arguments(oid),'') from pg_proc where pronamespace='public'::regnamespace and proname = any(array[${[...allowed, ...gated].map(lit).join(',')}]) order by 1`).trim().split('\n').filter(Boolean)) { const [n, a] = line.split('|'); if (!argsOf[n]) argsOf[n] = a; }
  const nullArgs = (name) => Object.fromEntries((argsOf[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((p) => [p.split(/\s+/)[0], null]));
  await check('33 gated: direct anon and authenticated → 42501 before body', async () => {
    const bad = [];
    for (const name of gated) {
      const anon = await rest(`/rpc/${name}`, {method: 'POST', body: nullArgs(name)});
      const auth = await rest(`/rpc/${name}`, {token: actors.owner.tok(), method: 'POST', body: nullArgs(name)});
      const before = (r) => [401, 403].includes(r.status) && r.body?.code === '42501' && /permission denied for function/.test(r.body?.message ?? '');
      if (!before(anon) || !before(auth)) bad.push({name, anon: anon.status, auth: auth.status, a: anon.body, b: auth.body});
    }
    eq(bad, []); return {gated: gated.length};
  });
  await check('43 allowlisted null-argument calls resolve at PostgREST (no PGRST202) — shapes for the gateway dispatch block', async () => {
    const out = {}, bad = [];
    for (const name of allowed) {
      const r = await rpc(name, actors.owner, nullArgs(name));
      out[name] = {status: r.status, code: r.body?.code ?? null, message: String(r.body?.message ?? '').slice(0, 60)};
      if (r.body?.code === 'PGRST202') bad.push(name);
    }
    eq(bad, []); return out;
  });
  await check('declared argument names for the real-argument calls', async () => {
    const want = ['get_tournament_workspace_context', 'get_tournament_competition_context', 'get_tournament_teams_context', 'get_team_registration_context', 'has_tournament_season_access', 'has_tournament_season_capability', 'has_tournament_organization_capability', 'has_tournament_capability', 'is_tournament_organization_member', 'is_tournament_organization_slug_available', 'tournament_role_capabilities', 'get_tournament_creation_eligibility', 'has_organization_consumed_free_tournament', 'can_read_tournament_team_entry', 'is_tournament_team_manager', 'search_tournament_arma2_teams'];
    return Object.fromEntries(want.map((n) => [n, argsOf[n]]));
  });
} finally {
  await check('cleanup: every run row removed, counts back to baseline, catalog SHA unchanged', async () => {
    const res = cleanupFixtures({baseline: baseline.counts, orgs: registry.orgs, identities: Object.values(actors).map((a) => a.identity), coreUserIds: Object.values(actors).map((a) => a.coreUserId), RUN});
    assert(res.ok, {executed: res.executed, mismatches: res.mismatches, unplanned: res.unplanned, error: res.error, planned: res.planned});
    eq(catalogSHA256(), baseline.catalog, 'catalog');
    return {planned: res.planned, catalog: baseline.catalog.slice(0, 16)};
  });
}
const pass = results.every((r) => r.pass);
console.log(JSON.stringify({pass, results}, null, 1));
process.exitCode = pass ? 0 : 1;
