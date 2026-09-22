// Offline: route-fault.mjs keeps the matrix's exact docker invocation, order and rollback; callAsync keeps
// call()'s contract without blocking the event loop. No Docker, no network, no secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFault, routeHelperArgs, normalizeHostRoute} from './route-fault.mjs';
import {callAsync, call, ROUTE_IMAGE} from './lib.mjs';

const RUN = 'arma2-r42-20260920t230323z', GW = RUN + '-gateway';
const STATE_ROUTES = [{dst: 'default', type: 'unreachable'}, {dst: '172.27.0.2', type: 'unicast', dev: 'eth1', scope: 'link'}, {dst: '172.27.0.3', type: 'unicast', dev: 'eth1', scope: 'link'}, {dst: '172.29.0.2', type: 'unicast', dev: 'eth0', scope: 'link'}];

test('helper args are byte-identical to the historical inline routeHelper of matrix.mjs (NET_ADMIN only when mutating)', () => {
  const legacy = (cmd, netAdmin) => ['run', '--rm', '--pull', 'never', '--label', 'arma2.r4.run=' + RUN, '--network', 'container:' + GW, '--cap-drop', 'ALL', ...(netAdmin ? ['--cap-add', 'NET_ADMIN'] : []), '--security-opt', 'no-new-privileges', '--entrypoint', 'sh', ROUTE_IMAGE, '-c', cmd];
  for (const [cmd, netAdmin] of [['ip route del 172.27.0.3/32 dev eth1', true], ['ip -f inet route; echo ---; ip -f inet6 route', false], ['ip route replace 172.27.0.3/32 dev eth1', true]]) {
    assert.deepEqual(routeHelperArgs({run: RUN, gateway: GW, cmd, netAdmin}), legacy(cmd, netAdmin));
  }
  assert.equal(normalizeHostRoute('172.27.0.3'), '172.27.0.3/32'); assert.equal(normalizeHostRoute('default'), 'default'); assert.equal(normalizeHostRoute('10.0.0.0/8'), '10.0.0.0/8');
});

test('withRouteRemoved: del → routes → fn → replace in finally, even when fn throws; async exec never blocks; sync exec accepted', async () => {
  for (const kind of ['async', 'sync']) {
    const seen = [];
    const exec = kind === 'async' ? async (args) => { seen.push(args.at(-1)); await new Promise((r) => setTimeout(r, 5)); return {status: 0, stdout: 'ROUTES ' + seen.length + '\n', stderr: ''}; }
      : (args) => { seen.push(args.at(-1)); return {status: 0, stdout: 'ROUTES ' + seen.length + '\n', stderr: ''}; };
    const f = routeFault({run: RUN, gateway: GW, routes: STATE_ROUTES, exec});
    assert.equal(f.routeDev('172.27.0.3'), 'eth1'); assert.equal(f.routeDev('172.29.0.2'), 'eth0'); assert.equal(f.routeDev('9.9.9.9'), undefined);
    let ticks = 0; const t = setInterval(() => ticks++, 1);
    const out = await f.withRouteRemoved('172.27.0.3', async (r) => { assert.equal(r, 'ROUTES 2'); return 'fn-ran'; });
    clearInterval(t);
    assert.equal(out, 'fn-ran');
    assert.deepEqual(seen, ['ip route del 172.27.0.3/32 dev eth1', 'ip -f inet route; echo ---; ip -f inet6 route', 'ip route replace 172.27.0.3/32 dev eth1']);
    if (kind === 'async') assert.ok(ticks > 0, 'event loop ticked while the async helper ran');
    seen.length = 0;
    await assert.rejects(f.withRouteRemoved('172.27.0.3', async () => { throw new Error('boom'); }), /boom/);
    assert.equal(seen.at(-1), 'ip route replace 172.27.0.3/32 dev eth1', 'rollback still runs');
    await assert.rejects(f.withRouteRemoved('9.9.9.9', async () => 'never'), /ASSERT/);
  }
  assert.throws(() => routeFault({run: RUN, gateway: GW, routes: STATE_ROUTES, exec: 'no'}), /ROUTE_FAULT_EXEC_REQUIRED/);
});

test('callAsync mirrors call(): stdout/status, COMMAND_FAILED with ok=false, ok=true returns nonzero, stdin input, timeout → SIGKILL; loop keeps ticking', async () => {
  const sh = '/bin/sh';
  const a = await callAsync(sh, ['-c', 'printf hi']); assert.equal(a.stdout, 'hi'); assert.equal(a.status, 0);
  const s = call(sh, ['-c', 'printf hi']); assert.equal(s.stdout, a.stdout);
  await assert.rejects(callAsync(sh, ['-c', 'echo bad >&2; exit 3']), (e) => e.code === 'COMMAND_FAILED' && /status=3/.test(e.message) && /bad/.test(e.message));
  const ok = await callAsync(sh, ['-c', 'exit 3'], {ok: true}); assert.equal(ok.status, 3);
  const inp = await callAsync(sh, ['-c', 'cat'], {input: 'from-stdin'}); assert.equal(inp.stdout, 'from-stdin');
  let ticks = 0; const t = setInterval(() => ticks++, 10);
  await assert.rejects(callAsync(sh, ['-c', 'sleep 5'], {timeout: 150}), /status=timeout/);
  clearInterval(t); assert.ok(ticks >= 5, `loop ticked ${ticks} times during a 150 ms async child`);
  await assert.rejects(callAsync('/nonexistent/binary', []), /COMMAND_FAILED/);
});
