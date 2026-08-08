/**
 * The worker's two Supabase surfaces: the private bucket and the service-only
 * RPCs. Both use the service credential, which never leaves the container.
 *
 * The RPC layer is the authenticated callback: every state transition is
 * additionally bound to the per-job lease token the database minted, so a
 * worker cannot close a job it does not hold, and a leaked service key still
 * cannot finalise an asset whose readiness gates are closed.
 */

import { TOURNAMENT_MEDIA_BUCKET } from './contract.mjs';
import { assertAuthorizedUrl, createSupabaseTarget } from './target.mjs';

export function readConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  // The target is resolved BEFORE the credential is read, and the order is
  // load-bearing rather than stylistic: a service-role key is unconditional
  // authority over whatever project it is sent to, so the only safe moment to
  // discover that `SUPABASE_URL` names the wrong project is before the key is
  // in a variable, let alone in a header. `createSupabaseTarget` throws a
  // `TargetError` whose message never contains the URL or the key.
  const target = createSupabaseTarget({
    url,
    expectedProjectRef: env.TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF,
    forbiddenHosts: env.TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS,
    forbiddenProjectRefs: env.TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS,
  });
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '');
  if (!key) throw new Error('WORKER_MISCONFIGURED');
  return {
    // The canonical origin the target validated, not the raw string: every
    // request URL is built from this, so the two can never disagree.
    url: target.origin,
    target,
    key,
    workerId: String(env.TOURNAMENT_MEDIA_WORKER_ID || 'media-worker-local'),
    release: String(env.TOURNAMENT_MEDIA_WORKER_RELEASE || '0.1.0'),
    leaseSeconds: Number(env.TOURNAMENT_MEDIA_LEASE_SECONDS || 300),
    batchSize: Number(env.TOURNAMENT_MEDIA_BATCH_SIZE || 1),
    pollMs: Number(env.TOURNAMENT_MEDIA_POLL_MS || 2000),
    attestTtlSeconds: Number(env.TOURNAMENT_MEDIA_ATTEST_TTL_SECONDS || 900),
  };
}

/**
 * The last gate before a credentialed request leaves the process.
 *
 * Every request URL below is built by concatenating strings onto `config.url`,
 * and one of those strings is an object name that arrived from the database. So
 * the descriptor is re-checked here, at the moment of the call, rather than
 * trusted from configuration time — and a config that never went through
 * `readConfig` has no descriptor at all, which is refused rather than waved
 * through. Fail closed: no descriptor, no request.
 */
function authorizedUrl(config, path) {
  if (!config || !config.target) {
    throw new Error('WORKER_TARGET_UNVERIFIED');
  }
  return assertAuthorizedUrl(`${config.url}${path}`, config.target).toString();
}

/**
 * Keeps an object name inside the bucket it was addressed to.
 *
 * `new URL()` resolves `..` segments, so a name carrying them would silently
 * address something above the bucket prefix rather than fail. Every name this
 * client is legitimately given — a quarantine path, a derived variant name, the
 * self-test's `_selftest/` probe — is a plain relative path, so refusing the
 * rest costs nothing. The stricter, namespace-aware check for the names the
 * sweeper deletes lives in `cleanup.mjs`; this is the floor under all of them.
 */
function assertObjectName(objectName) {
  const name = String(objectName === undefined || objectName === null ? '' : objectName);
  if (!name || name.startsWith('/') || name.includes('..') || /[?#]/.test(name)) {
    throw new Error('STORAGE_OBJECT_NAME_INVALID');
  }
  return name;
}

async function rpc(config, name, args, fetchImpl = fetch) {
  const url = authorizedUrl(config, `/rest/v1/rpc/${name}`);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) {
    // Never echo the backend's message to anything but the container log.
    const error = new Error(`RPC_FAILED:${name}:${response.status}`);
    error.status = response.status;
    error.detail = text.slice(0, 500);
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

export function createDbClient(config, fetchImpl = fetch) {
  return {
    backendFingerprint: () =>
      rpc(config, 'tournament_media_backend_fingerprint', {}, fetchImpl),
    attest: (release, capabilities, ttlSeconds) => rpc(config, 'attest_tournament_media_service', {
      p_service: 'processor',
      p_release: release,
      p_capabilities: capabilities,
      p_ttl_seconds: ttlSeconds,
    }, fetchImpl),
    revoke: () => rpc(config, 'revoke_tournament_media_service_attestation', {
      p_service: 'processor',
    }, fetchImpl),
    lease: (workerId, leaseSeconds, limit) => rpc(
      config, 'lease_tournament_media_processing_jobs',
      { p_worker_id: workerId, p_lease_seconds: leaseSeconds, p_limit: limit }, fetchImpl,
    ),
    completeUploadForJob: (input) => rpc(config, 'complete_tournament_media_upload_for_job', {
      p_job_id: input.jobId,
      p_lease_token: input.leaseToken,
      p_detected_mime: input.detectedMime,
      p_byte_size: input.byteSize,
      p_width: input.width,
      p_height: input.height,
      p_checksum_sha256: input.checksumSha256,
    }, fetchImpl),
    finalizeVariants: (input) => rpc(config, 'finalize_tournament_media_variants', {
      p_asset_id: input.assetId, p_variants: input.variants,
    }, fetchImpl),
    completeJob: (input) => rpc(config, 'complete_tournament_media_processing_job', {
      p_job_id: input.jobId, p_lease_token: input.leaseToken, p_asset_id: input.assetId,
    }, fetchImpl),
    failJob: (input) => rpc(config, 'fail_tournament_media_processing_job', {
      p_job_id: input.jobId, p_lease_token: input.leaseToken, p_failure_code: input.failureCode,
    }, fetchImpl),
    sweep: (limit = 200) => rpc(
      config, 'cleanup_tournament_media_processing_jobs', { p_limit: limit }, fetchImpl,
    ),
  };
}

/**
 * True when a non-OK download response is Storage reporting an absent object
 * rather than a real failure. Only the `not_found` shape counts: a 400 that is
 * anything else still raises, so a misconfigured bucket is never mistaken for
 * an empty one.
 */
async function isObjectMissing(response) {
  if (response.status !== 400) return false;
  try {
    const body = JSON.parse(await response.text());
    return String(body?.statusCode) === '404' || body?.error === 'not_found';
  } catch {
    return false;
  }
}

export function createStorageClient(config, fetchImpl = fetch) {
  const base = '/storage/v1/object';
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  return {
    async download(objectName) {
      const url = authorizedUrl(
        config, `${base}/${TOURNAMENT_MEDIA_BUCKET}/${assertObjectName(objectName)}`,
      );
      const response = await fetchImpl(url, {
        headers,
      });
      if (response.status === 404) return null;
      // Storage does not always answer a miss with a 404: current versions reply
      // `400 {"statusCode":"404","error":"not_found"}`. An absent object is an
      // answer, not a transport failure — reading it as one would make the
      // post-delete probe in the self-test throw, and `cleanup` could never be
      // proved, so `uploadReady` could never open against a real bucket.
      if (!response.ok) {
        if (await isObjectMissing(response)) return null;
        throw new Error(`STORAGE_DOWNLOAD_FAILED:${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async upload(objectName, bytes, contentType) {
      const url = authorizedUrl(
        config, `${base}/${TOURNAMENT_MEDIA_BUCKET}/${assertObjectName(objectName)}`,
      );
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' },
        body: Buffer.from(bytes),
      });
      if (!response.ok) throw new Error(`STORAGE_UPLOAD_FAILED:${response.status}`);
      return true;
    },
    async remove(objectNames) {
      if (!objectNames || objectNames.length === 0) return true;
      const prefixes = objectNames.map(assertObjectName);
      const url = authorizedUrl(config, `${base}/${TOURNAMENT_MEDIA_BUCKET}`);
      const response = await fetchImpl(url, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes }),
      });
      if (!response.ok) throw new Error(`STORAGE_REMOVE_FAILED:${response.status}`);
      return true;
    },
  };
}
