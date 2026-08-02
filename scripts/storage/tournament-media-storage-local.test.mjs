// Local Supabase Storage coverage for the Multimedia pipeline.
//
// The embedded-postgres suites prove the SQL contracts. This one proves the
// things only a real Storage service can answer: that the bucket is genuinely
// unreachable without a signature, that a signed upload URL cannot be replayed
// or retargeted, and that the signer and processor move real bytes end to end.
//
// It never touches a remote backend. `assertLocalBackend` refuses anything but
// a loopback host, with no override.
//
//   npx supabase start
//   npm run storage:tournament-media:local
//   npx supabase functions serve --no-verify-jwt=false      # optional, for E2E
//   TOURNAMENT_MEDIA_LOCAL_TEST=true npm run test:storage:local

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import pg from 'pg';

const ENABLED = process.env.TOURNAMENT_MEDIA_LOCAL_TEST === 'true';
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:57321';
const DATABASE_URL = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const BUCKET = 'tournament-media';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const FIXTURES = path.join(
  process.cwd(), 'scripts', 'edge-functions', 'fixtures', 'tournament-media',
);

function assertLocalBackend(rawUrl) {
  const url = new URL(rawUrl);
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`refusing to run against a non-local backend: ${url.hostname}`);
  }
  return url.origin;
}

const skip = !ENABLED
  ? 'set TOURNAMENT_MEDIA_LOCAL_TEST=true with a local Supabase stack running'
  : (!SERVICE_KEY || !ANON_KEY)
    ? 'set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY from `supabase status`'
    : false;

const origin = skip ? null : assertLocalBackend(SUPABASE_URL);

function storageUrl(suffix) {
  return `${origin}/storage/v1${suffix}`;
}

async function serviceFetch(suffix, init = {}) {
  return fetch(storageUrl(suffix), {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

async function keyFetch(key, suffix, init = {}) {
  return fetch(storageUrl(suffix), {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  });
}

/** Creates a confirmed user through the admin API and returns id + access token. */
async function createUser(email) {
  const password = `Arma2-${crypto.randomUUID()}`;
  const created = await fetch(`${origin}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await created.json();
  assert.ok(user?.id, `could not create ${email}: ${JSON.stringify(user)}`);
  const session = await fetch(`${origin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const tokens = await session.json();
  assert.ok(tokens?.access_token, `could not sign in ${email}`);
  return { id: user.id, accessToken: tokens.access_token };
}

async function withClient(run) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const fixture = async (name) => new Uint8Array(await fs.readFile(path.join(FIXTURES, name)));

test('the tournament-media bucket is private and has no public URL', { skip }, async () => {
  const bucket = await (await serviceFetch(`/bucket/${BUCKET}`)).json();
  assert.equal(bucket.public, false, 'bucket must be private');

  const objectName = `${crypto.randomUUID()}/${crypto.randomUUID()}/`
    + `${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
  const bytes = await fixture('probe-1x1.png');
  const uploaded = await serviceFetch(`/object/${BUCKET}/${objectName}`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes,
  });
  assert.equal(uploaded.ok, true, await uploaded.text());

  const publicRead = await fetch(storageUrl(`/object/public/${BUCKET}/${objectName}`));
  assert.equal(publicRead.ok, false, 'a public URL must not resolve');
  assert.ok([400, 401, 403, 404].includes(publicRead.status), String(publicRead.status));

  const anonRead = await keyFetch(ANON_KEY, `/object/${BUCKET}/${objectName}`);
  assert.equal(anonRead.ok, false, 'anon must not read the object directly');

  const anonList = await keyFetch(ANON_KEY, `/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 10 }),
  });
  const listed = anonList.ok ? await anonList.json() : [];
  assert.equal(
    Array.isArray(listed) ? listed.length : 0, 0,
    'anon must not enumerate the bucket',
  );

  const anonWrite = await keyFetch(ANON_KEY, `/object/${BUCKET}/${crypto.randomUUID()}.png`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes,
  });
  assert.equal(anonWrite.ok, false, 'anon must not write');

  const anonDelete = await keyFetch(ANON_KEY, `/object/${BUCKET}/${objectName}`, {
    method: 'DELETE',
  });
  assert.equal(anonDelete.ok, false, 'anon must not delete');

  await serviceFetch(`/object/${BUCKET}/${objectName}`, { method: 'DELETE' });
});

test('an authenticated user holds no direct grant on the bucket', { skip }, async () => {
  const user = await createUser(`media-direct-${crypto.randomUUID()}@arma2.local`);
  const bytes = await fixture('probe-1x1.png');
  const objectName = `${crypto.randomUUID()}/${crypto.randomUUID()}/`
    + `${crypto.randomUUID()}/${crypto.randomUUID()}.png`;

  const write = await fetch(storageUrl(`/object/${BUCKET}/${objectName}`), {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'image/png',
    },
    body: bytes,
  });
  assert.equal(write.ok, false, 'authenticated must not upload directly');

  const read = await fetch(storageUrl(`/object/${BUCKET}/${objectName}`), {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(read.ok, false, 'authenticated must not read directly');

  const sign = await fetch(storageUrl(`/object/sign/${BUCKET}/${objectName}`), {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  assert.equal(sign.ok, false, 'authenticated must not mint its own signature');
});

test('a signed upload URL is single-use and cannot be retargeted', { skip }, async () => {
  const objectName = `${crypto.randomUUID()}/${crypto.randomUUID()}/`
    + `${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
  const bytes = await fixture('probe-1x1.png');

  const signed = await (await serviceFetch(`/object/upload/sign/${BUCKET}/${objectName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })).json();
  assert.ok(signed?.url, JSON.stringify(signed));
  const token = new URL(`${origin}${signed.url}`).searchParams.get('token');

  const first = await fetch(storageUrl(`/object/upload/sign/${BUCKET}/${objectName}?token=${token}`), {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes,
  });
  assert.equal(first.ok, true, await first.text());

  const replay = await fetch(storageUrl(`/object/upload/sign/${BUCKET}/${objectName}?token=${token}`), {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes,
  });
  assert.equal(replay.ok, false, 'the same signature must not overwrite the object');

  // The token is bound to its object name; pointing it elsewhere must fail.
  const elsewhere = `${crypto.randomUUID()}/${crypto.randomUUID()}/`
    + `${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
  const retargeted = await fetch(
    storageUrl(`/object/upload/sign/${BUCKET}/${elsewhere}?token=${token}`),
    { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes },
  );
  assert.equal(retargeted.ok, false, 'a signature must not travel to another path');

  await serviceFetch(`/object/${BUCKET}/${objectName}`, { method: 'DELETE' });
});

test('a signed read URL only works with its own intact token', { skip }, async () => {
  const objectName = `${crypto.randomUUID()}/${crypto.randomUUID()}/`
    + `${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
  const bytes = await fixture('probe-1x1.png');
  await serviceFetch(`/object/${BUCKET}/${objectName}`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes,
  });

  const signed = await (await serviceFetch(`/object/sign/${BUCKET}/${objectName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 300 }),
  })).json();
  const signedUrl = `${origin}/storage/v1${signed.signedURL || signed.signedUrl}`;

  const good = await fetch(signedUrl);
  assert.equal(good.ok, true, 'the signed URL resolves');
  assert.equal((await good.arrayBuffer()).byteLength, bytes.length);

  const tampered = signedUrl.replace(/token=([^&]+)/, (_, value) => (
    `token=${value.slice(0, -4)}${value.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`
  ));
  assert.equal((await fetch(tampered)).ok, false, 'a tampered token is refused');

  const withoutToken = signedUrl.replace(/[?&]token=[^&]+/, '');
  assert.equal((await fetch(withoutToken)).ok, false, 'no token, no object');

  // An expired signature must not resolve either.
  const expired = await (await serviceFetch(`/object/sign/${BUCKET}/${objectName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 1 }),
  })).json();
  await new Promise((resolve) => { setTimeout(resolve, 1600); });
  const expiredUrl = `${origin}/storage/v1${expired.signedURL || expired.signedUrl}`;
  assert.equal((await fetch(expiredUrl)).ok, false, 'an expired signature is refused');

  await serviceFetch(`/object/${BUCKET}/${objectName}`, { method: 'DELETE' });
});

test('the storage contract verifier agrees with the live bucket', { skip }, async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(
      'select public.tournament_media_storage_contract_status() as status',
    );
    const status = rows[0].status;
    assert.equal(status.bucketPresent, true);
    assert.equal(status.bucketPrivate, true);
    assert.equal(status.publicUrlDisabled, true);
    assert.equal(status.servicePoliciesPresent, true);
    assert.equal(status.clientWriteBlocked, true);
  });
});

test('readiness closes when the bucket disappears and reopens when it returns', { skip }, async () => {
  await withClient(async (client) => {
    const readiness = async () => (await client.query(
      'select public.tournament_media_pipeline_readiness() as state',
    )).rows[0].state;

    await client.query(
      `select public.attest_tournament_media_service('signer','0.1.0',$1::jsonb,3600)`,
      [JSON.stringify({
        signedUploadUrls: true, signedReadUrls: true, derivesPathServerSide: true,
      })],
    );
    await client.query(
      `select public.attest_tournament_media_service('processor','0.1.0',$1::jsonb,3600)`,
      [JSON.stringify({
        contentSniffing: true, structuralDecode: true, metadataStripping: true,
        checksumVerification: true, variantGeneration: true, pixelTranscode: false,
      })],
    );
    assert.equal((await readiness()).uploadReady, true, 'ready with a live bucket');

    await client.query(
      "update storage.buckets set public = true where id = 'tournament-media'",
    );
    const opened = await readiness();
    assert.equal(opened.uploadReady, false, 'a public bucket closes uploads');
    assert.ok(opened.blockers.includes('storage.bucket_public'));
    await client.query(
      "update storage.buckets set public = false where id = 'tournament-media'",
    );
    assert.equal((await readiness()).uploadReady, true, 'and reopens when fixed');

    await client.query(
      "delete from public.tournament_media_service_attestations where service = 'processor'",
    );
    const unattested = await readiness();
    assert.equal(unattested.uploadReady, false, 'no processor, no uploads');
    assert.ok(unattested.blockers.includes('service.processor_unattested'));
  });
});
