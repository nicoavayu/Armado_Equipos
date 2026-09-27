// Phase 3B — D1 review. Question: is "Core contract endpoint down → 503 for EVERY Edge gateway
// request" a semantic regression against the certified Node gateway (which kept serving
// Core-independent traffic), or the Node gateway's DB-to-DB session transport showing through?
//
// Controlled counterpart experiments on the same lab, both gateways, same requests:
//   E1  what GoTrue /user alone guarantees — it is NOT the session authority the certified
//       gateway enforces (ban, not_after timebox, soft delete only live in the SQL verdict)
//   E2  Node's session-authority transport (core-db, reached DB-to-DB) down: the Node gateway
//       refuses every session-gated request too; nothing is served without the online verdict
//   E3  Edge's session-authority transport (core-functions, HTTPS) down: the D1 class, complete
//       (RPC, Core-dependent RPC denied locally on Node, and /exchange)
//   E4  no verdict is cached or reused: exactly one Core `session` verdict per Edge
//       session-gated request; the Node gateway never asks the contract for a session verdict
// Results: evidence/d1-session-authority.json. Nothing here changes either gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { config, dc, sql, inGateway, BASE, EDGE_BASE } from './lab.mjs';

const cfg = await config();
const RUN = 'd' + randomBytes(2).toString('hex');
const rows = [];
const seenSecrets = [];
let experiment = 'setup';

async function send(base, { path, method = 'GET', token, body, headers = {} }) {
  try {
    const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close',
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: r.status, body: parsed };
  } catch (error) {
    // A gateway that does not answer at all is recorded, never hidden behind a thrown error.
    return { status: 0, body: { transport: error?.cause?.code ?? error?.name ?? 'unreachable' } };
  }
}
function record(name, req, node, edge, extra = {}) {
  const strip = (r) => r?.body && typeof r.body === 'object' && typeof r.body.access_token === 'string'
    ? { status: r.status, body: { ...r.body, access_token: '<token>' } } : r;
  if (node?.body?.access_token) seenSecrets.push(node.body.access_token);
  if (edge?.body?.access_token) seenSecrets.push(edge.body.access_token);
  rows.push({ experiment, name, request: { path: req.path, method: req.method ?? 'GET', auth: req.token ? 'bearer' : 'none' }, node: strip(node), edge: strip(edge), ...extra });
}
async function both(name, req) {
  const [n, e] = await Promise.all([send(BASE, req), send(EDGE_BASE, req)]);
  record(name, req, n, e);
  return { n, e };
}
const coreSql = (q) => sql('core-db', q, 'postgres');
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
function sessionVerdicts() {
  const out = inGateway(`const r = await fetch('http://core-api:8000/_lab/counters'); console.log((await r.json()).session_verdicts);`);
  return Number(out.trim().split('\n').pop());
}
async function signup(label) {
  const email = `${RUN}-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const r = await send(BASE, { path: '/auth/v1/signup', method: 'POST', body: { email, password, data: { full_name: `${RUN} ${label}` } } });
  assert.equal(r.status, 200, `signup ${label}`);
  seenSecrets.push(r.body.access_token, r.body.refresh_token, password);
  return { label, coreToken: r.body.access_token, coreUserId: r.body.user.id, sessionId: decodeJwt(r.body.access_token).session_id };
}
/** Fresh 120 s Torneos bearer (Edge-minted; honoured by both gateways — cross-acceptance is certified). */
async function fresh(user) {
  const r = await send(EDGE_BASE, { path: '/exchange', method: 'POST', token: user.coreToken });
  assert.equal(r.status, 200, `exchange ${user.label}`);
  seenSecrets.push(r.body.access_token);
  return r.body.access_token;
}
/** Both gateways back to serving the Core-independent RPC (fresh bearer each try); fails loudly otherwise. */
async function waitServing(user) {
  for (let i = 0; i < 90; i++) {
    const ex = await send(EDGE_BASE, { path: '/exchange', method: 'POST', token: user.coreToken });
    if (ex.status === 200) {
      seenSecrets.push(ex.body.access_token);
      const [n, e] = await Promise.all([send(BASE, { ...RPC, token: ex.body.access_token }), send(EDGE_BASE, { ...RPC, token: ex.body.access_token })]);
      if (n.status === 200 && e.status === 200) return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('lab did not recover');
}
const RPC = { path: '/torneos/rest/v1/rpc/get_my_tournament_memberships', method: 'POST', body: {} };
const READ = { path: '/torneos/rest/v1/tournament_organizations?select=slug' };
// An RPC still OFF after COMPETITION-V1 (publish_tournament_fixture is re-enabled there).
const OFF = { path: '/torneos/rest/v1/rpc/lock_tournament_roster', method: 'POST', body: {} };
const coreDependentDeniedLocally = () => ({ path: '/torneos/rest/v1/rpc/search_tournament_players', method: 'POST', body: { p_organization_id: randomUUID(), p_tournament_id: randomUUID(), p_query: 'an', p_limit: 8 } });
const refused = (r) => r.status !== 200;

test('Phase 3B — D1 review: session authority, its transport, and what each gateway serves without it', async (t) => {
  const check = (name, fn) => t.test(name, fn);
  const summary = {};
  const user = await signup('user');
  const throwaway = await signup('throwaway');
  try {
    experiment = 'E1';
    await check('E1: GoTrue /user alone is not the session authority — ban, not_after timebox and soft delete pass it and are refused by BOTH gateways', async () => {
      const gotrue = async (label) => { const r = await send(BASE, { path: '/auth/v1/user', token: user.coreToken }); rows.push({ experiment, name: `gotrue /user: ${label}`, gotrue: r.status }); return r.status; };
      assert.equal(await gotrue('live session'), 200);
      const tok = await fresh(user);
      const enforced = {};
      coreSql(`update auth.sessions set not_after = now() - interval '1 minute' where id='${user.sessionId}'`);
      enforced.not_after = await gotrue('session not_after in the past');
      let r = await both('not_after in the past: RPC', { ...RPC, token: tok });
      assert.deepEqual([r.n.status, r.n.body, r.e.status, r.e.body], [401, { error: 'access denied' }, 401, { error: 'access denied' }]);
      coreSql(`update auth.sessions set not_after = null where id='${user.sessionId}'`);
      coreSql(`update auth.users set banned_until = now() + interval '1 day' where id='${user.coreUserId}'`);
      enforced.banned = await gotrue('user banned');
      r = await both('banned: RPC', { ...RPC, token: tok });
      assert.deepEqual([r.n.status, r.n.body, r.e.status, r.e.body], [401, { error: 'access denied' }, 401, { error: 'access denied' }]);
      coreSql(`update auth.users set banned_until = null where id='${user.coreUserId}'`);
      coreSql(`update auth.users set deleted_at = now() where id='${user.coreUserId}'`);
      enforced.deleted = await gotrue('user deleted_at set');
      r = await both('soft-deleted: RPC', { ...RPC, token: tok });
      assert.deepEqual([r.n.status, r.n.body, r.e.status, r.e.body], [401, { error: 'access denied' }, 401, { error: 'access denied' }]);
      coreSql(`update auth.users set deleted_at = null where id='${user.coreUserId}'`);
      assert.equal(await gotrue('restored'), 200);
      r = await both('restored: RPC', { ...RPC, token: tok });
      assert.deepEqual([r.n.status, r.e.status], [200, 200]);
      // Logout (session row gone) is the one class GoTrue refuses on its own.
      assert.equal((await send(BASE, { path: '/auth/v1/logout', method: 'POST', token: throwaway.coreToken })).status, 204);
      const afterLogout = (await send(BASE, { path: '/auth/v1/user', token: throwaway.coreToken })).status;
      rows.push({ experiment, name: 'gotrue /user: after logout (session deleted)', gotrue: afterLogout });
      assert.notEqual(afterLogout, 200);
      // GoTrue v2.194.0 answers 200 for all three: only the SQL verdict (Node: auth.sessions read;
      // Edge: contract `session` op) enforces them. A gateway that trusted GoTrue instead of that
      // verdict would silently drop these revocation classes.
      assert.deepEqual(enforced, { not_after: 200, banned: 200, deleted: 200 });
      summary.gotrue_user_alone_refuses = { not_after: false, banned: false, soft_deleted: false, logout: true };
    });

    experiment = 'E2';
    await check('E2: Node session-authority transport (core-db) down — the Node gateway refuses every session-gated request too (401 access denied; Edge 503 CORE_UNAVAILABLE); pre-session refusals unchanged', async () => {
      const tok = await fresh(user);
      setService('core-db', 'stop');
      let driverCode = null;
      try {
        // GoTrue's health endpoint does not touch its database: the health gate is not a session check.
        let r = await both('core-db down: /health', { path: '/health' });
        assert.deepEqual([r.n.status, r.e.status], [200, 200]);
        const gated = [];
        for (const [name, req] of [['Core-independent RPC', { ...RPC, token: tok }], ['table read', { ...READ, token: tok }], ['Core-dependent RPC denied locally when Core is up', { ...coreDependentDeniedLocally(), token: tok }]]) {
          r = await both(`core-db down: ${name}`, req);
          gated.push(r);
          assert.deepEqual([r.n.status, r.n.body], [401, { error: 'access denied' }], `Node refuses ${name}`);
          assert.deepEqual([r.e.status, r.e.body], [503, { error: 'CORE_UNAVAILABLE' }], `Edge refuses ${name}`);
        }
        r = await both('core-db down: exchange', { path: '/exchange', method: 'POST', token: user.coreToken });
        gated.push(r);
        assert.deepEqual([r.n.status, r.n.body, r.e.status, r.e.body], [401, { error: 'access denied' }, 401, { error: 'access denied' }], 'GoTrue /user fails without its database → both refuse the exchange');
        r = await both('core-db down: OFF rpc (allowlist before the session verdict)', { ...OFF, token: tok });
        assert.deepEqual([r.n.status, r.n.body, r.e.status, r.e.body], [403, { error: 'rpc not enabled' }, 403, { error: 'rpc not enabled' }]);
        assert.ok(gated.every(({ n, e }) => refused(n) && refused(e)), 'no session-gated request is served by either gateway without the online verdict');
        // Why the Node gateway answers 401 rather than its 503: the pg driver's failure to reach a
        // stopped container carries a code outside the certified gateway's list
        // (ECONNREFUSED / 57P01 / ETIMEDOUT). Recorded; the reference gateway is not modified.
        driverCode = inGateway(`import pg from 'pg';
          const c = new pg.Client({ host: 'core-db', database: 'postgres', user: 'poc_session_reader', password: 'x', connectionTimeoutMillis: 2000 });
          try { await c.connect(); console.log('connected'); } catch (e) { console.log(e.code ?? ('no-code: ' + e.message)); }`).trim().split('\n').pop();
        assert.notEqual(driverCode, 'connected');
        assert.ok(!['ECONNREFUSED', '57P01', 'ETIMEDOUT'].includes(driverCode), `driver code ${driverCode} is outside the Node gateway's 503 list (explains the 401)`);
      } finally {
        setService('core-db', 'start');
        await waitServing(user);
      }
      summary.node_serves_without_online_verdict = false;
      summary.edge_serves_without_online_verdict = false;
      summary.node_refusal_when_core_db_down = { status: 401, body: 'access denied', driver_code: driverCode, note: 'pre-existing mapping gap of the certified Node gateway: refusal preserved, status 401 instead of 503' };
      summary.edge_refusal_when_core_db_down = { status: 503, body: 'CORE_UNAVAILABLE' };
    });

    experiment = 'E3';
    await check('E3: Edge session-authority transport (core-functions) down — the D1 class in full: Node serves Core-independent traffic through its DB-to-DB verdict, Edge refuses everything session-gated', async () => {
      const tok = await fresh(user);
      setService('core-functions', 'stop');
      try {
        let r = await both('core-functions down: /health', { path: '/health' });
        assert.deepEqual([r.n.status, r.e.status], [200, 200]);
        r = await both('core-functions down: Core-independent RPC', { ...RPC, token: tok });
        assert.equal(r.n.status, 200, 'Node: verdict from auth.sessions (DB-to-DB), request served');
        assert.deepEqual([r.e.status, r.e.body], [503, { error: 'CORE_UNAVAILABLE' }], 'Edge: verdict transport down, fail closed');
        r = await both('core-functions down: Core-dependent RPC denied locally on Node', { ...coreDependentDeniedLocally(), token: tok });
        assert.deepEqual([r.n.status, r.n.body], [403, { error: 'TORNEOS_RESOURCE_FORBIDDEN' }]);
        assert.deepEqual([r.e.status, r.e.body], [503, { error: 'CORE_UNAVAILABLE' }]);
        r = await both('core-functions down: exchange', { path: '/exchange', method: 'POST', token: user.coreToken });
        assert.equal(r.n.status, 200, 'Node: GoTrue /user + auth.sessions, exchange served');
        assert.deepEqual([r.e.status, r.e.body], [503, { error: 'CORE_UNAVAILABLE' }], 'Edge: the exchange needs the same verdict');
        r = await both('core-functions down: OFF rpc (allowlist before the session verdict)', { ...OFF, token: tok });
        assert.deepEqual([r.n.status, r.n.body, r.e.status, r.e.body], [403, { error: 'rpc not enabled' }, 403, { error: 'rpc not enabled' }]);
      } finally {
        setService('core-functions', 'start');
        await waitCoreFunctions();
        await waitServing(user);
      }
      summary.d1_class = ['/exchange', 'every /torneos/rest/v1 request past the bearer check and the RPC allowlist'];
      summary.d1_root_cause = 'the session verdict itself: Node reads auth.sessions DB-to-DB (forbidden for the Edge gateway); Edge obtains it from the Core contract `session` operation over HTTPS, so the contract endpoint IS its session-authority transport';
    });

    experiment = 'E4';
    await check('E4: no cached or reused verdict — exactly one Core `session` verdict per Edge session-gated request; the Node gateway asks the contract for none', async () => {
      const tok = await fresh(user);
      const before = sessionVerdicts();
      for (let i = 0; i < 5; i++) assert.equal((await send(EDGE_BASE, { ...RPC, token: tok })).status, 200);
      assert.equal((await send(EDGE_BASE, { ...READ, token: tok })).status, 200);
      const ex = await send(EDGE_BASE, { path: '/exchange', method: 'POST', token: user.coreToken });
      assert.equal(ex.status, 200); seenSecrets.push(ex.body.access_token);
      const afterEdge = sessionVerdicts();
      assert.equal(afterEdge - before, 7, 'one verdict per Edge request (5 RPC + 1 read + 1 exchange), none reused');
      for (let i = 0; i < 5; i++) assert.equal((await send(BASE, { ...RPC, token: tok })).status, 200);
      assert.equal((await send(BASE, { path: '/exchange', method: 'POST', token: user.coreToken })).status, 200);
      assert.equal(sessionVerdicts() - afterEdge, 0, 'the Node gateway never uses the contract for its session verdict (DB-to-DB read)');
      rows.push({ experiment, name: 'session verdicts consumed at Core', edge_requests: 7, edge_verdicts: afterEdge - before, node_requests: 6, node_verdicts: 0 });
      summary.edge_session_verdicts_per_gated_request = 1;
      summary.node_session_verdicts_via_contract = 0;
    });

    experiment = 'secrets';
    await check('secrets: no secret or session token in gateway logs or in this evidence', async () => {
      const secrets = [cfg.coreContractSecret, cfg.serviceRoleKey, cfg.coreSecret, cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.adapterPassword,
        ...cfg.keys.map(k => k.privateKey.split('\n').slice(1, 3).join('\n')), ...seenSecrets.filter(Boolean)];
      const logs = ['gateway', 'torneos-functions', 'core-functions', 'core-api'].map(s => dc(['logs', '--no-log-prefix', s], undefined, true)).join('\n');
      for (const secret of secrets) assert.ok(!logs.includes(secret), 'no secret or session token in gateway logs');
      const evidence = JSON.stringify(rows) + JSON.stringify(summary);
      for (const secret of secrets.filter(s => s !== cfg.anonKey)) assert.ok(!evidence.includes(secret), 'no secret in the D1 evidence');
    });
  } finally {
    await mkdir('evidence', { recursive: true });
    await writeFile('evidence/d1-session-authority.json', JSON.stringify({
      generated_at: new Date().toISOString(), node: BASE, edge: EDGE_BASE, run: RUN,
      conclusion: 'D1 is not a fail-closed regression: neither gateway serves a session-gated request without an online Core session verdict. The difference is the identity of the verdict transport (Node: auth.sessions DB-to-DB; Edge: Core contract `session` over HTTPS). Preserving the Node behaviour on the Edge gateway requires DB-to-DB, a revocation window, or a new Core surface / trust expansion — STOP, decision for the operator.',
      summary, rows,
    }, null, 2) + '\n');
  }
});
