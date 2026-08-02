#!/usr/bin/env node
//
// Provisions the private `tournament-media` bucket on a LOCAL Supabase stack.
//
// Bucket creation is deliberately operational rather than migratory: a
// migration that created it would provision cloud storage on every `db push`,
// including Staging and Production. The DB instead ships a fail-closed
// verifier (`tournament_media_storage_contract_status`) so that a missing or
// misconfigured bucket keeps `uploadReady` false.
//
// This script refuses to run against anything that is not a loopback host.
// There is no flag to override that.
//
//   node scripts/storage/provision-tournament-media-local.mjs
//   node scripts/storage/provision-tournament-media-local.mjs --verify

import process from 'node:process';

const BUCKET = 'tournament-media';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

function fail(message) {
  console.error(`[tournament-media] ${message}`);
  process.exit(1);
}

function assertLocal(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`SUPABASE_URL is not a valid URL: ${rawUrl}`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    fail(
      `refusing to touch a non-local backend (${url.hostname}). `
      + 'Remote buckets are provisioned by an operator, never by this script.',
    );
  }
  return url;
}

async function storageRequest(baseUrl, secret, path, init = {}) {
  const response = await fetch(`${baseUrl}/storage/v1${path}`, {
    ...init,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { ok: response.ok, status: response.status, payload };
}

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  const rawUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:57321';
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    fail('set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) for the local stack.');
  }
  const url = assertLocal(rawUrl);
  const baseUrl = url.origin;

  const existing = await storageRequest(baseUrl, secret, `/bucket/${BUCKET}`);
  if (existing.ok) {
    const isPrivate = existing.payload?.public === false;
    console.log(
      `[tournament-media] bucket present · public=${existing.payload?.public} `
      + `· fileSizeLimit=${existing.payload?.file_size_limit}`,
    );
    if (!isPrivate) fail('bucket exists but is PUBLIC. Delete it and re-run.');
    if (verifyOnly) return;
    const updated = await storageRequest(baseUrl, secret, `/bucket/${BUCKET}`, {
      method: 'PUT',
      body: JSON.stringify({
        public: false,
        file_size_limit: MAX_FILE_BYTES,
        allowed_mime_types: ALLOWED_MIME,
      }),
    });
    if (!updated.ok) fail(`could not reconcile bucket: ${JSON.stringify(updated.payload)}`);
    console.log('[tournament-media] bucket reconciled (private, 12 MiB, image/* allowlist).');
    return;
  }
  if (verifyOnly) fail('bucket absent. Run without --verify to create it locally.');

  const created = await storageRequest(baseUrl, secret, '/bucket', {
    method: 'POST',
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: MAX_FILE_BYTES,
      allowed_mime_types: ALLOWED_MIME,
    }),
  });
  if (!created.ok) fail(`could not create bucket: ${JSON.stringify(created.payload)}`);
  console.log(`[tournament-media] created private bucket on ${baseUrl}.`);
}

main().catch((error) => fail(error?.message || String(error)));
