// torneos-payments/webhook-freshness.ts — MP-B1.1 R2: the only time rule applied to a Mercado Pago notification.
//
// The x-signature `ts` is the provider's signing time: it authenticates and announces a notification, nothing more.
// It never orders payment state — that is the re-fetched payment's own ordering field, compared by the MP-B1.2 DB
// contract. The two clocks are never mixed.
//
//   • No maximum AGE. The official webhook documentation (reviewed 2026-09-24) defines no validity window for `ts` and
//     describes retries every 15 minutes that continue after the third attempt, so an old but authentic notification
//     is legitimate. It can only trigger a provider re-fetch; the re-fetch + the MP-B1.2 watermark + DB idempotency
//     make it harmless (no second grant, no downgrade of restored/refunded, no revival after revocation).
//   • A small FUTURE tolerance. A genuine `ts` is taken before the notification is sent, so it can exceed our clock only
//     by clock skew. 300 s absorbs any realistic skew between two NTP-disciplined clocks (normally well under 1 s)
//     while refusing absurd values (a key misuse, a forged-clock signer, or a unit mix-up) before any provider call.
//
// Parsing mirrors the certified verifier byte for byte (verifyMercadoPagoWebhookSignature in the shared provider
// copy, which must stay unchanged): split on ",", key/value at the first "=", trimmed, the LAST duplicate wins, exactly
// 10 digits. The verdict is therefore about the very `ts` the HMAC covered.
export const WEBHOOK_FUTURE_SKEW_S = 300

export type WebhookTimeVerdict = "ok" | "malformed" | "future"

/** The signed `ts` (unix seconds) exactly as the verifier reads it; null when the verifier would refuse it. */
export function webhookSignatureTimestamp(xSignature: string | null): number | null {
  if (!xSignature) return null
  const parts = Object.fromEntries(xSignature.split(",").map((part) => {
    const separator = part.indexOf("=")
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
  }))
  const ts = parts.ts || ""
  return /^\d{10}$/.test(ts) ? Number(ts) : null
}

export function webhookTimeVerdict(xSignature: string | null, nowMs: number): WebhookTimeVerdict {
  const ts = webhookSignatureTimestamp(xSignature)
  if (ts === null) return "malformed"
  return ts - Math.floor(nowMs / 1000) > WEBHOOK_FUTURE_SKEW_S ? "future" : "ok"
}
