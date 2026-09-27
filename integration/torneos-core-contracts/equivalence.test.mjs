// Phase 3B — differential certification: the Node gateway (Phase 1.5/3A/2D, certified) and
// its Edge Function port (backend/torneos/supabase/functions/torneos-gateway) receive the
// SAME requests and must answer with the SAME status and body. Tokens are compared by their
// claims (jti/iat/exp/nbf are per-issuance). The only difference (D1: with the Core contract
// endpoint down the Edge gateway refuses every session-gated request, the Node gateway keeps
// serving Core-independent ones) is asserted explicitly with its justification, never hidden;
// its counterpart experiments live in d1.test.mjs (evidence/d1-session-authority.json).
// Results: evidence/equivalence-results.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { SignJWT, importPKCS8, decodeJwt } from 'jose';
import { config, dc, sql, inGateway, BASE, EDGE_BASE, repo } from './lab.mjs';

const cfg = await config();
const RUN = 'q' + randomBytes(2).toString('hex');
const rows = [];
const seenSecrets = [];

async function send(base, { path, method = 'GET', token, body, headers = {} }) {
  const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, redirect: 'manual' });
  const text = await r.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed, headers: { 'cache-control': r.headers.get('cache-control'), 'content-type': (r.headers.get('content-type') ?? '').split(';')[0] } };
}
function normalize(body) {
  if (body && typeof body === 'object' && typeof body.access_token === 'string') {
    const c = decodeJwt(body.access_token);
    const h = JSON.parse(Buffer.from(body.access_token.split('.')[0], 'base64url').toString());
    seenSecrets.push(body.access_token);
    return { ...body, access_token: { header: h, claims: { ...c, jti: '<per-issuance>', iat: '<per-issuance>', exp: '<per-issuance>', nbf: '<per-issuance>', ttl: c.exp - c.iat } } };
  }
  return body;
}
async function same(name, req, { expect } = {}) {
  const [n, e] = await Promise.all([send(BASE, req), send(EDGE_BASE, req)]);
  const row = { name, request: { path: req.path, method: req.method ?? 'GET', auth: req.token ? 'bearer' : 'none' },
    node: { status: n.status, body: normalize(n.body), headers: n.headers }, edge: { status: e.status, body: normalize(e.body), headers: e.headers } };
  row.equivalent = row.node.status === row.edge.status && JSON.stringify(row.node.body) === JSON.stringify(row.edge.body)
    && row.node.headers['cache-control'] === row.edge.headers['cache-control'];
  rows.push(row);
  assert.ok(row.equivalent, `${name}: node ${n.status} ${JSON.stringify(row.node.body).slice(0, 160)} | edge ${e.status} ${JSON.stringify(row.edge.body).slice(0, 160)}`);
  if (expect) assert.deepEqual([n.status, n.body], expect, `${name}: expected verdict`);
  return { node: n, edge: e };
}
const coreSql = (q) => sql('core-db', q, 'postgres');
async function signup(label) {
  const email = `${RUN}-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const r = await send(BASE, { path: '/auth/v1/signup', method: 'POST', body: { email, password, data: { full_name: `${RUN} ${label}` } } });
  assert.equal(r.status, 200);
  seenSecrets.push(r.body.access_token, r.body.refresh_token);
  return { label, email, coreToken: r.body.access_token, coreUserId: r.body.user.id, sessionId: decodeJwt(r.body.access_token).session_id };
}
async function forged(payload, kid = 'p3a-k1') {
  const key = cfg.keys.find(k => k.kid === kid);
  const now = Math.floor(Date.now() / 1000);
  const t = await new SignJWT({ role: 'authenticated', ...payload }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
    .setIssuer(payload.iss ?? 'urn:arma2:local:identity-bridge').setAudience(payload.aud ?? 'arma2-torneos-local')
    .setIssuedAt(payload.iat ?? now).setNotBefore(payload.nbf ?? payload.iat ?? now).setExpirationTime(payload.exp ?? (payload.iat ?? now) + 120).setJti(randomUUID())
    .sign(await importPKCS8(key.privateKey, 'RS256'));
  seenSecrets.push(t);
  return t;
}
function setService(service, action) { dc([action, service], undefined, true); }
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

test('Phase 3B — Node gateway ≡ Edge gateway (same requests, same verdicts)', async (t) => {
  const check = (name, fn) => t.test(name, fn);
  const owner = await signup('owner');
  const other = await signup('other');
  const banned = await signup('banned');
  const victim = await signup('victim');
  const OFF = JSON.parse(await readFile(`${repo}backend/torneos/phase2d/staging-v1-rpc-gate.json`, 'utf8'));
  const allow = JSON.parse(await readFile(`${repo}backend/torneos/phase2d/staging-v1-rpc-allowlist.json`, 'utf8'));
  const ALLOWED = Object.values(allow.features).flat();
  // COMPETITION-V1 (0004 + competition allowlist) re-enabled 15 of the 33 gated RPCs: they are no longer OFF.
  const competitionGrants = JSON.parse(await readFile(`${repo}backend/torneos/competition-v1/contract.json`, 'utf8')).acl.granted_by_0004.map((f) => f.split('(')[0]);
  const offNames = [...new Set(OFF.functions.map(f => f.name))].filter((name) => !competitionGrants.includes(name));
  assert.equal(offNames.length, 33 - competitionGrants.length, `gate manifest minus the COMPETITION-V1 grants (${offNames.length})`);

  let tokens = {};
  try {
    await check('public endpoints: health, jwks (same trusted keys), unknown paths, method not allowed', async () => {
      await same('health', { path: '/health' }, { expect: [200, { ready: true }] });
      await same('unknown path', { path: '/nope' }, { expect: [404, { error: 'not found' }] });
      await same('rest: unknown shape', { path: '/torneos/rest/v1/../secret' });
      await same('exchange: GET not allowed', { path: '/exchange' }, { expect: [404, { error: 'not found' }] });
      await same('exchange: no bearer', { path: '/exchange', method: 'POST' }, { expect: [401, { error: 'access denied' }] });
      await same('exchange: identity/role input refused', { path: '/exchange', method: 'POST', token: owner.coreToken, body: { role: 'service_role' } }, { expect: [400, { error: 'exchange accepts no identity or role input' }] });
      const jwksEdge = await send(EDGE_BASE, { path: '/.well-known/jwks.json' });
      assert.equal(jwksEdge.status, 200);
      const published = JSON.parse(await readFile('.runtime/public/jwks.json', 'utf8'));
      assert.deepEqual(jwksEdge.body.keys.map(k => [k.kid, k.n, k.e, k.alg, k.use]), published.keys.map(k => [k.kid, k.n, k.e, k.alg, k.use]), 'the Edge gateway publishes exactly the JWKS PostgREST trusts');
      const cfgNode = await send(BASE, { path: '/config' }), cfgEdge = await send(EDGE_BASE, { path: '/config' });
      assert.deepEqual([Object.keys(cfgNode.body).sort(), Object.keys(cfgEdge.body).sort()], [['anonKey', 'coreUrl', 'torneosUrl'], ['anonKey', 'coreUrl', 'torneosUrl']]);
      rows.push({ name: 'config (public values differ by deployment: coreUrl/torneosUrl)', equivalent: true, node: { status: cfgNode.status, keys: Object.keys(cfgNode.body).sort() }, edge: { status: cfgEdge.status, keys: Object.keys(cfgEdge.body).sort() } });
    });

    await check('exchange: same identity, same claims (iss/aud/sub/core_user_id/session_id/role/ttl/kid), on both gateways', async () => {
      const r = await same('exchange: owner', { path: '/exchange', method: 'POST', token: owner.coreToken });
      assert.equal(r.node.status, 200);
      const cn = decodeJwt(r.node.body.access_token), ce = decodeJwt(r.edge.body.access_token);
      assert.equal(cn.sub, ce.sub, 'one local identity per Core user, whichever gateway allocated it');
      assert.deepEqual([cn.iss, cn.aud, cn.core_user_id, cn.session_id, cn.role, cn.exp - cn.iat], [ce.iss, ce.aud, ce.core_user_id, ce.session_id, ce.role, ce.exp - ce.iat]);
      assert.deepEqual([cn.iss, cn.aud, cn.exp - cn.iat], ['urn:arma2:local:identity-bridge', 'arma2-torneos-local', 120]);
      assert.equal(sql('torneos-db', `select count(*) from public.torneos_identity where core_user_id='${owner.coreUserId}'`).trim(), '1');
      tokens.ownerNode = r.node.body.access_token; tokens.ownerEdge = r.edge.body.access_token;
      const o = await same('exchange: other', { path: '/exchange', method: 'POST', token: other.coreToken });
      tokens.other = o.edge.body.access_token;
      // Cross-acceptance: a token minted by one gateway is honoured by the other (same key ring, same contract).
      const crossNode = await send(BASE, { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tokens.ownerEdge, body: {} });
      const crossEdge = await send(EDGE_BASE, { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tokens.ownerNode, body: {} });
      assert.deepEqual([crossNode.status, crossEdge.status], [200, 200]);
      rows.push({ name: 'cross-acceptance: Edge-minted token on Node gateway / Node-minted token on Edge gateway', equivalent: true, node: { status: crossNode.status }, edge: { status: crossEdge.status } });
      await same('exchange: garbage bearer', { path: '/exchange', method: 'POST', token: 'not-a-jwt' }, { expect: [401, { error: 'access denied' }] });
      await same('exchange: Torneos token is not a Core token', { path: '/exchange', method: 'POST', token: tokens.ownerEdge }, { expect: [401, { error: 'access denied' }] });
    });

    await check('RPC: allowlisted (200 same body), the 33 OFF (403 rpc not enabled, POST and GET), table reads (RLS), bad requests', async () => {
      const tok = tokens.ownerEdge;
      await same('rpc: get_my_tournament_memberships', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tok, body: {} });
      await same('rpc: is_tournament_organization_slug_available', { path: '/torneos/rest/v1/rpc/is_tournament_organization_slug_available', method: 'POST', token: tok, body: { p_slug: `${RUN}-slug` } });
      await same('rpc: create org (validation error shape)', { path: '/torneos/rest/v1/rpc/create_tournament_organization', method: 'POST', token: tok, body: { p_name: 'x' } });
      const created = await same('rpc: create_tournament_organization', { path: '/torneos/rest/v1/rpc/create_tournament_organization', method: 'POST', token: tok, body: { p_name: `${RUN} League`, p_slug: `${RUN}-league` } });
      // Both gateways executed the same RPC: the second call is the conflict, so compare via GET reads instead of asserting 200 twice.
      rows.at(-1).note = 'first call creates (one gateway), second conflicts (the other): statuses may differ by order — compared below by state';
      rows.at(-1).equivalent = true;
      await same('read: tournament_organizations (RLS)', { path: '/torneos/rest/v1/tournament_organizations?select=slug', token: tok });
      await same('read: other user sees nothing', { path: '/torneos/rest/v1/tournament_organizations?select=slug', token: tokens.other });
      await same('read: torneos_identity own row only', { path: '/torneos/rest/v1/torneos_identity?select=core_user_id', token: tok });
      await same('read: anon-less table without bearer', { path: '/torneos/rest/v1/tournament_organizations?select=slug' }, { expect: [401, { error: 'access denied' }] });
      await same('rpc: invalid json on a Core-contract RPC', { path: '/torneos/rest/v1/rpc/search_tournament_players', method: 'POST', token: tok, body: '{not json' }, { expect: [400, { error: 'invalid json' }] });
      await same('rpc: array body on a Core-contract RPC', { path: '/torneos/rest/v1/rpc/search_tournament_players', method: 'POST', token: tok, body: [] }, { expect: [400, { error: 'invalid json' }] });
      await same('rpc: Core-contract RPC denied locally before Core (outsider org)', { path: '/torneos/rest/v1/rpc/search_tournament_players', method: 'POST', token: tokens.other, body: { p_organization_id: randomUUID(), p_tournament_id: randomUUID(), p_query: 'an', p_limit: 8 } });
      await same('rpc: body too large', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tok, body: JSON.stringify({ pad: 'x'.repeat(17000) }) }, { expect: [401, { error: 'access denied' }] });
      await same('rpc: unknown name', { path: '/torneos/rest/v1/rpc/this_does_not_exist', method: 'POST', token: tok, body: {} }, { expect: [403, { error: 'rpc not enabled' }] });
      let offChecked = 0;
      for (const name of offNames) {
        await same(`OFF POST ${name}`, { path: `/torneos/rest/v1/rpc/${name}`, method: 'POST', token: tok, body: {} }, { expect: [403, { error: 'rpc not enabled' }] });
        await same(`OFF GET ${name}`, { path: `/torneos/rest/v1/rpc/${name}`, token: tok }, { expect: [403, { error: 'rpc not enabled' }] });
        offChecked += 1;
      }
      assert.equal(offChecked, offNames.length);
      for (const name of ['lock_tournament_roster', 'create_tournament_points_adjustment', 'record_manual_match_availability', 'mark_tournament_suspension_served', 'transition_tournament_media_asset']) {
        assert.ok(offNames.includes(name), `${name} is gated`);
      }
      for (const name of ['auto_schedule_tournament_matches', 'update_draft_fixture', 'schedule_tournament_match', 'publish_tournament_fixture', 'review_tournament_match_operation']) {
        assert.ok(!offNames.includes(name), `${name} is re-enabled by COMPETITION-V1`);
      }
      assert.ok(ALLOWED.includes('review_tournament_team_entry') && !offNames.includes('review_tournament_team_entry'));
      await same('OFF without bearer → 401 before the allowlist', { path: '/torneos/rest/v1/rpc/lock_tournament_roster', method: 'POST', body: {} }, { expect: [401, { error: 'access denied' }] });
    });

    await check('bearer contract: forged/expired/wrong issuer/audience/kid/role/session/core_user_id denied identically', async () => {
      const claims = decodeJwt(tokens.ownerEdge);
      const cases = {
        'wrong session': { sub: claims.sub, core_user_id: claims.core_user_id, session_id: randomUUID() },
        'wrong core_user_id': { sub: claims.sub, core_user_id: randomUUID(), session_id: claims.session_id },
        'wrong sub': { sub: randomUUID(), core_user_id: claims.core_user_id, session_id: claims.session_id },
        'expired': { sub: claims.sub, core_user_id: claims.core_user_id, session_id: claims.session_id, iat: claims.iat - 400, exp: claims.iat - 280 },
        'wrong ttl': { sub: claims.sub, core_user_id: claims.core_user_id, session_id: claims.session_id, exp: claims.iat + 3600 },
        'wrong issuer': { sub: claims.sub, core_user_id: claims.core_user_id, session_id: claims.session_id, iss: 'urn:other' },
        'wrong audience': { sub: claims.sub, core_user_id: claims.core_user_id, session_id: claims.session_id, aud: 'other' },
        'service_role claim': { sub: claims.sub, core_user_id: claims.core_user_id, session_id: claims.session_id, role: 'service_role' },
      };
      for (const [name, payload] of Object.entries(cases)) {
        await same(`forged: ${name}`, { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: await forged(payload), body: {} }, { expect: [401, { error: 'access denied' }] });
      }
      await same('forged: untrusted kid', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: await forged({ sub: claims.sub, core_user_id: claims.core_user_id, session_id: claims.session_id }, 'p3a-k2'), body: {} }, { expect: [401, { error: 'access denied' }] });
      await same('forged: Core token used as Torneos bearer', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: owner.coreToken, body: {} }, { expect: [401, { error: 'access denied' }] });
    });

    await check('revocation: logout, SQL-revoked session, banned user, expired not_after — both gateways deny exchange and RPC', async () => {
      const v = await same('exchange: victim', { path: '/exchange', method: 'POST', token: victim.coreToken });
      const victimTok = v.edge.body.access_token;
      assert.equal((await send(BASE, { path: '/auth/v1/logout', method: 'POST', token: victim.coreToken })).status, 204);
      await same('after logout: exchange', { path: '/exchange', method: 'POST', token: victim.coreToken }, { expect: [401, { error: 'access denied' }] });
      await same('after logout: RPC with still-unexpired Torneos bearer', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: victimTok, body: {} }, { expect: [401, { error: 'access denied' }] });
      await same('after logout: OFF still 403 (allowlist before session)', { path: '/torneos/rest/v1/rpc/lock_tournament_roster', method: 'POST', token: victimTok, body: {} }, { expect: [403, { error: 'rpc not enabled' }] });
      // SQL revocation of a live session (other): the Node gateway reads auth.sessions, the Edge gateway asks Core's contract.
      const o = await same('exchange: other (pre-revocation)', { path: '/exchange', method: 'POST', token: other.coreToken });
      coreSql(`delete from auth.sessions where id='${other.sessionId}'`);
      await same('SQL-revoked session: RPC', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: o.edge.body.access_token, body: {} }, { expect: [401, { error: 'access denied' }] });
      await same('SQL-revoked session: exchange', { path: '/exchange', method: 'POST', token: other.coreToken }, { expect: [401, { error: 'access denied' }] });
      // Banned user
      const b = await same('exchange: banned (pre-ban)', { path: '/exchange', method: 'POST', token: banned.coreToken });
      coreSql(`update auth.users set banned_until = now() + interval '1 day' where id='${banned.coreUserId}'`);
      await same('banned: RPC', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: b.edge.body.access_token, body: {} }, { expect: [401, { error: 'access denied' }] });
      await same('banned: exchange', { path: '/exchange', method: 'POST', token: banned.coreToken }, { expect: [401, { error: 'access denied' }] });
      // not_after in the past on the owner's session (timebox): both deny; then restore.
      coreSql(`update auth.sessions set not_after = now() - interval '1 minute' where id='${owner.sessionId}'`);
      await same('expired not_after: RPC', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tokens.ownerEdge, body: {} }, { expect: [401, { error: 'access denied' }] });
      await same('expired not_after: exchange', { path: '/exchange', method: 'POST', token: owner.coreToken }, { expect: [401, { error: 'access denied' }] });
      coreSql(`update auth.sessions set not_after = null where id='${owner.sessionId}'`);
      await same('restored session: RPC', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tokens.ownerEdge, body: {} });
    });

    await check('outages: GoTrue down → 503 on both; Core contract down → D1 (Edge refuses every session-gated request, Node keeps its DB-to-DB verdict), pre-session refusals identical', async () => {
      setService('core-auth', 'stop');
      try {
        await same('GoTrue down: exchange', { path: '/exchange', method: 'POST', token: owner.coreToken }, { expect: [503, { error: 'access denied' }] });
        await same('GoTrue down: RPC', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tokens.ownerEdge, body: {} }, { expect: [503, { error: 'access denied' }] });
        await same('GoTrue down: health (connection refused → generic 503 on both)', { path: '/health' }, { expect: [503, { error: 'access denied' }] });
      } finally { setService('core-auth', 'start'); for (let i = 0; i < 60; i++) { if ((await send(BASE, { path: '/health' })).status === 200) break; await new Promise(r => setTimeout(r, 1000)); } }
      // D1 — the one difference, and why it is not a fail-closed regression. Both gateways demand an
      // online Core session verdict on every session-gated request (exchange and everything under
      // /torneos/rest/v1 past the bearer check and the allowlist); neither caches it (d1.test.mjs E4).
      // The Node gateway reads that verdict from auth.sessions DB-to-DB, so a Core contract outage
      // leaves its verdict transport up; the Edge gateway (Core only over HTTPS, no DB-to-DB) obtains
      // it from the contract `session` operation, so the contract endpoint IS its verdict transport.
      // When the Node gateway's own verdict transport is down (core-db) it refuses everything too
      // (d1.test.mjs E2). Serving these requests on the Edge gateway would need a cached/offline
      // verdict (revocation window), DB-to-DB, or a new Core surface / trust expansion → STOP.
      const D1 = {
        documented: 'D1',
        justification: 'Both gateways require an online Core session verdict per session-gated request; the Node gateway obtains it DB-to-DB (auth.sessions), the Edge gateway over HTTPS from the Core contract `session` op. With the contract endpoint down the Edge gateway has no authorized transport for the verdict and fails closed; the Node gateway keeps its DB transport. Not reproducible on the Edge gateway without DB-to-DB, a revocation window or a new Core surface.',
        counterpart: 'evidence/d1-session-authority.json (E2: Node refuses everything when core-db is down; E4: one verdict per Edge request, none cached)',
      };
      setService('core-functions', 'stop');
      try {
        const n = await send(BASE, { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tokens.ownerEdge, body: {} });
        const e = await send(EDGE_BASE, { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: tokens.ownerEdge, body: {} });
        assert.equal(n.status, 200, 'Node: Core-independent RPC keeps working (direct auth.sessions read)');
        assert.deepEqual([e.status, e.body], [503, { error: 'CORE_UNAVAILABLE' }], 'Edge: fails closed (session verdict needs the Core contract)');
        rows.push({ name: 'D1: Core contract outage, Core-independent RPC', equivalent: false, ...D1, node: { status: n.status }, edge: { status: e.status, body: e.body } });
        // Same D1 class: a Core-dependent RPC the Node gateway denies LOCALLY (403, before Core) is
        // refused by the Edge gateway at the session step (503), because its session verdict comes
        // from the Core contract endpoint that is down. Ordering on both: bearer → allowlist → session
        // verdict → identity → local authorization → Core. Nothing is written in either case.
        const dn = await send(BASE, { path: '/torneos/rest/v1/rpc/search_tournament_players', method: 'POST', token: tokens.ownerEdge, body: { p_organization_id: randomUUID(), p_tournament_id: randomUUID(), p_query: 'an', p_limit: 8 } });
        const de = await send(EDGE_BASE, { path: '/torneos/rest/v1/rpc/search_tournament_players', method: 'POST', token: tokens.ownerEdge, body: { p_organization_id: randomUUID(), p_tournament_id: randomUUID(), p_query: 'an', p_limit: 8 } });
        assert.deepEqual([dn.status, dn.body], [403, { error: 'TORNEOS_RESOURCE_FORBIDDEN' }]);
        assert.deepEqual([de.status, de.body], [503, { error: 'CORE_UNAVAILABLE' }]);
        rows.push({ name: 'D1: Core contract outage, Core-dependent RPC denied locally on Node', equivalent: false, ...D1, node: { status: dn.status, body: dn.body }, edge: { status: de.status, body: de.body } });
        // Same D1 class, completing it: the exchange needs the same verdict (Node: GoTrue /user +
        // auth.sessions; Edge: GoTrue /user + contract `session`).
        const xn = await send(BASE, { path: '/exchange', method: 'POST', token: owner.coreToken });
        const xe = await send(EDGE_BASE, { path: '/exchange', method: 'POST', token: owner.coreToken });
        assert.equal(xn.status, 200, 'Node: exchange keeps working (direct auth.sessions read)');
        assert.deepEqual([xe.status, xe.body], [503, { error: 'CORE_UNAVAILABLE' }], 'Edge: exchange fails closed without the session verdict');
        rows.push({ name: 'D1: Core contract outage, exchange', equivalent: false, ...D1, node: { status: xn.status, body: normalize(xn.body) }, edge: { status: xe.status, body: xe.body } });
        // Pre-session refusals are untouched by the outage on both gateways.
        await same('Core contract down: OFF rpc (allowlist before the session verdict)', { path: '/torneos/rest/v1/rpc/lock_tournament_roster', method: 'POST', token: tokens.ownerEdge, body: {} }, { expect: [403, { error: 'rpc not enabled' }] });
        await same('Core contract down: garbage bearer', { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', token: 'not-a-jwt', body: {} }, { expect: [401, { error: 'access denied' }] });
      } finally { setService('core-functions', 'start'); await waitCoreFunctions(); }
    });

    await check('secrets: neither gateway leaks secrets or session tokens in responses or logs', async () => {
      const secrets = [cfg.coreContractSecret, cfg.serviceRoleKey, cfg.coreSecret, cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.adapterPassword,
        ...cfg.keys.map(k => k.privateKey.split('\n').slice(1, 3).join('\n')), ...seenSecrets.filter(Boolean)];
      const logs = ['gateway', 'torneos-functions', 'core-functions', 'core-api'].map(s => dc(['logs', '--no-log-prefix', s], undefined, true)).join('\n');
      for (const secret of secrets) assert.ok(!logs.includes(secret), 'no secret or session token in gateway logs');
      const evidence = JSON.stringify(rows);
      for (const secret of secrets.filter(s => s !== cfg.anonKey)) assert.ok(!evidence.includes(secret), 'no secret in the equivalence evidence');
    });
  } finally {
    await mkdir('evidence', { recursive: true });
    const equivalent = rows.filter(r => r.equivalent).length;
    const documented = rows.filter(r => !r.equivalent).map(r => ({ name: r.name, documented: r.documented ?? null, justification: r.justification ?? null, counterpart: r.counterpart ?? null }));
    await writeFile('evidence/equivalence-results.json', JSON.stringify({ generated_at: new Date().toISOString(), node: BASE, edge: EDGE_BASE, run: RUN,
      compared: rows.length, equivalent, differences: documented, rows }, null, 2) + '\n');
  }
});
