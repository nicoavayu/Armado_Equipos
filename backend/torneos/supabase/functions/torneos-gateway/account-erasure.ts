// torneos-gateway/account-erasure.ts — ACCOUNT ERASURE (0021): the ONLY Core → Torneos calls. When a person deletes their
// Arma2 account, Core's `delete-account` function (server side, after verifying the person's own session):
//   1. asks this gateway to ERASE what Torneos holds about that Core user, BEFORE it deletes anything in Core;
//   2. deletes its own account;
//   3. CONFIRMS here that the Core account is gone (sweep + ledger torneos_erased → core_confirmed).
// The two databases are separate: there is no transaction across them. If Core fails between 1 and 3, the Torneos part
// (irreversible) stays done, the ledger row stays torneos_erased, the person's retry gets already_erased and lets Core
// finish; the operator's reconcile query lists what Core never confirmed (backend/torneos/account-deletion-v1/README.md).
//
// The database work runs ONLY through the dedicated erasure login (TORNEOS_DB_ERASURE_WRITER_URL → torneos_erasure_writer,
// EXECUTE on the two erasure functions and nothing else), never through the core adapter's or the identity writer's.
// Without that login configured both routes answer 503 after authenticating the request (fail closed: Core keeps the
// account and the person can retry); the rest of the gateway is unaffected.
//
// Wire contract (mirror of supabase/functions/_shared/torneosAccountErasure.ts):
//   POST <gateway>/core/v1/account-erasure            body {"core_user_id": <uuid>, "request_id": <uuid>} (exactly these keys)
//   POST <gateway>/core/v1/account-erasure/confirm    same body, after Core deleted its account
//   X-Time (unix s), X-Nonce (32 hex), X-Signature = hex HMAC-SHA256(K, path + "\n" + time + "\n" + nonce + "\n" + body),
//   K = HMAC-SHA256(TORNEOS_CONTRACT_SERVICE_SECRET, "torneos-core-contract:account-erasure:v1") — the secret both sides
//   already hold for the Torneos → Core contract, under a key derived for this direction only (a captured Torneos → Core
//   request can never be replayed here, nor the opposite; the path is signed, so an erase can never pass as a confirm).
//   This HMAC key authenticates CORE; it is not a database credential (the erasure login's password is a separate secret).
//   ±30 s window. No nonce store: a replay inside the window can only repeat the same idempotent call.
//   request_id = Core's idempotency key for this account deletion (the same on every retry). Browsers are refused (an
//   Origin header = 403).
//   200 {"ok":true,"outcome":"erased"|"already_erased"|"no_identity"} (erase) / {"ok":true,"outcome":"core_confirmed"|"no_ledger"}
//   (confirm) · 400 INVALID_REQUEST · 401 SERVICE_AUTH_REQUIRED · 503 TORNEOS_UNAVAILABLE (database down, the erasure
//   refused, or the erasure login not configured: retryable from Core's side).
// The core_user_id comes ONLY from Core's signed body (Core takes it from the verified session, never from the client).
// Nothing about the request, the user or the result is logged here.
import { fromHex } from "./core-client.ts"
import { runErasure, type Sql } from "./db.ts"

export const ACCOUNT_ERASURE_ROUTE = "/core/v1/account-erasure"
export const ACCOUNT_ERASURE_CONFIRM_ROUTE = "/core/v1/account-erasure/confirm"
export const ERASURE_KEY_LABEL = "torneos-core-contract:account-erasure:v1"
export const ERASURE_WINDOW_SECONDS = 30
export const OUTCOMES: readonly string[] = Object.freeze(["erased", "already_erased", "no_identity"])
export const CONFIRM_OUTCOMES: readonly string[] = Object.freeze(["core_confirmed", "no_ledger"])
const ROUTES = Object.freeze({
  [ACCOUNT_ERASURE_ROUTE]: { call: "erase" as const, outcomes: OUTCOMES },
  [ACCOUNT_ERASURE_CONFIRM_ROUTE]: { call: "confirm" as const, outcomes: CONFIRM_OUTCOMES },
})
export type ErasureRoute = keyof typeof ROUTES
export const isErasureRoute = (path: string): path is ErasureRoute => Object.hasOwn(ROUTES, path)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const encoder = new TextEncoder()
const MAX_BODY = 512

export type ErasureResult = { status: number; body: Record<string, unknown> }

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** The direction-specific key: never the raw contract secret. */
export async function deriveErasureKey(secret: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ERASURE_KEY_LABEL)))
}

async function verifySignature(key: Uint8Array, route: ErasureRoute, time: string, nonce: string, signature: string, body: Uint8Array): Promise<boolean> {
  const prefix = encoder.encode(`${route}\n${time}\n${nonce}\n`)
  const signed = new Uint8Array(prefix.length + body.length)
  signed.set(prefix, 0)
  signed.set(body, prefix.length)
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
  // WebCrypto's verify is constant-time; never compare hex strings ourselves.
  return await crypto.subtle.verify("HMAC", k, fromHex(signature) as BufferSource, signed)
}

async function readBody(stream: ReadableStream<Uint8Array> | null, declared: string | null): Promise<Uint8Array | null> {
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BODY)) return null
  if (!stream) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_BODY) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

export type ErasureRequest = {
  origin: string | null
  contentType: string | null
  contentLength: string | null
  time: string | null
  nonce: string | null
  signature: string | null
  body: ReadableStream<Uint8Array> | null
}

/**
 * Verifies Core's signature for `route`, then erases or confirms. `key` = deriveErasureKey(contract secret); `sql` = the
 * dedicated erasure login, or null when TORNEOS_DB_ERASURE_WRITER_URL is not configured (→ 503 after authentication).
 * `now` in unix seconds (injected by tests).
 */
export async function accountErasure(request: ErasureRequest, key: Uint8Array, sql: Sql | null, now = Date.now() / 1000,
  route: ErasureRoute = ACCOUNT_ERASURE_ROUTE): Promise<ErasureResult> {
  const denied: ErasureResult = { status: 401, body: { error: "SERVICE_AUTH_REQUIRED" } }
  const target = ROUTES[route]
  if (!target) return { status: 404, body: { error: "not found" } }
  if (request.origin !== null) return { status: 403, body: { error: "origin rejected" } }
  const { time, nonce, signature } = request
  if (!time || !nonce || !signature || !/^[0-9]{1,12}$/.test(time) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return denied
  if (Math.abs(now - Number(time)) > ERASURE_WINDOW_SECONDS) return denied
  if (!/^application\/json(;\s*charset=utf-8)?$/i.test(request.contentType ?? "")) return { status: 400, body: { error: "INVALID_REQUEST" } }
  const raw = await readBody(request.body, request.contentLength)
  if (raw === null) return { status: 400, body: { error: "INVALID_REQUEST" } }
  if (!(await verifySignature(key, route, time, nonce, signature, raw))) return denied
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return { status: 400, body: { error: "INVALID_REQUEST" } } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: 400, body: { error: "INVALID_REQUEST" } }
  const fields = parsed as Record<string, unknown>
  const keys = Object.keys(fields).sort()
  if (keys.length !== 2 || keys[0] !== "core_user_id" || keys[1] !== "request_id"
    || typeof fields.core_user_id !== "string" || !UUID_RE.test(fields.core_user_id)
    || typeof fields.request_id !== "string" || !UUID_RE.test(fields.request_id)) {
    return { status: 400, body: { error: "INVALID_REQUEST" } }
  }
  // Fail closed: no dedicated erasure login → nothing runs (never a fallback to another login).
  if (sql === null) return { status: 503, body: { error: "TORNEOS_UNAVAILABLE" } }
  try {
    const result = await runErasure(sql, target.call, fields.core_user_id, fields.request_id)
    const outcome = (result as { outcome?: unknown })?.outcome
    if (typeof outcome !== "string" || !target.outcomes.includes(outcome)) return { status: 503, body: { error: "TORNEOS_UNAVAILABLE" } }
    return { status: 200, body: { ok: true, outcome } }
  } catch {
    // Unavailable, lock timeout, a refused postcondition: all retryable from Core's side, none of them reveals anything.
    return { status: 503, body: { error: "TORNEOS_UNAVAILABLE" } }
  }
}
