// BRANDING-V1 gateway contract, against the real gateway source (the same loader as the CONNECTED-V1 suite: real
// index.ts, stubbed Postgres, emulated Core, PostgREST and Storage) and — MEDIA-STORE-V1 — the REAL torneos-media-store
// function (store.ts) behind its URL, with the hosted configuration. Never touches a network or a database.
// Hosted Storage refuses the bridge's RS256 tokens: the gateway never calls Storage with a user's token; uploads,
// removals and authenticated signatures go through the function, which asks authorize_tournament_storage_objects with
// the caller's token and then uses the service key it alone holds. Public signatures stay anon, on Storage directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../infra/torneos-gateway-auth/bridge-probe.mjs';
import { STORE_SECRET, SECRET_KEY, PUBLISHABLE_KEY, FUNCTION_URL, storeRoute } from '../media-store-v1/test/support.mjs';

const FN = 'backend/torneos/supabase/functions/torneos-gateway/';
const FIX = 'scripts/edge-functions/fixtures/tournament-media/';
const TEST_CA = '-----BEGIN CERTIFICATE-----\nQlJBTkRJTkctVjEtdGVzdC1jYQ==\n-----END CERTIFICATE-----\n';
const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/branding-v1/contract.json', 'utf8'));
const DOC = JSON.parse(fs.readFileSync(FN + 'branding-v1-rpc-allowlist.json', 'utf8'));
const RPCS = Object.values(DOC.features).flat();
const STORAGE = `https://${G.TORNEOS_REF}.supabase.co/storage/v1`;
const ORG = '10000000-0000-4000-8000-000000000001';
const TNT = '20000000-0000-4000-8000-000000000002';
const OWNER = `${ORG}/tournaments/${TNT}`;
const path = (n) => `${OWNER}/3000000${n}-0000-4000-8000-000000000003.png`;
const PNG = new Uint8Array(fs.readFileSync(FIX + 'clean-64x48.png'));
const JPEG = new Uint8Array(fs.readFileSync(FIX + 'clean-64x48.jpg'));

const fresh = () => ({ identity: true, rest: [], storage: [], store: [], authorize: [], restBody: null, refuse: new Set(),
  storageStatus: 200, deny: new Set(), authorizeStatus: 200 });
const world = fresh();
globalThis.__brandingWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  if (q.startsWith('SELECT id FROM public.torneos_identity')) return globalThis.__brandingWorld.identity ? [{ id: params[0] }] : [];
  if (q.startsWith('SET LOCAL ')) return [];
  throw new Error('Unexpected SQL (writes forbidden)');
} }), end: async () => {} }; }`;

let fx, tree, gateway, originalFetch, currentEnv, route;
test.before(async () => {
  fx = fixtureEnv({ caPem: TEST_CA });
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (route && u.startsWith(`${FUNCTION_URL}/`)) {
      world.store.push({ op: u.slice(FUNCTION_URL.length + 4).split('?')[0], identity: init.headers['x-torneos-store-identity'] });
      return route.handle(u, init);
    }
    if (u === G.GATEWAY_TOPOLOGY.coreAuthUrl + '/health') return new Response('{}', { status: 200 });
    if (u === G.GATEWAY_TOPOLOGY.coreContractUrl + '/v1/session') {
      return new Response(JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }), { status: 200 });
    }
    if (u === G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/authorize_tournament_storage_objects') {
      const args = JSON.parse(init.body);
      world.authorize.push({ ...args, authorization: init.headers.authorization, apikey: init.headers.apikey });
      if (world.authorizeStatus !== 200) return new Response('{"message":"TORNEOS_AUTH_REQUIRED"}', { status: world.authorizeStatus });
      return new Response(JSON.stringify(args.p_names.filter((n) => !world.deny.has(`${args.p_operation}:${n}`) && !world.deny.has(`${args.p_operation}:*`))),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith(G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/')) {
      const name = u.slice((G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/').length);
      world.rest.push({ name, authorization: init.headers.authorization ?? null });
      return new Response(JSON.stringify(world.restBody), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith(STORAGE + '/')) {
      const raw = init.body == null ? null : init.body;
      world.storage.push({ url: u.slice(STORAGE.length), method: init.method, headers: init.headers, body: raw });
      if (u === `${STORAGE}/object/sign/tournament-branding`) {
        const { paths, expiresIn } = JSON.parse(raw);
        assert.equal(expiresIn, 3600);
        return new Response(JSON.stringify(paths.map((p) => (world.refuse.has(p)
          ? { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }
          : { path: p, signedURL: `/object/sign/tournament-branding/${p}?token=t-${p.slice(-8)}`, error: null }))), { status: 200 });
      }
      if (init.method === 'DELETE' && u === `${STORAGE}/object/tournament-branding`) {
        return new Response(JSON.stringify(JSON.parse(raw).prefixes.map((name) => ({ name }))), { status: 200 });
      }
      return new Response('{}', { status: world.storageStatus });
    }
    throw new Error('Unexpected network destination ' + u);
  };
  currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on', TORNEOS_MEDIA_STORE_SECRET: STORE_SECRET };
  globalThis.Deno = { env: { toObject: () => currentEnv } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
  route = await storeRoute(tree, (u, i) => globalThis.fetch(u, i));
});
test.after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__brandingWorld; await tree.cleanup(); });
test.beforeEach(() => { Object.assign(world, fresh()); });

const token = () => mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid });
function request(route, { method = 'POST', bearer = token(), body = {}, raw = null, headers = {} } = {}) {
  return new Request(BASE + route, {
    method,
    headers: { host: new URL(BASE).host, origin: G.WEB_ORIGIN, 'content-type': 'application/json',
      ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), ...headers },
    body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body)),
  });
}
const rpc = (name, options) => gateway.handle(request('/torneos/rest/v1/rpc/' + name, options));
const pub = (name, body, options = {}) => gateway.handle(request('/torneos/public/v1/rpc/' + name, { bearer: null, body, ...options }));
const object = (p, options = {}) => gateway.handle(request('/torneos/branding/v1/object/' + p, options));
const upload = (bytes, type, options = {}) => object(OWNER, { raw: bytes, headers: { 'content-type': type, 'content-length': String(bytes.length) }, ...options });
const withSecret = (env) => ({ TORNEOS_MEDIA_STORE_SECRET: STORE_SECRET, ...env });

test('the allowlist is the contract and is disjoint from every other allowlist', () => {
  assert.equal(DOC.phase, 'BRANDING-V1');
  assert.deepEqual(RPCS, CONTRACT.rpcs);
  for (const file of ['staging-v1-rpc-allowlist.json', 'competition-v1-rpc-allowlist.json', 'officialization-v1-rpc-allowlist.json',
    'commerce-test-rpc-allowlist.json', 'social-v1-rpc-allowlist.json', 'connected-v1-rpc-allowlist.json']) {
    const other = JSON.stringify(JSON.parse(fs.readFileSync(FN + file, 'utf8')));
    for (const name of [...RPCS, ...CONTRACT.public_rpcs]) assert.ok(!other.includes(`"${name}"`), `${name} in ${file}`);
  }
});

test('strict opt-in; storage and the media store are only the Torneos project\'s own (derived from its REST URL) or the local lab\'s', async () => {
  const { loadBrandingContract, withBranding, BrandingConfigError, SIGNED_PUBLIC_RPCS, SIGNED_AUTHENTICATED_RPCS } = await tree.import('torneos-gateway/branding.ts');
  const base = new Set(['existing', ...CONTRACT.signed_authenticated_rpcs.filter((name) => !RPCS.includes(name))]);
  const rest = G.GATEWAY_TOPOLOGY.torneosRestUrl;
  for (const env of [{}, { TORNEOS_BRANDING_MODE: '' }, { TORNEOS_BRANDING_MODE: 'off' }]) {
    const contract = loadBrandingContract(env, base, rest, null);
    assert.equal(contract.mode, 'off');
    assert.equal(contract.store, null);
    assert.deepEqual([...withBranding(base, contract)], [...base]);
  }
  const on = loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: 'on' }), base, rest, 'sb_publishable_x');
  assert.deepEqual([on.storageUrl, on.publicBase, on.store.url], [STORAGE, STORAGE, FUNCTION_URL]);
  assert.deepEqual([...withBranding(base, on)].filter((name) => !base.has(name)), RPCS);
  assert.deepEqual([...SIGNED_PUBLIC_RPCS], CONTRACT.signed_public_rpcs);
  assert.deepEqual([...SIGNED_AUTHENTICATED_RPCS], CONTRACT.signed_authenticated_rpcs);
  for (const mode of ['ON', 'true', '1', 'yes', 'on ']) {
    assert.throws(() => loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: mode }), base, rest, 'k'), BrandingConfigError, mode);
    assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_BRANDING_MODE: mode }), BrandingConfigError, `boot ${mode}`);
  }
  for (const env of [
    { TORNEOS_STORAGE_URL: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1' },
    { TORNEOS_STORAGE_PUBLIC_URL: 'https://cdn.example.test' },
    // MEDIA-STORE-V1: the store is the Torneos project's own function, and the shared secret is mandatory and well formed.
    { TORNEOS_MEDIA_STORE_URL: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/torneos-media-store' },
    { TORNEOS_MEDIA_STORE_SECRET: '' },
    { TORNEOS_MEDIA_STORE_SECRET: 'short' },
    { TORNEOS_MEDIA_STORE_SECRET: 'zz'.repeat(32) },
  ]) assert.throws(() => loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: 'on', ...env }), base, rest, 'k'), BrandingConfigError, JSON.stringify(env));
  assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on' }), BrandingConfigError, 'boot without the store secret');
  assert.throws(() => loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: 'on' }), base, rest, null), BrandingConfigError, 'anon key required');
  assert.throws(() => loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: 'on' }), base, 'http://torneos-rest:3000', 'k'), BrandingConfigError, 'lab needs its explicit targets');
  const labEnv = withSecret({ TORNEOS_BRANDING_MODE: 'on', TORNEOS_STORAGE_URL: 'http://torneos-storage:5000', TORNEOS_STORAGE_PUBLIC_URL: 'http://127.0.0.1:58425' });
  assert.throws(() => loadBrandingContract(labEnv, base, 'http://torneos-rest:3000', 'k'), BrandingConfigError, 'lab needs its explicit store URL');
  const lab = loadBrandingContract({ ...labEnv, TORNEOS_MEDIA_STORE_URL: 'http://torneos-functions:9000/torneos-media-store' }, base, 'http://torneos-rest:3000', 'k');
  assert.deepEqual([lab.storageUrl, lab.publicBase, lab.store.url], ['http://torneos-storage:5000', 'http://127.0.0.1:58425', 'http://torneos-functions:9000/torneos-media-store']);
  assert.throws(() => loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: 'on' }), new Set([...base, ...RPCS]), rest, 'k'), BrandingConfigError, 'overlap');
  assert.throws(() => loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: 'on' }), base, rest, 'k', { ...DOC, phase: 'X' }), BrandingConfigError);
  assert.throws(() => loadBrandingContract(withSecret({ TORNEOS_BRANDING_MODE: 'on' }), base, rest, 'k', undefined, new Set(['get_public_tournament_branding'])),
    BrandingConfigError, 'public overlap');
});

test('boot: BRANDING adds exactly its two RPCs; off serves none, no object route, no public logos', async () => {
  const off = gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on' });
  const on = gateway.boot(withSecret({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on' }));
  assert.deepEqual([...on.rpcAllowlist].filter((name) => !off.rpcAllowlist.has(name)), RPCS);
  assert.equal(off.branding.mode, 'off');
  const saved = currentEnv;
  currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on' };
  const offTree = await loadGatewayTree({ postgresModule: stub });
  try {
    const offGateway = await offTree.import('torneos-gateway/index.ts');
    assert.equal((await offGateway.handle(request('/torneos/branding/v1/object/' + OWNER, { raw: PNG, headers: { 'content-type': 'image/png' } }))).status, 404);
    assert.equal((await offGateway.handle(request('/torneos/branding/v1/object/' + path(1), { method: 'DELETE', raw: null }))).status, 404);
    assert.equal((await offGateway.handle(request('/torneos/public/v1/rpc/get_public_tournament_branding', { bearer: null, body: { p_public_slug: 'copa-x' } }))).status, 403);
    world.restBody = { items: [{ logoPath: path(1) }] };
    const untouched = await offGateway.handle(request('/torneos/public/v1/rpc/search_tournament_catalog', { bearer: null, body: { p_query: 'copa' } }));
    assert.deepEqual(await untouched.json(), { items: [{ logoPath: path(1) }] }, 'off: the response is untouched');
    assert.equal(world.storage.length + world.store.length, 0);
  } finally {
    currentEnv = saved;
    await offTree.cleanup();
  }
});

test('public responses: ONE anon signature batch on Storage directly (publishable key as apikey only); refused paths stay without URL', async () => {
  world.restBody = { items: [{ logoPath: path(1), organizationLogoPath: path(2) }, { logoPath: path(1), organizationLogoPath: null }], total: 2 };
  world.refuse = new Set([path(2)]);
  const r = await pub('search_tournament_catalog', { p_query: 'copa' });
  assert.equal(r.status, 200);
  const signs = world.storage.filter((call) => call.url === '/object/sign/tournament-branding');
  assert.equal(signs.length, 1, 'one batch per response, whatever the number of cards');
  assert.deepEqual(JSON.parse(signs[0].body).paths, [path(1), path(2)], 'each path once');
  assert.equal(signs[0].headers.authorization, undefined, 'a publishable key is never a bearer');
  assert.equal(signs[0].headers.apikey, fx.env.TORNEOS_ANON_KEY);
  assert.equal(world.store.length, 0, 'the public never goes through the media store (no identity, no service key)');
  const json = await r.json();
  assert.equal(json.items[0].logoUrl, `${STORAGE}/object/sign/tournament-branding/${path(1)}?token=t-${path(1).slice(-8)}`);
  assert.equal(json.items[0].organizationLogoUrl, null, 'refused by storage RLS → no URL (initials)');
  assert.equal(json.items[1].organizationLogoUrl, null);
});

test('public page logos: exact slug body, projected to names and logos (no internal ids)', async () => {
  world.restBody = { organization: { id: ORG, name: 'Liga', logoPath: path(2) }, tournament: { id: TNT, name: 'Copa', logoPath: path(1) } };
  const r = await pub('get_public_tournament_branding', { p_public_slug: 'liga-copa' });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.deepEqual(Object.keys(json.tournament).sort(), ['logoPath', 'logoUrl', 'name']);
  assert.equal(json.tournament.id, undefined);
  assert.ok(json.organization.logoUrl.endsWith(`?token=t-${path(2).slice(-8)}`));
  for (const body of [{}, { p_public_slug: 'Liga Copa' }, { p_public_slug: 'liga-copa', extra: 1 }]) {
    assert.equal((await pub('get_public_tournament_branding', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await gateway.handle(request('/torneos/public/v1/rpc/get_public_tournament_branding', { body: { p_public_slug: 'liga-copa' } }))).status, 400,
    'no credential on the public route');
});

test('authenticated responses: signed through the media store for the caller (database decides), never with the caller\'s token on Storage', async () => {
  world.restBody = { entry: { shieldPath: path(3) }, other: { shieldPath: path(4) } };
  world.deny = new Set([`read:${path(4)}`]);
  const bearer = token();
  const r = await rpc('get_team_registration_context', { bearer, body: { p_organization_id: ORG, p_team_entry_id: TNT } });
  assert.equal(r.status, 200);
  assert.deepEqual(world.store.map((call) => [call.op, call.identity]), [['branding-sign', bearer]]);
  assert.deepEqual(world.authorize.map((a) => [a.p_bucket, a.p_operation, a.p_names, a.authorization, a.apikey]),
    [['tournament-branding', 'read', [path(3), path(4)], `Bearer ${bearer}`, PUBLISHABLE_KEY]]);
  const [sign] = world.storage;
  assert.deepEqual(JSON.parse(sign.body).paths, [path(3)], 'only what the database allowed is signed');
  assert.deepEqual([sign.headers.apikey, sign.headers.authorization], [SECRET_KEY, undefined], 'the service key, as apikey only');
  const json = await r.json();
  assert.ok(json.entry.shieldUrl.includes(path(3)));
  assert.equal(json.other.shieldUrl, null);
  world.storage.length = 0; world.store.length = 0;
  world.restBody = { logoPath: path(1) };
  const other = await rpc('get_tournament_competition_context', { body: { p_organization_id: ORG } });
  assert.deepEqual(await other.json(), { logoPath: path(1) }, 'outside the signed set nothing is added');
  assert.equal(world.storage.length + world.store.length, 0);
});

test('upload: the server names the object (real type), the database decides, the service key writes (no upsert); the browser never names it', async () => {
  const bearer = token();
  const ok = await upload(PNG, 'image/png', { bearer });
  assert.equal(ok.status, 200);
  const { path: stored } = await ok.json();
  assert.match(stored, new RegExp(`^${OWNER}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`));
  assert.deepEqual(world.authorize.map((a) => [a.p_operation, a.p_names, a.authorization]), [['write', [stored], `Bearer ${bearer}`]]);
  const [put] = world.storage;
  assert.deepEqual([put.url, put.method, put.headers.apikey, put.headers.authorization, put.headers['x-upsert'], put.headers['content-type']],
    [`/object/tournament-branding/${stored}`, 'POST', SECRET_KEY, undefined, 'false', 'image/png']);
  // The extension follows the REAL bytes: a JPEG declared as JPEG becomes .jpg.
  world.storage.length = 0; world.authorize.length = 0;
  const jpeg = await upload(JPEG, 'image/jpeg');
  assert.match((await jpeg.json()).path, /\.jpg$/);
  // Two uploads never share a name.
  assert.notEqual((await (await upload(PNG, 'image/png')).json()).path, stored);
});

test('upload refusals: database, real type, size, a browser-chosen name, no bearer — and nothing reaches Storage', async () => {
  world.deny = new Set(['write:*']);
  const refused = await upload(PNG, 'image/png');
  assert.deepEqual([refused.status, (await refused.json()).error], [403, 'TORNEOS_BRANDING_FORBIDDEN'], 'another organization / no capability');
  world.deny = new Set();
  const spoofed = await upload(JPEG, 'image/png');
  assert.deepEqual([spoofed.status, (await spoofed.json()).error], [415, 'TORNEOS_BRANDING_INVALID_TYPE'], 'JPEG bytes declared as PNG');
  for (const fixture of ['payload.svg', 'sample-8x8.gif', 'animated-16x16.png', 'exif-orient6-64x48.jpg']) {
    const bytes = new Uint8Array(fs.readFileSync(FIX + fixture));
    const type = fixture.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    assert.equal((await upload(bytes, type)).status, 415, fixture);
  }
  assert.equal((await upload(PNG, 'image/gif')).status, 415, 'type outside the bucket');
  assert.equal((await object(OWNER, { raw: PNG, headers: { 'content-type': 'image/png', 'content-length': String(3 * 1024 * 1024) } })).status, 413);
  const named = await object(path(6), { raw: PNG, headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } });
  assert.deepEqual([named.status, (await named.json()).error], [400, 'TORNEOS_BRANDING_INVALID_REFERENCE'], 'a name chosen by the browser');
  assert.equal((await object(`${ORG}/tournaments/${TNT}/x.png`, { raw: PNG, headers: { 'content-type': 'image/png' } })).status, 404);
  assert.equal((await object(`${ORG}/clubs/${TNT}`, { raw: PNG, headers: { 'content-type': 'image/png' } })).status, 404);
  assert.equal((await upload(PNG, 'image/png', { bearer: null })).status, 401);
  assert.equal(world.storage.length, 0, 'nothing reached Storage');
  world.authorizeStatus = 401;
  assert.equal((await upload(PNG, 'image/png')).status, 403, 'no identity for the database');
  world.authorizeStatus = 200;
  world.storageStatus = 409;
  assert.equal((await upload(PNG, 'image/png')).status, 409, 'an existing object is never overwritten');
});

test('removal: only through the store, only what the database allows (not referenced anywhere), one object at a time', async () => {
  const bearer = token();
  const removed = await object(path(4), { method: 'DELETE', raw: null, bearer });
  assert.deepEqual([removed.status, await removed.json()], [200, { removed: true }]);
  assert.deepEqual(world.authorize.map((a) => [a.p_operation, a.p_names]), [['delete', [path(4)]]]);
  const [del] = world.storage;
  assert.deepEqual([del.method, del.url, JSON.parse(del.body), del.headers.apikey], ['DELETE', '/object/tournament-branding', { prefixes: [path(4)] }, SECRET_KEY]);
  world.storage.length = 0;
  world.deny = new Set([`delete:${path(5)}`]);
  const inUse = await object(path(5), { method: 'DELETE', raw: null });
  assert.deepEqual([inUse.status, (await inUse.json()).error], [403, 'TORNEOS_BRANDING_FORBIDDEN'], 'referenced (or not ours): refused');
  assert.equal(world.storage.length, 0);
});

test('the media store refuses anything not signed by the gateway: no signature, a stale one, another identity, another body', async () => {
  const { store, config } = route;
  const { sign, signingInput } = await tree.import('torneos-gateway/media-store-protocol.ts');
  const identity = token();
  const body = new TextEncoder().encode(JSON.stringify({ path: path(1) }));
  const now = Math.floor(Date.now() / 1000);
  const call = async ({ ts = now, id = identity, signedBody = body, sentBody = body, secret = config.secret } = {}) => {
    const signature = await sign(secret, await signingInput('POST', '/torneos-media-store/v1/branding-delete', '', String(ts), signedBody, identity));
    const res = await store.handle(new Request('https://x.supabase.co/torneos-media-store/v1/branding-delete', {
      method: 'POST', body: sentBody,
      headers: { 'content-type': 'application/json', 'x-torneos-store-identity': id, 'x-torneos-store-timestamp': String(ts), 'x-torneos-store-signature': signature },
    }), config, { fetchImpl: (u, i) => globalThis.fetch(u, i) });
    return res.status;
  };
  assert.equal(await call(), 200, 'the genuine call');
  assert.equal(await call({ ts: now - 61 }), 401, 'stale');
  assert.equal(await call({ id: token() }), 401, 'another identity under the same signature');
  assert.equal(await call({ sentBody: new TextEncoder().encode(JSON.stringify({ path: path(2) })) }), 401, 'another body');
  assert.equal(await call({ secret: new Uint8Array(32) }), 401, 'another secret');
  const unsigned = await store.handle(new Request('https://x.supabase.co/torneos-media-store/v1/branding-delete', { method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-torneos-store-identity': identity } }), config);
  assert.equal(unsigned.status, 401, 'a browser with its own bridge token cannot call it');
  const res = await store.handle(new Request('https://x.supabase.co/torneos-media-store/v1/list', { method: 'POST' }), config);
  assert.equal(res.status, 404, 'no other operation exists');
});
