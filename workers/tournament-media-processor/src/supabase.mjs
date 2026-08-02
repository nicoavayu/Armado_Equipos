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

export function readConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '');
  if (!url || !key) throw new Error('WORKER_MISCONFIGURED');
  return {
    url,
    key,
    workerId: String(env.TOURNAMENT_MEDIA_WORKER_ID || 'media-worker-local'),
    release: String(env.TOURNAMENT_MEDIA_WORKER_RELEASE || '0.1.0'),
    leaseSeconds: Number(env.TOURNAMENT_MEDIA_LEASE_SECONDS || 300),
    batchSize: Number(env.TOURNAMENT_MEDIA_BATCH_SIZE || 1),
    pollMs: Number(env.TOURNAMENT_MEDIA_POLL_MS || 2000),
    attestTtlSeconds: Number(env.TOURNAMENT_MEDIA_ATTEST_TTL_SECONDS || 900),
  };
}

async function rpc(config, name, args, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, {
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
  const base = `${config.url}/storage/v1/object`;
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  return {
    async download(objectName) {
      const response = await fetchImpl(`${base}/${TOURNAMENT_MEDIA_BUCKET}/${objectName}`, {
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
      const response = await fetchImpl(`${base}/${TOURNAMENT_MEDIA_BUCKET}/${objectName}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' },
        body: Buffer.from(bytes),
      });
      if (!response.ok) throw new Error(`STORAGE_UPLOAD_FAILED:${response.status}`);
      return true;
    },
    async remove(objectNames) {
      if (!objectNames || objectNames.length === 0) return true;
      const response = await fetchImpl(`${base}/${TOURNAMENT_MEDIA_BUCKET}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: objectNames }),
      });
      if (!response.ok) throw new Error(`STORAGE_REMOVE_FAILED:${response.status}`);
      return true;
    },
  };
}
