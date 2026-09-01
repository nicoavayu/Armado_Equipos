import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  createSupabaseCredentialFetch,
  getSupabaseSecretCredential,
} from "../_shared/supabaseApiKeys.ts"
import {
  buildCorsHeaders,
  jsonResponse,
  resolveActor,
  UUID_RE,
} from "../_shared/tournamentMediaService.ts"
import {
  PORTRAIT_ALLOWED_MIME,
  PORTRAIT_MAX_EDGE,
  PORTRAIT_MAX_FILE_BYTES,
  PORTRAIT_MAX_PIXELS,
  PORTRAIT_PATH_RE,
  PORTRAIT_SIGNED_URL_TTL_SECONDS,
  TOURNAMENT_PLAYER_PORTRAITS_BUCKET,
} from "../_shared/tournamentPlayerPortraitContract.ts"

type ServiceClient = ReturnType<typeof createClient>

function mapError(message: string) {
  if (message.includes("TORNEOS_PORTRAIT_FILE_INVALID")) return [422, "file_invalid"] as const
  if (message.includes("TORNEOS_PORTRAIT_AUDIENCE_DISABLED")) return [403, "audience_disabled"] as const
  if (message.includes("TORNEOS_PORTRAIT_FORBIDDEN")) return [403, "forbidden"] as const
  if (message.includes("TORNEOS_AUTH_REQUIRED")) return [401, "auth_required"] as const
  return [500, "portrait_service_failed"] as const
}

function relativeSignedUrl(raw: string) {
  const parsed = new URL(raw)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function validGrant(grant: Record<string, unknown>) {
  return grant.bucket === TOURNAMENT_PLAYER_PORTRAITS_BUCKET
    && PORTRAIT_PATH_RE.test(String(grant.objectPath ?? ""))
}

async function upload(
  service: ServiceClient,
  actorId: string,
  request: Request,
) {
  const url = new URL(request.url)
  const organizationId = url.searchParams.get("organizationId") ?? ""
  const rosterPlayerId = url.searchParams.get("rosterPlayerId") ?? ""
  const mimeType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim()
  const width = Number(request.headers.get("x-image-width"))
  const height = Number(request.headers.get("x-image-height"))
  const declaredBytes = Number(request.headers.get("content-length"))
  if (!UUID_RE.test(organizationId) || !UUID_RE.test(rosterPlayerId)
    || !(PORTRAIT_ALLOWED_MIME as readonly string[]).includes(mimeType)
    || !Number.isSafeInteger(declaredBytes) || declaredBytes < 1
    || declaredBytes > PORTRAIT_MAX_FILE_BYTES
    || !Number.isSafeInteger(width) || width < 1 || width > PORTRAIT_MAX_EDGE
    || !Number.isSafeInteger(height) || height < 1 || height > PORTRAIT_MAX_EDGE
    || width * height > PORTRAIT_MAX_PIXELS) {
    return { status: 422, payload: { error: "file_invalid" } }
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length !== declaredBytes || bytes.length > PORTRAIT_MAX_FILE_BYTES) {
    return { status: 422, payload: { error: "file_invalid" } }
  }
  const requested = await service.rpc("request_tournament_player_portrait_upload", {
    p_actor_user_id: actorId,
    p_organization_id: organizationId,
    p_roster_player_id: rosterPlayerId,
    p_mime_type: mimeType,
    p_byte_size: bytes.length,
    p_width: width,
    p_height: height,
  })
  if (requested.error || !requested.data) {
    const [status, error] = mapError(requested.error?.message ?? "")
    return { status, payload: { error } }
  }
  const grant = requested.data as Record<string, unknown>
  if (!validGrant(grant)) return { status: 500, payload: { error: "upload_contract_invalid" } }
  const portraitId = String(grant.portraitId)
  const objectPath = String(grant.objectPath)
  const stored = await service.storage.from(TOURNAMENT_PLAYER_PORTRAITS_BUCKET)
    .upload(objectPath, bytes, { contentType: mimeType, cacheControl: "0", upsert: false })
  if (stored.error) {
    await service.rpc("fail_tournament_player_portrait_upload", {
      p_actor_user_id: actorId, p_portrait_id: portraitId,
    })
    return { status: 502, payload: { error: "storage_unavailable" } }
  }
  const finalized = await service.rpc("finalize_tournament_player_portrait_upload", {
    p_actor_user_id: actorId, p_portrait_id: portraitId,
  })
  if (finalized.error || !finalized.data) {
    await service.storage.from(TOURNAMENT_PLAYER_PORTRAITS_BUCKET).remove([objectPath])
    await service.rpc("fail_tournament_player_portrait_upload", {
      p_actor_user_id: actorId, p_portrait_id: portraitId,
    })
    return { status: 500, payload: { error: "upload_finalize_failed" } }
  }
  return { status: 201, payload: finalized.data }
}

async function resolve(
  service: ServiceClient,
  actorId: string,
  body: Record<string, unknown>,
) {
  const ref = body.ref as Record<string, unknown> | undefined
  const audience = String(body.audience ?? "")
  const id = String(ref?.id ?? "")
  const variant = String(ref?.variant ?? "")
  if (ref?.kind !== "player_portrait" || !UUID_RE.test(id)) {
    return { status: 400, payload: { error: "invalid_image_ref" } }
  }
  const authorized = await service.rpc("authorize_tournament_player_portrait_read", {
    p_actor_user_id: actorId, p_portrait_id: id,
    p_variant: variant, p_audience: audience,
  })
  if (authorized.error || !authorized.data) {
    const [status, error] = mapError(authorized.error?.message ?? "")
    return { status, payload: { error } }
  }
  const grant = authorized.data as Record<string, unknown>
  if (!validGrant(grant)) return { status: 500, payload: { error: "read_contract_invalid" } }
  const signed = await service.storage.from(TOURNAMENT_PLAYER_PORTRAITS_BUCKET)
    .createSignedUrl(String(grant.objectPath), PORTRAIT_SIGNED_URL_TTL_SECONDS)
  if (signed.error || !signed.data) {
    return { status: 502, payload: { error: "storage_unavailable" } }
  }
  return {
    status: 200,
    payload: {
      ref, url: relativeSignedUrl(signed.data.signedUrl),
      ttlSeconds: PORTRAIT_SIGNED_URL_TTL_SECONDS,
      mimeType: grant.mimeType, width: grant.width, height: grant.height,
      focalX: grant.focalX, focalY: grant.focalY, audience: grant.audience,
    },
  }
}

async function remove(
  service: ServiceClient,
  actorId: string,
  body: Record<string, unknown>,
) {
  const portraitId = String(body.portraitId ?? "")
  if (!UUID_RE.test(portraitId)) {
    return { status: 400, payload: { error: "invalid_request" } }
  }
  const begun = await service.rpc("begin_tournament_player_portrait_delete", {
    p_actor_user_id: actorId, p_portrait_id: portraitId,
  })
  if (begun.error || !begun.data) {
    const [status, error] = mapError(begun.error?.message ?? "")
    return { status, payload: { error } }
  }
  const grant = begun.data as Record<string, unknown>
  if (!validGrant(grant)) return { status: 500, payload: { error: "delete_contract_invalid" } }
  const deleted = await service.storage.from(TOURNAMENT_PLAYER_PORTRAITS_BUCKET)
    .remove([String(grant.objectPath)])
  if (deleted.error) {
    return { status: 502, payload: { error: "delete_storage_failed", deletePending: true } }
  }
  const completed = await service.rpc("complete_tournament_player_portrait_delete", {
    p_actor_user_id: actorId, p_portrait_id: portraitId,
  })
  if (completed.error || !completed.data) {
    return { status: 500, payload: { error: "delete_finalize_failed", deletePending: true } }
  }
  return { status: 200, payload: completed.data }
}

serve(async (request) => {
  const cors = buildCorsHeaders(request)
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (request.method !== "POST" && request.method !== "PUT") {
    return jsonResponse(cors, 405, { error: "method_not_allowed" })
  }
  const actorId = await resolveActor(request)
  if (!actorId) return jsonResponse(cors, 401, { error: "auth_required" })
  let secret
  try {
    secret = getSupabaseSecretCredential()
  } catch {
    return jsonResponse(cors, 500, { error: "server_misconfigured" })
  }
  const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", secret.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseCredentialFetch(secret) },
  })
  try {
    if (request.method === "PUT") {
      if (new URL(request.url).searchParams.get("action") !== "upload") {
        return jsonResponse(cors, 400, { error: "unknown_action" })
      }
      const result = await upload(service, actorId, request)
      return jsonResponse(cors, result.status, result.payload)
    }
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      return jsonResponse(cors, 400, { error: "invalid_request" })
    }
    const action = String(body.action ?? "")
    const result = action === "resolve"
      ? await resolve(service, actorId, body)
      : action === "delete"
      ? await remove(service, actorId, body)
      : { status: 400, payload: { error: "unknown_action" } }
    return jsonResponse(cors, result.status, result.payload)
  } catch {
    return jsonResponse(cors, 500, { error: "portrait_service_failed" })
  }
})
