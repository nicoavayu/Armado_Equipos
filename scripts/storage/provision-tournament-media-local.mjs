#!/usr/bin/env node

// Local-only Storage lifecycle for tournament-media. There is no remote
// override. Existing configuration is verified exactly and never reconciled
// silently. Rollback can remove only a proven-empty LOCAL bucket and needs a
// second explicit confirmation.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

export const STORAGE_CONTRACT = Object.freeze({
  bucket: 'tournament-media',
  public: false,
  maxFileBytes: 12 * 1024 * 1024,
  allowedMimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
});
export const STORAGE_MODES = Object.freeze(['inspect', 'plan', 'dry-run', 'apply', 'verify', 'rollback']);
export const STORAGE_POLICY_CONTRACT = Object.freeze({
  tournament_media_service_read: 'SELECT',
  tournament_media_service_insert: 'INSERT',
  tournament_media_service_update: 'UPDATE',
  tournament_media_service_delete: 'DELETE',
});
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

const policyText = (policy) => [policy.qual, policy.with_check]
  .filter(Boolean)
  .join(' ');

export function validatePolicies(policies) {
  if (!Array.isArray(policies)) fail('Storage policy snapshot is required');
  const scoped = policies.filter((policy) => (
    String(policy.policyname || '').startsWith('tournament_media_')
    || policyText(policy).includes('tournament-media')
  ));
  const expectedNames = Object.keys(STORAGE_POLICY_CONTRACT).sort();
  const actualNames = scoped.map(({ policyname }) => policyname).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    fail('Storage policies differ from the exact allowlist');
  }
  for (const policy of scoped) {
    if (String(policy.cmd).toUpperCase() !== STORAGE_POLICY_CONTRACT[policy.policyname]) {
      fail(`Storage policy command differs for ${policy.policyname}`);
    }
    const roles = Array.isArray(policy.roles)
      ? policy.roles.map(String).sort()
      : String(policy.roles || '')
        .replace(/^\{|\}$/g, '')
        .split(',')
        .map((role) => role.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
        .sort();
    if (JSON.stringify(roles) !== JSON.stringify(['service_role'])) {
      fail(`Storage policy roles differ for ${policy.policyname}`);
    }
    if (['SELECT', 'INSERT'].includes(String(policy.cmd).toUpperCase())
      && !policyText(policy).includes('tournament-media')) {
      fail(`Storage policy bucket scope differs for ${policy.policyname}`);
    }
  }
  return true;
}

function assertLocalDatabase(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { fail('SUPABASE_DB_URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    fail('SUPABASE_DB_URL must target loopback PostgreSQL; there is no override');
  }
  return rawUrl;
}

export async function inspectPolicies(databaseUrl) {
  const client = new pg.Client({ connectionString: assertLocalDatabase(databaseUrl) });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select policyname, cmd, roles, qual, with_check
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and (
          policyname like 'tournament_media_%'
          or coalesce(qual, '') || coalesce(with_check, '') like '%tournament-media%'
        )
      order by policyname
    `);
    return rows;
  } finally {
    await client.end();
  }
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
  const absentEnvelope = response.status === 400
    && String(response.payload?.statusCode) === '404'
    && (
      (response.payload?.error === 'Bucket not found'
        && response.payload?.message === 'Bucket not found')
      || (response.payload?.error === 'InvalidRequest'
        && response.payload?.message === 'The related resource does not exist')
    );
  if (!response.ok && (response.status === 404 || absentEnvelope)) {
    return { exists: false, id: STORAGE_CONTRACT.bucket };
  }
  if (!response.ok) fail(`bucket inspection failed with HTTP ${response.status}`);
  return { exists: true, ...response.payload };
};

export async function runStorageMode({
  mode,
  rawUrl,
  secret,
  confirmEmptyLocalBucketDelete = false,
  fetchImpl = fetch,
  policySnapshot,
}) {
  if (!STORAGE_MODES.includes(mode)) fail(`unknown mode ${mode}`);
  const baseUrl = assertLocal(rawUrl);
  if (!secret) fail('local service credential is required');
  validatePolicies(policySnapshot);
  const before = await inspect(fetchImpl, baseUrl, secret);
  const plan = {
    mode,
    remoteCalls: 0,
    target: 'loopback-only',
    bucket: STORAGE_CONTRACT,
    current: before.exists ? 'present' : 'absent',
    action: before.exists ? 'verify-exact' : 'create',
    policyAction: 'verify-exact-no-replacement',
    policies: Object.keys(STORAGE_POLICY_CONTRACT).sort(),
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
    policySnapshot: await inspectPolicies(
      process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres',
    ),
    confirmEmptyLocalBucketDelete: process.argv.includes('--confirm-empty-local-bucket-delete'),
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    console.error(`[tournament-media] ${error.message}`);
    process.exit(1);
  });
}
