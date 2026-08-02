#!/usr/bin/env node

// Local-only Storage lifecycle for tournament-media. There is no remote
// override. Existing configuration is verified exactly and never reconciled
// silently. Rollback can remove only a proven-empty LOCAL bucket and needs a
// second explicit confirmation.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const STORAGE_CONTRACT = Object.freeze({
  bucket: 'tournament-media',
  public: false,
  maxFileBytes: 12 * 1024 * 1024,
  allowedMimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
});
export const STORAGE_MODES = Object.freeze(['inspect', 'plan', 'dry-run', 'apply', 'verify', 'rollback']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class LocalStorageError extends Error {}
const fail = (message) => { throw new LocalStorageError(message); };

export function assertLocal(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { fail('SUPABASE_URL is invalid.'); }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    fail(`refusing non-local backend ${url.hostname}; there is no override`);
  }
  return url.origin;
}

const normalizeMimes = (value) => [...(value || [])].sort();

export function validateBucket(snapshot) {
  if (!snapshot?.exists) fail('bucket is absent');
  if (snapshot.id !== STORAGE_CONTRACT.bucket && snapshot.name !== STORAGE_CONTRACT.bucket) {
    fail('bucket identity differs');
  }
  if (snapshot.public !== false) fail('bucket is PUBLIC');
  if (Number(snapshot.file_size_limit) !== STORAGE_CONTRACT.maxFileBytes) {
    fail('bucket file size limit differs');
  }
  if (JSON.stringify(normalizeMimes(snapshot.allowed_mime_types))
    !== JSON.stringify(normalizeMimes(STORAGE_CONTRACT.allowedMimeTypes))) {
    fail('bucket MIME allowlist differs');
  }
  return true;
}

async function storageRequest(fetchImpl, baseUrl, secret, requestPath, init = {}) {
  const response = await fetchImpl(`${baseUrl}/storage/v1${requestPath}`, {
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
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  return { ok: response.ok, status: response.status, payload };
}

const inspect = async (fetchImpl, baseUrl, secret) => {
  const response = await storageRequest(fetchImpl, baseUrl, secret, `/bucket/${STORAGE_CONTRACT.bucket}`);
  if (!response.ok && response.status === 404) return { exists: false, id: STORAGE_CONTRACT.bucket };
  if (!response.ok) fail(`bucket inspection failed with HTTP ${response.status}`);
  return { exists: true, ...response.payload };
};

export async function runStorageMode({
  mode,
  rawUrl,
  secret,
  confirmEmptyLocalBucketDelete = false,
  fetchImpl = fetch,
}) {
  if (!STORAGE_MODES.includes(mode)) fail(`unknown mode ${mode}`);
  const baseUrl = assertLocal(rawUrl);
  if (!secret) fail('local service credential is required');
  const before = await inspect(fetchImpl, baseUrl, secret);
  const plan = {
    mode,
    remoteCalls: 0,
    target: 'loopback-only',
    bucket: STORAGE_CONTRACT,
    current: before.exists ? 'present' : 'absent',
    action: before.exists ? 'verify-exact' : 'create',
    policyAction: 'verify-via-database-contract-no-replacement',
  };

  if (mode === 'inspect') return { ...plan, snapshot: before };
  if (mode === 'plan' || mode === 'dry-run') {
    if (before.exists) validateBucket(before);
    return plan;
  }
  if (mode === 'verify') {
    validateBucket(before);
    return { ...plan, verified: true };
  }
  if (mode === 'apply') {
    if (before.exists) {
      validateBucket(before);
      return { ...plan, applied: false, idempotent: true };
    }
    const created = await storageRequest(fetchImpl, baseUrl, secret, '/bucket', {
      method: 'POST',
      body: JSON.stringify({
        id: STORAGE_CONTRACT.bucket,
        name: STORAGE_CONTRACT.bucket,
        public: false,
        file_size_limit: STORAGE_CONTRACT.maxFileBytes,
        allowed_mime_types: STORAGE_CONTRACT.allowedMimeTypes,
      }),
    });
    if (!created.ok) fail(`bucket create failed with HTTP ${created.status}`);
    const after = await inspect(fetchImpl, baseUrl, secret);
    validateBucket(after);
    return { ...plan, applied: true, verified: true };
  }

  // rollback
  if (!before.exists) return { ...plan, rolledBack: false, idempotent: true };
  validateBucket(before);
  if (!confirmEmptyLocalBucketDelete) {
    fail('rollback requires --confirm-empty-local-bucket-delete');
  }
  const listed = await storageRequest(fetchImpl, baseUrl, secret, `/object/list/${STORAGE_CONTRACT.bucket}`, {
    method: 'POST', body: JSON.stringify({ prefix: '', limit: 1 }),
  });
  if (!listed.ok) fail(`bucket emptiness check failed with HTTP ${listed.status}`);
  if (Array.isArray(listed.payload) && listed.payload.length > 0) {
    fail('rollback refuses a non-empty bucket; object deletion is never automatic');
  }
  const removed = await storageRequest(fetchImpl, baseUrl, secret, `/bucket/${STORAGE_CONTRACT.bucket}`, {
    method: 'DELETE',
  });
  if (!removed.ok) fail(`empty local bucket removal failed with HTTP ${removed.status}`);
  return { ...plan, rolledBack: true, userObjectsDeleted: false };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = process.argv.includes('--verify') ? 'verify' : (modeArg?.slice(7) || 'apply');
  runStorageMode({
    mode,
    rawUrl: process.env.SUPABASE_URL || 'http://127.0.0.1:57321',
    secret: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    confirmEmptyLocalBucketDelete: process.argv.includes('--confirm-empty-local-bucket-delete'),
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    console.error(`[tournament-media] ${error.message}`);
    process.exit(1);
  });
}
