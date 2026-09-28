// T8–T12, T14: the gateway transport against the certified contract shapes.
// Every test runs the REAL src/features/torneos/foundation modules with a fake
// fetch; nothing here touches the network or a Supabase client.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';

const FIX = JSON.parse(read('scripts/torneos-frontend/fixtures/gateway-contract.json'));
const GATEWAY = 'https://gateway.example.test/torneos-gateway';
const prefix = 'src/features/torneos/foundation/';

// Objects built inside the sandbox realm have another Object.prototype: compare
// by value, not by prototype identity.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

function response({ status, body, headers = {} }) {
  const all = { ...FIX.headers, ...headers };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => all[name.toLowerCase()] ?? null, has: (name) => name.toLowerCase() in all },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// A scripted gateway: each call pops the next scripted reply for its route.
function fakeGateway(script) {
  const calls = [];
  const queue = { exchange: [...(script.exchange || [])], rest: [...(script.rest || [])] };
  const fetchImpl = async (url, init = {}) => {
    const route = url.endsWith('/exchange') ? 'exchange' : 'rest';
    calls.push({ url, method: init.method, headers: init.headers, body: init.body, init });
    const next = queue[route].shift();
    if (!next) throw new Error(`unscripted ${route} call`);
    if (next.reject) throw new Error(next.reject);
    if (typeof next.hang === 'number') {
      // A real fetch rejects when the caller's signal aborts (the transport timeout).
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, next.hang);
        init.signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
      });
    }
    return response(next);
  };
  return { fetchImpl, calls };
}

function harness({ script, coreToken = 'core-token-a', now = 1_000_000, timeoutMs = 10_000 } = {}) {
  const rt = runtime();
  const { createTorneosTransport } = rt.load(prefix + 'torneosTransport.js');
  const gateway = fakeGateway(script);
  let listener = null;
  let clock = now;
  const state = { coreToken, sessionReads: 0, unsubscribed: 0 };
  const transport = createTorneosTransport({
    gatewayUrl: GATEWAY,
    getCoreAccessToken: async () => { state.sessionReads += 1; return state.coreToken; },
    onCoreAuthChange: (cb) => { listener = cb; return () => { state.unsubscribed += 1; }; },
    fetchImpl: gateway.fetchImpl,
    now: () => clock,
    requestTimeoutMs: timeoutMs,
  });
  return {
    rt, transport, gateway, state,
    event: (name) => listener(name),
    tick: (ms) => { clock += ms; },
    exchanges: () => gateway.calls.filter((c) => c.url.endsWith('/exchange')),
    rpcs: () => gateway.calls.filter((c) => !c.url.endsWith('/exchange')),
  };
}

test('exchange happens once per Core token, is reused under the TTL and never leaves the gateway origin', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.rpc.ok, FIX.rpc.ok, FIX.rpc.ok] } });
  const [a, b, c] = await Promise.all([
    h.transport.rpc('get_tournament_workspace_context', {}),
    h.transport.rpc('get_tournament_workspace_context', {}),
    h.transport.rpc('get_tournament_workspace_context', {}),
  ]);
  same(a, FIX.rpc.ok.body); same(b, FIX.rpc.ok.body); same(c, FIX.rpc.ok.body);
  assert.equal(h.exchanges().length, 1, 'concurrent requests coalesce into one exchange');
  const exchange = h.exchanges()[0];
  assert.equal(exchange.method, 'POST');
  assert.equal(exchange.headers.Authorization, 'Bearer core-token-a');
  assert.equal(exchange.body, undefined, 'exchange carries no body');
  assert.equal(exchange.init.credentials, 'omit'); assert.equal(exchange.init.cache, 'no-store'); assert.equal(exchange.init.redirect, 'error');
  for (const call of h.rpcs()) {
    assert.equal(call.url, `${GATEWAY}/torneos/rest/v1/rpc/get_tournament_workspace_context`);
    assert.equal(call.headers.Authorization, `Bearer ${FIX.exchange.ok.body.access_token}`);
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.body, '{}');
    assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.redirect, 'error');
  }
  assert.equal(h.rt.networkCalls(), 0, 'the sandbox global fetch is never used');
  assert.equal(h.rt.creations.length, 0, 'no Supabase client is created');
});

test('bearer renews silently through a new exchange before its TTL and after a Core token refresh', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok, FIX.exchange.okRenewed, FIX.exchange.ok], rest: [FIX.rpc.ok, FIX.rpc.ok, FIX.rpc.ok] } });
  await h.transport.rpc('get_tournament_workspace_context', {});
  h.tick(101_000); // 120 s TTL − 20 s margin crossed
  await h.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(h.exchanges().length, 2);
  assert.equal(h.rpcs()[1].headers.Authorization, `Bearer ${FIX.exchange.okRenewed.body.access_token}`);
  h.event('TOKEN_REFRESHED');
  h.state.coreToken = 'core-token-b';
  await h.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(h.exchanges().length, 3);
  assert.equal(h.exchanges()[2].headers.Authorization, 'Bearer core-token-b');
});

test('T8 — 401 on an RPC: one silent re-exchange and retry; a second 401 surfaces TORNEOS_SESSION_INVALID without more network', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok, FIX.exchange.okRenewed], rest: [FIX.rpc.bearerInvalid, FIX.rpc.ok] } });
  const data = await h.transport.rpc('get_tournament_workspace_context', {});
  same(data, FIX.rpc.ok.body);
  assert.equal(h.exchanges().length, 2); assert.equal(h.rpcs().length, 2);
  assert.equal(h.rpcs()[1].headers.Authorization, `Bearer ${FIX.exchange.okRenewed.body.access_token}`);

  const again = harness({ script: { exchange: [FIX.exchange.ok, FIX.exchange.okRenewed], rest: [FIX.rpc.bearerInvalid, FIX.rpc.bearerInvalid] } });
  await assert.rejects(again.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_SESSION_INVALID', status: 401 });
  assert.equal(again.exchanges().length, 2); assert.equal(again.rpcs().length, 2);
});

test('T8 — logged-out Core session: the retry exchange is refused (401) and surfaces as TORNEOS_EXCHANGE_DENIED', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok, FIX.exchange.denied], rest: [FIX.rpc.bearerInvalid] } });
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_EXCHANGE_DENIED', status: 401 });
  assert.equal(h.rpcs().length, 1);
});

test('T9 — 403 rpc not enabled → TORNEOS_FORBIDDEN with no retry and no new exchange; adapter TORNEOS_* refusals keep their code', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.rpc.notEnabled, FIX.rpc.adapterForbidden, FIX.rpc.searchRateLimited, FIX.rpc.coreDenied, FIX.rpc.adapterInvalidJson] } });
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_FORBIDDEN', status: 403, gatewayError: 'rpc not enabled' });
  assert.equal(h.exchanges().length, 1); assert.equal(h.rpcs().length, 1);
  await assert.rejects(h.transport.rpc('create_tournament_season', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.rpcError.code === 'TORNEOS_RESOURCE_FORBIDDEN' && error.status === 403);
  await assert.rejects(h.transport.rpc('search_tournament_players', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.rpcError.message === 'TORNEOS_SEARCH_RATE_LIMITED' && error.status === 429);
  await assert.rejects(h.transport.rpc('create_tournament_team_entry', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.rpcError.code === 'CORE_DENIED' && error.status === 404);
  await assert.rejects(h.transport.rpc('search_tournament_players', {}), { code: 'TORNEOS_INVALID_REQUEST', status: 400 });
  assert.equal(h.exchanges().length, 1, 'functional refusals never trigger a re-exchange');
});

test('T14 — PostgREST passthrough keeps { message, code, details, hint } intact for the legacy code lookup', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.rpc.postgrestRaise, FIX.rpc.postgrestRaiseWithDetails, FIX.rpc.postgrestPermission, FIX.rpc.postgrestMissingFunction] } });
  await assert.rejects(h.transport.rpc('create_tournament_organization', {}), (error) => {
    assert.equal(error.code, 'TORNEOS_RPC_ERROR');
    same(error.rpcError, { message: 'TORNEOS_SLUG_TAKEN', code: 'P0001', details: null, hint: null });
    return true;
  });
  await assert.rejects(h.transport.rpc('change_tournament_status', {}), (error) => error.rpcError.details === '{"pendingCount":2}');
  await assert.rejects(h.transport.rpc('create_tournament_season', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.rpcError.code === '42501' && error.status === 403);
  await assert.rejects(h.transport.rpc('create_tournament_season', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.rpcError.code === 'PGRST202');
});

test('T10 — CORE_UNAVAILABLE on exchange and on RPC surfaces as CORE_UNAVAILABLE, no loop, no fallback', async () => {
  const onExchange = harness({ script: { exchange: [FIX.exchange.coreContractDown] } });
  await assert.rejects(onExchange.transport.rpc('get_tournament_workspace_context', {}), { code: 'CORE_UNAVAILABLE', status: 503 });
  assert.equal(onExchange.exchanges().length, 1); assert.equal(onExchange.rpcs().length, 0);

  const onRpc = harness({ script: { exchange: [FIX.exchange.ok, FIX.exchange.ok], rest: [FIX.rpc.coreContractDown, FIX.rpc.ok] } });
  await assert.rejects(onRpc.transport.rpc('search_tournament_players', {}), { code: 'CORE_UNAVAILABLE', status: 503 });
  assert.equal(onRpc.rpcs().length, 1, 'no automatic retry on 503');
  // the bearer cache was dropped: the next request re-exchanges and recovers on attempt 1
  await onRpc.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(onRpc.exchanges().length, 2);
});

test('T11 — generic 503 access denied, adapter TORNEOS_UNAVAILABLE, network failure and timeout all surface as TORNEOS_UNAVAILABLE and drop the bearer', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok, FIX.exchange.ok, FIX.exchange.ok, FIX.exchange.ok, FIX.exchange.ok], rest: [FIX.rpc.torneosDown, FIX.rpc.adapterUnavailable, { reject: 'ECONNRESET' }, { hang: 200, ...FIX.rpc.ok }, FIX.rpc.ok] }, timeoutMs: 50 });
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_UNAVAILABLE', status: 503, gatewayError: 'access denied' });
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_UNAVAILABLE', status: 503, gatewayError: 'TORNEOS_UNAVAILABLE' });
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_UNAVAILABLE' });
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_UNAVAILABLE' });
  await h.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(h.exchanges().length, 5, 'each unavailable answer discards the bearer and the next request re-exchanges');
  const coreDown = harness({ script: { exchange: [FIX.exchange.coreDown] } });
  await assert.rejects(coreDown.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_UNAVAILABLE', status: 503 });
});

test('T12 — logout / user change: no Core session → CORE_AUTH_REQUIRED without network; late exchange responses of a previous generation are discarded', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.rpc.ok] } });
  await h.transport.rpc('get_tournament_workspace_context', {});
  h.event('SIGNED_OUT');
  h.state.coreToken = null;
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'CORE_AUTH_REQUIRED' });
  assert.equal(h.exchanges().length, 1); assert.equal(h.rpcs().length, 1);

  // A slow exchange for user A resolves after the session switched to user B: its
  // bearer is never cached and the caller learns the session changed.
  let release;
  const slow = harness({ script: { exchange: [{ hang: 0 }, FIX.exchange.okRenewed], rest: [FIX.rpc.ok] } });
  slow.gateway.fetchImpl = null; // replaced below by a controllable fetch
  const rt = runtime();
  const { createTorneosTransport } = rt.load(prefix + 'torneosTransport.js');
  let listener;
  let token = 'core-token-a';
  const calls = [];
  const transport = createTorneosTransport({
    gatewayUrl: GATEWAY,
    getCoreAccessToken: async () => token,
    onCoreAuthChange: (cb) => { listener = cb; return () => {}; },
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) return new Promise((resolve) => { release = () => resolve(response(FIX.exchange.ok)); });
      if (url.endsWith('/exchange')) return response(FIX.exchange.okRenewed);
      return response(FIX.rpc.ok);
    },
    now: () => 1_000_000,
  });
  const first = transport.rpc('get_tournament_workspace_context', {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  listener('SIGNED_IN');
  token = 'core-token-b';
  release();
  await assert.rejects(first, { code: 'CORE_AUTH_REQUIRED' });
  await transport.rpc('get_tournament_workspace_context', {});
  const exchanges = calls.filter((c) => c.url.endsWith('/exchange'));
  assert.equal(exchanges.length, 2);
  assert.equal(exchanges[1].init.headers.Authorization, 'Bearer core-token-b');
  const rpc = calls.find((c) => !c.url.endsWith('/exchange'));
  assert.equal(rpc.init.headers.Authorization, `Bearer ${FIX.exchange.okRenewed.body.access_token}`, 'the stale bearer of user A never reaches an RPC');
  void slow;
});

test('dispose unsubscribes from Core auth and closes the transport; the bearer is never persisted or decoded', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.rpc.ok] } });
  await h.transport.rpc('get_tournament_workspace_context', {});
  h.transport.dispose();
  assert.equal(h.state.unsubscribed, 1);
  assert.equal(h.transport.status, 'disposed');
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_TRANSPORT_DISPOSED' });
  const source = read(prefix + 'torneosTransport.js');
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'atob(', 'decodeJwt', 'jwtDecode', 'split(\'.\')']) {
    assert.ok(!source.includes(forbidden), `transport must not use ${forbidden}`);
  }
});

test('exchange contract: malformed 200, 400 and 403 answers fail closed; the caller signal aborts without touching the cache semantics', async () => {
  const malformed = harness({ script: { exchange: [FIX.exchange.malformed] } });
  await assert.rejects(malformed.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_UNAVAILABLE' });
  const bad = harness({ script: { exchange: [FIX.exchange.badBody] } });
  await assert.rejects(bad.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_INVALID_REQUEST', status: 400 });
  const origin = harness({ script: { exchange: [FIX.exchange.originRejected] } });
  await assert.rejects(origin.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_FORBIDDEN', status: 403 });
});

test('table route: GET with the bridge bearer, query allowlisted by key, rows returned as an array', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.table.members, FIX.table.outsider] } });
  const rows = await h.transport.select('tournament_organization_members', { select: 'id,user_id,role', organization_id: 'eq.33333333-3333-4333-8333-333333333333', order: 'joined_at.asc' });
  same(rows, FIX.table.members.body);
  const call = h.rpcs()[0];
  assert.equal(call.method, 'GET');
  assert.equal(call.url, `${GATEWAY}/torneos/rest/v1/tournament_organization_members?select=id%2Cuser_id%2Crole&organization_id=eq.33333333-3333-4333-8333-333333333333&order=joined_at.asc`);
  assert.equal(call.body, undefined);
  same(await h.transport.select('tournament_organization_members', {}), []);
  await assert.rejects(h.transport.select('tournament_organization_members', { 'or': '(x)' , 'bad key': 'x' }), { code: 'TORNEOS_INVALID_REQUEST' });
  await assert.rejects(h.transport.rpc('../rpc/x', {}), { code: 'TORNEOS_INVALID_REQUEST' });
  await assert.rejects(h.transport.rpc('get_tournament_workspace_context', []), { code: 'TORNEOS_INVALID_REQUEST' });
});

test('transport refuses to exist without a gateway URL or a Core session reader', () => {
  const { createTorneosTransport } = runtime().load(prefix + 'torneosTransport.js');
  assert.throws(() => createTorneosTransport({ gatewayUrl: '', getCoreAccessToken: async () => 'x' }), { code: 'TORNEOS_TRANSPORT_NOT_CONNECTED' });
  assert.throws(() => createTorneosTransport({ gatewayUrl: GATEWAY }), { code: 'TORNEOS_TRANSPORT_NOT_CONNECTED' });
});

// ERROR-CONTRACT-V1: expected domain errors are not an outage.
test('T15 — domain 409 / 422 / 429 (PTxyz) surface as TORNEOS_RPC_ERROR with rpcError intact; the bearer is kept; no retry', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.rpc.domainConflict, FIX.rpc.domainLimit, FIX.rpc.domainRateLimited, FIX.rpc.ok] } });
  await assert.rejects(h.transport.rpc('publish_tournament_fixture', {}), (error) => {
    assert.equal(error.code, 'TORNEOS_RPC_ERROR'); assert.equal(error.status, 409);
    same(error.rpcError, FIX.rpc.domainConflict.body);
    return true;
  });
  await assert.rejects(h.transport.rpc('set_tournament_announcement_link', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.status === 422 && error.rpcError.message === 'TORNEOS_LINK_LIMIT_REACHED');
  await assert.rejects(h.transport.rpc('publish_tournament_announcement', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.status === 429 && error.rpcError.code === 'PT429');
  await h.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(h.exchanges().length, 1, 'one exchange: the bearer survived three domain errors');
  assert.equal(h.rpcs().length, 4, 'each domain error was answered once (no retry)');
  for (const call of h.rpcs()) assert.equal(call.headers.Authorization, `Bearer ${FIX.exchange.ok.body.access_token}`);
});

test('T16 — a structured Torneos 500 (legacy SQLSTATE before 0006, or an invariant) keeps the bearer and surfaces rpcError, not TORNEOS_UNAVAILABLE', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok], rest: [FIX.rpc.legacyDomain500, FIX.rpc.invariant500, FIX.rpc.ok] } });
  await assert.rejects(h.transport.rpc('resolve_tournament_qualification', {}), (error) => {
    assert.equal(error.code, 'TORNEOS_RPC_ERROR'); assert.equal(error.status, 500);
    same(error.rpcError, FIX.rpc.legacyDomain500.body);
    return true;
  });
  await assert.rejects(h.transport.rpc('make_tournament_match_official', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.rpcError.message === 'TORNEOS_MATCH_REVIEW_OPEN');
  await h.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(h.exchanges().length, 1, 'the bearer was not dropped');
  assert.equal(h.rpcs().length, 3);
});

test('T17 — genuine failures stay fail-closed: unstructured 500, prefixed message, gateway 500, 502, 503 with a domain body and a timeout → TORNEOS_UNAVAILABLE and the bearer is dropped', async () => {
  const failures = [FIX.rpc.unstructured500, FIX.rpc.prefixed500, FIX.rpc.gateway500, FIX.rpc.badGateway, FIX.rpc.domainIn503, { hang: 200, ...FIX.rpc.ok }];
  const h = harness({ script: { exchange: failures.map(() => FIX.exchange.ok).concat([FIX.exchange.ok]), rest: [...failures, FIX.rpc.ok] }, timeoutMs: 50 });
  for (const failure of failures) {
    await assert.rejects(h.transport.rpc('rebuild_tournament_standings', {}), (error) => {
      assert.equal(error.code, 'TORNEOS_UNAVAILABLE', JSON.stringify(failure.body));
      assert.equal(error.rpcError, null);
      return true;
    });
  }
  await h.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(h.exchanges().length, failures.length + 1, 'every genuine failure discarded the bearer; the next call re-exchanged');
  assert.equal(h.rpcs().length, failures.length + 1, 'no automatic retry');
});

test('T18 — 401 and 403 keep their contract next to the domain statuses: one silent re-exchange on 401, none on 403 or 409', async () => {
  const h = harness({ script: { exchange: [FIX.exchange.ok, FIX.exchange.okRenewed], rest: [FIX.rpc.bearerInvalid, FIX.rpc.domainConflict, FIX.rpc.notEnabled, FIX.rpc.postgrestPermission] } });
  await assert.rejects(h.transport.rpc('publish_tournament_fixture', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.status === 409);
  assert.equal(h.exchanges().length, 2, '401 → exactly one re-exchange, then the 409 is final');
  await assert.rejects(h.transport.rpc('lock_tournament_roster', {}), { code: 'TORNEOS_FORBIDDEN', status: 403 });
  await assert.rejects(h.transport.rpc('create_tournament_venue', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.status === 403 && error.rpcError.code === '42501');
  assert.equal(h.exchanges().length, 2); assert.equal(h.rpcs().length, 4);
});
