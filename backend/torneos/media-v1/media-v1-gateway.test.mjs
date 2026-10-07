// MEDIA-V1 gateway contract, against the real gateway source (the same loader as the BRANDING-V1 suite: real index.ts,
// stubbed Postgres, emulated Core, PostgREST and Storage) and REAL image bytes (the pipeline's encoder fixtures). Never
// touches a network or a database. The behaviour against real Storage + Postgres is certified in the lab
// (backend/torneos/media-v1/REPORT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../infra/torneos-gateway-auth/bridge-probe.mjs';

const FN = 'backend/torneos/supabase/functions/torneos-gateway/';
const FIX = 'scripts/edge-functions/fixtures/tournament-media/';
const TEST_CA = '-----BEGIN CERTIFICATE-----\nTUVESUEtVjEtdGVzdC1jYQ==\n-----END CERTIFICATE-----\n';
const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/media-v1/contract.json', 'utf8'));
const DOC = JSON.parse(fs.readFileSync(FN + 'media-v1-rpc-allowlist.json', 'utf8'));
const RPCS = Object.values(DOC.features).flat();
const STORAGE = `https://${G.TORNEOS_REF}.supabase.co/storage/v1`;
const ORG = '10000000-0000-4000-8000-000000000001';
const TNT = '20000000-0000-4000-8000-000000000002';
const GAL = '30000000-0000-4000-8000-000000000003';
const SES = '40000000-0000-4000-8000-000000000004';
const AST = '50000000-0000-4000-8000-000000000005';
const AST2 = '50000000-0000-4000-8000-000000000006';
const KEY = '60000000-0000-4000-8000-000000000007';
const OBJECT = `${ORG}/${TNT}/${GAL}/70000000-0000-4000-8000-000000000008.jpg`;
const OBJECT2 = `${ORG}/${TNT}/${GAL}/70000000-0000-4000-8000-000000000009.jpg`;
const fixture = (name) => new Uint8Array(fs.readFileSync(FIX + name));
const JPEG = fixture('clean-64x48.jpg');
const decodeJwt = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

const issued = () => ({ state: 'issued', sessionId: SES, token: 'a'.repeat(64), expiresAt: 'x', objectName: OBJECT });
const world = {};
const reset = () => Object.assign(world, { identity: true, rest: [], storage: [], replies: {}, storageStatus: 200, refuse: new Set() });
reset();
globalThis.__mediaWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  if (q.startsWith('SELECT id FROM public.torneos_identity')) return globalThis.__mediaWorld.identity ? [{ id: params[0] }] : [];
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
      const args = init.body ? JSON.parse(init.body) : null;
      world.rest.push({ name, authorization: init.headers.authorization ?? null, apikey: init.headers.apikey ?? null, args });
      const reply = typeof world.replies[name] === 'function' ? world.replies[name](args) : world.replies[name];
      const [status, body] = reply ?? [200, null];
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith(STORAGE + '/')) {
      world.storage.push({ url: u.slice(STORAGE.length), method: init.method, headers: init.headers, body: init.body ?? null });
      if (u === `${STORAGE}/object/sign/tournament-media`) {
        const { paths, expiresIn } = JSON.parse(init.body);
        assert.equal(expiresIn, 300);
        return new Response(JSON.stringify(paths.map((p) => (world.refuse.has(p)
          ? { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }
          : { path: p, signedURL: `/object/sign/tournament-media/${p}?token=t-${p.slice(-12)}`, error: null }))), { status: 200 });
      }
      return new Response('{}', { status: world.storageStatus });
    }
    throw new Error('Unexpected network destination ' + u);
  };
  currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on', TORNEOS_MEDIA_MODE: 'on' };
  globalThis.Deno = { env: { toObject: () => currentEnv } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__mediaWorld; await tree.cleanup(); });
test.beforeEach(reset);

const token = (overrides = {}) => mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid, overrides });
function request(route, { method = 'POST', bearer = token(), body = {}, raw = null, headers = {} } = {}) {
  return new Request(BASE + route, {
    method,
    headers: { host: new URL(BASE).host, origin: G.WEB_ORIGIN, 'content-type': 'application/json',
      ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), ...headers },
    body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body)),
  });
}
const upload = (bytes, { type = 'image/jpeg', query = `gallery=${GAL}&key=${KEY}`, bearer, length = bytes.length } = {}) => gateway.handle(
  request(`/torneos/media/v1/upload?${query}`, { bearer, raw: bytes, headers: { 'content-type': type, 'content-length': String(length) } }));
const urls = (body, options = {}) => gateway.handle(request('/torneos/media/v1/urls', { body, ...options }));
const rpc = (name, options) => gateway.handle(request('/torneos/rest/v1/rpc/' + name, options));

test('the gateway copies of the verifier are the pipeline\'s own, byte for byte (header aside)', () => {
  const strip = (text) => text.split('\n').slice(3).join('\n'); // the three-line provenance header
  assert.equal(strip(fs.readFileSync(FN + 'media-contract.ts', 'utf8')), fs.readFileSync('supabase/functions/_shared/tournamentMediaContract.ts', 'utf8'));
  assert.equal(strip(fs.readFileSync(FN + 'media-image.ts', 'utf8')),
    fs.readFileSync('supabase/functions/_shared/tournamentMediaImage.ts', 'utf8').replace('from "./tournamentMediaContract.ts"', 'from "./media-contract.ts"'));
});

test('the allowlist is the contract, disjoint from every other allowlist, and never names a gateway-internal RPC', () => {
  assert.equal(DOC.phase, 'MEDIA-V1');
  assert.deepEqual(RPCS, CONTRACT.rpcs);
  for (const file of fs.readdirSync(FN).filter((f) => f.endsWith('-rpc-allowlist.json') && f !== 'media-v1-rpc-allowlist.json')) {
    const other = JSON.stringify(JSON.parse(fs.readFileSync(FN + file, 'utf8')));
    for (const name of [...RPCS, ...CONTRACT.gateway_internal_rpcs]) assert.ok(!other.includes(`"${name}"`), `${name} in ${file}`);
  }
  for (const name of CONTRACT.gateway_internal_rpcs) assert.ok(!RPCS.includes(name), name);
  assert.ok(!RPCS.includes('request_tournament_media_upload_session'), 'the browser never opens a raw session');
});

test('strict opt-in; storage is only the Torneos project\'s own or the local lab\'s; boot adds exactly the media RPCs', async () => {
  const { loadMediaContract, withMedia, MediaConfigError } = await tree.import('torneos-gateway/media.ts');
  const rest = G.GATEWAY_TOPOLOGY.torneosRestUrl;
  const base = new Set(['existing']);
  for (const env of [{}, { TORNEOS_MEDIA_MODE: '' }, { TORNEOS_MEDIA_MODE: 'off' }]) {
    const contract = loadMediaContract(env, base, rest);
    assert.equal(contract.mode, 'off');
    assert.deepEqual([...withMedia(base, contract)], [...base]);
  }
  const on = loadMediaContract({ TORNEOS_MEDIA_MODE: 'on' }, base, rest);
  assert.deepEqual([on.storageUrl, on.publicBase, on.restUrl], [STORAGE, STORAGE, rest]);
  for (const mode of ['ON', 'true', '1', 'on ']) {
    assert.throws(() => loadMediaContract({ TORNEOS_MEDIA_MODE: mode }, base, rest), MediaConfigError, mode);
    assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_MEDIA_MODE: mode }), MediaConfigError, `boot ${mode}`);
  }
  assert.throws(() => loadMediaContract({ TORNEOS_MEDIA_MODE: 'on', TORNEOS_STORAGE_URL: 'https://cdn.example.test' }, base, rest), MediaConfigError);
  assert.throws(() => loadMediaContract({ TORNEOS_MEDIA_MODE: 'on' }, base, 'http://torneos-rest:3000'), MediaConfigError, 'lab needs its explicit targets');
  assert.throws(() => loadMediaContract({ TORNEOS_MEDIA_MODE: 'on' }, new Set([...base, RPCS[0]]), rest), MediaConfigError, 'overlap');
  assert.throws(() => loadMediaContract({ TORNEOS_MEDIA_MODE: 'on' }, new Set(['begin_tournament_media_gallery_upload']), rest), MediaConfigError, 'internal served elsewhere');
  assert.throws(() => loadMediaContract({ TORNEOS_MEDIA_MODE: 'on' }, base, rest, { ...DOC, phase: 'X' }), MediaConfigError);
  assert.throws(() => loadMediaContract({ TORNEOS_MEDIA_MODE: 'on' }, base, rest,
    { ...DOC, features: { ...DOC.features, media_participant: [...DOC.features.media_participant, 'complete_tournament_media_gallery_upload'] } }), MediaConfigError);
  const off = gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on' });
  const booted = gateway.boot(currentEnv);
  assert.deepEqual([...booted.rpcAllowlist].filter((name) => !off.rpcAllowlist.has(name)), RPCS);
  assert.equal(off.media.mode, 'off');
  // A second, independent copy of the gateway booted without the mode: no media route at all.
  const saved = currentEnv;
  currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on' };
  const offTree = await loadGatewayTree({ postgresModule: stub });
  try {
    const offGateway = await offTree.import('torneos-gateway/index.ts');
    assert.equal((await offGateway.handle(request(`/torneos/media/v1/upload?gallery=${GAL}&key=${KEY}`, { raw: JPEG, headers: { 'content-type': 'image/jpeg' } }))).status, 404);
    assert.equal((await offGateway.handle(request('/torneos/media/v1/urls', { body: { items: [{ assetId: AST, kind: 'grid' }] } }))).status, 404);
    assert.equal((await offGateway.handle(request('/torneos/rest/v1/rpc/get_published_tournament_media', { body: {} }))).status, 403);
    assert.equal(world.rest.length + world.storage.length, 0);
  } finally {
    currentEnv = saved;
    await offTree.cleanup();
  }
});

test('upload: verified bytes → session with the caller\'s token → write + completion under the gateway claim for THAT session', async () => {
  world.replies.begin_tournament_media_gallery_upload = [200, issued()];
  world.replies.complete_tournament_media_gallery_upload = [200, { assetId: AST, status: 'pending_review' }];
  const bearer = token();
  const r = await upload(JPEG, { bearer });
  assert.deepEqual([r.status, await r.json()], [201, { assetId: AST, status: 'pending_review', width: 64, height: 48, thumbnail: false }]);
  const [begin, complete] = world.rest;
  assert.equal(begin.name, 'begin_tournament_media_gallery_upload');
  assert.equal(begin.authorization, `Bearer ${bearer}`, 'the caller opens its own session');
  assert.deepEqual(begin.args, { p_gallery_id: GAL, p_idempotency_key: KEY, p_mime: 'image/jpeg', p_byte_size: JPEG.length, p_thumbnail_size: null });
  const [put] = world.storage;
  assert.deepEqual([put.url, put.method, put.headers['x-upsert'], put.headers['content-type']], [`/object/tournament-media/${OBJECT}`, 'POST', 'false', 'image/jpeg']);
  assert.deepEqual(new Uint8Array(put.body), JPEG, 'exactly the verified bytes');
  const caller = decodeJwt(bearer);
  const claim = decodeJwt(put.headers.authorization.slice(7));
  assert.notEqual(put.headers.authorization, `Bearer ${bearer}`, 'never the caller\'s own token');
  assert.equal(claim.torneos_media_upload_session, SES);
  for (const k of ['sub', 'core_user_id', 'session_id', 'role', 'iss', 'aud']) assert.equal(claim[k], caller[k], k);
  assert.equal(claim.exp - claim.iat, 120);
  assert.equal(complete.name, 'complete_tournament_media_gallery_upload');
  assert.equal(complete.authorization, put.headers.authorization);
  assert.deepEqual(complete.args, { p_session_id: SES, p_token: 'a'.repeat(64), p_detected_mime: 'image/jpeg', p_byte_size: JPEG.length,
    p_width: 64, p_height: 48, p_checksum_sha256: crypto.createHash('sha256').update(JPEG).digest('hex'),
    p_thumbnail_size: null, p_thumbnail_width: null, p_thumbnail_height: null, p_thumbnail_checksum: null });
  for (const [name, type] of [['clean-64x48.png', 'image/png'], ['clean-64x48.webp', 'image/webp']]) {
    reset();
    world.replies.begin_tournament_media_gallery_upload = [200, { ...issued(), objectName: OBJECT.replace('.jpg', type === 'image/png' ? '.png' : '.webp') }];
    world.replies.complete_tournament_media_gallery_upload = [200, { assetId: AST, status: 'pending_review' }];
    assert.equal((await upload(fixture(name), { type })).status, 201, name);
  }
});

test('thumbnail: photo then JPEG thumbnail in one body; both verified, both written under the same claim, registered at completion', async () => {
  const THUMB_OBJECT = OBJECT.replace('.jpg', '-thumbnail.jpg');
  world.replies.begin_tournament_media_gallery_upload = [200, { ...issued(), thumbnailObjectName: THUMB_OBJECT }];
  world.replies.complete_tournament_media_gallery_upload = [200, { assetId: AST, status: 'pending_review', thumbnail: true }];
  // A 64×48 thumbnail of a 64×48 photo: the same shape, within the 640 px / 512 KiB thumbnail contract.
  const thumb = JPEG;
  const body = new Uint8Array([...JPEG, ...thumb]);
  const r = await upload(body, { query: `gallery=${GAL}&key=${KEY}&thumb=${thumb.length}` });
  assert.deepEqual([r.status, (await r.json()).thumbnail], [201, true]);
  const [begin, complete] = world.rest;
  assert.equal(begin.args.p_thumbnail_size, thumb.length);
  assert.deepEqual(world.storage.map((call) => [call.method, call.url, call.headers['content-type']]), [
    ['POST', `/object/tournament-media/${OBJECT}`, 'image/jpeg'], ['POST', `/object/tournament-media/${THUMB_OBJECT}`, 'image/jpeg']]);
  assert.equal(world.storage[0].headers.authorization, world.storage[1].headers.authorization, 'the same session claim');
  assert.deepEqual(new Uint8Array(world.storage[1].body), thumb);
  assert.deepEqual([complete.args.p_thumbnail_size, complete.args.p_thumbnail_width, complete.args.p_thumbnail_height],
    [thumb.length, 64, 48]);
  // A thumbnail that is not the same photo shape, not a JPEG, too big, or a session that does not announce it: refused.
  reset();
  const square = fixture('probe-8x8.jpg');
  let refused = await upload(new Uint8Array([...JPEG, ...square]), { query: `gallery=${GAL}&key=${KEY}&thumb=${square.length}` });
  assert.deepEqual([refused.status, (await refused.json()).code], [422, 'MEDIA_THUMBNAIL_MISMATCH']);
  const png = fixture('clean-64x48.png');
  refused = await upload(new Uint8Array([...JPEG, ...png]), { query: `gallery=${GAL}&key=${KEY}&thumb=${png.length}` });
  assert.deepEqual([refused.status, (await refused.json()).code], [422, 'MEDIA_MIME_MISMATCH']);
  assert.equal((await upload(JPEG, { query: `gallery=${GAL}&key=${KEY}&thumb=${512 * 1024 + 1}` })).status, 413);
  assert.equal((await upload(JPEG, { query: `gallery=${GAL}&key=${KEY}&thumb=${JPEG.length}` })).status, 413, 'nothing left for the photo');
  assert.equal(world.rest.length + world.storage.length, 0);
  world.replies.begin_tournament_media_gallery_upload = [200, issued()];
  assert.equal((await upload(body, { query: `gallery=${GAL}&key=${KEY}&thumb=${thumb.length}` })).status, 503,
    'a session that does not announce the thumbnail never gets one written');
  assert.equal(world.storage.length, 0);
  // A thumbnail write refused by storage undoes the photo already written.
  reset();
  world.replies.begin_tournament_media_gallery_upload = [200, { ...issued(), thumbnailObjectName: THUMB_OBJECT }];
  world.replies.fail_tournament_media_gallery_upload = [200, { status: 'failed' }];
  let calls = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith(THUMB_OBJECT) && init.method === 'POST') { calls += 1; world.storage.push({ url: 'thumb', method: 'POST' }); return new Response('{}', { status: 400 }); }
    return saved(url, init);
  };
  try {
    refused = await upload(body, { query: `gallery=${GAL}&key=${KEY}&thumb=${thumb.length}` });
  } finally { globalThis.fetch = saved; }
  assert.equal(refused.status, 403);
  assert.equal(calls, 1);
  assert.ok(world.storage.some((call) => call.method === 'DELETE' && call.url === `/object/tournament-media/${OBJECT}`), 'the photo is undone');
  assert.ok(world.rest.some((call) => call.name === 'fail_tournament_media_gallery_upload'));
});

test('content is refused BEFORE any session, quota or storage call: orientation, metadata, animation, fake type, size, format', async () => {
  for (const [name, type, code] of [
    ['exif-orient6-64x48.jpg', 'image/jpeg', 'MEDIA_ORIENTATION_NOT_NORMALIZED'],
    ['exif-64x48.webp', 'image/webp', 'MEDIA_METADATA_PRESENT'],
    ['animated-16x16.png', 'image/png', 'MEDIA_ANIMATION_UNSUPPORTED'],
    ['animated-16x16.webp', 'image/webp', 'MEDIA_ANIMATION_UNSUPPORTED'],
    ['clean-64x48.jpg', 'image/png', 'MEDIA_MIME_MISMATCH'],
  ]) {
    const r = await upload(fixture(name), { type });
    assert.deepEqual([r.status, await r.json()], [422, { error: 'TORNEOS_MEDIA_CONTENT_REJECTED', code }], name);
  }
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal((await upload(svg, { type: 'image/png' })).status, 422);
  const truncated = JPEG.slice(0, JPEG.length - 10);
  assert.equal((await upload(truncated)).status, 422, 'truncated');
  const trailing = new Uint8Array([...JPEG, 1, 2, 3]);
  assert.equal((await upload(trailing)).status, 422, 'trailing bytes');
  assert.equal((await upload(JPEG, { type: 'image/heic' })).status, 415);
  assert.equal((await upload(JPEG, { type: 'image/svg+xml' })).status, 415);
  assert.equal((await upload(JPEG, { length: 4 * 1024 * 1024 + 1 })).status, 413);
  assert.equal((await upload(JPEG, { length: JPEG.length + 5 })).status, 413, 'declared length must be exact');
  for (const query of ['gallery=x&key=' + KEY, 'key=' + KEY, `gallery=${GAL}&key=${KEY}&path=../x`, `gallery=${GAL}`]) {
    assert.equal((await upload(JPEG, { query })).status, 400, query);
  }
  assert.equal((await upload(JPEG, { bearer: null })).status, 401);
  assert.equal(world.rest.length + world.storage.length, 0, 'nothing reached the database or storage');
});

test('a retry or a double tap never makes a second photo; quota and permission refusals are functional answers', async () => {
  world.replies.begin_tournament_media_gallery_upload = [200, { state: 'uploaded', sessionId: SES, assetId: AST, status: 'pending_review' }];
  let r = await upload(JPEG);
  assert.deepEqual([r.status, await r.json()], [200, { assetId: AST, status: 'pending_review', replayed: true }]);
  assert.equal(world.storage.length, 0, 'replayed: nothing written');
  const answers = [
    [{ message: 'TORNEOS_MEDIA_UPLOAD_IN_PROGRESS', code: 'PT409' }, 409, 409],
    [{ message: 'TORNEOS_MEDIA_FORBIDDEN', code: '42501' }, 403, 403],
    [{ message: 'TORNEOS_MEDIA_MVP_RATE_LIMITED', code: 'P0001' }, 400, 429],
    [{ message: 'TORNEOS_MEDIA_PIPELINE_NOT_READY', code: '55000' }, 500, 409],
    [{ message: 'TORNEOS_MEDIA_GALLERY_IMMUTABLE', code: '22023' }, 400, 409],
    [{ message: 'TORNEOS_MEDIA_BUSY', code: 'P0001' }, 400, 429],
    [{ message: 'TORNEOS_MEDIA_STORAGE_BUDGET_EXCEEDED', code: '22023' }, 400, 409],
  ];
  for (const [body, status, expected] of answers) {
    world.replies.begin_tournament_media_gallery_upload = [status, body];
    r = await upload(JPEG);
    assert.deepEqual([r.status, (await r.json()).error], [expected, body.message], body.message);
  }
  world.replies.begin_tournament_media_gallery_upload = [400, { message: 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED', code: '22023',
    details: JSON.stringify({ seasonId: 'x', usage: 25, limit: 25, upgradeRequired: true }) }];
  r = await upload(JPEG);
  assert.deepEqual([r.status, await r.json()], [422, { error: 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED', quota: { usage: 25, limit: 25, upgradeRequired: true } }]);
  assert.equal(world.storage.length, 0);
  world.replies.begin_tournament_media_gallery_upload = [500, { message: 'connection lost' }];
  assert.equal((await upload(JPEG)).status, 503, 'an outage is an outage');
});

test('a refused completion undoes its own write and records why; a storage conflict fails the session', async () => {
  world.replies.begin_tournament_media_gallery_upload = [200, issued()];
  world.replies.complete_tournament_media_gallery_upload = [409, { message: 'TORNEOS_MEDIA_DUPLICATE', code: '23505' }];
  world.replies.fail_tournament_media_gallery_upload = [200, { status: 'failed' }];
  let r = await upload(JPEG);
  assert.deepEqual([r.status, (await r.json()).error], [409, 'TORNEOS_MEDIA_DUPLICATE']);
  const [put, removed] = world.storage;
  assert.deepEqual([removed.method, removed.url, removed.headers.authorization], ['DELETE', put.url, put.headers.authorization]);
  const failed = world.rest.find((call) => call.name === 'fail_tournament_media_gallery_upload');
  assert.deepEqual([failed.authorization, failed.args], [put.headers.authorization, { p_session_id: SES, p_failure_code: 'DUPLICATE' }]);
  reset();
  world.replies.begin_tournament_media_gallery_upload = [200, issued()];
  world.storageStatus = 409;
  r = await upload(JPEG);
  assert.equal(r.status, 409);
  assert.deepEqual(world.rest.map((call) => call.name), ['begin_tournament_media_gallery_upload', 'fail_tournament_media_gallery_upload']);
  reset();
  world.replies.begin_tournament_media_gallery_upload = [200, issued()];
  world.storageStatus = 400;
  assert.deepEqual([(r = await upload(JPEG)).status, (await r.json()).error], [403, 'TORNEOS_MEDIA_FORBIDDEN'], 'storage RLS refusal');
  reset();
  world.replies.begin_tournament_media_gallery_upload = [200, { ...issued(), objectName: OBJECT.replace(GAL, TNT) }];
  assert.equal((await upload(JPEG)).status, 503, 'an object outside the requested gallery is never written');
  assert.equal(world.storage.length, 0);
});

test('the gateway claim is never accepted from a client and the internal RPCs are never served', async () => {
  const forged = token({ torneos_media_upload_session: SES });
  assert.equal((await upload(JPEG, { bearer: forged })).status, 401);
  assert.equal((await rpc('get_published_tournament_media', { bearer: forged, body: {} })).status, 401);
  for (const name of [...CONTRACT.gateway_internal_rpcs, 'request_tournament_media_upload_session', 'complete_tournament_media_simple_upload', 'authorize_tournament_media_read']) {
    const r = await rpc(name, { body: {} });
    assert.deepEqual([r.status, await r.json()], [403, { error: 'rpc not enabled' }], name);
  }
  assert.equal(world.rest.length, 0);
});

test('read URLs: the caller\'s targets per kind, ONE signature batch with the caller\'s token, refused assets absent', async () => {
  world.replies.get_tournament_media_read_targets = (args) => [200, args.p_asset_ids
    .filter((id) => id !== '50000000-0000-4000-8000-0000000000ff')
    .map((id) => ({ assetId: id, kind: args.p_kind, objectName: id === AST ? OBJECT : OBJECT2 }))];
  world.refuse = new Set([OBJECT2]);
  const bearer = token();
  const r = await urls({ items: [{ assetId: AST, kind: 'grid' }, { assetId: AST, kind: 'detail' }, { assetId: AST2, kind: 'grid' },
    { assetId: '50000000-0000-4000-8000-0000000000ff', kind: 'grid' }] }, { bearer });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.expiresIn, 300);
  assert.deepEqual(json.items, [
    { assetId: AST, kind: 'grid', url: `${STORAGE}/object/sign/tournament-media/${OBJECT}?token=t-${OBJECT.slice(-12)}` },
    { assetId: AST, kind: 'detail', url: `${STORAGE}/object/sign/tournament-media/${OBJECT}?token=t-${OBJECT.slice(-12)}` },
  ]);
  assert.deepEqual(world.rest.map((call) => [call.name, call.authorization, call.args.p_kind]), [
    ['get_tournament_media_read_targets', `Bearer ${bearer}`, 'grid'], ['get_tournament_media_read_targets', `Bearer ${bearer}`, 'detail']]);
  const signs = world.storage.filter((call) => call.url === '/object/sign/tournament-media');
  assert.equal(signs.length, 1);
  assert.equal(signs[0].headers.authorization, `Bearer ${bearer}`, 'storage RLS decides again, as the caller');
  assert.deepEqual(JSON.parse(signs[0].body).paths, [OBJECT, OBJECT2]);
  assert.ok(!JSON.stringify(json).includes(OBJECT2), 'a refused object never leaves the gateway');
  for (const body of [{}, { items: [] }, { items: [{ assetId: 'x', kind: 'grid' }] }, { items: [{ assetId: AST, kind: 'original' }] },
    { items: [{ assetId: AST, kind: 'grid', path: 'x' }] }, { items: Array.from({ length: 121 }, () => ({ assetId: AST, kind: 'grid' })) },
    { items: [{ assetId: AST, kind: 'grid' }], extra: true }]) {
    assert.equal((await urls(body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await urls({ items: [{ assetId: AST, kind: 'grid' }] }, { bearer: null })).status, 401);
});
