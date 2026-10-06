// BRANDING-V1 gateway contract, against the real gateway source (the same loader as the CONNECTED-V1 suite: real
// index.ts, stubbed Postgres, emulated Core, PostgREST and Storage). Never touches a network or a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../infra/torneos-gateway-auth/bridge-probe.mjs';

const FN = 'backend/torneos/supabase/functions/torneos-gateway/';
const TEST_CA = '-----BEGIN CERTIFICATE-----\nQlJBTkRJTkctVjEtdGVzdC1jYQ==\n-----END CERTIFICATE-----\n';
const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/branding-v1/contract.json', 'utf8'));
const DOC = JSON.parse(fs.readFileSync(FN + 'branding-v1-rpc-allowlist.json', 'utf8'));
const RPCS = Object.values(DOC.features).flat();
const STORAGE = `https://${G.TORNEOS_REF}.supabase.co/storage/v1`;
const ORG = '10000000-0000-4000-8000-000000000001';
const TNT = '20000000-0000-4000-8000-000000000002';
const path = (n) => `${ORG}/tournaments/${TNT}/3000000${n}-0000-4000-8000-000000000003.png`;

const world = { identity: true, rest: [], storage: [], restBody: null, refuse: new Set(), storageStatus: 200 };
globalThis.__brandingWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  if (q.startsWith('SELECT id FROM public.torneos_identity')) return globalThis.__brandingWorld.identity ? [{ id: params[0] }] : [];
  if (q.startsWith('SET LOCAL ')) return [];
  throw new Error('Unexpected SQL (writes forbidden)');
} }), end: async () => {} }; }`;

let fx, tree, gateway, originalFetch, currentEnv;
test.before(async () => {
  fx = fixtureEnv({ caPem: TEST_CA });
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === G.GATEWAY_TOPOLOGY.coreAuthUrl + '/health') return new Response('{}', { status: 200 });
    if (u === G.GATEWAY_TOPOLOGY.coreContractUrl + '/v1/session') {
      return new Response(JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }), { status: 200 });
    }
    if (u.startsWith(G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/')) {
      const name = u.slice((G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/').length);
      world.rest.push({ name, authorization: init.headers.authorization ?? null });
      return new Response(JSON.stringify(world.restBody), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith(STORAGE + '/')) {
      const raw = init.body == null ? null : typeof init.body === 'string' ? init.body : init.body;
      world.storage.push({ url: u.slice(STORAGE.length), method: init.method, headers: init.headers, body: raw });
      if (u === `${STORAGE}/object/sign/tournament-branding`) {
        const { paths, expiresIn } = JSON.parse(raw);
        assert.equal(expiresIn, 3600);
        return new Response(JSON.stringify(paths.map((p) => (world.refuse.has(p)
          ? { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }
          : { path: p, signedURL: `/object/sign/tournament-branding/${p}?token=t-${p.slice(-8)}`, error: null }))), { status: 200 });
      }
      return new Response('{}', { status: world.storageStatus });
    }
    throw new Error('Unexpected network destination ' + u);
  };
  currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on' };
  globalThis.Deno = { env: { toObject: () => currentEnv } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__brandingWorld; await tree.cleanup(); });
test.beforeEach(() => { Object.assign(world, { identity: true, rest: [], storage: [], restBody: null, refuse: new Set(), storageStatus: 200 }); });

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

test('the allowlist is the contract and is disjoint from every other allowlist', () => {
  assert.equal(DOC.phase, 'BRANDING-V1');
  assert.deepEqual(RPCS, CONTRACT.rpcs);
  for (const file of ['staging-v1-rpc-allowlist.json', 'competition-v1-rpc-allowlist.json', 'officialization-v1-rpc-allowlist.json',
    'commerce-test-rpc-allowlist.json', 'social-v1-rpc-allowlist.json', 'connected-v1-rpc-allowlist.json']) {
    const other = JSON.stringify(JSON.parse(fs.readFileSync(FN + file, 'utf8')));
    for (const name of [...RPCS, ...CONTRACT.public_rpcs]) assert.ok(!other.includes(`"${name}"`), `${name} in ${file}`);
  }
});

test('strict opt-in; storage is only the Torneos project\'s own (derived from its REST URL) or the local lab\'s', async () => {
  const { loadBrandingContract, withBranding, BrandingConfigError, SIGNED_PUBLIC_RPCS, SIGNED_AUTHENTICATED_RPCS } = await tree.import('torneos-gateway/branding.ts');
  const base = new Set(['existing', ...CONTRACT.signed_authenticated_rpcs.filter((name) => !RPCS.includes(name))]);
  const rest = G.GATEWAY_TOPOLOGY.torneosRestUrl;
  for (const env of [{}, { TORNEOS_BRANDING_MODE: '' }, { TORNEOS_BRANDING_MODE: 'off' }]) {
    const contract = loadBrandingContract(env, base, rest, null);
    assert.equal(contract.mode, 'off');
    assert.deepEqual([...withBranding(base, contract)], [...base]);
  }
  const on = loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on' }, base, rest, 'sb_publishable_x');
  assert.deepEqual([on.storageUrl, on.publicBase], [STORAGE, STORAGE]);
  assert.deepEqual([...withBranding(base, on)].filter((name) => !base.has(name)), RPCS);
  assert.deepEqual([...SIGNED_PUBLIC_RPCS], CONTRACT.signed_public_rpcs);
  assert.deepEqual([...SIGNED_AUTHENTICATED_RPCS], CONTRACT.signed_authenticated_rpcs);
  for (const mode of ['ON', 'true', '1', 'yes', 'on ']) {
    assert.throws(() => loadBrandingContract({ TORNEOS_BRANDING_MODE: mode }, base, rest, 'k'), BrandingConfigError, mode);
    assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_BRANDING_MODE: mode }), BrandingConfigError, `boot ${mode}`);
  }
  for (const env of [
    { TORNEOS_STORAGE_URL: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1' },
    { TORNEOS_STORAGE_PUBLIC_URL: 'https://cdn.example.test' },
  ]) assert.throws(() => loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on', ...env }, base, rest, 'k'), BrandingConfigError, JSON.stringify(env));
  assert.throws(() => loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on' }, base, rest, null), BrandingConfigError, 'anon key required');
  assert.throws(() => loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on' }, base, 'http://torneos-rest:3000', 'k'), BrandingConfigError, 'lab needs its explicit targets');
  const lab = loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on', TORNEOS_STORAGE_URL: 'http://torneos-storage:5000', TORNEOS_STORAGE_PUBLIC_URL: 'http://127.0.0.1:58425' },
    base, 'http://torneos-rest:3000', 'k');
  assert.deepEqual([lab.storageUrl, lab.publicBase], ['http://torneos-storage:5000', 'http://127.0.0.1:58425']);
  assert.throws(() => loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on' }, new Set([...base, ...RPCS]), rest, 'k'), BrandingConfigError, 'overlap');
  assert.throws(() => loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on' }, base, rest, 'k', { ...DOC, phase: 'X' }), BrandingConfigError);
  assert.throws(() => loadBrandingContract({ TORNEOS_BRANDING_MODE: 'on' }, base, rest, 'k', undefined, new Set(['get_public_tournament_branding'])),
    BrandingConfigError, 'public overlap');
});

test('boot: BRANDING adds exactly its two RPCs; off serves none, no object route, no public logos', async () => {
  const off = gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on' });
  const on = gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on' });
  assert.deepEqual([...on.rpcAllowlist].filter((name) => !off.rpcAllowlist.has(name)), RPCS);
  assert.equal(off.branding.mode, 'off');
  // A second, independent copy of the gateway booted without the mode: no route, no public logos, nothing signed.
  const saved = currentEnv;
  currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on' };
  const offTree = await loadGatewayTree({ postgresModule: stub });
  try {
    const offGateway = await offTree.import('torneos-gateway/index.ts');
    assert.equal((await offGateway.handle(request('/torneos/branding/v1/object/' + path(1), { raw: 'x', headers: { 'content-type': 'image/png' } }))).status, 404);
    assert.equal((await offGateway.handle(request('/torneos/public/v1/rpc/get_public_tournament_branding', { bearer: null, body: { p_public_slug: 'copa-x' } }))).status, 403);
    world.restBody = { items: [{ logoPath: path(1) }] };
    const untouched = await offGateway.handle(request('/torneos/public/v1/rpc/search_tournament_catalog', { bearer: null, body: { p_query: 'copa' } }));
    assert.deepEqual(await untouched.json(), { items: [{ logoPath: path(1) }] }, 'off: the response is untouched');
    assert.equal(world.storage.length, 0);
  } finally {
    currentEnv = saved;
    await offTree.cleanup();
  }
});

test('public responses: ONE signature batch with the publishable key as apikey only; refused paths stay without URL', async () => {
  world.restBody = { items: [{ logoPath: path(1), organizationLogoPath: path(2) }, { logoPath: path(1), organizationLogoPath: null }], total: 2 };
  world.refuse = new Set([path(2)]);
  const r = await pub('search_tournament_catalog', { p_query: 'copa' });
  assert.equal(r.status, 200);
  const signs = world.storage.filter((call) => call.url === '/object/sign/tournament-branding');
  assert.equal(signs.length, 1, 'one batch per response, whatever the number of cards');
  assert.deepEqual(JSON.parse(signs[0].body).paths, [path(1), path(2)], 'each path once');
  assert.equal(signs[0].headers.authorization, undefined, 'a publishable key is never a bearer');
  assert.equal(signs[0].headers.apikey, fx.env.TORNEOS_ANON_KEY);
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

test('authenticated responses are signed with the caller\'s own token; other RPCs are never parsed', async () => {
  world.restBody = { entry: { shieldPath: path(3) } };
  const bearer = token();
  const r = await rpc('get_team_registration_context', { bearer, body: { p_organization_id: ORG, p_team_entry_id: TNT } });
  assert.equal(r.status, 200);
  const [sign] = world.storage;
  assert.equal(sign.headers.authorization, `Bearer ${bearer}`);
  assert.ok((await r.json()).entry.shieldUrl.includes(path(3)));
  world.storage.length = 0;
  world.restBody = { logoPath: path(1) };
  const other = await rpc('get_tournament_competition_context', { body: { p_organization_id: ORG } });
  assert.deepEqual(await other.json(), { logoPath: path(1) }, 'outside the signed set nothing is added');
  assert.equal(world.storage.length, 0);
});

test('object route: one versioned object with the caller\'s token; type, size, path and bearer checked before storage', async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const bearer = token();
  const ok = await object(path(4), { bearer, raw: bytes, headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
  assert.deepEqual([ok.status, await ok.json()], [200, { path: path(4) }]);
  const [put] = world.storage;
  assert.deepEqual([put.url, put.method, put.headers.authorization, put.headers['x-upsert'], put.headers['content-type']],
    [`/object/tournament-branding/${path(4)}`, 'POST', `Bearer ${bearer}`, 'false', 'image/png']);
  world.storage.length = 0;
  world.storageStatus = 400;
  const refused = await object(path(5), { raw: bytes, headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
  assert.deepEqual([refused.status, (await refused.json()).error], [403, 'TORNEOS_BRANDING_FORBIDDEN'], 'storage RLS refusal');
  world.storageStatus = 200;
  world.storage.length = 0;
  assert.equal((await object(path(6), { raw: bytes, headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) } })).status, 415);
  assert.equal((await object(path(6), { raw: bytes, headers: { 'content-type': 'image/png', 'content-length': String(3 * 1024 * 1024) } })).status, 413);
  assert.equal((await object(`${ORG}/tournaments/${TNT}/x.png`, { raw: bytes, headers: { 'content-type': 'image/png' } })).status, 404);
  assert.equal((await object(path(6), { bearer: null, raw: bytes, headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } })).status, 401);
  assert.equal(world.storage.length, 0, 'nothing reached storage');
  const removed = await object(path(4), { method: 'DELETE', raw: null, headers: { 'content-type': 'image/png' } });
  assert.deepEqual([removed.status, await removed.json()], [200, { removed: true }]);
  assert.equal(world.storage[0].method, 'DELETE');
});
