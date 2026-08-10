// supabase/functions/tournament-media-processor/index.ts
//
// ORCHESTRATOR. This function no longer processes anything and no longer
// certifies anything.
//
// The previous revision accepted the three renditions the browser had produced,
// walked their containers, and wrote them to the bucket as the publishable
// variants — while the "original" it stored was a byte-for-byte copy of the
// uploaded file. It then attested `structuralDecode`, which the database
// accepted in place of a pixel decode, so `uploadReady` could be true with
// `pixelTranscode: false` and `antivirusScanning: false`.
//
// Three things changed:
//   1. Browser renditions are never published. The client uploads ONE object,
//      into quarantine, and this function only records the intent to process
//      it. `workers/tournament-media-processor` does the real work.
//   2. This function cannot attest the processor tier. The capability
//      allowlist has no `structuralDecode`, and the advanced names require a
//      self-test the Edge runtime cannot pass: there is no libvips and no
//      ClamAV here. Its health probe REVOKES any stale processor attestation
//      instead of writing one.
//   3. Every database contract it touches is readiness-gated server-side, so
//      when uploads are closed this function cannot move a single row.
//
// The structural verifier in `_shared/tournamentMediaImage.ts` is still used —
// as a cheap pre-flight that rejects obvious rubbish before it is queued. It is
// not, and must not be read as, a substitute for the worker.

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
import { runProcessorSelfTest } from "../_shared/tournamentMediaSelfTest.ts"
import {
  MVP_SIMPLE_MEDIA_LIMITS,
  TOURNAMENT_MEDIA_BUCKET,
} from "../_shared/tournamentMediaContract.ts"
import {
  MediaImageError,
  sha256Hex,
  verifyNormalizedImage,
} from "../_shared/tournamentMediaImage.ts"

const RELEASE = "0.2.0"

type ServiceClient = ReturnType<typeof createClient>

/**
 * Records that a quarantined object is waiting for the worker.
 *
 * `enqueue_tournament_media_processing_job` delegates to the audited
 * `authorize_tournament_media_upload_target`, so the token, the expiry, the
 * single-use state, the gallery lifecycle, the live photographer assignment
 * AND the pipeline readiness gate are all re-checked inside the database. This
 * function decides nothing.
 */
async function handleQueue(
  service: ServiceClient, actorId: string, body: Record<string, unknown>,
) {
  const sessionId = String(body.sessionId ?? "")
  const token = String(body.token ?? "")
  if (!UUID_RE.test(sessionId) || !SESSION_TOKEN_RE.test(token)) {
    return { status: 400, payload: { error: "invalid_request" } }
  }
  const queued = await service.rpc("enqueue_tournament_media_processing_job", {
    p_session_id: sessionId, p_token: token, p_actor_user_id: actorId,
  })
  if (queued.error) {
    const mapped = mapRpcError(queued.error.message || "")
    return { status: mapped.status, payload: { error: mapped.error } }
  }
  const job = queued.data as Record<string, unknown>
  return {
    status: 202,
    payload: {
      sessionId,
      jobId: job.jobId,
      status: "queued",
      // The asset does not exist yet and will not exist until the worker has
      // decoded, transcoded, scanned and written every final object.
      assetId: null,
    },
  }
}

async function rejectSimpleUpload(
  service: ServiceClient,
  sessionId: string,
  objectName: string,
  failureCode: string,
  error: string,
  status = 422,
) {
  await service.rpc("fail_tournament_media_upload_session", {
    p_session_id: sessionId,
    p_failure_code: failureCode,
  })
  // Quarantine cleanup is deliberately best-effort; the existing sweeper also
  // receives failed session paths and remains the final safety net.
  await service.storage.from(TOURNAMENT_MEDIA_BUCKET).remove([objectName])
  return { status, payload: { error, code: failureCode } }
}

async function handleSimpleFinalize(
  service: ServiceClient, actorId: string, body: Record<string, unknown>,
) {
  const sessionId = String(body.sessionId ?? "")
  const token = String(body.token ?? "")
  if (!UUID_RE.test(sessionId) || !SESSION_TOKEN_RE.test(token)) {
    return { status: 400, payload: { error: "invalid_request" } }
  }
  const authorized = await service.rpc("authorize_tournament_media_upload_target", {
    p_session_id: sessionId, p_token: token, p_actor_user_id: actorId,
  })
  if (authorized.error) {
    const mapped = mapRpcError(authorized.error.message || "")
    return { status: mapped.status, payload: { error: mapped.error } }
  }
  const target = authorized.data as Record<string, unknown>
  const objectName = String(target.objectName ?? "")
  if (target.processingTier !== "mvp_simple") {
    return { status: 403, payload: { error: "forbidden" } }
  }
  const downloaded = await service.storage.from(TOURNAMENT_MEDIA_BUCKET).download(objectName)
  if (downloaded.error || !downloaded.data) {
    return rejectSimpleUpload(
      service, sessionId, objectName, "SOURCE_OBJECT_MISSING", "source_object_missing", 422,
    )
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
  if (bytes.length !== Number(target.expectedBytes)) {
    return rejectSimpleUpload(
      service, sessionId, objectName, "SOURCE_SIZE_MISMATCH", "source_size_mismatch", 422,
    )
  }
  let inspection
  try {
    inspection = verifyNormalizedImage(bytes, String(target.contentType), {
      maxFileBytes: MVP_SIMPLE_MEDIA_LIMITS.maxFileBytes,
      maxPixels: MVP_SIMPLE_MEDIA_LIMITS.maxPixels,
      maxEdge: MVP_SIMPLE_MEDIA_LIMITS.maxEdge,
    })
  } catch (error) {
    const code = error instanceof MediaImageError ? error.code : "MEDIA_CONTENT_CORRUPT"
    return rejectSimpleUpload(service, sessionId, objectName, code, "source_rejected", 422)
  }
  const checksum = await sha256Hex(bytes)
  const completed = await service.rpc("complete_tournament_media_simple_upload", {
    p_actor_user_id: actorId,
    p_session_id: sessionId,
    p_token: token,
    p_detected_mime: inspection.mime,
    p_byte_size: inspection.byteSize,
    p_width: inspection.width,
    p_height: inspection.height,
    p_checksum_sha256: checksum,
  })
  if (completed.error) {
    const mapped = mapRpcError(completed.error.message || "")
    await rejectSimpleUpload(
      service, sessionId, objectName, "SIMPLE_FINALIZE_FAILED", mapped.error, mapped.status,
    )
    return { status: mapped.status, payload: { error: mapped.error } }
  }
  const result = completed.data as Record<string, unknown>
  return {
    status: 201,
    payload: {
      sessionId,
      assetId: result.assetId,
      status: "pending_review",
    },
  }
}

/**
 * Health probe.
 *
 * Runs the structural pre-flight so a regression in it is still visible, and
 * then makes sure this deployment holds no processor attestation. The Edge
 * runtime is not on the worker allowlist, so an attestation from here would be
 * refused anyway; revoking makes a stale one from an older release disappear
 * immediately rather than at expiry.
 */
async function handleHealth(service: ServiceClient) {
  const preflight = await runProcessorSelfTest()
  const revoked = await service.rpc("revoke_tournament_media_service_attestation", {
    p_service: "processor",
  })
  return {
    status: preflight.passed ? 200 : 503,
    payload: {
      service: "orchestrator",
      release: RELEASE,
      attests: false,
      // Said plainly so nobody reads this endpoint as a certification.
      note: "structural pre-flight only; the pixel, metadata and antivirus tiers "
        + "belong to workers/tournament-media-processor",
      preflight: preflight.checks,
      processorAttestationCleared: !revoked.error,
    },
  }
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
    if (action === "queue") {
      const result = await handleQueue(service, actorId, body)
      return jsonResponse(cors, result.status, result.payload)
    }
    if (action === "finalize-simple") {
      const result = await handleSimpleFinalize(service, actorId, body)
      return jsonResponse(cors, result.status, result.payload)
    }
  } catch {
    return jsonResponse(cors, 500, { error: "media_service_failed" })
  }
  return jsonResponse(cors, 400, { error: "unknown_action" })
})
