// backend/torneos/supabase/functions/torneos-gateway/media.ts
//
// MEDIA-V1 — photo galleries in the hybrid composition, shared by the Edge gateway (index.ts) and the Node lab gateway
// (integration/torneos-core-contracts/gateway.mjs). Strictly opt-in:
//
//   • TORNEOS_MEDIA_MODE absent, "" or "off" → nothing changes (no route, no RPC);
//   • "on" → (1) the authenticated route gains exactly the RPCs of media-v1-rpc-allowlist.json (the baseline gallery
//     contract: galleries, review, cover / order, publication, retiring content, reports, the participant read);
//     (2) POST /torneos/media/v1/upload?gallery=<uuid>&key=<uuid> takes ONE normalized photo (JPEG / PNG / WebP,
//     ≤ 4 MiB): the gateway verifies its structure with the pipeline's own verifier (media-image.ts: magic bytes,
//     full container walk, no metadata carrier, orientation 1, real dimensions ≤ 1600 px / 2.56 MP), hashes it, opens
//     or replays the session with the caller's token, writes the object and completes the session with a 120 s
//     bridge token that carries the gateway claim for THAT session (migration 00000000000012: only that claim may
//     write to the bucket or complete an upload, and the browser never holds it); (3) POST /torneos/media/v1/urls
//     signs 300 s read URLs for the assets the CALLER may read (the baseline's authorize_tournament_media_read, then
//     storage RLS again on the signature);
//   • any other value, a malformed document, an overlapping name or an unsafe storage target throws MediaConfigError
//     and the gateway refuses to boot (fail closed).
//
// Nothing here is a public bucket, a service key, an object name handed to the browser or a list of objects.
import mediaDoc from "./media-v1-rpc-allowlist.json" with { type: "json" }
import { MVP_SIMPLE_MEDIA_LIMITS } from "./media-contract.ts"
import { MediaImageError, sha256Hex, verifyNormalizedImage } from "./media-image.ts"
import { storageTargets } from "./branding.ts"

export class MediaConfigError extends Error {}

export const MEDIA_BUCKET = "tournament-media"
export const MEDIA_UPLOAD_ROUTE = "/torneos/media/v1/upload"
export const MEDIA_URLS_ROUTE = "/torneos/media/v1/urls"
export const MEDIA_MAX_BYTES = MVP_SIMPLE_MEDIA_LIMITS.maxFileBytes
export const MEDIA_SIGNED_URL_TTL = 300
/** The claim only the gateway signs: the upload session a token may write and complete. */
export const MEDIA_GATEWAY_CLAIM = "torneos_media_upload_session"
/** Called by the gateway itself, never served on the generic route. */
export const MEDIA_INTERNAL_RPCS: ReadonlySet<string> = new Set([
  "begin_tournament_media_gallery_upload", "complete_tournament_media_gallery_upload",
  "fail_tournament_media_gallery_upload", "get_tournament_media_read_targets",
  "request_tournament_media_upload_session", "complete_tournament_media_simple_upload",
])
const MEDIA_FEATURES = ["media_management", "media_participant"]
const MIME_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"])
const KINDS: ReadonlySet<string> = new Set(["thumbnail", "grid", "detail"])
const MAX_URL_ITEMS = 120
const URLS_BODY_LIMIT = 16384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const OBJECT_NAME = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/
const NAME = /^[a-z0-9_]+$/

export type MediaContract = {
  mode: "on" | "off"
  rpcs: ReadonlySet<string>
  restUrl: string
  storageUrl: string
  publicBase: string
}
const OFF: MediaContract = Object.freeze({ mode: "off", rpcs: new Set<string>(), restUrl: "", storageUrl: "", publicBase: "" })

/**
 * @param authenticated every RPC the authenticated route already serves (every contract booted before this one)
 * @param restUrl       the Torneos REST base (also decides the only acceptable storage target)
 */
export function loadMediaContract(env: Record<string, string | undefined>, authenticated: ReadonlySet<string>,
  restUrl: string, doc: unknown = mediaDoc): MediaContract {
  const mode = env.TORNEOS_MEDIA_MODE ?? "off"
  if (mode === "" || mode === "off") return OFF
  if (mode !== "on") throw new MediaConfigError("TORNEOS_MEDIA_MODE must be on or off")
  if (!doc || typeof doc !== "object" || (doc as { phase?: unknown }).phase !== "MEDIA-V1") {
    throw new MediaConfigError("media-v1 allowlist is not the MEDIA-V1 contract")
  }
  const features = (doc as { features?: unknown }).features
  if (!features || typeof features !== "object" || Array.isArray(features)
    || Object.keys(features).join() !== MEDIA_FEATURES.join()) throw new MediaConfigError("features section")
  const names: string[] = []
  for (const feature of MEDIA_FEATURES) {
    const list = (features as Record<string, unknown>)[feature]
    if (!Array.isArray(list) || list.length === 0) throw new MediaConfigError(`features.${feature}`)
    for (const name of list) {
      if (typeof name !== "string" || !NAME.test(name)) throw new MediaConfigError(`features.${feature} names`)
      names.push(name)
    }
  }
  const rpcs = new Set(names)
  if (rpcs.size !== names.length) throw new MediaConfigError("duplicate names")
  if (names.some((name) => authenticated.has(name))) throw new MediaConfigError("overlaps an earlier contract")
  if (names.some((name) => name.startsWith("platform_") || MEDIA_INTERNAL_RPCS.has(name))) {
    throw new MediaConfigError("gateway-internal or platform RPCs are never served")
  }
  if ([...MEDIA_INTERNAL_RPCS].some((name) => authenticated.has(name))) {
    throw new MediaConfigError("a gateway-internal media RPC is served by another contract")
  }
  const rest = restUrl.replace(/\/$/, "")
  const { storageUrl, publicBase } = storageTargets(env, rest, MediaConfigError)
  return Object.freeze({ mode: "on", rpcs, restUrl: rest, storageUrl, publicBase })
}

/** Authenticated generic route: everything already served ∪ MEDIA-V1 (when on). */
export function withMedia(base: ReadonlySet<string>, contract: MediaContract): ReadonlySet<string> {
  return new Set([...base, ...contract.rpcs])
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>
type Body = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null

export type MediaDeps = {
  /** The caller's verified bridge token (identity, Core session and local identity already checked). */
  bearer: string
  apikey: string | null
  /** A bridge token for the SAME identity and Core session that also carries MEDIA_GATEWAY_CLAIM = sessionId. */
  mint: (sessionId: string) => Promise<string>
  fetchImpl?: FetchLike
}
export type MediaResult = { status: number; body: Record<string, unknown> }

class Unavailable extends Error {}
export const isMediaUnavailable = (error: unknown) => error instanceof Unavailable

async function readLimited(body: Body, declared: number, max: number, exact: boolean): Promise<Uint8Array | null> {
  if (!body) return null
  const chunks: Uint8Array[] = []
  let size = 0
  const iterable: AsyncIterable<Uint8Array> = (body as ReadableStream<Uint8Array>).getReader
    ? (async function* () {
      const reader = (body as ReadableStream<Uint8Array>).getReader()
      for (;;) { const { done, value } = await reader.read(); if (done) return; yield value }
    })()
    : body as AsyncIterable<Uint8Array>
  for await (const chunk of iterable) {
    size += chunk.length
    if (size > declared || size > max) return null
    chunks.push(chunk)
  }
  if ((exact && size !== declared) || size === 0) return null
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

type RpcOutcome = { ok: true; data: unknown } | { ok: false; status: number; code: string; detail: unknown }

async function rpc(contract: MediaContract, deps: MediaDeps, token: string, name: string,
  args: Record<string, unknown>): Promise<RpcOutcome> {
  let response: Response
  try {
    response = await (deps.fetchImpl ?? fetch)(`${contract.restUrl}/rpc/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json",
        ...(deps.apikey ? { apikey: deps.apikey } : {}) },
      body: JSON.stringify(args), redirect: "error", signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new Unavailable()
  }
  let payload: unknown = null
  try { payload = await response.json() } catch { payload = null }
  if (response.ok) return { ok: true, data: payload }
  const message = payload && typeof payload === "object" ? (payload as { message?: unknown }).message : null
  const details = payload && typeof payload === "object" ? (payload as { details?: unknown }).details : null
  const code = typeof message === "string" && /^TORNEOS_[A-Z0-9_]+$/.test(message) ? message : ""
  // A functional code is an answer of a live backend whatever its status; anything else 5xx is an outage.
  if (!code && response.status >= 500) throw new Unavailable()
  let detail: unknown = null
  if (typeof details === "string") { try { detail = JSON.parse(details) } catch { detail = null } }
  return { ok: false, status: response.status, code: code || "TORNEOS_MEDIA_UPLOAD_REFUSED", detail }
}

/** A functional refusal, in the gateway's own contract (the browser maps codes to product copy). */
function refusal(outcome: Extract<RpcOutcome, { ok: false }>): MediaResult {
  const status = ({
    TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED: 422,
    TORNEOS_MEDIA_FILE_INVALID: 422,
    TORNEOS_MEDIA_METADATA_NOT_STRIPPED: 422,
    TORNEOS_MEDIA_UPLOAD_IN_PROGRESS: 409,
    TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT: 409,
    TORNEOS_MEDIA_DUPLICATE: 409,
    TORNEOS_MEDIA_GALLERY_IMMUTABLE: 409,
    TORNEOS_MEDIA_PIPELINE_NOT_READY: 409,
    TORNEOS_MEDIA_MVP_RATE_LIMITED: 429,
    TORNEOS_MEDIA_QUOTA_EXCEEDED: 429,
    TORNEOS_AUTH_REQUIRED: 403,
    TORNEOS_MEDIA_FORBIDDEN: 403,
    TORNEOS_MEDIA_GATEWAY_REQUIRED: 403,
    TORNEOS_MEDIA_UPLOAD_SESSION_INVALID: 403,
  } as Record<string, number>)[outcome.code] ?? 400
  const body: Record<string, unknown> = { error: outcome.code }
  // The season quota answers with its numbers so the organizer reads "25 de 25", never a technical code.
  if (outcome.code === "TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED" && outcome.detail && typeof outcome.detail === "object") {
    const { usage, limit, upgradeRequired } = outcome.detail as Record<string, unknown>
    body.quota = {
      usage: Number.isInteger(usage) ? usage : null,
      limit: Number.isInteger(limit) ? limit : null,
      upgradeRequired: upgradeRequired === true,
    }
  }
  return { status, body }
}

export type MediaUploadRequest = { search: string; contentType: string | null; contentLength: string | null; body: Body }

/**
 * One photo, end to end. The bytes are verified BEFORE any session exists (an invalid file spends no quota), the
 * object written is exactly the verified bytes (no upsert, immutable), and a retry with the same key never makes a
 * second photo: the database answers `uploaded` with the first asset.
 */
export async function mediaUpload(request: MediaUploadRequest, contract: MediaContract, deps: MediaDeps): Promise<MediaResult> {
  if (contract.mode !== "on") return { status: 404, body: { error: "not found" } }
  const params = new URLSearchParams(request.search)
  const galleryId = params.get("gallery") ?? ""
  const key = params.get("key") ?? ""
  if ([...params.keys()].sort().join() !== "gallery,key" || !UUID.test(galleryId) || !UUID.test(key)) {
    return { status: 400, body: { error: "invalid arguments" } }
  }
  const mime = (request.contentType ?? "").split(";")[0].trim().toLowerCase()
  if (!MIME_TYPES.has(mime)) return { status: 415, body: { error: "TORNEOS_MEDIA_TYPE_UNSUPPORTED" } }
  const declared = /^[0-9]{1,8}$/.test(request.contentLength ?? "") ? Number(request.contentLength) : -1
  if (declared <= 0 || declared > MEDIA_MAX_BYTES) return { status: 413, body: { error: "TORNEOS_MEDIA_TOO_LARGE" } }
  const bytes = await readLimited(request.body, declared, MEDIA_MAX_BYTES, true)
  if (!bytes) return { status: 413, body: { error: "TORNEOS_MEDIA_TOO_LARGE" } }

  let inspection
  try {
    inspection = verifyNormalizedImage(bytes, mime, {
      maxFileBytes: MVP_SIMPLE_MEDIA_LIMITS.maxFileBytes,
      maxPixels: MVP_SIMPLE_MEDIA_LIMITS.maxPixels,
      maxEdge: MVP_SIMPLE_MEDIA_LIMITS.maxEdge,
    })
  } catch (error) {
    const code = error instanceof MediaImageError ? error.code : "MEDIA_CONTENT_CORRUPT"
    return { status: 422, body: { error: "TORNEOS_MEDIA_CONTENT_REJECTED", code } }
  }
  if (inspection.alreadyClean !== true) {
    return { status: 422, body: { error: "TORNEOS_MEDIA_CONTENT_REJECTED", code: "MEDIA_METADATA_PRESENT" } }
  }
  const checksum = await sha256Hex(bytes)

  const begun = await rpc(contract, deps, deps.bearer, "begin_tournament_media_gallery_upload", {
    p_gallery_id: galleryId, p_idempotency_key: key, p_mime: inspection.mime, p_byte_size: inspection.byteSize,
  })
  if (!begun.ok) return refusal(begun)
  const session = begun.data as Record<string, unknown> | null
  if (session?.state === "uploaded" && typeof session.assetId === "string" && UUID.test(session.assetId)) {
    return { status: 200, body: { assetId: session.assetId, status: typeof session.status === "string" ? session.status : null, replayed: true } }
  }
  const sessionId = session?.sessionId
  const token = session?.token
  const objectName = session?.objectName
  if (session?.state !== "issued" || typeof sessionId !== "string" || !UUID.test(sessionId)
    || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)
    || typeof objectName !== "string" || !OBJECT_NAME.test(objectName) || objectName.split("/")[2] !== galleryId) {
    throw new Unavailable()
  }

  const claim = await deps.mint(sessionId)
  const fail = async (failureCode: string) => {
    try { await rpc(contract, deps, claim, "fail_tournament_media_gallery_upload", { p_session_id: sessionId, p_failure_code: failureCode }) } catch { /* the sweeper retires it */ }
  }
  const target = `${contract.storageUrl}/object/${MEDIA_BUCKET}/${objectName}`
  const authorization = { authorization: `Bearer ${claim}`, ...(deps.apikey ? { apikey: deps.apikey } : {}) }
  let stored: Response
  try {
    stored = await (deps.fetchImpl ?? fetch)(target, {
      method: "POST",
      headers: { ...authorization, "content-type": inspection.mime, "cache-control": "max-age=31536000", "x-upsert": "false" },
      body: bytes, redirect: "error", signal: AbortSignal.timeout(15000),
    })
  } catch {
    await fail("STORAGE_UNAVAILABLE")
    throw new Unavailable()
  }
  await stored.body?.cancel()
  if (stored.status !== 200) {
    await fail(stored.status === 409 ? "OBJECT_EXISTS" : stored.status >= 500 ? "STORAGE_UNAVAILABLE" : "STORAGE_REFUSED")
    if (stored.status >= 500) throw new Unavailable()
    return { status: stored.status === 409 ? 409 : 403, body: { error: stored.status === 409 ? "TORNEOS_MEDIA_UPLOAD_IN_PROGRESS" : "TORNEOS_MEDIA_FORBIDDEN" } }
  }

  // An outage here leaves the outcome unknown: the object stays, and a retry with the same key reads the truth
  // (`uploaded`, or a fresh session once this one expires).
  const completed = await rpc(contract, deps, claim, "complete_tournament_media_gallery_upload", {
    p_session_id: sessionId, p_token: token, p_detected_mime: inspection.mime, p_byte_size: inspection.byteSize,
    p_width: inspection.width, p_height: inspection.height, p_checksum_sha256: checksum,
  })
  if (!completed.ok) {
    // The photo never became an asset: undo our own write, then record why.
    try {
      const removed = await (deps.fetchImpl ?? fetch)(target, { method: "DELETE", headers: authorization, redirect: "error", signal: AbortSignal.timeout(5000) })
      await removed.body?.cancel()
    } catch { /* the sweeper owns orphans */ }
    await fail(completed.code === "TORNEOS_MEDIA_DUPLICATE" ? "DUPLICATE" : "COMPLETION_REFUSED")
    return refusal(completed)
  }
  const asset = completed.data as Record<string, unknown> | null
  return { status: 201, body: { assetId: asset?.assetId ?? null, status: asset?.status ?? "pending_review", width: inspection.width, height: inspection.height } }
}

export type MediaUrlsRequest = { contentType: string | null; contentLength: string | null; body: Body }

/** Signed read URLs for the assets the caller may read; a refused asset simply has no entry. */
export async function mediaUrls(request: MediaUrlsRequest, contract: MediaContract, deps: MediaDeps): Promise<MediaResult> {
  if (contract.mode !== "on") return { status: 404, body: { error: "not found" } }
  if (!/^application\/json(;|$)/i.test((request.contentType ?? "").trim())) return { status: 415, body: { error: "json required" } }
  const declared = request.contentLength === null ? URLS_BODY_LIMIT
    : /^[0-9]{1,6}$/.test(request.contentLength) ? Number(request.contentLength) : -1
  if (declared <= 0 || declared > URLS_BODY_LIMIT) return { status: 413, body: { error: "body too large" } }
  const raw = await readLimited(request.body, declared, URLS_BODY_LIMIT, request.contentLength !== null)
  if (!raw) return { status: 400, body: { error: "invalid json" } }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return { status: 400, body: { error: "invalid json" } } }
  const items = (parsed as { items?: unknown } | null)?.items
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).join() !== "items"
    || !Array.isArray(items) || items.length === 0 || items.length > MAX_URL_ITEMS) {
    return { status: 400, body: { error: "invalid arguments" } }
  }
  const byKind = new Map<string, Set<string>>()
  for (const item of items) {
    const { assetId, kind } = (item ?? {}) as Record<string, unknown>
    if (!item || typeof item !== "object" || Object.keys(item).sort().join() !== "assetId,kind"
      || typeof assetId !== "string" || !UUID.test(assetId) || typeof kind !== "string" || !KINDS.has(kind)) {
      return { status: 400, body: { error: "invalid arguments" } }
    }
    if (!byKind.has(kind)) byKind.set(kind, new Set())
    byKind.get(kind)!.add(assetId)
  }
  const targets: { assetId: string; kind: string; objectName: string }[] = []
  for (const [kind, ids] of byKind) {
    if (ids.size > 60) return { status: 400, body: { error: "invalid arguments" } }
    const outcome = await rpc(contract, deps, deps.bearer, "get_tournament_media_read_targets", { p_asset_ids: [...ids], p_kind: kind })
    if (!outcome.ok) return refusal(outcome)
    for (const entry of Array.isArray(outcome.data) ? outcome.data : []) {
      const { assetId, objectName } = (entry ?? {}) as Record<string, unknown>
      if (typeof assetId === "string" && ids.has(assetId) && typeof objectName === "string" && OBJECT_NAME.test(objectName)) {
        targets.push({ assetId, kind, objectName })
      }
    }
  }
  const urls = await signObjects([...new Set(targets.map((t) => t.objectName))], contract, deps)
  return {
    status: 200,
    body: {
      expiresIn: MEDIA_SIGNED_URL_TTL,
      items: targets.filter((t) => urls.has(t.objectName)).map((t) => ({ assetId: t.assetId, kind: t.kind, url: urls.get(t.objectName) })),
    },
  }
}

/** One storage call: the caller's own token, so storage RLS (can_read_tournament_media_object) decides again. */
async function signObjects(paths: readonly string[], contract: MediaContract, deps: MediaDeps): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls
  let response: Response
  try {
    response = await (deps.fetchImpl ?? fetch)(`${contract.storageUrl}/object/sign/${MEDIA_BUCKET}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${deps.bearer}`, ...(deps.apikey ? { apikey: deps.apikey } : {}) },
      body: JSON.stringify({ expiresIn: MEDIA_SIGNED_URL_TTL, paths }),
      redirect: "error", signal: AbortSignal.timeout(3000),
    })
  } catch {
    return urls
  }
  if (response.status !== 200) { await response.body?.cancel(); return urls }
  let entries: unknown
  try { entries = await response.json() } catch { return urls }
  if (!Array.isArray(entries)) return urls
  const prefix = `/object/sign/${MEDIA_BUCKET}/`
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const { path, signedURL, error } = entry as { path?: unknown; signedURL?: unknown; error?: unknown }
    if (error || typeof path !== "string" || !paths.includes(path) || typeof signedURL !== "string") continue
    if (!signedURL.startsWith(`${prefix}${path}?token=`) || /[\s"<>]/.test(signedURL)) continue
    urls.set(path, `${contract.publicBase}${signedURL}`)
  }
  return urls
}
