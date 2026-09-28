// OFFICIALIZATION + ERROR-CONTRACT REMOTE — offline support shared by the unit tests and the offline rehearsal (no network,
// no secret):
//   • the REAL gateway handle() of both sources (live ee34b2a7 extracted from git, and the candidate tree), with the
//     Production topology env built from throwaway material; Core Production and Torneos REST emulated in-process, with
//     switchable modes (Core session active / denied; REST answers per RPC, or never answers → the gateway's 5 s timeout);
//   • a fake Deno Deploy API v2 (app, revisions, deploy) at the COMPETITION-V1 W2 certification, whose deploy switches the
//     live source by its bundle-digest label;
//   • a fake database whose state output and catalog move exactly like 0005 / 0006 / their rollbacks (and like a RAW 0005
//     re-apply on POST_0006, to prove the tooling never sends it).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './oec-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as P from '../torneos-payments-test/payments-test-contract.mjs';
import { loadGatewayTree } from '../torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv as cv1FixtureEnv } from '../torneos-competition-v1/test-support.mjs';
import { extractTree } from './oec-bundle.mjs';

export const BASE = C.GATEWAY_BASE;

/** Throwaway Production-shaped gateway env + public pins; the live-deploy pin carries the fixture's env digests. */
export function fixtureEnv() {
  const fx = cv1FixtureEnv();
  const real = C.readLiveDeployPin();
  const byKey = Object.fromEntries(fx.deployPin.env.map((e) => [e.key, e]));
  return { ...fx, livePin: { ...real, env: real.env.map((e) => ({ ...byKey[e.key] })) } };
}

/** Both gateway sources loaded in-process; `state.live` selects which one answers. */
export async function gatewayPair(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-oec-live-tree-'));
  const liveDir = extractTree(C.LIVE.head, tmp);
  const trees = { current: await loadGatewayTree({ functionsDir: liveDir }), candidate: await loadGatewayTree() };
  const realFetch = globalThis.fetch;
  const upstream = { rest: [], core: [], restMode: 'ok', coreSession: 'deny', restAnswer: null };
  globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/health`) { upstream.core.push('health'); return new Response('{}', { status: 200 }); }
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/user`) { upstream.core.push('user'); return new Response('{"msg":"bad jwt"}', { status: 401 }); }
    if (u === `${G.GATEWAY_TOPOLOGY.coreContractUrl}/v1/session`) {
      upstream.core.push('session');
      if (upstream.coreSession === 'active') return new Response(JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('{"error":"FORBIDDEN"}', { status: 403 });
    }
    if (u.startsWith(`${G.GATEWAY_TOPOLOGY.torneosRestUrl}/rpc/`)) {
      const rpc = u.slice(G.GATEWAY_TOPOLOGY.torneosRestUrl.length);
      upstream.rest.push({ path: rpc, apikey: !!init.headers?.apikey, authorization: !!init.headers?.authorization, body: init.body });
      if (upstream.restMode === 'down') throw new TypeError('fetch failed');
      if (upstream.restMode === 'hang') {
        return new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))); });
      }
      if (upstream.restAnswer) { const a = upstream.restAnswer; return new Response(a.body, { status: a.status, headers: { 'content-type': 'application/json' } }); }
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  };
  const idx = { current: await trees.current.import('torneos-gateway/index.ts'), candidate: await trees.candidate.import('torneos-gateway/index.ts') };
  const competition = { current: await trees.current.import('torneos-gateway/competition.ts'), candidate: await trees.candidate.import('torneos-gateway/competition.ts') };
  const state = { live: 'current' };
  const transport = async ({ url, method = 'GET', headers = {}, body }) => {
    const u = new URL(url);
    const req = new Request(url, { method, headers: { ...headers, host: u.host, 'x-forwarded-host': u.host }, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
    const res = await idx[state.live].handle(req);
    const raw = await res.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
    return { status: res.status, headers: Object.fromEntries(res.headers), json, raw };
  };
  return { transport, state, upstream, competition,
    cleanup: async () => { globalThis.fetch = realFetch; delete globalThis.Deno; await trees.current.cleanup(); await trees.candidate.cleanup(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}

/** Fake Deno Deploy API v2 at the COMPETITION-V1 W2 certification; deploy creates a revision labelled by the body. */
export function fakeDeno({ env, livePin, gateway, candidateDigest }) {
  const secretNames = new Set(livePin.env.filter((e) => e.secret).map((e) => e.key));
  const cert = C.DENO_CERTIFIED;
  const app = { id: livePin.app_id ?? cert.app.id, slug: C.APP_SLUG, layers: [], config: JSON.parse(JSON.stringify(cert.app.config)), labels: { ...cert.app.labels }, created_at: cert.app.created_at, updated_at: '2026-09-27T16:44:55.900Z',
    env_vars: Object.keys(env).sort().map((key) => (secretNames.has(key) ? { key, secret: true, contexts: 'all' } : { key, value: env[key], secret: false, contexts: 'all' })) };
  const liveLabels = { 'custom.git_head': C.LIVE.head, 'custom.bundle_digest': C.LIVE.digest };
  const revs = [{ id: C.LIVE.revision, status: 'succeeded', labels: liveLabels, env_vars: app.env_vars.map(({ key, secret }) => ({ key, secret })), created_at: C.LIVE.created_at },
    { id: '3rvq2wx9tyyg', status: 'succeeded', labels: { 'custom.git_head': 'bea307a3a82fd8e610f99210c2f8b40f9ceb0697' }, env_vars: [], created_at: '2026-09-26T01:12:01.540Z' },
    { id: 'ec6zv20gx8hn', status: 'succeeded', labels: { 'custom.git_head': 'bea307a3a82fd8e610f99210c2f8b40f9ceb0697' }, env_vars: [], created_at: '2026-09-26T01:08:17.167Z' }];
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
          const d = r.labels['custom.bundle_digest'];
          gateway.state.live = d === C.LIVE.digest ? 'current' : d === candidateDigest ? 'candidate' : 'unknown';
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
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const STATE_SHAPES = {
  POST_0004: { news: false, rep: 'before', ec: 'before', col: false, cap: false, auth: C.COUNTS.post0004, sweep: 3 },
  POST_0005: { news: true, rep: 'after', ec: 'before', col: true, cap: true, auth: C.COUNTS.post0005, sweep: 3 },
  POST_0006: { news: true, rep: 'after', ec: 'after', col: true, cap: true, auth: C.COUNTS.post0005, sweep: 0 },
  ROLLED_BACK_0005: { news: false, rep: 'before', ec: 'before', col: true, cap: true, auth: C.COUNTS.post0004, sweep: 3 },
  // RAW 0005 applied on POST_0006 (what this tooling refuses): 0005's precondition accepts its own post-state, so the file
  // runs and puts set_tournament_match_dual_control back to its POST_0005 body → a partial 0006.
  RAW_0005_ON_POST_0006: { news: true, rep: 'after', ec: 'after', dualBefore: true, col: true, cap: true, auth: C.COUNTS.post0005, sweep: 0 },
};
/** STATE_SQL output of a given state, built from the rehearsal pin (per-function attributes + the 9 new bodies). */
export function contractState(which, pin) {
  const sh = STATE_SHAPES[which];
  const rep = Object.fromEntries(C.REPLACED_0005.map((r) => [r.fn, r[sh.rep]]));
  const ecp = Object.fromEntries(C.EC_PINS.map((p) => [p.fn, sh.dualBefore && p.fn === C.DUAL_CONTROL_FN ? p.before : p[sh.ec]]));
  const functions = C.ALL_SIGS.map((sig) => {
    const exists = sh.news || !C.NEW_0005.includes(sig);
    const a = pin.function_attrs[sig];
    const body = rep[sig] ?? ecp[sig] ?? pin.new_function_bodies[sig] ?? C.FIX_AFTER[sig] ?? md5(sig);
    return { sig, exists, anon: false, authenticated: exists && a.grantees.includes('authenticated'), service_role: exists && a.grantees.includes('service_role'), public: false,
      server_roles: exists && sig === C.AUTHORIZER ? ['torneos_core_adapter'] : [], grantees: exists ? a.grantees : [], definer: exists ? a.definer : null, search_path_pinned: exists ? a.search_path_pinned : false,
      owner: exists ? a.owner : null, body_md5: exists ? body : null };
  });
  return { server_version: '17.6', read_only: 'on', current_user: 'postgres', functions,
    column: sh.col ? { exists: true, data_type: 'boolean', is_nullable: 'NO', column_default: 'false' } : { exists: false, data_type: null, is_nullable: null, column_default: null },
    invitations: sh.col ? { exists: true, owner: 'postgres', rls: true, policies: 0, client_privileges: [], public_acl: [] } : { exists: false, owner: null, rls: null, policies: 0, client_privileges: [], public_acl: [] },
    capability: sh.cap ? ['owner'] : [], authorize_core_contract: { authenticated: false, anon: false, core_adapter: true },
    counts: { authenticated_public: sh.auth, anon_public: C.COUNTS.anon }, error_sweep: { raises_40001: sh.sweep, raises_ptxyz: sh.sweep ? 0 : 18 },
    data: { organization_members: 3 }, ledger: false, role_settings: { anon: ['statement_timeout=3s'], authenticated: ['statement_timeout=8s'], authenticator: ['statement_timeout=8s'] } };
}
/** Fake catalog pin: the POST_0004 moved paths are the real foundation + COMPETITION-V1 post values; later states are tokens. */
export function fakeDeltaPin(realPin) {
  const foundation = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8')).catalog;
  const states = {};
  for (const key of Object.values(C.STATE_KEYS)) states[key] = Object.fromEntries(C.OEC_CATALOG_PATHS.map((p) => [p, key === 'post_0004' ? (realPin.states.post_0004[p] ?? G.getPath(foundation, p)) : { fake: `${key}-${p}` }]));
  return { ...realPin, purpose: 'unit-test fixture', states };
}
export function fakeDb({ deltaPin }) {
  const foundation = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8')).catalog;
  const payments = P.readDeltaPin();
  const s = { state: 'POST_0004', applied: [], drift: null, failNextApply: false };
  const setPath = (o, p, v) => { const k = p.split('.'); let x = o; for (const part of k.slice(0, -1)) x = x[part]; x[k.at(-1)] = v; };
  const catalog = () => {
    const c = JSON.parse(JSON.stringify(foundation));
    for (const p of G.DELTA_PATHS) setPath(c, p, JSON.parse(JSON.stringify(G.getPath(payments.catalog, p))));
    const key = C.STATE_KEYS[s.state];
    if (key) for (const p of C.OEC_CATALOG_PATHS) setPath(c, p, JSON.parse(JSON.stringify(deltaPin.states[key][p])));
    return c;
  };
  const psql = async ({ script, env }) => {
    if (env.PGOPTIONS !== '-c default_transaction_read_only=on' || env.PGHOST !== C.POOLER_HOST || env.PGSSLMODE !== 'verify-full' || env.PGUSER !== `postgres.${C.TORNEOS_REF}`) return { code: 97, stdout: '', stderr_tail: 'env contract violated' };
    if (!/^BEGIN TRANSACTION READ ONLY;\n[\s\S]+;\nROLLBACK;\n$/.test(script)) return { code: 98, stdout: '', stderr_tail: 'not a read-only script' };
    const body = script.slice('BEGIN TRANSACTION READ ONLY;\n'.length, -';\nROLLBACK;\n'.length);
    let out;
    if (body === C.STATE_SQL) { out = contractState(s.state, deltaPin); if (s.drift) s.drift(out); }
    else if (body === G.CATALOG_SQL) out = catalog();
    else if (body === G.GATEWAY_ROLES_SQL) out = { ...payments.gateway_roles };
    else if (body === P.PAYMENT_ROLES_SQL) out = payments.payment_roles;
    else return { code: 3, stdout: '', stderr_tail: 'unknown query' };
    return { code: 0, stdout: `${JSON.stringify(out)}\n`, stderr_tail: '' };
  };
  // Transitions of the real files (as proven on real Postgres by offline-rehearsal.mjs), including their own refusals.
  const applySql = async ({ sql, env }) => {
    if (env.PGOPTIONS || env.PGHOST !== C.POOLER_HOST) return { code: 97, stderr_tail: 'env contract violated' };
    const h = C.sha256(sql);
    s.applied.push(h);
    if (s.failNextApply) { s.failNextApply = false; return { code: 3, stderr_tail: 'ERROR: TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED' }; }
    const move = {
      [C.M0005.sha256]: { POST_0004: 'POST_0005', POST_0005: 'POST_0005', POST_0006: 'RAW_0005_ON_POST_0006' },
      [C.M0006.sha256]: { POST_0005: 'POST_0006', POST_0006: 'POST_0006', RAW_0005_ON_POST_0006: 'POST_0006' },
      [C.R0006.sha256]: { POST_0006: 'POST_0005', POST_0005: 'POST_0005' },
      [C.R0005.sha256]: { POST_0005: 'ROLLED_BACK_0005', POST_0006: 'DROPPED_ON_POST_0006' },
    }[h];
    if (!move) return { code: 3, stderr_tail: 'unknown file' };
    if (!move[s.state]) return { code: 3, stderr_tail: 'ERROR: precondition failed' };
    s.state = move[s.state];
    return { code: 0, stderr_tail: '' };
  };
  return { psql, applySql, state: s };
}
