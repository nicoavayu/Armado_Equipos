// GATEWAY REMOTE — offline tests: Deno API allowlist, deployed source graph, the Production env (validated by the real
// config.ts), the Core public key source, the B7 probe set and C4 fault injection against the REAL gateway handle()
// (Core Production emulated in-process), and the session's create → publish-url flow against a fake Deno API.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { generateRing, jwksPinDocument } from '../torneos-gateway-auth/keyring.mjs';
import { validateGatewayEnvWithRealConfig } from '../torneos-gateway-auth/gateway-auth.mjs';
import { loadGatewayTree } from '../torneos-gateway-auth/gateway-loader.mjs';
import { mintBridgeToken } from '../torneos-gateway-auth/bridge-probe.mjs';
import * as R from './remote-contract.mjs';
import { buildAssets, moduleGraph } from './gateway-bundle.mjs';
import { buildGatewayEnv, denoEnvVars, describeEnv, fetchCoreAnonKey, publicUrlForHost, PENDING_PUBLIC_URL } from './gateway-env.mjs';
import { probeGateway } from './gateway-probe.mjs';
import { makeSession } from './remote-session.mjs';

test('browser E2E script parses and targets only the app origin, the gateway and Torneos PostgREST (ref = contract)', async () => {
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('./browser-e2e.js', import.meta.url), 'utf8');
  new vm.Script(src);
  const refs = [...src.matchAll(/const TORNEOS_REF = '([a-z0-9]+)';/g)].map((m) => m[1]);
  assert.deepEqual(refs, [G.TORNEOS_REF]);
  assert.ok(src.includes('const REST = `https://${TORNEOS_REF}.supabase.co/rest/v1`;'));
  const resolved = src.replaceAll('${TORNEOS_REF}', G.TORNEOS_REF);
  const hosts = [...new Set([...resolved.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(hosts, ['app.arma2.com.ar', `${G.TORNEOS_REF}.supabase.co`, 'torneos-gateway.nicoavayu.deno.net']);
});

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (claims) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(claims)}.${crypto.randomBytes(32).toString('base64url')}`;
const CORE_ANON = fakeJwt({ iss: 'supabase', ref: G.CORE_PROD_REF, role: 'anon', iat: 1, exp: 2 });
const TORNEOS_PUB = `sb_publishable_${crypto.randomBytes(18).toString('base64url')}`;
const CA = fs.readFileSync('/Users/nicoavayu/Downloads/prod-ca-2021.crt', 'utf8');
const HOST = 'torneos-gateway.arma2-torneos.deno.net';
const BASE = `https://${HOST}/functions/v1/torneos-gateway`;
const POOLER = 'aws-0-sa-east-1.pooler.supabase.com';

const ring = generateRing();
const pin = jwksPinDocument(ring.jwks, { generatedAt: '2026-09-25T00:00:00.000Z' });
const passwords = Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, crypto.randomBytes(30).toString('base64url')]));
const contractSecret = crypto.randomBytes(32).toString('hex');
const envFor = (publicUrl) => buildGatewayEnv({ publicUrl, poolerHost: POOLER, jwksPin: pin, k1Pkcs8: ring.slots[0].pkcs8, torneosAnonKey: TORNEOS_PUB, coreAnonKey: CORE_ANON, caPem: CA, contractSecret, passwords });

test('Deno API allowlist: reads only on the one app, writes only armed, bodies pinned', () => {
  assert.equal(R.classifyDenoRequest({ method: 'GET', path: '/v2/apps?limit=100' }).kind, 'read');
  assert.throws(() => R.classifyDenoRequest({ method: 'GET', path: '/v2/apps/other-app' }), /not_allowlisted/);
  assert.throws(() => R.classifyDenoRequest({ method: 'DELETE', path: '/v2/apps/torneos-gateway' }), /not_allowlisted/);
  assert.throws(() => R.classifyDenoRequest({ method: 'POST', path: '/v2/layers', body: {} }), /not_allowlisted/);
  const env = envFor(PENDING_PUBLIC_URL);
  const create = { slug: R.APP_SLUG, labels: {}, layers: [], env_vars: denoEnvVars(env, { omit: ['TORNEOS_GATEWAY_PUBLIC_URL'] }), config: R.APP_CONFIG };
  assert.throws(() => R.classifyDenoRequest({ method: 'POST', path: '/v2/apps', body: create }), /not_armed/);
  assert.equal(R.classifyDenoRequest({ method: 'POST', path: '/v2/apps', body: create }, { armedFor: 'app-create' }).kind, 'write:app-create');
  assert.throws(() => R.classifyDenoRequest({ method: 'POST', path: '/v2/apps', body: create }, { armedFor: 'deploy' }), /not_armed/);
  for (const bad of [
    { ...create, slug: 'other' }, { ...create, layers: ['shared'] }, { ...create, config: { ...R.APP_CONFIG, build: 'npm run build' } },
    { ...create, env_vars: [...create.env_vars, { key: 'MERCADO_PAGO_TEST_ACCESS_TOKEN', value: 'x', secret: true, contexts: 'all' }] },
    { ...create, env_vars: [...create.env_vars, { key: 'SUPABASE_DB_URL', value: 'x', secret: true, contexts: 'all' }] },
    { ...create, env_vars: [...create.env_vars, { key: 'PGPASSWORD', value: 'x', secret: true, contexts: 'all' }] },
    { ...create, env_vars: [...create.env_vars, { key: 'CORE_SERVICE_ROLE_KEY', value: 'x', secret: true, contexts: 'all' }] },
    { ...create, env_vars: [...create.env_vars, { key: 'TORNEOS_COMMERCE_MODE', value: 'test', secret: false, contexts: 'all' }] },
    { ...create, env_vars: create.env_vars.map((e) => (e.key === 'TORNEOS_BRIDGE_KEYS' ? { ...e, secret: false } : e)) },
    { ...create, env_vars: create.env_vars.map((e) => ({ ...e, contexts: ['preview'] })) },
    { ...create, env_vars: create.env_vars.slice(1) },
  ]) assert.throws(() => R.assertDenoWriteBody('app-create', bad));
  assert.ok(R.assertDenoWriteBody('app-env', { env_vars: denoEnvVars({ TORNEOS_GATEWAY_PUBLIC_URL: BASE }) }));
  assert.throws(() => R.assertDenoWriteBody('app-env', { env_vars: denoEnvVars({ TORNEOS_GATEWAY_PUBLIC_URL: BASE, CORE_ANON_KEY: CORE_ANON }) }), /only_public_url/);
  const assets = buildAssets({ requireClean: false }).assets;
  assert.ok(R.assertDenoWriteBody('deploy', { assets, labels: {}, production: true, preview: false }));
  assert.throws(() => R.assertDenoWriteBody('deploy', { assets, labels: {}, production: true, preview: true }), /timelines/);
  assert.throws(() => R.assertDenoWriteBody('deploy', { assets: { ...assets, 'torneos-payments/config.ts': { kind: 'file', encoding: 'utf-8', content: '' } }, labels: {}, production: true, preview: false }), /outside_graph/);
  assert.throws(() => R.assertDenoWriteBody('deploy', { assets: { ...assets, 'torneos-gateway/leak.ts': { kind: 'file', encoding: 'utf-8', content: `const k = "${passwords.torneos_edge_core_adapter}"; const u = "postgres://a:${passwords.torneos_edge_core_adapter}@h/p"` } }, labels: {}, production: true, preview: false }), /secret_shaped/);
});

test('deployed source = the gateway module graph (30 files, jose/postgres pins), never payments config or the MP provider', () => {
  const g = moduleGraph();
  // COMPETITION-V1: 14 + competition.ts and its allowlist (competition-v1-rpc-allowlist.json);
  // OFFICIALIZATION-V1: + officialization-v1-rpc-allowlist.json (loaded by competition.ts);
  // PLAN READ: + plan-read.ts (imported by index.ts, default OFF);
  // SOCIAL-V1: + social.ts and social-v1-rpc-allowlist.json (imported by index.ts, TORNEOS_SOCIAL_MODE default OFF).
  // CONNECTED-V1: + connected.ts, connected-v1-rpc-allowlist.json and my-teams.schema.json (Core contract v1.2, loaded by
  // core-client.ts), TORNEOS_CONNECTED_MODE default OFF.
  // BRANDING-V1: + branding.ts and branding-v1-rpc-allowlist.json (imported by index.ts, TORNEOS_BRANDING_MODE default OFF).
  // MEDIA-V1: + media.ts, media-image.ts, media-contract.ts (verbatim copies of the pipeline verifier: _shared is never in
  // the graph) and media-v1-rpc-allowlist.json (imported by index.ts, TORNEOS_MEDIA_MODE default OFF).
  // COMMERCE-PRODUCTION: + commerce-production-rpc-allowlist.json (loaded by commerce.ts, TORNEOS_COMMERCE_MODE default OFF).
  assert.equal(g.files.length, 30);
  assert.ok(['torneos-gateway/competition.ts', 'torneos-gateway/competition-v1-rpc-allowlist.json', 'torneos-gateway/officialization-v1-rpc-allowlist.json', 'torneos-gateway/plan-read.ts', 'torneos-gateway/social.ts', 'torneos-gateway/social-v1-rpc-allowlist.json',
    'torneos-gateway/connected.ts', 'torneos-gateway/connected-v1-rpc-allowlist.json', 'torneos-gateway/my-teams.schema.json',
    'torneos-gateway/branding.ts', 'torneos-gateway/branding-v1-rpc-allowlist.json',
    'torneos-gateway/media.ts', 'torneos-gateway/media-image.ts', 'torneos-gateway/media-contract.ts', 'torneos-gateway/media-v1-rpc-allowlist.json', 'torneos-gateway/commerce-production-rpc-allowlist.json'].every((f) => g.files.includes(f)));
  assert.deepEqual(g.bare, ['npm:jose@6.2.12', 'npm:postgres@3.4.7']);
  assert.ok(g.files.every((f) => f.startsWith('torneos-gateway/') || ['torneos-payments/hmac.ts', 'torneos-payments/remote-hosts.ts'].includes(f)));
  assert.ok(!g.files.some((f) => /_shared|torneos-payments\/(config|handler|index|db)\.ts/.test(f)));
});

test('Production env: exact names, validated by the real config.ts (production topology, commerce off, ring = pin); forbidden material refused', async () => {
  const env = envFor(BASE);
  assert.deepEqual(Object.keys(env).sort(), [...R.ENV_NAMES]);
  const v = await validateGatewayEnvWithRealConfig(env);
  assert.equal(v.topology.kind, 'production'); assert.equal(v.commerce, 'off');
  assert.equal(v.activeKid, pin.active); assert.deepEqual(v.trustedKids, [pin.active, pin.standby]);
  assert.equal(v.allowedOrigin, 'https://app.arma2.com.ar');
  // A Supabase / Edge Function host for the gateway itself is refused by the real topology.
  await assert.rejects(validateGatewayEnvWithRealConfig({ ...env, TORNEOS_GATEWAY_PUBLIC_URL: `https://${G.TORNEOS_REF}.supabase.co/functions/v1/torneos-gateway` }));
  await assert.rejects(validateGatewayEnvWithRealConfig({ ...env, TORNEOS_COMMERCE_MODE: 'test' }));
  await assert.rejects(validateGatewayEnvWithRealConfig({ ...env, CORE_SERVICE_ROLE_KEY: 'x' }));
  assert.throws(() => buildGatewayEnv({ publicUrl: BASE, poolerHost: POOLER, jwksPin: pin, k1Pkcs8: ring.slots[0].pkcs8, torneosAnonKey: TORNEOS_PUB, coreAnonKey: fakeJwt({ iss: 'supabase', ref: G.CORE_PROD_REF, role: 'service_role' }), caPem: CA, contractSecret, passwords }), /anon/);
  assert.throws(() => buildGatewayEnv({ publicUrl: BASE, poolerHost: 'aws-0-us-east-1.pooler.supabase.com', jwksPin: pin, k1Pkcs8: ring.slots[0].pkcs8, torneosAnonKey: TORNEOS_PUB, coreAnonKey: CORE_ANON, caPem: CA, contractSecret, passwords }), /pooler/);
  // Evidence description never carries a secret value.
  const text = JSON.stringify(describeEnv(env));
  assert.deepEqual(G.secretFindings(text, [contractSecret, ...Object.values(passwords), ring.slots[0].pkcs8, env.TORNEOS_BRIDGE_KEYS, env.TORNEOS_DB_CORE_ADAPTER_URL]), []);
  assert.equal(publicUrlForHost(HOST), BASE);
  assert.throws(() => publicUrlForHost('evil.deno.net'));
  assert.throws(() => publicUrlForHost('torneos-gateway.org.supabase.co'));
});

test('Core anon key: exactly one Core Production anon key from the public bundle; service_role / other ref refused', async () => {
  const page = '<script defer="defer" src="/static/js/main.0123abcd.js"></script>';
  const other = fakeJwt({ iss: 'supabase', ref: 'hhyvmhgpapyuzjgxfnqv', role: 'anon' });
  const r = await fetchCoreAnonKey({ fetchText: async (u) => (u.endsWith('.js') ? `a="${CORE_ANON}";b="${other}"` : page) });
  assert.equal(r.key, CORE_ANON); assert.equal(r.source.kind, 'legacy-anon');
  await assert.rejects(fetchCoreAnonKey({ fetchText: async (u) => (u.endsWith('.js') ? `a="${CORE_ANON}";b="${fakeJwt({ iss: 'supabase', ref: G.CORE_PROD_REF, role: 'anon', x: 1 })}"` : page) }), /count_2/);
  await assert.rejects(fetchCoreAnonKey({ fetchText: async (u) => (u.endsWith('.js') ? `a="${fakeJwt({ iss: 'supabase', ref: G.CORE_PROD_REF, role: 'service_role' })}"` : page) }), /count_0/);
});

// ── the REAL gateway handle(), Core Production emulated in-process ──
async function realGateway(env) {
  const tree = await loadGatewayTree();
  const core = { mode: 'ok', calls: [] };
  const realFetch = globalThis.fetch;
  globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    core.calls.push(u.replace(/\?.*$/, ''));
    if (core.mode === 'unreachable') throw new TypeError('fetch failed');
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/health`) return new Response('{}', { status: core.mode === 'auth-down' ? 503 : 200 });
    if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/user`) return new Response('{"msg":"bad jwt"}', { status: 401 });
    if (u === `${G.GATEWAY_TOPOLOGY.coreContractUrl}/v1/session`) return new Response('{"error":"FORBIDDEN"}', { status: core.mode === 'contract-5xx' ? 503 : 403 });
    return new Response('{}', { status: 599 });
  };
  const idx = await tree.import('torneos-gateway/index.ts');
  const transport = async ({ url, method = 'GET', headers = {}, body }) => {
    const u = new URL(url);
    const req = new Request(url, { method, headers: { ...headers, host: u.host, 'x-forwarded-host': u.host }, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
    const res = await idx.handle(req);
    const raw = await res.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
    return { status: res.status, headers: Object.fromEntries(res.headers), json, raw };
  };
  return { transport, core, cleanup: async () => { globalThis.fetch = realFetch; delete globalThis.Deno; await tree.cleanup(); } };
}

test('B7 probe set passes against the real gateway (Production topology, emulated Core), and C4 fault injection → 503', async () => {
  const env = envFor(BASE);
  const gw = await realGateway(env);
  try {
    const known = [contractSecret, ...Object.values(passwords), ring.slots[0].pkcs8, ring.slots[1].pkcs8, env.TORNEOS_BRIDGE_KEYS];
    const r = await probeGateway({ base: BASE, jwksPin: pin, ring: { k1: { pkcs8: ring.slots[0].pkcs8, kid: pin.active } }, known, torneosAnonKey: TORNEOS_PUB, transport: gw.transport, alternateHosts: ['torneos-gateway-r2abc.arma2-torneos.deno.net'] });
    const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.name} → ${c.status} ${c.error}`);
    assert.deepEqual(failed, []);
    assert.ok(r.total >= 25);
    // C4: Core faults, measured on an allowlisted RPC with a valid k1 bridge token (no identity, no DB reached).
    const now = Math.floor(Date.now() / 1000);
    const tok = mintBridgeToken({ pkcs8: ring.slots[0].pkcs8, kid: pin.active, now, overrides: { sub: crypto.randomUUID(), core_user_id: crypto.randomUUID() } });
    const rpc = () => gw.transport({ url: `${BASE}/torneos/rest/v1/rpc/get_my_tournament_memberships`, method: 'POST', headers: { origin: G.WEB_ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: '{}' });
    gw.core.mode = 'contract-5xx'; const a = await rpc();
    assert.equal(a.status, 503); assert.equal(a.json.error, 'CORE_UNAVAILABLE');
    gw.core.mode = 'auth-down'; const b = await rpc();
    assert.equal(b.status, 503);
    gw.core.mode = 'unreachable'; const c = await rpc();
    assert.equal(c.status, 503);
    const h = await gw.transport({ url: `${BASE}/health`, headers: { origin: G.WEB_ORIGIN } });
    assert.equal(h.status, 503);
    gw.core.mode = 'ok'; const d = await rpc();
    assert.equal(d.status, 401);
  } finally { await gw.cleanup(); }
});

// ── the session flow against a fake Deno API ──
function fakeDeno() {
  const s = { app: null, revisions: [], writes: [] };
  const transport = async ({ method, path: p, body }) => {
    if (method === 'GET' && p === '/v2/apps?limit=100') return { status: 200, body: s.app ? [{ id: 'app-1', slug: s.app.slug }] : [] };
    if (method === 'GET' && p === '/v2/layers') return { status: 200, body: [] };
    if (method === 'GET' && p === '/v2/apps/torneos-gateway') return s.app ? { status: 200, body: s.app } : { status: 404, body: { code: 'appNotFound' } };
    if (method === 'GET' && p.startsWith('/v2/apps/torneos-gateway/revisions')) return { status: 200, body: s.revisions.slice().reverse() };
    const rev = /^\/v2\/revisions\/([\w-]+)(\/timelines)?$/.exec(p);
    if (method === 'GET' && rev) {
      const r = s.revisions.find((x) => x.id === rev[1]);
      if (rev[2]) return { status: 200, body: [{ slug: 'production', partition: {}, domains: [{ domain: HOST }] }] };
      return { status: 200, body: { ...r, status: 'succeeded', timelines: [{ name: 'Production', context: 'production', hostnames: [HOST, `torneos-gateway-${r.id}.arma2-torneos.deno.net`] }] } };
    }
    s.writes.push(`${method} ${p}`);
    if (method === 'POST' && p === '/v2/apps') { s.app = { id: 'app-1', slug: body.slug, layers: [], config: body.config, env_vars: body.env_vars.map((e) => ({ id: e.key, key: e.key, secret: e.secret, contexts: e.contexts, ...(e.secret ? {} : { value: e.value }) })), created_at: 'x', updated_at: 'x' }; return { status: 200, body: s.app }; }
    if (method === 'PATCH' && p === '/v2/apps/torneos-gateway') { for (const e of body.env_vars) s.app.env_vars.push({ id: e.key, key: e.key, secret: e.secret, contexts: e.contexts, value: e.value }); return { status: 200, body: s.app }; }
    if (method === 'POST' && p === '/v2/apps/torneos-gateway/deploy') { const r = { id: `rev${s.revisions.length + 1}`, status: 'queued', env_vars: [], layers: [], config: s.app.config }; s.revisions.push(r); return { status: 202, body: r }; }
    return { status: 500, body: null };
  };
  return { s, transport };
}
function fakeMgmt() {
  return async ({ method, path: p }) => {
    if (p.endsWith('/config/database/pooler')) return { status: 200, body: [{ db_host: POOLER, pool_mode: 'transaction' }] };
    if (p.includes('/api-keys')) return { status: 200, body: [{ name: 'default', type: 'publishable', api_key: TORNEOS_PUB }, { name: 'default', type: 'secret', api_key: 'sb_secret_xxxxxxxxxxxxxxxx' }] };
    if (p.endsWith('/functions')) return { status: 200, body: [] };
    return { status: 404, body: null, method };
  };
}
const fakeKeychain = () => ({ ring: { read: (slot) => ring.slots.find((x) => x.slot === slot).pkcs8 }, dbLogin: (login) => ({ read: () => passwords[login] }) });

test('session: create → publish-url needs the exact PLAN phrase for each; a wrong phrase writes nothing; the pin and evidence carry no secret', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-remote-test-'));
  const pinFile = path.join(tmp, 'pin.json');
  fs.writeFileSync(path.join(tmp, 'jwks.json'), JSON.stringify(pin));
  const deno = fakeDeno();
  const lines = []; const out = [];
  const deps = {
    say: (s) => out.push(s), readLine: () => lines.shift() ?? 'nothing', transport: fakeMgmt(), denoTransport: deno.transport, keychain: fakeKeychain, contractKeychain: () => ({ read: () => contractSecret }),
    fetchCoreAnonKey: async () => ({ key: CORE_ANON, source: { kind: 'legacy-anon' } }), readCaPem: () => CA, validateGatewayEnv: validateGatewayEnvWithRealConfig,
    buildAssets: () => buildAssets({ requireClean: false }), probeGateway, now: () => Date.now(), sleep: async () => {}, pollMs: 1, evidenceDir: path.join(tmp, 'ev'), deployPinFile: pinFile, jwksPinFile: path.join(tmp, 'jwks.json'), gaDeps: {},
  };
  try {
    const session = makeSession({ pat: `sbp_${'a'.repeat(40)}`, deno: `ddo_${'b'.repeat(40)}`, deps });
    lines.push('CREATE TORNEOS GATEWAY DENO APP torneos-gateway 000000000000');
    await assert.rejects(session.run('create'), (e) => e.code === 'NOT_AUTHORIZED');
    assert.deepEqual(deno.s.writes, []);
    // The right phrase: read the plan id from the transcript, as the operator does.
    const id = /PLAN ([0-9a-f]{12}): create/.exec(out.join('\n'))[1];
    lines.push(R.PHRASES.create(id));
    const c = await session.run('create');
    assert.equal(c.verdict, 'DENO_APP_CREATED_R1_LIVE');
    assert.deepEqual(deno.s.writes, ['POST /v2/apps', 'POST /v2/apps/torneos-gateway/deploy']);
    assert.ok(!deno.s.app.env_vars.some((e) => e.key === 'TORNEOS_GATEWAY_PUBLIC_URL'));
    await assert.rejects(session.run('create'), (e) => e.code === 'DENO_APP_ALREADY_EXISTS');
    const out2 = out.length;
    lines.push('DEPLOY TORNEOS GATEWAY torneos-gateway wrong');
    await assert.rejects(session.run('publish-url'), (e) => e.code === 'NOT_AUTHORIZED');
    assert.equal(deno.s.writes.length, 2);
    const id2 = /PLAN ([0-9a-f]{12}): TORNEOS_GATEWAY_PUBLIC_URL = (\S+)/.exec(out.slice(out2).join('\n'));
    assert.equal(id2[2], BASE);
    lines.push(R.PHRASES.deploy(id2[1]));
    const p = await session.run('publish-url');
    assert.equal(p.verdict, 'GATEWAY_DEPLOYED_R2');
    assert.deepEqual(deno.s.writes.slice(2), ['PATCH /v2/apps/torneos-gateway', 'POST /v2/apps/torneos-gateway/deploy']);
    const pinText = fs.readFileSync(pinFile, 'utf8');
    const secrets = [contractSecret, ...Object.values(passwords), ring.slots[0].pkcs8, ring.slots[1].pkcs8, `sbp_${'a'.repeat(40)}`, `ddo_${'b'.repeat(40)}`];
    assert.deepEqual(G.secretFindings(pinText, secrets), []);
    assert.equal(JSON.parse(pinText).public_url, BASE);
    for (const f of fs.readdirSync(path.join(tmp, 'ev'))) assert.deepEqual(G.secretFindings(fs.readFileSync(path.join(tmp, 'ev', f), 'utf8'), secrets), [], f);
    assert.deepEqual(G.secretFindings(out.join('\n'), secrets), []);
    await assert.rejects(session.run('ga --auth-lockdown'), (e) => e.code === 'GA_MODE_NOT_IN_SESSION');
    await assert.rejects(session.run('rm -rf /'), (e) => e.code === 'COMMAND_REFUSED' || e.code === 'COMMAND_UNKNOWN');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('session PAT text: the union of the session modes (reads + Auth Config Read-write), org-scoped, 24 h', () => {
  const t = R.sessionPatText();
  assert.match(t, /Organization gwqrborhnqjdzzmpxulh, expiry 24 hours/);
  assert.match(t, /Auth Config: Read-write/);
  assert.doesNotMatch(t, /Project Settings: Read-write/);
  assert.doesNotMatch(t, /Auth Config: Read$/m);
});
