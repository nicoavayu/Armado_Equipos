// POST-SMOKE HARDENING — the Core session refresh race (Production UI smoke 2026-09-28).
//
// Root cause: supabase-js re-announces a VALID session while a Torneos action is in flight —
// TOKEN_REFRESHED from the auto-refresh ticker, and SIGNED_IN with the very same session on every
// hidden→visible tab transition (_recoverAndRefresh). The transport dropped its cache on either
// (correct) but also treated the in-flight exchange's answer as a change of identity and rejected
// the action with CORE_AUTH_REQUIRED → "Volvé a iniciar sesión", while the session was fine.
//
// Contract pinned here: a renewal of the SAME Core identity discards the answer bound to the
// superseded Core token and re-derives the bearer ONCE from Core's current session (Core stays
// the authority: no session → CORE_AUTH_REQUIRED). An identity boundary (sign-out, another user,
// or an event the bridge cannot attribute) keeps failing closed. Real 401/403/domain/503 keep
// their semantics. Every test runs the REAL modules with a controllable fake fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';

const FIX = JSON.parse(read('scripts/torneos-frontend/fixtures/gateway-contract.json'));
const GATEWAY = 'https://gateway.example.test/torneos-gateway';
const RENEWAL = Object.freeze({ sameIdentity: true });
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function response({ status, body }) {
  const all = { ...FIX.headers };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => all[name.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// Each gateway call either answers from its route's script or, for `{ hold: true }`, waits
// until the test releases it: that is the window in which Core refreshes the session.
function controlled({ exchange = [], rest = [], coreToken = 'core-token-a' } = {}) {
  const rt = runtime();
  const { createTorneosTransport } = rt.load('src/features/torneos/foundation/torneosTransport.js');
  const queue = { exchange: [...exchange], rest: [...rest] };
  const calls = [];
  const held = [];
  const state = { coreToken };
  let listener = null;
  const transport = createTorneosTransport({
    gatewayUrl: GATEWAY,
    getCoreAccessToken: async () => state.coreToken,
    onCoreAuthChange: (cb) => { listener = cb; return () => {}; },
    fetchImpl: async (url, init = {}) => {
      const route = url.endsWith('/exchange') ? 'exchange' : 'rest';
      calls.push({ route, url, headers: init.headers });
      const next = queue[route].shift();
      if (!next) throw new Error(`unscripted ${route} call`);
      if (next.hold) {
        return new Promise((resolve) => { held.push(() => resolve(response(next.reply))); });
      }
      return response(next);
    },
    now: () => 1_000_000,
  });
  return {
    transport,
    state,
    event: (name, detail) => listener(name, detail),
    release: () => held.shift()(),
    exchanges: () => calls.filter((c) => c.route === 'exchange'),
    rpcs: () => calls.filter((c) => c.route === 'rest'),
  };
}

const hold = (reply) => ({ hold: true, reply });
const bearerOf = (fixture) => `Bearer ${fixture.body.access_token}`;

test('RACE-1 — TOKEN_REFRESHED during the exchange: the action completes with a bearer derived from the NEW Core token; the superseded answer is never used', async () => {
  const h = controlled({ exchange: [hold(FIX.exchange.ok), FIX.exchange.okRenewed], rest: [FIX.rpc.ok] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.state.coreToken = 'core-token-b';
  h.release();
  assert.deepEqual(JSON.parse(JSON.stringify(await action)), FIX.rpc.ok.body);
  assert.equal(h.exchanges().length, 2);
  assert.equal(h.exchanges()[0].headers.Authorization, 'Bearer core-token-a');
  assert.equal(h.exchanges()[1].headers.Authorization, 'Bearer core-token-b');
  assert.equal(h.rpcs().length, 1);
  assert.equal(h.rpcs()[0].headers.Authorization, bearerOf(FIX.exchange.okRenewed), 'the bearer bound to the superseded Core token never reaches an RPC');
});

test('RACE-2 — SIGNED_IN re-announcing the same session (tab becomes visible) during the exchange: no false logout', async () => {
  const h = controlled({ exchange: [hold(FIX.exchange.ok), FIX.exchange.okRenewed], rest: [FIX.rpc.ok] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('SIGNED_IN', RENEWAL); // same user, same access token
  h.release();
  await action;
  assert.equal(h.exchanges().length, 2, 'the answer of the discarded generation is re-derived exactly once');
  assert.equal(h.exchanges()[1].headers.Authorization, 'Bearer core-token-a');
  assert.equal(h.rpcs()[0].headers.Authorization, bearerOf(FIX.exchange.okRenewed));
});

test('RACE-3 — concurrent actions caught by one renewal share ONE re-exchange', async () => {
  const h = controlled({ exchange: [hold(FIX.exchange.ok), FIX.exchange.okRenewed], rest: [FIX.rpc.ok, FIX.rpc.ok, FIX.rpc.ok] });
  const actions = [1, 2, 3].map(() => h.transport.rpc('get_tournament_workspace_context', {}));
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.state.coreToken = 'core-token-b';
  h.release();
  await Promise.all(actions);
  assert.equal(h.exchanges().length, 2);
  assert.equal(h.rpcs().length, 3);
  assert(h.rpcs().every((c) => c.headers.Authorization === bearerOf(FIX.exchange.okRenewed)));
});

test('RACE-4 — Core remains the authority: a renewal after which Core has no session fails closed with CORE_AUTH_REQUIRED and no re-exchange', async () => {
  const h = controlled({ exchange: [hold(FIX.exchange.ok)], rest: [] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.state.coreToken = null; // the refresh left no usable session (expired / revoked)
  h.release();
  await assert.rejects(action, { code: 'CORE_AUTH_REQUIRED' });
  assert.equal(h.exchanges().length, 1); assert.equal(h.rpcs().length, 0);
});

test('RACE-5 — bounded: a second renewal during the re-exchange is not chased; CORE_AUTH_REQUIRED, no RPC', async () => {
  const h = controlled({ exchange: [hold(FIX.exchange.ok), hold(FIX.exchange.okRenewed)], rest: [] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.release();
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.release();
  await assert.rejects(action, { code: 'CORE_AUTH_REQUIRED' });
  assert.equal(h.exchanges().length, 2); assert.equal(h.rpcs().length, 0);
});

test('RACE-6 — identity boundaries keep failing closed mid-exchange: SIGNED_OUT, another user, USER_UPDATED, and a renewal the bridge cannot attribute', async () => {
  for (const [name, detail] of [
    ['SIGNED_OUT', undefined],
    ['SIGNED_IN', { sameIdentity: false }],
    ['SIGNED_IN', undefined],
    ['TOKEN_REFRESHED', undefined],
    ['USER_UPDATED', RENEWAL],
  ]) {
    const h = controlled({ exchange: [hold(FIX.exchange.ok)], rest: [] });
    const action = h.transport.rpc('get_tournament_workspace_context', {});
    await flush();
    h.event(name, detail);
    h.state.coreToken = 'core-token-b';
    h.release();
    await assert.rejects(action, { code: 'CORE_AUTH_REQUIRED' }, `${name} ${JSON.stringify(detail)}`);
    assert.equal(h.exchanges().length, 1, name); assert.equal(h.rpcs().length, 0, name);
  }
});

test('RACE-7 — a renewal followed by an identity change before the re-derived bearer is used: the action never runs as the new identity', async () => {
  const h = controlled({ exchange: [hold(FIX.exchange.ok), hold(FIX.exchange.okRenewed)], rest: [] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.release();
  await flush();
  h.event('SIGNED_OUT');
  h.event('SIGNED_IN', { sameIdentity: false });
  h.state.coreToken = 'core-token-user-b';
  h.release();
  await assert.rejects(action, { code: 'CORE_AUTH_REQUIRED' });
  assert.equal(h.rpcs().length, 0);
});

test('RACE-8 — after a renewal the gateway contract is unchanged: real 401 → one re-exchange then TORNEOS_SESSION_INVALID; 403 no retry; domain 409 keeps the bearer; 503 drops it', async () => {
  const h = controlled({
    exchange: [hold(FIX.exchange.ok), FIX.exchange.okRenewed, FIX.exchange.ok],
    rest: [FIX.rpc.bearerInvalid, FIX.rpc.bearerInvalid],
  });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.release();
  await assert.rejects(action, { code: 'TORNEOS_SESSION_INVALID', status: 401 });
  assert.equal(h.exchanges().length, 3, 'renewal re-derive + exactly one silent 401 renewal');
  assert.equal(h.rpcs().length, 2);

  const d = controlled({
    exchange: [hold(FIX.exchange.ok), FIX.exchange.okRenewed, FIX.exchange.ok],
    rest: [FIX.rpc.notEnabled, FIX.rpc.domainConflict, FIX.rpc.ok, FIX.rpc.torneosDown, FIX.rpc.ok],
  });
  const forbidden = d.transport.rpc('lock_tournament_roster', {});
  await flush();
  d.event('SIGNED_IN', RENEWAL);
  d.release();
  await assert.rejects(forbidden, { code: 'TORNEOS_FORBIDDEN', status: 403 });
  assert.equal(d.rpcs().length, 1, '403: no retry');
  await assert.rejects(d.transport.rpc('publish_tournament_fixture', {}), (error) => error.code === 'TORNEOS_RPC_ERROR' && error.status === 409);
  await d.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(d.exchanges().length, 2, 'domain 4xx preserved the bearer');
  await assert.rejects(d.transport.rpc('get_tournament_workspace_context', {}), { code: 'TORNEOS_UNAVAILABLE', status: 503 });
  await d.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(d.exchanges().length, 3, '503 dropped the bearer; the next action re-exchanged');
});

test('RACE-9 — a renewal re-exchange refused by the gateway (401) stays a real denial: TORNEOS_EXCHANGE_DENIED, no loop', async () => {
  const h = controlled({ exchange: [hold(FIX.exchange.ok), FIX.exchange.denied], rest: [] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.release();
  await assert.rejects(action, { code: 'TORNEOS_EXCHANGE_DENIED', status: 401 });
  assert.equal(h.exchanges().length, 2); assert.equal(h.rpcs().length, 0);
});

test('RACE-10 — a renewal while the RPC itself is in flight does not disturb the action; the next action re-exchanges', async () => {
  const h = controlled({ exchange: [FIX.exchange.ok, FIX.exchange.okRenewed], rest: [hold(FIX.rpc.ok), FIX.rpc.ok] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('TOKEN_REFRESHED', RENEWAL);
  h.state.coreToken = 'core-token-b';
  h.release();
  await action;
  await h.transport.rpc('get_tournament_workspace_context', {});
  assert.equal(h.exchanges().length, 2);
  assert.equal(h.exchanges()[1].headers.Authorization, 'Bearer core-token-b');
});

test('RACE-13 — an identity change while the RPC is in flight: its 401 is not retried under the new identity', async () => {
  const h = controlled({ exchange: [FIX.exchange.ok, FIX.exchange.okRenewed], rest: [hold(FIX.rpc.bearerInvalid)] });
  const action = h.transport.rpc('get_tournament_workspace_context', {});
  await flush();
  h.event('SIGNED_OUT');
  h.event('SIGNED_IN', { sameIdentity: false });
  h.state.coreToken = 'core-token-user-b';
  h.release();
  await assert.rejects(action, { code: 'CORE_AUTH_REQUIRED' });
  assert.equal(h.rpcs().length, 1, 'the retry never runs as user B');
});

// The bridge is the only place that can tell a renewal of the same identity from a new one:
// it sees the session of every Core event (INITIAL_SESSION included) and forwards only the
// events that clear the transport, with `sameIdentity` true exclusively for TOKEN_REFRESHED /
// SIGNED_IN of the user it already knew. It still calls nothing but getSession/onAuthStateChange.
function bridgeHarness() {
  let emit = null;
  let unsubscribed = 0;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: (cb) => {
        emit = cb;
        return { data: { subscription: { unsubscribe: () => { unsubscribed += 1; } } } };
      },
    },
  };
  const rt = runtime({ modules: { 'src/lib/coreSupabaseClient.js': { coreSupabase: client } } });
  const { createCoreSessionBridge } = rt.load('src/features/torneos/stagingV1/coreSessionBridge.js');
  const bridge = createCoreSessionBridge(client);
  const heard = [];
  const stop = bridge.onCoreAuthChange((event, detail) => heard.push([event, JSON.parse(JSON.stringify(detail ?? null))]));
  const session = (id) => ({ access_token: `t-${id}`, user: { id } });
  return { emit: (event, s) => emit(event, s), heard, session, stop, unsubscribed: () => unsubscribed };
}

test('RACE-11 — bridge: sameIdentity only for TOKEN_REFRESHED / SIGNED_IN of the already-known user', () => {
  const b = bridgeHarness();
  b.emit('TOKEN_REFRESHED', b.session('u1')); // before INITIAL_SESSION: unattributable
  b.emit('INITIAL_SESSION', b.session('u1')); // learned, not forwarded
  b.emit('TOKEN_REFRESHED', b.session('u1'));
  b.emit('SIGNED_IN', b.session('u1'));
  b.emit('USER_UPDATED', b.session('u1'));
  b.emit('SIGNED_IN', b.session('u2'));
  b.emit('SIGNED_IN', b.session('u2'));
  b.emit('SIGNED_OUT', null);
  b.emit('SIGNED_IN', b.session('u2')); // after a sign-out, never "the same" session
  b.emit('PASSWORD_RECOVERY', b.session('u2')); // not a clearing event
  assert.deepEqual(b.heard, [
    ['TOKEN_REFRESHED', { sameIdentity: false }],
    ['TOKEN_REFRESHED', { sameIdentity: true }],
    ['SIGNED_IN', { sameIdentity: true }],
    ['USER_UPDATED', { sameIdentity: false }],
    ['SIGNED_IN', { sameIdentity: false }],
    ['SIGNED_IN', { sameIdentity: true }],
    ['SIGNED_OUT', { sameIdentity: false }],
    ['SIGNED_IN', { sameIdentity: false }],
  ]);
  b.stop();
  assert.equal(b.unsubscribed(), 1);
});

test('RACE-12 — bridge: a session whose user cannot be read (auth-js userStorage proxy) is never "the same identity"', () => {
  const b = bridgeHarness();
  const proxied = { access_token: 't', user: new Proxy({}, { get() { throw new Error('user not available'); } }) };
  b.emit('INITIAL_SESSION', proxied);
  b.emit('TOKEN_REFRESHED', proxied);
  b.emit('INITIAL_SESSION', b.session('u1'));
  b.emit('TOKEN_REFRESHED', proxied);
  b.emit('TOKEN_REFRESHED', b.session('u1'));
  assert.deepEqual(b.heard, [
    ['TOKEN_REFRESHED', { sameIdentity: false }],
    ['TOKEN_REFRESHED', { sameIdentity: false }],
    ['TOKEN_REFRESHED', { sameIdentity: false }],
  ]);
});
