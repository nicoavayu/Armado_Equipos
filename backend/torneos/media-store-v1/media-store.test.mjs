// MEDIA-STORE-V1 — the torneos-media-store function on its own (real store.ts, emulated Data API and Storage): its
// configuration, the fixed operation shapes, the database as the only authority, outages, and that no key, token or
// signed URL ever leaves in an answer it should not. Never touches a network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { STORE_SECRET, SECRET_KEY, PUBLISHABLE_KEY, ORIGIN, storeEnv } from './test/support.mjs';

const FIX = 'scripts/edge-functions/fixtures/tournament-media/';
const fixture = (name) => new Uint8Array(fs.readFileSync(FIX + name));
const ORG = '10000000-0000-4000-8000-000000000001';
const TNT = '20000000-0000-4000-8000-000000000002';
const GAL = '30000000-0000-4000-8000-000000000003';
const OBJECT = `${ORG}/${TNT}/${GAL}/70000000-0000-4000-8000-000000000008.jpg`;
const THUMB = OBJECT.replace('.jpg', '-thumbnail.jpg');
const BRAND = `${ORG}/tournaments/${TNT}/40000000-0000-4000-8000-000000000004.png`;
const IDENTITY = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';
const STORAGE = `${ORIGIN}/storage/v1`;
const REST = `${ORIGIN}/rest/v1`;

let tree, store, protocol, config;
const world = { authorize: [], storage: [], deny: new Set(), authorizeStatus: 200, storageStatus: 200, extra: null, throwOn: null, absent: new Set() };
const reset = () => Object.assign(world, { authorize: [], storage: [], deny: new Set(), authorizeStatus: 200, storageStatus: 200, extra: null, throwOn: null, absent: new Set() });
async function fakeFetch(url, init) {
  const u = String(url);
  if (world.throwOn && u.startsWith(world.throwOn)) throw new Error('network down');
  if (u === `${REST}/rpc/authorize_tournament_storage_objects`) {
    const args = JSON.parse(init.body);
    world.authorize.push({ ...args, headers: init.headers, redirect: init.redirect });
    if (world.authorizeStatus !== 200) return new Response('{"message":"x"}', { status: world.authorizeStatus });
    const allowed = args.p_names.filter((n) => !world.deny.has(`${args.p_operation}:${n}`));
    return new Response(JSON.stringify(world.extra ? [...allowed, world.extra] : allowed), { status: 200 });
  }
  if (u.startsWith(`${STORAGE}/`)) {
    world.storage.push({ url: u.slice(STORAGE.length), method: init.method, headers: init.headers, body: init.body, redirect: init.redirect });
    if (u.startsWith(`${STORAGE}/object/sign/`)) {
      const bucket = u.slice(`${STORAGE}/object/sign/`.length);
      const { paths } = JSON.parse(init.body);
      return new Response(JSON.stringify([...paths.map((p) => ({ path: p, signedURL: `/object/sign/${bucket}/${p}?token=tok`, error: null })),
        { path: 'not-asked', signedURL: `/object/sign/${bucket}/not-asked?token=tok`, error: null }]), { status: world.storageStatus });
    }
    if (init.method === 'DELETE') return new Response(JSON.stringify(JSON.parse(init.body).prefixes.filter((name) => !world.absent.has(name)).map((name) => ({ name }))), { status: world.storageStatus });
    return new Response('{}', { status: world.storageStatus });
  }
  throw new Error('unexpected ' + u);
}

test.before(async () => {
  tree = await loadGatewayTree();
  store = await tree.import('torneos-media-store/store.ts');
  protocol = await tree.import('torneos-gateway/media-store-protocol.ts');
  config = store.loadStoreConfig(storeEnv());
});
test.after(async () => { await tree.cleanup(); });
test.beforeEach(reset);

async function call(op, { query = '', body = new Uint8Array(0), type = 'application/json', identity = IDENTITY } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body));
  const search = query ? `?${query}` : '';
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = await protocol.sign(config.secret, await protocol.signingInput('POST', `/torneos-media-store/v1/${op}`, search, ts, bytes, identity));
  const res = await store.handle(new Request(`${ORIGIN}/torneos-media-store/v1/${op}${search}`, { method: 'POST', body: bytes,
    headers: { 'content-type': type, 'x-torneos-store-identity': identity, 'x-torneos-store-timestamp': ts, 'x-torneos-store-signature': signature } }),
  config, { fetchImpl: fakeFetch, randomUUID: () => '50000000-0000-4000-8000-000000000005' });
  const text = await res.text();
  for (const secret of [SECRET_KEY, PUBLISHABLE_KEY, IDENTITY, STORE_SECRET]) assert.ok(!text.includes(secret), `${op}: an answer never carries a key or a token`);
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('configuration: hosted from SUPABASE_URL (secret key preferred, legacy JWT accepted), the lab exactly, anything else refused', () => {
  assert.deepEqual([config.restUrl, config.storageUrl, config.publicBase], [REST, STORAGE, STORAGE]);
  assert.deepEqual(config.serviceHeaders, { apikey: SECRET_KEY }, 'a secret key is never a bearer');
  assert.equal(config.apikey, PUBLISHABLE_KEY);
  const legacy = store.loadStoreConfig({ ...storeEnv(), SUPABASE_SECRET_KEYS: undefined, SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' });
  assert.deepEqual(legacy.serviceHeaders, { apikey: 'a.b.c', authorization: 'Bearer a.b.c' });
  const lab = store.loadStoreConfig({ TORNEOS_MEDIA_STORE_SECRET: STORE_SECRET, TORNEOS_MEDIA_STORE_REST_URL: 'http://torneos-rest:3000',
    TORNEOS_MEDIA_STORE_STORAGE_URL: 'http://torneos-storage:5000', TORNEOS_MEDIA_STORE_PUBLIC_URL: 'http://127.0.0.1:58425',
    SUPABASE_SERVICE_ROLE_KEY: 'a.b.c', SUPABASE_ANON_KEY: 'x.y.z' });
  assert.deepEqual([lab.restUrl, lab.storageUrl, lab.publicBase], ['http://torneos-rest:3000', 'http://torneos-storage:5000', 'http://127.0.0.1:58425']);
  for (const [label, env] of [
    ['no secret', { ...storeEnv(), TORNEOS_MEDIA_STORE_SECRET: '' }],
    ['short secret', { ...storeEnv(), TORNEOS_MEDIA_STORE_SECRET: 'ab'.repeat(8) }],
    ['another origin', { ...storeEnv(), SUPABASE_URL: 'https://evil.example.test' }],
    ['no service key', { ...storeEnv(), SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_publishable_x' }) }],
    ['no publishable key', { ...storeEnv(), SUPABASE_PUBLISHABLE_KEYS: undefined }],
    ['lab with an external storage', { TORNEOS_MEDIA_STORE_SECRET: STORE_SECRET, TORNEOS_MEDIA_STORE_REST_URL: 'http://torneos-rest:3000',
      TORNEOS_MEDIA_STORE_STORAGE_URL: 'https://x.supabase.co/storage/v1', TORNEOS_MEDIA_STORE_PUBLIC_URL: 'http://127.0.0.1:58425', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c', SUPABASE_ANON_KEY: 'k' }],
  ]) {
    assert.throws(() => store.loadStoreConfig(env), (error) => error instanceof store.StoreConfigError
      && !error.message.includes(SECRET_KEY) && !error.message.includes(STORE_SECRET), label);
  }
});

test('the database is the only authority: asked with the caller\'s identity and the publishable key; it can narrow, never add', async () => {
  world.extra = `${ORG}/tournaments/${TNT}/99999999-0000-4000-8000-000000000009.png`;
  const r = await call('branding-sign', { body: { paths: [BRAND] } });
  assert.equal(r.status, 200);
  const [ask] = world.authorize;
  assert.deepEqual([ask.p_bucket, ask.p_operation, ask.p_names, ask.headers.authorization, ask.headers.apikey, ask.redirect],
    ['tournament-branding', 'read', [BRAND], `Bearer ${IDENTITY}`, PUBLISHABLE_KEY, 'error']);
  const [sign] = world.storage;
  assert.deepEqual(JSON.parse(sign.body), { expiresIn: 3600, paths: [BRAND] }, 'a name the database added on its own is never signed');
  assert.deepEqual(Object.keys(r.json.urls), [BRAND], 'a signature storage returned for a name nobody asked for is dropped');
  assert.equal(r.json.urls[BRAND], `${STORAGE}/object/sign/tournament-branding/${BRAND}?token=tok`);
  assert.deepEqual([sign.headers.apikey, sign.headers.authorization, sign.redirect], [SECRET_KEY, undefined, 'error']);
});

test('media: a photo or its thumbnail, normalized, of the type the session registered, only if the claim may write it', async () => {
  const jpeg = fixture('clean-64x48.jpg');
  assert.equal((await call('media-put', { query: `kind=photo&name=${OBJECT}`, body: jpeg, type: 'image/jpeg' })).status, 200);
  assert.deepEqual(world.storage.map((c) => [c.method, c.url, c.headers['x-upsert'], c.headers['cache-control']]),
    [['POST', `/object/tournament-media/${OBJECT}`, 'false', 'private, max-age=31536000, immutable']]);
  assert.equal((await call('media-put', { query: `kind=thumbnail&name=${THUMB}`, body: jpeg, type: 'image/jpeg' })).status, 200);
  reset();
  for (const [label, query, body, type, status] of [
    ['png bytes for a .jpg session', `kind=photo&name=${OBJECT}`, fixture('clean-64x48.png'), 'image/png', 422],
    ['metadata present', `kind=photo&name=${OBJECT.replace('.jpg', '.webp')}`, fixture('exif-64x48.webp'), 'image/webp', 422],
    ['rotated', `kind=photo&name=${OBJECT}`, fixture('exif-orient6-64x48.jpg'), 'image/jpeg', 422],
    ['a png thumbnail', `kind=thumbnail&name=${THUMB}`, fixture('clean-64x48.png'), 'image/png', 422],
    ['a thumbnail name for a photo', `kind=photo&name=${THUMB}`, jpeg, 'image/jpeg', 400],
    ['a photo name for a thumbnail', `kind=thumbnail&name=${OBJECT}`, jpeg, 'image/jpeg', 400],
    ['a traversal name', `kind=photo&name=../${OBJECT}`, jpeg, 'image/jpeg', 400],
    ['another bucket in the name', `kind=photo&name=tournament-branding/${OBJECT}`, jpeg, 'image/jpeg', 400],
    ['an extra parameter', `kind=photo&name=${OBJECT}&bucket=tournament-branding`, jpeg, 'image/jpeg', 400],
    ['a gif', `kind=photo&name=${OBJECT}`, fixture('sample-8x8.gif'), 'image/gif', 415],
  ]) {
    assert.equal((await call('media-put', { query, body, type })).status, status, label);
  }
  assert.equal(world.storage.length, 0, 'none of them reached Storage');
  world.deny = new Set([`write:${OBJECT}`]);
  assert.equal((await call('media-put', { query: `kind=photo&name=${OBJECT}`, body: jpeg, type: 'image/jpeg' })).status, 403,
    'an expired, foreign or already registered session');
  assert.equal(world.storage.length, 0);
  world.deny = new Set();
  world.storageStatus = 409;
  assert.equal((await call('media-put', { query: `kind=photo&name=${OBJECT}`, body: jpeg, type: 'image/jpeg' })).status, 409,
    'a concurrent writer already holds the name: never overwritten');
});

test('removals and signatures: bounded lists of well-formed names, each judged by the database', async () => {
  assert.deepEqual((await call('media-delete', { body: { names: [OBJECT, THUMB] } })).json, { removed: [OBJECT, THUMB] });
  world.deny = new Set([`delete:${THUMB}`]);
  assert.deepEqual((await call('media-delete', { body: { names: [OBJECT, THUMB] } })).json, { removed: [OBJECT] });
  for (const body of [{ names: [OBJECT, THUMB, OBJECT.replace('8.jpg', '9.jpg')] }, { names: [] }, { names: ['x'] }, { names: [OBJECT], extra: 1 }, 'not json']) {
    assert.equal((await call('media-delete', { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('media-sign', { body: { names: Array.from({ length: 121 }, () => OBJECT) } })).status, 400, '≤ 120 per batch');
  assert.equal((await call('branding-sign', { body: { paths: Array.from({ length: 201 }, () => BRAND) } })).status, 400, '≤ 200 per batch');
  world.deny = new Set([`read:${OBJECT}`]);
  const signed = await call('media-sign', { body: { names: [OBJECT, THUMB] } });
  assert.deepEqual(Object.keys(signed.json.urls), [THUMB]);
  assert.equal(JSON.parse(world.storage.at(-1).body).expiresIn, 300);
  world.deny = new Set([`delete:${BRAND}`]);
  assert.equal((await call('branding-delete', { body: { path: BRAND } })).status, 403, 'a logo still referenced');
  assert.equal((await call('branding-delete', { body: { path: 'x' } })).status, 400);
  assert.equal((await call('branding-delete', { body: { path: BRAND }, type: 'text/plain' })).status, 415);
});

test('branding: the name is generated here, under the requested owner, with the extension of the real type', async () => {
  const r = await call('branding-put', { query: `organization=${ORG}&kind=tournament&entity=${TNT}`, body: fixture('clean-64x48.webp'), type: 'image/webp' });
  assert.deepEqual(r.json, { path: `${ORG}/tournaments/${TNT}/50000000-0000-4000-8000-000000000005.webp`, mime: 'image/webp', width: 64, height: 48 });
  for (const query of [`organization=${ORG}&kind=club&entity=${TNT}`, `organization=x&kind=team&entity=${TNT}`, `organization=${ORG}&kind=team`,
    `organization=${ORG}&kind=team&entity=${TNT}&name=x.png`]) {
    assert.equal((await call('branding-put', { query, body: fixture('clean-64x48.png'), type: 'image/png' })).status, 400, query);
  }
  const text = fixture('text-64x48.png');
  const stripped = await call('branding-put', { query: `organization=${ORG}&kind=team&entity=${TNT}`, body: text, type: 'image/png' });
  assert.equal(stripped.status, 200, 'metadata in a logo is stripped, not refused');
  assert.ok(new Uint8Array(world.storage.at(-1).body).length < text.length, 'the stored logo is the stripped one');
});

test('outages are outages: the Data API or Storage down or failing answers 503 without detail', async () => {
  for (const [label, setup] of [
    ['data api unreachable', () => { world.throwOn = REST; }],
    ['data api 5xx', () => { world.authorizeStatus = 503; }],
    ['storage unreachable', () => { world.throwOn = STORAGE; }],
    ['storage 5xx', () => { world.storageStatus = 500; }],
  ]) {
    reset(); setup();
    const r = await call('branding-sign', { body: { paths: [BRAND] } });
    assert.deepEqual([r.status, r.json], [503, { error: 'UNAVAILABLE' }], label);
  }
  reset(); world.authorizeStatus = 401;
  assert.equal((await call('media-sign', { body: { names: [OBJECT] } })).status, 403, 'no identity: refused, not an outage');
});

test('a disabled store (faulty configuration) refuses everything; GET and unknown paths are 404', async () => {
  const get = await store.handle(new Request(`${ORIGIN}/torneos-media-store/v1/media-sign`), config);
  assert.equal(get.status, 404);
  const other = await store.handle(new Request(`${ORIGIN}/other-function/v1/media-sign`, { method: 'POST' }), config);
  assert.equal(other.status, 404);
  const index = fs.readFileSync('backend/torneos/supabase/functions/torneos-media-store/index.ts', 'utf8');
  assert.match(index, /status: 503/);
  assert.doesNotMatch(index, /console\.(log|info)/, 'nothing about requests is ever logged');
  const source = fs.readFileSync('backend/torneos/supabase/functions/torneos-media-store/store.ts', 'utf8');
  assert.doesNotMatch(source, /console\./, 'the store logs nothing');
  assert.doesNotMatch(source, /x-upsert":\s*"true"/);
  assert.equal(G.TORNEOS_REF.length, 20);
});

test('a removal tells a real absence (404 NOT_REMOVED) from a provider failure (503), after the same authorization', async () => {
  reset();
  assert.deepEqual([(await call('branding-delete', { body: { path: BRAND } })).status], [200], 'present: removed');
  world.absent = new Set([BRAND]);
  const again = await call('branding-delete', { body: { path: BRAND } });
  assert.deepEqual([again.status, again.json], [404, { error: 'NOT_REMOVED' }], 'already gone: Storage answered 200 with nothing removed');
  for (const status of [400, 401, 403, 404, 409]) {
    world.storageStatus = status;
    const failed = await call('branding-delete', { body: { path: BRAND } });
    assert.deepEqual([failed.status, failed.json], [503, { error: 'UNAVAILABLE' }], `Storage ${status} is a provider failure, never «absent»`);
  }
  world.storageStatus = 200;
  world.deny = new Set([`delete:${BRAND}`]);
  const denied = await call('branding-delete', { body: { path: BRAND } });
  assert.equal(denied.status, 403, 'the database still decides first');
  assert.equal(world.storage.filter((c) => c.method === 'DELETE').length, 7, 'a denied removal never reached Storage');
});
