// torneos-payments/hmac.ts — authentication of the internal caller (the Torneos gateway).
//
//   X-Time:      unix seconds, within ±30 s of the service clock
//   X-Nonce:     1–128 chars [A-Za-z0-9._:-], never accepted twice while its timestamp is in the window
//   X-Signature: lowercase hex HMAC-SHA-256(TORNEOS_PAYMENTS_INTERNAL_SECRET, manifest)
//   manifest  =  route path + "\n" + X-Time + "\n" + X-Nonce + "\n" + exact request body
//
// The route path is the function-relative path (/internal/v1/season-checkout-preference): identical under
// /functions/v1/torneos-payments on the platform and under the lab router. The body is the exact byte
// sequence received (decoded as strict UTF-8). Comparison is constant-time over equal-length inputs. The
// replay cache is per isolate (best effort across instances); the endpoint is idempotent per purchase.
export const INTERNAL_WINDOW_S = 30
const NONCE_RE = /^[A-Za-z0-9._:-]{1,128}$/
const SIGNATURE_RE = /^[0-9a-f]{64}$/
const NONCE_CACHE_MAX = 10_000

export type InternalVerdict = "ok" | "missing_headers" | "bad_time" | "stale" | "bad_nonce" | "bad_signature" | "replay"

export class NonceCache {
  seen = new Map<string, number>()
  has(nonce: string, nowS: number): boolean {
    const until = this.seen.get(nonce)
    return until !== undefined && until >= nowS
  }
  remember(nonce: string, nowS: number): void {
    for (const [key, until] of this.seen) {
      if (until >= nowS && this.seen.size < NONCE_CACHE_MAX) break
      this.seen.delete(key)
    }
    this.seen.set(nonce, nowS + 2 * INTERNAL_WINDOW_S + 1)
  }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("")
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return difference === 0
}

export async function signInternal(secret: Uint8Array, path: string, time: string, nonce: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${path}\n${time}\n${nonce}\n${body}`)))
}

export async function verifyInternalRequest(input: {
  secret: Uint8Array
  path: string
  time: string | null
  nonce: string | null
  signature: string | null
  body: string
  nowS: number
  nonces: NonceCache
}): Promise<InternalVerdict> {
  const { time, nonce, signature } = input
  if (time === null || nonce === null || signature === null) return "missing_headers"
  if (!/^\d{1,12}$/.test(time)) return "bad_time"
  if (Math.abs(input.nowS - Number(time)) > INTERNAL_WINDOW_S) return "stale"
  if (!NONCE_RE.test(nonce)) return "bad_nonce"
  if (!SIGNATURE_RE.test(signature)) return "bad_signature"
  const expected = await signInternal(input.secret, input.path, time, nonce, input.body)
  if (!constantTimeEqual(expected, signature)) return "bad_signature"
  // Only authenticated nonces enter the cache, so unsigned noise cannot evict real entries.
  if (input.nonces.has(nonce, input.nowS)) return "replay"
  input.nonces.remember(nonce, input.nowS)
  return "ok"
}
