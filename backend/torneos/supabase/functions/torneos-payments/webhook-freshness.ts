// torneos-payments/webhook-freshness.ts — MP-B1.1 R2/R3: the only time rule applied to a Mercado Pago notification.
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
// R3: the input is the RAW `ts` string that webhook-signature.ts parsed and the HMAC covered. Its unit is read from
// its shape only — exactly 10 digits = epoch seconds, exactly 13 digits = epoch milliseconds, no leading zero — and
// converted here, for this comparison only; the manifest never sees the converted value.
export const WEBHOOK_FUTURE_SKEW_S = 300

export type WebhookTimeVerdict = "ok" | "malformed" | "future"

/** The signing time in epoch milliseconds; null for anything but 10-digit seconds or 13-digit milliseconds. */
export function webhookTimestampMs(ts: string): number | null {
  const unitMs = /^[1-9]\d{9}$/.test(ts) ? 1000 : /^[1-9]\d{12}$/.test(ts) ? 1 : 0
  if (!unitMs) return null
  const ms = Number(ts) * unitMs
  return Number.isSafeInteger(ms) ? ms : null
}

export function webhookTimeVerdict(ts: string, nowMs: number): WebhookTimeVerdict {
  const signedMs = webhookTimestampMs(ts)
  if (signedMs === null) return "malformed"
  return signedMs - nowMs > WEBHOOK_FUTURE_SKEW_S * 1000 ? "future" : "ok"
}
