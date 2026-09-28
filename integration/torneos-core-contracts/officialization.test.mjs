// OFFICIALIZATION-V1 — optional dual control per tournament + organization membership, certified on the REAL
// local stack (the Phase 3A lab): real Core (GoTrue sessions + the Core contract Edge Function, verified email),
// Torneos baseline + 0001…0005 behind PostgREST, and the gateway under test (Node by default, Edge with GATEWAY=edge).
//
//   A. install / ACL / pins: 0005 applied from the migrations directory, exact ACL delta (+9 authenticated, anon
//      unchanged), replaced bodies pinned, idempotent re-apply, refusal of a non-POST_0004 state, rollback.
//   B. membership: invite (owner → admin/collaborator, admin → collaborator), accept through the Core verified-email
//      contract, email mismatch / revoked / expired / replaced / twice, role changes and removals within the rules,
//      no second owner, no self-change, no cross-organization reach.
//   C. the product journey with a SINGLE owner (dual control OFF, the default): result → self-validation →
//      official → standings / statistics → correction → standings; then dual control ON with invited admins
//      (the submitter cannot validate; any other authorized identity can), playoffs + qualification, finish /
//      reopen, withdrawn team — plus the dual-control negative matrix (OFF and ON).
//   D. contract edges: random IDs, invalid input, no bearer, anon and bearer-without-attestation straight at
//      PostgREST, the invitations table unreachable, the public route, Core outage on accept, Core logout,
//      no-store.
//
// Runs after `npm run up`. With OV1_EVIDENCE=1 the results go to backend/torneos/officialization-v1/evidence/<gateway>/.
// Nothing touches a remote target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { sql, sqlTry, inGateway, dc, BASE, GATEWAY_BASE, GATEWAY_NAME, repo } from './lab.mjs';

const RUN = 'ov1' + randomBytes(3).toString('hex');
const results = [];
const seenSecrets = [];
const torneosSql = (q) => sql('torneos-db', q);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const migrationsDir = `${repo}backend/torneos/supabase/migrations/`;
const MIGRATION = '00000000000005_officialization_v1.sql';
const migrationSql = await readFile(`${migrationsDir}${MIGRATION}`, 'utf8');
const rollbackSql = await readFile(`${repo}backend/torneos/officialization-v1/rollback/00000000000005_officialization_v1.rollback.sql`, 'utf8');
const contract = JSON.parse(await readFile(`${repo}backend/torneos/officialization-v1/contract.json`, 'utf8'));
const allowDoc = JSON.parse(await readFile(`${repo}backend/torneos/supabase/functions/torneos-gateway/officialization-v1-rpc-allowlist.json`, 'utf8'));
const competitionDoc = JSON.parse(await readFile(`${repo}backend/torneos/supabase/functions/torneos-gateway/competition-v1-rpc-allowlist.json`, 'utf8'));
const stagingDoc = JSON.parse(await readFile(`${repo}backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json`, 'utf8'));
const ALLOW = Object.values(allowDoc.features).flat();
const COMPETITION = Object.values(competitionDoc.features).flat();
const COMPETITION_PUBLIC = Object.values(competitionDoc.public).flat();
const STAGING = Object.values(stagingDoc.features).flat();
const NEW_FUNCTIONS = contract.acl.new_functions;
const PINS = contract.acl.replaced_bodies;

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
const pub = (name, data) => request(`/torneos/public/v1/rpc/${name}`, null, 'POST', data);
/** Direct PostgREST calls from INSIDE the private network (attacker position: no gateway). */
function restBatch(calls) {
  const out = inGateway(`const calls = ${JSON.stringify(calls)}; const out = [];
    for (const c of calls) {
      const r = await fetch('http://torneos-rest:3000' + c.path, { method: c.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...(c.token ? { authorization: 'Bearer ' + c.token } : {}) },
        body: c.method === 'GET' ? undefined : JSON.stringify(c.body ?? {}) });
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
async function coreActor(label, email = `${RUN}-${label}-${randomUUID().slice(0, 6)}@example.test`) {
  const password = `${randomUUID()}Aa!`;
  const s = await request('/auth/v1/signup', null, 'POST', { email, password, data: { full_name: `${RUN} ${label}` } });
  assert.equal(s.status, 200, `GoTrue signup for ${label}`);
  seenSecrets.push(s.body.access_token, s.body.refresh_token, password, email);
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
const setService = (service, action) => dc([action, service], undefined, true);
async function waitFor(label, probe, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try { if (await probe()) return; } catch { /* restarting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not recover`);
}
const aclCounts = () => torneosSql(`select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) || '/' ||
  count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'`).trim();
const bodyMd5 = (fn) => torneosSql(`select md5(prosrc) from pg_proc where oid = ${lit(fn)}::regprocedure`).trim();

// ---------------------------------------------------------------- the suite
test(`OFFICIALIZATION-V1 — optional dual control + organization membership on the real stack (${GATEWAY_NAME} gateway)`, async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 600) }); throw error; }
    });
  }
  const exercised = new Map();
  const ok = async (name, who, params = {}) => {
    const r = await gw(name, await tok(who), params);
    assert.equal(r.status, 200, `${name} as ${who.label}: ${show(r)}`);
    if (!exercised.has(name)) exercised.set(name, { params, actor: who.label });
    return r.body;
  };
  const matrix = [];
  /** A refusal: HTTP status in `status`, SQLSTATE `code` (PostgREST) and, when given, the exact TORNEOS_ message. */
  const denied = async (name, who, params, { status = [403], code = '42501', message, why = 'negative' } = {}) => {
    const r = await gw(name, who ? await tok(who) : null, params);
    matrix.push({ rpc: name, actor: who?.label ?? 'no-bearer', why, status: r.status, code: errCode(r), message: errMsg(r) });
    assert.ok(status.includes(r.status), `${name} as ${who?.label ?? 'no bearer'} (${why}) must be refused: ${show(r)}`);
    if (code) assert.equal(errCode(r), code, `${name} as ${who?.label} (${why}): ${show(r)}`);
    if (message) assert.equal(errMsg(r), message, `${name} as ${who?.label} (${why}): ${show(r)}`);
    return r;
  };
  const schedule = async (who, params) => {
    const r = await gw('schedule_tournament_match', await tok(who), params);
    assert.equal(r.status, 200, `schedule_tournament_match: ${show(r)}`);
    return r.body;
  };
  const S = {};

  try {
    // ================================================================ A. install / ACL / pins
    await check('A1 install: 0005 applied in order from the migrations directory; 0000–0004 byte-identical to their certified hashes', async () => {
      const install = JSON.parse(await readFile(`${repo}integration/torneos-core-contracts/.runtime/install.json`, 'utf8'));
      const applied = install.torneos.migrations_after_baseline.map((m) => m.file.split('/').pop());
      assert.deepEqual(applied, (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort().slice(1));
      // ERROR-CONTRACT-V1 (0006) applies after 0005; 0005 is still applied from this tree, in order.
      assert.ok(applied.includes(MIGRATION)); assert.deepEqual(applied.slice(applied.indexOf(MIGRATION) + 1), applied.filter((f) => f > MIGRATION));
      const entry = install.torneos.migrations_after_baseline.find((m) => m.file.endsWith(MIGRATION));
      assert.equal(entry.sha256, createHash('sha256').update(migrationSql).digest('hex'), 'the lab applied this tree\'s 0005');
      for (const [file, sha] of Object.entries(contract.untouched_migrations)) {
        const text = await readFile(`${migrationsDir}${file}`, 'utf8');
        assert.equal(createHash('sha256').update(text).digest('hex'), sha, `${file} unchanged`);
      }
    });
    await check('A2 ACL: exactly the 9 new RPCs gained authenticated (+service_role); anon/PUBLIC/server roles none; totals 162→171 / anon 12; 23 closed stay closed; authorizer stays private', async () => {
      const rows = JSON.parse(torneosSql(`select json_agg(json_build_object('f', p.oid::regprocedure::text,
        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'svc', has_function_privilege('service_role', p.oid, 'EXECUTE'),
        'adapter', has_function_privilege('torneos_core_adapter', p.oid, 'EXECUTE'), 'writer', has_function_privilege('torneos_identity_writer', p.oid, 'EXECUTE'),
        'definer', p.prosecdef and p.proconfig @> array['search_path=""'],
        'pub', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`));
      const byF = new Map(rows.map((r) => [r.f, r]));
      for (const f of NEW_FUNCTIONS) {
        const r = byF.get(f); assert.ok(r, f);
        assert.deepEqual([r.anon, r.auth, r.svc, r.adapter, r.writer, r.pub, r.definer], [false, true, true, false, false, false, true], f);
      }
      for (const f of contract.acl.still_closed) {
        const r = byF.get(f); assert.ok(r, f);
        assert.deepEqual([r.anon, r.auth], [false, false], `${f} stays closed`);
      }
      assert.equal(aclCounts(), `${contract.acl.authenticated_public_after}/${contract.acl.anon_public}`);
      assert.equal(contract.acl.authenticated_public_after - contract.acl.authenticated_public_before, NEW_FUNCTIONS.length);
      assert.equal(torneosSql(`select has_function_privilege('authenticated','private.authorize_core_contract(text,jsonb)','EXECUTE')::text || has_function_privilege('torneos_core_adapter','private.authorize_core_contract(text,jsonb)','EXECUTE')::text`).trim(), 'falsetrue');
    });
    await check('A3 schema: invitations table RLS on with no client privilege and no policy; dual-control column boolean NOT NULL DEFAULT false (every existing tournament OFF); configure capability owner-only', async () => {
      assert.equal(torneosSql(`select relrowsecurity::text from pg_class where oid='public.tournament_organization_invitations'::regclass`).trim(), 'true');
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(torneosSql(`select has_table_privilege(${lit(role)}, 'public.tournament_organization_invitations', 'SELECT,INSERT,UPDATE,DELETE')::text`).trim(), 'false', role);
      }
      assert.equal(torneosSql(`select count(*) from pg_policies where tablename='tournament_organization_invitations'`).trim(), '0');
      assert.equal(torneosSql(`select data_type||'|'||is_nullable||'|'||column_default from information_schema.columns where table_schema='public' and table_name='tournaments' and column_name='match_result_dual_control_enabled'`).trim(), 'boolean|NO|false');
      assert.equal(torneosSql(`select string_agg(role, ',') from public.tournament_organization_role_capabilities where capability='match_operations.configure_dual_control'`).trim(), 'owner');
    });
    await check('A4 pins: the three replaced bodies are the OFFICIALIZATION-V1 bodies (definer, search_path pinned); the team branch of the authorizer is unchanged', async () => {
      for (const pin of PINS) assert.equal(bodyMd5(pin.function), pin.md5_after, pin.function);
      const validate = torneosSql(`select prosrc from pg_proc where oid='public.validate_tournament_match_operation(uuid,uuid)'::regprocedure`);
      assert.match(validate, /if v_dual_control and v_self_validation then/);
      assert.match(validate, /v_dual_control := coalesce\(v_dual_control, true\)/, 'a missing tournament reads as ON');
      const authorize = torneosSql(`select prosrc from pg_proc where oid='private.authorize_core_contract(text,jsonb)'::regprocedure`);
      assert.ok(authorize.includes("v_token := p_request->>'token';"), 'team invitation branch kept');
    });
    await check('A5 migration: re-apply is a no-op; a state without 0004 in force and a third body state are refused before any change', async () => {
      const before = aclCounts();
      const again = sqlTry('torneos-db', migrationSql);
      assert.equal(again.ok, true, again.error);
      // ERROR-CONTRACT-V1: 0006 replaces a body 0005 also defines (set_tournament_match_dual_control), so re-applying
      // 0005 alone would roll that edit back: the certified state is 0005 + every later migration, re-applied in order.
      for (const later of (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql') && f > MIGRATION).sort()) {
        const tail = sqlTry('torneos-db', await readFile(`${migrationsDir}${later}`, 'utf8'));
        assert.equal(tail.ok, true, `${later}: ${tail.error}`);
      }
      assert.equal(aclCounts(), before);
      const strip = migrationSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
      const no0004 = sqlTry('torneos-db', `BEGIN; REVOKE EXECUTE ON FUNCTION public.make_tournament_match_official(uuid,uuid) FROM authenticated; ${strip} ROLLBACK;`);
      assert.equal(no0004.ok, false); assert.match(no0004.error, /TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED: 0004 not in force/);
      const third = sqlTry('torneos-db', `BEGIN; CREATE OR REPLACE FUNCTION public.validate_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$ select '{}'::jsonb $$; ${strip} ROLLBACK;`);
      assert.equal(third.ok, false); assert.match(third.error, /TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED: .*validate_tournament_match_operation/);
      assert.equal(bodyMd5('public.validate_tournament_match_operation(uuid,uuid)'), PINS[0].md5_after, 'nothing changed');
    });
    await check('A6 rollback: in a rolled-back transaction it restores the POST_0004 bodies and 162/12, then 0005 is intact', async () => {
      const r = sqlTry('torneos-db', `BEGIN; ${rollbackSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')}
        SELECT (select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f')
          || '|' || (select md5(prosrc) from pg_proc where oid='public.validate_tournament_match_operation(uuid,uuid)'::regprocedure);
        ROLLBACK;`);
      assert.equal(r.ok, true, r.error);
      assert.equal(r.out.trim().split('\n').pop(), `${contract.acl.authenticated_public_before}|${PINS[0].md5_before}`);
      assert.equal(aclCounts(), `${contract.acl.authenticated_public_after}/${contract.acl.anon_public}`);
    });
    await check('A7 gateway: the officialization allowlist = contract.json, disjoint from staging v1 (43), competition (74) and the public route', async () => {
      assert.equal(ALLOW.length, 9); assert.equal(new Set(ALLOW).size, 9);
      assert.deepEqual(ALLOW.filter((n) => STAGING.includes(n) || COMPETITION.includes(n) || COMPETITION_PUBLIC.includes(n)), []);
      assert.deepEqual([...ALLOW].sort(), NEW_FUNCTIONS.map((f) => f.replace(/^public\./, '').split('(')[0]).sort());
      assert.deepEqual([...ALLOW].sort(), Object.values(contract.features).flatMap((f) => Object.keys(f.rpcs)).sort());
      assert.equal(STAGING.length, 43); assert.equal(COMPETITION.length, 74);
    });

    // ================================================================ actors
    const owner = await coreActor('owner');
    const userB = await coreActor('admin-b');
    const userC = await coreActor('admin-c');
    const collab = await coreActor('collab');
    const season2Admin = await coreActor('season2-admin');
    const removedAdmin = await coreActor('removed-admin');
    const outsider = await coreActor('outsider');
    const wrongEmail = await coreActor('wrong-email');
    const late = await coreActor('late');
    const player = await coreActor('player');
    const captains = [];
    for (let i = 0; i < 9; i++) captains.push(await coreActor(`captain-${i}`));
    const invite = async (who, email, role) => {
      const r = await ok('invite_tournament_organization_member', who, { p_organization_id: S.org, p_email: email, p_role: role });
      assert.match(r.token, /^[0-9a-f]{64}$/); seenSecrets.push(r.token);
      return r;
    };
    const membershipOf = (who, org = S.org) => torneosSql(`select id from public.tournament_organization_members where organization_id=${lit(org)} and user_id=${lit(who.identity)}`).trim();

    // ================================================================ B. membership
    await check('B1 User A creates the organization (sole owner) and two seasons; an outsider owns another organization', async () => {
      S.org = (await ok('create_tournament_organization', owner, { p_name: `Liga ${RUN}`, p_slug: `liga-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
      S.org2 = (await ok('create_tournament_organization', outsider, { p_name: `Otra ${RUN}`, p_slug: `otra-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
      S.seasonA = (await ok('create_tournament_season', owner, { p_organization_id: S.org, p_name: 'Apertura', p_slug: `apertura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      S.seasonB = (await ok('create_tournament_season', owner, { p_organization_id: S.org, p_name: 'Clausura', p_slug: `clausura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      const members = await ok('list_tournament_organization_members', owner, { p_organization_id: S.org });
      assert.deepEqual(members.map((m) => [m.role, m.isViewer]), [['owner', true]]);
    });
    await check('B2 owner invites User B as ADMIN: one-time token (only its sha256 stored), pending invitation listed with email', async () => {
      const r = await invite(owner, userB.email, 'admin');
      S.inviteB = r;
      assert.equal(r.role, 'admin'); assert.equal(r.email, userB.email.toLowerCase());
      const stored = torneosSql(`select token_hash from public.tournament_organization_invitations where id=${lit(r.invitationId)}`).trim();
      assert.equal(stored, createHash('sha256').update(r.token).digest('hex'));
      assert.equal(torneosSql(`select count(*) from public.tournament_organization_invitations where row_to_json(tournament_organization_invitations)::text like ${lit(`%${r.token}%`)}`).trim(), '0', 'no clear token stored');
      const pending = await ok('list_tournament_organization_invitations', owner, { p_organization_id: S.org });
      assert.deepEqual(pending.map((i) => [i.email, i.role, i.status]), [[userB.email.toLowerCase(), 'admin', 'pending']]);
    });
    await check('B3 a different Core identity cannot accept B\'s invitation (verified email mismatch) — it stays pending', async () => {
      await denied('accept_tournament_organization_invitation', wrongEmail, { p_token: S.inviteB.token }, { code: null, message: 'TORNEOS_INVITATION_INVALID', why: 'email-mismatch' });
      assert.equal(torneosSql(`select status from public.tournament_organization_invitations where id=${lit(S.inviteB.invitationId)}`).trim(), 'pending');
      assert.equal(membershipOf(wrongEmail), '');
    });
    await check('B4 User B accepts through the Core verified-email contract → active ADMIN; the token is single use; B sees the organization', async () => {
      const accepted = await ok('accept_tournament_organization_invitation', userB, { p_token: S.inviteB.token });
      assert.deepEqual([accepted.organizationId, accepted.role, accepted.status], [S.org, 'admin', 'accepted']);
      await denied('accept_tournament_organization_invitation', userB, { p_token: S.inviteB.token }, { code: null, message: 'TORNEOS_INVITATION_INVALID', why: 'accept-twice' });
      assert.equal(torneosSql(`select count(*) from public.tournament_organization_members where organization_id=${lit(S.org)} and user_id=${lit(userB.identity)}`).trim(), '1');
      assert.equal(await ok('is_tournament_organization_member', userB, { p_organization_id: S.org }), true);
      const asOwner = await ok('list_tournament_organization_members', owner, { p_organization_id: S.org });
      assert.deepEqual(asOwner.map((m) => [m.role, m.email]), [['owner', null], ['admin', userB.email.toLowerCase()]]);
      const asB = await ok('list_tournament_organization_members', userB, { p_organization_id: S.org });
      assert.equal(asB.find((m) => m.role === 'admin').isViewer, true);
      assert.equal(torneosSql(`select action from public.tournament_audit_log where organization_id=${lit(S.org)} and resource_id=${lit(accepted.membershipId)}`).trim(), 'member.invitation_accepted');
    });
    await check('B5 invitation rules: owner invites admins and collaborators; admin invites collaborators only; collaborator and outsider cannot invite', async () => {
      for (const [who, role] of [[userC, 'admin'], [season2Admin, 'admin'], [removedAdmin, 'admin']]) {
        const r = await invite(owner, who.email, role);
        await ok('accept_tournament_organization_invitation', who, { p_token: r.token });
      }
      const c = await invite(userB, collab.email, 'collaborator');
      const acceptedCollab = await ok('accept_tournament_organization_invitation', collab, { p_token: c.token });
      assert.equal(acceptedCollab.role, 'collaborator');
      await denied('invite_tournament_organization_member', userB, { p_organization_id: S.org, p_email: `x-${RUN}@example.test`, p_role: 'admin' }, { message: 'TORNEOS_MEMBER_ROLE_FORBIDDEN', why: 'admin-grants-admin' });
      await denied('invite_tournament_organization_member', collab, { p_organization_id: S.org, p_email: `y-${RUN}@example.test`, p_role: 'collaborator' }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'collaborator-invites' });
      await denied('invite_tournament_organization_member', outsider, { p_organization_id: S.org, p_email: `z-${RUN}@example.test`, p_role: 'collaborator' }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'cross-org' });
      await denied('invite_tournament_organization_member', owner, { p_organization_id: S.org, p_email: `o-${RUN}@example.test`, p_role: 'owner' }, { status: [400], code: '22023', message: 'TORNEOS_INVALID_MEMBER_ROLE', why: 'second-owner' });
      await denied('list_tournament_organization_invitations', collab, { p_organization_id: S.org }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'collaborator-reads-invitations' });
      const asCollab = await ok('list_tournament_organization_members', collab, { p_organization_id: S.org });
      assert.ok(asCollab.every((m) => m.email === null), 'collaborators do not see invitation emails');
      assert.equal(torneosSql(`select count(*) from public.tournament_organization_members where organization_id=${lit(S.org)} and role='owner'`).trim(), '1');
    });
    await check('B6 revoke: a revoked link cannot be accepted; revoking again is idempotent; an admin cannot revoke the owner\'s admin invitation', async () => {
      const r = await invite(owner, late.email, 'admin');
      await denied('revoke_tournament_organization_invitation', userB, { p_organization_id: S.org, p_invitation_id: r.invitationId }, { message: 'TORNEOS_MEMBER_ROLE_FORBIDDEN', why: 'admin-revokes-admin-invite' });
      const revoked = await ok('revoke_tournament_organization_invitation', owner, { p_organization_id: S.org, p_invitation_id: r.invitationId });
      assert.equal(revoked.status, 'revoked');
      assert.equal((await ok('revoke_tournament_organization_invitation', owner, { p_organization_id: S.org, p_invitation_id: r.invitationId })).status, 'revoked');
      await denied('accept_tournament_organization_invitation', late, { p_token: r.token }, { code: null, message: 'TORNEOS_INVITATION_INVALID', why: 'revoked' });
      await denied('revoke_tournament_organization_invitation', outsider, { p_organization_id: S.org2, p_invitation_id: r.invitationId }, { message: 'TORNEOS_INVITATION_INVALID', why: 'cross-org' });
      const accepted = torneosSql(`select id from public.tournament_organization_invitations where organization_id=${lit(S.org)} and status='accepted' limit 1`).trim();
      await denied('revoke_tournament_organization_invitation', owner, { p_organization_id: S.org, p_invitation_id: accepted }, { status: [400], code: 'P0001', message: 'TORNEOS_INVITATION_NOT_PENDING', why: 'accepted-invite' });
    });
    await check('B7 expired: an invitation past its expiry is refused and listed as expired', async () => {
      const r = await invite(owner, late.email, 'collaborator');
      torneosSql(`update public.tournament_organization_invitations set created_at = now() - interval '9 days', expires_at = now() - interval '2 days' where id=${lit(r.invitationId)}`);
      await denied('accept_tournament_organization_invitation', late, { p_token: r.token }, { code: null, message: 'TORNEOS_INVITATION_EXPIRED', why: 'expired' });
      const listed = await ok('list_tournament_organization_invitations', owner, { p_organization_id: S.org });
      assert.equal(listed.find((i) => i.id === r.invitationId).status, 'expired');
      assert.equal(membershipOf(late), '');
      S.expired = r;
    });
    await check('B8 re-inviting an email replaces the previous link (old token invalid, new one works); an admin cannot replace an owner\'s admin invitation', async () => {
      const first = await invite(owner, late.email, 'collaborator');
      const second = await invite(owner, late.email, 'collaborator');
      assert.equal(torneosSql(`select status from public.tournament_organization_invitations where id=${lit(first.invitationId)}`).trim(), 'revoked');
      assert.equal(torneosSql(`select status from public.tournament_organization_invitations where id=${lit(S.expired.invitationId)}`).trim(), 'revoked', 'the expired pending link is replaced too');
      await denied('accept_tournament_organization_invitation', late, { p_token: first.token }, { code: null, message: 'TORNEOS_INVITATION_INVALID', why: 'replaced' });
      assert.equal((await ok('accept_tournament_organization_invitation', late, { p_token: second.token })).role, 'collaborator');
      const pendingAdmin = await invite(owner, `pending-${RUN}@example.test`, 'admin');
      await denied('invite_tournament_organization_member', userB, { p_organization_id: S.org, p_email: `pending-${RUN}@example.test`, p_role: 'collaborator' }, { message: 'TORNEOS_MEMBER_ROLE_FORBIDDEN', why: 'admin-replaces-owner-invite' });
      await ok('revoke_tournament_organization_invitation', owner, { p_organization_id: S.org, p_invitation_id: pendingAdmin.invitationId });
    });
    await check('B9 roles: only the owner changes roles; nobody changes their own; the owner is protected; "owner" is never assignable; one owner at the database level', async () => {
      const lateId = membershipOf(late);
      await denied('update_tournament_organization_member_role', userB, { p_organization_id: S.org, p_membership_id: lateId, p_role: 'admin' }, { message: 'TORNEOS_MEMBER_ROLE_FORBIDDEN', why: 'admin-promotes' });
      await denied('update_tournament_organization_member_role', collab, { p_organization_id: S.org, p_membership_id: membershipOf(collab), p_role: 'admin' }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'collaborator-self-escalation' });
      await denied('update_tournament_organization_member_role', userB, { p_organization_id: S.org, p_membership_id: membershipOf(userB), p_role: 'collaborator' }, { message: 'TORNEOS_MEMBER_SELF_CHANGE_FORBIDDEN', why: 'self-change' });
      await denied('update_tournament_organization_member_role', userB, { p_organization_id: S.org, p_membership_id: membershipOf(owner), p_role: 'collaborator' }, { message: 'TORNEOS_OWNER_PROTECTED', why: 'admin-demotes-owner' });
      await denied('update_tournament_organization_member_role', owner, { p_organization_id: S.org, p_membership_id: membershipOf(owner), p_role: 'admin' }, { message: 'TORNEOS_MEMBER_SELF_CHANGE_FORBIDDEN', why: 'owner-self-demotion' });
      await denied('update_tournament_organization_member_role', owner, { p_organization_id: S.org, p_membership_id: lateId, p_role: 'owner' }, { status: [400], code: '22023', message: 'TORNEOS_INVALID_MEMBER_ROLE', why: 'second-owner' });
      await denied('update_tournament_organization_member_role', outsider, { p_organization_id: S.org2, p_membership_id: lateId, p_role: 'admin' }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'cross-org' });
      assert.equal((await ok('update_tournament_organization_member_role', owner, { p_organization_id: S.org, p_membership_id: lateId, p_role: 'admin' })).role, 'admin');
      assert.equal((await ok('update_tournament_organization_member_role', owner, { p_organization_id: S.org, p_membership_id: lateId, p_role: 'admin' })).role, 'admin', 'idempotent');
      assert.equal((await ok('update_tournament_organization_member_role', owner, { p_organization_id: S.org, p_membership_id: lateId, p_role: 'collaborator' })).role, 'collaborator');
      assert.equal(torneosSql(`select string_agg(metadata->>'to', ',' order by id) from public.tournament_audit_log where resource_id=${lit(lateId)} and action='member.role_changed'`).trim(), 'admin,collaborator');
      const second = sqlTry('torneos-db', `BEGIN; UPDATE public.tournament_organization_members SET role='owner' WHERE id=${lit(lateId)}; ROLLBACK;`);
      assert.equal(second.ok, false, 'the database refuses a second active owner'); assert.match(second.error, /tournament_organization_one_active_owner_idx/);
    });
    await check('B10 removal: admin cannot remove an admin or the owner; nobody removes themselves; owner removal refused even by the database; removing is idempotent and releases seats', async () => {
      await denied('remove_tournament_organization_member', userB, { p_organization_id: S.org, p_membership_id: membershipOf(userC) }, { message: 'TORNEOS_MEMBER_ROLE_FORBIDDEN', why: 'admin-removes-admin' });
      await denied('remove_tournament_organization_member', userB, { p_organization_id: S.org, p_membership_id: membershipOf(owner) }, { message: 'TORNEOS_OWNER_PROTECTED', why: 'admin-removes-owner' });
      await denied('remove_tournament_organization_member', owner, { p_organization_id: S.org, p_membership_id: membershipOf(owner) }, { message: 'TORNEOS_MEMBER_SELF_CHANGE_FORBIDDEN', why: 'owner-leaves' });
      await denied('remove_tournament_organization_member', collab, { p_organization_id: S.org, p_membership_id: membershipOf(late) }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'collaborator-removes' });
      await denied('remove_tournament_organization_member', outsider, { p_organization_id: S.org2, p_membership_id: membershipOf(late) }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'cross-org' });
      const direct = sqlTry('torneos-db', `BEGIN; UPDATE public.tournament_organization_members SET status='removed' WHERE id=${lit(membershipOf(owner))}; ROLLBACK;`);
      assert.equal(direct.ok, false); assert.match(direct.error, /TORNEOS_ACTIVE_OWNER_REQUIRED/);
      const removed = await ok('remove_tournament_organization_member', userB, { p_organization_id: S.org, p_membership_id: membershipOf(late) });
      assert.equal(removed.status, 'removed', 'an admin removes a collaborator');
      assert.equal((await ok('remove_tournament_organization_member', userB, { p_organization_id: S.org, p_membership_id: membershipOf(late) })).status, 'removed', 'idempotent');
      await denied('get_tournament_competition_context', late, { p_organization_id: S.org }, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'removed-member' });
      await denied('list_tournament_organization_members', late, { p_organization_id: S.org }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'removed-member' });
    });
    await check('B11 cross-organization: an outsider cannot read or manage this organization\'s members; the owner cannot read the outsider\'s', async () => {
      await denied('list_tournament_organization_members', outsider, { p_organization_id: S.org }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'cross-org' });
      await denied('list_tournament_organization_members', owner, { p_organization_id: S.org2 }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'cross-org' });
      await denied('list_tournament_organization_invitations', outsider, { p_organization_id: S.org }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'cross-org' });
      const theirs = await ok('list_tournament_organization_members', outsider, { p_organization_id: S.org2 });
      assert.ok(!JSON.stringify(theirs).includes(owner.identity) && theirs.length === 1);
      // Direct writes to the membership table are not a path: no client write policy (RLS).
      const w = await request(`/torneos/rest/v1/tournament_organization_members?id=eq.${membershipOf(collab)}`, await tok(userB), 'PATCH', { role: 'admin' });
      assert.ok([401, 403, 404].includes(w.status) || (w.status === 200 && Array.isArray(w.body) && w.body.length === 0) || w.status === 204, show(w));
      assert.equal(torneosSql(`select role from public.tournament_organization_members where id=${lit(membershipOf(collab))}`).trim(), 'collaborator');
    });

    // ================================================================ C. journey + dual control
    await check('C1 season seats: User B through the RPC; FREE limit reached for the next one; the other season-A seats seeded as fixtures; season B admin seated on B only', async () => {
      await ok('assign_tournament_season_member', owner, { p_organization_id: S.org, p_season_id: S.seasonA, p_membership_id: membershipOf(userB) });
      const limit = await gw('assign_tournament_season_member', await tok(owner), { p_organization_id: S.org, p_season_id: S.seasonA, p_membership_id: membershipOf(userC) });
      assert.equal(errMsg(limit), 'TORNEOS_SEASON_COLLABORATOR_LIMIT_REACHED', show(limit));
      for (const who of [userC, collab, removedAdmin]) {
        torneosSql(`begin; set local session_replication_role = replica;
          insert into public.tournament_season_member_assignments(organization_id, season_id, membership_id, assigned_by) values (${lit(S.org)}, ${lit(S.seasonA)}, ${lit(membershipOf(who))}, ${lit(owner.identity)}); commit;`);
      }
      await ok('assign_tournament_season_member', owner, { p_organization_id: S.org, p_season_id: S.seasonB, p_membership_id: membershipOf(season2Admin) });
    });

    const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    const mkTournament = async (org, who, season, slug, format = 'league') => {
      const tnt = await ok('create_tournament_with_defaults', who, { p_organization_id: org, p_season_id: season, p_name: `Copa ${slug}`, p_slug: `${slug}-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: format, p_gender_category: 'open', p_start_date: day(-1), p_end_date: day(60), p_idempotency_key: randomUUID() });
      const cat = await ok('save_tournament_category', who, { p_organization_id: org, p_tournament_id: tnt.id, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' });
      await ok('change_tournament_status', who, { p_organization_id: org, p_tournament_id: tnt.id, p_status: 'registration' });
      return { id: tnt.id, category: cat.id, season };
    };
    const approvedTeam = async (tournament, name, captain, { withPlayer = false } = {}) => {
      const created = await ok('create_tournament_team_entry', owner, { p_organization_id: S.org, p_tournament_id: tournament.id, p_category_id: tournament.category, p_arma2_team_id: null, p_name: name, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      const entry = created.entryId; const roster = created.rosterId;
      const players = [];
      for (const [display, shirt, position, gk] of [['Arquero', 1, 'ARQ', true], ['Defensor', 2, 'DEF', false], ['Volante', 3, 'MED', false], ['Delantero', 4, 'DEL', false], ['Lateral', 5, 'DEF', false]]) {
        const prov = await ok('create_tournament_provisional_player', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_display_name: `${display} ${name}` });
        players.push((await ok('add_tournament_roster_player', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: null, p_provisional_player_id: prov.id, p_display_name: `${display} ${name}`, p_avatar_url: null, p_shirt_number: shirt, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: gk })).id);
      }
      if (withPlayer) {
        players.push((await ok('add_tournament_roster_player', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: player.identity, p_provisional_player_id: null, p_display_name: `Jugador ${RUN}`, p_avatar_url: null, p_shirt_number: 9, p_primary_position: 'DEL', p_secondary_position: null, p_is_goalkeeper: false })).id);
      }
      const inv = await ok('invite_tournament_team_manager', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_email: captain.email, p_display_name: captain.label, p_role: 'captain' });
      seenSecrets.push(inv.token);
      await ok('accept_tournament_team_invitation', captain, { p_token: inv.token });
      await ok('submit_tournament_team_entry', owner, { p_organization_id: S.org, p_team_entry_id: entry });
      await ok('review_tournament_team_entry', owner, { p_organization_id: S.org, p_team_entry_id: entry, p_decision: 'approved', p_reason: 'Plantel verificado', p_issues: [] });
      return { entry, roster, players, captain, name };
    };
    /** Freeze → generate → publish → start; every match scheduled on its own hour; returns the matches with their sides. */
    const runLeague = async (T) => {
      const scope = { p_organization_id: S.org, p_tournament_id: T.id, p_category_id: T.category };
      await ok('freeze_tournament_participants', owner, { ...scope, p_idempotency_key: randomUUID() });
      T.fixture = (await ok('generate_tournament_fixture', owner, { ...scope, p_seed: `seed-${RUN}`, p_configuration: {}, p_idempotency_key: randomUUID() })).fixtureVersionId;
      await ok('publish_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: T.fixture });
      await ok('start_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: T.id });
      T.matches = JSON.parse(torneosSql(`select json_agg(json_build_object('id', m.id, 'phase', m.phase_id, 'number', m.match_number, 'home', hp.team_entry_id, 'away', ap.team_entry_id) order by m.match_number)
        from public.tournament_matches m left join public.tournament_competition_participants hp on hp.id = m.home_participant_id left join public.tournament_competition_participants ap on ap.id = m.away_participant_id
        where m.fixture_version_id = ${lit(T.fixture)}`));
      T.phase = T.matches[0].phase;
      for (const [i, m] of T.matches.entries()) {
        const at = new Date(Date.now() + (1 + i) * 86400_000); at.setUTCHours(18 + (T.offset ?? 0), 0, 0, 0);
        await schedule(owner, { p_organization_id: S.org, p_match_id: m.id, p_scheduled_at: at.toISOString(), p_venue_id: S.venue, p_court_id: T.court ?? S.court, p_duration_minutes: 60, p_override_warnings: true, p_override_reason: 'Certificación' });
      }
      return T.matches;
    };
    const results2 = new Map(); // matchId → { home, away, hs, as } of the official version
    /** Opens the report and records a played result (goals without an identified author), then submits it as `who`. */
    const fileResult = async (T, m, who, hs, as) => {
      const op = (await ok('open_tournament_match_operation', who, { p_organization_id: S.org, p_match_id: m.id, p_override_reason: 'Certificación' })).operation.id;
      const base = { p_organization_id: S.org, p_match_operation_id: op };
      await ok('set_tournament_match_outcome', who, { ...base, p_outcome: { outcomeType: 'played', countsForStandings: true, countsForPlayerStats: true, requiresResolution: false } });
      await ok('set_tournament_match_score', who, { ...base, p_score: { homeScore: hs, awayScore: as, scoreType: 'played' } });
      for (let g = 0; g < hs; g++) await ok('add_tournament_match_event', who, { ...base, p_event: { teamEntryId: m.home, rosterPlayerId: null, eventType: 'goal', minute: 5 + g, period: 'first_half', unidentifiedPlayerReason: 'Autor no identificado en la planilla' } });
      for (let g = 0; g < as; g++) await ok('add_tournament_match_event', who, { ...base, p_event: { teamEntryId: m.away, rosterPlayerId: null, eventType: 'goal', minute: 30 + g, period: 'second_half', unidentifiedPlayerReason: 'Autor no identificado en la planilla' } });
      const submitted = await ok('submit_tournament_match_operation', who, base);
      assert.deepEqual(submitted.dualControl, { enabled: submitted.dualControl.enabled, submittedByViewer: true, validatedByViewer: false });
      m.pending = { hs, as };
      return op;
    };
    const opStatus = (op) => torneosSql(`select status from public.tournament_match_operations where id=${lit(op)}`).trim();
    const recordOfficial = (m) => results2.set(m.id, { home: m.home, away: m.away, hs: m.pending.hs, as: m.pending.as });
    const expectedPoints = (T) => {
      const pts = new Map();
      for (const m of T.matches) for (const e of [m.home, m.away]) pts.set(e, pts.get(e) ?? 0);
      for (const m of T.matches) {
        const r = results2.get(m.id); if (!r) continue;
        pts.set(r.home, pts.get(r.home) + (r.hs > r.as ? 3 : r.hs === r.as ? 1 : 0));
        pts.set(r.away, pts.get(r.away) + (r.as > r.hs ? 3 : r.hs === r.as ? 1 : 0));
      }
      return pts;
    };
    const pointsOf = (payload, entry) => {
      const rows = payload?.standings ?? payload?.rows ?? payload?.table ?? [];
      const row = (rows || []).find((r) => [r.teamEntryId, r.team_entry_id, r.entryId].includes(entry));
      return row ? Number(row.points ?? row.pts) : null;
    };
    const rebuildAndCheck = async (T, who, reason) => {
      const scope = { p_organization_id: S.org, p_tournament_id: T.id, p_category_id: T.category, p_phase_id: T.phase, p_group_id: null };
      const revision = await ok('rebuild_tournament_standings', who, { ...scope, p_reason: reason, p_idempotency_key: randomUUID() });
      const id = revision?.revisionId ?? revision?.id ?? revision;
      await ok('publish_tournament_standings_revision', who, { p_revision_id: id, p_reason: reason });
      const standings = await ok('get_tournament_standings_context', who, scope);
      for (const [entry, points] of expectedPoints(T)) assert.equal(pointsOf(standings, entry), points, `${reason}: points of ${entry} — ${JSON.stringify(standings).slice(0, 500)}`);
      return id;
    };
    const auditOf = (op, action) => JSON.parse(torneosSql(`select coalesce(json_agg(json_build_object('actor', actor_user_id, 'metadata', metadata) order by id), '[]') from public.tournament_audit_log where resource_id=${lit(op)} and action=${lit(action)}`));

    await check('C2 tournament A (season A): 4 approved teams (one with an Arma2 player), fixture published, competition started, 6 matches scheduled; dual control OFF by default', async () => {
      S.venue = (await ok('create_tournament_venue', owner, { p_organization_id: S.org, p_name: `Club ${RUN}`, p_address: 'Calle 123', p_place_id: null, p_latitude: null, p_longitude: null, p_locality: 'Buenos Aires', p_timezone: 'America/Argentina/Buenos_Aires', p_notes: null })).id;
      S.court = (await ok('create_tournament_court', owner, { p_organization_id: S.org, p_venue_id: S.venue, p_name: 'Cancha 1', p_sport_modality: 'football_5', p_notes: null })).id;
      S.court2 = (await ok('create_tournament_court', owner, { p_organization_id: S.org, p_venue_id: S.venue, p_name: 'Cancha 2', p_sport_modality: 'football_5', p_notes: null })).id;
      S.A = await mkTournament(S.org, owner, S.seasonA, 'alfa');
      S.A.teams = [];
      for (let i = 0; i < 4; i++) S.A.teams.push(await approvedTeam(S.A, `Club ${i} ${RUN}`, captains[i], { withPlayer: i === 0 }));
      await runLeague(S.A);
      assert.equal(S.A.matches.length, 6);
      const state = await ok('get_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: S.A.id });
      assert.deepEqual([state.enabled, state.canManage, state.readOnly], [false, true, false]);
      assert.equal(state.eligibleValidators, 4, 'owner + B + C + the future removed admin (collaborators cannot validate)');
      const asB = await ok('get_tournament_match_dual_control', userB, { p_organization_id: S.org, p_tournament_id: S.A.id });
      assert.deepEqual([asB.enabled, asB.canManage], [false, false]);
      await denied('get_tournament_match_dual_control', season2Admin, { p_organization_id: S.org, p_tournament_id: S.A.id }, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'cross-season' });
      await denied('get_tournament_match_dual_control', outsider, { p_organization_id: S.org, p_tournament_id: S.A.id }, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'cross-org' });
    });
    await check('C3 dual control OFF, single owner: owner loads the result 2-1 → reviews → validates their OWN report → makes it official (audited as self-validated)', async () => {
      const m = S.A.matches[0];
      S.op1 = await fileResult(S.A, m, owner, 2, 1);
      const base = { p_organization_id: S.org, p_match_operation_id: S.op1 };
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Confirmado por el organizador' });
      const validated = await ok('validate_tournament_match_operation', owner, base);
      assert.deepEqual(validated.dualControl, { enabled: false, submittedByViewer: true, validatedByViewer: true });
      const official = await ok('make_tournament_match_official', owner, base);
      assert.equal(official.operation.status, 'official');
      recordOfficial(m);
      const row = torneosSql(`select (submitted_by = validated_by and validated_by = official_by and official_by = ${lit(owner.identity)})::text from public.tournament_match_operations where id=${lit(S.op1)}`).trim();
      assert.equal(row, 'true', 'submitted_by / validated_by / official_by all recorded (the owner)');
      assert.deepEqual(auditOf(S.op1, 'match_operation.validated').map((a) => [a.actor, a.metadata]), [[owner.identity, { dualControl: false, selfValidated: true }]]);
      assert.deepEqual(auditOf(S.op1, 'match_operation.submitted').length, 1);
      assert.deepEqual(auditOf(S.op1, 'match_operation.made_official').length, 1);
    });
    await check('C4 standings and statistics update from the official result (owner alone)', async () => {
      S.revision1 = await rebuildAndCheck(S.A, owner, 'Primer resultado oficial');
      const stats = await ok('get_tournament_statistics_context', owner, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
      assert.ok(stats);
      const published = await ok('get_published_tournament_standings', player, { p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
      assert.equal(pointsOf(published, S.A.matches[0].home), 3, JSON.stringify(published).slice(0, 300));
    });
    await check('C5 dual control OFF — negative matrix on a pending report (submitted by admin B): collaborator, captain, player, other organization, other season, removed-later admin not yet, no bearer → refused; then B self-validates', async () => {
      const m = S.A.matches[1];
      S.op2 = await fileResult(S.A, m, userB, 1, 0);
      const base = { p_organization_id: S.org, p_match_operation_id: S.op2 };
      await ok('review_tournament_match_operation', userB, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      const cases = [[collab, 'collaborator'], [captains[0], 'captain'], [player, 'player'], [outsider, 'other-organization'], [season2Admin, 'other-season']];
      for (const [who, why] of cases) await denied('validate_tournament_match_operation', who, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: `off:${why}` });
      await denied('validate_tournament_match_operation', outsider, { p_organization_id: S.org2, p_match_operation_id: S.op2 }, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'off:other-organization-scope' });
      await denied('validate_tournament_match_operation', null, base, { status: [401], code: 'access denied', why: 'off:anon' });
      for (const [who, why] of cases) await denied('make_tournament_match_official', who, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: `off:${why}` });
      assert.equal(opStatus(S.op2), 'under_review', 'no refused call changed the report');
      const validated = await ok('validate_tournament_match_operation', userB, base);
      assert.deepEqual(validated.dualControl, { enabled: false, submittedByViewer: true, validatedByViewer: true });
      await ok('make_tournament_match_official', userB, base);
      recordOfficial(m);
      assert.deepEqual(auditOf(S.op2, 'match_operation.validated').map((a) => a.metadata), [{ dualControl: false, selfValidated: true }]);
    });
    await check('C6 correction with a single owner: request → new version → 1-1 → submit/review/self-validate/official → superseded,official → standings recalculated', async () => {
      const m = S.A.matches[0];
      await ok('request_tournament_match_correction', owner, { p_organization_id: S.org, p_match_operation_id: S.op1, p_reason: 'Gol anulado por la mesa' });
      const correction = await ok('create_tournament_match_correction', owner, { p_organization_id: S.org, p_match_operation_id: S.op1 });
      S.op1b = correction.operation.id;
      const base = { p_organization_id: S.org, p_match_operation_id: S.op1b };
      const goal = JSON.parse(torneosSql(`select json_build_object('id', id) from public.tournament_match_events where match_operation_id=${lit(S.op1b)} and event_type='goal' and team_entry_id=${lit(m.home)} and voided_at is null order by minute desc limit 1`));
      await ok('void_tournament_match_event', owner, { p_organization_id: S.org, p_event_id: goal.id, p_reason: 'Gol anulado' });
      await ok('set_tournament_match_score', owner, { ...base, p_score: { homeScore: 1, awayScore: 1, scoreType: 'played' } });
      await ok('submit_tournament_match_operation', owner, base);
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Corrección confirmada' });
      await ok('validate_tournament_match_operation', owner, base);
      await ok('make_tournament_match_official', owner, base);
      assert.equal(torneosSql(`select string_agg(status, ',' order by operation_version) from public.tournament_match_operations where match_id=${lit(m.id)}`).trim(), 'superseded,official');
      m.pending = { hs: 1, as: 1 }; recordOfficial(m);
      await rebuildAndCheck(S.A, owner, 'Corrección oficial');
    });
    await check('C7 policy: only the owner turns dual control ON (admin, collaborator, other season, other org refused); idempotent; audited; ON needs two eligible validators', async () => {
      const params = { p_organization_id: S.org, p_tournament_id: S.A.id, p_enabled: true };
      await denied('set_tournament_match_dual_control', userB, params, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'admin-changes-policy' });
      await denied('set_tournament_match_dual_control', collab, params, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'collaborator-changes-policy' });
      await denied('set_tournament_match_dual_control', season2Admin, params, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'other-season' });
      await denied('set_tournament_match_dual_control', outsider, params, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'other-organization' });
      await denied('set_tournament_match_dual_control', owner, { ...params, p_enabled: null }, { status: [400], code: '22023', message: 'TORNEOS_INVALID_DUAL_CONTROL', why: 'null' });
      const on = await ok('set_tournament_match_dual_control', owner, params);
      assert.equal(on.enabled, true);
      assert.equal((await ok('set_tournament_match_dual_control', owner, params)).enabled, true, 'idempotent');
      assert.deepEqual(auditOf(S.A.id, 'tournament.match_dual_control_changed').map((a) => a.metadata), [{ enabled: true, previous: false }]);
      // A single-owner organization cannot turn it ON (it would block every result).
      const seasonX = (await ok('create_tournament_season', outsider, { p_organization_id: S.org2, p_name: 'Solo', p_slug: `solo-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      const solo = await ok('create_tournament_with_defaults', outsider, { p_organization_id: S.org2, p_season_id: seasonX, p_name: 'Copa solo', p_slug: `solo-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() });
      await denied('set_tournament_match_dual_control', outsider, { p_organization_id: S.org2, p_tournament_id: solo.id, p_enabled: true }, { status: [400], code: 'P0001', message: 'TORNEOS_DUAL_CONTROL_SECOND_VALIDATOR_REQUIRED', why: 'single-validator' });
      assert.equal((await ok('get_tournament_match_dual_control', outsider, { p_organization_id: S.org2, p_tournament_id: solo.id })).enabled, false);
    });
    await check('C8 dual control ON: owner submits → the owner cannot validate (403 DUAL_CONTROL_REQUIRED, context says so) → admin B validates → official', async () => {
      const m = S.A.matches[2];
      S.op3 = await fileResult(S.A, m, owner, 0, 2);
      const base = { p_organization_id: S.org, p_match_operation_id: S.op3 };
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      const ctx = await ok('get_tournament_match_operation_context', owner, base);
      assert.deepEqual(ctx.dualControl, { enabled: true, submittedByViewer: true, validatedByViewer: false });
      await denied('validate_tournament_match_operation', owner, base, { message: 'TORNEOS_MATCH_DUAL_CONTROL_REQUIRED', why: 'on:owner-self' });
      assert.equal(opStatus(S.op3), 'under_review');
      const validated = await ok('validate_tournament_match_operation', userB, base);
      assert.deepEqual(validated.dualControl, { enabled: true, submittedByViewer: false, validatedByViewer: true });
      await ok('make_tournament_match_official', owner, base);
      recordOfficial(m);
      assert.deepEqual(auditOf(S.op3, 'match_operation.validated').map((a) => [a.actor, a.metadata]), [[userB.identity, { dualControl: true, selfValidated: false }]]);
    });
    await check('C9 dual control ON: admin B submits → B cannot validate → the owner validates → official', async () => {
      const m = S.A.matches[3];
      S.op4 = await fileResult(S.A, m, userB, 3, 3);
      const base = { p_organization_id: S.org, p_match_operation_id: S.op4 };
      await ok('review_tournament_match_operation', userB, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      await denied('validate_tournament_match_operation', userB, base, { message: 'TORNEOS_MATCH_DUAL_CONTROL_REQUIRED', why: 'on:admin-self' });
      await ok('validate_tournament_match_operation', owner, base);
      await ok('make_tournament_match_official', userB, base);
      recordOfficial(m);
    });
    await check('C10 dual control ON — negative matrix on a pending report (admin B submitted): other org, other season, collaborator, captain, player, no bearer, and the removed admin after removal; then admin C validates (admin A → admin B)', async () => {
      const m = S.A.matches[4];
      S.op5 = await fileResult(S.A, m, userB, 2, 0);
      const base = { p_organization_id: S.org, p_match_operation_id: S.op5 };
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      await ok('remove_tournament_organization_member', owner, { p_organization_id: S.org, p_membership_id: membershipOf(removedAdmin) });
      assert.equal(torneosSql(`select count(*) from public.tournament_season_member_assignments where membership_id=${lit(membershipOf(removedAdmin))}`).trim(), '0', 'seats released');
      const cases = [[outsider, 'other-organization'], [season2Admin, 'other-season'], [collab, 'collaborator'], [captains[1], 'captain'], [player, 'player'], [removedAdmin, 'removed-member']];
      for (const [who, why] of cases) await denied('validate_tournament_match_operation', who, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: `on:${why}` });
      await denied('validate_tournament_match_operation', null, base, { status: [401], code: 'access denied', why: 'on:anon' });
      await denied('get_tournament_match_operations_context', removedAdmin, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category }, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'removed-member-read' });
      assert.equal(opStatus(S.op5), 'under_review');
      const eligible = await ok('get_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: S.A.id });
      assert.equal(eligible.eligibleValidators, 3, 'the removed admin no longer counts');
      await ok('validate_tournament_match_operation', userC, base);
      // Double validation: the report is no longer under review.
      await denied('validate_tournament_match_operation', owner, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'double-validation' });
      // Double officialization, concurrently: both answer the official version, exactly one official row.
      const race = await Promise.all([gw('make_tournament_match_official', await tok(owner), base), gw('make_tournament_match_official', await tok(userC), base)]);
      assert.deepEqual(race.map((r) => r.status), [200, 200], race.map(show).join(' | '));
      assert.equal(torneosSql(`select count(*) from public.tournament_match_operations where match_id=${lit(m.id)} and status='official'`).trim(), '1');
      assert.equal(auditOf(S.op5, 'match_operation.made_official').length, 1, 'one officialization audited');
      recordOfficial(m);
    });
    await check('C11 stale states: validate a draft / submitted report, make official before validation, review after official → refused; the last match through the product path', async () => {
      const m = S.A.matches[5];
      const op = (await ok('open_tournament_match_operation', userC, { p_organization_id: S.org, p_match_id: m.id, p_override_reason: 'Certificación' })).operation.id;
      const base = { p_organization_id: S.org, p_match_operation_id: op };
      await denied('validate_tournament_match_operation', owner, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'stale:draft' });
      await denied('make_tournament_match_official', owner, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'stale:draft' });
      await ok('set_tournament_match_outcome', userC, { ...base, p_outcome: { outcomeType: 'played', countsForStandings: true, countsForPlayerStats: true, requiresResolution: false } });
      await ok('set_tournament_match_score', userC, { ...base, p_score: { homeScore: 0, awayScore: 0, scoreType: 'played' } });
      await ok('submit_tournament_match_operation', userC, base);
      await denied('validate_tournament_match_operation', owner, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'stale:submitted' });
      await denied('make_tournament_match_official', owner, base, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'stale:submitted' });
      await ok('review_tournament_match_operation', userC, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      await denied('validate_tournament_match_operation', userC, base, { message: 'TORNEOS_MATCH_DUAL_CONTROL_REQUIRED', why: 'on:admin-self' });
      await ok('validate_tournament_match_operation', userB, base);
      await ok('make_tournament_match_official', userB, base);
      await denied('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Tarde' }, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'stale:official' });
      m.pending = { hs: 0, as: 0 }; recordOfficial(m);
    });
    await check('C12 standings / statistics correct after mixed OFF and ON officializations; qualification + playoffs reachable (final filled from the league table)', async () => {
      const revision = await rebuildAndCheck(S.A, owner, 'Liga completa');
      await ok('get_tournament_statistics_context', collab, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category, p_phase_id: S.A.phase, p_group_id: null });
      const playoffs = await ok('append_tournament_playoff_phase', userB, { p_organization_id: S.org, p_tournament_id: S.A.id, p_category_id: S.A.category, p_source_phase_id: S.A.phase, p_qualifier_count: 2, p_double_leg: false, p_idempotency_key: randomUUID() });
      const final = torneosSql(`select id from public.tournament_matches where phase_id=${lit(playoffs.phaseId)} order by match_number limit 1`).trim();
      assert.match(final, /^[0-9a-f-]{36}$/, JSON.stringify(playoffs).slice(0, 300));
      await ok('resolve_tournament_qualification', owner, { p_revision_id: revision, p_reason: 'Clasificación de la liga' });
      assert.equal(torneosSql(`select (home_participant_id is not null and away_participant_id is not null)::text from public.tournament_matches where id=${lit(final)}`).trim(), 'true');
      S.A.final = final;
    });
    await check('C13 lifecycle with dual control ON: 2-team tournament — result by owner, validated by admin B, official → finish (admin) → policy read-only while finished → reopen (owner) → policy OFF again', async () => {
      S.F = await mkTournament(S.org, owner, S.seasonA, 'foxtrot');
      S.F.court = S.court2; S.F.offset = 1;
      S.F.teams = [await approvedTeam(S.F, `Uno ${RUN}`, captains[4]), await approvedTeam(S.F, `Dos ${RUN}`, captains[5])];
      await ok('set_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: S.F.id, p_enabled: true });
      await runLeague(S.F);
      const m = S.F.matches[0];
      const op = await fileResult(S.F, m, owner, 1, 0);
      const base = { p_organization_id: S.org, p_match_operation_id: op };
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      await denied('validate_tournament_match_operation', owner, base, { message: 'TORNEOS_MATCH_DUAL_CONTROL_REQUIRED', why: 'on:owner-self' });
      await ok('validate_tournament_match_operation', userB, base);
      await ok('make_tournament_match_official', owner, base);
      const finished = await ok('finish_tournament_competition', userB, { p_organization_id: S.org, p_tournament_id: S.F.id });
      assert.equal(finished.status, 'completed');
      await denied('set_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: S.F.id, p_enabled: false }, { status: [409], code: 'PT409', message: 'TORNEOS_COMPETITION_READ_ONLY', why: 'finished (ERROR-CONTRACT-V1: 409, was 400)' });
      assert.equal((await ok('get_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: S.F.id })).readOnly, true);
      await denied('request_tournament_match_correction', owner, { p_organization_id: S.org, p_match_operation_id: op, p_reason: 'Tarde' }, { status: [400, 403, 409], code: null, why: 'finished-correction (409 since ERROR-CONTRACT-V1: the completed guard answers PT409)' });
      const reopened = await ok('reopen_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: S.F.id, p_reason: 'Corrección de cierre' });
      assert.equal(reopened.status, 'active');
      assert.equal((await ok('set_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: S.F.id, p_enabled: false })).enabled, false);
    });
    await check('C14 withdrawn team (dual control OFF): 3-team tournament, one team withdrawn → its matches cannot be reported; the remaining match is officialized by the owner alone', async () => {
      S.G = await mkTournament(S.org, owner, S.seasonA, 'golf');
      S.G.court = S.court2; S.G.offset = 3;
      S.G.teams = [await approvedTeam(S.G, `Tres ${RUN}`, captains[6]), await approvedTeam(S.G, `Cuatro ${RUN}`, captains[7]), await approvedTeam(S.G, `Cinco ${RUN}`, captains[8])];
      await runLeague(S.G);
      const gone = S.G.teams[2].entry;
      await ok('withdraw_tournament_competition_participant', userB, { p_organization_id: S.org, p_tournament_id: S.G.id, p_team_entry_id: gone, p_reason_code: 'voluntary_resignation', p_reason_text: 'Se retira' });
      const affected = S.G.matches.find((m) => m.home === gone || m.away === gone);
      const refused = await gw('open_tournament_match_operation', await tok(owner), { p_organization_id: S.org, p_match_id: affected.id, p_override_reason: 'Certificación' });
      assert.ok([400, 403].includes(refused.status), `a withdrawn team's match cannot be reported: ${show(refused)}`);
      matrix.push({ rpc: 'open_tournament_match_operation', actor: 'owner', why: 'withdrawn-team', status: refused.status, code: errCode(refused), message: errMsg(refused) });
      const m = S.G.matches.find((x) => x.home !== gone && x.away !== gone);
      const op = await fileResult(S.G, m, owner, 2, 2);
      const base = { p_organization_id: S.org, p_match_operation_id: op };
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      await ok('validate_tournament_match_operation', owner, base);
      await ok('make_tournament_match_official', owner, base);
      assert.equal(opStatus(op), 'official');
    });

    // ================================================================ D. contract edges
    await check('D1 random / foreign IDs: unknown operation, tournament, invitation, membership → 403 without an oracle; malformed invitation tokens refused', async () => {
      await denied('validate_tournament_match_operation', owner, { p_organization_id: S.org, p_match_operation_id: randomUUID() }, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'random-operation' });
      await denied('validate_tournament_match_operation', owner, { p_organization_id: randomUUID(), p_match_operation_id: S.op5 }, { message: 'TORNEOS_MATCH_FORBIDDEN', why: 'random-organization' });
      await denied('set_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: randomUUID(), p_enabled: true }, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'random-tournament' });
      await denied('get_tournament_match_dual_control', owner, { p_organization_id: S.org2, p_tournament_id: S.A.id }, { message: 'TORNEOS_RESOURCE_FORBIDDEN', why: 'foreign-pairing' });
      await denied('revoke_tournament_organization_invitation', owner, { p_organization_id: S.org, p_invitation_id: randomUUID() }, { message: 'TORNEOS_INVITATION_INVALID', why: 'random-invitation' });
      await denied('update_tournament_organization_member_role', owner, { p_organization_id: S.org, p_membership_id: randomUUID(), p_role: 'admin' }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'random-membership' });
      await denied('remove_tournament_organization_member', owner, { p_organization_id: S.org, p_membership_id: randomUUID() }, { message: 'TORNEOS_MEMBER_FORBIDDEN', why: 'random-membership' });
      for (const token of ['x', randomBytes(32).toString('hex'), 'z'.repeat(64)]) {
        await denied('accept_tournament_organization_invitation', late, { p_token: token }, { code: null, message: 'TORNEOS_INVITATION_INVALID', why: 'bad-token' });
      }
      await denied('invite_tournament_organization_member', owner, { p_organization_id: S.org, p_email: 'no-es-un-email', p_role: 'collaborator' }, { status: [400], code: '22023', message: 'TORNEOS_INVALID_MEMBER_EMAIL', why: 'bad-email' });
      const malformed = await gw('validate_tournament_match_operation', await tok(owner), { p_organization_id: 'not-a-uuid', p_match_operation_id: S.op5 });
      assert.equal(malformed.status, 400, show(malformed));
    });
    await check('D2 no bearer → 401 at the gateway for every OFFICIALIZATION-V1 RPC; the public route serves none of them', async () => {
      for (const n of ALLOW) {
        const r = await gw(n, null, {});
        assert.deepEqual([r.status, r.body], [401, { error: 'access denied' }], n);
        const p = await pub(n, {});
        assert.deepEqual([p.status, p.body], [403, { error: 'rpc not enabled' }], `${n} on the public route`);
      }
    });
    await check('D3 straight at PostgREST: anon refused by the DB ACL for all 9; a valid bearer WITHOUT the gateway\'s Core attestation cannot accept an invitation; the invitations table is unreachable', async () => {
      const r = await invite(owner, `direct-${RUN}@example.test`, 'collaborator');
      const direct = await coreActor('direct', `direct-${RUN}@example.test`);
      await tok(direct); await tok(owner);
      const calls = [
        ...ALLOW.map((n) => ({ id: `anon:${n}`, path: `/rpc/${n}`, body: exercised.get(n)?.params ?? {} })),
        { id: 'bearer:accept-without-attestation', path: '/rpc/accept_tournament_organization_invitation', token: direct.token, body: { p_token: r.token } },
        { id: 'bearer:table', path: '/tournament_organization_invitations?select=id', method: 'GET', token: owner.token },
        { id: 'anon:table', path: '/tournament_organization_invitations?select=id', method: 'GET' },
      ];
      const out = restBatch(calls);
      for (const x of out.filter((o) => o.id.startsWith('anon:') && !o.id.endsWith('table'))) {
        assert.ok([401, 403].includes(x.status) && x.body?.code === '42501', `${x.id}: ${x.status} ${JSON.stringify(x.body).slice(0, 200)}`);
      }
      const accept = out.find((o) => o.id === 'bearer:accept-without-attestation');
      assert.equal(accept.body?.message, 'TORNEOS_CORE_ATTESTATION_REQUIRED', JSON.stringify(accept));
      for (const id of ['bearer:table', 'anon:table']) {
        const x = out.find((o) => o.id === id);
        assert.ok([401, 403].includes(x.status) && x.body?.code === '42501', `${id}: ${x.status} ${JSON.stringify(x.body).slice(0, 200)}`);
      }
      assert.equal(torneosSql(`select status from public.tournament_organization_invitations where id=${lit(r.invitationId)}`).trim(), 'pending');
      const viaGateway = await request('/torneos/rest/v1/tournament_organization_invitations?select=id,token_hash', owner.token, 'GET');
      assert.ok([401, 403].includes(viaGateway.status), `gateway table route: ${show(viaGateway)}`);
      // Through the gateway (Core-attested) the same identity accepts.
      assert.equal((await ok('accept_tournament_organization_invitation', direct, { p_token: r.token })).role, 'collaborator');
      matrix.push(...out.map((o) => ({ rpc: o.id, actor: 'direct-postgrest', why: 'no-gateway', status: o.status, code: o.body?.code ?? null, message: o.body?.message ?? null })));
    });
    await check('D4 Core unavailable while accepting → 503 fail closed, invitation still pending; after recovery the same link works', async () => {
      const who = await coreActor('outage');
      const r = await invite(owner, who.email, 'collaborator');
      await tok(who);
      const coreService = 'core-functions';
      setService(coreService, 'stop');
      try {
        const down = await gw('accept_tournament_organization_invitation', who.token, { p_token: r.token });
        assert.equal(down.status, 503, show(down));
      } finally { setService(coreService, 'start'); }
      assert.equal(torneosSql(`select status from public.tournament_organization_invitations where id=${lit(r.invitationId)}`).trim(), 'pending');
      await waitFor('Core contract', async () => (await gw('accept_tournament_organization_invitation', await tok(who), { p_token: r.token })).status === 200, 120);
      assert.equal(torneosSql(`select status from public.tournament_organization_invitations where id=${lit(r.invitationId)}`).trim(), 'accepted');
    });
    await check('D5 session authority: after User C logs out of Core, the bridge refuses them (exchange and validate 401)', async () => {
      await tok(userC);
      const logout = await request('/auth/v1/logout', userC.coreToken, 'POST');
      assert.ok([200, 204].includes(logout.status));
      assert.equal((await request('/exchange', userC.coreToken, 'POST')).status, 401);
      assert.equal((await gw('get_tournament_match_dual_control', userC.token, { p_organization_id: S.org, p_tournament_id: S.A.id })).status, 401);
    });
    await check('D6 no-store: every gateway response of this run carried Cache-Control: no-store', async () => {
      const bad = noStore.filter((r) => !/no-store/.test(r.cacheControl ?? ''));
      assert.deepEqual(bad, []);
      assert.ok(noStore.length > 300, `${noStore.length} responses`);
    });
    await check('D7 every OFFICIALIZATION-V1 RPC was exercised positively through the gateway', async () => {
      assert.deepEqual(ALLOW.filter((n) => !exercised.has(n)), []);
    });
  } finally {
    const summary = { run: RUN, gateway: GATEWAY_NAME, at: new Date().toISOString(), total: results.length,
      passed: results.filter((r) => r.status === 'PASS').length, failed: results.filter((r) => r.status === 'FAIL').length,
      exercised: [...exercised.keys()].sort(), matrix_rows: matrix.length };
    if (process.env.OV1_EVIDENCE === '1') {
      const dir = `${repo}backend/torneos/officialization-v1/evidence/${GATEWAY_NAME}`;
      await mkdir(dir, { recursive: true });
      const payload = JSON.stringify({ summary, results, matrix,
        no_store: { responses: noStore.length, without_no_store: noStore.filter((r) => !/no-store/.test(r.cacheControl ?? '')).length } }, null, 2) + '\n';
      for (const secret of seenSecrets.filter(Boolean)) if (payload.includes(secret)) throw new Error('evidence would leak a secret');
      await writeFile(`${dir}/results.json`, payload);
    }
    console.log(JSON.stringify(summary));
  }
});
