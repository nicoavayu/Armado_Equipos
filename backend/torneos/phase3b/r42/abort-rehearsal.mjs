// LOCAL rehearsal of the cleanup path when buildFixtures() aborts MID-WAY (R4.2 20260918T224221Z: the
// third create_tournament_provisional_player answered 503, F stayed null, cleanup ran with orgs = [] and
// rolled back, leaving 98 rows / 21 tables). Direct PostgREST on R2 with lab-signed bearers; no Core, no
// gateway, no Docker change. Every scenario must leave R2 at the exact pre-run baseline (counts + catalog).
//   node backend/torneos/phase3b/r42/abort-rehearsal.mjs
import crypto from 'node:crypto';
import {repo, psql, lit, tableCounts, catalogSHA256, readJSON, registerSecret, guardedFetch, bridgeToken, REST_ORIGIN, Stop, log, redact} from './lib.mjs';
import {buildFixtures, cleanupFixtures, createRunRegistry, orgsBySlug} from './fixtures.mjs';

const ring = readJSON(repo + '/integration/torneos-isolated-local/.runtime/config.json');
for (const v of [ring.dbPassword, ring.writerPassword, ring.adapterPassword, ...ring.keys.map((k) => k.privateKey)]) registerSecret(v);
const K1 = ring.keys.find((k) => k.kid === ring.activeKid);
const http = guardedFetch([REST_ORIGIN]);
const rest = (path, {token, method = 'GET', body} = {}) => http(`${REST_ORIGIN}${path}`, {method, headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
const results = [];
async function check(name, fn) { try { results.push({name, pass: true, detail: await fn()}); log(`PASS ${name}`); } catch (e) { results.push({name, pass: false, error: redact(String(e?.message ?? e)).slice(0, 400)}); log(`FAIL ${name}: ${redact(String(e?.message ?? e)).slice(0, 300)}`); } }
const assert = (ok, detail) => { if (!ok) throw new Error('ASSERT ' + JSON.stringify(detail ?? null).slice(0, 400)); };
const eq = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), {label, actual: a, expected: b});

const baseline = {counts: tableCounts(), catalog: catalogSHA256()};
const atBaseline = () => { const now = tableCounts(); return Object.keys({...baseline.counts, ...now}).filter((t) => (now[t] ?? 0) !== (baseline.counts[t] ?? 0)); };
const nonBaselineRows = () => Object.entries(tableCounts()).filter(([t, n]) => n !== (baseline.counts[t] ?? 0)).map(([t, n]) => `${t}=${n}`);

function actorsFor(RUN) {
  const actors = {};
  for (const role of ['owner', 'admin', 'member', 'outsider', 'captain']) {
    const a = {role, identity: crypto.randomUUID(), coreUserId: crypto.randomUUID(), sessionId: crypto.randomUUID(), email: `qa-r42-${RUN}-${role}@accounts.invalid`};
    a.tok = () => { if (!a.token || Date.now() - a.tokenAt > 80_000) { a.token = bridgeToken(K1, {sub: a.identity, coreUserId: a.coreUserId, sessionId: a.sessionId}); a.tokenAt = Date.now(); } return a.token; };
    actors[role] = a;
  }
  return actors;
}
function seedIdentities(actors) { for (const a of Object.values(actors)) psql(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(a.identity)}, ${lit(a.coreUserId)}); RESET ROLE;`); }
/** Direct-PostgREST rpc that answers a synthetic 503 CORE_UNAVAILABLE on the n-th call of `failOn` (the R4.2 shape). */
function failingRpc({failOn, nth}) {
  let seen = 0;
  const rpc = async (name, actor, params = {}) => {
    if (name === failOn && ++seen === nth) return {status: 503, headers: {}, body: {error: 'CORE_UNAVAILABLE'}};
    return rest(`/rpc/${name}`, {token: actor.tok(), method: 'POST', body: params});
  };
  return rpc;
}
const identityScope = (actors) => ({identities: Object.values(actors).map((a) => a.identity), coreUserIds: Object.values(actors).map((a) => a.coreUserId)});

// ───────── Scenario A: the R4.2 failure (3rd provisional player → 503), old scope reproduces the bug, registry scope fixes it ─────────
{
  const RUN = 'ab' + crypto.randomBytes(3).toString('hex');
  const actors = actorsFor(RUN), registry = createRunRegistry(RUN);
  let F = null, aborted = null;
  await check('A1 fixture aborts mid-way (create_tournament_provisional_player #3 → 503): F stays null, registry already holds the created resources', async () => {
    seedIdentities(actors);
    try { F = await buildFixtures({rpc: failingRpc({failOn: 'create_tournament_provisional_player', nth: 3}), actors, RUN, exercised: new Set(), registry}); } catch (e) { aborted = e; }
    assert(F === null && aborted instanceof Stop && aborted.code === 'FIXTURE_RPC_FAILED', {F: F !== null, aborted: aborted?.message});
    const counts = registry.counts();
    eq(registry.orgs.length, 2, 'both organizations journaled');
    assert(counts.season === 2 && counts.tournament === 2 && counts.category === 2 && counts.team_entry >= 1 && counts.provisional_player === 2, counts);
    assert(nonBaselineRows().length > 0, 'rows exist on R2 after the abort');
    return {aborted: aborted.message.slice(0, 80), registry: counts, residueTables: nonBaselineRows().length};
  });
  await check('A2 negative control — the pre-fix scope (orgs from the null aggregate = []) cannot clean: count mismatch, rollback, rows remain', async () => {
    const res = cleanupFixtures({baseline: baseline.counts, orgs: [], ...identityScope(actors)});
    assert(res.ok === false && res.executed === true && /R42_CLEANUP_COUNT_MISMATCH/.test(res.error ?? '') && res.mismatches.length > 0, {ok: res.ok, executed: res.executed, error: res.error, mismatches: res.mismatches?.length});
    assert(nonBaselineRows().length > 0, 'rolled back: rows still there');
    return {mismatches: res.mismatches.length, error: res.error?.slice(0, 60)};
  });
  await check('A3 registry scope removes everything the aborted build created: exact baseline, catalog unchanged', async () => {
    const res = cleanupFixtures({baseline: baseline.counts, orgs: registry.orgs, ...identityScope(actors), RUN});
    assert(res.ok, {executed: res.executed, mismatches: res.mismatches, unplanned: res.unplanned, error: res.error});
    eq(atBaseline(), [], 'every table at its baseline count'); eq(catalogSHA256(), baseline.catalog, 'catalog');
    eq(res.scope.orgs.length, 2); eq(res.scope.discoveredOrgs.length, 2, 'slug reconciliation agrees with the registry');
    return {planned: res.planned.length, tables: res.planned};
  });
}
// ───────── Scenario B: earliest abort (2nd organization → 503): one org journaled, one membership seed never reached ─────────
{
  const RUN = 'ab' + crypto.randomBytes(3).toString('hex');
  const actors = actorsFor(RUN), registry = createRunRegistry(RUN);
  await check('B1 abort on the second create_tournament_organization: registry holds exactly one org; cleanup restores the baseline', async () => {
    seedIdentities(actors);
    let F = null; try { F = await buildFixtures({rpc: failingRpc({failOn: 'create_tournament_organization', nth: 2}), actors, RUN, exercised: new Set(), registry}); } catch {}
    assert(F === null && registry.orgs.length === 1, {F: F !== null, orgs: registry.orgs.length});
    const res = cleanupFixtures({baseline: baseline.counts, orgs: registry.orgs, ...identityScope(actors), RUN});
    assert(res.ok, {executed: res.executed, mismatches: res.mismatches, unplanned: res.unplanned, error: res.error});
    eq(atBaseline(), []); eq(catalogSHA256(), baseline.catalog, 'catalog');
    return {planned: res.planned};
  });
}
// ───────── Scenario C: registry unavailable (process crashed before cleanup): the run tag alone recovers the scope ─────────
{
  const RUN = 'ab' + crypto.randomBytes(3).toString('hex');
  const actors = actorsFor(RUN), registry = createRunRegistry(RUN);
  await check('C1 abort mid-way, then cleanup with an EMPTY org list and only the run tag: orgs rediscovered by slug, baseline restored', async () => {
    seedIdentities(actors);
    let F = null; try { F = await buildFixtures({rpc: failingRpc({failOn: 'submit_tournament_team_entry', nth: 2}), actors, RUN, exercised: new Set(), registry}); } catch {}
    assert(F === null, 'aborted');
    eq(orgsBySlug(RUN).length, 2, 'both orgs carry the run tag');
    const res = cleanupFixtures({baseline: baseline.counts, orgs: [], ...identityScope(actors), RUN});
    assert(res.ok, {executed: res.executed, mismatches: res.mismatches, unplanned: res.unplanned, error: res.error});
    eq(res.scope.discoveredOrgs.length, 2); eq(atBaseline(), []); eq(catalogSHA256(), baseline.catalog, 'catalog');
    return {planned: res.planned.length};
  });
}
await check('final: R2 exactly as found (counts + catalog SHA)', async () => { eq(atBaseline(), []); eq(catalogSHA256(), baseline.catalog); return {catalog: baseline.catalog.slice(0, 16), tables: Object.keys(baseline.counts).length}; });

const pass = results.every((r) => r.pass);
console.log(JSON.stringify({pass, results}, null, 1));
process.exitCode = pass ? 0 : 1;
