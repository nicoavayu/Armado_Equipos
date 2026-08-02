// supabase/functions/tournament-media-processor/index.ts
//
// Verifies a finished upload and materialises its four variants. Nothing in
// the pipeline may reach `pending_review` without passing through here.
//
// The processor is the only component that is allowed to tell the database
// what a file is. It re-derives every fact from the bytes it fetched out of
// the bucket itself: real container, real MIME, real dimensions, real byte
// size, real SHA-256. The browser's MIME, filename, extension, dimensions and
// checksum are used for nothing but the pre-flight UX.
//
// Read `_shared/tournamentMediaImage.ts` for the exact, deliberately narrow
// definition of "verified": structural decode and metadata enforcement, not a
// pixel transcode and not an antivirus. Both of those are reported as false in
// the attestation, which is what keeps `uploadReady` honest.

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
  MEDIA_DERIVED_KINDS,
  type MediaDerivedKind,
  type MediaMime,
  TOURNAMENT_MEDIA_BUCKET,
  variantGeometry,
  variantObjectName,
} from "../_shared/tournamentMediaContract.ts"
import {
  MediaImageError,
  sha256Hex,
  verifyNormalizedImage,
} from "../_shared/tournamentMediaImage.ts"
import { runProcessorSelfTest } from "../_shared/tournamentMediaSelfTest.ts"

const RELEASE = "0.1.0"
const MAX_VARIANT_BYTES = 8 * 1024 * 1024

type ServiceClient = ReturnType<typeof createClient>

async function downloadObject(service: ServiceClient, objectName: string) {
  const { data, error } = await service.storage
    .from(TOURNAMENT_MEDIA_BUCKET)
    .download(objectName)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}

async function putObject(
  service: ServiceClient, objectName: string, bytes: Uint8Array, contentType: string,
) {
  const { error } = await service.storage
    .from(TOURNAMENT_MEDIA_BUCKET)
    .upload(objectName, bytes, { contentType, upsert: false })
  return !error
}

async function purge(service: ServiceClient, objectNames: string[]) {
  if (objectNames.length === 0) return
  try {
    await service.storage.from(TOURNAMENT_MEDIA_BUCKET).remove(objectNames)
  } catch {
    // Cleanup is best effort here; `cleanup_tournament_media_upload_sessions`
    // hands the same names to the sweeper if this fails.
  }
}

async function abandon(
  service: ServiceClient, sessionId: string, failureCode: string, written: string[],
) {
  await purge(service, written)
  try {
    await service.rpc("fail_tournament_media_upload_session", {
      p_session_id: sessionId, p_failure_code: failureCode,
    })
  } catch {
    // A session that cannot be marked failed still expires within ten minutes.
  }
}

/**
 * Finalises one upload.
 *
 * Order matters. Nothing is written to the database until every byte of every
 * object has been fetched back, verified and stored, so a half-processed asset
 * can never exist in `pending_review`.
 */
async function handleFinalize(
  service: ServiceClient, actorId: string, form: FormData,
) {
  const sessionId = String(form.get("sessionId") ?? "")
  const token = String(form.get("token") ?? "")
  if (!UUID_RE.test(sessionId) || !SESSION_TOKEN_RE.test(token)) {
    return { status: 400, payload: { error: "invalid_request" } }
  }

  // 1. Re-authorise. This re-checks the token, the expiry, the single-use
  //    state, the gallery lifecycle and the photographer assignment, and it is
  //    the only source of the object name.
  const authorized = await service.rpc("authorize_tournament_media_upload_target", {
    p_session_id: sessionId, p_token: token, p_actor_user_id: actorId,
  })
  if (authorized.error) {
    const mapped = mapRpcError(authorized.error.message || "")
    return { status: mapped.status, payload: { error: mapped.error } }
  }
  const target = authorized.data as Record<string, unknown>
  const sourceName = String(target.objectName)
  const declaredMime = String(target.contentType) as MediaMime
  const expectedBytes = Number(target.expectedBytes)

  // 2. Fetch what actually landed in the bucket.
  const sourceBytes = await downloadObject(service, sourceName)
  if (!sourceBytes) {
    await abandon(service, sessionId, "SOURCE_OBJECT_MISSING", [])
    return { status: 409, payload: { error: "source_object_missing" } }
  }
  if (sourceBytes.length !== expectedBytes) {
    await abandon(service, sessionId, "SOURCE_SIZE_MISMATCH", [sourceName])
    return { status: 422, payload: { error: "source_size_mismatch" } }
  }

  // 3. Verify it for real.
  let source
  try {
    source = verifyNormalizedImage(sourceBytes, declaredMime)
  } catch (error) {
    const code = error instanceof MediaImageError ? error.code : "MEDIA_CONTENT_CORRUPT"
    await abandon(service, sessionId, code, [sourceName])
    return { status: 422, payload: { error: "source_rejected", code } }
  }
  const sourceChecksum = await sha256Hex(sourceBytes)

  // 4. Verify each rendition the browser produced. Geometry is not negotiable:
  //    it must equal what the shared contract derives from the dimensions the
  //    processor just measured, not from anything the client claimed.
  const renditions: Array<{
    kind: MediaDerivedKind; bytes: Uint8Array; checksum: string;
    width: number; height: number; objectName: string;
  }> = []
  for (const kind of MEDIA_DERIVED_KINDS) {
    const part = form.get(kind)
    if (!(part instanceof File)) {
      await abandon(service, sessionId, "VARIANT_MISSING", [sourceName])
      return { status: 400, payload: { error: "variant_missing", kind } }
    }
    if (part.size < 1 || part.size > MAX_VARIANT_BYTES) {
      await abandon(service, sessionId, "VARIANT_SIZE_INVALID", [sourceName])
      return { status: 422, payload: { error: "variant_size_invalid", kind } }
    }
    const bytes = new Uint8Array(await part.arrayBuffer())
    let inspection
    try {
      inspection = verifyNormalizedImage(bytes, declaredMime)
    } catch (error) {
      const code = error instanceof MediaImageError ? error.code : "MEDIA_CONTENT_CORRUPT"
      await abandon(service, sessionId, code, [sourceName])
      return { status: 422, payload: { error: "variant_rejected", kind, code } }
    }
    const expected = variantGeometry(kind, source.width, source.height)
    if (inspection.width !== expected.width || inspection.height !== expected.height) {
      await abandon(service, sessionId, "VARIANT_GEOMETRY_MISMATCH", [sourceName])
      return {
        status: 422,
        payload: {
          error: "variant_geometry_mismatch",
          kind,
          expected: { width: expected.width, height: expected.height },
          received: { width: inspection.width, height: inspection.height },
        },
      }
    }
    renditions.push({
      kind,
      bytes,
      checksum: await sha256Hex(bytes),
      width: expected.width,
      height: expected.height,
      objectName: variantObjectName(sourceName, kind),
    })
  }

  // 5. Materialise the four objects. The sanitised original is written to its
  //    own name; the staging object is removed at the end so that a replay
  //    cannot re-sign it.
  const written: string[] = []
  const originalName = variantObjectName(sourceName, "original")
  if (!await putObject(service, originalName, sourceBytes, declaredMime)) {
    await abandon(service, sessionId, "ORIGINAL_WRITE_FAILED", [sourceName])
    return { status: 502, payload: { error: "storage_unavailable" } }
  }
  written.push(originalName)
  for (const rendition of renditions) {
    if (!await putObject(service, rendition.objectName, rendition.bytes, declaredMime)) {
      await abandon(service, sessionId, "VARIANT_WRITE_FAILED", [sourceName, ...written])
      return { status: 502, payload: { error: "storage_unavailable" } }
    }
    written.push(rendition.objectName)
  }

  // 6. Register the asset with values the processor measured itself.
  const completed = await service.rpc("complete_tournament_media_upload_for_actor", {
    p_actor_user_id: actorId,
    p_session_id: sessionId,
    p_token: token,
    p_detected_mime: source.mime,
    p_byte_size: source.byteSize,
    p_width: source.width,
    p_height: source.height,
    p_checksum_sha256: sourceChecksum,
  })
  if (completed.error) {
    const mapped = mapRpcError(completed.error.message || "")
    await purge(service, [sourceName, ...written])
    return { status: mapped.status, payload: { error: mapped.error } }
  }
  const asset = completed.data as Record<string, unknown>
  const assetId = String(asset.assetId)

  // 7. Flip the three derived variants to ready. Until this succeeds the asset
  //    cannot be approved or published: both gates count four ready variants.
  const finalized = await service.rpc("finalize_tournament_media_variants", {
    p_asset_id: assetId,
    p_variants: Object.fromEntries(renditions.map((rendition) => [
      rendition.kind,
      {
        detectedMime: source.mime,
        byteSize: rendition.bytes.length,
        width: rendition.width,
        height: rendition.height,
        checksumSha256: rendition.checksum,
        metadataStripped: true,
      },
    ])),
  })
  if (finalized.error) {
    const mapped = mapRpcError(finalized.error.message || "")
    return { status: mapped.status, payload: { error: mapped.error, assetId } }
  }

  await purge(service, [sourceName])
  return {
    status: 200,
    payload: {
      assetId,
      galleryId: asset.galleryId,
      safeName: asset.safeName,
      status: asset.status,
      width: source.width,
      height: source.height,
      byteSize: source.byteSize,
      variants: renditions.map((rendition) => ({
        kind: rendition.kind, width: rendition.width, height: rendition.height,
      })),
    },
  }
}

/**
 * Runs the codec self-test against fixtures compiled into the bundle and
 * attests only what passed. A release whose sanitiser regresses stops
 * attesting, and `uploadReady` closes within the hour on its own.
 */
async function handleHealth(service: ServiceClient) {
  const selfTest = await runProcessorSelfTest()
  if (!selfTest.passed) {
    try {
      await service.rpc("revoke_tournament_media_service_attestation", {
        p_service: "processor",
      })
    } catch {
      // The attestation expires by itself; revoking is only faster.
    }
    return { status: 503, payload: { error: "self_test_failed", checks: selfTest.checks } }
  }
  const { error } = await service.rpc("attest_tournament_media_service", {
    p_service: "processor",
    p_release: RELEASE,
    p_capabilities: {
      contentSniffing: true,
      structuralDecode: true,
      metadataStripping: true,
      checksumVerification: true,
      variantGeneration: true,
      // Deliberately false. See the module header of tournamentMediaImage.ts.
      pixelTranscode: false,
      antivirusScanning: false,
      probedAt: new Date().toISOString(),
    },
    p_ttl_seconds: 3600,
  })
  if (error) return { status: 500, payload: { error: "attestation_failed" } }
  return {
    status: 200,
    payload: { service: "processor", release: RELEASE, checks: selfTest.checks },
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

  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return jsonResponse(cors, 400, { error: "invalid_request" })
    }
    if (String(body.action ?? "") !== "health") {
      return jsonResponse(cors, 400, { error: "unknown_action" })
    }
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
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonResponse(cors, 400, { error: "invalid_request" })
  }
  try {
    const result = await handleFinalize(service, actorId, form)
    return jsonResponse(cors, result.status, result.payload)
  } catch {
    return jsonResponse(cors, 500, { error: "media_service_failed" })
  }
})
