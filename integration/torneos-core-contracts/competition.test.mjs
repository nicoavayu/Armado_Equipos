// COMPETITION-V1 — full-competition contract certification on the REAL local stack (the Phase 3A lab):
// real Core (GoTrue sessions + the Core contract Edge Function), the Torneos baseline + 0001…0004 behind
// PostgREST, and the gateway under test (Node by default, the Edge port with GATEWAY=edge).
//
//   A. install + ACL: 0004 applied from the migrations directory, exact ACL delta, season fix in force,
//      17 gated + 6 service-only functions still closed, anon unchanged; the gateway carries both allowlists.
//   B. the product journey through the gateway, as the product's actors (owner, season admin, collaborator,
//      captains, a rostered player): organization → season → tournament → teams → fixture → schedule →
//      squads → match report → review / validation / official → standings → correction → standings update →
//      statistics → participant hub → communications → public page; lifecycle start / finish / reopen,
//      withdrawal, groups (pots, draw, reopen participants) on dedicated tournaments.
//   C. the negative matrix: every exercised RPC replayed as outsider (cross-workspace), unassigned-season admin
//      (cross-season), collaborator, captain/player, removed membership, no bearer and anon at PostgREST.
//   D. contract edges: RPCs outside the allowlist, the public read-only route, invalid IDs, idempotency and
//      concurrency, bearer expiry / re-exchange / logout, Core and Torneos REST outages, no-store, persistence.
//
// Runs after `npm run up`. Every check is a named subtest; with CV1_EVIDENCE=1 the results go to
// backend/torneos/competition-v1/evidence/<gateway>/. Nothing touches a remote target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { SignJWT, importPKCS8, decodeJwt } from 'jose';
import { config, sql, sqlTry, inGateway, dc, BASE, GATEWAY_BASE, GATEWAY_NAME, repo } from './lab.mjs';

const cfg = await config();
const RUN = 'cv1' + randomBytes(3).toString('hex');
const results = [];
const seenSecrets = [];
const torneosSql = (q) => sql('torneos-db', q);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const migrationsDir = `${repo}backend/torneos/supabase/migrations/`;
const MIGRATION = '00000000000004_competition_v1_rpc_exposure.sql';
const migrationSql = await readFile(`${migrationsDir}${MIGRATION}`, 'utf8');
const rollbackSql = await readFile(`${repo}backend/torneos/competition-v1/rollback/00000000000004_competition_v1_rpc_exposure.rollback.sql`, 'utf8');
const contract = JSON.parse(await readFile(`${repo}backend/torneos/competition-v1/contract.json`, 'utf8'));
const allowDoc = JSON.parse(await readFile(`${repo}backend/torneos/supabase/functions/torneos-gateway/competition-v1-rpc-allowlist.json`, 'utf8'));
const stagingDoc = JSON.parse(await readFile(`${repo}backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json`, 'utf8'));
const ALLOW = Object.values(allowDoc.features).flat();
const PUBLIC = Object.values(allowDoc.public).flat();
const STAGING = Object.values(stagingDoc.features).flat();
const GRANTED = contract.acl.granted_by_0004.map((f) => f.split('(')[0]);
const CLOSED = [...contract.acl.kept_revoked, ...contract.acl.service_only];

// ---------------------------------------------------------------- transport
const noStore = [];
async function request(path, token, method = 'GET', data, extraHeaders = {}) {
  const base = path.startsWith('/auth/v1') ? BASE : GATEWAY_BASE;
  const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    body: data !== undefined ? (typeof data === 'string' ? data : JSON.stringify(data)) : undefined });
  const text = await r.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!path.startsWith('/auth/v1')) noStore.push({ path: path.replace(/[0-9a-f-]{36}/g, ':id'), status: r.status, cacheControl: r.headers.get('cache-control') });
  return { status: r.status, body, headers: r.headers };
}
const gw = (name, token, params = {}) => request(`/torneos/rest/v1/rpc/${name}`, token, 'POST', params);
const pub = (name, data, headers = {}, method = 'POST') => request(`/torneos/public/v1/rpc/${name}`, null, method, data, headers);
/** Direct PostgREST calls from INSIDE the private network (attacker position: no gateway). */
function restBatch(calls) {
  const out = inGateway(`const calls = ${JSON.stringify(calls)}; const out = [];
    for (const c of calls) {
      const r = await fetch('http://torneos-rest:3000' + c.path, { method: 'POST',
        headers: { 'content-type': 'application/json', ...(c.token ? { authorization: 'Bearer ' + c.token } : {}) },
        body: JSON.stringify(c.body ?? {}) });
      const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
      out.push({ id: c.id, status: r.status, body });
    }
    console.log(JSON.stringify(out));`);
  return JSON.parse(out.trim().split('\n').pop());
}
const errCode = (r) => r.body?.code ?? r.body?.error ?? null;
const errMsg = (r) => r.body?.message ?? r.body?.error ?? null;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

// ---------------------------------------------------------------- identities (real Core sessions)
async function coreActor(label) {
  const email = `${RUN}-${label}-${randomUUID().slice(0, 6)}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const s = await request('/auth/v1/signup', null, 'POST', { email, password, data: { full_name: `${RUN} ${label}` } });
  assert.equal(s.status, 200, `GoTrue signup for ${label}`);
  seenSecrets.push(s.body.access_token, s.body.refresh_token, password);
  const u = { label, email, password, coreToken: s.body.access_token, coreUserId: s.body.user.id };
  await exchange(u);
  return u;
}
async function exchange(u) {
  const r = await request('/exchange', u.coreToken, 'POST');
  assert.equal(r.status, 200, `exchange for ${u.label}: ${show(r)}`);
  seenSecrets.push(r.body.access_token);
  u.token = r.body.access_token; u.tokenAt = Date.now(); u.claims = decodeJwt(u.token); u.identity = u.claims.sub;
  return u.token;
}
async function tok(u) { if (!u.token || Date.now() - u.tokenAt > 80_000) await exchange(u); return u.token; }
async function signedBridge(u, { exp, sessionId = u.claims.session_id } = {}) {
  const key = cfg.keys.find((k) => k.kid === cfg.activeKid);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: 'authenticated', core_user_id: u.coreUserId, session_id: sessionId })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: key.kid }).setIssuer('urn:arma2:local:identity-bridge').setAudience('arma2-torneos-local')
    .setSubject(u.identity).setIssuedAt(now - 300).setNotBefore(now - 300).setExpirationTime(exp ?? now + 120).setJti(randomUUID())
    .sign(await importPKCS8(key.privateKey, 'RS256'));
  seenSecrets.push(token);
  return token;
}
const setService = (service, action) => dc([action, service], undefined, true);
async function waitFor(label, probe, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try { if (await probe()) return; } catch { /* restarting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not recover`);
}

// ---------------------------------------------------------------- the suite
test(`COMPETITION-V1 — full-competition contract on the real stack (${GATEWAY_NAME} gateway)`, async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 600) }); throw error; }
    });
  }
  // Every successful privileged call is recorded with its params: the negative matrix replays exactly them.
  const exercised = new Map();
  const ok = async (name, who, params = {}) => {
    const r = await gw(name, await tok(who), params);
    assert.equal(r.status, 200, `${name} as ${who.label}: ${show(r)}`);
    if (!exercised.has(name)) exercised.set(name, { params, actor: who.label });
    return r.body;
  };
  const denied = async (name, who, params, { status = [403], code = '42501' } = {}) => {
    const r = await gw(name, await tok(who), params);
    assert.ok(status.includes(r.status), `${name} as ${who.label} must be denied: ${show(r)}`);
    if (code) assert.equal(errCode(r), code, `${name} as ${who.label}: ${show(r)}`);
    return r;
  };
  // Schedules through the product path (validate → schedule); a refusal carries the validator's blockers.
  const schedule = async (who, params) => {
    const { p_override_warnings, p_override_reason, ...slot } = params;
    const r = await gw('schedule_tournament_match', await tok(who), params);
    if (r.status !== 200) {
      const v = await gw('validate_tournament_match_schedule', await tok(who), slot);
      assert.fail(`schedule_tournament_match as ${who.label}: ${show(r)} — validation ${show(v)}`);
    }
    if (!exercised.has('schedule_tournament_match')) exercised.set('schedule_tournament_match', { params, actor: who.label });
    return r.body;
  };
  const S = {};  // shared fixture state
  const matrix = [];

  try {
    // ================================================================ A. install / ACL / gateway shape
    await check('A1 install: 0004 applied in order from the migrations directory; 0001 untouched (sha pinned in phase2d)', async () => {
      const install = JSON.parse(await readFile('.runtime/install.json', 'utf8'));
      const applied = install.torneos.migrations_after_baseline.map((m) => m.file.split('/').pop());
      assert.deepEqual(applied, (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort().slice(1));
      assert.ok(applied.includes(MIGRATION));
      const entry = install.torneos.migrations_after_baseline.find((m) => m.file.endsWith(MIGRATION));
      assert.equal(entry.sha256, createHash('sha256').update(migrationSql).digest('hex'), 'lab applied this tree\'s 0004');
      const gate = await readFile(`${migrationsDir}00000000000001_staging_v1_rpc_exposure.sql`, 'utf8');
      assert.equal(createHash('sha256').update(gate).digest('hex'), '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62', '0001 byte-identical to Phase 2D');
    });
    await check('A2 ACL: exactly the 15 of 0004 gained authenticated; anon/PUBLIC/server roles none; 23 closed functions still closed; anon catalog = 12', async () => {
      const rows = JSON.parse(torneosSql(`select json_agg(json_build_object('f', p.oid::regprocedure::text, 'n', p.proname,
        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'svc', has_function_privilege('service_role', p.oid, 'EXECUTE'),
        'adapter', has_function_privilege('torneos_core_adapter', p.oid, 'EXECUTE'), 'writer', has_function_privilege('torneos_identity_writer', p.oid, 'EXECUTE'),
        'pub', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`));
      const byF = new Map(rows.map((r) => [r.f, r]));
      for (const f of contract.acl.granted_by_0004) {
        const r = byF.get(f); assert.ok(r, f);
        assert.deepEqual([r.anon, r.auth, r.svc, r.adapter, r.writer, r.pub], [false, true, true, false, false, false], f);
      }
      for (const f of CLOSED) {
        const r = byF.get(f); assert.ok(r, f);
        assert.deepEqual([r.anon, r.auth], [false, false], `${f} stays closed`);
      }
      assert.equal(rows.filter((r) => r.anon).length, 12, 'anon catalog unchanged');
      assert.equal(rows.filter((r) => r.auth).length, contract.acl.authenticated_public_after, 'authenticated catalog = certified count');
      // Every allowlisted RPC is executable by authenticated at the DB; the public one by anon.
      for (const n of ALLOW) assert.ok(rows.some((r) => r.n === n && r.auth), `${n} executable by authenticated`);
      for (const n of PUBLIC) assert.ok(rows.some((r) => r.n === n && r.anon), `${n} executable by anon`);
    });
    await check('A3 season fix: update_draft_fixture body = COMPETITION-V1 (baseline + season access), definer + pinned search_path', async () => {
      const [md5, def] = torneosSql("select md5(prosrc) || '|' || (prosecdef and proconfig @> array['search_path=\"\"'])::text from pg_proc where oid = 'public.update_draft_fixture(uuid,uuid,text,jsonb)'::regprocedure").trim().split('|');
      assert.equal(md5, '53fd2b4bc95a86434c7e5b8e1e938275'); assert.equal(def, 'true');
      assert.match(torneosSql("select prosrc from pg_proc where oid = 'public.update_draft_fixture(uuid,uuid,text,jsonb)'::regprocedure"), /has_tournament_season_access\(p_organization_id, v_version\.season_id\)/);
    });
    await check('A3b guard-order fix: publish_tournament_document_version authorizes before its idempotent answer (body = COMPETITION-V1)', async () => {
      assert.equal(torneosSql("select md5(prosrc) from pg_proc where oid = 'public.publish_tournament_document_version(uuid)'::regprocedure").trim(), '6830b726fc3aa23342ab7fed2b1d5348');
      const src = torneosSql("select prosrc from pg_proc where oid = 'public.publish_tournament_document_version(uuid)'::regprocedure");
      assert.ok(src.indexOf('documents.publish') < src.indexOf("if v_version.status = 'published' then"), 'authorization precedes the idempotent return');
    });
    await check('A4 migration: re-apply is a no-op (idempotent); a state without 0001 is refused before any change', async () => {
      const before = torneosSql("select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'").trim();
      const again = sqlTry('torneos-db', migrationSql);
      assert.equal(again.ok, true, again.error);
      assert.equal(torneosSql("select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'").trim(), before);
      // Simulate a database where 0001 never ran (one gated function re-opened) inside a rolled-back transaction.
      const probe = sqlTry('torneos-db', `BEGIN; GRANT EXECUTE ON FUNCTION public.lock_tournament_roster(uuid,uuid,uuid) TO authenticated;
        ${migrationSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')}
        ROLLBACK;`);
      assert.equal(probe.ok, false); assert.match(probe.error, /TORNEOS_COMPETITION_V1_PRECONDITION_FAILED: client role executes public\.lock_tournament_roster/);
      assert.equal(torneosSql("select has_function_privilege('authenticated','public.lock_tournament_roster(uuid,uuid,uuid)','EXECUTE')").trim(), 'f');
    });
    await check('A5 rollback: the documented rollback returns exactly the 0001 ACL of the 15 (in a rolled-back transaction), then 0004 is intact', async () => {
      const r = sqlTry('torneos-db', `BEGIN; ${rollbackSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')}
        SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', f::regprocedure, 'EXECUTE'))
        FROM unnest(array[${contract.acl.granted_by_0004.map((f) => lit(`public.${f}`)).join(',')}]) f;
        ROLLBACK;`);
      assert.equal(r.ok, true, r.error);
      assert.equal(r.out.trim().split('\n').pop(), '0', 'all 15 revoked by the rollback');
      assert.equal(torneosSql(`select count(*) filter (where has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')) from unnest(array[${contract.acl.granted_by_0004.map((f) => lit(`public.${f}`)).join(',')}]) f`).trim(), '15');
    });
    await check('A6 gateway: allowlists loaded — staging v1 unchanged (43), competition (74) disjoint, public (1) disjoint; contract.json = allowlist', async () => {
      assert.equal(STAGING.length, 43);
      assert.equal(ALLOW.length, 74); assert.equal(new Set(ALLOW).size, 74);
      assert.deepEqual(ALLOW.filter((n) => STAGING.includes(n)), []);
      assert.deepEqual(PUBLIC, ['get_public_tournament_page']);
      const fromContract = Object.entries(contract.features).flatMap(([, f]) => Object.keys(f.rpcs).filter((n) => f.rpcs[n].route === 'authenticated'));
      assert.deepEqual([...fromContract].sort(), [...ALLOW].sort(), 'contract.json and the gateway allowlist list the same RPCs');
      assert.deepEqual(Object.entries(contract.features).flatMap(([, f]) => Object.keys(f.rpcs).filter((n) => f.rpcs[n].route === 'public')), PUBLIC);
      for (const n of CLOSED.map((f) => f.split('(')[0])) assert.ok(!ALLOW.includes(n) && !PUBLIC.includes(n), `${n} not allowlisted`);
      for (const n of GRANTED) assert.ok(ALLOW.includes(n), `${n} (granted by 0004) is allowlisted`);
    });

    // ================================================================ B. actors
    const owner = await coreActor('owner');
    const adminA = await coreActor('admin-a');
    const adminB = await coreActor('admin-b');
    const collaborator = await coreActor('collab');
    const removed = await coreActor('removed');
    const outsider = await coreActor('outsider');
    const player = await coreActor('player');
    const captains = [];
    for (let i = 0; i < 4; i++) captains.push(await coreActor(`captain-${i}`));
    const extraCaptains = [];
    for (let i = 0; i < 6; i++) extraCaptains.push(await coreActor(`captain-x${i}`));

    await check('B1 organization / seasons / tournaments / categories + collaborators and season seats (gateway, real Core sessions)', async () => {
      S.org = (await ok('create_tournament_organization', owner, { p_name: `Liga ${RUN}`, p_slug: `liga-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
      S.org2 = (await ok('create_tournament_organization', outsider, { p_name: `Otra ${RUN}`, p_slug: `otra-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
      S.seasonA = (await ok('create_tournament_season', owner, { p_organization_id: S.org, p_name: 'Apertura', p_slug: `apertura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      S.seasonB = (await ok('create_tournament_season', owner, { p_organization_id: S.org, p_name: 'Clausura', p_slug: `clausura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      for (const [who, role] of [[adminA, 'admin'], [adminB, 'admin'], [collaborator, 'collaborator'], [removed, 'admin']]) {
        torneosSql(`insert into public.tournament_organization_members(organization_id,user_id,role,joined_at) values (${lit(S.org)},${lit(who.identity)},${lit(role)},now())`);
      }
      const membership = (who) => torneosSql(`select id from public.tournament_organization_members where organization_id=${lit(S.org)} and user_id=${lit(who.identity)}`).trim();
      // FREE seasons admit ONE collaborator seat through the RPC (TORNEOS_SEASON_COLLABORATOR_LIMIT_REACHED beyond it):
      // the season admins take theirs through the RPC; the extra seats of season A (collaborator, the future removed
      // admin) are seeded as fixtures, exactly the rows the RPC writes.
      await ok('assign_tournament_season_member', owner, { p_organization_id: S.org, p_season_id: S.seasonA, p_membership_id: membership(adminA) });
      await ok('assign_tournament_season_member', owner, { p_organization_id: S.org, p_season_id: S.seasonB, p_membership_id: membership(adminB) });
      const limit = await gw('assign_tournament_season_member', await tok(owner), { p_organization_id: S.org, p_season_id: S.seasonA, p_membership_id: membership(collaborator) });
      assert.equal(errMsg(limit), 'TORNEOS_SEASON_COLLABORATOR_LIMIT_REACHED', show(limit));
      for (const who of [collaborator, removed]) {
        torneosSql(`begin; set local session_replication_role = replica;
          insert into public.tournament_season_member_assignments(organization_id, season_id, membership_id, assigned_by) values (${lit(S.org)}, ${lit(S.seasonA)}, ${lit(membership(who))}, ${lit(owner.identity)}); commit;`);
      }
    });
    const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    const mkTournament = async (season, slug, format = 'league') => {
      // A date range: the automatic scheduler only works inside it (TORNEOS_AUTOSCHEDULE_RANGE_REQUIRED).
      const tnt = await ok('create_tournament_with_defaults', owner, { p_organization_id: S.org, p_season_id: season, p_name: `Copa ${slug}`, p_slug: `${slug}-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: format, p_gender_category: 'open', p_start_date: day(-1), p_end_date: day(60), p_idempotency_key: randomUUID() });
      const cat = await ok('save_tournament_category', owner, { p_organization_id: S.org, p_tournament_id: tnt.id, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' });
      const st = await ok('change_tournament_status', owner, { p_organization_id: S.org, p_tournament_id: tnt.id, p_status: 'registration' });
      assert.equal(st.status, 'registration', JSON.stringify(st));
      return { id: tnt.id, category: cat.id };
    };
    /** Approved team: manual entry → 5 provisional players (+ optional Arma2 user) → captain invited + accepted through the Core verified-email contract → submitted → approved by the season admin. */
    const approvedTeam = async (tournament, name, captain, { withPlayer = false } = {}) => {
      const created = await ok('create_tournament_team_entry', owner, { p_organization_id: S.org, p_tournament_id: tournament.id, p_category_id: tournament.category, p_arma2_team_id: null, p_name: name, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      const entry = created.entryId; const roster = created.rosterId;
      await ok('update_tournament_team_entry', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_patch: { shortName: name.slice(0, 3).toUpperCase() } });
      const players = [];
      for (const [display, shirt, position, gk] of [['Arquero', 1, 'ARQ', true], ['Defensor', 2, 'DEF', false], ['Volante', 3, 'MED', false], ['Delantero', 4, 'DEL', false], ['Lateral', 5, 'DEF', false]]) {
        const prov = await ok('create_tournament_provisional_player', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_display_name: `${display} ${name}` });
        const added = await ok('add_tournament_roster_player', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: null, p_provisional_player_id: prov.id, p_display_name: `${display} ${name}`, p_avatar_url: null, p_shirt_number: shirt, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: gk });
        players.push(added.id);
      }
      if (withPlayer) {
        const added = await ok('add_tournament_roster_player', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: player.identity, p_provisional_player_id: null, p_display_name: `Jugador ${RUN}`, p_avatar_url: null, p_shirt_number: 9, p_primary_position: 'DEL', p_secondary_position: null, p_is_goalkeeper: false });
        players.push(added.id);
      }
      const invite = await ok('invite_tournament_team_manager', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_email: captain.email, p_display_name: captain.label, p_role: 'captain' });
      seenSecrets.push(invite.token);
      const accepted = await ok('accept_tournament_team_invitation', captain, { p_token: invite.token });
      assert.equal(accepted.status, 'accepted', JSON.stringify(accepted));
      const submitted = await ok('submit_tournament_team_entry', owner, { p_organization_id: S.org, p_team_entry_id: entry });
      assert.equal(submitted.validation.valid, true, JSON.stringify(submitted.validation));
      const reviewed = await ok('review_tournament_team_entry', tournament.season === S.seasonA ? adminA : owner, { p_organization_id: S.org, p_team_entry_id: entry, p_decision: 'approved', p_reason: 'Plantel verificado', p_issues: [] });
      assert.equal(reviewed.status ?? reviewed.entry?.status ?? 'approved', 'approved', JSON.stringify(reviewed).slice(0, 200));
      return { entry, roster, players, captain, name };
    };

    await check('B2 league tournament A (season A) and B (season B): 4 approved teams in A (captains accepted through the Core contract, one Arma2 player), 1 team in B', async () => {
      S.A = { ...(await mkTournament(S.seasonA, 'alfa')), season: S.seasonA };
      S.B = { ...(await mkTournament(S.seasonB, 'bravo')), season: S.seasonB };
      S.teams = [];
      for (let i = 0; i < 4; i++) S.teams.push(await approvedTeam(S.A, `Club ${i} ${RUN}`, captains[i], { withPlayer: i === 0 }));
      assert.equal(torneosSql(`select count(*) from public.tournament_team_entries where tournament_id=${lit(S.A.id)} and status='approved'`).trim(), '4');
    });

    await check('B3 fixture: freeze participants (idempotent replay) → generate league (idempotent replay) → validate → publish; tournament scheduled', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category };
      const key1 = randomUUID();
      const frozen = await ok('freeze_tournament_participants', adminA, { ...scope, p_idempotency_key: key1 });
      const again = await ok('freeze_tournament_participants', adminA, { ...scope, p_idempotency_key: key1 });
      assert.equal(again.participantSetId, frozen.participantSetId, 'same idempotency key → same participant set');
      const key2 = randomUUID();
      const generated = await ok('generate_tournament_fixture', adminA, { ...scope, p_seed: `seed-${RUN}`, p_configuration: {}, p_idempotency_key: key2 });
      const replay = await ok('generate_tournament_fixture', adminA, { ...scope, p_seed: `seed-${RUN}`, p_configuration: {}, p_idempotency_key: key2 });
      assert.equal(replay.fixtureVersionId, generated.fixtureVersionId, 'same idempotency key → same fixture version');
      S.A.fixture = generated.fixtureVersionId;
      const validation = await ok('validate_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.A.fixture });
      assert.notEqual(validation.valid, false, JSON.stringify(validation).slice(0, 300));
      await ok('publish_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.A.fixture });
      const context = await ok('get_tournament_fixture_context', adminA, scope);
      S.A.fixtureContext = context;
      const matches = torneosSql(`select json_agg(json_build_object('id', m.id, 'phase', m.phase_id, 'round', m.round_id, 'number', m.match_number, 'home', hp.team_entry_id, 'away', ap.team_entry_id) order by m.match_number)
        from public.tournament_matches m left join public.tournament_competition_participants hp on hp.id = m.home_participant_id left join public.tournament_competition_participants ap on ap.id = m.away_participant_id
        where m.fixture_version_id = ${lit(S.A.fixture)}`);
      S.A.matches = JSON.parse(matches);
      assert.equal(S.A.matches.length, 6, '4-team single round robin = 6 matches');
      S.A.phase = S.A.matches[0].phase;
      assert.equal(torneosSql(`select status from public.tournaments where id=${lit(S.A.id)}`).trim(), 'scheduled');
      await ok('get_tournament_schedule_context', collaborator, scope);
      // Before the start a published fixture can still be revised: supersede → editable draft → draft edits
      // through the season-fixed update_draft_fixture (an admin of another season of the same organization is refused).
      const draft = await ok('supersede_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.A.fixture, p_idempotency_key: randomUUID() });
      S.A.draft = draft.fixtureVersionId;
      assert.match(String(S.A.draft), /^[0-9a-f-]{36}$/, JSON.stringify(draft).slice(0, 200));
      const phase = torneosSql(`select id from public.tournament_phases where fixture_version_id=${lit(S.A.draft)} order by sequence_number limit 1`).trim();
      const edit = { p_organization_id: S.org, p_fixture_version_id: S.A.draft, p_action: 'create_round', p_payload: { phaseId: phase, name: 'Fecha extra' } };
      const cross = await denied('update_draft_fixture', adminB, edit);
      assert.equal(errMsg(cross), 'TORNEOS_RESOURCE_FORBIDDEN', 'COMPETITION-V1 season fix: an admin of another season cannot edit this draft');
      const round = await ok('update_draft_fixture', adminA, edit);
      assert.equal(round.action, 'create_round');
      assert.equal(torneosSql(`select status from public.tournament_fixture_versions where id=${lit(S.A.fixture)}`).trim(), 'published', 'the published fixture stays in force while a draft is edited');
    });

    await check('B4 lifecycle start (admin, idempotent); reopen needs the owner capability (admin denied)', async () => {
      const started = await ok('start_tournament_competition', adminA, { p_organization_id: S.org, p_tournament_id: S.A.id });
      assert.equal(started.status, 'active');
      const again = await ok('start_tournament_competition', adminA, { p_organization_id: S.org, p_tournament_id: S.A.id });
      assert.equal(again.alreadyStarted, true);
    });

    await check('B5 venues, courts, schedule windows, schedule validation, schedule + auto-schedule + reschedule', async () => {
      S.venue = (await ok('create_tournament_venue', adminA, { p_organization_id: S.org, p_name: `Club ${RUN}`, p_address: 'Calle 123', p_place_id: null, p_latitude: null, p_longitude: null, p_locality: 'Buenos Aires', p_timezone: 'America/Argentina/Buenos_Aires', p_notes: null })).id;
      S.court = (await ok('create_tournament_court', adminA, { p_organization_id: S.org, p_venue_id: S.venue, p_name: 'Cancha 1', p_sport_modality: 'football_5', p_notes: null })).id;
      S.courtC = (await ok('create_tournament_court', owner, { p_organization_id: S.org, p_venue_id: S.venue, p_name: 'Cancha 2', p_sport_modality: 'football_5', p_notes: null })).id;
      S.courtD = (await ok('create_tournament_court', owner, { p_organization_id: S.org, p_venue_id: S.venue, p_name: 'Cancha 3', p_sport_modality: 'football_5', p_notes: null })).id;
      const windows = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, startsAt: '00:00', endsAt: '23:59', slotDurationMinutes: 60, venueId: S.venue, courtId: S.court }));
      await ok('save_tournament_schedule_windows', adminA, { p_organization_id: S.org, p_tournament_id: S.A.id, p_windows: windows });
      // The played match: team 0 (with the Arma2 player) at home or away, starting in two hours (inside the 6 h opening window).
      S.m = S.A.matches.find((m) => m.home === S.teams[0].entry || m.away === S.teams[0].entry);
      const at = new Date(Date.now() + 2 * 3600_000); at.setUTCMinutes(0, 0, 0);
      S.m.at = at.toISOString();
      const sched = { p_organization_id: S.org, p_match_id: S.m.id, p_scheduled_at: S.m.at, p_venue_id: S.venue, p_court_id: S.court, p_duration_minutes: 60 };
      const validation = await ok('validate_tournament_match_schedule', adminA, sched);
      assert.deepEqual(validation.blockers ?? [], [], JSON.stringify(validation));
      await ok('schedule_tournament_match', adminA, { ...sched, p_override_warnings: true, p_override_reason: 'Horario de certificación' });
      assert.equal(torneosSql(`select status from public.tournament_matches where id=${lit(S.m.id)}`).trim(), 'scheduled');
      const auto = await ok('auto_schedule_tournament_matches', owner, { p_organization_id: S.org, p_fixture_version_id: S.A.fixture });
      assert.ok(auto, JSON.stringify(auto));
      S.other = S.A.matches.find((m) => m.id !== S.m.id);
      const scheduledOther = torneosSql(`select scheduled_at from public.tournament_matches where id=${lit(S.other.id)}`).trim();
      if (!scheduledOther) {
        const later = new Date(Date.now() + 7 * 86400_000); later.setUTCHours(20, 0, 0, 0);
        await ok('schedule_tournament_match', adminA, { p_organization_id: S.org, p_match_id: S.other.id, p_scheduled_at: later.toISOString(), p_venue_id: S.venue, p_court_id: S.court, p_duration_minutes: 60, p_override_warnings: true, p_override_reason: 'Certificación' });
      }
      const moved = new Date(Date.now() + 9 * 86400_000); moved.setUTCHours(21, 0, 0, 0);
      await ok('reschedule_tournament_match', adminA, { p_organization_id: S.org, p_match_id: S.other.id, p_scheduled_at: moved.toISOString(), p_venue_id: S.venue, p_court_id: S.court, p_duration_minutes: 60, p_reason: 'Cambio de horario', p_override_warnings: true });
      assert.equal(new Date(torneosSql(`select scheduled_at from public.tournament_matches where id=${lit(S.other.id)}`).trim().replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString(), moved.toISOString());
    });

    const teamOf = (entry) => S.teams.find((x) => x.entry === entry);
    const squadPayload = (players) => players.map((rosterPlayerId, index) => ({ rosterPlayerId, availabilityStatus: 'no_response', callupStatus: 'called_up',
      lineupStatus: index < 5 ? 'starter' : 'substitute', isGoalkeeper: index === 0, isCaptain: index === 1, attendanceStatus: 'present' }));
    await check('B6 availability (rostered player) + squads saved and submitted by each captain; a captain cannot touch the rival squad', async () => {
      const mine = await ok('get_player_tournament_matches', player, {});
      assert.ok(mine.some((m) => m.matchId === S.m.id), 'the Arma2 player sees the scheduled match');
      await ok('respond_match_availability', player, { p_match_id: S.m.id, p_response: 'available', p_comment: 'Llego' });
      S.home = teamOf(S.m.home); S.away = teamOf(S.m.away);
      const managed = await ok('get_managed_tournament_matches', S.home.captain, {});
      assert.ok(managed.some((m) => m.matchId === S.m.id));
      await ok('get_my_managed_match_squad_context', S.home.captain, { p_match_id: S.m.id });
      for (const side of [S.home, S.away]) {
        await ok('get_match_squad_context', side.captain, { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: side.entry });
        await ok('save_match_squad', side.captain, { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: side.entry, p_players: squadPayload(side.players) });
      }
      await denied('save_match_squad', S.home.captain, { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: S.away.entry, p_players: squadPayload(S.away.players) });
      // Concurrent submissions of the same squad: exactly one winner.
      const race = await Promise.all([gw('submit_match_squad', await tok(S.home.captain), { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: S.home.entry }),
        gw('submit_match_squad', await tok(S.home.captain), { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: S.home.entry })]);
      assert.equal(race.filter((r) => r.status === 200).length, 1, `one winner: ${race.map(show).join(' | ')}`);
      exercised.set('submit_match_squad', { params: { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: S.home.entry }, actor: 'captain' });
      await ok('submit_match_squad', S.away.captain, { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: S.away.entry });
      assert.equal(torneosSql(`select count(*) from public.tournament_match_squads where match_id=${lit(S.m.id)} and status='submitted'`).trim(), '2');
    });

    const operationEvents = (op) => JSON.parse(torneosSql(`select coalesce(json_agg(json_build_object('id', e.id, 'type', e.event_type, 'team', e.team_entry_id, 'player', e.roster_player_id, 'voided', e.voided_at is not null) order by e.minute, e.created_at), '[]') from public.tournament_match_events e where e.match_operation_id = ${lit(op)}`));
    await check('B7 match report (acta): open → outcome → score 2-1 → goal events → incident voided → submitted by the admin', async () => {
      const opened = await ok('open_tournament_match_operation', owner, { p_organization_id: S.org, p_match_id: S.m.id, p_override_reason: null });
      S.op = opened.operation?.id ?? opened.id;
      assert.ok(S.op, JSON.stringify(opened).slice(0, 300));
      const base = { p_organization_id: S.org, p_match_operation_id: S.op };
      await ok('get_tournament_match_operation_context', adminA, base);
      await ok('get_tournament_match_operations_context', collaborator, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category });
      await ok('set_tournament_match_outcome', adminA, { ...base, p_outcome: { outcomeType: 'played', countsForStandings: true, countsForPlayerStats: true, requiresResolution: false } });
      await ok('set_tournament_match_score', adminA, { ...base, p_score: { homeScore: 2, awayScore: 1, scoreType: 'played' } });
      await ok('add_tournament_match_event', adminA, { ...base, p_event: { teamEntryId: S.home.entry, rosterPlayerId: S.home.players[3], eventType: 'goal', minute: 10, period: 'first_half' } });
      await ok('add_tournament_match_event', adminA, { ...base, p_event: { teamEntryId: S.home.entry, rosterPlayerId: S.home.players[2], eventType: 'goal', minute: 30, period: 'first_half' } });
      await ok('add_tournament_match_event', adminA, { ...base, p_event: { teamEntryId: S.away.entry, rosterPlayerId: S.away.players[3], eventType: 'goal', minute: 40, period: 'second_half' } });
      const incident = await ok('add_tournament_match_event', adminA, { ...base, p_event: { teamEntryId: S.home.entry, eventType: 'incident', minute: 45, period: 'second_half' } });
      await ok('void_tournament_match_event', adminA, { p_organization_id: S.org, p_event_id: incident.id, p_reason: 'Incidencia descartada' });
      const submitted = await ok('submit_tournament_match_operation', adminA, base);
      assert.equal(torneosSql(`select status from public.tournament_match_operations where id=${lit(S.op)}`).trim(), 'submitted', JSON.stringify(submitted).slice(0, 200));
    });

    await check('B8 review (owner) → dual control (submitter cannot validate) → validate (owner) → official twice concurrently (idempotent, one official)', async () => {
      const base = { p_organization_id: S.org, p_match_operation_id: S.op };
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Acta verificada' });
      const dual = await denied('validate_tournament_match_operation', adminA, base);
      assert.equal(errMsg(dual), 'TORNEOS_MATCH_DUAL_CONTROL_REQUIRED');
      await ok('validate_tournament_match_operation', owner, base);
      const race = await Promise.all([gw('make_tournament_match_official', await tok(owner), base), gw('make_tournament_match_official', await tok(adminA), base)]);
      assert.deepEqual(race.map((r) => r.status), [200, 200], race.map(show).join(' | '));
      exercised.set('make_tournament_match_official', { params: base, actor: 'owner' });
      assert.equal(torneosSql(`select count(*) from public.tournament_match_operations where match_id=${lit(S.m.id)} and status='official'`).trim(), '1');
    });

    const standingsRow = (rows, entry) => (rows || []).find((r) => [r.teamEntryId, r.team_entry_id, r.entryId].includes(entry));
    const pointsOf = (payload, entry) => {
      const rows = payload?.standings ?? payload?.rows ?? payload?.table ?? [];
      const row = standingsRow(rows, entry);
      return row ? Number(row.points ?? row.pts) : null;
    };
    await check('B9 standings: rebuild (idempotent key) → context shows 3/0 → publish revision → the participant reads the published table', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null };
      const key = randomUUID();
      const revision = await ok('rebuild_tournament_standings', owner, { ...scope, p_reason: 'Primer resultado oficial', p_idempotency_key: key });
      const replay = await ok('rebuild_tournament_standings', owner, { ...scope, p_reason: 'Primer resultado oficial', p_idempotency_key: key });
      assert.deepEqual(replay, revision, 'same idempotency key → same revision');
      S.revision1 = revision?.revisionId ?? revision?.id ?? revision;
      assert.match(String(S.revision1), /^[0-9a-f-]{36}$/, JSON.stringify(revision).slice(0, 200));
      // Staff with standings.rebuild see the draft revision; read-only staff only what is published.
      const draftView = await ok('get_tournament_standings_context', owner, scope);
      assert.deepEqual([pointsOf(draftView, S.home.entry), pointsOf(draftView, S.away.entry)], [3, 0], JSON.stringify(draftView).slice(0, 600));
      const beforePublish = await ok('get_tournament_standings_context', collaborator, scope);
      assert.equal(beforePublish.revision, null, 'nothing published yet for read-only staff');
      await ok('publish_tournament_standings_revision', owner, { p_revision_id: S.revision1, p_reason: 'Publicación' });
      const afterPublish = await ok('get_tournament_standings_context', collaborator, scope);
      assert.deepEqual([pointsOf(afterPublish, S.home.entry), pointsOf(afterPublish, S.away.entry)], [3, 0], JSON.stringify(afterPublish).slice(0, 600));
      const published = await ok('get_published_tournament_standings', player, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
      assert.equal(pointsOf(published, S.home.entry), 3, JSON.stringify(published).slice(0, 600));
    });

    await check('B10 correction: request (admin) → concurrent create (one version) → score 1-1 (goal voided) → submit/review/validate/official → rebuild → table updated 1/1', async () => {
      await ok('request_tournament_match_correction', adminA, { p_organization_id: S.org, p_match_operation_id: S.op, p_reason: 'Gol anulado por la mesa' });
      const race = await Promise.all([gw('create_tournament_match_correction', await tok(owner), { p_organization_id: S.org, p_match_operation_id: S.op }),
        gw('create_tournament_match_correction', await tok(adminA), { p_organization_id: S.org, p_match_operation_id: S.op })]);
      const winners = race.filter((r) => r.status === 200);
      assert.equal(winners.length, 1, `one correction version: ${race.map(show).join(' | ')}`);
      exercised.set('create_tournament_match_correction', { params: { p_organization_id: S.org, p_match_operation_id: S.op }, actor: 'owner' });
      S.op2 = winners[0].body.operation.id;
      assert.equal(torneosSql(`select count(*) from public.tournament_match_operations where match_id=${lit(S.m.id)} and status='official'`).trim(), '1', 'the official version stays in force during the correction');
      const secondGoal = operationEvents(S.op2).find((e) => e.type === 'goal' && e.team === S.home.entry && e.player === S.home.players[2]);
      assert.ok(secondGoal, 'events copied into the correction');
      const base = { p_organization_id: S.org, p_match_operation_id: S.op2 };
      await ok('void_tournament_match_event', owner, { p_organization_id: S.org, p_event_id: secondGoal.id, p_reason: 'Gol anulado' });
      await ok('set_tournament_match_score', owner, { ...base, p_score: { homeScore: 1, awayScore: 1, scoreType: 'played' } });
      await ok('submit_tournament_match_operation', owner, base);
      await ok('review_tournament_match_operation', adminA, { ...base, p_decision: 'approved', p_reason: 'Corrección revisada' });
      await ok('validate_tournament_match_operation', adminA, base);
      await ok('make_tournament_match_official', owner, base);
      assert.equal(torneosSql(`select string_agg(status, ',' order by operation_version) from public.tournament_match_operations where match_id=${lit(S.m.id)}`).trim(), 'superseded,official');
      const scope = { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null };
      const revision = await ok('rebuild_tournament_standings', adminA, { ...scope, p_reason: 'Corrección oficial', p_idempotency_key: randomUUID() });
      S.revision2 = revision?.revisionId ?? revision?.id ?? revision;
      await ok('publish_tournament_standings_revision', adminA, { p_revision_id: S.revision2, p_reason: 'Tabla corregida' });
      const standings = await ok('get_tournament_standings_context', owner, scope);
      assert.deepEqual([pointsOf(standings, S.home.entry), pointsOf(standings, S.away.entry)], [1, 1], JSON.stringify(standings).slice(0, 600));
      const published = await ok('get_published_tournament_standings', S.home.captain, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
      assert.deepEqual([pointsOf(published, S.home.entry), pointsOf(published, S.away.entry)], [1, 1]);
    });

    await check('B11 statistics / scorers: official statistics after the correction (1 goal each side, voided goal gone); published statistics for participants', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null };
      const stats = await ok('get_tournament_statistics_context', collaborator, scope);
      const text = JSON.stringify(stats);
      assert.ok(text.includes(S.home.players[3]) || text.includes(`Delantero ${S.home.name}`), `home scorer present: ${text.slice(0, 500)}`);
      assert.ok(!text.includes(`Volante ${S.home.name}`) || /"goals":0/.test(text), 'the voided goal does not count');
      await ok('get_published_tournament_statistics', player, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
    });

    await check('B12 participant hub: hub, category preference, published matches / match / teams (player and captain)', async () => {
      const hub = await ok('get_tournament_participant_hub', player, { p_tournament_id: S.A.id, p_category_id: null });
      assert.ok(hub?.tournament, JSON.stringify(hub).slice(0, 200));
      await ok('set_my_tournament_hub_category', player, { p_tournament_id: S.A.id, p_category_id: S.A.category });
      const matches = await ok('get_published_tournament_matches', player, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_view: 'all', p_team_entry_id: null, p_limit: 20, p_offset: 0 });
      assert.ok(JSON.stringify(matches).includes(S.m.id));
      const match = await ok('get_tournament_participant_match', S.home.captain, { p_match_id: S.m.id });
      assert.ok(JSON.stringify(match).includes(S.m.id));
      await ok('get_published_tournament_teams', player, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_limit: 16, p_offset: 0 });
    });

    await check('B13 communications + notifications: draft → audience → link → preview → publish; inbox, read, document publish + acknowledge; preferences', async () => {
      const ctx = await ok('get_tournament_communications_admin_context', owner, { p_organization_id: S.org, p_tournament_id: S.A.id });
      assert.ok(ctx);
      const draftKey = randomUUID();
      const draft = await ok('create_tournament_announcement_draft', adminA, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: null, p_announcement_type: 'schedule_change', p_title: 'Cambio de horario', p_summary: 'Se movió un partido', p_body: 'La fecha 1 cambia de horario.', p_priority: 'important', p_acknowledgement_mode: 'none', p_scheduled_for: null, p_supersedes_id: null, p_correction_reason: null, p_idempotency_key: draftKey });
      S.announcement = draft.id ?? draft.announcementId ?? draft;
      assert.match(String(S.announcement), /^[0-9a-f-]{36}$/, JSON.stringify(draft).slice(0, 200));
      const replay = await ok('create_tournament_announcement_draft', adminA, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: null, p_announcement_type: 'schedule_change', p_title: 'Cambio de horario', p_summary: 'Se movió un partido', p_body: 'La fecha 1 cambia de horario.', p_priority: 'important', p_acknowledgement_mode: 'none', p_scheduled_for: null, p_supersedes_id: null, p_correction_reason: null, p_idempotency_key: draftKey });
      assert.equal(replay.id ?? replay.announcementId ?? replay, S.announcement, 'same idempotency key → same draft');
      await ok('update_tournament_announcement_draft', adminA, { p_announcement_id: S.announcement, p_title: 'Cambio de horario (fecha 1)', p_summary: 'Se movió un partido', p_body: 'La fecha 1 cambia de horario.', p_priority: 'important', p_acknowledgement_mode: 'none', p_scheduled_for: null });
      await ok('replace_tournament_announcement_audience', adminA, { p_announcement_id: S.announcement, p_audience_type: 'tournament', p_category_id: null, p_team_entry_id: null, p_match_id: null, p_specific_user_id: null });
      await ok('set_tournament_announcement_link', adminA, { p_announcement_id: S.announcement, p_link_type: 'match', p_resource_id: S.m.id, p_external_url: null, p_label: 'Ver partido', p_sort_order: 0 });
      const preview = await ok('preview_tournament_announcement_audience', adminA, { p_announcement_id: S.announcement });
      const count = preview?.estimatedRecipients ?? preview?.recipientCount ?? null;
      assert.ok(Number(count) >= 1, JSON.stringify(preview).slice(0, 300));
      await ok('publish_tournament_announcement', owner, { p_announcement_id: S.announcement, p_expected_recipient_count: Number(count) });
      const inbox = await ok('get_tournament_communications_inbox', player, { p_tournament_id: S.A.id, p_filter: 'all', p_limit: 20, p_offset: 0 });
      assert.ok(JSON.stringify(inbox).includes(S.announcement), `player inbox: ${JSON.stringify(inbox).slice(0, 300)}`);
      await ok('get_tournament_announcement', player, { p_announcement_id: S.announcement });
      await ok('mark_tournament_announcement_read', player, { p_announcement_id: S.announcement, p_confirm: false });
      const doc = await ok('create_tournament_document', owner, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: null, p_document_type: 'regulation', p_title: 'Reglamento', p_summary: 'Reglas del torneo', p_body: 'Artículo 1: se juega limpio.', p_acknowledgement_mode: 'explicit', p_effective_at: null, p_idempotency_key: randomUUID() });
      const versionId = doc.versionId ?? doc.version?.id ?? doc.currentVersionId;
      assert.match(String(versionId), /^[0-9a-f-]{36}$/, JSON.stringify(doc).slice(0, 300));
      await ok('publish_tournament_document_version', owner, { p_version_id: versionId });
      const docs = await ok('get_published_tournament_documents', player, { p_tournament_id: S.A.id, p_category_id: null });
      assert.ok(JSON.stringify(docs).includes(versionId));
      await ok('acknowledge_tournament_document', player, { p_version_id: versionId, p_confirm: true });
      await ok('get_my_tournament_notification_preferences', player, { p_tournament_id: S.A.id });
      const prefs = await ok('update_my_tournament_notification_preferences', player, { p_tournament_id: S.A.id, p_general: true, p_match_changes: true, p_callups: false, p_discipline: true, p_documents: true, p_summaries: false });
      assert.ok(prefs);
      assert.equal(torneosSql(`select callups_enabled::text from public.tournament_notification_preferences where user_id=${lit(player.identity)} and tournament_id=${lit(S.A.id)}`).trim(), 'false', 'preference persisted');
    });

    await check('B14 public page: unpublished → null on the public route; admin publishes → anon reads the page with the official table; no private data', async () => {
      await ok('get_tournament_public_page_settings', owner, { p_organization_id: S.org, p_tournament_id: S.A.id });
      const published = await ok('set_tournament_public_page_published', owner, { p_organization_id: S.org, p_tournament_id: S.A.id, p_published: true });
      S.slug = published.publicSlug ?? published.public_slug ?? published.slug ?? torneosSql(`select public_slug from public.tournament_public_pages where tournament_id=${lit(S.A.id)}`).trim();
      assert.ok(S.slug, JSON.stringify(published));
      const page = await pub('get_public_tournament_page', { p_public_slug: S.slug, p_category_slug: null });
      assert.equal(page.status, 200, show(page));
      assert.ok(page.body?.tournament, show(page));
      const text = JSON.stringify(page.body);
      for (const secret of [owner.email, player.email, captains[0].email, player.identity, owner.identity, S.announcement]) assert.ok(!text.includes(secret), 'no private identity/communication data on the public page');
      assert.match(page.headers.get('cache-control') ?? '', /no-store/);
      const missing = await pub('get_public_tournament_page', { p_public_slug: `no-existe-${RUN}`, p_category_slug: null });
      assert.deepEqual([missing.status, missing.body], [200, null]);
    });

    // ------------------------------------------------ lifecycle finish / reopen, withdrawal (tournament C, 2 teams)
    await check('B15 lifecycle on a 2-team tournament: play the single match officially → finish (admin) → reopen denied to admin → reopen by owner', async () => {
      S.C = { ...(await mkTournament(S.seasonA, 'charlie')), season: S.seasonA };
      S.C.teams = [await approvedTeam(S.C, `Uno ${RUN}`, extraCaptains[0]), await approvedTeam(S.C, `Dos ${RUN}`, extraCaptains[1])];
      const scope = { p_organization_id: S.org, p_tournament_id: S.C.id, p_category_id: S.C.category };
      await ok('freeze_tournament_participants', adminA, { ...scope, p_idempotency_key: randomUUID() });
      S.C.fixture = (await ok('generate_tournament_fixture', adminA, { ...scope, p_seed: null, p_configuration: {}, p_idempotency_key: randomUUID() })).fixtureVersionId;
      await ok('publish_tournament_fixture', adminA, { p_organization_id: S.org, p_fixture_version_id: S.C.fixture });
      await ok('start_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: S.C.id });
      const match = JSON.parse(torneosSql(`select json_build_object('id', id, 'phase', phase_id) from public.tournament_matches where fixture_version_id=${lit(S.C.fixture)}`));
      const at = new Date(Date.now() + 3600_000); at.setUTCMinutes(0, 0, 0);
      await schedule(owner, { p_organization_id: S.org, p_match_id: match.id, p_scheduled_at: at.toISOString(), p_venue_id: S.venue, p_court_id: S.courtC, p_duration_minutes: 60, p_override_warnings: true, p_override_reason: 'Certificación' });
      const early = await gw('finish_tournament_competition', await tok(owner), { p_organization_id: S.org, p_tournament_id: S.C.id });
      assert.equal(errMsg(early), 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS', show(early));
      const op = (await ok('open_tournament_match_operation', owner, { p_organization_id: S.org, p_match_id: match.id, p_override_reason: null })).operation.id;
      const base = { p_organization_id: S.org, p_match_operation_id: op };
      await ok('set_tournament_match_outcome', owner, { ...base, p_outcome: { outcomeType: 'played', countsForStandings: true, countsForPlayerStats: true, requiresResolution: false } });
      const homeC = torneosSql(`select p.team_entry_id from public.tournament_matches m join public.tournament_competition_participants p on p.id = m.home_participant_id where m.id=${lit(match.id)}`).trim();
      await ok('set_tournament_match_score', owner, { ...base, p_score: { homeScore: 1, awayScore: 0, scoreType: 'played' } });
      await ok('add_tournament_match_event', owner, { ...base, p_event: { teamEntryId: homeC, rosterPlayerId: null, eventType: 'goal', minute: 20, period: 'first_half', unidentifiedPlayerReason: 'Autor no identificado en la planilla' } });
      await ok('submit_tournament_match_operation', owner, base);
      await ok('review_tournament_match_operation', adminA, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      await ok('validate_tournament_match_operation', adminA, base);
      await ok('make_tournament_match_official', adminA, base);
      S.C.match = match; S.C.homeEntry = homeC;
      const finished = await ok('finish_tournament_competition', adminA, { p_organization_id: S.org, p_tournament_id: S.C.id });
      assert.equal(finished.status, 'completed', JSON.stringify(finished));
      const adminReopen = await denied('reopen_tournament_competition', adminA, { p_organization_id: S.org, p_tournament_id: S.C.id, p_reason: 'Corrección de cierre' });
      assert.match(errMsg(adminReopen), /FORBIDDEN/);
      const reopened = await ok('reopen_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: S.C.id, p_reason: 'Corrección de cierre' });
      assert.equal(reopened.status, 'active', JSON.stringify(reopened));
    });

    await check('B16 withdrawal: collaborator / captain denied; admin withdraws a team from tournament A; participant marked withdrawn', async () => {
      const target = S.teams[3];
      const params = { p_organization_id: S.org, p_tournament_id: S.A.id, p_team_entry_id: target.entry, p_reason_code: 'voluntary_resignation', p_reason_text: 'Se retira' };
      await denied('withdraw_tournament_competition_participant', collaborator, params);
      await denied('withdraw_tournament_competition_participant', target.captain, params);
      const withdrawn = await ok('withdraw_tournament_competition_participant', adminA, params);
      assert.ok(withdrawn);
      assert.equal(torneosSql(`select status from public.tournament_competition_participants where team_entry_id=${lit(target.entry)} and participant_set_id=(select participant_set_id from public.tournament_fixture_versions where id=${lit(S.A.fixture)})`).trim(), 'withdrawn');
    });

    // ------------------------------------------------ groups: pots, draw, reopen participants (tournament D)
    await check('B17 groups: freeze → reopen participants → freeze again → save pots → group draw published → group fixture generated/published', async () => {
      S.D = { ...(await mkTournament(S.seasonA, 'delta', 'groups')), season: S.seasonA };
      S.D.teams = [];
      for (let i = 0; i < 4; i++) S.D.teams.push(await approvedTeam(S.D, `Grupo ${i} ${RUN}`, extraCaptains[2 + i]));
      const scope = { p_organization_id: S.org, p_tournament_id: S.D.id, p_category_id: S.D.category };
      await ok('freeze_tournament_participants', adminA, { ...scope, p_idempotency_key: randomUUID() });
      await ok('reopen_tournament_participants', adminA, { ...scope, p_reason: 'Faltaba confirmar un equipo' });
      assert.equal(torneosSql(`select string_agg(status, ',' order by created_at) from public.tournament_participant_sets where tournament_id=${lit(S.D.id)}`).trim(), 'reopened');
      await ok('freeze_tournament_participants', adminA, { ...scope, p_idempotency_key: randomUUID() });
      const participants = JSON.parse(torneosSql(`select json_agg(p.id order by p.snapshot_name) from public.tournament_competition_participants p join public.tournament_participant_sets s on s.id = p.participant_set_id where s.tournament_id=${lit(S.D.id)} and s.status='frozen'`));
      const pots = [{ potNumber: 1, name: 'Bombo 1', participantIds: participants.slice(0, 2) }, { potNumber: 2, name: 'Bombo 2', participantIds: participants.slice(2) }];
      const saved = await gw('save_tournament_draw_pots', await tok(adminA), { ...scope, p_pots: pots });
      if (saved.status !== 200) {
        // Pot payload keys differ by version: try the member-list form once before failing.
        const alt = [{ number: 1, name: 'Bombo 1', members: participants.slice(0, 2).map((participantId, i) => ({ participantId, seed: i + 1 })) }, { number: 2, name: 'Bombo 2', members: participants.slice(2).map((participantId, i) => ({ participantId, seed: i + 1 })) }];
        await ok('save_tournament_draw_pots', adminA, { ...scope, p_pots: alt });
      } else exercised.set('save_tournament_draw_pots', { params: { ...scope, p_pots: pots }, actor: 'admin-a' });
      const draw = await ok('execute_tournament_group_draw', adminA, { ...scope, p_group_count: 2, p_seed: `draw-${RUN}`, p_publish: true });
      assert.ok(draw);
      assert.equal(torneosSql(`select count(*) from public.tournament_groups where tournament_id=${lit(S.D.id)} and status='published'`).trim(), '2');
      const fixture = await ok('generate_tournament_fixture', adminA, { ...scope, p_seed: null, p_configuration: {}, p_idempotency_key: randomUUID() });
      S.D.fixture = fixture.fixtureVersionId;
      await ok('publish_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.D.fixture });
      assert.equal(torneosSql(`select count(*) from public.tournament_matches where fixture_version_id=${lit(S.D.fixture)}`).trim(), '2', '2 groups × 2 teams = 2 matches');
      const manual = await ok('create_manual_fixture_version', owner, { ...scope, p_source_fixture_version_id: null, p_idempotency_key: randomUUID() });
      assert.equal(manual.status, 'draft', JSON.stringify(manual));
    });

    await check('B18 qualification: group matches official → group tables resolved; league C table → playoffs appended → qualification fills the final (cross-season admin refused)', async () => {
      const matches = JSON.parse(torneosSql(`select json_agg(json_build_object('id', m.id, 'phase', m.phase_id, 'group', m.group_id) order by m.match_number) from public.tournament_matches m where m.fixture_version_id=${lit(S.D.fixture)}`));
      await ok('start_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: S.D.id });
      const at = new Date(Date.now() + 3600_000); at.setUTCMinutes(0, 0, 0);
      const revisions = [];
      for (const [i, m] of matches.entries()) {
        await schedule(owner, { p_organization_id: S.org, p_match_id: m.id, p_scheduled_at: new Date(at.getTime() + i * 2 * 3600_000).toISOString(), p_venue_id: S.venue, p_court_id: S.courtD, p_duration_minutes: 60, p_override_warnings: true, p_override_reason: 'Certificación' });
        const op = (await ok('open_tournament_match_operation', owner, { p_organization_id: S.org, p_match_id: m.id, p_override_reason: 'Certificación de grupos' })).operation.id;
        const base = { p_organization_id: S.org, p_match_operation_id: op };
        await ok('set_tournament_match_outcome', owner, { ...base, p_outcome: { outcomeType: 'played', countsForStandings: true, countsForPlayerStats: true, requiresResolution: false } });
        const home = S.D.teams.find((x) => x.entry === torneosSql(`select p.team_entry_id from public.tournament_matches m join public.tournament_competition_participants p on p.id = m.home_participant_id where m.id=${lit(m.id)}`).trim());
        await ok('set_tournament_match_score', owner, { ...base, p_score: { homeScore: 1, awayScore: 0, scoreType: 'played' } });
        // No squads were submitted for the group matches: the goal is recorded without an identified author.
        await ok('add_tournament_match_event', owner, { ...base, p_event: { teamEntryId: home.entry, rosterPlayerId: null, eventType: 'goal', minute: 12, period: 'first_half', unidentifiedPlayerReason: 'Autor no identificado en la planilla' } });
        await ok('submit_tournament_match_operation', owner, base);
        await ok('review_tournament_match_operation', adminA, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
        await ok('validate_tournament_match_operation', adminA, base);
        await ok('make_tournament_match_official', adminA, base);
        const rev = await ok('rebuild_tournament_standings', owner, { p_organization_id: S.org, p_tournament_id: S.D.id, p_category_id: S.D.category, p_phase_id: m.phase, p_group_id: m.group, p_reason: 'Grupo cerrado', p_idempotency_key: randomUUID() });
        const revId = rev?.revisionId ?? rev?.id ?? rev;
        await ok('publish_tournament_standings_revision', owner, { p_revision_id: revId, p_reason: 'Tabla de grupo' });
        revisions.push(revId);
      }
      S.D.revisions = revisions;
      // Groups format: each decided group table resolves cleanly (no knockout sources in a pure groups format).
      for (const revision of revisions) {
        const resolved = await ok('resolve_tournament_qualification', owner, { p_revision_id: revision, p_reason: 'Clasificación de grupo' });
        assert.ok(resolved, JSON.stringify(resolved));
      }
      // League + playoffs on tournament C (league, reopened, its single match official 1-0): table → final appended
      // from the league positions → qualification resolved from the published table fills both finalists.
      const leagueScope = { p_organization_id: S.org, p_tournament_id: S.C.id, p_category_id: S.C.category, p_phase_id: S.C.match.phase, p_group_id: null };
      const rev = await ok('rebuild_tournament_standings', owner, { ...leagueScope, p_reason: 'Fin de la liga', p_idempotency_key: randomUUID() });
      const revC = rev?.revisionId ?? rev?.id ?? rev;
      await ok('publish_tournament_standings_revision', owner, { p_revision_id: revC, p_reason: 'Tabla final de liga' });
      const playoffs = await ok('append_tournament_playoff_phase', adminA, { p_organization_id: S.org, p_tournament_id: S.C.id, p_category_id: S.C.category, p_source_phase_id: S.C.match.phase, p_qualifier_count: 2, p_double_leg: false, p_idempotency_key: randomUUID() });
      const final = torneosSql(`select id from public.tournament_matches where phase_id=${lit(playoffs.phaseId)} order by match_number limit 1`).trim();
      assert.match(final, /^[0-9a-f-]{36}$/, `final created: ${JSON.stringify(playoffs).slice(0, 300)}`);
      assert.equal(torneosSql(`select (home_participant_id is null and away_participant_id is null)::text from public.tournament_matches where id=${lit(final)}`).trim(), 'true', 'finalists pending until qualification');
      const denied2 = await gw('resolve_tournament_qualification', await tok(adminB), { p_revision_id: revC, p_reason: 'Otra temporada' });
      assert.equal(errMsg(denied2), 'TORNEOS_QUALIFICATION_FORBIDDEN', show(denied2));
      await ok('resolve_tournament_qualification', owner, { p_revision_id: revC, p_reason: 'Clasificación de la liga' });
      assert.equal(torneosSql(`select (home_participant_id is not null and away_participant_id is not null)::text from public.tournament_matches where id=${lit(final)}`).trim(), 'true', 'both finalists resolved from the league table');
    });

    // ================================================================ C. negative matrix over every exercised RPC
    torneosSql(`update public.tournament_organization_members set status='removed' where organization_id=${lit(S.org)} and user_id=${lit(removed.identity)}`);
    await check('C1 every allowlisted RPC was exercised by the journey (or is certified at the guard level with the reason recorded)', async () => {
      const missing = ALLOW.filter((n) => !exercised.has(n));
      assert.deepEqual(missing, [], `not exercised: ${missing.join(', ')}`);
    });
    await check('C2 negative matrix: outsider (other workspace), unassigned-season admin, removed membership, captain/player on staff RPCs, collaborator on staff writes → 403 42501, no state change', async () => {
      const spec = contract.features;
      const categoryOf = (n) => Object.values(spec).map((f) => f.rpcs[n]).find(Boolean);
      for (const [name, { params }] of exercised) {
        if (!ALLOW.includes(name)) continue;
        const c = categoryOf(name);
        const actors = [];
        if (c.category === 'ADMIN_OWNER') {
          actors.push([outsider, 'cross-workspace']);
          actors.push([removed, 'inactive-membership']);
          if (c.scope === 'season') actors.push([adminB, 'cross-season']);
          if (c.write && !c.collaborator_allowed) actors.push([collaborator, 'collaborator-write']);
          if (c.write) actors.push([player, 'participant']);
          if (c.write && !c.team_manager) actors.push([S.teams[1].captain, 'captain']);
        } else if (c.category === 'PRIVATE_AUTHENTICATED' && c.scope !== 'self') {
          actors.push([outsider, 'cross-workspace']);
        }
        for (const [who, why] of actors) {
          const r = await gw(name, await tok(who), params);
          const row = { rpc: name, actor: who.label, why, status: r.status, code: errCode(r), message: errMsg(r) };
          matrix.push(row);
          assert.ok([401, 403].includes(r.status) && r.body?.code === '42501', `${name} as ${who.label} (${why}) must be 42501: ${show(r)}`);
        }
      }
      assert.ok(matrix.length > 150, `matrix size ${matrix.length}`);
    });
    await check('C2b self-scoped RPCs (no resource argument, or only the caller\'s own rows): an outsider sees none of this workspace\'s matches, squads or announcements', async () => {
      await tok(outsider);
      const leak = (r, needle) => r.status === 200 && JSON.stringify(r.body ?? null).includes(needle);
      const mine = await gw('get_player_tournament_matches', outsider.token, {});
      assert.equal(mine.status, 200, show(mine)); assert.ok(!leak(mine, S.m.id), 'outsider player matches: no foreign match');
      const managed = await gw('get_managed_tournament_matches', outsider.token, {});
      assert.equal(managed.status, 200, show(managed)); assert.ok(!leak(managed, S.m.id), 'outsider managed matches: no foreign match');
      const squad = await gw('get_my_managed_match_squad_context', outsider.token, { p_match_id: S.m.id });
      // A SQL function joined on the caller's active captain/delegate row: for anyone else the join is empty → null.
      assert.deepEqual([squad.status, squad.body], [200, null], `outsider squad context: ${show(squad)}`);
      const inbox = await gw('get_tournament_communications_inbox', outsider.token, { p_tournament_id: S.A.id, p_filter: 'all', p_limit: 20, p_offset: 0 });
      assert.ok(!leak(inbox, S.announcement), `outsider inbox: ${show(inbox)}`);
      assert.ok([200, 403].includes(inbox.status), show(inbox));
      // The rival captain manages the other side only: the home squad context is not theirs.
      const rival = await gw('get_my_managed_match_squad_context', await tok(S.away.captain), { p_match_id: S.m.id });
      assert.equal(rival.status, 200, show(rival));
      assert.ok(S.home.players.every((id) => !leak(rival, id)), `rival captain sees no home roster: ${show(rival)}`);
      matrix.push(...[['get_player_tournament_matches', mine], ['get_managed_tournament_matches', managed], ['get_my_managed_match_squad_context', squad], ['get_tournament_communications_inbox', inbox]]
        .map(([rpc, r]) => ({ rpc, actor: 'outsider', why: 'self-scope-isolation', status: r.status, code: r.body?.code ?? null, message: r.status === 200 ? (r.body === null ? 'null' : 'no foreign rows') : (r.body?.message ?? null) })));
    });
    await check('C3 no bearer → 401 at the gateway for every allowlisted RPC (before PostgREST)', async () => {
      for (const n of ALLOW) {
        const r = await gw(n, null, {});
        assert.deepEqual([r.status, r.body], [401, { error: 'access denied' }], n);
      }
    });
    await check('C4 anon straight at PostgREST: every newly granted function is refused by the DB ACL; closed functions refused for authenticated too', async () => {
      const calls = [
        ...GRANTED.map((n) => ({ id: `anon:${n}`, path: `/rpc/${n}`, body: exercised.get(n)?.params ?? {} })),
        ...CLOSED.map((f) => f.split('(')[0]).map((n) => ({ id: `auth:${n}`, path: `/rpc/${n}`, token: owner.token, body: {} })),
      ];
      await tok(owner);
      for (const r of restBatch(calls.map((c) => (c.token ? { ...c, token: owner.token } : c)))) {
        assert.ok([401, 403, 404].includes(r.status), `${r.id}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        if (r.status !== 404) assert.equal(r.body?.code, '42501', `${r.id}: ${JSON.stringify(r.body).slice(0, 200)}`);
      }
    });

    // ================================================================ D. contract edges
    await check('D1 RPCs outside the contract are refused by the gateway even with a valid session (service-only, OFF features)', async () => {
      for (const n of [...CLOSED.map((f) => f.split('(')[0]), 'get_tournament_branding_context', 'set_tournament_team_visual_policy', 'get_public_tournament_branding', 'request_tournament_media_upload_session']) {
        const r = await gw(n, await tok(owner), {});
        assert.deepEqual([r.status, r.body], [403, { error: 'rpc not enabled' }], n);
      }
      // The public RPC is not on the authenticated route either.
      const viaAuth = await gw('get_public_tournament_page', await tok(owner), { p_public_slug: S.slug, p_category_slug: null });
      assert.deepEqual([viaAuth.status, viaAuth.body], [403, { error: 'rpc not enabled' }]);
    });
    await check('D2 public route: credentials refused, only the listed RPC, POST + JSON only, exact arguments, size limit', async () => {
      const body = { p_public_slug: S.slug, p_category_slug: null };
      assert.deepEqual(await pub('get_public_tournament_page', body, { authorization: `Bearer ${await tok(owner)}` }).then((r) => [r.status, r.body]), [400, { error: 'public route accepts no credentials' }]);
      assert.deepEqual(await pub('get_public_tournament_page', body, { apikey: 'x' }).then((r) => [r.status, r.body]), [400, { error: 'public route accepts no credentials' }]);
      for (const n of ['get_published_tournament_matches', 'get_tournament_participant_hub', 'get_public_tournament_branding', 'get_tournament_workspace_context']) {
        assert.deepEqual(await pub(n, {}).then((r) => [r.status, r.body]), [403, { error: 'rpc not enabled' }], n);
      }
      assert.equal((await pub('get_public_tournament_page', undefined, {}, 'GET')).status, 405);
      assert.equal((await pub('get_public_tournament_page', 'p_public_slug=x', { 'content-type': 'text/plain' })).status, 415);
      assert.equal((await pub('get_public_tournament_page', '{bad', {})).status, 400);
      assert.equal((await pub('get_public_tournament_page', { ...body, p_extra: 1 })).status, 400);
      assert.equal((await pub('get_public_tournament_page', { p_public_slug: 1 })).status, 400);
      assert.equal((await pub('get_public_tournament_page', { p_category_slug: null })).status, 400);
      assert.equal((await pub('get_public_tournament_page', { p_public_slug: 'x'.repeat(4000) })).status, 413);
      const okPage = await pub('get_public_tournament_page', { p_public_slug: S.slug });
      assert.equal(okPage.status, 200, 'the optional argument defaults to null');
    });
    await check('D3 invalid IDs: unknown organization / match / operation → 403 42501; malformed UUID → 400; wrong-organization pairing → 403', async () => {
      const unknown = await gw('get_tournament_fixture_context', await tok(owner), { p_organization_id: randomUUID(), p_tournament_id: S.A.id, p_category_id: S.A.category });
      assert.ok([403].includes(unknown.status) || (unknown.status === 200 && JSON.stringify(unknown.body) === '{}'), show(unknown));
      await denied('make_tournament_match_official', owner, { p_organization_id: S.org, p_match_operation_id: randomUUID() });
      await denied('open_tournament_match_operation', owner, { p_organization_id: S.org, p_match_id: randomUUID(), p_override_reason: null });
      const malformed = await gw('open_tournament_match_operation', await tok(owner), { p_organization_id: 'not-a-uuid', p_match_id: S.m.id, p_override_reason: null });
      assert.equal(malformed.status, 400, show(malformed));
      await denied('open_tournament_match_operation', outsider, { p_organization_id: S.org2, p_match_id: S.m.id, p_override_reason: null });
    });
    await check('D4 bearer lifecycle: expired bridge → 401; re-exchange → 200; forged session id → 401; Core logout → exchange and RPC 401', async () => {
      const expired = await signedBridge(adminA, { exp: Math.floor(Date.now() / 1000) - 10 });
      const scope = { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category };
      assert.deepEqual(await gw('get_tournament_fixture_context', expired, scope).then((r) => [r.status, r.body]), [401, { error: 'access denied' }]);
      await exchange(adminA);
      assert.equal((await gw('get_tournament_fixture_context', adminA.token, scope)).status, 200);
      const forged = await signedBridge(adminA, { sessionId: randomUUID() });
      assert.equal((await gw('get_tournament_fixture_context', forged, scope)).status, 401);
      const quitter = await coreActor('logout');
      const logout = await request('/auth/v1/logout', quitter.coreToken, 'POST');
      assert.ok([200, 204].includes(logout.status));
      assert.equal((await request('/exchange', quitter.coreToken, 'POST')).status, 401);
      assert.equal((await gw('get_player_tournament_matches', quitter.token, {})).status, 401);
    });
    await check('D5 Core unavailable → 503 fail closed (no stale success); Torneos REST unavailable → 503; both recover', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category };
      await tok(owner);
      const coreService = GATEWAY_NAME === 'edge' ? 'core-functions' : 'core-auth';
      setService(coreService, 'stop');
      try {
        const r = await gw('get_tournament_fixture_context', owner.token, scope);
        assert.equal(r.status, 503, show(r));
        const w = await gw('rebuild_tournament_standings', owner.token, { ...scope, p_phase_id: S.A.phase, p_group_id: null, p_reason: 'caído', p_idempotency_key: randomUUID() });
        assert.equal(w.status, 503, 'no write while Core is unavailable');
      } finally { setService(coreService, 'start'); }
      await waitFor('Core', async () => (await gw('get_tournament_fixture_context', owner.token, scope)).status === 200);
      setService('torneos-rest', 'stop');
      try {
        const r = await gw('get_tournament_fixture_context', owner.token, scope);
        assert.equal(r.status, 503, show(r));
        const p = await pub('get_public_tournament_page', { p_public_slug: S.slug, p_category_slug: null });
        assert.equal(p.status, 503, show(p));
      } finally { setService('torneos-rest', 'start'); }
      await waitFor('Torneos REST', async () => (await gw('get_tournament_fixture_context', owner.token, scope)).status === 200);
    });
    await check('D5b public route bounds: shape-invalid slugs refused before Torneos REST; at most 16 anonymous calls in flight per gateway instance (the rest 503 busy at once); slots released', async () => {
      setService('torneos-rest', 'pause');
      let burst;
      try {
        // REST frozen: a refusal that needed it would hang ~5 s and end 503. These answer 400 at once.
        for (const bad of [{ p_public_slug: 'Bad_Slug' }, { p_public_slug: 'ab' }, { p_public_slug: '-abc' }, { p_public_slug: S.slug, p_category_slug: 'x' }]) {
          const t0 = Date.now(); const r = await pub('get_public_tournament_page', bad);
          assert.deepEqual([r.status, r.body], [400, { error: 'invalid arguments' }], JSON.stringify(bad));
          assert.ok(Date.now() - t0 < 2000, 'refused without an upstream request');
        }
        burst = await Promise.all(Array.from({ length: 40 }, () => pub('get_public_tournament_page', { p_public_slug: S.slug, p_category_slug: null })));
      } finally { setService('torneos-rest', 'unpause'); }
      const busy = burst.filter((r) => r.status === 503 && r.body?.error === 'public route busy');
      const waited = burst.filter((r) => !(r.status === 503 && r.body?.error === 'public route busy'));
      assert.ok(burst.every((r) => r.status === 503), `every call fails closed while REST is frozen: ${[...new Set(burst.map((r) => r.status))]}`);
      assert.equal(waited.length, 16, `exactly the bound reached Torneos REST (busy ${busy.length})`);
      assert.equal(busy.length, 24);
      await waitFor('Torneos REST', async () => (await pub('get_public_tournament_page', { p_public_slug: S.slug, p_category_slug: null })).status === 200);
      const again = await Promise.all(Array.from({ length: 16 }, () => pub('get_public_tournament_page', { p_public_slug: S.slug, p_category_slug: null })));
      assert.deepEqual([...new Set(again.map((r) => r.status))], [200], 'all 16 slots were released');
    });
    await check('D6 persistence: after new exchanges and a gateway restart the table, report and public page read back identically', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null };
      const before = await ok('get_published_tournament_standings', player, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
      setService(GATEWAY_NAME === 'edge' ? 'torneos-functions' : 'gateway', 'restart');
      await waitFor('gateway', async () => (await fetch(`${GATEWAY_BASE}/health`, { signal: AbortSignal.timeout(60000) })).ok);
      await exchange(player); await exchange(owner);
      const after = await ok('get_published_tournament_standings', player, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
      assert.deepEqual(after, before);
      const standings = await ok('get_tournament_standings_context', owner, scope);
      assert.deepEqual([pointsOf(standings, S.home.entry), pointsOf(standings, S.away.entry)], [1, 1]);
      const page = await pub('get_public_tournament_page', { p_public_slug: S.slug, p_category_slug: null });
      assert.equal(page.status, 200);
    });
    await check('D7 table routes: a bearer cannot write competition tables directly (RLS: no client write policy); reads stay RLS-scoped', async () => {
      await tok(outsider);
      const w = await request(`/torneos/rest/v1/tournament_match_scores?match_operation_id=eq.${S.op2}`, outsider.token, 'PATCH', { home_score: 9 });
      assert.ok([401, 403, 404].includes(w.status) || (w.status === 200 && Array.isArray(w.body) && w.body.length === 0) || w.status === 204, show(w));
      assert.equal(torneosSql(`select home_score from public.tournament_match_scores where match_operation_id=${lit(S.op2)}`).trim(), '1');
      const read = await request(`/torneos/rest/v1/tournament_matches?select=id&tournament_id=eq.${S.A.id}`, outsider.token, 'GET');
      assert.deepEqual([read.status, read.body], [200, []], 'another workspace reads nothing');
    });
    await check('D8 no-store: every gateway response of this run (RPC, public, errors) carried Cache-Control: no-store', async () => {
      const bad = noStore.filter((r) => !/no-store/.test(r.cacheControl ?? ''));
      assert.deepEqual(bad, []);
      assert.ok(noStore.length > 400, `${noStore.length} responses`);
    });
  } finally {
    // Evidence: redacted — no bearer, password, token or email of this run may appear in it.
    const summary = { run: RUN, gateway: GATEWAY_NAME, at: new Date().toISOString(), total: results.length,
      passed: results.filter((r) => r.status === 'PASS').length, failed: results.filter((r) => r.status === 'FAIL').length,
      exercised: [...exercised.keys()].sort(), matrix_rows: matrix.length };
    if (process.env.CV1_EVIDENCE === '1') {
      const dir = `${repo}backend/torneos/competition-v1/evidence/${GATEWAY_NAME}`;
      await mkdir(dir, { recursive: true });
      const payload = JSON.stringify({ summary, results, matrix,
        no_store: { responses: noStore.length, without_no_store: noStore.filter((r) => !/no-store/.test(r.cacheControl ?? '')).length } }, null, 2) + '\n';
      for (const secret of seenSecrets.filter(Boolean)) if (payload.includes(secret)) throw new Error('evidence would leak a secret');
      await writeFile(`${dir}/results.json`, payload);
    }
    console.log(JSON.stringify(summary));
  }
});
