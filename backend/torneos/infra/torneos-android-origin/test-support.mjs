// ANDROID ORIGIN REMOTE — offline support for the unit tests (no network, no secret):
//   • the REAL gateway handle() of both sources, each extracted from git at its commit (live 0f049ef5, candidate f7efe18f),
//     with the Production topology env built from throwaway material; Core Production and Torneos REST emulated in-process;
//   • a fake Deno Deploy API v2 exactly as the OEC W3 left Production (revision t5vxxvzp1t9f current, 4 revisions, 13 env),
//     whose deploy switches the served source by its bundle-digest label and records every write.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './android-origin-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { loadGatewayTree } from '../torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv as oecFixtureEnv } from '../torneos-officialization-error-v1/test-support.mjs';
import { extractTree } from './android-origin-bundle.mjs';

/** Throwaway Production-shaped gateway env; the env pin of the fake app carries the fixture's non-secret digests. */
export function fixtureEnv() {
  const fx = oecFixtureEnv();
  const byKey = Object.fromEntries(fx.livePin.env.map((e) => [e.key, e]));
  const envPin = C.ENV_PIN.map((e) => (e.secret ? { ...e } : { ...e, sha256_16: byKey[e.key].sha256_16 }));
  return { ...fx, envPin };
}

/** Both sources loaded in-process; `state.live` ('live' | 'candidate') selects which one answers. */
export async function gatewayPair(env) {
  const tmp = { live: fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-ao-live-')), candidate: fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-ao-cand-')) };
  const trees = { live: await loadGatewayTree({ functionsDir: extractTree(C.LIVE.head, tmp.live) }), candidate: await loadGatewayTree({ functionsDir: extractTree(C.CANDIDATE.head, tmp.candidate) }) };
  const realFetch = globalThis.fetch;
  const upstream = { rest: [], core: [], restMode: 'ok' };
  globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/health`) { upstream.core.push('health'); return new Response('{}', { status: 200 }); }
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/user`) { upstream.core.push('user'); return new Response('{"msg":"bad jwt"}', { status: 401 }); }
    if (u === `${G.GATEWAY_TOPOLOGY.coreContractUrl}/v1/session`) { upstream.core.push('session'); return new Response('{"error":"FORBIDDEN"}', { status: 403 }); }
    if (u.startsWith(`${G.GATEWAY_TOPOLOGY.torneosRestUrl}/rpc/`)) {
      upstream.rest.push(u.slice(G.GATEWAY_TOPOLOGY.torneosRestUrl.length));
      if (upstream.restMode === 'down') throw new TypeError('fetch failed');
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  };
  const idx = { live: await trees.live.import('torneos-gateway/index.ts'), candidate: await trees.candidate.import('torneos-gateway/index.ts') };
  const state = { live: 'live', calls: 0, force5xx: false };
  const transport = async ({ url, method = 'GET', headers = {}, body }) => {
    state.calls += 1;
    if (state.force5xx && /\/health$/.test(url)) return { status: 502, headers: {}, json: null, raw: '' };
    const u = new URL(url);
    const req = new Request(url, { method, headers: { ...headers, host: u.host, 'x-forwarded-host': u.host }, body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : body });
    const res = await idx[state.live].handle(req);
    const raw = await res.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
    return { status: res.status, headers: Object.fromEntries(res.headers), json, raw };
  };
  return { transport, state, upstream,
    cleanup: async () => { globalThis.fetch = realFetch; delete globalThis.Deno; await trees.live.cleanup(); await trees.candidate.cleanup(); for (const d of Object.values(tmp)) fs.rmSync(d, { recursive: true, force: true }); } };
}

/** Fake Deno Deploy API v2 as the OEC W3 left it; deploy creates a revision labelled by the body. */
export function fakeDeno({ env, gateway }) {
  const secretNames = new Set(C.ENV_PIN.filter((e) => e.secret).map((e) => e.key));
  const cert = C.DENO_CERTIFIED;
  const app = { id: cert.app.id, slug: C.APP_SLUG, layers: [], config: JSON.parse(JSON.stringify(cert.app.config)), labels: { ...cert.app.labels }, created_at: cert.app.created_at, updated_at: cert.app.updated_at,
    env_vars: Object.keys(env).sort().map((key) => (secretNames.has(key) ? { key, secret: true, contexts: 'all' } : { key, value: env[key], secret: false, contexts: 'all' })) };
  const revs = [
    { id: C.LIVE.revision, status: 'succeeded', labels: { 'custom.git_head': C.LIVE.head, 'custom.bundle_digest': C.LIVE.digest }, created_at: C.LIVE.created_at },
    { id: '66we8r12079d', status: 'succeeded', labels: { 'custom.git_head': 'ee34b2a79008692178b6dbb42530aca5947d7027', 'custom.bundle_digest': '75e3535acc3fba99c871ee820d1927e1c695eba4c10044ec4e6ffda38b59afc7' }, created_at: '2026-09-27T16:44:56.254Z' },
    { id: '3rvq2wx9tyyg', status: 'succeeded', labels: { 'custom.git_head': 'bea307a3a82fd8e610f99210c2f8b40f9ceb0697' }, created_at: '2026-09-26T01:12:01.540Z' },
    { id: 'ec6zv20gx8hn', status: 'succeeded', labels: { 'custom.git_head': 'bea307a3a82fd8e610f99210c2f8b40f9ceb0697' }, created_at: '2026-09-26T01:08:17.167Z' }];
  const s = { writes: [], deployBodies: [], requests: [], polls: 0, failDeploy: false, logs: [{ level: 'info', message: 'ready' }], logsStatus: 200 };
  const transport = async ({ method, path: p, body }) => {
    s.requests.push(`${method} ${p}`);
    if (method === 'GET' && p === '/v2/apps?limit=100') return { status: 200, body: cert.org_apps.map((a) => ({ ...a })) };
    if (method === 'GET' && p === '/v2/layers') return { status: 200, body: [] };
    if (method === 'GET' && p.startsWith(`/v2/apps/${C.APP_SLUG}/logs?`)) return { status: s.logsStatus, body: s.logsStatus === 200 ? s.logs : { message: 'no' } };
    const tl = /^\/v2\/revisions\/([A-Za-z0-9_-]+)\/timelines$/.exec(p);
    if (method === 'GET' && tl) return { status: 200, body: [{ slug: 'production', domains: [{ domain: cert.production_domain }] }, { slug: 'preview', domains: [{ domain: `torneos-gateway-${tl[1]}.nicoavayu.deno.net` }] }] };
    if (method === 'GET' && p === `/v2/apps/${C.APP_SLUG}`) return { status: 200, body: JSON.parse(JSON.stringify(app)) };
    if (method === 'GET' && p.startsWith(`/v2/apps/${C.APP_SLUG}/revisions`)) return { status: 200, body: JSON.parse(JSON.stringify(revs)) };
    const m = /^\/v2\/revisions\/([A-Za-z0-9_-]+)$/.exec(p);
    if (method === 'GET' && m) {
      const r = revs.find((x) => x.id === m[1]);
      if (r.status === 'building' && ++s.polls >= 2) {
        r.status = s.failDeploy ? 'failed' : 'succeeded';
        if (!s.failDeploy) {
          const d = r.labels['custom.bundle_digest'];
          gateway.state.live = d === C.LIVE.digest ? 'live' : d === C.CANDIDATE.digest ? 'candidate' : 'unknown';
        }
      }
      return { status: 200, body: JSON.parse(JSON.stringify(r)) };
    }
    if (method === 'POST' && p === `/v2/apps/${C.APP_SLUG}/deploy`) {
      s.writes.push('deploy'); s.deployBodies.push(body);
      const r = { id: `rev${crypto.randomBytes(4).toString('hex')}`, status: 'building', labels: body.labels, created_at: new Date().toISOString() };
      revs.unshift(r); s.polls = 0;
      return { status: 202, body: r };
    }
    s.writes.push(`${method} ${p}`);
    return { status: 404, body: { message: 'not found' } };
  };
  return { transport, state: s, app, revs };
}
