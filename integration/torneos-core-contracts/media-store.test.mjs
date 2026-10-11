// MEDIA-STORE-V1 — the photo gallery on the REAL local hybrid stack, with Storage trusting only what HOSTED Storage
// trusts (the project's ES256 key + the legacy HS256 secret; NOT the bridge's RS256 tokens), 00000000000012/14/17 and the
// torneos-media-store worker, through the gateway under test (Node by default, Edge with GATEWAY=edge).
//
//   A. install: MVP_SIMPLE; both buckets private with their real limits; 0017's RPC for authenticated only.
//   B. the function's own door: unsigned, stale, re-bound or unknown requests are refused before anything is read; a
//      bridge token straight at Storage is refused ("alg" not allowed) exactly like hosted Supabase.
//   C. the organizer uploads a photo + thumbnail to its draft: both objects exist, written by the service role.
//   D. who may upload: the captain (participant), an outsider, another organization's owner and a visitor are refused;
//      the other organization uploads to ITS OWN gallery (control).
//   E. the store judges with the database even when the HMAC is valid (what a stolen secret alone buys): another
//      organization's identity can neither write, remove nor sign this organization's objects; the organizer's own plain
//      identity cannot write a name no live session issued, nor remove a photo that already is an asset.
//   F. real types and sizes: wrong declared type, EXIF orientation, markup, GIF, oversize photo / thumbnail, a thumbnail
//      of another shape → refused, and nothing is stored. Metadata carriers (EXIF in a WebP) are stripped by the gateway
//      before the store sees the bytes: only the clean object exists (the store itself refuses unstripped bytes).
//   G. retries: the same key twice is one asset (replayed); a double tap is one asset; the same photo under a new key is
//      a duplicate. Four different photos at the same time are four assets.
//   H. reads: a published participants' gallery is signed for its participant only; an "organization" gallery for staff
//      only; nobody else, no visitor, no public URL, no anon signature; a retired photo is no longer signed.
//   I. FREE quota: 25 per season, refused at the 26th; rejecting one frees its place. (The existing per-user ceiling of
//      30 upload sessions per 15 min answers 429 TORNEOS_MEDIA_MVP_RATE_LIMITED before that for a busy uploader.)
//   J. Storage down mid-upload: 503, nothing half-written, the same key succeeds once Storage is back.
//   K. expired sessions: a bridge token past its 120 s (+ the gateway's 5 s / the Data API's 30 s clock tolerance) is
//      refused for uploads and URLs, and by the store's database check even when correctly signed.
//
// Runs after `TORNEOS_CONNECTED_MODE=on TORNEOS_BRANDING_MODE=on TORNEOS_MEDIA_MODE=on node lab.mjs up` and the pipeline
// in MVP_SIMPLE (backend/torneos/media-store-v1/lab/db-0017-lab.mjs does both 0017 and the mode). Local only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import { decodeJwt } from 'jose';
import { sql, dc, inGateway, config, BASE, GATEWAY_BASE, GATEWAY_NAME, STORAGE_PUBLIC_BASE, MEDIA } from './lab.mjs';

const RUN = 'ms' + randomBytes(3).toString('hex');
const FUNCTIONS = 'http://127.0.0.1:58421/torneos-media-store/v1';
const torneosSql = (q) => sql('torneos-db', q).trim();
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const FIX = new URL('../../scripts/edge-functions/fixtures/tournament-media/', import.meta.url);
const fixture = (name) => fs.readFileSync(new URL(name, FIX));
const CLEAN = fixture('clean-64x48.jpg');

// A different, still clean and structurally valid 64×48 JPEG per seed: two bytes of the entropy-coded scan change (never
// to 0xFF, never next to one), so the container walk, the dimensions and "no metadata" stay exactly as in the fixture.
const SCAN = (() => {
  let i = 2;
  while (!(CLEAN[i] === 0xff && CLEAN[i + 1] === 0xda)) i += 2 + CLEAN.readUInt16BE(i + 2);
  const start = i + 2 + CLEAN.readUInt16BE(i + 2);
  const safe = [];
  for (let p = start + 1; p < CLEAN.length - 3 && safe.length < 2; p += 1) {
    if (CLEAN[p - 1] !== 0xff && CLEAN[p] !== 0xff && CLEAN[p + 1] !== 0xff) safe.push(p);
  }
  return safe;
})();
function jpeg(seed) {
  const b = Buffer.from(CLEAN);
  b[SCAN[0]] = seed % 254; b[SCAN[1]] = Math.floor(seed / 254) % 254;
  return b;
}
const thumbOf = (seed) => jpeg(seed + 30000);

async function request(path, token, method = 'GET', data, extraHeaders = {}) {
  const base = path.startsWith('/auth/v1') ? BASE : GATEWAY_BASE;
  const raw = Buffer.isBuffer(data);
  const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(data !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    body: data === undefined ? undefined : (raw ? data : JSON.stringify(data)), signal: AbortSignal.timeout(60000) });
  const text = await r.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}
const gw = (name, token, params = {}) => request(`/torneos/rest/v1/rpc/${name}`, token, 'POST', params);
async function exchange(u) {
  const r = await request('/exchange', u.coreToken, 'POST');
  assert.equal(r.status, 200, `exchange for ${u.label}: ${show(r)}`);
  u.token = r.body.access_token; u.tokenAt = Date.now(); u.identity = decodeJwt(u.token).sub;
  return u.token;
}
async function tok(u) { if (!u.token || Date.now() - u.tokenAt > 80_000) await exchange(u); return u.token; }
async function coreActor(label) {
  const email = `${RUN}-${label}@example.test`;
  const s = await request('/auth/v1/signup', null, 'POST', { email, password: `${randomUUID()}Aa!`, data: { full_name: `${RUN} ${label}` } });
  assert.equal(s.status, 200, `GoTrue signup for ${label}`);
  const u = { label, email, coreToken: s.body.access_token };
  await exchange(u);
  return u;
}
// What the app sends: ONE body = the normalized photo, then (declared by ?thumb=) its JPEG thumbnail.
async function upload(u, gallery, seed, { key = randomUUID(), photo = jpeg(seed), thumb = thumbOf(seed), type = 'image/jpeg', bearer } = {}) {
  const body = thumb ? Buffer.concat([photo, thumb]) : photo;
  const search = `?gallery=${gallery}&key=${key}${thumb ? `&thumb=${thumb.length}` : ''}`;
  return request(`/torneos/media/v1/upload${search}`, bearer !== undefined ? bearer : u && await tok(u), 'POST', body, { 'content-type': type });
}
const urls = async (u, ids, kind = 'detail') => request('/torneos/media/v1/urls', u && await tok(u), 'POST',
  { items: ids.map((assetId) => ({ assetId, kind })) });
const objectsIn = (gallery) => Number(torneosSql(`select count(*) from storage.objects where bucket_id = 'tournament-media' and name like '%/${gallery}/%'`));
const assetsIn = (gallery) => Number(torneosSql(`select count(*) from public.tournament_media_assets where gallery_id = '${gallery}'`));

// The function's door, exactly as the gateway signs it (media-store-protocol.ts), from the host: on hosted Supabase the
// function URL is reachable from the Internet too (verify_jwt = false), so this is what anyone holding <secret> can send.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function storeDirect(op, identity, { secret, query = '', body = Buffer.from('{}'), type = 'application/json', at = Math.floor(Date.now() / 1000),
  signedIdentity = identity, signedOp = op } = {}) {
  const search = query ? `?${query}` : '';
  const input = ['POST', `/torneos-media-store/v1/${signedOp}`, search, String(at), sha256(body), sha256(Buffer.from(signedIdentity))].join('\n');
  const headers = { 'content-type': type, 'x-torneos-store-identity': identity, 'x-torneos-store-timestamp': String(at) };
  if (secret) headers['x-torneos-store-signature'] = createHmac('sha256', Buffer.from(secret, 'hex')).update(input).digest('hex');
  const r = await fetch(`${FUNCTIONS}/${op}${search}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
  const text = await r.text(); let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}
// Straight at Storage from inside the lab network with a given bearer (the policies / the JWT check, not the gateway).
function atStorage(bearer, path, method = 'POST', body = null, type = 'application/json') {
  const out = inGateway(`const r = await fetch('http://torneos-storage:5000${path}', { method: ${JSON.stringify(method)},
      headers: { authorization: 'Bearer ' + ${JSON.stringify(bearer)}, 'content-type': ${JSON.stringify(type)} },
      body: ${body === null ? 'undefined' : JSON.stringify(body)} });
    console.log(JSON.stringify({ status: r.status, body: (await r.text()).slice(0, 300) }));`);
  return JSON.parse(out.trim().split('\n').pop());
}

test(`MEDIA-STORE-V1 — the gallery through the restricted media store (${GATEWAY_NAME} gateway)`, async (t) => {
  assert.ok(MEDIA, 'run with TORNEOS_MEDIA_MODE=on (and TORNEOS_BRANDING_MODE=on)');
  const check = (name, fn) => t.test(name, fn);
  const ok = async (name, who, params = {}) => {
    const r = await gw(name, await tok(who), params);
    assert.equal(r.status, 200, `${name} as ${who.label}: ${show(r)}`);
    return r.body;
  };
  const c = await config();
  const S = {};
  const gallery = async (who, org, tournament, title, visibility = 'tournament_participants') => ok('create_tournament_media_gallery', who, {
    p_organization_id: org, p_tournament_id: tournament, p_category_id: null, p_round_id: null, p_match_id: null, p_title: title,
    p_description: '', p_visibility: visibility, p_idempotency_key: randomUUID() });
  const move = (who, assetId, action, reason = null) => ok('transition_tournament_media_asset', who, { p_asset_id: assetId, p_action: action, p_reason: reason });
  const publish = async (who, galleryId, coverId) => {
    await ok('set_tournament_media_cover', who, { p_gallery_id: galleryId, p_asset_id: coverId });
    return ok('publish_tournament_media_gallery', who, { p_gallery_id: galleryId });
  };

  await check('setup: organization A (organizer, approved team whose captain is a participant), organization B, an outsider', async () => {
    S.a = await coreActor('organizer-a'); S.captain = await coreActor('captain'); S.outsider = await coreActor('outsider'); S.b = await coreActor('organizer-b');
    S.org = (await ok('create_tournament_organization', S.a, { p_name: `Liga ${RUN}`, p_slug: `liga-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
    S.season = (await ok('create_tournament_season', S.a, { p_organization_id: S.org, p_name: 'Apertura', p_slug: `apertura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    S.tournament = (await ok('create_tournament_with_defaults', S.a, { p_organization_id: S.org, p_season_id: S.season, p_name: `Copa ${RUN}`, p_slug: `copa-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    const category = await ok('save_tournament_category', S.a, { p_organization_id: S.org, p_tournament_id: S.tournament, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' });
    const categoryId = category?.id || category?.categoryId || category?.category?.id;
    await ok('change_tournament_status', S.a, { p_organization_id: S.org, p_tournament_id: S.tournament, p_status: 'registration' });
    const entry = await ok('create_tournament_team_entry', S.a, { p_organization_id: S.org, p_tournament_id: S.tournament, p_category_id: categoryId, p_arma2_team_id: null, p_name: `Halcones ${RUN}`, p_short_name: 'HAL', p_primary_color: '#7c3aed', p_secondary_color: '#facc15', p_registration_source: null, p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
    const invitation = await ok('invite_tournament_team_manager', S.a, { p_organization_id: S.org, p_team_entry_id: entry.entryId, p_email: S.captain.email, p_display_name: 'Capi', p_role: 'captain' });
    await ok('accept_tournament_team_invitation', S.captain, { p_token: invitation.token });
    for (const [index, position] of ['ARQ', 'DEF', 'DEF', 'MED', 'DEL', 'DEL'].entries()) {
      const player = await ok('create_tournament_provisional_player', S.a, { p_organization_id: S.org, p_team_entry_id: entry.entryId, p_display_name: `Jugador ${index + 1}` });
      await ok('add_tournament_roster_player', S.a, { p_organization_id: S.org, p_team_entry_id: entry.entryId, p_roster_id: entry.rosterId, p_arma2_user_id: null, p_provisional_player_id: player.id || player.provisionalPlayerId || player.playerId, p_display_name: `Jugador ${index + 1}`, p_avatar_url: null, p_shirt_number: index + 1, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: position === 'ARQ' });
    }
    await ok('submit_tournament_team_entry', S.captain, { p_organization_id: S.org, p_team_entry_id: entry.entryId });
    await ok('review_tournament_team_entry', S.a, { p_organization_id: S.org, p_team_entry_id: entry.entryId, p_decision: 'approved', p_reason: 'Plantel completo.', p_issues: [] });
    S.orgB = (await ok('create_tournament_organization', S.b, { p_name: `Otra ${RUN}`, p_slug: `otra-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
    S.seasonB = (await ok('create_tournament_season', S.b, { p_organization_id: S.orgB, p_name: 'Otra', p_slug: `otra-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    S.tournamentB = (await ok('create_tournament_with_defaults', S.b, { p_organization_id: S.orgB, p_season_id: S.seasonB, p_name: `Copa Otra ${RUN}`, p_slug: `copa-otra-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    S.g1 = await gallery(S.a, S.org, S.tournament, 'Fecha 1');
    S.gB = await gallery(S.b, S.orgB, S.tournamentB, 'Otra fecha');
  });

  await check('A. MVP_SIMPLE; both buckets private with their limits; 0017 for authenticated only', async () => {
    assert.equal(torneosSql('select mode from public.tournament_media_pipeline_configuration where singleton'), 'MVP_SIMPLE');
    assert.equal(torneosSql(`select string_agg(id || ':' || public || ':' || file_size_limit, ',' order by id) from storage.buckets`),
      'tournament-branding:false:2097152,tournament-media:false:4194304');
    assert.equal(torneosSql(`select has_function_privilege('authenticated', 'public.authorize_tournament_storage_objects(text,text,text[])', 'EXECUTE')
      || '/' || has_function_privilege('anon', 'public.authorize_tournament_storage_objects(text,text,text[])', 'EXECUTE')
      || '/' || has_function_privilege('service_role', 'public.authorize_tournament_storage_objects(text,text,text[])', 'EXECUTE')`), 'true/false/false');
  });

  await check('B. the function refuses unsigned / stale / re-bound / unknown requests; a bridge token at Storage is refused ("alg")', async () => {
    const identity = await tok(S.a);
    const body = Buffer.from(JSON.stringify({ names: [`${S.org}/${S.tournament}/${S.g1}/${randomUUID()}.jpg`] }));
    assert.deepEqual([(await storeDirect('media-sign', identity, { body })).status], [401], 'no signature');
    assert.equal((await storeDirect('media-sign', identity, { body, secret: 'ab'.repeat(32) })).status, 401, 'another secret');
    assert.equal((await storeDirect('media-sign', identity, { body, secret: c.mediaStoreSecret, at: Math.floor(Date.now() / 1000) - 61 })).status, 401, 'stale');
    assert.equal((await storeDirect('media-sign', identity, { body, secret: c.mediaStoreSecret, signedIdentity: await tok(S.b) })).status, 401,
      'a signature binds ONE identity: it cannot be replayed with another');
    assert.equal((await storeDirect('media-sign', identity, { body, secret: c.mediaStoreSecret, signedOp: 'branding-sign' })).status, 401, 'bound to its operation');
    assert.equal((await storeDirect('media-list', identity, { body, secret: c.mediaStoreSecret })).status, 404, 'no listing operation exists');
    assert.equal((await fetch(`${FUNCTIONS}/media-sign`)).status, 404, 'GET');
    const control = await storeDirect('media-sign', identity, { body, secret: c.mediaStoreSecret });
    assert.deepEqual([control.status, control.body], [200, { urls: {} }], `the correctly signed request is answered: ${show(control)}`);

    const put = atStorage(identity, `/object/tournament-media/${S.org}/${S.tournament}/${S.g1}/${randomUUID()}.jpg`, 'POST', null, 'image/jpeg');
    assert.equal(put.status, 400, JSON.stringify(put)); assert.match(put.body, /alg.*not allowed/i);
    const sign = atStorage(identity, '/object/sign/tournament-media', 'POST', JSON.stringify({ expiresIn: 60, paths: ['x/y.jpg'] }));
    assert.equal(sign.status, 400, JSON.stringify(sign)); assert.match(sign.body, /alg.*not allowed/i);
  });

  await check('C. the organizer uploads photo + thumbnail; both objects stored by the service role after the database said yes', async () => {
    const r = await upload(S.a, S.g1, 1);
    assert.equal(r.status, 201, show(r));
    assert.equal(r.body.thumbnail, true);
    S.first = r.body.assetId;
    assert.equal(objectsIn(S.g1), 2);
    assert.equal(torneosSql(`select count(owner_id) from storage.objects where bucket_id = 'tournament-media' and name like '%/${S.g1}/%'`), '0');
    assert.equal(torneosSql(`select status from public.tournament_media_assets where id = '${S.first}'`), 'pending_review');
    const stored = torneosSql(`select internal_path from public.tournament_media_assets where id = '${S.first}'`);
    assert.match(stored, new RegExp(`^${S.org}/${S.tournament}/${S.g1}/[0-9a-f-]{36}\\.jpg$`));
  });

  await check('D. who may upload to organization A\'s draft: only its staff; B uploads to its own (control)', async () => {
    for (const who of ['captain', 'outsider', 'b']) {
      const r = await upload(S[who], S.g1, 100 + who.length);
      assert.equal(r.status, 403, `${who}: ${show(r)}`);
    }
    assert.equal((await upload(null, S.g1, 110, { bearer: null })).status, 401, 'visitor');
    assert.equal(objectsIn(S.g1), 2, 'nothing more stored');
    const own = await upload(S.b, S.gB, 111);
    assert.equal(own.status, 201, show(own));
    S.bAsset = own.body.assetId;
  });

  await check('E. a valid HMAC does not authorize: the database decides for the identity it is given', async () => {
    const secret = c.mediaStoreSecret;
    const name = `${S.org}/${S.tournament}/${S.g1}/${randomUUID()}.jpg`;
    const photo = jpeg(200);
    for (const who of ['b', 'outsider', 'captain', 'a']) {
      const r = await storeDirect('media-put', await tok(S[who]), { secret, query: new URLSearchParams({ kind: 'photo', name }).toString(), body: photo, type: 'image/jpeg' });
      assert.deepEqual([r.status, r.body], [403, { error: 'FORBIDDEN' }], `${who} writing a name no live session issued: ${show(r)}`);
    }
    const aObject = torneosSql(`select internal_path from public.tournament_media_assets where id = '${S.first}'`);
    const signB = await storeDirect('media-sign', await tok(S.b), { secret, body: Buffer.from(JSON.stringify({ names: [aObject] })) });
    assert.deepEqual([signB.status, signB.body], [200, { urls: {} }], 'B signs nothing of A');
    const delB = await storeDirect('media-delete', await tok(S.b), { secret, body: Buffer.from(JSON.stringify({ names: [aObject] })) });
    assert.deepEqual([delB.status, delB.body], [200, { removed: [] }], 'B removes nothing of A');
    const delA = await storeDirect('media-delete', await tok(S.a), { secret, body: Buffer.from(JSON.stringify({ names: [aObject] })) });
    assert.deepEqual([delA.status, delA.body], [200, { removed: [] }], 'an asset is never removed through the store, not even by its organizer');
    const brandB = await storeDirect('branding-put', await tok(S.b), { secret, body: fixture('clean-64x48.png'), type: 'image/png',
      query: new URLSearchParams({ entity: S.tournament, kind: 'tournament', organization: S.org }).toString() });
    assert.deepEqual([brandB.status, brandB.body], [403, { error: 'FORBIDDEN' }], 'B stores no logo for A');
    const forged = await storeDirect('media-sign', `${(await tok(S.a)).split('.').slice(0, 2).join('.')}.${'A'.repeat(43)}`,
      { secret, body: Buffer.from(JSON.stringify({ names: [aObject] })) });
    assert.deepEqual([forged.status, forged.body], [403, { error: 'FORBIDDEN' }], 'an identity the Data API cannot verify is refused there');
    assert.equal(objectsIn(S.g1), 2);
  });

  await check('F. real types and sizes are decided on the bytes; nothing is stored for a refusal', async () => {
    S.gF = await gallery(S.a, S.org, S.tournament, 'Tipos');
    const cases = [
      ['PNG bytes declared as JPEG', { photo: fixture('clean-64x48.png'), thumb: null }, [422, 415]],
      ['JPEG with EXIF orientation 6', { photo: fixture('exif-orient6-64x48.jpg'), thumb: null }, [422]],
      ['SVG markup declared as PNG', { photo: fixture('payload.svg'), thumb: null, type: 'image/png' }, [422, 415]],
      ['GIF', { photo: fixture('sample-8x8.gif'), thumb: null, type: 'image/gif' }, [415]],
      ['a photo over 4 MiB', { photo: Buffer.alloc(4 * 1024 * 1024 + 1, 7), thumb: null }, [413]],
      ['a thumbnail over 512 KiB', { thumb: Buffer.alloc(512 * 1024 + 1, 7) }, [413]],
      ['a thumbnail of another shape', { thumb: fixture('probe-8x8.jpg') }, [422]],
      ['a thumbnail that is not a JPEG', { thumb: fixture('clean-64x48.png') }, [422]],
    ];
    for (const [label, options, statuses] of cases) {
      const r = await upload(S.a, S.gF, 300 + label.length, options);
      assert.ok(statuses.includes(r.status), `${label}: ${show(r)}`);
    }
    assert.equal(objectsIn(S.gF), 0, 'no byte of a refused upload reached the bucket');
    const withExif = fixture('exif-64x48.webp');
    const stripped = await upload(S.a, S.gF, 399, { photo: withExif, thumb: null, type: 'image/webp' });
    assert.equal(stripped.status, 201, show(stripped));
    const size = Number(torneosSql(`select metadata->>'size' from storage.objects where bucket_id = 'tournament-media' and name like '%/${S.gF}/%.webp'`));
    assert.ok(size > 0 && size < withExif.length, `only the stripped bytes are stored (${size} < ${withExif.length})`);
    assert.equal(torneosSql(`select byte_size from public.tournament_media_assets where id = '${stripped.body.assetId}'`), String(size), 'the asset describes the stored object');
  });

  await check('G. retries and concurrency: same key = one asset; double tap = one asset; duplicate photo refused; 4 at once = 4', async () => {
    const key = randomUUID();
    const first = await upload(S.a, S.g1, 2, { key });
    const again = await upload(S.a, S.g1, 2, { key });
    assert.deepEqual([first.status, again.status, again.body.replayed, again.body.assetId], [201, 200, true, first.body.assetId], show(again));
    const tap = randomUUID();
    const both = await Promise.all([upload(S.a, S.g1, 3, { key: tap }), upload(S.a, S.g1, 3, { key: tap })]);
    const codes = both.map((r) => r.status).sort();
    assert.ok(['200,201', '201,409'].includes(codes.join()), `double tap: ${both.map(show).join(' | ')}`);
    const duplicate = await upload(S.a, S.g1, 2);
    assert.equal(duplicate.status, 409, `same photo, new key: ${show(duplicate)}`);
    const four = await Promise.all([4, 5, 6, 7].map((seed) => upload(S.a, S.g1, seed)));
    assert.deepEqual(four.map((r) => r.status), [201, 201, 201, 201], four.map(show).join(' | '));
    assert.equal(assetsIn(S.g1), 7);
    assert.equal(objectsIn(S.g1), 14, 'photo + thumbnail each, no orphan');
    S.assets = [S.first, first.body.assetId, ...four.map((r) => r.body.assetId)];
  });

  await check('H. reads: participants of a published gallery only; staff only for "organization"; nobody else; no public object', async () => {
    const [cover, second] = S.assets;
    // Every other photo of the gallery (the double tap's included) is pending review.
    const rest = torneosSql(`select string_agg(id::text, ',') from public.tournament_media_assets where gallery_id = '${S.g1}'
      and id not in ('${cover}', '${second}')`).split(',');
    await move(S.a, cover, 'approve');
    await move(S.a, second, 'approve');
    // A photo pending review blocks publication: the rest is rejected (and must never be signed for a participant).
    for (const assetId of rest) await move(S.a, assetId, 'reject', 'No corresponde');
    await publish(S.a, S.g1, cover);
    const forCaptain = await urls(S.captain, [cover]);
    assert.equal(forCaptain.status, 200, show(forCaptain));
    assert.equal(forCaptain.body.items.length, 1);
    const served = await fetch(forCaptain.body.items[0].url);
    assert.equal(served.status, 200);
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(jpeg(1)), 'the signed URL serves exactly the stored photo');
    const thumb = await urls(S.captain, [cover], 'thumbnail');
    assert.ok(Buffer.from(await (await fetch(thumb.body.items[0].url)).arrayBuffer()).equals(thumbOf(1)), 'and its thumbnail');
    assert.ok(forCaptain.body.items[0].url.startsWith(`${STORAGE_PUBLIC_BASE}/object/sign/tournament-media/`));
    assert.equal((await urls(S.captain, rest)).body.items.length, 0, 'rejected photos are not signed for a participant');
    assert.equal((await urls(S.captain, [second])).body.items.length, 1);
    assert.equal((await urls(S.outsider, [cover])).body.items.length, 0, 'outsider');
    assert.equal((await urls(S.b, [cover])).body.items.length, 0, 'another organization');
    assert.equal((await urls(null, [cover])).status, 401, 'visitor');
    const path = new URL(forCaptain.body.items[0].url).pathname.replace('/object/sign/', '');
    assert.equal((await fetch(`${STORAGE_PUBLIC_BASE}/object/public/${path}`)).status, 400, 'no public URL: the bucket is private');
    assert.equal((await fetch(`${STORAGE_PUBLIC_BASE}/object/authenticated/${path}`)).status, 400, 'no URL without a token');
    assert.equal((await fetch(forCaptain.body.items[0].url.replace(/token=.{8}/, 'token=AAAAAAAA'))).status, 400, 'tampered signature');
    const anonSign = atStorage(c.anonKey, '/object/sign/tournament-media', 'POST', JSON.stringify({ expiresIn: 60, paths: [path.replace('tournament-media/', '')] }));
    assert.ok(anonSign.status !== 200 || /error/i.test(anonSign.body), `anon never signs a photo: ${JSON.stringify(anonSign)}`);
    const viaPublicRoute = await fetch(`${GATEWAY_BASE}/torneos/public/v1/rpc/get_published_tournament_media`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_tournament_id: S.tournament }) });
    assert.notEqual(viaPublicRoute.status, 200, 'galleries are not on the public route');

    const staffOnly = await gallery(S.a, S.org, S.tournament, 'Solo organización', 'organization');
    const r = await upload(S.a, staffOnly, 8);
    assert.equal(r.status, 201, show(r));
    await move(S.a, r.body.assetId, 'approve');
    await publish(S.a, staffOnly, r.body.assetId);
    assert.equal((await urls(S.a, [r.body.assetId])).body.items.length, 1, 'staff');
    assert.equal((await urls(S.captain, [r.body.assetId])).body.items.length, 0, 'not a participant');

    await move(S.a, cover, 'hide', 'Retirada');
    assert.equal((await urls(S.captain, [cover])).body.items.length, 0, 'a retired photo is no longer signed');
    assert.equal((await urls(S.a, [cover])).body.items.length, 1, 'its organizer still sees it');
  });

  await check('I. FREE quota: 25 per season, refused at the 26th; rejecting one frees its place', async () => {
    // Organization B's season (organizer A already spent part of its own 30 upload sessions per 15 min on C–H).
    const usage = async () => ok('get_tournament_season_media_usage', S.b, { p_organization_id: S.orgB, p_season_id: S.seasonB });
    const start = await usage();
    assert.deepEqual([start.plan, start.limit], ['FREE', 25], JSON.stringify(start));
    const quota = await gallery(S.b, S.orgB, S.tournamentB, 'Cuota');
    let refusal = null; let last = null; let seed = 400;
    while (!refusal && seed < 440) {
      const r = await upload(S.b, quota, seed++);
      if (r.status === 201) last = r.body.assetId; else refusal = r;
    }
    assert.deepEqual([refusal?.status, refusal?.body?.error], [422, 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED'], refusal && show(refusal));
    const full = await usage();
    assert.deepEqual([full.usage, full.remaining], [25, 0]);
    assert.equal(objectsIn(quota), 2 * assetsIn(quota), 'the refused 26th wrote nothing');
    await move(S.b, last, 'reject', 'Libera lugar');
    const next = await upload(S.b, quota, seed++);
    assert.equal(next.status, 201, show(next));
  });

  await check('J. Storage down mid-upload: 503, nothing half-written; the same key succeeds once it is back', async () => {
    const key = randomUUID();
    const before = objectsIn(S.gF);
    dc(['stop', 'torneos-storage'], undefined, true);
    let down;
    try {
      down = await upload(S.a, S.gF, 500, { key });
    } finally {
      dc(['start', 'torneos-storage'], undefined, true);
    }
    assert.equal(down.status, 503, show(down));
    assert.equal(objectsIn(S.gF), before, 'nothing half-written');
    let back = null;
    for (let i = 0; i < 30 && back?.status !== 201; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
      back = await upload(S.a, S.gF, 500, { key });
    }
    assert.equal(back.status, 201, show(back));
    assert.equal(objectsIn(S.gF), before + 2);
  });

  await check('K. an expired session (bridge token past its 120 s) is refused for uploads and URLs', async () => {
    const captain = await exchange(S.captain);
    const organizer = await exchange(S.a);
    const exp = decodeJwt(organizer).exp;
    await new Promise((resolve) => { setTimeout(resolve, Math.max(0, exp * 1000 - Date.now() + 35000)); });
    assert.equal((await upload(null, S.g1, 600, { bearer: organizer })).status, 401, 'upload with an expired token');
    assert.equal((await request('/torneos/media/v1/urls', captain, 'POST', { items: [{ assetId: S.assets[1], kind: 'detail' }] })).status, 401, 'urls');
    const r = await storeDirect('media-sign', organizer, { secret: c.mediaStoreSecret,
      body: Buffer.from(JSON.stringify({ names: [torneosSql(`select internal_path from public.tournament_media_assets where id = '${S.assets[1]}'`)] })) });
    assert.deepEqual([r.status, r.body], [403, { error: 'FORBIDDEN' }], 'even correctly signed, the Data API refuses the expired identity');
  });
});
