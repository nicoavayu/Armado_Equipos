// Targeted reproduction of R4.2 `torneos_rest_unavailable` (full run 20260920T230313Z: UND_ERR_SOCKET,
// no HTTP response). Gateway + proxy are already started and smoked by operator.mjs (mode transport).
// One QA user, one bearer, the matrix's own REST /32 route fault (route-fault.mjs: same image,
// commands, order, finally-rollback); every request is one attempt, never retried.
//   'route'         A normal RPCs · IDLE keep-alive observation · B/B-repeat sync helper (historical
//                   matrix behaviour) · C same fault, docker children off the event loop · D first RPC after restore
//   'route-loaded'  the matrix's exact preamble (offline harness in a Worker → proxy contract fault →
//                   503 CORE_UNAVAILABLE → sync ctl/routes → recovery) then: B-loaded (real sync helper),
//                   B-padded (real sync helper + synchronous pad to the idle the pool's next socket will
//                   have reached), C-padded (same total time, loop free)
//   'route-postfix' P1/P2: the fixed withRouteRemoved (dAsync) → 503 + no-store → restored → 200
// Observation only: diagnostics_channel + socket events on the client, metadata-only listeners on the
// run-owned proxy, async docker inspects. No secret, header or body is ever recorded.
import fs from 'node:fs';
import dc from 'node:diagnostics_channel';
import {monitorEventLoopDelay, performance} from 'node:perf_hooks';
import {r4, d, dAsync, inspect, guardedFetch, registerSecret, decodeJwt, tableCounts, catalogSHA256, writeEvidence, artifact, log, Stop, redact,
  GATEWAY, GATEWAY_ORIGIN, CORE_ORIGIN, REST_CONTAINER, ISOLATED_NETWORK} from './lib.mjs';
import {coreClient} from './core.mjs';
import {cleanupFixtures} from './fixtures.mjs';
import {routeFault} from './route-fault.mjs';
import {runOutageHarnessAsync} from './outage.mjs';
import {instrumentProxy, socketInfo, errorInfo} from './transport-probe.mjs';

const RPC = '/torneos/rest/v1/rpc/get_my_tournament_memberships';
const TABLE = '/torneos/rest/v1/torneos_identity?select=id';
const PROXY_KEEPALIVE_MS = 5000;       // Node http.Server default, advertised as Keep-Alive: timeout=5 (proxy 'server' event)
const PROXY_KEEPALIVE_BUFFER_MS = 1000; // Node keepAliveTimeoutBuffer: the socket is really closed at 6.0 s idle (observed 20260920T234910Z)
const PROXY_CLOSE_MS = PROXY_KEEPALIVE_MS + PROXY_KEEPALIVE_BUFFER_MS;
const TARGET_IDLE_MS = 6300;           // padded controls: idle of the socket the pool will pick, past the real proxy close
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blockSync = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms)); };
const now = () => ({at: new Date().toISOString(), mono: Math.round(performance.now() * 1000) / 1000});
const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e3) / 1e3;

export async function runRouteProbe({stamp, anonKey, serviceKey, variant = 'route'}) {
  if (!['route', 'route-loaded', 'route-postfix'].includes(variant)) throw new Stop('ROUTE_VARIANT_UNKNOWN', String(variant));
  const state = JSON.parse(fs.readFileSync(r4 + '/.runtime/run.json'));
  const http = guardedFetch([CORE_ORIGIN]); // Core only; gateway traffic goes through the instrumented request()
  const core = coreClient({http, anonKey, serviceKey, run: state.run});
  const baseline = tableCounts(), catalog = catalogSHA256();
  const restIP = inspect(REST_CONTAINER).NetworkSettings.Networks[ISOLATED_NETWORK].IPAddress;
  const doc = {schema: 'R4.2.route-transport.v1', stamp, variant, run: state.run, gateway: state.gateway, proxy: state.proxy, restIP,
    node: process.version, undici: process.versions.undici, startedAt: new Date().toISOString(),
    scope: 'targeted torneos_rest_unavailable only; one QA user; one bearer; REST /32 route fault of the matrix; no fixtures; no matrix; no certify; one attempt per request',
    steps: [], calls: [], ops: [], events: [], cases: [], cleanup: {}, status: 'FAIL'};
  const start = new Date().toISOString();
  let user = null, token = null, tokenAt = 0, active = 'setup', phase = '', ticker = null;
  const event = (name, data = {}) => doc.events.push({...now(), case: active, event: name, ...data});

  // ── client-side observation: Undici channels + per-socket lifecycle (metadata only) ──
  const subscriptions = [], sockets = new WeakSet();
  const watch = (socket, origin) => {
    if (!socket || sockets.has(socket)) return; sockets.add(socket);
    const initial = socketInfo(socket);
    for (const ev of ['end', 'close', 'timeout', 'error']) socket.on(ev, (arg) => event('client:socket:' + ev, {origin, initial, socket: socketInfo(socket), ...(ev === 'error' ? {error: errorInfo(arg)} : {})}));
  };
  for (const name of ['undici:client:connected', 'undici:client:connectError', 'undici:client:sendHeaders', 'undici:request:error']) {
    const listener = (m) => {
      const origin = String(m.connectParams?.origin ?? m.request?.origin ?? '');
      if (origin !== GATEWAY_ORIGIN) return;
      event(name, {path: m.request?.path ?? null, socket: m.socket ? socketInfo(m.socket) : null, error: m.error ? errorInfo(m.error) : null});
      watch(m.socket, origin);
    };
    dc.channel(name).subscribe(listener); subscriptions.push([name, listener]);
  }
  // ── event-loop observation: 50 ms ticker (max gap = longest block) + perf_hooks histogram ──
  let tickCount = 0, lastTick = performance.now(), maxGap = 0;
  ticker = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - lastTick); lastTick = n; tickCount++; }, 50);
  const eld = monitorEventLoopDelay({resolution: 10}); eld.enable();
  const loopWindow = () => { const t0 = tickCount; lastTick = performance.now(); maxGap = 0; eld.reset(); return () => ({ticks: tickCount - t0, maxGapMs: Math.round(maxGap), eldMaxMs: Math.round(eld.max / 1e6), eldMeanMs: Math.round(eld.mean / 1e6)}); };

  // ── docker helpers: the matrix's route fault with sync (historical) or async (fixed) children, both timed ──
  const timed = (kind) => (args) => {
    const cmd = args.at(-1), netAdmin = args.includes('NET_ADMIN'), started = now(), t0 = process.hrtime.bigint();
    const record = (r) => { doc.ops.push({case: active, phase, kind, cmd, netAdmin, ...started, ms: ms(t0), status: r.status}); return r; };
    return kind === 'sync' ? record(d(args)) : dAsync(args).then(record);
  };
  const faultSync = routeFault({run: state.run, gateway: state.gateway, routes: state.routes, exec: timed('sync')});
  const faultAsync = routeFault({run: state.run, gateway: state.gateway, routes: state.routes, exec: timed('async')});
  const observe = routeFault({run: state.run, gateway: state.gateway, routes: state.routes, exec: dAsync});
  const containerState = async (name) => { const x = JSON.parse((await dAsync(['inspect', name])).stdout)[0]; return {id: x.Id.slice(0, 12), running: x.State.Running, status: x.State.Status, restartCount: x.RestartCount, startedAt: x.State.StartedAt, finishedAt: x.State.FinishedAt, exitCode: x.State.ExitCode, oomKilled: x.State.OOMKilled}; };
  async function snapshot() {
    const [gateway, proxy, routes, proxyTCPAndFault] = await Promise.all([containerState(state.gateway), containerState(state.proxy), observe.routes(),
      dAsync(['exec', state.proxy, 'sh', '-c', 'cat /proc/net/tcp; if test -f /fault/mode; then cat /fault/mode; fi']).then((r) => r.stdout)]);
    if (!routes.includes('unreachable default')) throw new Stop('ROUTE_OBSERVATION_FAILED');
    return {...now(), containers: {gateway, proxy}, routes, proxyTCPAndFault};
  }

  // ── HTTP through the pooled global dispatcher; one attempt; transport failures keep their cause ──
  async function request(id, path, {method = 'GET', bearer, body, close = false} = {}) {
    const started = now(), t0 = process.hrtime.bigint();
    const row = {case: active, id, path: path.split('?')[0], method, ...started}; doc.calls.push(row);
    try {
      const r = await fetch(GATEWAY + path, {method, redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: {'x-r42-probe': id, ...(close ? {connection: 'close'} : {}), ...(bearer ? {authorization: 'Bearer ' + bearer} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {})},
        body: body !== undefined ? JSON.stringify(body) : undefined});
      const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (json?.access_token) { registerSecret(json.access_token); token = json.access_token; tokenAt = Date.now(); user.claims = decodeJwt(token); }
      Object.assign(row, {httpResponse: true, status: r.status, error: typeof json?.error === 'string' ? json.error : (json === null ? text.slice(0, 40) : null),
        bodyKind: json === null ? 'text' : 'json', cacheControl: r.headers.get('cache-control'), keepAlive: r.headers.get('keep-alive'), connection: r.headers.get('connection')});
    } catch (e) {
      Object.assign(row, {httpResponse: false, error: errorInfo(e), atError: now()});
      row.atErrorState = await snapshot();
    }
    row.ms = ms(t0); row.done = now();
    log(`${id}: ${row.httpResponse ? row.status + ' ' + (row.error ?? '') : 'NO_RESPONSE ' + (row.error?.cause?.code ?? row.error?.code ?? row.error?.name)} (${row.ms} ms)`);
    return row;
  }
  async function tok() {
    if (token && Date.now() - tokenAt < 80_000) return token;
    const r = await request(active + '-exchange', '/exchange', {method: 'POST', bearer: user.sessions.at(-1).accessToken});
    if (r.status !== 200) throw new Stop('EXCHANGE_FAILED', String(r.status));
    return token;
  }
  const rpc = (id) => request(id, RPC, {method: 'POST', bearer: token, body: {}});
  const table = (id) => request(id, TABLE, {bearer: token});
  const health = (id, close = false) => request(id, '/health', {close});
  const stable = (b, a) => ['gateway', 'proxy'].every((k) => b.containers[k].running && a.containers[k].running && b.containers[k].id === a.containers[k].id && b.containers[k].startedAt === a.containers[k].startedAt && b.containers[k].restartCount === 0 && a.containers[k].restartCount === 0);
  const socketFailure = (r) => r && !r.httpResponse && r.error?.cause?.code === 'UND_ERR_SOCKET';
  let originalRoutes = null;

  /** matrix.mjs core_contract_unavailable live check + recovery, verbatim sequence (sync docker exec/run as the matrix runs today). */
  async function contractFaultPreamble(name) {
    phase = 'preamble'; const p = {};
    const ctl = (code) => { const t0 = process.hrtime.bigint(); d(['exec', state.proxy, 'node', '-e', code]); return ms(t0); };
    await tok();
    p.ctlOnMs = ctl(`require('fs').writeFileSync('/fault/mode','contract',{flag:'wx',mode:0o600})`);
    try { p.health = await health(name + '-pre-health'); p.rpcCoreFault = await rpc(name + '-pre-rpc-corefault'); }
    finally { p.ctlOffMs = ctl("require('fs').unlinkSync('/fault/mode')"); }
    const t0 = process.hrtime.bigint(); p.routesUnchanged = (await faultSync.routes()) === originalRoutes; p.routesMs = ms(t0);
    p.recovery = await rpc(name + '-pre-recovery'); // the last response before the block: socket X; the block's RPC will take the OTHER socket
    p.expected = {health: 200, rpcCoreFault: '503 CORE_UNAVAILABLE', recovery: 200};
    p.ok = p.health.status === 200 && p.rpcCoreFault.status === 503 && p.rpcCoreFault.error === 'CORE_UNAVAILABLE' && p.routesUnchanged && p.recovery.status === 200;
    log(`preamble ${name}: ${JSON.stringify({ctlOnMs: p.ctlOnMs, ctlOffMs: p.ctlOffMs, routesMs: p.routesMs, health: p.health.status, rpcCoreFault: `${p.rpcCoreFault.status} ${p.rpcCoreFault.error}`, recovery: p.recovery.status, ok: p.ok})}`);
    return p;
  }

  /** One fault case: [preamble | health + warm] → helper (sync|async) [+ pad] → RPC (+table) → restore → routes → first RPC → health. */
  async function faultCase(name, fault, {expectSocketFailure = null, preamble = false, pad = null} = {}) {
    active = name; const c = {name, mode: fault === faultSync ? 'sync (spawnSync docker run, historical matrix)' : 'async (dAsync docker run, event loop free)'}; doc.cases.push(c);
    // The snapshot (async docker) runs BEFORE the last response: as in the matrix, nothing turns the event loop between that response and the helper.
    c.before = await snapshot();
    if (preamble) { c.preamble = await contractFaultPreamble(name); if (!c.preamble.ok) throw new Stop('PREAMBLE_FAILED', name); c.healthBefore = null; c.lastResponse = c.preamble.recovery.done; c.otherSocketLastResponse = c.preamble.rpcCoreFault.done; }
    else { await tok(); c.healthBefore = await health(name + '-health-before'); c.warm = await rpc(name + '-warm'); c.lastResponse = now(); c.otherSocketLastResponse = c.healthBefore.done; }
    phase = 'fault'; const end = loopWindow(); const t0 = process.hrtime.bigint(); let routesDuring = null;
    try {
      c.during = await fault.withRouteRemoved(restIP, async (r) => {
        routesDuring = r; c.routeOpsDone = now(); c.routeOpsMs = ms(t0);
        if (pad) {
          // Pad the helper to the idle the pool's next socket (the one NOT used by the last response) will have reached.
          const idleSoFar = performance.now() - c.otherSocketLastResponse.mono; const wait = Math.max(0, pad.targetIdleMs - idleSoFar);
          c.pad = {kind: pad.kind, targetIdleMs: pad.targetIdleMs, otherSocketIdleBeforePadMs: Math.round(idleSoFar), waitMs: Math.round(wait)};
          if (pad.kind === 'sync') blockSync(wait); else await sleep(wait);
          c.pad.otherSocketIdleAtDispatchMs = Math.round(performance.now() - c.otherSocketLastResponse.mono);
        }
        c.dispatchAt = now(); c.blockedBeforeRpcMs = ms(t0);
        const rp = await rpc(name + '-rpc');
        const tbl = rp.httpResponse ? await table(name + '-table') : {skipped: 'rpc got no HTTP response; the matrix stops at its first failure'};
        return {rpc: rp, table: tbl};
      });
    } catch (e) { c.faultError = errorInfo(e); }
    c.restoredAt = now(); c.faultTotalMs = ms(t0); c.loop = end(); c.routesDuring = routesDuring; phase = '';
    c.ops = doc.ops.filter((o) => o.case === name && o.phase === 'fault');
    c.helperBeforeRpcMs = Math.round(c.ops.slice(0, 2).reduce((n, o) => n + o.ms, 0) * 1000) / 1000;
    c.otherSocketIdleAtDispatchMs = c.dispatchAt ? Math.round(c.dispatchAt.mono - c.otherSocketLastResponse.mono) : null;
    c.routesAfter = await observe.routes(); c.routesRestored = c.routesAfter === c.before.routes;
    c.recovery = await rpc(name + '-recovery-rpc'); // first request after the fault (no retries)
    c.healthAfter = await health(name + '-health-after'); c.after = await snapshot();
    c.rpcSocketFailure = socketFailure(c.during?.rpc);
    c.rpcFailedAfterMs = c.rpcSocketFailure ? c.during.rpc.ms : null;
    c.summary = {helperBeforeRpcMs: c.helperBeforeRpcMs, blockedBeforeRpcMs: c.blockedBeforeRpcMs, otherSocketIdleAtDispatchMs: c.otherSocketIdleAtDispatchMs, pad: c.pad ?? null,
      rpc: c.during?.rpc?.httpResponse ? `${c.during.rpc.status} ${c.during.rpc.error}` : `NO_RESPONSE ${c.during?.rpc?.error?.cause?.code ?? c.faultError?.code ?? '?'} after ${c.during?.rpc?.ms ?? '?'} ms`,
      rpcCacheControl: c.during?.rpc?.cacheControl ?? null, table: c.during?.table?.status ?? null, recovery: c.recovery.status, health: [c.healthBefore?.status ?? c.preamble?.health?.status, c.healthAfter.status], routesRestored: c.routesRestored, stable: stable(c.before, c.after), loop: c.loop};
    c.expected = expectSocketFailure === null ? null : (expectSocketFailure ? c.rpcSocketFailure : c.during?.rpc?.status === 503 && !c.rpcSocketFailure);
    log(`case ${name}: ${JSON.stringify(c.summary)}`);
    return c;
  }
  const healthOK = (c) => (c.healthBefore ? c.healthBefore.status === 200 : c.preamble?.health?.status === 200) && c.healthAfter.status === 200;

  try {
    doc.instrumentation = instrumentProxy(state);
    user = await core.createUser('route'); await core.login(user);
    const initial = await health('initial-health', true);
    if (initial.status !== 200) throw new Stop('INITIAL_HEALTH_FAILED');
    await tok(); originalRoutes = await observe.routes();
    doc.tokenClaims = {sub: user.claims?.sub?.slice(0, 8), ttl: user.claims ? user.claims.exp - user.claims.iat : null};
    if (variant === 'route') {
      // A ── normal RPCs, no helper: the pooled socket is reused within keep-alive.
      active = 'A'; const a = {name: 'A', before: await snapshot()}; doc.cases.push(a);
      a.rpcs = []; for (let i = 0; i < 4; i++) a.rpcs.push(await rpc('A-rpc-' + i));
      a.after = await snapshot(); a.summary = {statuses: a.rpcs.map((r) => r.status), cacheControl: [...new Set(a.rpcs.map((r) => r.cacheControl))], keepAlive: [...new Set(a.rpcs.map((r) => r.keepAlive))]};
      log(`case A: ${JSON.stringify(a.summary)}`);
      // IDLE ── keep-alive observation with a FREE loop: who closes the idle socket, and when.
      active = 'IDLE'; const idle = {name: 'IDLE'}; doc.cases.push(idle);
      await tok(); idle.warm = await rpc('IDLE-warm'); idle.lastResponse = now();
      const endIdle = loopWindow(); await sleep(7000); idle.loop = endIdle();
      idle.socketEvents = doc.events.filter((e) => e.case === 'IDLE' && e.event.startsWith('client:socket:')).map((e) => ({event: e.event, sinceLastResponseMs: Math.round((e.mono - idle.lastResponse.mono) * 1000) / 1000, socket: e.socket}));
      idle.rpc = await rpc('IDLE-rpc'); idle.summary = {socketEvents: idle.socketEvents.map((e) => `${e.event}@${e.sinceLastResponseMs}ms`), rpc: idle.rpc.status, loop: idle.loop};
      log(`case IDLE: ${JSON.stringify(idle.summary)}`);
      await faultCase('B', faultSync);
      await faultCase('B-repeat', faultSync);
      await faultCase('C', faultAsync, {expectSocketFailure: false});
      active = 'D'; const dcase = {name: 'D', note: 'first RPC after the async fault restored the route (recovery of C), then a fresh health'}; doc.cases.push(dcase);
      dcase.rpc = doc.cases.find((c) => c.name === 'C').recovery; dcase.health = await health('D-health'); dcase.after = await snapshot();
      dcase.summary = {rpc: dcase.rpc.status, health: dcase.health.status}; log(`case D: ${JSON.stringify(dcase.summary)}`);
    } else if (variant === 'route-loaded') {
      // H ── the matrix's core_contract_unavailable check 1: offline harness in a Worker (same bundle, --network none, no secret).
      active = 'H'; const h = {name: 'H'}; doc.cases.push(h); const endH = loopWindow(); const tH = process.hrtime.bigint();
      const harness = await runOutageHarnessAsync({label: state.run});
      h.harness = {ms: ms(tH), pass: harness.pass, tests: harness.tests.length, bundleSHA256: harness.bundleSHA256}; h.loop = endH();
      log(`case H: ${JSON.stringify(h.harness)}`);
      if (!harness.pass) throw new Stop('HARNESS_FAILED');
      // B-loaded ── check 2 + recovery + the block, exactly as the matrix (sync helpers), right after the harness.
      await faultCase('B-loaded', faultSync, {preamble: true});
      // B-padded ── same real sync helper, then keep the loop blocked until the other socket's idle passes the proxy close.
      await faultCase('B-padded', faultSync, {preamble: true, pad: {kind: 'sync', targetIdleMs: TARGET_IDLE_MS}, expectSocketFailure: true});
      // C-padded ── same commands and the same total wait with the loop free.
      await faultCase('C-padded', faultAsync, {preamble: true, pad: {kind: 'async', targetIdleMs: TARGET_IDLE_MS}, expectSocketFailure: false});
      active = 'D'; const dcase = {name: 'D', note: 'first RPC after C-padded restored the route (its recovery), then a fresh health'}; doc.cases.push(dcase);
      dcase.rpc = doc.cases.find((c) => c.name === 'C-padded').recovery; dcase.health = await health('D-health'); dcase.after = await snapshot();
      dcase.summary = {rpc: dcase.rpc.status, health: dcase.health.status}; log(`case D: ${JSON.stringify(dcase.summary)}`);
    } else {
      for (const name of ['P1', 'P2']) await faultCase(name, faultAsync, {expectSocketFailure: false});
    }
    // ── verdict ──
    const fc = doc.cases.filter((c) => c.during !== undefined || c.faultError);
    const sync = fc.filter((c) => c.mode.startsWith('sync')), async_ = fc.filter((c) => c.mode.startsWith('async'));
    doc.diagnosis = {
      proxyKeepAliveMs: PROXY_KEEPALIVE_MS, proxyKeepAliveBufferMs: PROXY_KEEPALIVE_BUFFER_MS, proxyCloseMs: PROXY_CLOSE_MS, undiciIdleCloseMs: variant === 'route' ? doc.cases.find((c) => c.name === 'IDLE')?.socketEvents?.filter((e) => e.event === 'client:socket:close').map((e) => e.sinceLastResponseMs) : undefined,
      sync: sync.map((c) => ({name: c.name, helperBeforeRpcMs: c.helperBeforeRpcMs, blockedBeforeRpcMs: c.blockedBeforeRpcMs, pad: c.pad ?? null, otherSocketIdleAtDispatchMs: c.otherSocketIdleAtDispatchMs,
        ops: c.ops.map((o) => [o.cmd.split(' ').slice(0, 3).join(' '), o.ms]), loopMaxGapMs: c.loop.maxGapMs, rpc: c.summary.rpc, reproduced: c.rpcSocketFailure, rpcFailedAfterMs: c.rpcFailedAfterMs,
        consistentWithProxyClose: c.rpcSocketFailure === ((c.otherSocketIdleAtDispatchMs ?? 0) >= PROXY_CLOSE_MS)})),
      async: async_.map((c) => ({name: c.name, helperBeforeRpcMs: c.helperBeforeRpcMs, pad: c.pad ?? null, otherSocketIdleAtDispatchMs: c.otherSocketIdleAtDispatchMs, loopTicksDuringFault: c.loop.ticks, loopMaxGapMs: c.loop.maxGapMs, rpc: c.summary.rpc, cacheControl: c.summary.rpcCacheControl, table: c.summary.table, recovery: c.recovery.status})),
      reproduced: sync.some((c) => c.rpcSocketFailure), reproducedBy: sync.filter((c) => c.rpcSocketFailure).map((c) => c.name),
      wireErrorWhenRestUnreachable: [...new Set(fc.map((c) => c.during?.rpc?.error).filter((x) => typeof x === 'string'))]};
    const allowedFailure = (r) => r.id === r.case + '-rpc' && sync.some((c) => c.name === r.case);
    doc.expectations = {
      ...(variant === 'route' ? {normal: doc.cases.find((c) => c.name === 'A').rpcs.every((r) => r.status === 200), idleRecovers: doc.cases.find((c) => c.name === 'IDLE').rpc.status === 200} : {}),
      ...(variant === 'route-loaded' ? {harness: doc.cases.find((c) => c.name === 'H').harness.pass === true, preambles: fc.every((c) => c.preamble?.ok === true), paddedSyncReproduces: doc.cases.find((c) => c.name === 'B-padded')?.rpcSocketFailure === true} : {}),
      syncCasesRecover: sync.every((c) => c.recovery.status === 200 && c.routesRestored && c.summary.stable && c.healthAfter.status === 200),
      asyncFault503: async_.every((c) => c.during?.rpc?.status === 503 && c.during?.table?.status === 503 && !c.rpcSocketFailure),
      asyncFaultNoStore: async_.every((c) => (c.during?.rpc?.cacheControl ?? '').includes('no-store') && (c.during?.table?.cacheControl ?? '').includes('no-store')),
      asyncLoopFree: async_.every((c) => c.loop.ticks > 0 && c.loop.maxGapMs < 1000),
      recovery200: async_.every((c) => c.recovery.status === 200),
      oneAttemptEach: fc.every((c) => doc.calls.filter((r) => r.id === c.name + '-rpc').length === 1),
      noUnexpectedFailures: doc.calls.filter((r) => !r.httpResponse).every(allowedFailure),
      ...(variant === 'route-postfix' ? {noSocketFailure: !doc.calls.some((r) => !r.httpResponse), faultApplied: fc.every((c) => c.routesDuring !== null && c.routesDuring !== c.before.routes)} : {}),
      health: fc.every(healthOK),
      processes: doc.cases.filter((c) => c.before && c.after).every((c) => stable(c.before, c.after)),
      routes: doc.cases.filter((c) => c.before && c.after).every((c) => c.before.routes === c.after.routes)};
    doc.status = Object.values(doc.expectations).every(Boolean) ? 'PASS' : 'FAIL';
    doc.steps.push({name: variant === 'route-postfix' ? 'route_targeted_expectations' : 'route_diagnosis_controls', status: doc.status});
  } catch (e) { doc.aborted = redact(String(e?.message ?? e)); log('route probe aborted: ' + doc.aborted); }
  finally {
    active = 'cleanup';
    if (user) {
      const logout = await core.logout(user.sessions.at(-1), 'global'); const del = await core.deleteUser(user);
      const rows = cleanupFixtures({baseline, orgs: [], identities: [user.claims?.sub].filter(Boolean), coreUserIds: [user.coreUserId], RUN: state.run.replace('arma2-r42-', '').slice(0, 15)});
      doc.cleanup = {qa: del.deleted, sessions: [204, 401, 403].includes(logout), rows: rows.ok, catalogUnchanged: catalogSHA256() === catalog, logout, delete: del, rowsDetail: rows};
    }
    doc.qaUsers = user ? [{role: 'route', id: user.coreUserId, lastSession: user.sessions.at(-1)?.sessionId, deleted: doc.cleanup.qa}] : [];
    doc.complete = ['qa', 'sessions', 'rows', 'catalogUnchanged'].every((k) => doc.cleanup[k] === true);
    clearInterval(ticker); eld.disable();
    for (const [n, l] of subscriptions) dc.channel(n).unsubscribe(l);
    doc.logs = Object.fromEntries([['gateway', state.gateway], ['proxy', state.proxy]].map(([k, n]) => { const r = d(['logs', '--timestamps', '--since', start, n], {ok: true}); return [k, redact(r.stdout + '\n' + r.stderr)]; }));
    doc.proxyEvents = doc.logs.proxy.split('\n').filter((l) => l.includes('R42_TRANSPORT ')).map((l) => { try { return JSON.parse(l.slice(l.indexOf('R42_TRANSPORT ') + 14)); } catch { return {raw: l.slice(0, 200)}; } });
    doc.finishedAt = new Date().toISOString();
  }
  const evidencePath = writeEvidence('r42-route-transport', doc, stamp);
  return {doc, artifact: artifact(evidencePath), evidencePath};
}
