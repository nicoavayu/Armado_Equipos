// Phase 3A end-to-end certification, local lab only.
//
//   REAL Core (GoTrue sessions, PostgREST, edge-runtime running the real
//   supabase/functions/torneos-core-contract over the real Core migrations)
//   → signed contract → Torneos adapter (torneos_core_adapter) → attestation
//   → the four historical RPCs on the UNCHANGED certified baseline → RLS/scope.
//
// Every scenario in the Phase 3A brief is a named subtest; results are written
// to evidence/e2e-results.json. Nothing here touches a remote target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import { SignJWT, importPKCS8, decodeJwt } from 'jose';
import { config, dc, sql, sqlTry, inGateway, BASE, GATEWAY_BASE, GATEWAY_NAME, repo } from './lab.mjs';

const results = [];
const seenSecrets = [];
const responses = [];
const cfg = await config();
// Per-run tag so the suite is re-runnable on a lab that keeps earlier runs' data.
const RUN = 'r' + randomBytes(2).toString('hex');

// ---------------------------------------------------------------- transport helpers
async function request(path, token, method = 'GET', data, extraHeaders = {}) {
  // Phase 3B: Core Auth fixtures always through the Node gateway's /auth/v1 proxy; the
  // gateway under test (GATEWAY=node|edge) serves exchange, config, health and /torneos.
  const base = path.startsWith('/auth/v1') ? BASE : GATEWAY_BASE;
  const r = await fetch(`${base}${path}`, { method, headers: {
    connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
    ...extraHeaders,
  }, body: data !== undefined ? JSON.stringify(data) : undefined });
  const text = await r.text();
  responses.push(text);
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}
async function rpc(name, token, params) {
  return request(`/torneos/rest/v1/rpc/${name}`, token, 'POST', params);
}
const coreSql = (q) => sql('core-db', q, 'postgres');
const torneosSql = (q) => sql('torneos-db', q);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
function asUser(claims, query, role = 'authenticated') {
  const r = sqlTry('torneos-db', `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true); ${query}; COMMIT;`);
  if (!r.ok) throw new Error(r.error);
  // psql prints the set_config() row first; the statement result is the last line.
  return r.out.trim().split('\n').pop();
}
/** Runs fn (a sql/asUser call); returns the SQL error text or null when it succeeded. */
function sqlError(fn) {
  try { fn(); return null; } catch (error) { return String(error.message ?? error); }
}
function torneosErr(query) { const r = sqlTry('torneos-db', query); return r.ok ? null : r.error; }
function coreErr(query) { const r = sqlTry('core-db', query, 'postgres'); return r.ok ? null : r.error; }
// Lab instrumentation on the Core side: every contract evaluation consumes a nonce.
// Phase 3B: the Edge gateway validates the Core session through the contract's `session`
// operation on every request; those verdicts (counted by core-api) are subtracted so this
// counter keeps meaning "contract OPERATION evaluations" for both gateways.
function sessionVerdicts() {
  const out = inGateway(`const r = await fetch('http://core-api:8000/_lab/counters'); console.log((await r.json()).session_verdicts);`);
  return Number(out.trim().split('\n').pop());
}
function coreCalls() {
  return Number(coreSql('select count(*) from lab_phase3a.core_calls').trim()) - sessionVerdicts();
}
async function adminApi(method, path, body) {
  const out = inGateway(`const r = await fetch(${JSON.stringify(`http://core-auth:9999/admin${path}`)}, { method: ${JSON.stringify(method)},
    headers: { authorization: 'Bearer ' + ${JSON.stringify(cfg.serviceRoleKey)}, 'content-type': 'application/json' },
    body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))} });
    console.log(JSON.stringify({ status: r.status, body: await r.text() }));`);
  const parsed = JSON.parse(out.trim().split('\n').pop());
  return { status: parsed.status, body: parsed.body ? JSON.parse(parsed.body) : null };
}
/** Direct, signed call to the REAL Core endpoint from inside the private network (Torneos server position). */
function coreCall(path, payload, { time, nonce, secret, method = 'POST' } = {}) {
  const body = JSON.stringify(payload);
  const t = time ?? String(Math.floor(Date.now() / 1000));
  const n = nonce ?? randomBytes(16).toString('hex');
  const sig = createHmac('sha256', Buffer.from(secret ?? cfg.coreContractSecret, 'hex')).update(`${path}\n${t}\n${n}\n`).update(body).digest('hex');
  const out = inGateway(`const r = await fetch(${JSON.stringify(`${cfg.coreContractUrl}${path}`)}, { method: ${JSON.stringify(method)}, body: ${JSON.stringify(body)},
    headers: { 'content-type': 'application/json', 'x-time': ${JSON.stringify(t)}, 'x-nonce': ${JSON.stringify(n)}, 'x-signature': ${JSON.stringify(sig)} } });
    console.log(JSON.stringify({ status: r.status, body: await r.text() }));`);
  const parsed = JSON.parse(out.trim().split('\n').pop());
  responses.push(parsed.body);
  return { status: parsed.status, body: parsed.body ? JSON.parse(parsed.body) : null, nonce: n, time: t };
}
function directTorneosRpc(token, name, body) {
  // Attacker position INSIDE the private network: the RPC without the gateway/adapter in front.
  const out = inGateway(`const r = await fetch(${JSON.stringify(`http://torneos-rest:3000/rpc/${name}`)}, { method: 'POST', headers: { 'content-type': 'application/json', ...(${JSON.stringify(token)} ? { authorization: 'Bearer ' + ${JSON.stringify(token)} } : {}) }, body: ${JSON.stringify(JSON.stringify(body))} });
    console.log(JSON.stringify({ status: r.status, body: await r.text() }));`);
  const parsed = JSON.parse(out.trim().split('\n').pop());
  let b = null; try { b = parsed.body ? JSON.parse(parsed.body) : null; } catch { b = parsed.body; }
  return { status: parsed.status, body: b };
}
function directTorneosRest(token, path) {
  // Attacker position INSIDE the private network, bypassing the gateway.
  const out = inGateway(`const r = await fetch(${JSON.stringify(`http://torneos-rest:3000${path}`)}, { headers: { authorization: 'Bearer ' + ${JSON.stringify(token)} } });
    console.log(JSON.stringify({ status: r.status, body: await r.text() }));`);
  return JSON.parse(out.trim().split('\n').pop());
}

// ---------------------------------------------------------------- identity helpers
async function signup(label, fullName) {
  const email = `p3a-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const r = await request('/auth/v1/signup', null, 'POST', { email, password, data: { full_name: fullName } });
  assert.equal(r.status, 200, `local GoTrue signup succeeds for ${label}`);
  seenSecrets.push(r.body.access_token, r.body.refresh_token, password);
  return { label, email, password, coreToken: r.body.access_token, refreshToken: r.body.refresh_token, coreUserId: r.body.user.id, session: decodeJwt(r.body.access_token).session_id };
}
async function exchange(user) {
  const r = await request('/exchange', user.coreToken, 'POST');
  assert.equal(r.status, 200, `server-side exchange succeeds for ${user.label}`);
  seenSecrets.push(r.body.access_token);
  user.token = r.body.access_token;
  user.tokenAt = Date.now();
  user.claims = decodeJwt(r.body.access_token);
  user.identity = user.claims.sub;
  return user.token;
}
async function tok(user) {
  if (!user.token || Date.now() - user.tokenAt > 80_000) await exchange(user);
  return user.token;
}
async function forgedToken(payload, kid = 'p3a-k1') {
  const key = cfg.keys.find(k => k.kid === kid);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: 'authenticated', ...payload }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
    .setIssuer(payload.iss ?? 'urn:arma2:local:identity-bridge').setAudience(payload.aud ?? 'arma2-torneos-local')
    .setIssuedAt(payload.iat ?? now).setNotBefore(payload.nbf ?? payload.iat ?? now).setExpirationTime(payload.exp ?? (payload.iat ?? now) + 120).setJti(randomUUID())
    .sign(await importPKCS8(key.privateKey, 'RS256'));
  seenSecrets.push(token);
  return token;
}
function setService(service, action) {
  dc([action, service], undefined, true);
}
async function waitCoreFunctions() {
  for (let i = 0; i < 60; i++) {
    try {
      const out = inGateway(`const r = await fetch('http://core-functions:9000/_internal/health', { signal: AbortSignal.timeout(2000) }); console.log(r.status);`);
      if (out.trim().endsWith('200')) return;
    } catch { /* restarting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('core-functions did not recover');
}

// ---------------------------------------------------------------- Core fixtures (real schema)
function coreTeam(ownerCoreId, name, members = []) {
  const id = randomUUID();
  coreSql(`insert into public.teams(id, owner_user_id, name, format) values (${lit(id)}, ${lit(ownerCoreId)}, ${lit(name)}, 5);`);
  for (const m of members) coreMember(id, { ...m, actor: ownerCoreId });
  return id;
}
function coreMember(teamId, { coreUserId = null, name, role = 'member', actor }) {
  // Core links members through jugadores (a match player row) and, for accounts, user_id.
  // Core's own trigger only lets the team owner/admin assign administrative roles, so the
  // fixture acts as the owner (auth.uid()) inside the transaction, as the product would.
  const owner = actor ?? coreSql(`select owner_user_id from public.teams where id=${lit(teamId)}`).trim();
  const partido = coreSql('insert into public.partidos default values returning id').trim();
  const jugador = coreSql(`insert into public.jugadores(partido_id, nombre, usuario_id) values (${partido}, ${lit(name)}, ${coreUserId ? lit(coreUserId) : 'null'}) returning id`).trim();
  coreSql(`BEGIN; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: owner, role: 'authenticated' }))}, true);
    insert into public.team_members(team_id, jugador_id, user_id, permissions_role) values (${lit(teamId)}, ${jugador}, ${coreUserId ? lit(coreUserId) : 'null'}, ${lit(role)}); COMMIT;`);
}

test('Phase 3A — real Core contracts → Torneos end-to-end', async (t) => {
  async function check(name, fn, status = 'PASS') {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 300) }); throw error; }
    });
  }
  // Lab-only counter of Core contract evaluations (nonce insertions); not Core code.
  coreSql(`create schema if not exists lab_phase3a;
    create table if not exists lab_phase3a.core_calls(id bigint generated always as identity primary key, at timestamptz default now());
    create or replace function lab_phase3a.count_call() returns trigger language plpgsql as $$ begin insert into lab_phase3a.core_calls default values; return null; end $$;
    drop trigger if exists lab_count on app_private.torneos_contract_nonces;
    create trigger lab_count after insert on app_private.torneos_contract_nonces for each row execute function lab_phase3a.count_call();`);

  const owner = await signup('owner', `${RUN} Owner Member`);
  const admin = await signup('admin', `${RUN} Admin Member`);
  const outsider = await signup('outsider', `${RUN} Outsider Person`);
  const captain = await signup('captain', `${RUN} Captain Test`);
  const ana = await signup('ana', `${RUN} Player Ana`);
  const beto = await signup('beto', `${RUN} Player Beto`);
  const cami = await signup('cami', `${RUN} Player Cami`);
  const dario = await signup('dario', `${RUN} Player Dario`);
  const banned = await signup('banned', `${RUN} Player Banned`);
  const gone = await signup('gone', `${RUN} Player Gone`);
  const unverified = await signup('unverified', `${RUN} Unverified Captain`);
  const changed = await signup('changed', `${RUN} Changed Captain`);
  for (const u of [owner, admin, outsider, captain]) await exchange(u);
  coreSql(`update public.usuarios set posiciones = array['ARQ'] where id = ${lit(ana.coreUserId)};
    update public.usuarios set posiciones = array['DEF','MED'], telefono = '+54 11 5555 0000' where id = ${lit(beto.coreUserId)};
    update public.usuarios set acepta_invitaciones = false where id = ${lit(cami.coreUserId)};
    update auth.users set email_confirmed_at = null where id = ${lit(unverified.coreUserId)};`);

  // Torneos fixtures through the real gateway (owner's real session) + minimal SQL, as tools/test.py does.
  const org = (await rpc('create_tournament_organization', await tok(owner), { p_name: 'Alpha League', p_slug: `alpha-league-${RUN}`, p_idempotency_key: randomUUID() })).body.organization.id;
  const org2 = (await rpc('create_tournament_organization', await tok(outsider), { p_name: 'Bravo League', p_slug: `bravo-league-${RUN}`, p_idempotency_key: randomUUID() })).body.organization.id;
  const season = (await rpc('create_tournament_season', await tok(owner), { p_organization_id: org, p_name: 'Season One', p_slug: 'season-one', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).body.id;
  const season2 = (await rpc('create_tournament_season', await tok(owner), { p_organization_id: org, p_name: 'Season Two', p_slug: 'season-two', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).body.id;
  const seasonOther = (await rpc('create_tournament_season', await tok(outsider), { p_organization_id: org2, p_name: 'Season Other', p_slug: 'season-other', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).body.id;
  assert.ok(org && org2 && season && season2 && seasonOther, 'organization/season fixtures created through the gateway');
  torneosSql(`insert into public.tournament_organization_members(organization_id,user_id,role,joined_at) values (${lit(org)},${lit(admin.identity)},'admin',now());`);
  const membership = torneosSql(`select id from public.tournament_organization_members where organization_id=${lit(org)} and user_id=${lit(admin.identity)}`).trim();
  assert.equal((await rpc('assign_tournament_season_member', await tok(owner), { p_organization_id: org, p_season_id: season, p_membership_id: membership })).status, 200);
  const modality = torneosSql('select code from public.tournament_sport_modalities where team_size=5 limit 1').trim();
  const fmt = torneosSql('select code from public.tournament_competition_formats limit 1').trim();
  const tournament = (o, s, u, name) => torneosSql(`insert into public.tournaments(organization_id,season_id,name,slug,sport_modality,competition_format,team_size,created_by,creation_key,status) values (${lit(o)},${lit(s)},${lit(name)},${lit(name)},${lit(modality)},${lit(fmt)},5,${lit(u)},gen_random_uuid(),'registration') returning id`).trim();
  const alpha = tournament(org, season, owner.identity, 'alpha-cup');
  const beta = tournament(org, season2, owner.identity, 'beta-cup');
  const other = tournament(org2, seasonOther, outsider.identity, 'other-cup');
  const category = torneosSql(`insert into public.tournament_categories(organization_id,tournament_id,name,slug) values (${lit(org)},${lit(alpha)},'Open','open') returning id`).trim();
  const categoryBeta = torneosSql(`insert into public.tournament_categories(organization_id,tournament_id,name,slug) values (${lit(org)},${lit(beta)},'Open','open') returning id`).trim();
  const manual = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: null, p_name: 'Local Team', p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
  assert.equal(manual.status, 200, 'manual entry (no Core dependency) through the gateway');
  const entry = manual.body.entryId;
  const invite = async (email, who = owner) => (await rpc('invite_tournament_team_manager', await tok(who), { p_organization_id: org, p_team_entry_id: entry, p_email: email, p_display_name: 'Captain', p_role: 'captain' })).body.token;

  try {
    // ================================================================ lab shape
    await check('lab: only the two gateways are published; databases, Auth, REST and the Edge Functions are internal', async () => {
      const ps = dc(['ps', '--format', 'json'], undefined, true).trim().split('\n').map(JSON.parse);
      assert.equal(ps.length, 9);
      for (const service of ps) {
        const ports = (service.Publishers ?? []).filter(p => p.PublishedPort);
        // Phase 3B: the Node gateway and its Edge Function port are the only published services.
        if (['gateway', 'torneos-functions'].includes(service.Service)) { assert.equal(ports.length, 1); assert.equal(ports[0].URL, '127.0.0.1'); }
        else assert.equal(ports.length, 0, `${service.Service} publishes nothing`);
      }
      const compose = await readFile('compose.yaml', 'utf8');
      assert.match(compose, /internal: true/);
      assert.equal((compose.match(/egress\]/g) ?? []).length, 2, 'only the two edge runtimes have outbound access (module resolution)');
    });
    await check('lab: Core is the real schema at HEAD plus the Phase 3A migration; Torneos is the Phase 2D certified baseline (Phase 2C ACL model + P0 season guard) plus the staging v1 RPC exposure gate', async () => {
      const install = JSON.parse(await readFile('.runtime/install.json', 'utf8'));
      assert.equal(install.torneos.sha256, 'f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f');
      assert.equal(install.torneos.sha256, install.torneos.certified_sha256);
      assert.deepEqual(install.torneos.migrations_after_baseline.map(m => [m.file.split('/').pop(), m.applied]), [['00000000000001_staging_v1_rpc_exposure.sql', true], ['00000000000002_mercadopago_checkout_pro_test.sql', true]], 'Phase 2D gate, then the MP-A2 commercial DB delta, applied after the baseline');
      assert.equal(install.torneos.migrations_after_baseline[1].sha256, '4805ed5f386749124344bc1486ceebadb0fbf656dfd5c6917315184ba98bae36', 'MP-A2 migration pinned');
      assert.equal(coreSql("select count(*) from pg_tables where schemaname='public'").trim(), '153', 'all 42 Core migrations applied');
      assert.equal(coreSql("select count(*) from pg_proc where proname like 'torneos_contract_%'").trim(), '5');
      assert.equal(torneosSql("select count(*) from pg_tables where schemaname='public'").trim(), '104');
      assert.equal(torneosSql("select count(*) from pg_tables where schemaname='public' and tablename in ('usuarios','jugadores','teams','team_members')").trim(), '0');
      assert.equal(torneosSql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosrc ~ 'auth\\.(users|sessions|uid)'").trim(), '0', 'baseline never reads GoTrue tables (the image pre-creates an empty auth schema)');
      assert.equal(coreSql("select to_regclass('public.torneos_identity') is null").trim(), 't', 'Core has no Torneos identity table');
      const migration = await readFile(`${repo}supabase/migrations/20260914120000_torneos_core_contract_v1.sql`, 'utf8');
      assert.ok(!/torneos_identity|tournament_(team|organization|season|roster|audit)|core_contract_attestations|dblink|postgres_fdw|\bprivate\./.test(migration), 'Core contract reads no Torneos objects');
      for (const db of ['core-db', 'torneos-db']) {
        assert.equal(sql(db, 'select count(*) from pg_foreign_server').trim(), '0');
        assert.equal(sql(db, "select count(*) from pg_extension where extname in ('dblink','postgres_fdw')").trim(), '0');
      }
    });
    await check('lab: contract entry point is service_role-only; helper tables are owner-only', async () => {
      assert.equal(coreSql("select has_function_privilege('service_role','public.torneos_contract_execute(text,text,jsonb)','EXECUTE')").trim(), 't');
      for (const role of ['anon', 'authenticated']) {
        assert.equal(coreSql(`select has_function_privilege('${role}','public.torneos_contract_execute(text,text,jsonb)','EXECUTE')`).trim(), 'f');
      }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(coreSql(`select bool_or(has_table_privilege('${role}',t,p)) from unnest(array['app_private.torneos_contract_nonces','app_private.torneos_contract_rate_events']) t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p`).trim(), 'f');
        assert.equal(coreSql(`select bool_or(has_function_privilege('${role}',f,'EXECUTE')) from unnest(array['app_private.torneos_contract_visible_player(uuid)','app_private.torneos_contract_importable_team(uuid,uuid)','app_private.torneos_contract_email(text)','app_private.torneos_contract_url(text)']) f`).trim(), 'f');
      }
      assert.match(coreErr("set role authenticated; select public.torneos_contract_execute('verified_email','0123456789abcdef0123456789abcdef','{}')") ?? '', /permission denied/);
    });

    // ================================================================ 1. verified email
    const token1 = await invite(captain.email);
    await check('verified email: Core outage fails closed (503), invitation stays pending, no attestation', async () => {
      setService('core-functions', 'stop');
      try {
        const r = await rpc('accept_tournament_team_invitation', await tok(captain), { p_token: token1 });
        assert.deepEqual([r.status, r.body], [503, { error: 'CORE_UNAVAILABLE' }]);
      } finally { setService('core-functions', 'start'); await waitCoreFunctions(); }
      assert.equal(torneosSql(`select status from public.tournament_team_invitations where token_hash=encode(public.digest(${lit(token1)},'sha256'),'hex')`).trim(), 'pending');
      assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where identity_id=${lit(captain.identity)}`).trim(), '0');
    });
    await check('verified email: wrong email denied by the real Core verdict (matches=false)', async () => {
      const wrong = await invite('someone-else@example.test');
      const r = await rpc('accept_tournament_team_invitation', await tok(captain), { p_token: wrong });
      assert.deepEqual([r.status, r.body.message ?? r.body.error], [403, 'TORNEOS_INVITATION_INVALID']);
      assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where identity_id=${lit(captain.identity)} and contract='verified_email' and response->>'matches'='false' and response->>'verified'='true'`).trim(), '1');
    });
    await check('verified email: unverified Core account denied (verified=false)', async () => {
      await exchange(unverified);
      const inv = await invite(unverified.email);
      const r = await rpc('accept_tournament_team_invitation', unverified.token, { p_token: inv });
      assert.equal(r.status, 403);
      assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where identity_id=${lit(unverified.identity)} and contract='verified_email' and response->>'verified'='false'`).trim(), '1');
    });
    await check('verified email: Core email change invalidates the old invitation; a new invite to the new address passes', async () => {
      await exchange(changed);
      const inv = await invite(changed.email);
      const newEmail = `p3a-changed-new-${randomUUID().slice(0, 8)}@example.test`;
      const upd = await adminApi('PUT', `/users/${changed.coreUserId}`, { email: newEmail, email_confirm: true });
      assert.equal(upd.status, 200, 'GoTrue admin applied the email change');
      const denied = await rpc('accept_tournament_team_invitation', changed.token, { p_token: inv });
      assert.equal(denied.status, 403);
      const inv2 = await invite(newEmail);
      const ok = await rpc('accept_tournament_team_invitation', await tok(changed), { p_token: inv2 });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.status, 'accepted');
    });
    await check('verified email: verified matching email accepted through the whole chain; manager bound to the local identity', async () => {
      const r = await rpc('accept_tournament_team_invitation', await tok(captain), { p_token: token1 });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.status, 'accepted');
      assert.equal(r.body.teamEntryId, entry);
      assert.equal(torneosSql(`select status||','||user_id::text from public.tournament_team_managers where team_entry_id=${lit(entry)} and email_normalized=${lit(captain.email.toLowerCase())}`).trim(), `active,${captain.identity}`);
      assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where identity_id=${lit(captain.identity)} and contract='verified_email' and consumed_at is not null and response->>'matches'='true'`).trim(), '1');
      assert.notEqual(captain.identity, captain.coreUserId, 'local identity is a shadow, not the Core id');
    });
    await check('verified email: second acceptance rejected; Core never learns the address (response carries no email)', async () => {
      const r = await rpc('accept_tournament_team_invitation', await tok(captain), { p_token: token1 });
      assert.equal(r.status, 403);
      assert.equal(torneosSql("select count(*) from private.core_contract_attestations where response::text ilike '%@%'").trim(), '0');
    });
    await check('verified email: disabled (banned) Core user denied at the gateway and by Core itself', async () => {
      const inv = await invite(banned.email);
      await exchange(banned);
      const ban = await adminApi('PUT', `/users/${banned.coreUserId}`, { ban_duration: '24h' });
      assert.equal(ban.status, 200);
      const r = await rpc('accept_tournament_team_invitation', banned.token, { p_token: inv });
      assert.equal(r.status, 401, 'online session check rejects the banned user before any contract');
      const direct = coreCall('/v1/verified-email', { core_user_id: banned.coreUserId, session_id: banned.session, expected_email: banned.email.toLowerCase() });
      assert.deepEqual([direct.status, direct.body], [403, { error: 'FORBIDDEN' }]);
      assert.equal((await request('/exchange', banned.coreToken, 'POST')).status, 401);
    });
    await check('verified email: real logout revokes the Core session — exchange, RPC and the Core contract all deny', async () => {
      const victim = await signup('logout', 'Logout Captain');
      await exchange(victim);
      const inv = await invite(victim.email);
      const before = await rpc('accept_tournament_team_invitation', victim.token, { p_token: inv });
      assert.equal(before.status, 200, 'sanity: the session works before logout');
      const victim2 = await signup('logout2', 'Logout Two');
      await exchange(victim2);
      const stillValid = victim2.token;
      const inv2 = await invite(victim2.email);
      assert.equal((await request('/auth/v1/logout', victim2.coreToken, 'POST')).status, 204);
      assert.equal(coreSql(`select count(*) from auth.sessions where id=${lit(victim2.session)}`).trim(), '0', 'GoTrue deleted the session row');
      assert.equal((await rpc('accept_tournament_team_invitation', stillValid, { p_token: inv2 })).status, 401, 'still-unexpired Torneos bearer is refused after logout');
      assert.equal((await request('/exchange', victim2.coreToken, 'POST')).status, 401, 'exchange refused after logout');
      const direct = coreCall('/v1/verified-email', { core_user_id: victim2.coreUserId, session_id: victim2.session, expected_email: victim2.email.toLowerCase() });
      assert.deepEqual([direct.status, direct.body], [403, { error: 'FORBIDDEN' }], 'Core itself denies the revoked session');
      assert.equal(torneosSql(`select status from public.tournament_team_invitations where token_hash=encode(public.digest(${lit(inv2)},'sha256'),'hex')`).trim(), 'pending');
    });

    // ================================================================ 2. directory
    await check('directory: authorized owner search returns discoverable Core players with the historical shape and local identities', async () => {
      const r = await rpc('search_tournament_players', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} player`, p_limit: 8, p_team_entry_id: null });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const names = r.body.map(p => p.displayName);
      assert.ok(names.includes(`${RUN} Player Ana`) && names.includes(`${RUN} Player Beto`) && names.includes(`${RUN} Player Dario`), names.join(','));
      assert.ok(!names.includes(`${RUN} Player Cami`), 'acepta_invitaciones=false hides the player');
      assert.ok(!names.includes(`${RUN} Player Banned`), 'banned account excluded');
      for (const p of r.body) {
        assert.deepEqual(Object.keys(p).sort(), ['avatarUrl', 'displayName', 'linkedAccount', 'positions', 'teamName', 'userId']);
        assert.equal(p.linkedAccount, true); assert.equal(p.teamName, null);
      }
      const anaRow = r.body.find(p => p.displayName === `${RUN} Player Ana`);
      assert.deepEqual(anaRow.positions, ['ARQ']);
      assert.equal(r.body.find(p => p.displayName === `${RUN} Player Beto`).positions.length, 2);
      ana.identity = torneosSql(`select id from public.torneos_identity where core_user_id=${lit(ana.coreUserId)}`).trim();
      assert.equal(anaRow.userId, ana.identity);
      assert.notEqual(ana.identity, ana.coreUserId);
      assert.ok(!JSON.stringify(r.body).includes('@') && !JSON.stringify(r.body).includes('5555'), 'no email or phone crosses the boundary');
    });
    await check('directory: result usable by the historical roster flow; the certified bridge upsert reuses the allocated identity', async () => {
      const roster = torneosSql(`select id from public.tournament_rosters where team_entry_id=${lit(entry)} order by version desc limit 1`).trim();
      const r = await rpc('add_tournament_roster_player', await tok(owner), { p_organization_id: org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: ana.identity, p_provisional_player_id: null, p_display_name: `${RUN} Player Ana`, p_avatar_url: null, p_shirt_number: 1, p_primary_position: 'ARQ', p_secondary_position: null, p_is_goalkeeper: true });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.displayName, `${RUN} Player Ana`);
      await exchange(ana);
      assert.equal(ana.identity, decodeJwt(ana.token).sub, 'exchange for the same Core user yields the identity the directory allocated');
    });
    await check('directory: deleted Core account disappears from search', async () => {
      const del = await adminApi('DELETE', `/users/${gone.coreUserId}`);
      assert.equal(del.status, 200);
      const r = await rpc('search_tournament_players', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} player gone`, p_limit: 8, p_team_entry_id: null });
      assert.deepEqual([r.status, r.body], [200, []]);
    });
    await check('directory: unauthorized callers denied BEFORE Core (outsider, other workspace, unassigned season, bad query)', async () => {
      const n = coreCalls();
      for (const [who, o, tnm, q, msg] of [
        [outsider, org, alpha, `${RUN} player`, 'outsider'],
        [owner, org, other, `${RUN} player`, 'other workspace tournament'],
        [admin, org, beta, `${RUN} player`, 'admin without season access'],
        [owner, org, alpha, 'p', 'query too short'],
        [owner, org, alpha, 'p'.repeat(101), 'query too long'],
      ]) {
        const r = await rpc('search_tournament_players', await tok(who), { p_organization_id: o, p_tournament_id: tnm, p_query: q, p_limit: 8, p_team_entry_id: null });
        assert.deepEqual([r.status, r.body], [403, { error: 'TORNEOS_RESOURCE_FORBIDDEN' }], msg);
      }
      assert.equal(coreCalls(), n, 'no Core call was made');
    });
    await check('directory: assigned admin passes on its season (season scope PASS)', async () => {
      const r = await rpc('search_tournament_players', await tok(admin), { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} player`, p_limit: 8, p_team_entry_id: null });
      assert.equal(r.status, 200);
      assert.ok(r.body.length >= 3);
    });
    await check('directory (Core endpoint): keyset pagination with session-bound, short-lived cursors', async () => {
      const first = coreCall('/v1/directory', { core_user_id: owner.coreUserId, session_id: owner.session, kind: 'players', query: `${RUN} player`, limit: 1, cursor: null });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.items.length, 1);
      assert.equal(typeof first.body.next_cursor, 'string');
      assert.deepEqual(Object.keys(first.body.items[0]).sort(), ['avatar_url', 'core_user_id', 'display_name', 'positions']);
      const second = coreCall('/v1/directory', { core_user_id: owner.coreUserId, session_id: owner.session, kind: 'players', query: `${RUN} player`, limit: 1, cursor: first.body.next_cursor });
      assert.equal(second.status, 200);
      assert.notEqual(second.body.items[0].core_user_id, first.body.items[0].core_user_id);
      assert.ok(second.body.items[0].core_user_id > first.body.items[0].core_user_id, 'stable UUID keyset order');
      const otherSession = coreCall('/v1/directory', { core_user_id: admin.coreUserId, session_id: admin.session, kind: 'players', query: `${RUN} player`, limit: 1, cursor: first.body.next_cursor });
      assert.deepEqual([otherSession.status, otherSession.body], [400, { error: 'INVALID_CURSOR' }]);
      const otherQuery = coreCall('/v1/directory', { core_user_id: owner.coreUserId, session_id: owner.session, kind: 'players', query: `${RUN} playe`, limit: 1, cursor: first.body.next_cursor });
      assert.deepEqual([otherQuery.status, otherQuery.body], [400, { error: 'INVALID_CURSOR' }]);
      const tampered = coreCall('/v1/directory', { core_user_id: owner.coreUserId, session_id: owner.session, kind: 'players', query: `${RUN} player`, limit: 1, cursor: first.body.next_cursor.slice(0, -1) + (first.body.next_cursor.endsWith('0') ? '1' : '0') });
      assert.deepEqual([tampered.status, tampered.body], [400, { error: 'INVALID_CURSOR' }]);
    });
    await check('directory (Core endpoint): accent/case-insensitive match, privacy allowlist, wrong session/user denied', async () => {
      coreSql(`update public.usuarios set nombre = ${lit(`Ñandú-Pérez ${RUN}`)}, avatar_url = 'http://insecure.example/x.png' where id = ${lit(dario.coreUserId)}`);
      const r = coreCall('/v1/directory', { core_user_id: owner.coreUserId, session_id: owner.session, kind: 'players', query: `NANDU perez ${RUN}`, limit: 8, cursor: null });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.items.map(i => i.display_name), [`Ñandú-Pérez ${RUN}`]);
      assert.equal(r.body.items[0].avatar_url, null, 'non-HTTPS avatar reference is withheld');
      const wrongSession = coreCall('/v1/directory', { core_user_id: owner.coreUserId, session_id: admin.session, kind: 'players', query: `${RUN} player`, limit: 8, cursor: null });
      assert.deepEqual([wrongSession.status, wrongSession.body], [403, { error: 'FORBIDDEN' }]);
      const wrongUser = coreCall('/v1/directory', { core_user_id: admin.coreUserId, session_id: owner.session, kind: 'players', query: `${RUN} player`, limit: 8, cursor: null });
      assert.deepEqual([wrongUser.status, wrongUser.body], [403, { error: 'FORBIDDEN' }]);
      const unknown = coreCall('/v1/directory', { core_user_id: randomUUID(), session_id: randomUUID(), kind: 'players', query: 'player', limit: 8, cursor: null });
      assert.equal(unknown.status, 403);
    });
    await check('directory (Core endpoint): 30 requests per actor per rolling minute, then 429', async () => {
      const probe = await signup('ratelimit', 'Rate Limit');
      let statuses = [];
      for (let i = 0; i < 31; i++) {
        statuses.push(coreCall('/v1/directory', { core_user_id: probe.coreUserId, session_id: probe.session, kind: i % 2 ? 'teams' : 'players', query: 'zz', limit: 12, cursor: null }).status);
      }
      assert.equal(statuses.filter(s => s === 200).length, 30);
      assert.equal(statuses[30], 429);
      const other = coreCall('/v1/directory', { core_user_id: owner.coreUserId, session_id: owner.session, kind: 'players', query: 'zz', limit: 1, cursor: null });
      assert.equal(other.status, 200, 'another actor is not affected');
    });
    await check('directory: Torneos local rate limit (30/min audit rows) blocks before Core', async () => {
      const n = coreCalls();
      const claims = owner.claims;
      const err = torneosErr(`BEGIN; insert into public.tournament_audit_log(organization_id,actor_user_id,actor_type,action,resource_type,resource_id,tournament_id,metadata) select ${lit(org)},${lit(owner.identity)},'user','search.players','tournament',${lit(alpha)},${lit(alpha)},'{}' from generate_series(1,30);
        SET LOCAL ROLE torneos_core_adapter; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true);
        select private.authorize_core_contract('directory_players', ${lit(JSON.stringify({ organization_id: org, tournament_id: alpha, team_entry_id: null, query: `${RUN} player`, limit: 8 }))}::jsonb); ROLLBACK;`);
      assert.match(err ?? '', /TORNEOS_SEARCH_RATE_LIMITED/);
      assert.equal(coreCalls(), n);
    });

    // Core teams (real Core rows). Owner owns A (Ana, Beto, Cami hidden, one guest without account) and C (renamed later).
    const teamA = coreTeam(owner.coreUserId, `${RUN} Alpha Rovers`, [{ coreUserId: ana.coreUserId, name: 'Ana' }, { coreUserId: beto.coreUserId, name: 'Beto' }, { coreUserId: cami.coreUserId, name: 'Cami' }, { name: 'Guest Without Account' }]);
    const teamB = coreTeam(beto.coreUserId, `${RUN} Alpha United`, [{ coreUserId: beto.coreUserId, name: 'Beto', role: 'owner' }]);
    const teamC = coreTeam(owner.coreUserId, `${RUN} Alpha Wanderers`, [{ coreUserId: ana.coreUserId, name: 'Ana' }]);
    const teamAdmin = coreTeam(beto.coreUserId, `${RUN} Alpha Admins`, [{ coreUserId: admin.coreUserId, name: 'Admin', role: 'admin' }]);
    await check('directory: teams search returns only teams the caller may import in Core (owner/admin), historical shape, colors null', async () => {
      const r = await rpc('search_tournament_arma2_teams', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} alpha`, p_limit: 8 });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.map(x => x.id).sort(), [teamA, teamC].sort());
      assert.deepEqual(Object.keys(r.body[0]).sort(), ['crestUrl', 'format', 'id', 'name', 'primaryColor', 'secondaryColor']);
      assert.equal(r.body[0].primaryColor, null);
      const a = await rpc('search_tournament_arma2_teams', await tok(admin), { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} alpha`, p_limit: 8 });
      assert.deepEqual(a.body.map(x => x.id), [teamAdmin], 'Core team admin (team_members.permissions_role=admin) may import');
      const n = coreCalls();
      for (const [who, tnm, msg] of [[admin, beta, 'admin without season access'], [outsider, alpha, 'outsider']]) {
        const d = await rpc('search_tournament_arma2_teams', await tok(who), { p_organization_id: org, p_tournament_id: tnm, p_query: `${RUN} alpha`, p_limit: 8 });
        assert.deepEqual([d.status, d.body], [403, { error: 'TORNEOS_RESOURCE_FORBIDDEN' }], msg);
      }
      assert.equal(coreCalls(), n);
    });
    await check(GATEWAY_NAME === 'edge'
      ? 'directory: Core contract outage fails closed for EVERY gateway request (Edge: the session verdict comes from Core over HTTPS); no partial write'
      : 'directory: Core outage yields no results; unrelated Torneos reads keep working', async () => {
      setService('core-functions', 'stop');
      try {
        const r = await rpc('search_tournament_arma2_teams', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} alpha`, p_limit: 8 });
        assert.deepEqual([r.status, r.body], [503, { error: 'CORE_UNAVAILABLE' }]);
        const read = await request(`/torneos/rest/v1/tournament_organizations?select=id,slug`, await tok(owner));
        const entriesBefore = Number(torneosSql(`select count(*) from public.tournament_team_entries where organization_id=${lit(org)}`).trim());
        const manualEntry = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: null, p_name: 'Manual During Outage', p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
        if (GATEWAY_NAME === 'edge') {
          // Documented Phase 3B difference (D1): without any Core database access, the Edge gateway
          // cannot validate a session while the Core contract endpoint is down, so it refuses
          // everything (503 CORE_UNAVAILABLE) instead of serving Core-independent traffic.
          assert.deepEqual([read.status, read.body], [503, { error: 'CORE_UNAVAILABLE' }], 'reads fail closed during the Core contract outage');
          assert.deepEqual([manualEntry.status, manualEntry.body], [503, { error: 'CORE_UNAVAILABLE' }], 'non-Core RPC fails closed during the outage');
          assert.equal(Number(torneosSql(`select count(*) from public.tournament_team_entries where organization_id=${lit(org)}`).trim()), entriesBefore, 'no partial write');
        } else {
          assert.equal(read.status, 200);
          assert.deepEqual(read.body.map(o => o.slug), [`alpha-league-${RUN}`], 'RLS still scopes the read to the caller workspace');
          assert.equal(manualEntry.status, 200, 'non-Core RPC keeps working during the outage');
        }
      } finally { setService('core-functions', 'start'); await waitCoreFunctions(); }
    });

    // ================================================================ 3. team import
    const key = randomUUID();
    let imported;
    await check('import: authorized owner imports a frozen snapshot (name from Core, visible candidates only, no roster members)', async () => {
      const r = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamA, p_name: null, p_short_name: null, p_primary_color: '#112233', p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: key });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      imported = r.body;
      assert.ok(imported.entryId && imported.rosterId && imported.status === 'draft');
      assert.equal(torneosSql(`select name||','||registration_source||','||arma2_team_id::text||','||coalesce(primary_color,'-') from public.tournament_team_entries where id=${lit(imported.entryId)}`).trim(), `${RUN} Alpha Rovers,arma2_team,${teamA},#112233`);
      const snapshot = JSON.parse(torneosSql(`select row_to_json(s) from private.tournament_team_entry_core_snapshots s where team_entry_id=${lit(imported.entryId)}`));
      assert.equal(snapshot.core_team_id, teamA);
      assert.equal(snapshot.imported_by, owner.identity);
      assert.deepEqual(snapshot.players.map(p => p.display_name).sort(), [`${RUN} Player Ana`, `${RUN} Player Beto`], 'hidden player and guest without account are not exposed');
      assert.equal(typeof snapshot.source_revision, 'number');
      assert.equal(torneosSql(`select count(*) from public.tournament_roster_players where team_entry_id=${lit(imported.entryId)}`).trim(), '0');
    });
    await check('import: unauthorized in Core (not owner/admin of the team) denied by Core; unauthorized in Torneos denied before Core', async () => {
      const r = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamB, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.deepEqual([r.status, r.body], [404, { error: 'CORE_DENIED' }]);
      const n = coreCalls();
      const a = await rpc('create_tournament_team_entry', await tok(admin), { p_organization_id: org, p_tournament_id: beta, p_category_id: categoryBeta, p_arma2_team_id: teamAdmin, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.deepEqual([a.status, a.body], [403, { error: 'TORNEOS_RESOURCE_FORBIDDEN' }], 'admin without season access');
      const o = await rpc('create_tournament_team_entry', await tok(outsider), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamA, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.deepEqual([o.status, o.body], [403, { error: 'TORNEOS_RESOURCE_FORBIDDEN' }], 'outsider');
      const c = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: randomUUID(), p_arma2_team_id: teamC, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.deepEqual([c.status, c.body], [403, { error: 'TORNEOS_REGISTRATION_CLOSED' }], 'unknown category');
      assert.equal(coreCalls(), n, 'local denials made no Core call');
    });
    await check('import: idempotent retry re-authorizes with Core and returns the original entry; frozen snapshot ignores later Core edits', async () => {
      coreSql(`update public.teams set name = ${lit(`${RUN} Renamed Later`)} where id = ${lit(teamA)};`);
      coreMember(teamA, { coreUserId: dario.coreUserId, name: 'Dario' });
      const n = coreCalls();
      const r = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamA, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: key });
      assert.equal(r.status, 200);
      assert.equal(r.body.entryId, imported.entryId);
      assert.equal(coreCalls(), n + 1, 'fresh Core authorization on retry');
      // Observation (residual, documented): the historical RPC answers an idempotent replay
      // before reaching consume_core_attestation, so the fresh positive attestation of a
      // retry stays unconsumed until its 10 s TTL. It is bound to identity, Core session,
      // contract and the exact org/tournament/category/team hash, and any RPC call with
      // those inputs hits the same replay/already-registered path first.
      assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where contract='team_snapshot' and identity_id=${lit(owner.identity)} and consumed_at is null and expires_at > now()`).trim(), '1');
      assert.equal(torneosSql("select count(*) from private.core_contract_attestations where consumed_at is null and expires_at > created_at + interval '10 seconds'").trim(), '0');
      const snap = JSON.parse(torneosSql(`select row_to_json(s) from private.tournament_team_entry_core_snapshots s where team_entry_id=${lit(imported.entryId)}`));
      assert.equal(snap.name, `${RUN} Alpha Rovers`);
      assert.deepEqual(snap.players.map(p => p.display_name).sort(), [`${RUN} Player Ana`, `${RUN} Player Beto`], 'changed roster does not rewrite the frozen snapshot');
      assert.equal(torneosSql(`select name from public.tournament_team_entries where id=${lit(imported.entryId)}`).trim(), `${RUN} Alpha Rovers`);
      const dup = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamA, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.message ?? dup.body.error, 'TORNEOS_TEAM_ALREADY_REGISTERED');
    });
    await check('P3A-R1 disposition (A): the retry attestation left unconsumed confers nothing beyond the same actor, Core session and exact target; duplicates are blocked and it expires', async () => {
      // The historical RPC answers an idempotent replay before consume_core_attestation, so the
      // positive team_snapshot attestation of a retry stays alive ≤ 10 s. Attacker position: the
      // RPC reached directly (no adapter, no fresh attestation) by every party that could try.
      const live = () => torneosSql(`select count(*) from private.core_contract_attestations where contract='team_snapshot' and identity_id=${lit(owner.identity)} and consumed_at is null and expires_at > now()`).trim();
      assert.ok(Number(live()) >= 1, 'a positive attestation for the exact target is alive');
      const params = (categoryId) => ({ p_organization_id: org, p_tournament_id: alpha, p_category_id: categoryId, p_arma2_team_id: teamA, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      const otherCategory = torneosSql(`insert into public.tournament_categories(organization_id,tournament_id,name,slug) values (${lit(org)},${lit(alpha)},'Phase 2C','phase-2c-${RUN}') returning id`).trim();
      const denied = (r, who) => { assert.equal(r.status, 403, `${who}: ${JSON.stringify(r.body)}`); assert.equal(r.body.message, 'TORNEOS_CORE_ATTESTATION_REQUIRED', who); };
      denied(directTorneosRpc(await tok(admin), 'create_tournament_team_entry', params(category)), 'another identity with local authority on the same target');
      denied(directTorneosRpc(await forgedToken({ sub: owner.identity, core_user_id: owner.coreUserId, session_id: randomUUID() }), 'create_tournament_team_entry', params(category)), 'same identity, another Core session');
      denied(directTorneosRpc(await tok(owner), 'create_tournament_team_entry', params(otherCategory)), 'same identity and session, different target (hash)');
      const before = live();
      const dup = directTorneosRpc(await tok(owner), 'create_tournament_team_entry', params(category));
      assert.equal(dup.status, 409, JSON.stringify(dup.body)); assert.equal(dup.body.message, 'TORNEOS_TEAM_ALREADY_REGISTERED');
      assert.equal(live(), before, 'the duplicate attempt rolls back: nothing consumed, nothing created');
      assert.equal(torneosSql(`select count(*) from public.tournament_team_entries where tournament_id=${lit(alpha)} and arma2_team_id=${lit(teamA)}`).trim(), '1');
      const remaining = Number(torneosSql(`select coalesce(ceil(extract(epoch from max(expires_at) - now()) * 1000), 0) from private.core_contract_attestations where contract='team_snapshot' and identity_id=${lit(owner.identity)} and consumed_at is null`).trim());
      await new Promise(r => setTimeout(r, Math.max(0, remaining) + 500));
      assert.equal(live(), '0', 'expired within the certified 10 s TTL');
      denied(directTorneosRpc(await tok(owner), 'create_tournament_team_entry', params(category)), 'same actor after expiry');
      assert.equal(torneosSql("select count(*) from private.core_contract_attestations where consumed_at is null and expires_at > created_at + interval '10 seconds'").trim(), '0');
    });
    await check('import: another competition captures a fresh version (current Core name and roster)', async () => {
      torneosSql(`update public.tournaments set status='registration' where id=${lit(beta)}`);
      const r = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: beta, p_category_id: categoryBeta, p_arma2_team_id: teamA, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const snap = JSON.parse(torneosSql(`select row_to_json(s) from private.tournament_team_entry_core_snapshots s where team_entry_id=${lit(r.body.entryId)}`));
      assert.equal(snap.name, `${RUN} Renamed Later`);
      assert.deepEqual(snap.players.map(p => p.display_name).sort(), [`${RUN} Player Ana`, `${RUN} Player Beto`, `Ñandú-Pérez ${RUN}`].sort());
    });
    await check('import: deleted/inactive Core team denied by Core (retry included); over-limit rosters rejected, never truncated', async () => {
      coreSql(`update public.teams set is_active = false where id = ${lit(teamC)};`);
      const r = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamC, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.deepEqual([r.status, r.body], [404, { error: 'CORE_DENIED' }]);
      coreSql(`delete from public.team_members where team_id = ${lit(teamC)}; delete from public.teams where id = ${lit(teamC)};`);
      const gone = coreCall('/v1/team-snapshot', { core_user_id: owner.coreUserId, session_id: owner.session, core_team_id: teamC });
      assert.deepEqual([gone.status, gone.body], [404, { error: 'NOT_FOUND' }], 'unknown and inaccessible teams are indistinguishable');
      coreSql(`update public.teams set is_active = true where id = ${lit(teamA)};`);
      // The contract's 80-player ceiling is unreachable in real Core: teams carry a
      // max_roster_size (CHECK <= 40) and Core's own trigger refuses the next member.
      const big = coreTeam(owner.coreUserId, `${RUN} Alpha Giants`);
      coreSql(`update public.teams set format = 11 where id = ${lit(big)}`);
      const cap = Number(coreSql(`select max_roster_size from public.teams where id = ${lit(big)}`).trim());
      assert.ok(cap >= 2 && cap <= 40, `Core caps this roster at ${cap}`);
      assert.match(coreSql("select pg_get_constraintdef(oid) from pg_constraint where conname='teams_max_roster_size_check'"), /<= 40/);
      let refused = null;
      for (let i = 0; i < cap + 1 && refused === null; i++) {
        const u = randomUUID();
        coreSql(`insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values (${lit(u)}, '00000000-0000-0000-0000-000000000000','authenticated','authenticated', ${lit(`giant-${i}-${u.slice(0, 8)}@example.test`)}, now(), ${lit(JSON.stringify({ full_name: `${RUN} Giant ${i}` }))}::jsonb, '{}'::jsonb, now(), now());`);
        const partido = coreSql('insert into public.partidos default values returning id').trim();
        const jugador = coreSql(`insert into public.jugadores(partido_id, nombre, usuario_id) values (${partido}, 'Giant', ${lit(u)}) returning id`).trim();
        refused = coreErr(`BEGIN; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: owner.coreUserId, role: 'authenticated' }))}, true);
          insert into public.team_members(team_id, jugador_id, user_id, permissions_role) values (${lit(big)}, ${jugador}, ${lit(u)}, 'member'); COMMIT;`);
      }
      assert.match(refused ?? '', /Plantilla completa/, 'Core itself refuses members beyond its roster cap');
      const full = coreCall('/v1/team-snapshot', { core_user_id: owner.coreUserId, session_id: owner.session, core_team_id: big });
      assert.equal(full.status, 200);
      assert.equal(full.body.players.length, cap, 'snapshot carries the full capped roster, never truncated');
    });
    await check('import: Core outage fails closed with no entry created', async () => {
      const before = torneosSql('select count(*) from public.tournament_team_entries').trim();
      setService('core-functions', 'stop');
      try {
        const r = await rpc('create_tournament_team_entry', await tok(owner), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamAdmin, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
        assert.deepEqual([r.status, r.body], [503, { error: 'CORE_UNAVAILABLE' }]);
      } finally { setService('core-functions', 'start'); await waitCoreFunctions(); }
      assert.equal(torneosSql('select count(*) from public.tournament_team_entries').trim(), before);
    });

    // ================================================================ 4. security / binding
    await check('binding: attestation is single-use, bound to identity, Core session, request hash and TTL (SQL boundary with real attestations)', async () => {
      // Prepare a real attestation through the adapter's own steps, then exercise the RPC directly as PostgREST would.
      const claims = (await exchange(owner), owner.claims);
      const prep = async (contract, req) => {
        const script = `import { Adapter } from './adapter.mjs'; import { CoreClient } from './core-client.mjs'; import pg from 'pg';
          const cfg = JSON.parse(await (await import('node:fs/promises')).readFile('.runtime/server/config.json','utf8'));
          const pool = new pg.Pool({ host:'torneos-db', database:'postgres', user:'lab_core_adapter', password: cfg.adapterPassword });
          const a = new Adapter(pool, new CoreClient(cfg.coreContractUrl, Buffer.from(cfg.coreContractSecret,'hex')));
          try { console.log(JSON.stringify(await a.prepare(${JSON.stringify(claims)}, ${JSON.stringify(contract)}, ${JSON.stringify(req)}))); }
          catch (e) { console.log(JSON.stringify({ error: e.code ?? e.message })); } finally { await pool.end(); }`;
        return JSON.parse(inGateway(script).trim().split('\n').pop());
      };
      const req = { organization_id: org, tournament_id: alpha, team_entry_id: null, query: `${RUN} player`, limit: 8 };
      assert.equal((await prep('directory_players', req)).contract, 'directory_players');
      const first = asUser(claims, `select jsonb_array_length(public.search_tournament_players(${lit(org)},${lit(alpha)},${lit(`${RUN} player`)},8,null))`);
      assert.ok(Number(first) >= 2, 'attested request served once');
      assert.match(sqlError(() => asUser(claims, `select public.search_tournament_players(${lit(org)},${lit(alpha)},${lit(`${RUN} player`)},8,null)`)) ?? '', /TORNEOS_CORE_ATTESTATION_REQUIRED/, 'replay of a consumed attestation denied');
      await prep('directory_players', req);
      assert.match(sqlError(() => asUser(claims, `select public.search_tournament_players(${lit(org)},${lit(alpha)},${lit(`${RUN} playe`)},8,null)`)) ?? '', /TORNEOS_CORE_ATTESTATION_REQUIRED/, 'bound to the exact query (request hash)');
      assert.match(sqlError(() => asUser(claims, `select public.search_tournament_players(${lit(org)},${lit(beta)},${lit(`${RUN} player`)},8,null)`)) ?? '', /TORNEOS_CORE_ATTESTATION_REQUIRED/, 'bound to the tournament');
      assert.match(sqlError(() => asUser(admin.claims, `select public.search_tournament_players(${lit(org)},${lit(alpha)},${lit(`${RUN} player`)},8,null)`)) ?? '', /TORNEOS_CORE_ATTESTATION_REQUIRED/, 'bound to the identity');
      assert.match(sqlError(() => asUser({ ...claims, session_id: randomUUID() }, `select public.search_tournament_players(${lit(org)},${lit(alpha)},${lit(`${RUN} player`)},8,null)`)) ?? '', /TORNEOS_CORE_ATTESTATION_REQUIRED/, 'bound to the Core session');
      torneosSql("update private.core_contract_attestations set created_at=now()-interval '30 seconds', observed_at=now()-interval '30 seconds', expires_at=now()-interval '20 seconds' where consumed_at is null");
      assert.match(sqlError(() => asUser(claims, `select public.search_tournament_players(${lit(org)},${lit(alpha)},${lit(`${RUN} player`)},8,null)`)) ?? '', /TORNEOS_CORE_ATTESTATION_REQUIRED/, 'expired attestation rejected');
      assert.match(sqlError(() => asUser(claims, `select public.search_tournament_players(${lit(org)},${lit(alpha)},${lit(`${RUN} player`)},8,null)`, 'anon')) ?? '', /permission denied|TORNEOS_/, 'anon obtains nothing (EXECUTE itself revoked in Phase 2C; see P3A-F1 closure)');
      assert.equal(torneosSql("select count(*) from private.core_contract_attestations where consumed_at is null and expires_at > created_at + interval '10 seconds'").trim(), '0');
    });
    await check('binding: snapshot attestation bound to the Core team; response/team mismatch rejected even with a matching hash', async () => {
      const claims = owner.claims;
      const script = `import { Adapter } from './adapter.mjs'; import { CoreClient } from './core-client.mjs'; import pg from 'pg';
        const cfg = JSON.parse(await (await import('node:fs/promises')).readFile('.runtime/server/config.json','utf8'));
        const pool = new pg.Pool({ host:'torneos-db', database:'postgres', user:'lab_core_adapter', password: cfg.adapterPassword });
        const a = new Adapter(pool, new CoreClient(cfg.coreContractUrl, Buffer.from(cfg.coreContractSecret,'hex')));
        try { console.log(JSON.stringify(await a.prepare(${JSON.stringify(claims)}, 'team_snapshot', ${JSON.stringify({ organization_id: org, tournament_id: alpha, category_id: category, core_team_id: teamAdmin })}))); }
        catch (e) { console.log(JSON.stringify({ error: e.code ?? e.message })); } finally { await pool.end(); }`;
      const prepared = JSON.parse(inGateway(script).trim().split('\n').pop());
      assert.deepEqual(prepared.error, 'CORE_DENIED', 'owner has no Core authority over teamAdmin → Core denies, nothing attested');
      assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where contract='team_snapshot' and identity_id=${lit(owner.identity)} and created_at > now() - interval '5 seconds'`).trim(), '0');
      // Real attestation for teamB is impossible for the owner; forge the mismatch at the boundary instead:
      torneosSql(`insert into private.core_contract_attestations(identity_id,session_id,contract,request_hash,response,observed_at)
        select identity_id,session_id,contract,request_hash,jsonb_set(response,'{core_team_id}',to_jsonb(${lit(teamB)}::text)),now()
        from private.core_contract_attestations where contract='team_snapshot' and consumed_at is not null order by created_at desc limit 1`);
      const err = sqlError(() => asUser(claims, `select public.create_tournament_team_entry(${lit(org)},${lit(alpha)},${lit(category)},${lit(teamA)},null,null,null,null,'arma2_team',null,null,null,${lit(randomUUID())})`));
      assert.match(err ?? '', /TORNEOS_CORE_ATTESTATION_REQUIRED|TORNEOS_RESOURCE_FORBIDDEN/);
      torneosSql("update private.core_contract_attestations set expires_at = created_at + interval '1 second' where consumed_at is null and contract='team_snapshot'");
    });
    await check('security: forged attestations impossible for client roles; adapter role is append-only and cannot run domain RPCs', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(torneosSql(`select bool_or(has_table_privilege('${role}','private.core_contract_attestations',p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p`).trim(), 'f');
        assert.equal(torneosSql(`select bool_or(has_table_privilege('${role}','private.tournament_team_entry_core_snapshots',p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p`).trim(), 'f');
      }
      assert.match(sqlError(() => asUser(owner.claims, `insert into private.core_contract_attestations(identity_id,session_id,contract,request_hash,response,observed_at) values (${lit(owner.identity)},${lit(owner.session)},'verified_email',repeat('0',64),'{"verified":true,"matches":true}',now())`)) ?? '', /permission denied/);
      assert.equal(torneosSql("select rolcanlogin::text||','||has_table_privilege('torneos_core_adapter','private.core_contract_attestations','INSERT')::text||','||has_table_privilege('torneos_core_adapter','private.core_contract_attestations','SELECT')::text from pg_roles where rolname='torneos_core_adapter'").trim(), 'false,true,false');
      assert.match(torneosErr(`SET ROLE lab_core_adapter; SET ROLE torneos_core_adapter; select public.search_tournament_players(${lit(org)},${lit(alpha)},'player',8,null)`) ?? '', /permission denied/);
      assert.match(torneosErr('SET ROLE lab_core_adapter; SET ROLE torneos_core_adapter; select count(*) from private.core_contract_attestations') ?? '', /permission denied/);
      assert.match(torneosErr('SET ROLE lab_core_adapter; select count(*) from public.torneos_identity') ?? '', /permission denied/, 'server login has nothing without SET ROLE');
    });
    await check('security: Torneos bearer binding — wrong session, wrong core_user_id, expired, wrong issuer/audience, untrusted key all denied', async () => {
      const base = { sub: owner.identity, core_user_id: owner.coreUserId, session_id: owner.session };
      const cases = [
        [{ ...base, session_id: randomUUID() }, 'wrong session_id'],
        [{ ...base, core_user_id: admin.coreUserId }, 'wrong core_user_id'],
        [{ ...base, sub: admin.identity }, 'identity of another user'],
        [{ ...base, iat: Math.floor(Date.now() / 1000) - 400, exp: Math.floor(Date.now() / 1000) - 280 }, 'expired'],
        [{ ...base, iss: 'urn:evil' }, 'wrong issuer'],
        [{ ...base, aud: 'other-audience' }, 'wrong audience'],
      ];
      for (const [payload, label] of cases) {
        const r = await rpc('search_tournament_players', await forgedToken(payload), { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} player`, p_limit: 8, p_team_entry_id: null });
        assert.equal(r.status, 401, label);
      }
      const untrusted = await forgedToken(base, 'p3a-k2');
      assert.equal((await rpc('search_tournament_players', untrusted, { p_organization_id: org, p_tournament_id: alpha, p_query: `${RUN} player`, p_limit: 8, p_team_entry_id: null })).status, 401, 'untrusted signing key');
      const direct = directTorneosRest(await forgedToken({ ...base, aud: 'other-audience' }), '/torneos_identity?select=id');
      assert.equal(direct.status, 401, 'PostgREST itself rejects the wrong audience inside the network');
      const directOk = directTorneosRest(await tok(owner), '/torneos_identity?select=id');
      assert.equal(directOk.status, 200);
      assert.deepEqual(JSON.parse(directOk.body), [{ id: owner.identity }], 'RLS: own identity only');
    });
    await check('security: Core service authentication — forged signature, skewed time, replayed nonce, wrong path, wrong method, oversized body', async () => {
      const payload = { core_user_id: owner.coreUserId, session_id: owner.session, expected_email: 'x@y.z' };
      assert.deepEqual(coreCall('/v1/verified-email', payload, { secret: randomBytes(32).toString('hex') }).body, { error: 'SERVICE_AUTH_REQUIRED' });
      assert.deepEqual(coreCall('/v1/verified-email', payload, { time: String(Math.floor(Date.now() / 1000) - 31) }).body, { error: 'SERVICE_AUTH_REQUIRED' });
      const ok = coreCall('/v1/verified-email', payload);
      assert.equal(ok.status, 200);
      const replay = coreCall('/v1/verified-email', payload, { time: ok.time, nonce: ok.nonce });
      assert.deepEqual([replay.status, replay.body], [401, { error: 'REPLAY' }]);
      assert.equal(coreCall('/v1/nope', payload).status, 404);
      assert.equal(coreCall('/v1/verified-email', payload, { method: 'PUT' }).status, 404);
      assert.equal(coreCall('/v1/verified-email', { ...payload, extra: 1 }).status, 400);
      assert.equal(coreCall('/v1/verified-email', { ...payload, pad: 'x'.repeat(17000) }).status, 413);
      const unsigned = inGateway(`const r = await fetch(${JSON.stringify(`${cfg.coreContractUrl}/v1/verified-email`)}, { method: 'POST', body: ${JSON.stringify(JSON.stringify(payload))}, headers: { 'content-type': 'application/json' } }); console.log(r.status);`);
      assert.equal(unsigned.trim(), '401');
      const notMounted = inGateway(`const r = await fetch('http://core-api:8000/functions/v1/push-sender', { method: 'POST', body: '{}' }); console.log(r.status);`);
      assert.equal(notMounted.trim(), '404', 'the lab exposes no other Core function');
    });
    await check('security: no secrets in logs, published config or Torneos; service key confined to Core-side containers', async () => {
      const secrets = [cfg.coreContractSecret, cfg.serviceRoleKey, cfg.coreSecret, cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.adapterPassword,
        ...cfg.keys.map(k => k.privateKey.split('\n').slice(1, 3).join('\n')), ...seenSecrets.filter(Boolean)];
      const logs = ['gateway', 'torneos-functions', 'core-functions', 'core-api', 'torneos-rest', 'core-rest', 'core-auth'].map(s => dc(['logs', '--no-log-prefix', s], undefined, true)).join('\n');
      for (const secret of secrets) assert.ok(!logs.includes(secret), 'service logs never contain a secret or a session token');
      const publicConfig = await request('/config');
      assert.deepEqual(Object.keys(publicConfig.body).sort(), ['anonKey', 'coreUrl', 'torneosUrl']);
      const published = JSON.stringify(publicConfig.body) + responses.join('\n');
      for (const secret of secrets.filter(s => s !== cfg.anonKey && !seenSecrets.includes(s))) assert.ok(!published.includes(secret), 'no response body carries a secret');
      assert.ok(!responses.some(r => r.includes(cfg.serviceRoleKey) || r.includes(cfg.coreContractSecret)));
      assert.equal(torneosSql(`select count(*) from pg_settings where setting like '%${cfg.coreContractSecret.slice(0, 16)}%'`).trim(), '0');
      const composeCfg = dc(['config', '--format', 'json'], undefined, true);
      const services = JSON.parse(composeCfg).services;
      const holders = Object.entries(services).filter(([, s]) => JSON.stringify(s.environment ?? {}).includes(cfg.serviceRoleKey)).map(([n]) => n);
      assert.deepEqual(holders, ['core-functions'], 'only the Core Edge Function holds the Core service key');
      const secretHolders = Object.entries(services).filter(([, s]) => JSON.stringify(s.environment ?? {}).includes(cfg.coreContractSecret)).map(([n]) => n).sort();
      // Phase 3B: the Edge gateway receives the contract secret the way the hosted function does (its own env);
      // the Node gateway still reads it from its private config file.
      assert.deepEqual(secretHolders, ['core-functions', 'torneos-functions'], 'only the two contract endpoints hold the contract secret');
      assert.ok(!JSON.stringify(services['torneos-functions'].environment ?? {}).includes(cfg.serviceRoleKey), 'the Edge gateway never holds the Core service key');
      assert.ok(!JSON.stringify(services['torneos-functions'].environment ?? {}).includes(cfg.coreSecret), 'the Edge gateway never holds the Core JWT secret');
      assert.ok(!JSON.stringify(services['torneos-functions'].environment ?? {}).includes(cfg.readerPassword), 'the Edge gateway has no Core database login');
      assert.ok(!services.gateway.volumes.some(v => v.source?.includes('.runtime/config.json')));
      assert.ok(services['torneos-rest'].volumes.every(v => v.source?.endsWith('.runtime/public')), 'PostgREST mounts only the public JWKS');
      const bridgeFile = JSON.parse(await readFile('.runtime/server/config.json', 'utf8'));
      assert.ok(!('coreSecret' in bridgeFile) && !('serviceRoleKey' in bridgeFile) && !('dbPassword' in bridgeFile));
    });
    await check('security: no cross-database access — Core contract SQL touches no Torneos objects; Torneos has no Core tables, FDW or dblink', async () => {
      const src = coreSql("select string_agg(prosrc, ' ') from pg_proc where proname like 'torneos_contract_%'");
      assert.ok(!/torneos_identity|tournament_(team|organization|season|roster|audit)|core_contract_attestations|\bprivate\./.test(src), 'Core contract SQL references no Torneos object');
      assert.match(src, /normalize_tournament_person_name/, "matching reuses Core's own normalizer");
      assert.equal(torneosSql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosrc ~ 'auth\\.(users|sessions)|public\\.(usuarios|jugadores|teams|team_members)\\M'").trim(), '0');
      assert.equal(torneosSql('select count(*) from pg_foreign_server').trim(), '0');
      assert.equal(coreSql('select count(*) from pg_foreign_server').trim(), '0');
    });

    // ================================================================ 5. end-to-end / scope
    await check('e2e: cross-season DENY for the admin on every Core-dependent RPC; cross-workspace DENY for the owner', async () => {
      const n = coreCalls();
      const admT = await tok(admin);
      assert.equal((await rpc('search_tournament_players', admT, { p_organization_id: org, p_tournament_id: beta, p_query: `${RUN} player`, p_limit: 8, p_team_entry_id: null })).status, 403);
      assert.equal((await rpc('search_tournament_arma2_teams', admT, { p_organization_id: org, p_tournament_id: beta, p_query: `${RUN} alpha`, p_limit: 8 })).status, 403);
      assert.equal((await rpc('create_tournament_team_entry', admT, { p_organization_id: org, p_tournament_id: beta, p_category_id: categoryBeta, p_arma2_team_id: teamAdmin, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() })).status, 403);
      const ownT = await tok(owner);
      assert.equal((await rpc('search_tournament_players', ownT, { p_organization_id: org2, p_tournament_id: other, p_query: `${RUN} player`, p_limit: 8, p_team_entry_id: null })).status, 403);
      assert.equal((await rpc('search_tournament_arma2_teams', ownT, { p_organization_id: org2, p_tournament_id: other, p_query: `${RUN} alpha`, p_limit: 8 })).status, 403);
      assert.equal(coreCalls(), n, 'every denial happened before Core');
      assert.equal((await request(`/torneos/rest/v1/tournaments?select=slug&id=eq.${other}`, ownT)).body.length, 0, 'RLS hides the other workspace');
    });
    await check('e2e: season scope PASS — the assigned admin completes a Core-dependent import on its own season', async () => {
      const r = await rpc('create_tournament_team_entry', await tok(admin), { p_organization_id: org, p_tournament_id: alpha, p_category_id: category, p_arma2_team_id: teamAdmin, p_name: null, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'arma2_team', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(torneosSql(`select name from public.tournament_team_entries where id=${lit(r.body.entryId)}`).trim(), `${RUN} Alpha Admins`);
      assert.equal(torneosSql(`select imported_by from private.tournament_team_entry_core_snapshots where team_entry_id=${lit(r.body.entryId)}`).trim(), admin.identity);
    });
    // ================================================================ 6. baseline ACL on the real Supabase database (P3A-F1 closed in Phase 2C)
    await check('P3A-F1 closed: on the real Supabase database the corrected baseline leaves no accidental EXECUTE or sequence privilege; a directly exposed Data API denies SERVICE_ONLY before the body', async () => {
      // Phase 3A observed the Supabase image's schema-scoped default ACLs adding anon/authenticated/
      // service_role EXECUTE (358/359 public functions, 304/304 DEFINER) and sequence privileges to
      // every object the baseline created. The Phase 2C prologue revokes those schema-scoped defaults
      // (functions and sequences) for the installer, so every API-role privilege is an explicit GRANT.
      const count = (q) => torneosSql(q).trim();
      const installerDefaults = JSON.parse(count("select coalesce(json_object_agg(defaclobjtype, coalesce(defaclacl::text,'')),'{}') from pg_default_acl where defaclrole='supabase_admin'::regrole and defaclnamespace='public'::regnamespace"));
      for (const [type, acl] of Object.entries(installerDefaults)) assert.ok(!/anon=|authenticated=|service_role=/.test(acl), `installer default ACL ${type}: ${acl}`);
      assert.match(count("select defaclacl::text from pg_default_acl where defaclrole='postgres'::regrole and defaclnamespace='public'::regnamespace and defaclobjtype='f'"), /anon=X/, 'image default ACLs are still the platform\'s (real Supabase database)');
      const after = {
        anon_execute_public_functions: count("select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))||'/'||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"),
        authenticated_execute_public_functions: count("select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))||'/'||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"),
        service_role_execute_public_functions: count("select count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE'))||'/'||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"),
        anon_execute_security_definer: count("select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))||'/'||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef"),
        anon_execute_private_beyond_token_helpers: count("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname not in ('check_token','current_identity_id')"),
        public_execute_functions: count("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')"),
        anon_sequence_privilege: count("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' and (has_sequence_privilege('anon',c.oid,'USAGE') or has_sequence_privilege('anon',c.oid,'SELECT') or has_sequence_privilege('anon',c.oid,'UPDATE'))") + '/' + count("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'"),
        anon_non_select_table_grants: count("select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and privilege_type <> 'SELECT'"),
      };
      // Phase 2C measured 180/359 for authenticated on the baseline alone; Phase 2D's staging v1 gate removes exactly its manifest.
      const gate = JSON.parse(await readFile(`${repo}backend/torneos/phase2d/staging-v1-rpc-gate.json`, 'utf8'));
      // MP-A2 (00000000000002) adds its SECURITY DEFINER commerce RPCs (never anon, no service_role) and shifts authenticated by its manifest only.
      const mpA2 = JSON.parse(await readFile(`${repo}backend/torneos/mp-a/mp-a2-acl-delta.json`, 'utf8'));
      const mpA2New = mpA2.new_security_definer_functions.length;
      const mpA2AuthNet = mpA2.new_security_definer_functions.filter(f => f.api_grantees.includes('authenticated')).length + mpA2.authenticated_execute_granted.length - mpA2.authenticated_execute_revoked.length;
      assert.deepEqual(after, { anon_execute_public_functions: `12/${359 + mpA2New}`, authenticated_execute_public_functions: `${180 - gate.functions.length + mpA2AuthNet}/${359 + mpA2New}`, service_role_execute_public_functions: `328/${359 + mpA2New}`, anon_execute_security_definer: `12/${304 + mpA2New}`, anon_execute_private_beyond_token_helpers: '0', public_execute_functions: '0', anon_sequence_privilege: '0/7', anon_non_select_table_grants: '0' });
      // Reachability: the certified gateway refuses anon; a directly exposed Data API now denies by ACL, before the body.
      assert.equal((await request('/torneos/rest/v1/rpc/tournament_media_pipeline_readiness', null, 'POST', {})).status, 401);
      const direct = directTorneosRpc(null, 'tournament_media_pipeline_readiness', {});
      assert.equal(direct.status, 401, JSON.stringify(direct.body));
      assert.equal(direct.body.code, '42501'); assert.match(direct.body.message, /permission denied for function tournament_media_pipeline_readiness/);
      const asUserDirect = directTorneosRpc(await tok(owner), 'tournament_media_pipeline_readiness', {});
      assert.equal(asUserDirect.status, 403); assert.match(asUserDirect.body.message, /permission denied for function/);
      await writeFile('evidence/finding-p3a-f1.json', JSON.stringify({
        finding: 'P3A-F1',
        status: 'CLOSED in Phase 2C (baseline prologue fix, recertified on this real Supabase stack and on template0)',
        observed_on: 'supabase/postgres:17.6.1.143 `postgres` database, baseline installed as supabase_admin',
        cause: 'Schema-scoped default ACLs of the Supabase image (installing role, schema public: functions/sequences/tables -> anon, authenticated, service_role) are added on top of global default ACLs; the certified prologue revoked function defaults globally and table defaults per schema only, so functions and sequences kept the image grants and the per-object REVOKE ... FROM PUBLIC could not remove an explicit anon grant.',
        fix: 'backend/torneos/tools/build.py prologue: ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;',
        phase3a_observed: { anon_execute_public_functions: '358/359', anon_execute_security_definer: '304/304', anon_sequence_privilege: '7/7', direct_postgrest_service_only_as_anon: 200 },
        phase2c_observed: { ...after, direct_postgrest_service_only_as_anon: direct.status, direct_postgrest_service_only_as_authenticated: asUserDirect.status },
        installer_default_acl_after_install: installerDefaults,
        reachable_through_certified_gateway: false,
        reachable_through_direct_postgrest: false,
        baseline_changed: true,
        evidence: ['integration/torneos-core-contracts/evidence/acl-results.json', 'backend/torneos/phase2c/evidence/real-image-acl-diff.json'],
      }, null, 2) + '\n');
    });
    await check('e2e: every consumed attestation belonged to the consuming identity; no live positive verdict is left behind', async () => {
      assert.equal(torneosSql('select count(*) from private.core_contract_attestations a where consumed_at is not null and not exists (select 1 from public.torneos_identity i where i.id=a.identity_id)').trim(), '0');
      assert.equal(torneosSql("select count(*) from private.core_contract_attestations where consumed_at is null and expires_at > now() and (response->>'matches'='true' or response ? 'items' or response ? 'players')").trim(), '0');
    });
  } finally {
    await mkdir('evidence', { recursive: true });
    // Phase 3B: one evidence file per gateway under test (node → the Phase 3A file name).
    await writeFile(GATEWAY_NAME === 'edge' ? 'evidence/e2e-results-edge.json' : 'evidence/e2e-results.json', JSON.stringify({
      generated_at: new Date().toISOString(),
      gateway: GATEWAY_NAME,
      base: GATEWAY_BASE,
      auth_base: BASE,
      pass: results.filter(r => r.status === 'PASS').length,
      fail: results.filter(r => r.status === 'FAIL').length,
      results,
    }, null, 2) + '\n');
  }
});
