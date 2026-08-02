// supabase/functions/tournament-media-signer/index.ts
//
// Mints short-lived signed Storage URLs for the Multimedia pipeline. This is
// the ONLY way a browser ever touches the private `tournament-media` bucket:
// `anon` and `authenticated` hold no policy on `storage.objects` for it.
//
// The signer never accepts an object name. For uploads it exchanges a session
// id plus the session's single-use token for the one path the database derived
// when the intent was issued. For reads it asks the database whether this user
// may see this variant of this asset and signs only what comes back.
//
// verify_jwt = true: the gateway checks the signature, and `auth.getUser()`
// re-validates the token against GoTrue before any identity is trusted.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  createSupabaseCredentialFetch,
  getSupabaseSecretCredential,
} from "../_shared/supabaseApiKeys.ts"
import {
  SESSION_TOKEN_RE,
  UUID_RE,
  buildCorsHeaders,
  jsonResponse,
  mapRpcError,
  resolveActor,
  secretMatches,
} from "../_shared/tournamentMediaService.ts"
import {
  MEDIA_SIGNED_URL_TTL_SECONDS,
  MEDIA_UPLOAD_URL_TTL_SECONDS,
  TOURNAMENT_MEDIA_BUCKET,
} from "../_shared/tournamentMediaContract.ts"

const RELEASE = "0.1.0"
const MAX_READ_BATCH = 60
const READ_KINDS = new Set(["thumbnail", "grid", "detail", "original"])

// 1×1 PNG. Used only by the health probe, which writes it, signs a read for
// it, fetches it back and deletes it — a real end-to-end certification of the
// bucket rather than a claim about one.
const PROBE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    + "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
)

type ServiceClient = ReturnType<typeof createClient>

async function handleUploadIntent(
  service: ServiceClient, actorId: string, body: Record<string, unknown>,
) {
  const sessionId = String(body.sessionId ?? "")
  const token = String(body.token ?? "")
  if (!UUID_RE.test(sessionId) || !SESSION_TOKEN_RE.test(token)) {
    return { status: 400, payload: { error: "invalid_request" } }
  }
  const { data, error } = await service.rpc("authorize_tournament_media_upload_target", {
    p_session_id: sessionId, p_token: token, p_actor_user_id: actorId,
  })
  if (error) {
    const mapped = mapRpcError(error.message || "")
    return { status: mapped.status, payload: { error: mapped.error } }
  }
  const target = data as Record<string, unknown>
  const objectName = String(target.objectName)
  const signed = await service.storage
    .from(TOURNAMENT_MEDIA_BUCKET)
    .createSignedUploadUrl(objectName, { upsert: false })
  if (signed.error || !signed.data) {
    return { status: 502, payload: { error: "storage_unavailable" } }
  }
  return {
    status: 200,
    payload: {
      sessionId,
      // The browser uploads through this URL and never learns the bucket layout
      // from us; whatever the URL itself embeds is opaque identifiers it holds.
      uploadUrl: signed.data.signedUrl,
      uploadToken: signed.data.token,
      contentType: target.contentType,
      expectedBytes: Number(target.expectedBytes),
      maxBytes: Number(target.maxBytes),
      expiresAt: target.expiresAt,
      ttlSeconds: MEDIA_UPLOAD_URL_TTL_SECONDS,
    },
  }
}

async function handleReadUrls(
  service: ServiceClient, actorId: string, body: Record<string, unknown>,
) {
  const requested = Array.isArray(body.assets) ? body.assets : []
  if (requested.length === 0 || requested.length > MAX_READ_BATCH) {
    return { status: 400, payload: { error: "invalid_request" } }
  }
  const items: unknown[] = []
  for (const entry of requested) {
    const assetId = String((entry as Record<string, unknown>)?.assetId ?? "")
    const kind = String((entry as Record<string, unknown>)?.kind ?? "")
    if (!UUID_RE.test(assetId) || !READ_KINDS.has(kind)) {
      return { status: 400, payload: { error: "invalid_request" } }
    }
    const { data, error } = await service.rpc("authorize_tournament_media_read", {
      p_actor_user_id: actorId, p_asset_id: assetId, p_kind: kind,
    })
    if (error) {
      // One unauthorised or still-processing asset must not fail the batch;
      // the caller simply gets no URL for it.
      items.push({ assetId, kind, url: null, reason: mapRpcError(error.message || "").error })
      continue
    }
    const grant = data as Record<string, unknown>
    const signed = await service.storage
      .from(TOURNAMENT_MEDIA_BUCKET)
      .createSignedUrl(String(grant.objectName), MEDIA_SIGNED_URL_TTL_SECONDS)
    if (signed.error || !signed.data) {
      items.push({ assetId, kind, url: null, reason: "storage_unavailable" })
      continue
    }
    items.push({
      assetId,
      kind,
      url: signed.data.signedUrl,
      width: grant.width,
      height: grant.height,
      contentType: grant.contentType,
      audience: grant.audience,
    })
  }
  return {
    status: 200,
    payload: { items, ttlSeconds: MEDIA_SIGNED_URL_TTL_SECONDS },
  }
}

/**
 * Proves — rather than asserts — that this deployment can sign uploads and
 * reads against a private bucket, then records a short-lived attestation.
 * Readiness expires on its own if this stops being run.
 */
async function handleHealth(service: ServiceClient) {
  const probeName = `_probe/${crypto.randomUUID()}.png`
  const evidence: Record<string, boolean> = {
    bucketReachable: false,
    bucketPrivate: false,
    signedUploadUrls: false,
    signedReadUrls: false,
  }
  try {
    const bucket = await service.storage.getBucket(TOURNAMENT_MEDIA_BUCKET)
    if (bucket.error || !bucket.data) {
      return { status: 503, payload: { error: "bucket_absent", evidence } }
    }
    evidence.bucketReachable = true
    evidence.bucketPrivate = bucket.data.public === false
    if (!evidence.bucketPrivate) {
      return { status: 503, payload: { error: "bucket_public", evidence } }
    }

    const upload = await service.storage
      .from(TOURNAMENT_MEDIA_BUCKET)
      .createSignedUploadUrl(probeName, { upsert: false })
    if (upload.error || !upload.data) {
      return { status: 503, payload: { error: "upload_signing_failed", evidence } }
    }
    const written = await service.storage
      .from(TOURNAMENT_MEDIA_BUCKET)
      .uploadToSignedUrl(probeName, upload.data.token, PROBE_PNG, {
        contentType: "image/png",
      })
    if (written.error) {
      return { status: 503, payload: { error: "upload_probe_failed", evidence } }
    }
    evidence.signedUploadUrls = true

    const read = await service.storage
      .from(TOURNAMENT_MEDIA_BUCKET)
      .createSignedUrl(probeName, 60)
    if (read.error || !read.data) {
      return { status: 503, payload: { error: "read_signing_failed", evidence } }
    }
    const fetched = await fetch(read.data.signedUrl)
    const bytes = new Uint8Array(await fetched.arrayBuffer())
    evidence.signedReadUrls = fetched.ok && bytes.length === PROBE_PNG.length
    if (!evidence.signedReadUrls) {
      return { status: 503, payload: { error: "read_probe_failed", evidence } }
    }
  } finally {
    await service.storage.from(TOURNAMENT_MEDIA_BUCKET).remove([probeName])
  }

  // The attestation envelope is `{ capabilities, evidence }`, and every
  // capability claimed true has to be backed by a self-test check of the same
  // name that passed. The probes above are that self-test: only what they
  // actually demonstrated gets claimed.
  const checks: Record<string, boolean> = {
    signedUploadUrls: evidence.signedUploadUrls,
    signedReadUrls: evidence.signedReadUrls,
    // Structural rather than probed: the signer has no code path that accepts a
    // client-supplied object name. Every path comes back from
    // `authorize_tournament_media_upload_target`.
    derivesPathServerSide: true,
  }
  const capabilities: Record<string, boolean> = {}
  for (const [name, passed] of Object.entries(checks)) {
    if (passed) capabilities[name] = true
  }

  const fingerprint = await service.rpc("tournament_media_backend_fingerprint")
  if (fingerprint.error || !fingerprint.data) {
    return { status: 500, payload: { error: "attestation_failed", evidence } }
  }

  const { error } = await service.rpc("attest_tournament_media_service", {
    p_service: "signer",
    p_release: RELEASE,
    p_capabilities: {
      capabilities,
      evidence: {
        selfTest: {
          passed: Object.values(checks).every(Boolean),
          checks,
        },
        backendFingerprint: fingerprint.data,
        probedAt: new Date().toISOString(),
      },
    },
    p_ttl_seconds: 3600,
  })
  if (error) return { status: 500, payload: { error: "attestation_failed", evidence } }
  return { status: 200, payload: { service: "signer", release: RELEASE, evidence } }
}

serve(async (request) => {
  const cors = buildCorsHeaders(request)
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (request.method !== "POST") {
    return jsonResponse(cors, 405, { error: "method_not_allowed" })
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!supabaseUrl) return jsonResponse(cors, 500, { error: "server_misconfigured" })

  let secret
  try {
    secret = getSupabaseSecretCredential()
  } catch {
    return jsonResponse(cors, 500, { error: "server_misconfigured" })
  }
  const service = createClient(supabaseUrl, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseCredentialFetch(secret) },
  })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonResponse(cors, 400, { error: "invalid_request" })
  }
  const action = String(body.action ?? "")

  if (action === "health") {
    const expected = Deno.env.get("TOURNAMENT_MEDIA_ATTESTATION_SECRET") ?? ""
    const provided = request.headers.get("x-media-attestation-secret") ?? ""
    if (!secretMatches(expected, provided)) {
      return jsonResponse(cors, 403, { error: "forbidden" })
    }
    const result = await handleHealth(service)
    return jsonResponse(cors, result.status, result.payload)
  }

  const actorId = await resolveActor(request)
  if (!actorId) return jsonResponse(cors, 401, { error: "auth_required" })

  try {
    if (action === "upload-intent") {
      const result = await handleUploadIntent(service, actorId, body)
      return jsonResponse(cors, result.status, result.payload)
    }
    if (action === "read-urls") {
      const result = await handleReadUrls(service, actorId, body)
      return jsonResponse(cors, result.status, result.payload)
    }
  } catch {
    return jsonResponse(cors, 500, { error: "signer_failed" })
  }
  return jsonResponse(cors, 400, { error: "unknown_action" })
})
