// Real local E2E for Multimedia 1A in the reduced MVP_SIMPLE tier.
//
// This test deliberately crosses every real boundary: authenticated REST RPC,
// Edge Functions, private Storage, signed delivery and PostgreSQL metadata. It
// refuses non-loopback endpoints and uses the ignored QA storage states created
// by `prepare-torneos-local-auth-states.mjs`.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import pg from 'pg';

const ENABLED = process.env.TOURNAMENT_MEDIA_LOCAL_E2E === 'true';
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:57321';
const DATABASE_URL = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AUTH_STATE_DIR = path.resolve(
  process.env.QA_AUTH_STATE_DIR || '.secrets/torneos-media-auth-20260816',
);
const FIXTURES = Object.freeze({
  png: path.resolve('scripts/edge-functions/fixtures/tournament-media/clean-64x48.png'),
  jpeg: path.resolve('scripts/edge-functions/fixtures/tournament-media/clean-64x48.jpg'),
  webp: path.resolve('scripts/edge-functions/fixtures/tournament-media/clean-64x48.webp'),
});
const BUCKET = 'tournament-media';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function assertLoopback(rawUrl, label) {
  const url = new URL(rawUrl);
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`${label} must be loopback; got ${url.hostname}`);
  }
  return url;
}

const skip = !ENABLED
  ? 'set TOURNAMENT_MEDIA_LOCAL_E2E=true after preparing local QA auth states'
  : (!ANON_KEY || !SERVICE_KEY)
    ? 'local anon and service-role keys are required'
    : false;

const origin = skip ? null : assertLoopback(SUPABASE_URL, 'SUPABASE_URL').origin;
if (!skip) assertLoopback(DATABASE_URL, 'SUPABASE_DB_URL');

function jwtSubject(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Invalid local QA access token.');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).sub;
}

async function tokenFor(role) {
  const state = JSON.parse(await fs.readFile(path.join(AUTH_STATE_DIR, `${role}.json`), 'utf8'));
  const localStorage = state.origins?.[0]?.localStorage || [];
  const stored = localStorage.find((entry) => entry.name === 'sb-127-auth-token');
  const session = JSON.parse(stored?.value || '{}');
  assert.ok(session.access_token, `missing access token for ${role}`);
  return session.access_token;
}

function userHeaders(token, extra = {}) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function jsonResponse(response) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { response, payload };
}

async function rpc(token, name, args, expected = 200) {
  const result = await jsonResponse(await fetch(`${origin}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: userHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  }));
  assert.equal(
    result.response.status,
    expected,
    `${name}: ${JSON.stringify(result.payload)}`,
  );
  return result.payload;
}

async function edge(token, functionName, body, expected = 200) {
  const result = await jsonResponse(await fetch(`${origin}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: userHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }));
  assert.equal(
    result.response.status,
    expected,
    `${functionName}: ${JSON.stringify(result.payload)}`,
  );
  return result.payload;
}

async function storageService(objectName, init = {}) {
  return fetch(`${origin}/storage/v1/object/${BUCKET}/${objectName}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

async function withDatabase(run) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function requestSession(token, galleryId, bytes, mime = 'image/png') {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
  return rpc(token, 'request_tournament_media_upload_session', {
    p_gallery_id: galleryId,
    p_file_name: `upload.${extension}`,
    p_declared_mime: mime,
    p_byte_size: bytes.length,
    p_idempotency_key: crypto.randomUUID(),
  });
}

async function uploadSimple(token, galleryId, bytes, mime) {
  const session = await requestSession(token, galleryId, bytes, mime);
  assert.equal(session.uploadReady, true);
  assert.equal(session.processingTier, 'mvp_simple');
  assert.ok(session.sessionId && session.token);

  const intent = await edge(token, 'tournament-media-signer', {
    action: 'upload-intent',
    sessionId: session.sessionId,
    token: session.token,
  });
  assert.equal(intent.requiresAuth, true);
  assert.equal(intent.expectedBytes, bytes.length);
  const absoluteUploadUrl = new URL(intent.uploadUrl, origin).toString();
  const uploadUrl = assertLoopback(absoluteUploadUrl, 'signed MVP upload URL');
  assert.equal(uploadUrl.pathname, '/functions/v1/tournament-media-signer');
  assert.equal(uploadUrl.searchParams.get('action'), 'mvp-simple-upload');

  const uploaded = await fetch(absoluteUploadUrl, {
    method: 'PUT',
    headers: userHeaders(token, { 'Content-Type': mime }),
    body: bytes,
  });
  assert.equal(uploaded.status, 201, await uploaded.text());

  const finalized = await edge(token, 'tournament-media-processor', {
    action: 'finalize-simple',
    sessionId: session.sessionId,
    token: session.token,
  }, 201);
  assert.equal(finalized.status, 'pending_review');
  assert.ok(finalized.assetId);
  return { session, assetId: finalized.assetId };
}

async function signedRead(token, assetId) {
  const result = await edge(token, 'tournament-media-signer', {
    action: 'read-urls',
    assets: [{ assetId, kind: 'grid' }],
  });
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  return {
    ...item,
    url: item.url ? new URL(item.url, origin).toString() : null,
  };
}

test('MVP_SIMPLE crosses Auth, REST, Edge, private Storage and delete end to end', {
  skip,
  timeout: 60_000,
}, async () => {
  const [
    ownerToken, collaboratorToken, outsiderToken, pngBytes, jpegBytes, webpBytes,
  ] = await Promise.all([
    tokenFor('owner'),
    tokenFor('collaborator'),
    tokenFor('outsider'),
    fs.readFile(FIXTURES.png),
    fs.readFile(FIXTURES.jpeg),
    fs.readFile(FIXTURES.webp),
  ]);
  const ownerId = jwtSubject(ownerToken);

  const scope = await withDatabase(async (client) => {
    const { rows } = await client.query(
      `select member.organization_id, tournament.id as tournament_id
       from public.tournament_organization_members member
       join public.tournaments tournament
         on tournament.organization_id = member.organization_id
       where member.user_id = $1
         and member.role = 'owner'
         and member.status = 'active'
         and tournament.status <> 'archived'
       order by tournament.created_at
       limit 1`,
      [ownerId],
    );
    assert.equal(rows.length, 1, 'owner QA scope must exist');
    return rows[0];
  });

  const galleryId = await rpc(ownerToken, 'create_tournament_media_gallery', {
    p_organization_id: scope.organization_id,
    p_tournament_id: scope.tournament_id,
    p_category_id: null,
    p_round_id: null,
    p_match_id: null,
    p_title: 'QA Multimedia 1A · flujo local',
    p_description: 'Galería regenerable para verificar el flujo privado local.',
    p_visibility: 'organization',
    p_idempotency_key: crypto.randomUUID(),
  });
  assert.match(galleryId, /^[0-9a-f-]{36}$/);

  // A malformed payload lands only in quarantine and is removed when finalize
  // rejects it. Its failed session remains auditable without a Storage object.
  const rejectedBytes = Buffer.alloc(pngBytes.length, 0x61);
  const rejectedSession = await requestSession(
    ownerToken, galleryId, rejectedBytes, 'image/png',
  );
  const rejectedIntent = await edge(ownerToken, 'tournament-media-signer', {
    action: 'upload-intent',
    sessionId: rejectedSession.sessionId,
    token: rejectedSession.token,
  });
  const rejectedUpload = await fetch(new URL(rejectedIntent.uploadUrl, origin), {
    method: 'PUT',
    headers: userHeaders(ownerToken, { 'Content-Type': 'image/png' }),
    body: rejectedBytes,
  });
  assert.equal(rejectedUpload.status, 201, await rejectedUpload.text());
  const rejection = await edge(ownerToken, 'tournament-media-processor', {
    action: 'finalize-simple',
    sessionId: rejectedSession.sessionId,
    token: rejectedSession.token,
  }, 422);
  assert.equal(rejection.error, 'source_rejected');
  const failedSession = await withDatabase(async (client) => (
    await client.query(
      `select status, internal_path
       from public.tournament_media_upload_sessions where id = $1`,
      [rejectedSession.sessionId],
    )
  ).rows[0]);
  assert.equal(failedSession.status, 'failed');
  assert.equal((await storageService(failedSession.internal_path)).ok, false);

  const first = await uploadSimple(ownerToken, galleryId, jpegBytes, 'image/jpeg');
  const metadata = await withDatabase(async (client) => {
    const { rows } = await client.query(
      `select asset.*, item.gallery_id,
              (select count(*)::int from public.tournament_media_variants variant
               where variant.asset_id = asset.id) as variants
       from public.tournament_media_assets asset
       join public.tournament_media_gallery_items item on item.asset_id = asset.id
       where asset.id = $1`,
      [first.assetId],
    );
    assert.equal(rows.length, 1);
    return rows[0];
  });
  assert.equal(metadata.gallery_id, galleryId);
  assert.equal(metadata.processing_tier, 'mvp_simple');
  assert.equal(metadata.status, 'pending_review');
  assert.equal(metadata.detected_mime, 'image/jpeg');
  assert.equal(metadata.variants, 0);
  assert.ok(metadata.internal_path.startsWith(
    `${scope.organization_id}/${scope.tournament_id}/${galleryId}/`,
  ));
  assert.ok(!metadata.internal_path.includes('clean-64x48'));

  const firstOwnerRead = await signedRead(ownerToken, first.assetId);
  assert.ok(firstOwnerRead.url);
  assert.equal(assertLoopback(firstOwnerRead.url, 'signed read URL').origin, origin);
  const firstFetch = await fetch(firstOwnerRead.url);
  assert.equal(firstFetch.ok, true);
  assert.deepEqual(Buffer.from(await firstFetch.arrayBuffer()), jpegBytes);

  // A second signing call models a reload: access is recalculated rather than
  // relying on the previous URL or on a path stored in the browser.
  const reloadedRead = await signedRead(ownerToken, first.assetId);
  assert.equal((await fetch(reloadedRead.url)).ok, true);
  const collaboratorRead = await signedRead(collaboratorToken, first.assetId);
  assert.ok(collaboratorRead.url, 'read-only collaborator receives a signed preview');
  assert.equal((await fetch(collaboratorRead.url)).ok, true);
  const outsiderRead = await signedRead(outsiderToken, first.assetId);
  assert.equal(outsiderRead.url, null, 'outsider receives no signed URL');

  const directRead = await fetch(
    `${origin}/storage/v1/object/${BUCKET}/${metadata.internal_path}`,
    { headers: userHeaders(ownerToken) },
  );
  assert.equal(directRead.ok, false, 'authenticated users cannot bypass signed delivery');
  const directDelete = await fetch(
    `${origin}/storage/v1/object/${BUCKET}/${metadata.internal_path}`,
    { method: 'DELETE', headers: userHeaders(ownerToken) },
  );
  assert.equal(directDelete.ok, false, 'authenticated users cannot delete Storage directly');

  const outsiderDelete = await edge(outsiderToken, 'tournament-media-signer', {
    action: 'delete-asset', assetId: first.assetId,
  }, 403);
  assert.equal(outsiderDelete.error, 'forbidden');
  const collaboratorDelete = await edge(collaboratorToken, 'tournament-media-signer', {
    action: 'delete-asset', assetId: first.assetId,
  }, 403);
  assert.equal(collaboratorDelete.error, 'forbidden');

  const deleted = await edge(ownerToken, 'tournament-media-signer', {
    action: 'delete-asset', assetId: first.assetId,
  });
  assert.deepEqual(deleted, { assetId: first.assetId, deleted: true });
  assert.equal(await withDatabase(async (client) => Number((await client.query(
    'select count(*) from public.tournament_media_assets where id = $1',
    [first.assetId],
  )).rows[0].count)), 0);
  assert.equal((await storageService(metadata.internal_path)).ok, false);
  assert.equal((await fetch(firstOwnerRead.url)).ok, false, 'old signed URL dies with the object');
  assert.equal((await signedRead(ownerToken, first.assetId)).url, null);

  // Leave one real QA image in place for the final browser review.
  const witness = await uploadSimple(ownerToken, galleryId, webpBytes, 'image/webp');
  const witnessRead = await signedRead(ownerToken, witness.assetId);
  assert.ok(witnessRead.url);
  assert.equal((await fetch(witnessRead.url)).ok, true);
  const witnessRow = await withDatabase(async (client) => (
    await client.query(
      `select asset.id, asset.status, asset.processing_tier, gallery.title
       from public.tournament_media_assets asset
       join public.tournament_media_galleries gallery on gallery.id = asset.gallery_id
       where asset.id = $1`,
      [witness.assetId],
    )
  ).rows[0]);
  assert.deepEqual(witnessRow, {
    id: witness.assetId,
    status: 'pending_review',
    processing_tier: 'mvp_simple',
    title: 'QA Multimedia 1A · flujo local',
  });
});
