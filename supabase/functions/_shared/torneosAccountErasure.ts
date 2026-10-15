// supabase/functions/_shared/torneosAccountErasure.ts
//
// ACCOUNT ERASURE (Torneos 0021): Core's side of the only Core → Torneos call. `delete-account` asks the Torneos gateway
// to erase what Torneos holds about the user BEFORE Core deletes anything (fail-closed: if Torneos cannot confirm, the
// Core account is kept and the person can retry; the Torneos erasure is idempotent).
//
// Wire contract (mirror of backend/torneos/supabase/functions/torneos-gateway/account-erasure.ts):
//   POST ${TORNEOS_GATEWAY_URL}/core/v1/account-erasure   body {"core_user_id","request_id"}
//   X-Time / X-Nonce / X-Signature = hex HMAC-SHA256(K, path + "\n" + time + "\n" + nonce + "\n" + body),
//   K = HMAC-SHA256(TORNEOS_CONTRACT_SERVICE_SECRET, "torneos-core-contract:account-erasure:v1").
// TORNEOS_CONTRACT_SERVICE_SECRET is the secret Core already holds for torneos-core-contract (no new secret); the key is
// derived for this direction only. TORNEOS_GATEWAY_URL is the gateway's public URL (configuration, not a secret).
// The core_user_id is the id of the session Core just verified: never a value from the client.
// WebCrypto only: the same module runs in Deno and in the Node unit harness. Nothing is logged here.

export const ACCOUNT_ERASURE_ROUTE = "/core/v1/account-erasure"
export const ERASURE_KEY_LABEL = "torneos-core-contract:account-erasure:v1"
export const ERASURE_TIMEOUT_MS = 20000
export const OUTCOMES: readonly string[] = Object.freeze(["erased", "already_erased", "no_identity"])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LOOPBACK = new Set(["127.0.0.1", "localhost", "torneos-functions"])
const encoder = new TextEncoder()

export type ErasureOutcome = { ok: true; outcome: string } | { ok: false; code: string; retryable: boolean }

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes as ArrayBuffer), (b) => b.toString(16).padStart(2, "0")).join("")
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Hex secret of at least 32 bytes, or null (fail closed). Same rule as torneos-core-contract. */
export function parseSecret(raw: string | undefined): Uint8Array | null {
  const value = (raw ?? "").trim()
  if (!/^[0-9a-f]{64,}$/.test(value) || value.length % 2 !== 0) return null
  return fromHex(value)
}

/** https only (plain http only for a loopback lab host); no credentials, query or fragment. Trailing slash dropped. */
export function parseGatewayUrl(raw: string | undefined): string | null {
  const value = (raw ?? "").trim()
  if (!value) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.username || url.password || url.search || url.hash) return null
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) return null
  return url.href.replace(/\/$/, "")
}

export async function deriveErasureKey(secret: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ERASURE_KEY_LABEL)))
}

export async function signErasure(key: Uint8Array, time: string, nonce: string, body: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const prefix = encoder.encode(`${ACCOUNT_ERASURE_ROUTE}\n${time}\n${nonce}\n`)
  const signed = new Uint8Array(prefix.length + body.length)
  signed.set(prefix, 0)
  signed.set(body, prefix.length)
  return hex(await crypto.subtle.sign("HMAC", k, signed))
}

export type ErasureEnv = { get(name: string): string | undefined }

/**
 * Asks Torneos to erase the account of `coreUserId`. Never throws: { ok: true, outcome } only for a signed 200 with a
 * known outcome; anything else is { ok: false } (unconfigured, refused, unreachable, timeout, unexpected answer).
 * One retry on a transport failure or a 503, with a fresh nonce (the erasure is idempotent).
 */
export async function requestTorneosAccountErasure(options: {
  env: ErasureEnv
  coreUserId: string
  requestId?: string
  fetchImpl?: typeof fetch
  clock?: () => number
}): Promise<ErasureOutcome> {
  const gateway = parseGatewayUrl(options.env.get("TORNEOS_GATEWAY_URL"))
  const secret = parseSecret(options.env.get("TORNEOS_CONTRACT_SERVICE_SECRET"))
  if (!gateway || !secret) return { ok: false, code: "torneos_erasure_unconfigured", retryable: false }
  if (!UUID_RE.test(options.coreUserId)) return { ok: false, code: "torneos_erasure_invalid_user", retryable: false }
  const requestId = options.requestId ?? crypto.randomUUID()
  const fetchImpl = options.fetchImpl ?? fetch
  const clock = options.clock ?? (() => Date.now() / 1000)
  const key = await deriveErasureKey(secret)
  const body = encoder.encode(JSON.stringify({ core_user_id: options.coreUserId, request_id: requestId }))
  let last: ErasureOutcome = { ok: false, code: "torneos_erasure_unavailable", retryable: true }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const time = String(Math.floor(clock()))
    const nonce = hex(crypto.getRandomValues(new Uint8Array(16)))
    const signature = await signErasure(key, time, nonce, body)
    let response: Response
    try {
      response = await fetchImpl(`${gateway}${ACCOUNT_ERASURE_ROUTE}`, {
        method: "POST", body, redirect: "error", signal: AbortSignal.timeout(ERASURE_TIMEOUT_MS),
        headers: { "content-type": "application/json", "x-time": time, "x-nonce": nonce, "x-signature": signature },
      })
    } catch {
      last = { ok: false, code: "torneos_erasure_unavailable", retryable: true }
      continue
    }
    let payload: unknown = null
    try { payload = await response.json() } catch { payload = null }
    if (response.status === 200) {
      const outcome = (payload as { ok?: unknown; outcome?: unknown } | null)
      if (outcome?.ok === true && typeof outcome.outcome === "string" && OUTCOMES.includes(outcome.outcome)) return { ok: true, outcome: outcome.outcome }
      return { ok: false, code: "torneos_erasure_unexpected", retryable: true }
    }
    if (response.status === 503 || response.status >= 500) {
      last = { ok: false, code: "torneos_erasure_unavailable", retryable: true }
      continue
    }
    // 4xx: misconfiguration (secret, URL, clock): never retried here, never silently ignored.
    return { ok: false, code: "torneos_erasure_refused", retryable: false }
  }
  return last
}
