// COMPETITION-V1 REMOTE — offline support shared by the unit tests and the offline rehearsal (no network, no secret):
//   • the REAL gateway handle() of either source (deployed bea307a3 extracted from git, or the candidate tree), with the
//     Production topology env built from throwaway material, Core Production and Torneos REST emulated in-process;
//   • a fake Deno Deploy API v2 (app, revisions, deploy) whose deploy switches the live source by its label;
//   • a fake database (state + catalog) that moves exactly like 0004 / its rollback.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './competition-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as P from '../torneos-payments-test/payments-test-contract.mjs';
import { loadGatewayTree } from '../torneos-gateway-auth/gateway-loader.mjs';
import { generateRing, jwksPinDocument } from '../torneos-gateway-auth/keyring.mjs';
import { buildGatewayEnv, describeEnv } from '../torneos-gateway-remote/gateway-env.mjs';
import { extractTree } from './competition-bundle.mjs';
import { CA_CERT } from '../torneos-gateway-auth/psql-gateway-auth.mjs';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (claims) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(claims)}.${crypto.randomBytes(32).toString('base64url')}`;
export const HOST = 'torneos-gateway.nicoavayu.deno.net';
export const BASE = C.GATEWAY_BASE;

/** Throwaway Production-shaped gateway env + the matching public pins (deploy pin with digests, JWKS pin). */
export function fixtureEnv() {
  const ring = generateRing();
  const jwksPin = jwksPinDocument(ring.jwks, { generatedAt: '2026-09-27T00:00:00.000Z' });
  const passwords = Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, crypto.randomBytes(30).toString('base64url')]));
  const contractSecret = crypto.randomBytes(32).toString('hex');
  const torneosAnonKey = `sb_publishable_${crypto.randomBytes(18).toString('base64url')}`;
  const env = buildGatewayEnv({ publicUrl: BASE, poolerHost: C.POOLER_HOST, jwksPin, k1Pkcs8: ring.slots[0].pkcs8, torneosAnonKey,
    coreAnonKey: fakeJwt({ iss: 'supabase', ref: G.CORE_PROD_REF, role: 'anon', iat: 1, exp: 2 }), caPem: fs.readFileSync(CA_CERT, 'utf8'), contractSecret, passwords });
  const real = C.readCurrentDeployPin();
  const deployPin = { ...real, env: describeEnv(env) };
  const secrets = [contractSecret, ...Object.values(passwords), ring.slots[0].pkcs8, ring.slots[1].pkcs8, env.TORNEOS_BRIDGE_KEYS, env.TORNEOS_DB_CORE_ADAPTER_URL, env.TORNEOS_DB_IDENTITY_WRITER_URL];
  return { env, ring, jwksPin, deployPin, secrets, k1: { pkcs8: ring.slots[0].pkcs8, kid: jwksPin.active } };
}

/** Both gateway sources loaded in-process; `live` selects which one answers. */
export async function gatewayPair(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-cv1-prev-tree-'));
  const previousDir = extractTree(C.CURRENT.head, tmp);
  const trees = { previous: await loadGatewayTree({ functionsDir: previousDir }), candidate: await loadGatewayTree() };
  const realFetch = globalThis.fetch;
  const upstream = { rest: [], core: [], restMode: 'ok' };
  globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/health`) { upstream.core.push('health'); return new Response('{}', { status: 200 }); }
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/user`) { upstream.core.push('user'); return new Response('{"msg":"bad jwt"}', { status: 401 }); }
    if (u === `${G.GATEWAY_TOPOLOGY.coreContractUrl}/v1/session`) { upstream.core.push('session'); return new Response('{"error":"FORBIDDEN"}', { status: 403 }); }
    if (u.startsWith(`${G.GATEWAY_TOPOLOGY.torneosRestUrl}/rpc/`)) {
      upstream.rest.push({ path: u.slice(G.GATEWAY_TOPOLOGY.torneosRestUrl.length), apikey: !!init.headers?.apikey, authorization: !!init.headers?.authorization, body: init.body });
      if (upstream.restMode === 'down') throw new TypeError('fetch failed');
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  };
  const idx = { previous: await trees.previous.import('torneos-gateway/index.ts'), candidate: await trees.candidate.import('torneos-gateway/index.ts') };
  const state = { live: 'previous' };
  const transport = async ({ url, method = 'GET', headers = {}, body }) => {
    const u = new URL(url);
    const req = new Request(url, { method, headers: { ...headers, host: u.host, 'x-forwarded-host': u.host }, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
    const res = await idx[state.live].handle(req);
    const raw = await res.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
    return { status: res.status, headers: Object.fromEntries(res.headers), json, raw };
  };
  return { transport, state, upstream, cleanup: async () => { globalThis.fetch = realFetch; delete globalThis.Deno; await trees.previous.cleanup(); await trees.candidate.cleanup(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}

/** Fake Deno Deploy API v2: the one app with the fixture env; deploy creates a revision labelled by the body. */
export function fakeDeno({ env, deployPin, gateway, candidateHead }) {
  const secretNames = new Set(deployPin.env.filter((e) => e.secret).map((e) => e.key));
  const cert = C.DENO_CERTIFIED;
  const app = { id: deployPin.app_id, slug: C.APP_SLUG, layers: [], config: JSON.parse(JSON.stringify(cert.app.config)), labels: { ...cert.app.labels }, created_at: cert.app.created_at, updated_at: cert.app.updated_at,
    env_vars: Object.keys(env).sort().map((key) => (secretNames.has(key) ? { key, secret: true, contexts: 'all' } : { key, value: env[key], secret: false, contexts: 'all' })) };
  const revs = [{ id: C.CURRENT.revision, status: 'succeeded', labels: { 'custom.git_head': C.CURRENT.head }, env_vars: app.env_vars.map(({ key, secret }) => ({ key, secret })), created_at: cert.current.created_at, build_finished_at: cert.current.build_finished_at },
    { id: 'ec6zv20gx8hn', status: 'succeeded', labels: { 'custom.git_head': C.CURRENT.head }, env_vars: [] }];
  const s = { writes: [], deployBodies: [], polls: 0, failDeploy: false };
  const transport = async ({ method, path: p, body }) => {
    if (method === 'GET' && p === '/v2/apps?limit=100') return { status: 200, body: cert.org_apps.map((a) => ({ ...a })) };
    if (method === 'GET' && p === '/v2/layers') return { status: 200, body: [] };
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
          const head = r.labels['custom.git_head'];
          gateway.state.live = head === C.CURRENT.head ? 'previous' : head === candidateHead ? 'candidate' : 'unknown';
        }
      }
      return { status: 200, body: JSON.parse(JSON.stringify(r)) };
    }
    if (method === 'POST' && p === `/v2/apps/${C.APP_SLUG}/deploy`) {
      s.writes.push('deploy'); s.deployBodies.push(body);
      const r = { id: `rev${crypto.randomBytes(4).toString('hex')}`, status: 'building', labels: body.labels, env_vars: app.env_vars.map(({ key, secret }) => ({ key, secret })) };
      revs.unshift(r); s.polls = 0;
      return { status: 202, body: r };
    }
    return { status: 404, body: { message: 'not found' } };
  };
  return { transport, state: s, app, revs };
}

// ── fake database ──
const fn = (kind, sig, { authenticated, body }) => ({ kind, sig, exists: true, anon: false, authenticated, service_role: kind === 'granted' || kind === 'kept' || kind === 'service_only',
  public: false, server_roles: [], definer: true, search_path_pinned: true, owner: 'postgres', installer_owns: true, body_md5: body });
export function contractState(which) {
  const open = which === 'POST_0004';
  const fixed = which !== 'PRE_0004';
  const bodies = Object.fromEntries(C.FIXES.map((f) => [f.fn, fixed ? f.after : f.before]));
  const functions = [
    ...C.GRANTED.map((s) => fn('granted', s, { authenticated: open, body: bodies[s] ?? crypto.createHash('md5').update(s).digest('hex') })),
    ...C.KEPT_REVOKED.map((s) => fn('kept', s, { authenticated: false, body: 'x' })),
    ...C.SERVICE_ONLY.map((s) => fn('service_only', s, { authenticated: false, body: 'x' })),
  ];
  for (const s of C.FIXED_ONLY) functions.push({ ...fn('fixed', s, { authenticated: true, body: bodies[s] }), service_role: true });
  return { server_version: '17.6', read_only: 'on', current_user: 'postgres', functions, counts: { authenticated_public: open ? C.COUNTS.authenticatedAfter : C.COUNTS.authenticatedBefore, anon_public: C.COUNTS.anon }, ledger: false,
    role_settings: { anon: ['statement_timeout=3s'], authenticated: ['statement_timeout=8s'], authenticator: ['statement_timeout=8s'] } };
}
export function fakeDeltaPin() {
  const foundation = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8')).catalog;
  const pre = Object.fromEntries(C.CV1_CATALOG_PATHS.map((p) => [p, G.getPath(foundation, p)]));
  const post = Object.fromEntries(C.CV1_CATALOG_PATHS.map((p) => [p, { fake: `post-${p}` }]));
  const rolled = Object.fromEntries(C.CV1_CATALOG_PATHS.map((p) => [p, { fake: `rolled-${p}` }]));
  return { purpose: 'unit-test fixture', states: { pre, post, rolled_back: rolled } };
}
export function fakeDb({ deltaPin }) {
  const foundation = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8')).catalog;
  const payments = P.readDeltaPin();
  const s = { state: 'PRE_0004', applied: [], drift: null, failNextApply: false };
  const setPath = (o, p, v) => { const k = p.split('.'); let x = o; for (const part of k.slice(0, -1)) x = x[part]; x[k.at(-1)] = v; };
  const catalog = () => {
    const c = JSON.parse(JSON.stringify(foundation));
    for (const p of G.DELTA_PATHS) setPath(c, p, JSON.parse(JSON.stringify(G.getPath(payments.catalog, p))));
    const key = { PRE_0004: 'pre', POST_0004: 'post', ROLLED_BACK: 'rolled_back' }[s.state];
    for (const p of C.CV1_CATALOG_PATHS) setPath(c, p, JSON.parse(JSON.stringify(deltaPin.states[key][p])));
    return c;
  };
  const psql = async ({ script, env }) => {
    if (env.PGOPTIONS !== '-c default_transaction_read_only=on' || env.PGHOST !== C.POOLER_HOST || env.PGSSLMODE !== 'verify-full' || env.PGUSER !== `postgres.${C.TORNEOS_REF}`) return { code: 97, stdout: '', stderr_tail: 'env contract violated' };
    if (!/^BEGIN TRANSACTION READ ONLY;\n[\s\S]+;\nROLLBACK;\n$/.test(script)) return { code: 98, stdout: '', stderr_tail: 'not a read-only script' };
    const body = script.slice('BEGIN TRANSACTION READ ONLY;\n'.length, -';\nROLLBACK;\n'.length);
    let out;
    if (body === C.STATE_SQL) { out = contractState(s.state); if (s.drift) s.drift(out); }
    else if (body === G.CATALOG_SQL) out = catalog();
    else if (body === G.GATEWAY_ROLES_SQL) out = { ...payments.gateway_roles };
    else if (body === P.PAYMENT_ROLES_SQL) out = payments.payment_roles;
    else return { code: 3, stdout: '', stderr_tail: 'unknown query' };
    return { code: 0, stdout: `${JSON.stringify(out)}\n`, stderr_tail: '' };
  };
  const applySql = async ({ sql, env }) => {
    if (env.PGOPTIONS || env.PGHOST !== C.POOLER_HOST) return { code: 97, stderr_tail: 'env contract violated' };
    const h = C.sha256(sql);
    s.applied.push(h);
    if (s.failNextApply) { s.failNextApply = false; return { code: 3, stderr_tail: 'ERROR: TORNEOS_COMPETITION_V1_PRECONDITION_FAILED' }; }
    if (h === C.MIGRATION.sha256) s.state = 'POST_0004';
    else if (h === C.ROLLBACK.sha256) s.state = 'ROLLED_BACK';
    else return { code: 3, stderr_tail: 'unknown file' };
    return { code: 0, stderr_tail: '' };
  };
  return { psql, applySql, state: s };
}
