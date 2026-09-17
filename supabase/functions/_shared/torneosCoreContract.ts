// supabase/functions/_shared/torneosCoreContract.ts
//
// Pure, runtime-agnostic pieces of the Core → Torneos contract v1 endpoint
// (Phase 3A): service-request authentication, closed request schemas, signed
// pagination cursors and the response shaping the SQL entry point relies on.
// Everything here uses WebCrypto only, so the same code is exercised by the
// Deno function and by the Node unit harness in scripts/edge-functions/.
//
// Wire contract (backend/torneos/phase2a/CONTRACTS.md, schemas.json; Phase 3B session op:
// backend/torneos/phase3b/contracts/session.schema.json):
//   POST /v1/verified-email | /v1/directory | /v1/team-snapshot | /v1/session
//   Headers X-Time (unix seconds), X-Nonce (32 hex), X-Signature (hex HMAC-SHA256
//   over `path + "\n" + X-Time + "\n" + X-Nonce + "\n" + body`), ±30 s window.
//   Errors are `{ "error": "CODE" }`; every response is `Cache-Control: no-store`.

export const CONTRACT_ROUTES: Record<string, string> = {
  "/v1/verified-email": "verified_email",
  "/v1/directory": "directory",
  "/v1/team-snapshot": "team_snapshot",
  // Phase 3B (v1.1): the Core session authority verdict on its own, for the hosted
  // Torneos gateway's per-request online revocation check (Core only over HTTPS).
  "/v1/session": "session",
}

export const MAX_BODY_BYTES = 16384
export const TIME_WINDOW_SECONDS = 30
export const CURSOR_TTL_SECONDS = 60
export const MAX_CURSOR_LENGTH = 2048

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX32_RE = /^[0-9a-f]{32}$/
const HEX64_RE = /^[0-9a-f]{64}$/
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+$/

export class ContractError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function hmacKey(secret: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, usages)
}

/**
 * The service secret is a hex string of at least 32 bytes. A missing or short
 * secret disables the endpoint (fail closed) instead of degrading to a guess.
 */
export function parseServiceSecret(raw: string | undefined): Uint8Array | null {
  const value = (raw ?? "").trim()
  if (!/^[0-9a-f]{64,}$/.test(value) || value.length % 2 !== 0) return null
  return fromHex(value)
}

/** Derived key so pagination cursors never reuse the request-signing key directly. */
export async function deriveCursorKey(secret: Uint8Array): Promise<Uint8Array> {
  const key = await hmacKey(secret, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("torneos-core-contract:cursor:v1")))
}

/** Resolves the contract route from the request path, tolerating the gateway mount prefix. */
export function contractPath(pathname: string, functionName: string): string | null {
  let path = pathname
  if (path.startsWith("/functions/v1/")) path = path.slice("/functions/v1".length)
  const mount = `/${functionName}`
  if (path === mount) return null
  if (path.startsWith(`${mount}/`)) path = path.slice(mount.length)
  return path in CONTRACT_ROUTES ? path : null
}

export type ServiceAuthHeaders = {
  time: string | null
  nonce: string | null
  signature: string | null
}

/**
 * Verifies the service authentication of one request. Nonce uniqueness is NOT
 * enforced here: the SQL entry point consumes it inside the same transaction as
 * the evaluation, so a replay is rejected durably and atomically.
 */
export async function verifyServiceAuth(
  secret: Uint8Array,
  path: string,
  headers: ServiceAuthHeaders,
  body: Uint8Array,
  nowSeconds: number,
): Promise<{ nonce: string }> {
  const { time, nonce, signature } = headers
  if (!time || !nonce || !signature) throw new ContractError(401, "SERVICE_AUTH_REQUIRED")
  if (!/^[0-9]{1,12}$/.test(time) || !HEX32_RE.test(nonce) || !HEX64_RE.test(signature)) {
    throw new ContractError(401, "SERVICE_AUTH_REQUIRED")
  }
  if (Math.abs(nowSeconds - Number(time)) > TIME_WINDOW_SECONDS) {
    throw new ContractError(401, "SERVICE_AUTH_REQUIRED")
  }
  const signed = new Uint8Array(path.length + time.length + nonce.length + 3 + body.length)
  let offset = 0
  for (const part of [encoder.encode(path), encoder.encode("\n"), encoder.encode(time), encoder.encode("\n"), encoder.encode(nonce), encoder.encode("\n")]) {
    signed.set(part, offset)
    offset += part.length
  }
  signed.set(body, offset)
  const key = await hmacKey(secret, ["verify"])
  // WebCrypto's verify is constant-time; never compare hex strings ourselves.
  const ok = await crypto.subtle.verify("HMAC", key, fromHex(signature), signed)
  if (!ok) throw new ContractError(401, "SERVICE_AUTH_REQUIRED")
  return { nonce }
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

function exactKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractError(400, "INVALID_REQUEST")
  const present = Object.keys(value as Record<string, unknown>).sort()
  const expected = [...keys].sort()
  if (present.length !== expected.length || present.some((k, i) => k !== expected[i])) {
    throw new ContractError(400, "INVALID_REQUEST")
  }
  return value as Record<string, unknown>
}

export type ValidatedRequest = {
  operation: string
  coreUserId: string
  sessionId: string
  sqlRequest: Record<string, unknown>
  directory?: { kind: "players" | "teams"; query: string; limit: number; cursor: string | null }
}

/**
 * Closed request schemas. Every declared property is required and nothing else is
 * accepted. UUIDs must be canonical lowercase. The SQL entry point re-validates.
 */
export function validateRequest(path: string, raw: unknown): ValidatedRequest {
  const operation = CONTRACT_ROUTES[path]
  if (!operation) throw new ContractError(404, "NOT_FOUND")
  if (operation === "session") {
    const r = exactKeys(raw, ["core_user_id", "session_id"])
    if (!isCanonicalUuid(r.core_user_id) || !isCanonicalUuid(r.session_id)) throw new ContractError(400, "INVALID_REQUEST")
    return { operation, coreUserId: r.core_user_id, sessionId: r.session_id, sqlRequest: { core_user_id: r.core_user_id, session_id: r.session_id } }
  }
  if (operation === "verified_email") {
    const r = exactKeys(raw, ["core_user_id", "session_id", "expected_email"])
    if (!isCanonicalUuid(r.core_user_id) || !isCanonicalUuid(r.session_id)) throw new ContractError(400, "INVALID_REQUEST")
    const email = r.expected_email
    if (typeof email !== "string" || email.length < 3 || email.length > 254 || !EMAIL_SHAPE_RE.test(email)) {
      throw new ContractError(400, "INVALID_REQUEST")
    }
    return { operation, coreUserId: r.core_user_id, sessionId: r.session_id, sqlRequest: { core_user_id: r.core_user_id, session_id: r.session_id, expected_email: email } }
  }
  if (operation === "directory") {
    const r = exactKeys(raw, ["core_user_id", "session_id", "kind", "query", "limit", "cursor"])
    if (!isCanonicalUuid(r.core_user_id) || !isCanonicalUuid(r.session_id)) throw new ContractError(400, "INVALID_REQUEST")
    if (r.kind !== "players" && r.kind !== "teams") throw new ContractError(400, "INVALID_REQUEST")
    if (typeof r.query !== "string" || r.query.length < 2 || r.query.length > 100) throw new ContractError(400, "INVALID_REQUEST")
    if (typeof r.limit !== "number" || !Number.isInteger(r.limit) || r.limit < 1 || r.limit > 12) throw new ContractError(400, "INVALID_REQUEST")
    if (r.cursor !== null && (typeof r.cursor !== "string" || r.cursor.length < 1 || r.cursor.length > MAX_CURSOR_LENGTH)) {
      throw new ContractError(400, "INVALID_REQUEST")
    }
    return {
      operation,
      coreUserId: r.core_user_id,
      sessionId: r.session_id,
      directory: { kind: r.kind, query: r.query, limit: r.limit, cursor: r.cursor as string | null },
      sqlRequest: { core_user_id: r.core_user_id, session_id: r.session_id, kind: r.kind, query: r.query, limit: r.limit, after: null },
    }
  }
  const r = exactKeys(raw, ["core_user_id", "session_id", "core_team_id"])
  if (!isCanonicalUuid(r.core_user_id) || !isCanonicalUuid(r.session_id) || !isCanonicalUuid(r.core_team_id)) {
    throw new ContractError(400, "INVALID_REQUEST")
  }
  return { operation, coreUserId: r.core_user_id, sessionId: r.session_id, sqlRequest: { core_user_id: r.core_user_id, session_id: r.session_id, core_team_id: r.core_team_id } }
}

/** Case-folded, accent-stripped query used only to bind a cursor to its search. */
export function foldQuery(query: string): string {
  return query.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
}

export type CursorBinding = [string, string, string, string, number]

function cursorBinding(request: ValidatedRequest): CursorBinding {
  const d = request.directory!
  return [request.coreUserId, request.sessionId, d.kind, foldQuery(d.query), d.limit]
}

function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/**
 * Cursors bind user, Core session, kind, folded query, page size and the last UUID,
 * expire after 60 s and are HMAC-protected (authenticated, not encrypted).
 */
export async function encodeCursor(cursorKey: Uint8Array, request: ValidatedRequest, after: string, nowSeconds: number): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify({ binding: cursorBinding(request), after, expires_at: nowSeconds + CURSOR_TTL_SECONDS })))
  const key = await hmacKey(cursorKey, ["sign"])
  return `${payload}.${hex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))}`
}

export async function decodeCursor(cursorKey: Uint8Array, request: ValidatedRequest, cursor: string, nowSeconds: number): Promise<string> {
  const parts = cursor.split(".")
  if (parts.length !== 2 || !HEX64_RE.test(parts[1])) throw new ContractError(400, "INVALID_CURSOR")
  const key = await hmacKey(cursorKey, ["verify"])
  const ok = await crypto.subtle.verify("HMAC", key, fromHex(parts[1]), encoder.encode(parts[0]))
  if (!ok) throw new ContractError(400, "INVALID_CURSOR")
  let decoded: { binding?: unknown; after?: unknown; expires_at?: unknown }
  try {
    decoded = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])))
  } catch {
    throw new ContractError(400, "INVALID_CURSOR")
  }
  const binding = cursorBinding(request)
  if (!Array.isArray(decoded.binding) || decoded.binding.length !== binding.length ||
      decoded.binding.some((v, i) => v !== binding[i]) ||
      typeof decoded.expires_at !== "number" || decoded.expires_at <= nowSeconds ||
      !isCanonicalUuid(decoded.after)) {
    throw new ContractError(400, "INVALID_CURSOR")
  }
  return decoded.after
}

export type SqlVerdict = { status: number; body: Record<string, unknown> }

/** The SQL entry point answers `{status, body}`; anything else is an infrastructure fault. */
export function parseSqlVerdict(data: unknown): SqlVerdict {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ContractError(503, "CORE_UNAVAILABLE")
  const verdict = data as Record<string, unknown>
  if (typeof verdict.status !== "number" || !verdict.body || typeof verdict.body !== "object") {
    throw new ContractError(503, "CORE_UNAVAILABLE")
  }
  return { status: verdict.status, body: verdict.body as Record<string, unknown> }
}

/** Turns the SQL directory page (`items`, `has_more`) into the wire response (`items`, `next_cursor`). */
export async function shapeDirectoryResponse(
  cursorKey: Uint8Array, request: ValidatedRequest, body: Record<string, unknown>, nowSeconds: number,
): Promise<Record<string, unknown>> {
  const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : []
  const idField = request.directory!.kind === "players" ? "core_user_id" : "core_team_id"
  let nextCursor: string | null = null
  if (body.has_more === true && items.length > 0) {
    const last = items[items.length - 1][idField]
    if (!isCanonicalUuid(last)) throw new ContractError(503, "CORE_UNAVAILABLE")
    nextCursor = await encodeCursor(cursorKey, request, last, nowSeconds)
  }
  return { items, next_cursor: nextCursor }
}

export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

/** Reads at most MAX_BODY_BYTES; larger or unknown-length bodies are rejected. */
export async function readBoundedBody(req: Request): Promise<Uint8Array> {
  const declared = req.headers.get("content-length")
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new ContractError(413, "INVALID_REQUEST")
  }
  if (!req.body) throw new ContractError(400, "INVALID_REQUEST")
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = req.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new ContractError(413, "INVALID_REQUEST")
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  if (out.length === 0) throw new ContractError(400, "INVALID_REQUEST")
  return out
}

export type SqlExecutor = (operation: string, nonce: string, request: Record<string, unknown>) => Promise<unknown>

/**
 * Full request pipeline, independent of the HTTP server and of supabase-js:
 * auth → schema → cursor → SQL → shaping. `execute` is the only side effect.
 */
export async function handleContractRequest(
  req: Request,
  options: { functionName: string; secret: Uint8Array | null; execute: SqlExecutor; now?: () => number },
): Promise<Response> {
  const nowSeconds = options.now ? options.now() : Math.floor(Date.now() / 1000)
  try {
    if (!options.secret) throw new ContractError(503, "CORE_UNAVAILABLE")
    const path = contractPath(new URL(req.url).pathname, options.functionName)
    if (!path) throw new ContractError(404, "NOT_FOUND")
    if (req.method !== "POST") throw new ContractError(404, "NOT_FOUND")
    const body = await readBoundedBody(req)
    const { nonce } = await verifyServiceAuth(options.secret, path, {
      time: req.headers.get("x-time"),
      nonce: req.headers.get("x-nonce"),
      signature: req.headers.get("x-signature"),
    }, body, nowSeconds)
    let raw: unknown
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
    } catch {
      throw new ContractError(400, "INVALID_REQUEST")
    }
    const request = validateRequest(path, raw)
    let cursorKey: Uint8Array | null = null
    if (request.directory) {
      cursorKey = await deriveCursorKey(options.secret)
      if (request.directory.cursor !== null) {
        request.sqlRequest.after = await decodeCursor(cursorKey, request, request.directory.cursor, nowSeconds)
      }
    }
    let verdict: SqlVerdict
    try {
      verdict = parseSqlVerdict(await options.execute(request.operation, nonce, request.sqlRequest))
    } catch (error) {
      if (error instanceof ContractError) throw error
      throw new ContractError(503, "CORE_UNAVAILABLE")
    }
    if (verdict.status !== 200) return jsonResponse(verdict.status, verdict.body)
    if (request.directory) {
      return jsonResponse(200, await shapeDirectoryResponse(cursorKey!, request, verdict.body, nowSeconds))
    }
    return jsonResponse(200, verdict.body)
  } catch (error) {
    if (error instanceof ContractError) return jsonResponse(error.status, { error: error.code })
    // Never log the request, headers, body or the underlying error (it may echo them).
    console.error("[TORNEOS_CORE_CONTRACT] request failed")
    return jsonResponse(503, { error: "CORE_UNAVAILABLE" })
  }
}
