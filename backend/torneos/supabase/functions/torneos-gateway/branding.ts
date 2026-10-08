// backend/torneos/supabase/functions/torneos-gateway/branding.ts
//
// BRANDING-V1 — logos and shields in the hybrid composition, shared by the Edge gateway (index.ts) and the Node lab
// gateway (integration/torneos-core-contracts/gateway.mjs). Strictly opt-in:
//
//   • TORNEOS_BRANDING_MODE absent, "" or "off" → nothing changes (no route, no RPC, responses untouched);
//   • "on" → (1) the authenticated route gains exactly the RPCs of branding-v1-rpc-allowlist.json (the existing
//     branding contract: switch a reference, read the organization's branding context); (2) the object route
//     stores/removes one versioned object in the Torneos project's PRIVATE `tournament-branding` bucket with the
//     caller's own bridge token, so storage RLS (00000000000010: can_write_tournament_branding_object) decides;
//     (3) a fixed set of RPC responses gets a short-lived signed URL next to each branding path, signed in ONE batch
//     per response — public RPCs with the anon key (storage RLS: only the current branding of a published page),
//     authenticated RPCs with the caller's token (also what the caller may write);
//   • any other value, a malformed document, an overlapping name or an unsafe storage target throws
//     BrandingConfigError and the gateway refuses to boot (fail closed).
//
// Paths never leave as URLs unless storage signed them; a path storage refuses keeps its URL null (the page shows the
// initials). Nothing here is a public bucket, a service key or a list of objects.
import brandingDoc from "./branding-v1-rpc-allowlist.json" with { type: "json" }

export class BrandingConfigError extends Error {}

export const BRANDING_BUCKET = "tournament-branding"
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
/** The baseline's is_tournament_branding_path, byte for byte in intent: one versioned object, never a folder. */
export const BRANDING_PATH = new RegExp(`^${UUID}/(organizations|tournaments|teams)/${UUID}/${UUID}\\.(jpg|png|webp)$`)
export const BRANDING_OBJECT_ROUTE = new RegExp(`^/torneos/branding/v1/object/(${UUID}/(?:organizations|tournaments|teams)/${UUID}/${UUID}\\.(?:jpg|png|webp))$`)
export const BRANDING_MAX_BYTES = 2 * 1024 * 1024
export const SIGNED_URL_TTL = 3600
const MAX_PATHS_PER_RESPONSE = 200
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({ jpg: "image/jpeg", png: "image/png", webp: "image/webp" })

/** Responses that carry branding paths, by route. Only these are ever parsed and signed. */
export const SIGNED_PUBLIC_RPCS: ReadonlySet<string> = new Set([
  "search_tournament_catalog", "get_tournament_catalog_entry", "get_public_tournament_page", "get_public_tournament_branding",
])
/**
 * The public route gains exactly one existing read with BRANDING-V1: the public page's logos (the baseline's
 * get_public_tournament_branding, anon, same publication gates as the page). Body: the slug only; the answer is
 * projected to names and logos (the function also returns internal ids, which never leave the gateway).
 */
export const BRANDING_PUBLIC_RPCS: ReadonlySet<string> = new Set(["get_public_tournament_branding"])
const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$/
const PUBLIC_BODY_LIMIT = 2048
export const SIGNED_AUTHENTICATED_RPCS: ReadonlySet<string> = new Set([
  "get_tournament_branding_context", "get_team_registration_context", "get_tournament_teams_context",
  "get_tournament_participant_hub",
])
/** branding path key → the URL key added next to it. */
export const URL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  logoPath: "logoUrl", organizationLogoPath: "organizationLogoUrl", shieldPath: "shieldUrl",
})

export type BrandingContract = {
  mode: "on" | "off"
  rpcs: ReadonlySet<string>
  /** Storage API base the gateway talks to (hosted: https://<ref>.supabase.co/storage/v1). */
  storageUrl: string
  /** Base of the signed URLs handed to browsers (hosted: the same; lab: the loopback port). */
  publicBase: string
}

const OFF: BrandingContract = Object.freeze({ mode: "off", rpcs: new Set<string>(), storageUrl: "", publicBase: "" })
const NAME = /^[a-z0-9_]+$/
const LAB_STORAGE = "http://torneos-storage:5000"
const LAB_PUBLIC = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/
const HOSTED_REST = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/rest\/v1$/

/** The only storage targets a gateway contract may use (BRANDING-V1, and MEDIA-V1 with its own error class). */
export function storageTargets(env: Record<string, string | undefined>, restUrl: string,
  Fault: new (message: string) => Error = BrandingConfigError): { storageUrl: string; publicBase: string } {
  const rest = restUrl.replace(/\/$/, "")
  const hosted = HOSTED_REST.exec(rest)
  const explicit = (env.TORNEOS_STORAGE_URL ?? "").trim().replace(/\/$/, "")
  const explicitPublic = (env.TORNEOS_STORAGE_PUBLIC_URL ?? "").trim().replace(/\/$/, "")
  if (hosted) {
    // Hosted: storage is the same Torneos project as the REST API (same origin, /storage/v1). Nothing else is
    // accepted. Derived from the validated REST URL so no platform hostname is written in code.
    const derived = `${new URL(rest).origin}/storage/v1`
    if ((explicit && explicit !== derived) || (explicitPublic && explicitPublic !== derived)) {
      throw new Fault("TORNEOS_STORAGE_URL must be the Torneos project's own storage")
    }
    return { storageUrl: derived, publicBase: derived }
  }
  // The local lab only: the internal storage service and a loopback port for the browser.
  if (explicit !== LAB_STORAGE || !LAB_PUBLIC.test(explicitPublic)) {
    throw new Fault("storage is only the Torneos project's storage (or the local lab's)")
  }
  return { storageUrl: explicit, publicBase: explicitPublic }
}

/**
 * @param authenticated every RPC the authenticated route already serves (every contract booted before this one)
 * @param restUrl       the Torneos REST base (decides the only acceptable storage target)
 */
export function loadBrandingContract(env: Record<string, string | undefined>, authenticated: ReadonlySet<string>,
  restUrl: string, anonKey: string | null, doc: unknown = brandingDoc, publicServed: ReadonlySet<string> = new Set()): BrandingContract {
  const mode = env.TORNEOS_BRANDING_MODE ?? "off"
  if (mode === "" || mode === "off") return OFF
  if (mode !== "on") throw new BrandingConfigError("TORNEOS_BRANDING_MODE must be on or off")
  if (!doc || typeof doc !== "object" || (doc as { phase?: unknown }).phase !== "BRANDING-V1") {
    throw new BrandingConfigError("branding-v1 allowlist is not the BRANDING-V1 contract")
  }
  const features = (doc as { features?: unknown }).features
  if (!features || typeof features !== "object" || Array.isArray(features)) throw new BrandingConfigError("features section")
  const names: string[] = []
  for (const [feature, list] of Object.entries(features as Record<string, unknown>)) {
    if (!NAME.test(feature) || !Array.isArray(list) || list.length === 0) throw new BrandingConfigError(`features.${feature}`)
    for (const name of list) {
      if (typeof name !== "string" || !NAME.test(name)) throw new BrandingConfigError(`features.${feature} names`)
      names.push(name)
    }
  }
  const rpcs = new Set(names)
  if (rpcs.size !== names.length) throw new BrandingConfigError("duplicate names")
  if (names.some((name) => authenticated.has(name))) throw new BrandingConfigError("overlaps an earlier contract")
  if (names.some((name) => name.startsWith("platform_"))) throw new BrandingConfigError("platform RPCs are never served")
  if ([...BRANDING_PUBLIC_RPCS].some((name) => publicServed.has(name) || authenticated.has(name) || rpcs.has(name))) {
    throw new BrandingConfigError("public branding RPC also served elsewhere")
  }
  if ([...SIGNED_AUTHENTICATED_RPCS].some((name) => !rpcs.has(name) && !authenticated.has(name))) {
    throw new BrandingConfigError("a signed authenticated RPC is not served")
  }
  // Public signatures need the project's anon key (storage RLS: published branding only).
  if (!anonKey) throw new BrandingConfigError("TORNEOS_ANON_KEY is required to sign public branding")
  const { storageUrl, publicBase } = storageTargets(env, restUrl)
  return Object.freeze({ mode: "on", rpcs, storageUrl, publicBase })
}

/** Authenticated generic route: everything already served ∪ BRANDING-V1 (when on). */
export function withBranding(base: ReadonlySet<string>, contract: BrandingContract): ReadonlySet<string> {
  return new Set([...base, ...contract.rpcs])
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type FetchLike = (url: string, init: RequestInit) => Promise<Response>

function collectPaths(value: Json, out: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) collectPaths(item, out); return }
  if (!value || typeof value !== "object") return
  for (const [key, item] of Object.entries(value)) {
    if (key in URL_KEYS && typeof item === "string" && BRANDING_PATH.test(item)) {
      if (out.size < MAX_PATHS_PER_RESPONSE) out.add(item)
    } else {
      collectPaths(item, out)
    }
  }
}

function attachUrls(value: Json, urls: ReadonlyMap<string, string>): Json {
  if (Array.isArray(value)) return value.map((item) => attachUrls(item, urls))
  if (!value || typeof value !== "object") return value
  const out: { [key: string]: Json } = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = attachUrls(item, urls)
    const urlKey = URL_KEYS[key]
    if (urlKey && !(urlKey in value)) out[urlKey] = typeof item === "string" ? (urls.get(item) ?? null) : null
  }
  return out
}

export type BrandingPublicRequest = {
  name: string
  authorization: string | null
  apikey: string | null
  contentType: string | null
  contentLength: string | null
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null
}
export type BrandingPublicDecision = { ok: false; status: number; error: string } | { ok: true; path: string; body: string }

/** Same discipline as the other public RPCs: no credential, JSON, small body, exactly `{p_public_slug}`. */
export async function prepareBrandingPublicRpc(req: BrandingPublicRequest, contract: BrandingContract): Promise<BrandingPublicDecision> {
  if (req.authorization !== null || req.apikey !== null) return { ok: false, status: 400, error: "public route accepts no credentials" }
  if (contract.mode !== "on" || !BRANDING_PUBLIC_RPCS.has(req.name)) return { ok: false, status: 403, error: "rpc not enabled" }
  const declared = req.contentLength
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > PUBLIC_BODY_LIMIT)) return { ok: false, status: 413, error: "body too large" }
  if (!/^application\/json(;|$)/i.test((req.contentType ?? "").trim())) return { ok: false, status: 415, error: "json required" }
  const raw = await readLimited(req.body, Number(declared ?? PUBLIC_BODY_LIMIT), PUBLIC_BODY_LIMIT, false)
  if (raw === null) return { ok: false, status: 413, error: "body too large" }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return { ok: false, status: 400, error: "invalid json" } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, status: 400, error: "invalid json" }
  const keys = Object.keys(parsed as Record<string, unknown>)
  const slug = (parsed as Record<string, unknown>).p_public_slug
  if (keys.length !== 1 || keys[0] !== "p_public_slug" || typeof slug !== "string" || !PUBLIC_SLUG.test(slug)) {
    return { ok: false, status: 400, error: "invalid arguments" }
  }
  return { ok: true, path: `/rpc/${req.name}`, body: JSON.stringify({ p_public_slug: slug }) }
}

/** get_public_tournament_branding, signed and projected: names and logos only. */
export function projectPublicBranding(raw: Uint8Array): Uint8Array {
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return raw }
  if (!payload || typeof payload !== "object") return new TextEncoder().encode("null")
  const pick = (value: unknown) => {
    if (!value || typeof value !== "object") return null
    const { name, logoPath, logoUrl } = value as Record<string, unknown>
    return { name: typeof name === "string" ? name : null, logoPath: typeof logoPath === "string" ? logoPath : null,
      logoUrl: typeof logoUrl === "string" ? logoUrl : null }
  }
  const { organization, tournament } = payload as Record<string, unknown>
  return new TextEncoder().encode(JSON.stringify({ organization: pick(organization), tournament: pick(tournament) }))
}

/**
 * The anon credential of the Torneos project for storage: a publishable key (hosted, not a JWT) travels only as
 * `apikey` and the platform runs the request as anon; a legacy anon JWT (the local lab) is also the bearer.
 */
export function anonCredential(anonKey: string): { bearer: string | null; apikey: string | null } {
  const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(anonKey)
  return { bearer: jwt ? anonKey : null, apikey: anonKey }
}

/** One storage call per response: the signed URL of every branding path in it (refused or failed paths: absent). */
export async function signPaths(paths: readonly string[], contract: BrandingContract, credential: { bearer: string | null; apikey: string | null },
  fetchImpl: FetchLike = fetch): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (contract.mode !== "on" || paths.length === 0) return urls
  let response: Response
  try {
    response = await fetchImpl(`${contract.storageUrl}/object/sign/${BRANDING_BUCKET}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(credential.bearer ? { authorization: `Bearer ${credential.bearer}` } : {}),
        ...(credential.apikey ? { apikey: credential.apikey } : {}) },
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL, paths }),
      redirect: "error", signal: AbortSignal.timeout(3000),
    })
  } catch {
    return urls
  }
  if (response.status !== 200) { await response.body?.cancel(); return urls }
  let entries: unknown
  try { entries = await response.json() } catch { return urls }
  if (!Array.isArray(entries)) return urls
  const prefix = `/object/sign/${BRANDING_BUCKET}/`
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const { path, signedURL, error } = entry as { path?: unknown; signedURL?: unknown; error?: unknown }
    if (error || typeof path !== "string" || !paths.includes(path) || typeof signedURL !== "string") continue
    // Exactly this object of this bucket, with storage's own token and nothing else.
    if (!signedURL.startsWith(`${prefix}${path}?token=`) || /[\s"<>]/.test(signedURL)) continue
    urls.set(path, `${contract.publicBase}${signedURL}`)
  }
  return urls
}

/** A JSON response body with a signed URL next to each branding path; anything unparsable is returned unchanged. */
export async function signResponseBody(raw: Uint8Array, contract: BrandingContract, credential: { bearer: string | null; apikey: string | null },
  fetchImpl: FetchLike = fetch): Promise<Uint8Array> {
  if (contract.mode !== "on") return raw
  let payload: Json
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return raw }
  const paths = new Set<string>()
  collectPaths(payload, paths)
  const urls = await signPaths([...paths], contract, credential, fetchImpl)
  return new TextEncoder().encode(JSON.stringify(attachUrls(payload, urls)))
}

export type BrandingObjectRequest = {
  method: string
  path: string
  contentType: string | null
  contentLength: string | null
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null
}
export type BrandingObjectResult = { status: number; body: Record<string, unknown> }

async function readLimited(body: BrandingObjectRequest["body"], declared: number, max = BRANDING_MAX_BYTES,
  exact = true): Promise<Uint8Array | null> {
  if (!body) return exact ? null : new TextEncoder().encode("{}")
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
  if (exact && size !== declared) return null
  if (!exact && size === 0) return new TextEncoder().encode("{}")
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

/**
 * Stores (POST) or removes (DELETE) ONE versioned branding object with the caller's own bridge token. The gateway
 * decides nothing about permissions: storage RLS runs can_write_tournament_branding_object for that identity.
 * Objects are immutable (no upsert); the reference switch is set_tournament_branding_reference on the RPC route.
 */
export async function brandingObject(request: BrandingObjectRequest, contract: BrandingContract, bearerToken: string,
  apikey: string | null, fetchImpl: FetchLike = fetch): Promise<BrandingObjectResult> {
  if (contract.mode !== "on") return { status: 404, body: { error: "not found" } }
  if (!BRANDING_PATH.test(request.path)) return { status: 400, body: { error: "TORNEOS_BRANDING_INVALID_REFERENCE" } }
  const target = `${contract.storageUrl}/object/${BRANDING_BUCKET}/${request.path}`
  const auth = { authorization: `Bearer ${bearerToken}`, ...(apikey ? { apikey } : {}) }
  if (request.method === "DELETE") {
    const response = await fetchImpl(target, { method: "DELETE", headers: auth, redirect: "error", signal: AbortSignal.timeout(5000) })
    await response.body?.cancel()
    if (response.status === 200) return { status: 200, body: { removed: true } }
    if (response.status >= 500) return { status: 503, body: { error: "storage unavailable" } }
    return { status: 404, body: { error: "TORNEOS_BRANDING_OBJECT_NOT_REMOVED" } }
  }
  if (request.method !== "POST") return { status: 405, body: { error: "method not allowed" } }
  const extension = request.path.slice(request.path.lastIndexOf(".") + 1)
  const mime = MIME_BY_EXTENSION[extension]
  if ((request.contentType ?? "").split(";")[0].trim().toLowerCase() !== mime) {
    return { status: 415, body: { error: "TORNEOS_BRANDING_INVALID_TYPE" } }
  }
  const declared = /^[0-9]{1,8}$/.test(request.contentLength ?? "") ? Number(request.contentLength) : -1
  if (declared <= 0 || declared > BRANDING_MAX_BYTES) return { status: 413, body: { error: "TORNEOS_BRANDING_TOO_LARGE" } }
  const bytes = await readLimited(request.body, declared)
  if (!bytes) return { status: 413, body: { error: "TORNEOS_BRANDING_TOO_LARGE" } }
  const response = await fetchImpl(target, {
    method: "POST",
    headers: { ...auth, "content-type": mime, "cache-control": "max-age=31536000", "x-upsert": "false" },
    body: bytes, redirect: "error", signal: AbortSignal.timeout(10000),
  })
  await response.body?.cancel()
  if (response.status === 200) return { status: 200, body: { path: request.path } }
  if (response.status >= 500) return { status: 503, body: { error: "storage unavailable" } }
  if (response.status === 409) return { status: 409, body: { error: "TORNEOS_BRANDING_OBJECT_EXISTS" } }
  // RLS refusal (storage answers 400/403 for "new row violates row-level security policy").
  return { status: 403, body: { error: "TORNEOS_BRANDING_FORBIDDEN" } }
}
