// R4.2 route fault injection inside the run-owned gateway namespace (torneos_rest_unavailable).
// Exactly the commands, order and finally-rollback the matrix has always used. `exec` decides only
// how the docker child runs: `d` (spawnSync) blocks the operator event loop for the whole helper,
// `dAsync` (default) does not. Blocking matters because the ingress proxy closes idle keep-alive
// sockets after 5 s and Undici can only learn about that close when the loop runs; the matrix
// therefore injects dAsync, and the targeted probe injects `d` to reproduce the historical failure.
import {dAsync, ROUTE_IMAGE} from './lib.mjs';

export const normalizeHostRoute = (dst) => (dst === 'default' || dst.includes('/')) ? dst : dst + '/32';

/** Docker args of one helper container joined to the gateway namespace (NET_ADMIN only when mutating). */
export function routeHelperArgs({run, gateway, cmd, netAdmin}) {
  return ['run', '--rm', '--pull', 'never', '--label', 'arma2.r4.run=' + run, '--network', 'container:' + gateway, '--cap-drop', 'ALL', ...(netAdmin ? ['--cap-add', 'NET_ADMIN'] : []), '--security-opt', 'no-new-privileges', '--entrypoint', 'sh', ROUTE_IMAGE, '-c', cmd];
}

export function routeFault({run, gateway, routes: stateRoutes, exec = dAsync}) {
  if (typeof exec !== 'function') throw new Error('ROUTE_FAULT_EXEC_REQUIRED');
  const routeDev = (ip) => stateRoutes.find((r) => normalizeHostRoute(r.dst) === ip + '/32')?.dev;
  const routeHelper = async (cmd, netAdmin) => (await exec(routeHelperArgs({run, gateway, cmd, netAdmin}))).stdout.trim();
  const routes = () => routeHelper('ip -f inet route; echo ---; ip -f inet6 route', false);
  async function withRouteRemoved(ip, fn) {
    const dev = routeDev(ip);
    if (!dev) throw new Error('ASSERT ' + JSON.stringify({ip, routes: stateRoutes}).slice(0, 500));
    await routeHelper(`ip route del ${ip}/32 dev ${dev}`, true);
    try { return await fn(await routes()); }
    finally { await routeHelper(`ip route replace ${ip}/32 dev ${dev}`, true); }
  }
  return {routeHelper, routes, withRouteRemoved, routeDev};
}
