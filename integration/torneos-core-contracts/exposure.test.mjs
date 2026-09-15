// Phase 2D — STAGING RPC EXPOSURE GATE on the REAL local Supabase stack (the Phase 3A/2C lab):
//
//   * the 33 SECURITY DEFINER RPCs that stayed INCONCLUSIVE / NOT_EXERCISED: ACL before/after,
//     direct PostgREST DENY (anon + authenticated) and gateway DENY (valid Core session) for the
//     32 whose feature is OFF in staging v1, plus the one parent path that reached one of them;
//   * functional certification of review_tournament_team_entry (the P0) on a real fixture built
//     through the allowlisted RPCs, with the full actor matrix, invalid payload/roster, no partial
//     writes and audit; the approve/reject wrappers (service_role-only) are certified at the ACL
//     and at the SQL level;
//   * static consistency of the staging v1 allowlist vs the gate vs the live ACL.
//
// Runs after `npm run up` on a lab rebuilt from empty database volumes. Every check is a named
// subtest; results go to evidence/exposure-*.json. Nothing touches a remote target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { SignJWT, importPKCS8, decodeJwt } from 'jose';
import { config, sql, sqlTry, inGateway, BASE, repo } from './lab.mjs';

const cfg = await config();
const results = [];
const seenSecrets = [];
const API = ['anon', 'authenticated', 'service_role'];
const RUN = 'p2d' + randomBytes(2).toString('hex');
const torneosSql = (q) => sql('torneos-db', q);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const inventorySql = await readFile(`${repo}backend/torneos/phase2c/acl-inventory.sql`, 'utf8');
const migrationsDir = `${repo}backend/torneos/supabase/migrations/`;
const baselineSql = await readFile(`${migrationsDir}00000000000000_torneos_baseline_v1.sql`, 'utf8');
const gateSql = await readFile(`${migrationsDir}00000000000001_staging_v1_rpc_exposure.sql`, 'utf8');
const gate = JSON.parse(await readFile(`${repo}backend/torneos/phase2d/staging-v1-rpc-gate.json`, 'utf8'));
const allowlistDoc = JSON.parse(await readFile(`${repo}backend/torneos/phase2d/staging-v1-rpc-allowlist.json`, 'utf8'));
const ALLOW = Object.values(allowlistDoc.features).flat();
const ledger = JSON.parse(await readFile(`${repo}backend/torneos/phase3a/inconclusive-ledger.json`, 'utf8'));
const review = JSON.parse(await readFile(`${repo}backend/torneos/evidence/security-definer-review.json`, 'utf8'));
const sweep = JSON.parse(await readFile(`${repo}backend/torneos/phase2b/season-scope-sweep.json`, 'utf8'));
const realImage = JSON.parse(await readFile(`${repo}backend/torneos/phase2d/evidence/real-image-acl-diff.json`, 'utf8'));
const P0 = 'review_tournament_team_entry';
const OFF = ledger.functions.map(f => f.function.split('(')[0]).filter(n => n !== P0);
const GATED = gate.functions.map(g => g.name);
const PARENTS = gate.functions.filter(g => g.area === 'parent path').map(g => g.name);

// ---------------------------------------------------------------- transport helpers
/** Through the published gateway (host loopback), like a staging client. */
async function request(path, token, method = 'GET', data) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: data !== undefined ? JSON.stringify(data) : undefined });
  const text = await r.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}
const gw = (name, token, params = {}) => request(`/torneos/rest/v1/rpc/${name}`, token, 'POST', params);
/** Direct PostgREST calls from INSIDE the private network (attacker position, no gateway), batched in one exec. */
function restBatch(calls) {
  const out = inGateway(`const calls = ${JSON.stringify(calls)}; const out = [];
    for (const c of calls) {
      const r = await fetch('http://torneos-rest:3000' + c.path, { method: c.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...(c.token ? { authorization: 'Bearer ' + c.token } : {}) },
        body: (c.method ?? 'POST') === 'GET' ? undefined : JSON.stringify(c.body ?? {}) });
      const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
      out.push({ id: c.id, status: r.status, body });
    }
    console.log(JSON.stringify(out));`);
  return JSON.parse(out.trim().split('\n').pop());
}
const direct = (name, token, body = {}) => restBatch([{ id: name, path: `/rpc/${name}`, token, body }])[0];
function nullArgs(argString) {
  const args = {};
  for (const part of argString.split(',').map(s => s.trim()).filter(Boolean)) args[part.split(/\s+/)[0]] = null;
  return args;
}
const deniedBeforeBody = (r) => [401, 403].includes(r.status) && r.body?.code === '42501' && /permission denied for function/.test(r.body?.message ?? '');

// ---------------------------------------------------------------- identity helpers
/** Local identity with a lab-signed bridge bearer: valid for PostgREST directly (JWKS + check_token), no Core session. */
async function localActor(label) {
  const id = { label, identity: randomUUID(), coreUserId: randomUUID() };
  torneosSql(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(id.identity)}, ${lit(id.coreUserId)}); RESET ROLE;`);
  id.token = await bearer(id);
  return id;
}
async function bearer(actor, sessionId = randomUUID()) {
  const key = cfg.keys.find(k => k.kid === cfg.activeKid);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: 'authenticated', core_user_id: actor.coreUserId, session_id: sessionId })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: key.kid }).setIssuer('urn:arma2:local:identity-bridge').setAudience('arma2-torneos-local')
    .setSubject(actor.identity).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120).setJti(randomUUID())
    .sign(await importPKCS8(key.privateKey, 'RS256'));
  seenSecrets.push(token);
  return token;
}
/** Real Core user: GoTrue signup + server-side exchange → identity allocated by the gateway, live Core session. */
async function coreActor(label) {
  const email = `p2d-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const s = await request('/auth/v1/signup', null, 'POST', { email, password, data: { full_name: `${RUN} ${label}` } });
  assert.equal(s.status, 200, `local GoTrue signup for ${label}`);
  seenSecrets.push(s.body.access_token, s.body.refresh_token, password);
  const u = { label, email, coreToken: s.body.access_token, coreUserId: s.body.user.id };
  await exchange(u);
  return u;
}
async function exchange(u) {
  const r = await request('/exchange', u.coreToken, 'POST');
  assert.equal(r.status, 200, `exchange for ${u.label}`);
  seenSecrets.push(r.body.access_token);
  u.token = r.body.access_token; u.tokenAt = Date.now(); u.claims = decodeJwt(u.token); u.identity = u.claims.sub;
  return u.token;
}
async function tok(u) { if (!u.token || Date.now() - u.tokenAt > 80_000) await exchange(u); return u.token; }
/** SQL-level call as a database role with the actor's bridge claims (server position); returns the last result line or throws the SQL error. */
function asRole(role, claims, query) {
  const r = sqlTry('torneos-db', `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true); ${query}; COMMIT;`);
  if (!r.ok) throw new Error(r.error);
  return r.out.trim().split('\n').pop();
}
function sqlErr(fn) { try { fn(); return null; } catch (e) { return String(e.message ?? e); } }

// ---------------------------------------------------------------- state snapshots (no partial writes)
function entryState(entryId) {
  return JSON.parse(torneosSql(`select json_build_object(
    'entry', (select json_build_object('status', e.status, 'reviewed_by', e.reviewed_by, 'reviewed_at', e.reviewed_at, 'approved_at', e.approved_at, 'rejected_at', e.rejected_at) from public.tournament_team_entries e where e.id = ${lit(entryId)}),
    'rosters', (select json_agg(json_build_object('id', r.id, 'version', r.version, 'status', r.status, 'approved_at', r.approved_at) order by r.version) from public.tournament_rosters r where r.team_entry_id = ${lit(entryId)}),
    'players', (select json_agg(json_build_object('shirt', p.shirt_number, 'status', p.status, 'eligibility', p.eligibility_status) order by p.shirt_number) from public.tournament_roster_players p where p.team_entry_id = ${lit(entryId)}),
    'reviews', (select count(*) from public.tournament_team_reviews v where v.team_entry_id = ${lit(entryId)}),
    'audit', (select count(*) from public.tournament_audit_log a where a.team_entry_id = ${lit(entryId)} and a.action like 'team_entry.%' and a.action <> 'team_entry.created' and a.action <> 'team_entry.updated' and a.action <> 'team_entry.submitted')
  )`));
}
function lastReview(entryId) {
  return JSON.parse(torneosSql(`select coalesce((select json_build_object('decision', v.decision, 'reason', v.reason, 'issues', v.issues, 'created_by', v.created_by, 'roster_id', v.roster_id, 'organization_id', v.organization_id) from public.tournament_team_reviews v where v.team_entry_id = ${lit(entryId)} order by v.created_at desc limit 1), 'null'::json)`));
}
function lastAudit(entryId) {
  return JSON.parse(torneosSql(`select coalesce((select json_build_object('action', a.action, 'resource_type', a.resource_type, 'resource_id', a.resource_id, 'team_entry_id', a.team_entry_id, 'tournament_id', a.tournament_id, 'actor_user_id', a.actor_user_id, 'actor_type', a.actor_type, 'metadata', a.metadata) from public.tournament_audit_log a where a.team_entry_id = ${lit(entryId)} and a.action in ('team_entry.approved','team_entry.rejected','team_entry.changes_requested') order by a.id desc limit 1), 'null'::json)`));
}

test('Phase 2D — staging RPC exposure gate on the real Supabase stack', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  const evidence = { acl33: null, gatewaySweep: null, directSweep: null, p0: [], exercised: new Set(), coverage: {} };
  const record = (matrixRow) => evidence.p0.push(matrixRow);
  let inventory, fnByName, argsOf, install;
  try {
    // ================================================================ A. install / lab shape
    await check('install: Phase 2D baseline + staging v1 gate installed from empty real Supabase database volumes; gateway carries the allowlist', async () => {
      install = JSON.parse(await readFile('.runtime/install.json', 'utf8'));
      const sha = createHash('sha256').update(baselineSql).digest('hex');
      assert.equal(install.torneos.sha256, sha, 'lab installed the candidate in this tree');
      assert.equal(install.torneos.certified_sha256, sha, 'candidate hash equals the Phase 2B recert install record');
      assert.equal(install.torneos.installed, true, 'baseline installed by this lab from an empty volume');
      assert.match(sha, /^f857bd09/, 'Phase 2D baseline (P0 season guard)');
      assert.deepEqual(install.torneos.migrations_after_baseline.map(m => [m.file, m.sha256, m.applied]),
        [['backend/torneos/supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql', createHash('sha256').update(gateSql).digest('hex'), true]]);
      assert.deepEqual((await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort(), ['00000000000000_torneos_baseline_v1.sql', '00000000000001_staging_v1_rpc_exposure.sql']);
      // The P0 body installed in the database carries the Phase 2D season guard.
      const def = torneosSql(`select pg_get_functiondef('public.${P0}(uuid,uuid,text,text,jsonb)'::regprocedure)`);
      assert.match(def, /has_tournament_season_access\(p_organization_id, \(select e\.season_id from public\.tournament_team_entries e where e\.id = p_team_entry_id/);
      // The gateway container mounts exactly the committed allowlist.
      const mounted = inGateway(`import { readFile } from 'node:fs/promises'; console.log(await readFile('/lab/staging-v1-rpc-allowlist.json', 'utf8'));`);
      assert.deepEqual(JSON.parse(mounted), allowlistDoc);
      const openapi = restBatch([{ id: 'root', path: '/', method: 'GET' }])[0];
      assert.equal(openapi.status, 200); assert.ok(openapi.body?.openapi || openapi.body?.swagger, 'real PostgREST answers on the Data API');
    });
    // ================================================================ B. ACL of the 33 (+ parent): before (992dd282, measured) / after (live)
    await check('acl: the 33 INCONCLUSIVE + the parent path — before (992dd282 on the real image) vs after (live stack): only review keeps authenticated EXECUTE; anon none; service_role kept; no adapter/writer grants', async () => {
      inventory = JSON.parse(torneosSql(inventorySql));
      fnByName = new Map(inventory.functions.map(f => [f.function, f]));
      argsOf = new Map(JSON.parse(torneosSql("select json_agg(json_build_object('f', p.oid::regprocedure::text, 'a', pg_get_function_identity_arguments(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'")).map(x => [x.f, x.a]));
      assert.equal(realImage.before_commit, '992dd282');
      assert.deepEqual(Object.entries(realImage.checks).filter(([, v]) => !v), [], 'phase2d/exposure_acl.py checks all true');
      const before = new Map(realImage.focus_functions.map(r => [r.function, r]));
      const docs = restBatch([{ id: 'anon', path: '/', method: 'GET' }]);
      const anonPaths = new Set(Object.keys(docs[0].body.paths ?? {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)));
      const rows = [];
      for (const f of [...ledger.functions.map(x => x.function), ...gate.functions.filter(g => g.area === 'parent path').map(g => g.function)]) {
        const live = fnByName.get(f); const was = before.get(f);  // regprocedure text omits the public schema
        assert.ok(live && was, f);
        const name = f.split('(')[0];
        rows.push({ function: f, name, security_definer: live.security_definer, owner: live.owner,
          before_992dd282: { anon: was.before.anon, authenticated: was.before.authenticated, service_role: was.before.service_role, adapter: was.before.torneos_core_adapter, writer: was.before.torneos_identity_writer, postgrest_exposed_to: was.before.postgrest_exposed_to },
          after_live: { anon: live.anon, authenticated: live.authenticated, service_role: live.service_role, adapter: live.torneos_core_adapter, writer: live.torneos_identity_writer, postgrest_exposed_to: API.filter(r => live[r]), anon_openapi: anonPaths.has(name) },
          gated: GATED.includes(name), staging_v1: name === P0 ? 'CERTIFIED (allowlisted)' : 'SERVER-SIDE DISABLED (DB REVOKE + gateway allowlist)' });
      }
      for (const r of rows) {
        assert.equal(r.before_992dd282.authenticated, true, `${r.function}: authenticated could execute it at 992dd282`);
        assert.equal(r.before_992dd282.anon, false, `${r.function}: anon never had it`);
        assert.equal(r.after_live.authenticated, r.name === P0, `${r.function}: authenticated EXECUTE after the gate`);
        assert.equal(r.after_live.anon, false); assert.equal(r.after_live.anon_openapi, false);
        assert.equal(r.after_live.service_role, true, `${r.function}: service_role keeps EXECUTE`);
        assert.deepEqual([r.after_live.adapter, r.after_live.writer], [false, false]);
        assert.equal(r.security_definer, true); assert.equal(r.owner, 'supabase_admin');
        assert.equal(r.gated, r.name !== P0);
      }
      assert.equal(rows.length, 34);
      evidence.acl33 = rows;
      // Whole-catalog counts: exactly the 33 gated functions moved, nothing else (measured on the real image by exposure_acl.py).
      assert.equal(realImage.runs['after-real'].execute.authenticated.public_functions, realImage.runs['before-real'].execute.authenticated.public_functions - GATED.length);
      assert.equal(inventory.functions.filter(f => f.schema === 'public' && f.authenticated).length, realImage.runs['after-real'].execute.authenticated.public_functions);
      assert.equal(inventory.functions.filter(f => f.schema === 'public' && f.anon).length, 12);
    });
    // ================================================================ C. allowlist ↔ gate ↔ ACL consistency
    await check('allowlist: staging v1 RPC allowlist is disjoint from the gate, executable by authenticated, and every entry except the P0 carries a positive Phase 2B verdict', async () => {
      assert.equal(new Set(ALLOW).size, ALLOW.length, 'no duplicates');
      assert.deepEqual(ALLOW.filter(n => GATED.includes(n)), [], 'no gated RPC is allowlisted');
      assert.deepEqual(ALLOW.filter(n => OFF.includes(n)), [], 'no OFF RPC is allowlisted');
      assert.ok(ALLOW.includes(P0), 'the certified P0 is allowlisted');
      const verdicts = new Map(sweep.results.map(r => [r.function.split('(')[0], r]));
      const categories = new Map(review.functions.map(f => [f.name, f.category]));
      for (const n of ALLOW) {
        const live = inventory.functions.filter(f => f.schema === 'public' && f.name === n);
        assert.ok(live.length, `${n} exists`);
        assert.ok(live.every(f => f.authenticated), `${n} executable by authenticated`);
        assert.ok(!['SERVICE_ONLY', 'INTERNAL', 'TRIGGER', 'ADAPTER_ONLY'].includes(categories.get(n)), `${n}: client category (${categories.get(n)})`);
        if (n !== P0) assert.notEqual(verdicts.get(n)?.verdict, 'INCONCLUSIVE', `${n}: not INCONCLUSIVE in Phase 2B`);
      }
      // Wrappers are service_role-only in the baseline and are not allowlisted.
      for (const w of ['approve_tournament_team_entry', 'reject_tournament_team_entry']) {
        assert.ok(!ALLOW.includes(w)); assert.equal(categories.get(w), 'SERVICE_ONLY');
        const f = inventory.functions.find(x => x.name === w); assert.deepEqual([f.anon, f.authenticated, f.service_role], [false, false, true]);
      }
      // Gate manifest ↔ migration file ↔ ledger.
      assert.equal(gate.functions.length, 33); assert.equal(GATED.filter(n => OFF.includes(n)).length, 32);
      assert.deepEqual(PARENTS, ['auto_schedule_tournament_matches']);
      for (const g of gate.functions) assert.ok(gateSql.includes(`REVOKE EXECUTE ON FUNCTION public.${g.name}(${g.identity_arguments}) FROM anon, authenticated;`), g.name);
      assert.equal((gateSql.match(/^REVOKE EXECUTE ON FUNCTION/gm) ?? []).length, 33);
      // Parent paths recomputed here from the installed baseline: a client-executable RPC whose body reaches an OFF function.
      const bodies = new Map(JSON.parse(torneosSql("select json_agg(json_build_object('n', p.proname, 'b', p.prosrc)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'")).map(x => [x.n, (x.b ?? '')]));
      const before = new Map(realImage.focus_functions.map(r => [r.function.split('(')[0], r]));
      const callees = (n) => [...new Set([...(bodies.get(n) ?? '').matchAll(/public\.([a-z0-9_]+)\(/g)].map(m => m[1]).filter(c => bodies.has(c) && c !== n))];
      const reaches = (start) => { const seen = new Set([start]); const stack = [start]; while (stack.length) { for (const c of callees(stack.pop())) { if (OFF.includes(c)) return true; if (!seen.has(c)) { seen.add(c); stack.push(c); } } } return false; };
      const clientExecutableAt992 = JSON.parse(await readFile(`${repo}backend/torneos/phase2d/evidence/real-image-acl-before-real.json`, 'utf8')).inventory.functions.filter(f => f.schema === 'public' && (f.anon || f.authenticated)).map(f => f.name);
      const parents = [...new Set(clientExecutableAt992)].filter(n => !OFF.includes(n) && reaches(n)).sort();
      assert.deepEqual(parents, PARENTS, 'every client-reachable parent path is gated');
      assert.ok(before.get('auto_schedule_tournament_matches').before.authenticated, 'parent was executable at 992dd282');
    });

    // ================================================================ D. P0 fixture through the allowlisted RPCs (real gateway, real Core owner session)
    const owner = await coreActor('owner');            // real Core session → gateway path
    const adminA = await localActor('admin-season-a'); // assigned to season A only
    const adminB = await localActor('admin-season-b'); // assigned to season B only
    const adminNone = await localActor('admin-unassigned');
    const outsider = await coreActor('outsider');       // owner of another workspace
    const captain = await localActor('captain');
    let org, org2, seasonA, seasonB, tournamentA, tournamentB, categoryA, categoryB, membershipA, membershipB;
    const ok = async (name, params, who = owner) => {
      const r = await gw(name, await tok(who), params);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
      evidence.exercised.add(name);
      return r.body;
    };
    await check('fixture: organization, two seasons, two tournaments in registration, categories and collaborators through the allowlisted RPCs (gateway, real Core session)', async () => {
      org = (await ok('create_tournament_organization', { p_name: 'Phase 2D League', p_slug: `p2d-league-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
      org2 = (await ok('create_tournament_organization', { p_name: 'Phase 2D Other', p_slug: `p2d-other-${RUN}`, p_idempotency_key: randomUUID() }, outsider)).organization.id;
      seasonA = (await ok('create_tournament_season', { p_organization_id: org, p_name: 'Season Alpha', p_slug: `alpha-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      seasonB = (await ok('create_tournament_season', { p_organization_id: org, p_name: 'Season Bravo', p_slug: `bravo-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      const mkTournament = async (season, slug) => {
        const tnt = await ok('create_tournament_with_defaults', { p_organization_id: org, p_season_id: season, p_name: `Copa ${slug}`, p_slug: `${slug}-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() });
        const cat = await ok('save_tournament_category', { p_organization_id: org, p_tournament_id: tnt.id, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' });
        const st = await ok('change_tournament_status', { p_organization_id: org, p_tournament_id: tnt.id, p_status: 'registration' });
        assert.equal(st.status, 'registration', JSON.stringify(st));
        return [tnt.id, cat.id];
      };
      [tournamentA, categoryA] = await mkTournament(seasonA, 'alpha');
      [tournamentB, categoryB] = await mkTournament(seasonB, 'bravo');
      // Collaborators: membership rows have no RPC (table under RLS); the season seat is the RPC.
      for (const a of [adminA, adminB, adminNone]) torneosSql(`insert into public.tournament_organization_members(organization_id,user_id,role,joined_at) values (${lit(org)},${lit(a.identity)},'admin',now())`);
      const membership = (a) => torneosSql(`select id from public.tournament_organization_members where organization_id=${lit(org)} and user_id=${lit(a.identity)}`).trim();
      membershipA = membership(adminA); membershipB = membership(adminB);
      await ok('assign_tournament_season_member', { p_organization_id: org, p_season_id: seasonA, p_membership_id: membershipA });
      await ok('assign_tournament_season_member', { p_organization_id: org, p_season_id: seasonB, p_membership_id: membershipB });
      const seats = await ok('list_tournament_season_member_assignments', { p_organization_id: org, p_season_id: seasonA });
      assert.ok(JSON.stringify(seats).includes(membershipA) && !JSON.stringify(seats).includes(membershipB), 'season A seat holds admin A only');
      assert.equal(torneosSql(`select organization.status || ',' || t.status || ',' || c.status from public.tournament_organizations organization join public.tournaments t on t.organization_id = organization.id join public.tournament_categories c on c.tournament_id = t.id where t.id = ${lit(tournamentA)}`).trim(), 'active,registration,active');
    });
    /** A submitted team entry: manual entry → in_progress → 5 provisional players (1 GK, unique shirts, valid positions) → manager → submit (validation). */
    async function submittedEntry(tournament, category, name) {
      const created = await ok('create_tournament_team_entry', { p_organization_id: org, p_tournament_id: tournament, p_category_id: category, p_arma2_team_id: null, p_name: name, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      const entry = created.entryId, roster = created.rosterId;
      assert.equal(created.status, 'draft');
      assert.equal((await ok('update_tournament_team_entry', { p_organization_id: org, p_team_entry_id: entry, p_patch: { shortName: name.slice(0, 3).toUpperCase() } })).status, 'in_progress');
      const players = [['Arquero Uno', 1, 'ARQ', true], ['Defensor Dos', 2, 'DEF', false], ['Volante Tres', 3, 'MED', false], ['Delantero Cuatro', 4, 'DEL', false], ['Defensor Cinco', 5, 'DEF', false]];
      for (const [display, shirt, position, gk] of players) {
        const prov = await ok('create_tournament_provisional_player', { p_organization_id: org, p_team_entry_id: entry, p_display_name: `${display} ${RUN}` });
        const added = await ok('add_tournament_roster_player', { p_organization_id: org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: null, p_provisional_player_id: prov.id, p_display_name: `${display} ${RUN}`, p_avatar_url: null, p_shirt_number: shirt, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: gk });
        assert.equal(added.status, 'active');
      }
      const invite = await ok('invite_tournament_team_manager', { p_organization_id: org, p_team_entry_id: entry, p_email: `captain-${RUN}-${entry.slice(0, 8)}@example.test`, p_display_name: 'Captain', p_role: 'captain' });
      seenSecrets.push(invite.token);
      // Accepting the invitation is the Core verified-email contract certified in Phase 3A; here the accepted state is seeded.
      torneosSql(`update public.tournament_team_managers set user_id=${lit(captain.identity)}, status='active', accepted_at=now() where team_entry_id=${lit(entry)} and status='pending'`);
      const submitted = await ok('submit_tournament_team_entry', { p_organization_id: org, p_team_entry_id: entry });
      assert.equal(submitted.status, 'submitted'); assert.equal(submitted.validation.valid, true, JSON.stringify(submitted.validation));
      assert.deepEqual(submitted.validation.counts, { players: 5, goalkeepers: 1, minimumPlayers: 5, maximumPlayers: 8 });
      return { entry, roster };
    }
    const E = {};
    await check('fixture: submitted team entries with a valid roster (5 eligible players, unique shirts, valid positions, 1 goalkeeper, roster settings, active manager) built through the allowlisted RPCs', async () => {
      E.matrix = await submittedEntry(tournamentA, categoryA, 'Matrix FC');
      E.approve = await submittedEntry(tournamentA, categoryA, 'Approve FC');
      E.changes = await submittedEntry(tournamentA, categoryA, 'Changes FC');
      E.reject = await submittedEntry(tournamentA, categoryA, 'Reject FC');
      E.invalid = await submittedEntry(tournamentA, categoryA, 'Invalid FC');
      E.bravo = await submittedEntry(tournamentB, categoryB, 'Bravo FC');
      E.wrapApprove = await submittedEntry(tournamentA, categoryA, 'Wrapper Approve');
      E.wrapReject = await submittedEntry(tournamentA, categoryA, 'Wrapper Reject');
      const s = entryState(E.matrix.entry);
      assert.equal(s.entry.status, 'submitted'); assert.deepEqual(s.rosters.map(r => r.status), ['submitted']);
      assert.deepEqual(s.players.map(p => [p.shirt, p.status, p.eligibility]), [[1, 'active', 'pending'], [2, 'active', 'pending'], [3, 'active', 'pending'], [4, 'active', 'pending'], [5, 'active', 'pending']]);
      assert.equal(torneosSql(`select minimum_players||','||maximum_players||','||minimum_goalkeepers||','||unique_shirt_numbers||','||require_individual_player_approval from public.tournament_roster_settings where tournament_id=${lit(tournamentA)}`).trim(), '5,8,1,true,false');
      assert.deepEqual([s.reviews, s.audit], [0, 0]);
    });
    const reviewCall = (token, entry, decision, reason = 'Phase 2D review reason', issues = [], organization = org) =>
      direct(P0, token, { p_organization_id: organization, p_team_entry_id: entry, p_decision: decision, p_reason: reason, p_issues: issues });
    const unchanged = (before, after, label) => assert.deepEqual(after, before, `${label}: no partial writes`);
    // ---------------------------------------------------------------- D1. DENY matrix (no writes)
    await check('P0 deny: admin without a season seat, admin seated on another season, another workspace owner (both org ids), wrong org id, anon — TORNEOS_RESOURCE_FORBIDDEN / 42501, zero writes', async () => {
      const before = entryState(E.matrix.entry);
      const cases = [
        ['admin unassigned (member, no season seat)', reviewCall(adminNone.token, E.matrix.entry, 'approved')],
        ['admin seated on season B reviews a season A entry', reviewCall(adminB.token, E.matrix.entry, 'approved')],
        ['admin seated on season B, changes_requested on season A entry', reviewCall(adminB.token, E.matrix.entry, 'changes_requested')],
        ['admin seated on season B, rejected on season A entry', reviewCall(adminB.token, E.matrix.entry, 'rejected')],
        ['other workspace owner with the entry\'s org id', reviewCall(await tok(outsider), E.matrix.entry, 'approved')],
        ['other workspace owner with their own org id', reviewCall(await tok(outsider), E.matrix.entry, 'approved', undefined, [], org2)],
        ['owner with a foreign org id', reviewCall(await tok(owner), E.matrix.entry, 'approved', undefined, [], org2)],
        ['admin A on season B entry (cross-season, seat elsewhere)', reviewCall(adminA.token, E.bravo.entry, 'approved')],
      ];
      for (const [label, r] of cases) {
        assert.equal(r.status, 403, `${label}: ${JSON.stringify(r.body)}`); assert.equal(r.body.message, 'TORNEOS_RESOURCE_FORBIDDEN', label);
        record({ actor: label, decision: 'approved', result: 'DENY', status: r.status, message: r.body.message });
      }
      const anon = reviewCall(undefined, E.matrix.entry, 'approved');
      assert.ok(deniedBeforeBody(anon), `anon: ${JSON.stringify(anon.body)}`);
      record({ actor: 'anon (direct PostgREST)', decision: 'approved', result: 'DENY', status: anon.status, message: anon.body.message });
      const anonGw = await gw(P0, null, {});
      assert.equal(anonGw.status, 401, 'anon through the gateway has no RPC path');
      record({ actor: 'anon (gateway)', decision: 'approved', result: 'DENY', status: anonGw.status, message: anonGw.body.error });
      unchanged(before, entryState(E.matrix.entry), 'deny matrix'); unchanged(entryState(E.bravo.entry).entry.status, 'submitted', 'bravo');
    });
    // ---------------------------------------------------------------- D2. invalid payload (no writes)
    await check('P0 invalid payload: unknown decision, short/long reason, non-array issues → 22023 TORNEOS_INVALID_REVIEW; missing entry / non-submitted entry → forbidden; zero writes', async () => {
      const before = entryState(E.matrix.entry);
      for (const [label, r] of [
        ['decision "maybe"', reviewCall(await tok(owner), E.matrix.entry, 'maybe')],
        ['reason too short', reviewCall(await tok(owner), E.matrix.entry, 'approved', 'no')],
        ['reason too long', reviewCall(await tok(owner), E.matrix.entry, 'approved', 'x'.repeat(1201))],
        ['issues is an object', reviewCall(await tok(owner), E.matrix.entry, 'changes_requested', 'valid reason', { code: 'x' })],
      ]) {
        assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.body)}`); assert.equal(r.body.message, 'TORNEOS_INVALID_REVIEW', label);
        record({ actor: 'owner', payload: label, result: 'REJECTED_22023', status: r.status, message: r.body.message });
      }
      const missing = reviewCall(await tok(owner), randomUUID(), 'approved');
      assert.equal(missing.status, 403); assert.equal(missing.body.message, 'TORNEOS_RESOURCE_FORBIDDEN');
      unchanged(before, entryState(E.matrix.entry), 'invalid payload');
    });
    // ---------------------------------------------------------------- D3. invalid roster (approve refused atomically)
    await check('P0 invalid roster: goalkeeper removed after submission → approve fails 23514 TORNEOS_ROSTER_INCOMPLETE with the validation detail; entry, roster, players, reviews and audit untouched', async () => {
      torneosSql(`update public.tournament_roster_players set status='removed', removed_at=now() where team_entry_id=${lit(E.invalid.entry)} and is_goalkeeper`);
      const before = entryState(E.invalid.entry);
      assert.deepEqual(before.players.filter(p => p.status === 'active').length, 4);
      const r = reviewCall(await tok(owner), E.invalid.entry, 'approved');
      assert.equal(r.body.code, '23514', JSON.stringify(r.body)); assert.equal(r.body.message, 'TORNEOS_ROSTER_INCOMPLETE');
      const detail = JSON.parse(r.body.details);
      assert.equal(detail.valid, false); assert.deepEqual(detail.errors.sort(), ['minimum_goalkeepers', 'minimum_players']);
      record({ actor: 'owner', payload: 'approve with invalid roster', result: 'REJECTED_23514', status: r.status, message: r.body.message, errors: detail.errors });
      unchanged(before, entryState(E.invalid.entry), 'invalid roster');
      // changes_requested does not validate the roster: it is the way to send it back.
      const cr = reviewCall(await tok(owner), E.invalid.entry, 'changes_requested', 'Falta arquero', [{ code: 'minimum_goalkeepers' }]);
      assert.equal(cr.status, 200, JSON.stringify(cr.body)); assert.equal(cr.body.status, 'changes_requested');
    });
    // ---------------------------------------------------------------- D4. PASS: owner approve / changes_requested / reject; seated admin approve; cross-season seated admin approve
    const expectAudit = (entry, decision, actor, rosterId, issueCount, tournament) => {
      const a = lastAudit(entry);
      assert.deepEqual([a.action, a.resource_type, a.resource_id, a.team_entry_id, a.tournament_id, a.actor_user_id, a.actor_type, a.metadata], ['team_entry.' + decision, 'team_entry', entry, entry, tournament, actor, 'user', { rosterId, issueCount }], 'audit row');
      const v = lastReview(entry);
      assert.deepEqual([v.decision, v.created_by, v.roster_id, v.organization_id], [decision, actor, rosterId, org], 'review row');
      return v;
    };
    await check('P0 approve (owner, through the gateway and the allowlist): status approved, roster approved, pending players become eligible, review + audit rows correct', async () => {
      const before = entryState(E.approve.entry);
      const r = await gw(P0, await tok(owner), { p_organization_id: org, p_team_entry_id: E.approve.entry, p_decision: 'approved', p_reason: 'Plantel completo', p_issues: [] });
      assert.equal(r.status, 200, JSON.stringify(r.body)); evidence.exercised.add(P0);
      assert.deepEqual([r.body.entryId, r.body.rosterId, r.body.status, r.body.validation.valid], [E.approve.entry, E.approve.roster, 'approved', true]);
      const after = entryState(E.approve.entry);
      assert.equal(after.entry.status, 'approved'); assert.equal(after.entry.reviewed_by, owner.identity); assert.ok(after.entry.approved_at && after.entry.reviewed_at); assert.equal(after.entry.rejected_at, null);
      assert.deepEqual(after.rosters.map(x => [x.status, !!x.approved_at]), [['approved', true]]);
      assert.deepEqual(after.players.map(p => p.eligibility), ['eligible', 'eligible', 'eligible', 'eligible', 'eligible']);
      assert.deepEqual([after.reviews, after.audit], [before.reviews + 1, before.audit + 1]);
      const v = expectAudit(E.approve.entry, 'approved', owner.identity, E.approve.roster, 0, tournamentA);
      assert.deepEqual([v.reason, v.issues], ['Plantel completo', []]);
      record({ actor: 'owner (gateway, real Core session)', decision: 'approved', result: 'PASS', status: 200 });
      // A second review of a non-submitted entry is refused.
      const again = reviewCall(await tok(owner), E.approve.entry, 'approved');
      assert.equal(again.status, 403); assert.equal(again.body.message, 'TORNEOS_RESOURCE_FORBIDDEN');
    });
    await check('P0 changes_requested (owner): entry and roster go to changes_requested, no approval timestamps, issues persisted in the review row and counted in the audit', async () => {
      const issues = [{ code: 'shirt_number', playerShirt: 3 }, { code: 'name' }];
      const r = reviewCall(await tok(owner), E.changes.entry, 'changes_requested', 'Revisar dorsal y nombre', issues);
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'changes_requested'); assert.equal(r.body.validation, null);
      const after = entryState(E.changes.entry);
      assert.equal(after.entry.status, 'changes_requested'); assert.equal(after.entry.reviewed_by, owner.identity); assert.equal(after.entry.approved_at, null); assert.equal(after.entry.rejected_at, null);
      assert.deepEqual(after.rosters.map(x => x.status), ['changes_requested']);
      assert.deepEqual(after.players.map(p => p.eligibility), ['pending', 'pending', 'pending', 'pending', 'pending']);
      const v = expectAudit(E.changes.entry, 'changes_requested', owner.identity, E.changes.roster, 2, tournamentA);
      assert.deepEqual(v.issues, issues);
      record({ actor: 'owner', decision: 'changes_requested', result: 'PASS', status: 200 });
      // The roster is editable again by the organization (roster status changes_requested).
      const p = torneosSql(`select id from public.tournament_roster_players where team_entry_id=${lit(E.changes.entry)} and shirt_number=3`).trim();
      const upd = direct('update_tournament_roster_player', await tok(owner), { p_organization_id: org, p_team_entry_id: E.changes.entry, p_roster_player_id: p, p_shirt_number: 13, p_primary_position: 'MED', p_secondary_position: null, p_is_goalkeeper: false });
      assert.equal(upd.status, 200, JSON.stringify(upd.body));
      assert.equal(entryState(E.changes.entry).players.find(x => x.shirt === 13)?.status, 'active');
    });
    await check('P0 reject (owner): status rejected with rejected_at, roster stays submitted, review + audit rows correct', async () => {
      const r = reviewCall(await tok(owner), E.reject.entry, 'rejected', 'Fuera de plazo');
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'rejected');
      const after = entryState(E.reject.entry);
      assert.equal(after.entry.status, 'rejected'); assert.ok(after.entry.rejected_at); assert.equal(after.entry.approved_at, null); assert.equal(after.entry.reviewed_by, owner.identity);
      assert.deepEqual(after.rosters.map(x => x.status), ['submitted']);
      expectAudit(E.reject.entry, 'rejected', owner.identity, E.reject.roster, 0, tournamentA);
      record({ actor: 'owner', decision: 'rejected', result: 'PASS', status: 200 });
    });
    await check('P0 approve (admin seated on the entry\'s season): PASS after the same admin was denied on the other season; audit names the admin', async () => {
      const denied = reviewCall(adminA.token, E.bravo.entry, 'approved');
      assert.equal(denied.body.message, 'TORNEOS_RESOURCE_FORBIDDEN');
      const r = reviewCall(adminA.token, E.matrix.entry, 'approved', 'Aprobado por admin de temporada');
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'approved');
      expectAudit(E.matrix.entry, 'approved', adminA.identity, E.matrix.roster, 0, tournamentA);
      record({ actor: 'admin seated on season A', decision: 'approved', result: 'PASS', status: 200 });
      const rb = reviewCall(adminB.token, E.bravo.entry, 'approved', 'Aprobado por admin de temporada B');
      assert.equal(rb.status, 200, JSON.stringify(rb.body)); assert.equal(rb.body.status, 'approved');
      expectAudit(E.bravo.entry, 'approved', adminB.identity, E.bravo.roster, 0, tournamentB);
      record({ actor: 'admin seated on season B (season B entry)', decision: 'approved', result: 'PASS', status: 200 });
    });
    // ================================================================ E. wrappers approve/reject
    await check('wrappers approve/reject: no client EXECUTE (anon + authenticated 42501 before the body; gateway 403 not allowlisted); as service_role with the owner\'s identity they delegate to review; unseated admin denied; no identity → TORNEOS_AUTH_REQUIRED', async () => {
      for (const w of ['approve_tournament_team_entry', 'reject_tournament_team_entry']) {
        const args = { p_organization_id: org, p_team_entry_id: E.wrapApprove.entry, p_reason: 'wrapper' };
        assert.ok(deniedBeforeBody(direct(w, undefined, args)), `${w}: anon`);
        assert.ok(deniedBeforeBody(direct(w, await tok(owner), args)), `${w}: authenticated owner`);
        const g = await gw(w, await tok(owner), args);
        assert.deepEqual([g.status, g.body], [403, { error: 'rpc not enabled' }], `${w}: gateway`);
      }
      const ownerClaims = decodeJwt(await tok(owner));
      const call = (w, entry, claims) => asRole('service_role', claims, `select public.${w}(${lit(org)}, ${lit(entry)}, 'wrapper reason')`);
      const approved = JSON.parse(call('approve_tournament_team_entry', E.wrapApprove.entry, ownerClaims));
      assert.deepEqual([approved.status, approved.validation.valid], ['approved', true]);
      expectAudit(E.wrapApprove.entry, 'approved', owner.identity, E.wrapApprove.roster, 0, tournamentA);
      const rejected = JSON.parse(call('reject_tournament_team_entry', E.wrapReject.entry, ownerClaims));
      assert.equal(rejected.status, 'rejected');
      expectAudit(E.wrapReject.entry, 'rejected', owner.identity, E.wrapReject.roster, 0, tournamentA);
      // Transitive guards: unseated admin, admin seated elsewhere, and no identity at all.
      const spare = await submittedEntry(tournamentA, categoryA, 'Wrapper Deny');
      assert.match(sqlErr(() => call('approve_tournament_team_entry', spare.entry, decodeJwt(adminNone.token))) ?? '', /TORNEOS_RESOURCE_FORBIDDEN/);
      assert.match(sqlErr(() => call('reject_tournament_team_entry', spare.entry, decodeJwt(adminB.token))) ?? '', /TORNEOS_RESOURCE_FORBIDDEN/);
      assert.match(sqlErr(() => call('approve_tournament_team_entry', spare.entry, { role: 'service_role' })) ?? '', /TORNEOS_AUTH_REQUIRED/);
      assert.equal(entryState(spare.entry).entry.status, 'submitted');
      record({ actor: 'service_role + owner identity (SQL)', decision: 'approve/reject wrappers', result: 'PASS', status: 'delegated to review' });
    });
    // ================================================================ F. the 32 + parent: direct PostgREST DENY
    await check('32 OFF + parent, direct PostgREST: anon DENY and authenticated (valid bearer) DENY — 42501 permission denied before the body, catalog EXECUTE false', async () => {
      const rows = [];
      const targets = GATED.map(n => ({ name: n, args: nullArgs(argsOf.get([...argsOf.keys()].find(k => k.startsWith(`${n}(`))) ?? '') }));
      assert.ok(targets.every(x => Object.keys(x.args).length > 0), 'every gated RPC resolved its declared parameters');
      for (const [role, token] of [['anon', undefined], ['authenticated', await tok(owner)]]) {
        const out = restBatch(targets.map(x => ({ id: x.name, path: `/rpc/${x.name}`, body: x.args, token })));
        for (const r of out) {
          rows.push({ function: r.id, role, status: r.status, code: r.body?.code, message: String(r.body?.message ?? '').slice(0, 80), verdict: deniedBeforeBody(r) ? 'DENIED_BEFORE_BODY' : 'OTHER' });
        }
        const getOut = restBatch(targets.map(x => ({ id: x.name, path: `/rpc/${x.name}?` + new URLSearchParams(Object.fromEntries(Object.keys(x.args).map(k => [k, '']))).toString(), method: 'GET', token })));
        for (const r of getOut) assert.ok(deniedBeforeBody(r) || [400, 404, 405].includes(r.status), `${r.id} GET as ${role}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      }
      assert.deepEqual(rows.filter(r => r.verdict !== 'DENIED_BEFORE_BODY'), []);
      assert.equal(rows.length, 66);
      for (const n of GATED) { const f = inventory.functions.filter(x => x.schema === 'public' && x.name === n); assert.ok(f.length && f.every(x => !x.anon && !x.authenticated), n); }
      evidence.directSweep = rows;
    });
    // ================================================================ G. the 32 + parent: gateway DENY with a valid Core session
    await check('32 OFF + parent, gateway: a valid Core session with a valid bridge bearer is refused (403 rpc not enabled) for POST and GET; an allowlisted RPC with the same bearer passes; an invalid bearer is 401', async () => {
      const token = await tok(owner);
      const rows = [];
      for (const n of GATED) {
        const post = await gw(n, token, {});
        const get = await request(`/torneos/rest/v1/rpc/${n}`, token, 'GET');
        rows.push({ function: n, post: [post.status, post.body?.error], get: [get.status, get.body?.error] });
      }
      assert.deepEqual(rows.filter(r => r.post[0] !== 403 || r.post[1] !== 'rpc not enabled' || r.get[0] !== 403), []);
      assert.equal(rows.length, 33);
      const control = await gw('has_tournament_organization_capability', token, { p_organization_id: org, p_capability: 'team_entries.approve' });
      assert.deepEqual([control.status, control.body], [200, true], 'allowlisted control passes with the same session');
      const forged = await gw(GATED[0], 'eyJhbGciOiJub25lIn0.e30.', {});
      assert.equal(forged.status, 401, 'invalid bearer never reaches the allowlist verdict');
      const noBearer = await gw(GATED[0], null, {});
      assert.equal(noBearer.status, 401);
      // An allowlisted name that is not a function (or a table) still goes through the normal path.
      const table = await request(`/torneos/rest/v1/tournament_organizations?select=id&id=eq.${org}`, token, 'GET');
      assert.equal(table.status, 200, 'table reads are unchanged (RLS-governed), outside the RPC allowlist');
      evidence.gatewaySweep = rows;
    });
    // ================================================================ H. parent path
    await check('parent path: auto_schedule_tournament_matches (client RPC at 992dd282 that calls schedule_tournament_match) is gated at the DB and at the gateway; schedule_tournament_match has no other client-reachable caller', async () => {
      const f = inventory.functions.find(x => x.name === 'auto_schedule_tournament_matches');
      assert.deepEqual([f.anon, f.authenticated, f.service_role], [false, false, true]);
      assert.ok(deniedBeforeBody(direct('auto_schedule_tournament_matches', await tok(owner), { p_organization_id: org, p_fixture_version_id: randomUUID() })));
      assert.equal((await gw('auto_schedule_tournament_matches', await tok(owner), { p_organization_id: org, p_fixture_version_id: randomUUID() })).status, 403);
      const callers = JSON.parse(torneosSql("select json_agg(p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc like '%public.schedule_tournament_match(%' and p.proname <> 'schedule_tournament_match'")).sort();
      assert.deepEqual(callers, ['auto_schedule_tournament_matches', 'bulk_schedule_tournament_matches']);
      const bulk = inventory.functions.find(x => x.name === 'bulk_schedule_tournament_matches');
      assert.deepEqual([bulk.anon, bulk.authenticated], [false, false], 'the other caller was never client-executable');
    });
    // ================================================================ I. staging v1 features keep working
    await check('staging v1 features: the allowlisted RPCs exercised by this suite through the gateway all succeeded; SSO exchange, session check and identity binding unchanged', async () => {
      const exercised = [...evidence.exercised].sort();
      const expected = ['add_tournament_roster_player', 'assign_tournament_season_member', 'change_tournament_status', 'create_tournament_organization', 'create_tournament_provisional_player', 'create_tournament_season', 'create_tournament_team_entry', 'create_tournament_with_defaults', 'invite_tournament_team_manager', 'list_tournament_season_member_assignments', 'review_tournament_team_entry', 'save_tournament_category', 'submit_tournament_team_entry', 'update_tournament_team_entry'];
      assert.deepEqual(exercised, expected);
      assert.ok(exercised.every(n => ALLOW.includes(n)));
      evidence.coverage = { exercised_through_gateway: exercised, allowlist_total: ALLOW.length, not_exercised_here: ALLOW.filter(n => !exercised.includes(n)) };
      // Session revocation still bites the allowlisted path: logout → gateway 401 on an allowlisted RPC.
      const victim = await coreActor('logout');
      assert.equal((await gw('get_my_tournament_memberships', victim.token, {})).status, 200);
      assert.ok([200, 204].includes((await request('/auth/v1/logout', victim.coreToken, 'POST')).status));
      assert.equal((await gw('get_my_tournament_memberships', victim.token, {})).status, 401, 'revoked Core session is refused on an allowlisted RPC');
      assert.equal((await gw(GATED[0], victim.token, {})).status, 403, 'allowlist verdict is independent of the session state');
    });
    // ================================================================ J. no secrets
    await check('no secrets: lab secrets, bearers and invitation tokens are absent from the Phase 2D artifacts and evidence', async () => {
      const secrets = [cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.adapterPassword, cfg.coreSecret, cfg.serviceRoleKey, cfg.anonKey, cfg.coreContractSecret, ...cfg.keys.map(k => k.privateKey), ...seenSecrets].filter(Boolean);
      const texts = [gateSql, JSON.stringify(gate), JSON.stringify(allowlistDoc), JSON.stringify(evidence.acl33), JSON.stringify(evidence.gatewaySweep), JSON.stringify(evidence.directSweep), JSON.stringify(evidence.p0), JSON.stringify(realImage)];
      for (const text of texts) { for (const s of secrets) assert.ok(!text.includes(s), 'artifact carries a lab secret'); assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(text), 'artifact carries a JWT'); }
      assert.ok(!/https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]+/.test(gateSql));
    });
  } finally {
    await mkdir('evidence', { recursive: true });
    await writeFile('evidence/exposure-acl-33.json', JSON.stringify({ before_source: 'phase2d/evidence/real-image-acl-before-real.json (992dd282 baseline on the real image)', after_source: 'live lab stack (baseline f857bd09… + 00000000000001 gate)', functions: evidence.acl33 }, null, 2) + '\n');
    await writeFile('evidence/exposure-gateway-sweep.json', JSON.stringify({ session: 'real Core session (GoTrue) + bridge bearer via /exchange', rows: evidence.gatewaySweep }, null, 2) + '\n');
    await writeFile('evidence/exposure-postgrest-sweep.json', JSON.stringify({ position: 'direct PostgREST inside the private network', rows: evidence.directSweep }, null, 2) + '\n');
    await writeFile('evidence/exposure-p0-matrix.json', JSON.stringify({ function: P0, wrappers: ['approve_tournament_team_entry', 'reject_tournament_team_entry'], rows: evidence.p0, coverage: evidence.coverage }, null, 2) + '\n');
    await writeFile('evidence/exposure-results.json', JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, run: RUN,
      pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, results }, null, 2) + '\n');
  }
});
