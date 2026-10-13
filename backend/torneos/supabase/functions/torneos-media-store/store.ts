// backend/torneos/supabase/functions/torneos-media-store/store.ts
//
// MEDIA-STORE-V1 — the only component that touches the Torneos project's private buckets with the service key.
//
// Why it exists: hosted Supabase Storage verifies only the project's own signing keys, so the bridge's RS256 tokens
// (trusted by the Data API through Third-Party Auth) are refused by Storage before any policy runs. The gateway can no
// longer write, remove or sign with the caller's token; this function does it with the service key, which never leaves
// Supabase, and only after the database says the caller may (public.authorize_tournament_storage_objects, migration
// 00000000000017, evaluated with the caller's own token through the Data API).
//
// What it accepts, and nothing else:
//   • requests signed by the gateway (HMAC-SHA256 of method, path, query, timestamp, body hash and identity hash, with
//     the shared TORNEOS_MEDIA_STORE_SECRET; ±60 s): a browser holding a bridge token cannot call it directly;
//   • six operations — branding-put, branding-delete, branding-sign, media-put, media-delete, media-sign — each with a
//     fixed argument shape. No bucket, role, claim, list or upsert ever comes from a request;
//   • branding-put: the object NAME is generated here (organization/kind/entity from the request, a random UUID and the
//     extension of the REAL content type); the bytes must be a structurally valid PNG / JPEG / WebP (magic bytes and
//     full container walk), ≤ 2 MiB, ≤ 4096 px per edge, orientation 1; metadata is stripped before storing;
//   • media-put: the name is the one the database issued for the caller's live upload session (it is only accepted if
//     authorize says the session claim may write it); the bytes must already be normalized (no metadata, orientation 1)
//     and within the MVP_SIMPLE limits (photo) or the thumbnail limits (JPEG ≤ 640 px, ≤ 500 000 bytes);
//   • the *-sign operations sign only the names authorize returns (branding 3600 s, media 300 s);
//   • media-purge (0018): the season-end removal. Signed with its OWN secret (TORNEOS_MEDIA_PURGE_SECRET; without it the
//     operation does not exist) and no user identity: the scheduler never holds the gateway's secret. The database
//     decides everything (claim_tournament_media_purge leases photos of closed seasons and lists their orphans); this
//     function only removes those objects in the media bucket and confirms each photo (complete_tournament_media_purge).
//     A photo whose objects could not be removed is not confirmed: its lease expires and the next run retries it.
//
// It never logs or returns a key, a token or a signed URL in an error; errors are fixed codes.
import { inspectImage, MediaImageError, verifyNormalizedImage } from "../torneos-gateway/media-image.ts"
import { MVP_SIMPLE_MEDIA_LIMITS } from "../torneos-gateway/media-contract.ts"
import { parseSecret, sign, signingInput } from "../torneos-gateway/media-store-protocol.ts"

export const BRANDING_BUCKET = "tournament-branding"
export const MEDIA_BUCKET = "tournament-media"
export const BRANDING_TTL = 3600
export const MEDIA_TTL = 300
export const SIGNATURE_WINDOW_S = 60
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const UUID = new RegExp(`^${UUID_RE}$`)
export const BRANDING_PATH = new RegExp(`^${UUID_RE}/(organizations|tournaments|teams)/${UUID_RE}/${UUID_RE}\\.(jpg|png|webp)$`)
const MEDIA_OBJECT = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/
const MEDIA_THUMBNAIL = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}-thumbnail\.jpg$/
const MEDIA_READ = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumbnail\.jpg|\.(jpg|png|webp))$/
const KINDS: Readonly<Record<string, string>> = Object.freeze({ organization: "organizations", tournament: "tournaments", team: "teams" })
const EXTENSION: Readonly<Record<string, string>> = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })
export const BRANDING_LIMITS = Object.freeze({ maxFileBytes: 2 * 1024 * 1024, maxPixels: 4096 * 4096, maxEdge: 4096 })
const PHOTO_LIMITS = Object.freeze({ maxFileBytes: MVP_SIMPLE_MEDIA_LIMITS.maxFileBytes, maxPixels: MVP_SIMPLE_MEDIA_LIMITS.maxPixels,
  maxEdge: MVP_SIMPLE_MEDIA_LIMITS.maxEdge })
const THUMB_LIMITS = Object.freeze({ maxFileBytes: 500_000, maxPixels: 640 * 640, maxEdge: 640 })
const MAX_BODY = MVP_SIMPLE_MEDIA_LIMITS.maxFileBytes
const MAX_JSON = 32 * 1024
const MAX_BRANDING_SIGN = 200
const MAX_MEDIA_SIGN = 120
const OPERATIONS: ReadonlySet<string> = new Set(["branding-put", "branding-delete", "branding-sign", "media-put", "media-delete", "media-sign", "media-purge"])
// Every object a photo can have in the media bucket: the photo, its thumbnail and a processor variant.
const MEDIA_PURGE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-(thumbnail|grid|detail|original))?\.(jpg|png|webp)$/
const MAX_PURGE = 100

export class StoreConfigError extends Error {}

export type StoreConfig = {
  secret: Uint8Array
  /** 0018: the season-end purge's own secret; null = media-purge disabled. */
  purgeSecret: Uint8Array | null
  restUrl: string
  storageUrl: string
  publicBase: string
  /** Headers that authenticate as the service role toward THIS project's Storage. */
  serviceHeaders: Readonly<Record<string, string>>
  /** The project's publishable (or legacy anon) key: the Data API's `apikey`, never an identity. */
  apikey: string
}

const HOSTED = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/
const LAB_REST = "http://torneos-rest:3000"
const LAB_STORAGE = "http://torneos-storage:5000"
const LAB_PUBLIC = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

function namedKey(json: string | undefined, prefix: string): string | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const value = parsed?.default
    return typeof value === "string" && value.startsWith(prefix) ? value : null
  } catch {
    return null
  }
}

/**
 * Hosted: SUPABASE_URL is the project's own origin (Data API at /rest/v1, Storage at /storage/v1), the service key is
 * SUPABASE_SECRET_KEYS.default (sb_secret_…, sent as `apikey` only) or the legacy SUPABASE_SERVICE_ROLE_KEY JWT.
 * The local lab: no SUPABASE_URL, the two internal services and a loopback public base, exactly.
 */
export function loadStoreConfig(env: Record<string, string | undefined>): StoreConfig {
  const secret = parseSecret(env.TORNEOS_MEDIA_STORE_SECRET)
  if (!secret) throw new StoreConfigError("TORNEOS_MEDIA_STORE_SECRET must be 64–128 hex characters")
  const purgeRaw = (env.TORNEOS_MEDIA_PURGE_SECRET ?? "").trim()
  const purgeSecret = purgeRaw ? parseSecret(purgeRaw) : null
  if (purgeRaw && !purgeSecret) throw new StoreConfigError("TORNEOS_MEDIA_PURGE_SECRET must be 64–128 hex characters")
  if (purgeRaw && purgeRaw === (env.TORNEOS_MEDIA_STORE_SECRET ?? "").trim()) {
    throw new StoreConfigError("TORNEOS_MEDIA_PURGE_SECRET must differ from the gateway's secret")
  }
  const origin = (env.SUPABASE_URL ?? "").trim().replace(/\/$/, "")
  let restUrl: string, storageUrl: string, publicBase: string
  if (origin) {
    if (!HOSTED.test(origin)) throw new StoreConfigError("SUPABASE_URL must be the project's own origin")
    restUrl = `${origin}/rest/v1`
    storageUrl = `${origin}/storage/v1`
    publicBase = storageUrl
  } else {
    restUrl = (env.TORNEOS_MEDIA_STORE_REST_URL ?? "").trim()
    storageUrl = (env.TORNEOS_MEDIA_STORE_STORAGE_URL ?? "").trim()
    publicBase = (env.TORNEOS_MEDIA_STORE_PUBLIC_URL ?? "").trim()
    if (restUrl !== LAB_REST || storageUrl !== LAB_STORAGE || !LAB_PUBLIC.test(publicBase)) {
      throw new StoreConfigError("without SUPABASE_URL only the local lab's services are accepted")
    }
  }
  const secretKey = namedKey(env.SUPABASE_SECRET_KEYS, "sb_secret_")
  const legacyService = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()
  let serviceHeaders: Record<string, string>
  if (secretKey) serviceHeaders = { apikey: secretKey }
  else if (JWT.test(legacyService)) serviceHeaders = { apikey: legacyService, authorization: `Bearer ${legacyService}` }
  else throw new StoreConfigError("no service key")
  const apikey = namedKey(env.SUPABASE_PUBLISHABLE_KEYS, "sb_publishable_") ?? (env.SUPABASE_ANON_KEY ?? "").trim()
  if (!apikey) throw new StoreConfigError("no publishable key")
  return Object.freeze({ secret, purgeSecret, restUrl, storageUrl, publicBase, serviceHeaders: Object.freeze(serviceHeaders), apikey })
}

export type StoreDeps = {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
  randomUUID?: () => string
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
class Outage extends Error {}

async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const declared = req.headers.get("content-length")
  if (declared !== null && (!/^[0-9]{1,9}$/.test(declared) || Number(declared) > max)) throw new Refusal(413, "TOO_LARGE")
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) { await reader.cancel(); throw new Refusal(413, "TOO_LARGE") }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

function parseJson(bytes: Uint8Array, keys: string[]): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new Refusal(400, "INVALID_ARGUMENTS") }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join() !== [...keys].sort().join()) {
    throw new Refusal(400, "INVALID_ARGUMENTS")
  }
  return parsed as Record<string, unknown>
}

function names(value: unknown, max: number, pattern: RegExp): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) throw new Refusal(400, "INVALID_ARGUMENTS")
  const out = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string" || !pattern.test(item)) throw new Refusal(400, "INVALID_ARGUMENTS")
    out.add(item)
  }
  return [...out]
}

type Ctx = { cfg: StoreConfig; deps: Required<StoreDeps>; identity: string }

/** The database's decision for the caller (its own token through the Data API): the subset of names it may use. */
async function authorize(ctx: Ctx, bucket: string, operation: string, list: string[]): Promise<Set<string>> {
  let response: Response
  try {
    response = await ctx.deps.fetchImpl(`${ctx.cfg.restUrl}/rpc/authorize_tournament_storage_objects`, {
      method: "POST",
      headers: { apikey: ctx.cfg.apikey, authorization: `Bearer ${ctx.identity}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ p_bucket: bucket, p_operation: operation, p_names: list }),
      redirect: "error", signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new Outage()
  }
  if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new Refusal(403, "FORBIDDEN") }
  if (response.status >= 500) { await response.body?.cancel(); throw new Outage() }
  if (response.status !== 200) { await response.body?.cancel(); throw new Refusal(403, "FORBIDDEN") }
  let allowed: unknown
  try { allowed = await response.json() } catch { throw new Outage() }
  if (!Array.isArray(allowed)) throw new Outage()
  // Only names that were asked about: the database can narrow, never add.
  return new Set(allowed.filter((name): name is string => typeof name === "string" && list.includes(name)))
}

/** A service RPC of the purge (service role through the Data API): only the two 0018 functions, fixed arguments. */
async function serviceRpc(ctx: Ctx, fn: "claim_tournament_media_purge" | "complete_tournament_media_purge", args: Record<string, unknown>): Promise<unknown> {
  let response: Response
  try {
    response = await ctx.deps.fetchImpl(`${ctx.cfg.restUrl}/rpc/${fn}`, {
      method: "POST",
      headers: { ...ctx.cfg.serviceHeaders, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(args), redirect: "error", signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Outage()
  }
  if (response.status !== 200) { await response.body?.cancel(); throw new Outage() }
  try { return await response.json() } catch { throw new Outage() }
}

async function storagePut(ctx: Ctx, bucket: string, name: string, bytes: Uint8Array, mime: string, cacheControl: string): Promise<void> {
  let response: Response
  try {
    response = await ctx.deps.fetchImpl(`${ctx.cfg.storageUrl}/object/${bucket}/${name}`, {
      method: "POST",
      headers: { ...ctx.cfg.serviceHeaders, "content-type": mime, "cache-control": cacheControl, "x-upsert": "false" },
      body: bytes as unknown as BodyInit, redirect: "error", signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Outage()
  }
  await response.body?.cancel()
  if (response.status === 200) return
  if (response.status >= 500) throw new Outage()
  // Storage answers a taken name with 400/409 ("The resource already exists"): objects are immutable.
  throw new Refusal(409, "OBJECT_EXISTS")
}

async function storageDelete(ctx: Ctx, bucket: string, list: string[]): Promise<string[]> {
  let response: Response
  try {
    response = await ctx.deps.fetchImpl(`${ctx.cfg.storageUrl}/object/${bucket}`, {
      method: "DELETE",
      headers: { ...ctx.cfg.serviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: list }), redirect: "error", signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new Outage()
  }
  // Storage answers a removal with 200 and the list of what it removed (empty when nothing was there). Any other answer
  // is a provider failure, never "already absent": a misconfigured key or a refused request must not read as removed.
  if (response.status !== 200) { await response.body?.cancel(); throw new Outage() }
  let removed: unknown
  try { removed = await response.json() } catch { throw new Outage() }
  if (!Array.isArray(removed)) throw new Outage()
  return removed.map((entry) => (entry as { name?: unknown })?.name).filter((name): name is string => typeof name === "string" && list.includes(name))
}

async function storageSign(ctx: Ctx, bucket: string, list: string[], ttl: number): Promise<Record<string, string>> {
  const urls: Record<string, string> = {}
  if (list.length === 0) return urls
  let response: Response
  try {
    response = await ctx.deps.fetchImpl(`${ctx.cfg.storageUrl}/object/sign/${bucket}`, {
      method: "POST",
      headers: { ...ctx.cfg.serviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: ttl, paths: list }), redirect: "error", signal: AbortSignal.timeout(3000),
    })
  } catch {
    throw new Outage()
  }
  if (response.status >= 500) { await response.body?.cancel(); throw new Outage() }
  if (response.status !== 200) { await response.body?.cancel(); return urls }
  let entries: unknown
  try { entries = await response.json() } catch { return urls }
  if (!Array.isArray(entries)) return urls
  const prefix = `/object/sign/${bucket}/`
  for (const entry of entries) {
    const { path, signedURL, error } = (entry ?? {}) as { path?: unknown; signedURL?: unknown; error?: unknown }
    if (error || typeof path !== "string" || !list.includes(path) || typeof signedURL !== "string") continue
    if (!signedURL.startsWith(`${prefix}${path}?token=`) || /[\s"<>]/.test(signedURL)) continue
    urls[path] = `${ctx.cfg.publicBase}${signedURL}`
  }
  return urls
}

function image(bytes: Uint8Array, declared: string, limits: { maxFileBytes: number; maxPixels: number; maxEdge: number },
  normalized: boolean) {
  try {
    if (normalized) return verifyNormalizedImage(bytes, declared, limits)
    const inspection = inspectImage(bytes, declared, limits)
    if (inspection.exifOrientation !== null && inspection.exifOrientation !== 1) throw new MediaImageError("MEDIA_ORIENTATION_NOT_NORMALIZED")
    return inspection
  } catch (error) {
    throw new Refusal(422, error instanceof MediaImageError ? error.code : "MEDIA_CONTENT_CORRUPT")
  }
}

async function operate(op: string, params: URLSearchParams, body: Uint8Array, contentType: string, ctx: Ctx): Promise<Response> {
  const keys = [...params.keys()].sort().join()
  switch (op) {
    case "branding-put": {
      const organization = params.get("organization") ?? ""
      const kind = params.get("kind") ?? ""
      const entity = params.get("entity") ?? ""
      if (keys !== "entity,kind,organization" || !UUID.test(organization) || !UUID.test(entity) || !(kind in KINDS)) {
        throw new Refusal(400, "INVALID_ARGUMENTS")
      }
      const inspection = image(body, contentType, BRANDING_LIMITS, false)
      const name = `${organization}/${KINDS[kind]}/${entity}/${ctx.deps.randomUUID()}.${EXTENSION[inspection.mime]}`
      if (!BRANDING_PATH.test(name)) throw new Refusal(400, "INVALID_ARGUMENTS")
      if (!(await authorize(ctx, BRANDING_BUCKET, "write", [name])).has(name)) throw new Refusal(403, "FORBIDDEN")
      await storagePut(ctx, BRANDING_BUCKET, name, inspection.sanitized, inspection.mime, "max-age=31536000")
      return json(200, { path: name, mime: inspection.mime, width: inspection.width, height: inspection.height })
    }
    case "branding-delete": {
      if (keys !== "") throw new Refusal(400, "INVALID_ARGUMENTS")
      const { path } = parseJson(body, ["path"])
      if (typeof path !== "string" || !BRANDING_PATH.test(path)) throw new Refusal(400, "INVALID_ARGUMENTS")
      if (!(await authorize(ctx, BRANDING_BUCKET, "delete", [path])).has(path)) throw new Refusal(403, "FORBIDDEN")
      const removed = await storageDelete(ctx, BRANDING_BUCKET, [path])
      return removed.includes(path) ? json(200, { removed: true }) : json(404, { error: "NOT_REMOVED" })
    }
    case "branding-sign": {
      if (keys !== "") throw new Refusal(400, "INVALID_ARGUMENTS")
      const list = names(parseJson(body, ["paths"]).paths, MAX_BRANDING_SIGN, BRANDING_PATH)
      const allowed = await authorize(ctx, BRANDING_BUCKET, "read", list)
      return json(200, { urls: await storageSign(ctx, BRANDING_BUCKET, list.filter((name) => allowed.has(name)), BRANDING_TTL) })
    }
    case "media-put": {
      const name = params.get("name") ?? ""
      const kind = params.get("kind") ?? ""
      if (keys !== "kind,name" || !["photo", "thumbnail"].includes(kind)
        || !(kind === "photo" ? MEDIA_OBJECT : MEDIA_THUMBNAIL).test(name)) {
        throw new Refusal(400, "INVALID_ARGUMENTS")
      }
      const inspection = kind === "photo"
        ? image(body, contentType, PHOTO_LIMITS, true)
        : image(body, "image/jpeg", THUMB_LIMITS, true)
      // The extension the database chose is the type it registered for the session: the bytes must be that type.
      if (kind === "photo" && name.slice(name.lastIndexOf(".") + 1) !== EXTENSION[inspection.mime]) throw new Refusal(422, "MEDIA_MIME_MISMATCH")
      if (!(await authorize(ctx, MEDIA_BUCKET, "write", [name])).has(name)) throw new Refusal(403, "FORBIDDEN")
      await storagePut(ctx, MEDIA_BUCKET, name, body, inspection.mime, "private, max-age=31536000, immutable")
      return json(200, { stored: true })
    }
    case "media-delete": {
      if (keys !== "") throw new Refusal(400, "INVALID_ARGUMENTS")
      const list = names(parseJson(body, ["names"]).names, 2, MEDIA_READ)
      const allowed = await authorize(ctx, MEDIA_BUCKET, "delete", list)
      const removed = await storageDelete(ctx, MEDIA_BUCKET, list.filter((name) => allowed.has(name)))
      return json(200, { removed })
    }
    case "media-purge": {
      if (keys !== "") throw new Refusal(400, "INVALID_ARGUMENTS")
      const limit = parseJson(body, ["limit"]).limit
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_PURGE) throw new Refusal(400, "INVALID_ARGUMENTS")
      const claim = await serviceRpc(ctx, "claim_tournament_media_purge", { p_limit: limit }) as { assets?: unknown; orphans?: unknown }
      if (!claim || !Array.isArray(claim.assets) || !Array.isArray(claim.orphans)) throw new Outage()
      let purged = 0, orphansRemoved = 0
      // Observable without exposing a path: which photo stayed pending and why (its lease expires, the next run retries).
      const errors: Array<{ assetId: string | null; code: string }> = []
      for (const entry of claim.assets as Array<{ assetId?: unknown; names?: unknown }>) {
        const assetId = typeof entry?.assetId === "string" && UUID.test(entry.assetId) ? entry.assetId : null
        const names = Array.isArray(entry?.names) ? entry.names : []
        // All or nothing per photo: one object name outside the media patterns rejects the whole photo — removing only
        // the valid part and confirming it would mark as purged a photo whose other objects are still stored.
        if (!assetId || names.length === 0 || !names.every((n): n is string => typeof n === "string" && MEDIA_PURGE.test(n))) {
          errors.push({ assetId, code: "INVALID_NAME" })
          continue
        }
        try {
          // Removed or already absent: Storage answers 200 either way. Anything else leaves the photo for the next run.
          await storageDelete(ctx, MEDIA_BUCKET, names as string[])
          await serviceRpc(ctx, "complete_tournament_media_purge", { p_asset_id: assetId })
          purged++
        } catch (error) {
          if (!(error instanceof Outage)) throw error
          errors.push({ assetId, code: "UNAVAILABLE" })
        }
      }
      const failed = errors.length
      const orphans = (claim.orphans as unknown[]).filter((n): n is string => typeof n === "string" && MEDIA_PURGE.test(n))
      if (orphans.length > 0) {
        try { orphansRemoved = (await storageDelete(ctx, MEDIA_BUCKET, orphans)).length } catch (error) { if (!(error instanceof Outage)) throw error }
      }
      return json(200, { purged, failed, orphansRemoved, errors })
    }
    case "media-sign": {
      if (keys !== "") throw new Refusal(400, "INVALID_ARGUMENTS")
      const list = names(parseJson(body, ["names"]).names, MAX_MEDIA_SIGN, MEDIA_READ)
      const allowed = await authorize(ctx, MEDIA_BUCKET, "read", list)
      return json(200, { urls: await storageSign(ctx, MEDIA_BUCKET, list.filter((name) => allowed.has(name)), MEDIA_TTL) })
    }
  }
  throw new Refusal(404, "NOT_FOUND")
}

/** media-purge: its own secret, no identity (signed over an empty identity), JSON only. Absent secret → no such route. */
async function handlePurge(req: Request, url: URL, cfg: StoreConfig, d: Required<StoreDeps>): Promise<Response> {
  if (!cfg.purgeSecret) return json(404, { error: "NOT_FOUND" })
  const timestamp = req.headers.get("x-torneos-store-timestamp") ?? ""
  const signature = (req.headers.get("x-torneos-store-signature") ?? "").toLowerCase()
  if (req.headers.has("x-torneos-store-identity") || !/^[0-9]{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)
    || Math.abs(Math.floor(d.now() / 1000) - Number(timestamp)) > SIGNATURE_WINDOW_S) {
    return json(401, { error: "UNAUTHENTICATED" })
  }
  const body = await readBody(req, MAX_JSON)
  const expected = await sign(cfg.purgeSecret, await signingInput(req.method, "/torneos-media-store/v1/media-purge", url.search, timestamp, body, ""))
  if (!timingSafeEqualHex(signature, expected)) return json(401, { error: "UNAUTHENTICATED" })
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return json(415, { error: "UNSUPPORTED_TYPE" })
  return await operate("media-purge", url.searchParams, body, "application/json", { cfg, deps: d, identity: "" })
}

const ROUTE = /^\/(?:functions\/v1\/)?torneos-media-store\/v1\/([a-z-]+)$/

/** One request. Every refusal is a fixed code; nothing here ever echoes a key, a token or a URL in an error. */
export async function handle(req: Request, cfg: StoreConfig, deps: StoreDeps = {}): Promise<Response> {
  const d: Required<StoreDeps> = {
    fetchImpl: deps.fetchImpl ?? fetch, now: deps.now ?? Date.now, randomUUID: deps.randomUUID ?? (() => crypto.randomUUID()),
  }
  try {
    const url = new URL(req.url)
    const match = ROUTE.exec(url.pathname)
    if (req.method !== "POST" || !match || !OPERATIONS.has(match[1])) return json(404, { error: "NOT_FOUND" })
    const op = match[1]
    if (op === "media-purge") return await handlePurge(req, url, cfg, d)
    const identity = req.headers.get("x-torneos-store-identity") ?? ""
    const timestamp = req.headers.get("x-torneos-store-timestamp") ?? ""
    const signature = (req.headers.get("x-torneos-store-signature") ?? "").toLowerCase()
    if (!JWT.test(identity) || identity.length > 4096 || !/^[0-9]{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)
      || Math.abs(Math.floor(d.now() / 1000) - Number(timestamp)) > SIGNATURE_WINDOW_S) {
      return json(401, { error: "UNAUTHENTICATED" })
    }
    const isJson = op.endsWith("-delete") || op.endsWith("-sign")
    const body = await readBody(req, isJson ? MAX_JSON : MAX_BODY)
    const expected = await sign(cfg.secret, await signingInput(req.method, `/torneos-media-store/v1/${op}`, url.search, timestamp, body, identity))
    if (!timingSafeEqualHex(signature, expected)) return json(401, { error: "UNAUTHENTICATED" })
    const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
    if (isJson ? contentType !== "application/json" : !(contentType in EXTENSION)) return json(415, { error: "UNSUPPORTED_TYPE" })
    return await operate(op, url.searchParams, body, contentType, { cfg, deps: d, identity })
  } catch (error) {
    if (error instanceof Refusal) return json(error.status, { error: error.code })
    // An outage (Data API or Storage unreachable / 5xx) or anything unexpected: no detail leaves.
    return json(503, { error: "UNAVAILABLE" })
  }
}
