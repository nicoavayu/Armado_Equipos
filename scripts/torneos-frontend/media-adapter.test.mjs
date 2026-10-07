// MEDIA-V1 — the photo galleries in the hybrid composition.
//   • each gallery alias sends the same RPC name and p_* payload as the LOCAL service (the REAL legacy module against a
//     recording Core stub, the hybrid adapter against a recording transport)
//   • the client scope equals the gateway allowlist; without `media: true` it fails closed before the network, and the
//     gateway-internal RPCs are never reachable from the browser
//   • the transport's two media routes: exact path and query, the raw image body, the bearer, the gateway's refusal codes
//   • what the organizer reads for each refusal (quota numbers, content verdicts, duplicates), and which ones retry
//   • the composition: media only with hybrid + REACT_APP_TORNEOS_MEDIA_MODE=on + the media flag
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';

const ADAPTER = 'src/features/torneos/stagingV1/stagingV1WorkspaceService.js';
const LEGACY = 'src/features/torneos/api/tournamentWorkspaceService.js';
const ALLOWLIST = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/media-v1-rpc-allowlist.json'));
const CONTRACT = JSON.parse(read('backend/torneos/media-v1/contract.json'));
const AUTHENTICATED = Object.values(ALLOWLIST.features).flat();
const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const GALLERY = '40000000-0000-4000-8000-000000000001';
const ASSET = '50000000-0000-4000-8000-000000000001';
const KEY = '70000000-0000-4000-8000-000000000001';
const GW = 'https://gateway.example.test/functions/v1/torneos-gateway';
const uuidStub = { v4: () => KEY };
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
const explicitNulls = (params) => Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, v === undefined ? null : v]));

function recordingTransport() {
  const calls = [];
  return {
    calls,
    transport: {
      rpc: async (name, params) => { calls.push({ name, params }); return name === 'get_tournament_media_admin_context' ? { galleries: [] } : { ok: true }; },
      mediaUpload: async (args) => { calls.push({ name: 'mediaUpload', args }); return { assetId: ASSET, status: 'pending_review' }; },
      mediaUrls: async (items) => { calls.push({ name: 'mediaUrls', items }); return { items: items.map((i) => ({ ...i, url: `https://s.test/${i.assetId}` })) }; },
      clear() {},
      dispose() {},
    },
  };
}
const loadAdapter = (transport, options = {}) => runtime({ modules: { uuid: uuidStub } }).load(ADAPTER)
  .createStagingV1WorkspaceService({ transport, ...options });
function loadLegacy() {
  const calls = [];
  const supabase = {
    rpc: async (name, params) => { calls.push({ name, params }); return { data: name === 'get_tournament_media_admin_context' ? { galleries: [] } : { ok: true }, error: null }; },
    from: () => { throw new Error('no table access expected'); },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  };
  const rt = runtime({ modules: {
    uuid: uuidStub,
    'src/services/api/supabase.js': { supabase, default: supabase },
    'src/lib/supabaseClient.js': { supabase, supabaseCore: supabase, default: supabase },
  } });
  return { calls, module: rt.load(LEGACY) };
}

// One sample per alias whose LOCAL counterpart is a single RPC.
const SAMPLES = {
  loadSeasonMediaUsage: [[{ organizationId: ORG, seasonId: SEASON }]],
  createMediaGallery: [
    [{ organizationId: ORG, tournamentId: TOURNAMENT, title: 'Fecha 1', idempotencyKey: KEY }],
    [{ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: SEASON, roundId: SEASON, matchId: ASSET, title: 'Final',
      description: 'La noche', visibility: 'match_participants', idempotencyKey: KEY }],
  ],
  updateMediaGallery: [[{ galleryId: GALLERY, title: 'Fecha 1', visibility: 'tournament_participants', submitForReview: true }]],
  cancelMediaUploadSession: [[GALLERY]],
  transitionMediaAsset: [[{ assetId: ASSET, action: 'approve' }], [{ assetId: ASSET, action: 'hide', reason: 'Privacidad' }]],
  setMediaCover: [[{ galleryId: GALLERY, assetId: ASSET }]],
  reorderMediaItem: [[{ galleryId: GALLERY, assetId: ASSET, targetOrder: 2 }]],
  publishMediaGallery: [[GALLERY]],
  changeMediaGalleryState: [[{ galleryId: GALLERY, action: 'archive', reason: 'Fin de temporada' }]],
  handleMediaReport: [[{ reportId: ASSET, status: 'resolved', resolution: 'Retirada' }], [{ reportId: ASSET, status: 'dismissed' }]],
  loadPublishedMedia: [[{ tournamentId: TOURNAMENT }], [{ tournamentId: TOURNAMENT, categoryId: SEASON, matchId: ASSET, limit: 50, offset: 50 }]],
  reportMediaAsset: [[{ assetId: ASSET, reason: 'privacy', detail: 'Soy yo', requestHide: true, idempotencyKey: KEY }]],
};

test('each gallery alias sends the same RPC name and p_* payload as the LOCAL service; the admin context the same three reads', async () => {
  const legacy = loadLegacy();
  const service = legacy.module.tournamentWorkspaceService;
  const recorder = recordingTransport();
  const adapter = loadAdapter(recorder.transport, { media: true });
  const reached = new Set();
  for (const [alias, samples] of Object.entries(SAMPLES)) {
    for (const args of samples) {
      legacy.calls.length = 0; recorder.calls.length = 0;
      await service[alias](...args);
      await adapter[alias](...args);
      assert.equal(legacy.calls.length, 1, `${alias}: LOCAL makes one RPC`);
      assert.equal(recorder.calls.length, 1, `${alias}: hybrid makes one call`);
      assert.equal(recorder.calls[0].name, legacy.calls[0].name, alias);
      same(recorder.calls[0].params, explicitNulls(legacy.calls[0].params));
      reached.add(recorder.calls[0].name);
    }
  }
  legacy.calls.length = 0; recorder.calls.length = 0;
  await service.loadMediaAdminContext({ organizationId: ORG });
  const context = await adapter.loadMediaAdminContext({ organizationId: ORG });
  // LOCAL adds a plan read the hybrid composition does not serve; the quota comes from loadSeasonMediaUsage.
  same(recorder.calls.map((c) => [c.name, c.params]), legacy.calls.slice(0, 3).map((c) => [c.name, explicitNulls(c.params)]));
  assert.equal(context.entitlements, null);
  for (const call of recorder.calls) reached.add(call.name);
  assert.deepEqual([...reached].sort(), [...AUTHENTICATED].sort(), 'the aliases cover exactly the authenticated contract');
});

test('the client scope is the gateway allowlist, stays closed without media: true, and never reaches a gateway-internal RPC', async () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const scope = rt.load('src/features/torneos/foundation/mediaV1Scope.js');
  same(scope.mediaV1Scope, ALLOWLIST.features);
  const { createTorneosClient } = rt.load('src/features/torneos/foundation/torneosClient.js');
  const recorder = recordingTransport();
  for (const options of [{}, { branding: true }, { connected: true }, { media: 'true' }, { media: 1 }]) {
    const client = createTorneosClient({ transport: recorder.transport, ...options });
    for (const name of AUTHENTICATED) {
      await assert.rejects(client.execute(name, {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1', `${name} ${JSON.stringify(options)}`);
    }
    await assert.rejects(client.mediaUpload({ galleryId: GALLERY, idempotencyKey: KEY, file: { size: 1, type: 'image/jpeg' } }), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1');
    await assert.rejects(client.mediaUrls([{ assetId: ASSET, kind: 'grid' }]), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1');
  }
  const open = createTorneosClient({ transport: recorder.transport, media: true });
  for (const name of [...CONTRACT.gateway_internal_rpcs, 'request_tournament_media_upload_session', 'complete_tournament_media_simple_upload',
    'authorize_tournament_media_read', 'tag_tournament_media_asset', 'manage_tournament_media_consent', 'assign_tournament_media_photographer']) {
    await assert.rejects(open.execute(name, {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1', name);
  }
  // The routes' own input contract, before the network.
  for (const bad of [
    { galleryId: 'x', idempotencyKey: KEY, file: { size: 1, type: 'image/jpeg' } },
    { galleryId: GALLERY, idempotencyKey: null, file: { size: 1, type: 'image/jpeg' } },
    { galleryId: GALLERY, idempotencyKey: KEY, file: { size: 0, type: 'image/jpeg' } },
    { galleryId: GALLERY, idempotencyKey: KEY, file: { size: 4 * 1024 * 1024 + 1, type: 'image/jpeg' } },
    { galleryId: GALLERY, idempotencyKey: KEY, file: { size: 10, type: 'image/heic' } },
  ]) await assert.rejects(open.mediaUpload(bad), (e) => e.code === 'TORNEOS_INVALID_REQUEST', JSON.stringify(bad));
  for (const bad of [[], [{ assetId: 'x', kind: 'grid' }], [{ assetId: ASSET, kind: 'original' }], Array.from({ length: 121 }, () => ({ assetId: ASSET, kind: 'grid' }))]) {
    await assert.rejects(open.mediaUrls(bad), (e) => e.code === 'TORNEOS_INVALID_REQUEST');
  }
  assert.equal(recorder.calls.length, 0);
  for (const name of AUTHENTICATED) await open.execute(name, {});
  assert.deepEqual(recorder.calls.map((c) => c.name), AUTHENTICATED);
});

test('without media the hybrid adapter has no gallery alias and never deletes; with it, retiring is moderation', () => {
  const recorder = recordingTransport();
  const { MEDIA_METHODS } = runtime({ modules: { uuid: uuidStub } }).load(ADAPTER);
  for (const options of [{}, { branding: true }, { connected: true }, { media: 'true' }]) {
    const service = loadAdapter(recorder.transport, options);
    for (const name of MEDIA_METHODS) assert.equal(service[name], undefined, `${name} ${JSON.stringify(options)}`);
  }
  const service = loadAdapter(recorder.transport, { media: true });
  for (const name of MEDIA_METHODS) assert.equal(typeof service[name], 'function', name);
  assert.equal(service.deleteMediaAsset, undefined, 'permanent erasure is not part of MEDIA-V1');
  assert.equal(service.requestMediaUploadSession, undefined, 'the browser never opens a raw session');
  assert.deepEqual([...MEDIA_METHODS].sort(), [...Object.keys(SAMPLES), 'loadMediaAdminContext', 'uploadMediaPhoto', 'signMediaReadUrls'].sort());
});

test('signed reads: one gateway call, URLs keyed assetId:kind, nothing invented for refused assets', async () => {
  const recorder = recordingTransport();
  recorder.transport.mediaUrls = async (items) => { recorder.calls.push({ name: 'mediaUrls', items }); return { items: [{ assetId: ASSET, kind: 'grid', url: 'https://s.test/a' }] }; };
  const service = loadAdapter(recorder.transport, { media: true });
  const urls = await service.signMediaReadUrls([{ assetId: ASSET, kind: 'grid' }, { assetId: GALLERY, kind: 'grid' }]);
  same(urls, { [`${ASSET}:grid`]: 'https://s.test/a' });
  assert.equal(recorder.calls.length, 1);
  same(await service.signMediaReadUrls([]), {});
});

test('the transport: exact media routes, the raw photo, the bearer, and the gateway\'s refusal kept on the error', async () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { createTorneosTransport } = rt.load('src/features/torneos/foundation/torneosTransport.js');
  const calls = [];
  let answer = { status: 201, body: { assetId: ASSET, status: 'pending_review', width: 64, height: 48 } };
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/exchange')) {
      return new Response(JSON.stringify({ access_token: 'bridge-token', token_type: 'Bearer', expires_in: 120 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
  const transport = createTorneosTransport({ gatewayUrl: GW, getCoreAccessToken: async () => 'core-token', fetchImpl });
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  const ok = await transport.mediaUpload({ galleryId: GALLERY, idempotencyKey: KEY, file: photo }, { onProgress: () => {} });
  same(ok, { assetId: ASSET, status: 'pending_review', width: 64, height: 48, httpStatus: 201 });
  const upload = calls.at(-1);
  assert.equal(upload.url, `${GW}/torneos/media/v1/upload?gallery=${GALLERY}&key=${KEY}`);
  assert.equal(upload.init.method, 'POST');
  assert.equal(upload.init.headers.Authorization, 'Bearer bridge-token');
  assert.equal(upload.init.headers['Content-Type'], 'image/jpeg');
  assert.equal(upload.init.body, photo, 'the normalized photo itself, never re-encoded or wrapped');
  answer = { status: 200, body: { items: [{ assetId: ASSET, kind: 'grid', url: 'https://s.test/a' }], expiresIn: 300 } };
  same(await transport.mediaUrls([{ assetId: ASSET, kind: 'grid' }]), answer.body);
  assert.equal(calls.at(-1).url, `${GW}/torneos/media/v1/urls`);
  same(JSON.parse(calls.at(-1).init.body), { items: [{ assetId: ASSET, kind: 'grid' }] });
  answer = { status: 422, body: { error: 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED', quota: { usage: 25, limit: 25, upgradeRequired: true } } };
  await assert.rejects(transport.mediaUpload({ galleryId: GALLERY, idempotencyKey: KEY, file: photo }), (e) => e.code === 'TORNEOS_RPC_ERROR'
    && e.rpcError.message === 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED' && e.rpcError.details.quota.limit === 25);
  answer = { status: 422, body: { error: 'TORNEOS_MEDIA_CONTENT_REJECTED', code: 'MEDIA_METADATA_PRESENT' } };
  await assert.rejects(transport.mediaUpload({ galleryId: GALLERY, idempotencyKey: KEY, file: photo }), (e) => e.rpcError.details.code === 'MEDIA_METADATA_PRESENT');
  answer = { status: 400, body: { error: 'TORNEOS_RPC_LEGACY' } };
  await assert.rejects(transport.mediaUpload({ galleryId: GALLERY, idempotencyKey: KEY, file: photo }), (e) => e.rpcError.details === null,
    'a refusal without media facts keeps details null, as before');
});

test('what the organizer reads: quota in numbers, content in words, retries only where retrying can help', () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { translateMediaUploadError } = rt.load(ADAPTER);
  const { TorneosBoundaryError } = rt.load('src/features/torneos/foundation/errors.js');
  const refusal = (code, details = null) => new TorneosBoundaryError('TORNEOS_RPC_ERROR', {
    status: 422, gatewayError: code, rpcError: { message: code, code, details, hint: null },
  });
  let e = translateMediaUploadError(refusal('TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED', { code: null, quota: { usage: 25, limit: 25, upgradeRequired: true } }));
  assert.equal(e.code, 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED');
  assert.equal(e.retryable, false);
  assert.match(e.message, /25 de 25/);
  assert.match(e.message, /Premium/);
  e = translateMediaUploadError(refusal('TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED', { code: null, quota: { usage: 1000, limit: 1000, upgradeRequired: false } }));
  assert.doesNotMatch(e.message, /Premium/, 'a Premium season is not offered Premium');
  e = translateMediaUploadError(refusal('TORNEOS_MEDIA_CONTENT_REJECTED', { code: 'MEDIA_ANIMATION_UNSUPPORTED', quota: null }));
  assert.equal(e.message, 'Las imágenes animadas todavía no se admiten.');
  assert.equal(e.retryable, false);
  for (const [code, retryable] of [['TORNEOS_MEDIA_DUPLICATE', false], ['TORNEOS_MEDIA_UPLOAD_IN_PROGRESS', true],
    ['TORNEOS_MEDIA_MVP_RATE_LIMITED', true], ['TORNEOS_MEDIA_FORBIDDEN', false], ['TORNEOS_MEDIA_GALLERY_IMMUTABLE', false]]) {
    e = translateMediaUploadError(refusal(code));
    assert.equal(e.retryable, retryable, code);
    assert.doesNotMatch(e.message, /TORNEOS_|bucket|storage|gateway|sesión de carga/i, code);
  }
  e = translateMediaUploadError(new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 503 }));
  assert.equal(e.retryable, true, 'an outage is worth retrying (same key: never a second photo)');
});

test('the composition: media only with hybrid + REACT_APP_TORNEOS_MEDIA_MODE=on + the media flag; the overlay adds only media', () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { resolveTorneosMedia } = rt.load('src/features/torneos/foundation/config.js');
  const hybrid = { mode: 'hybrid', gatewayUrl: GW };
  assert.equal(resolveTorneosMedia({ REACT_APP_TORNEOS_MEDIA_MODE: 'on' }, { backendMode: hybrid, flags: { mediaEnabled: true } }), true);
  for (const [env, backendMode, flags] of [
    [{ REACT_APP_TORNEOS_MEDIA_MODE: 'on' }, hybrid, { mediaEnabled: false }],
    [{ REACT_APP_TORNEOS_MEDIA_MODE: 'on' }, hybrid, null],
    [{ REACT_APP_TORNEOS_MEDIA_MODE: 'ON' }, hybrid, { mediaEnabled: true }],
    [{}, hybrid, { mediaEnabled: true }],
    [{ REACT_APP_TORNEOS_MEDIA_MODE: 'on' }, { mode: 'legacy-local' }, { mediaEnabled: true }],
    [{ REACT_APP_TORNEOS_MEDIA_MODE: 'on' }, { mode: 'closed' }, { mediaEnabled: true }],
  ]) assert.equal(resolveTorneosMedia(env, { backendMode, flags }), false, JSON.stringify([env, backendMode, flags]));
  const { stagingV1FeaturesFor, stagingV1Features } = rt.load('src/features/torneos/stagingV1/stagingV1Features.js');
  assert.equal(stagingV1Features.media, false);
  const on = stagingV1FeaturesFor('off', { media: true });
  assert.equal(on.media, true);
  assert.deepEqual(Object.keys(on).filter((k) => on[k] !== stagingV1Features[k]), ['media']);
  for (const key of ['player_portraits', 'team_photos', 'team_visual_policy', 'branding_assets']) assert.equal(on[key], false, key);
  const { resolveTorneosFeatureFlags } = rt.load('src/features/torneos/config/featureFlags.js');
  const prod = resolveTorneosFeatureFlags({ NODE_ENV: 'production', REACT_APP_DEPLOY_ENV: 'production', REACT_APP_TORNEOS_DATA_ENV: 'production',
    REACT_APP_PRODUCTION_PROJECT_REF: 'abcdefghijklmnopqrst', REACT_APP_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true', REACT_APP_TORNEOS_ENABLED: 'true', REACT_APP_TORNEOS_MEDIA_ENABLED: 'true',
    REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'true' });
  assert.equal(prod.mediaEnabled, true, 'the gallery flag is production-eligible (it opens nothing without the gateway mode)');
  assert.equal(prod.mediaUploadEnabled, false, 'the legacy Core-project upload path stays closed in Production');
});
