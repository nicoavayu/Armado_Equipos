// torneos-payments/webhook-signature.ts — MP-B1.1 R3: authentication of a Mercado Pago notification.
//
// Mercado Pago signs `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` with HMAC-SHA-256 under the webhook secret and
// sends `x-signature: ts=<ts>,v1=<hex>`. The official documentation shows `ts` both as 10-digit epoch seconds and as
// 13-digit epoch milliseconds; the byte-pinned shared provider copy accepts only 10 digits, so torneos-payments verifies
// here (the shared copy stays byte-identical and keeps serving everything else).
//
//   • The header is split on ","; each part is `key=value` at the first "="; keys are trimmed; unknown keys are
//     ignored; a part without "=" or a repeated ts / v1 makes the header ambiguous → refused.
//   • `ts` is taken EXACTLY as received (no trim, no normalisation) and must be ^[1-9]\d{9}$ or ^[1-9]\d{12}$.
//     The very same string is the one interpolated into the manifest: the HMAC covers the received bytes.
//   • `v1` is 64 hex digits (case-insensitive, compared lowercase in constant time).
// Seconds vs milliseconds only matter to the freshness check (webhook-freshness.ts), which receives this raw `ts`.
import { constantTimeEqual, hex } from "./hmac.ts"

const TS_RE = /^(?:[1-9]\d{9}|[1-9]\d{12})$/
const V1_RE = /^[0-9a-f]{64}$/i
const DATA_ID_RE = /^\d{1,32}$/

export type MercadoPagoSignature = { ts: string; v1: string }

/** The signed `ts` (raw, as received) and `v1`; null when the header is missing, malformed or ambiguous. */
export function parseMercadoPagoSignature(xSignature: string | null): MercadoPagoSignature | null {
  if (!xSignature) return null
  let ts: string | null = null
  let v1: string | null = null
  for (const part of xSignature.split(",")) {
    const separator = part.indexOf("=")
    if (separator < 0) return null
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1)
    if (key === "ts") {
      if (ts !== null) return null
      ts = value
    } else if (key === "v1") {
      if (v1 !== null) return null
      v1 = value.trim()
    }
  }
  if (ts === null || v1 === null || !TS_RE.test(ts) || !V1_RE.test(v1)) return null
  return { ts, v1: v1.toLowerCase() }
}

export function mercadoPagoManifest(dataId: string, requestId: string, ts: string): string {
  return `id:${dataId};request-id:${requestId};ts:${ts};`
}

export async function verifyMercadoPagoSignature(input: {
  signature: MercadoPagoSignature
  xRequestId: string | null
  dataId: string | null
  secret: string
}): Promise<boolean> {
  const { signature, xRequestId, dataId } = input
  if (!xRequestId || !dataId || !DATA_ID_RE.test(dataId)) return false
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(mercadoPagoManifest(dataId, xRequestId, signature.ts))))
  return constantTimeEqual(expected, signature.v1)
}
