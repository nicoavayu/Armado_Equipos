// torneos-payments-production/provider.ts — Mercado Pago Checkout Pro PRODUCTION: the requests the service makes and the
// policy that decides whether a re-fetched payment belongs to a production purchase.
//
// Requests (all through the origin-locked fetcher of ../torneos-payments/lab-fetch.ts, https://api.mercadopago.com only):
//   GET  /users/me                       attestation: the token is exactly the configured seller, site MLA, and NOT a test
//                                        user (a TEST seller token in production disables the service for the isolate)
//   POST /checkout/preferences           X-Idempotency-Key = purchase id (a retry never opens a second Preference)
//   GET  /checkout/preferences/{id}      reuse of the recorded Preference and the binding of every payment to it
//   GET  /v1/payments/search             reconciliation by external_reference (the purchase), never by payer
//   GET  /v1/payments/{id}, /merchant_orders/{id}, /v1/chargebacks/{id}: the certified read-only fetchers of _shared
// The payment policy is the remote-test sandbox policy of the certified TEST runtime with the production truths:
// live_mode must be true, the seller attested as a production seller, and the price is whatever the purchase snapshot
// says (the database offer is the authority, nothing is pinned in code). Nothing from Mercado Pago is logged.
import type { MercadoPagoMerchantOrder, MercadoPagoPayment } from "../_shared/mercadoPagoPaymentProvider.ts"
import type { PurchaseProjection } from "../_shared/paymentProvider.ts"
import type { MercadoPagoProductionConfig } from "./config.ts"
import { PRODUCTION_SELLER_SITE } from "./config.ts"

export const MERCADO_PAGO_API_ORIGIN = "https://api.mercadopago.com"
export const PRODUCT_CODE = "torneos_premium"
export const PRODUCT_TITLE = "Arma2 Torneos Premium"
export const CURRENCY = "ARS"
const REQUEST_TIMEOUT_MS = 8000
const READ_TIMEOUT_MS = 5000
const DIGITS_RE = /^\d{1,32}$/
const PREFERENCE_ID_RE = /^\d{1,20}-[0-9a-f-]{36}$/

export type AttestationVerdict = "ok" | "not_production" | "unavailable"
export type ProductionPreference = {
  id?: unknown
  collector_id?: unknown
  client_id?: unknown
  init_point?: unknown
  external_reference?: unknown
  metadata?: unknown
  items?: unknown
}
type WithApplication = { application_id?: unknown; client_id?: unknown; date_last_updated?: unknown }

const idOf = (value: unknown) => (typeof value === "number" || typeof value === "string" ? String(value) : "")

async function request(fetcher: typeof fetch, config: MercadoPagoProductionConfig, path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const response = await fetcher(`${MERCADO_PAGO_API_ORIGIN}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: `Bearer ${config.accessToken}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`mercado_pago_api_${response.status}`) }
  return await response.json()
}

/**
 * `ok` only for exactly the configured seller, site MLA, without the `test_user` tag. 401/403 and any other account are
 * `not_production` (permanent for the isolate); transport faults, 5xx and 429 are `unavailable` (retried later).
 */
export async function attestProductionSeller(fetcher: typeof fetch, config: MercadoPagoProductionConfig): Promise<AttestationVerdict> {
  let response: Response
  try {
    response = await fetcher(`${MERCADO_PAGO_API_ORIGIN}/users/me`, {
      method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${config.accessToken}` }, signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
  } catch {
    return "unavailable"
  }
  if (response.status === 401 || response.status === 403) { await response.body?.cancel().catch(() => {}); return "not_production" }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); return "unavailable" }
  let body: unknown
  try { body = await response.json() } catch { return "unavailable" }
  if (typeof body !== "object" || body === null) return "not_production"
  const account = body as { id?: unknown; tags?: unknown; site_id?: unknown }
  const tags = Array.isArray(account.tags) ? account.tags.map((t) => String(t)) : []
  return idOf(account.id) === config.sellerId && account.site_id === PRODUCTION_SELLER_SITE && !tags.includes("test_user") ? "ok" : "not_production"
}

function purchasePath(purchase: PurchaseProjection, result: "exito" | "pendiente" | "fallo") {
  return `/torneos/organizacion/${encodeURIComponent(purchase.organizationId)}/temporada/${encodeURIComponent(purchase.seasonId)}`
    + `/plan/compra/${encodeURIComponent(purchase.id)}/${result}`
}

/** The certified Checkout Pro body (one item, external_reference, back URLs, notification URL, metadata, expiry). */
export function buildProductionPreferenceBody(purchase: PurchaseProjection, appBaseUrl: string, notificationUrl: string, expiresAt: string) {
  return {
    items: [{ id: PRODUCT_CODE, title: PRODUCT_TITLE, quantity: 1, currency_id: CURRENCY, unit_price: purchase.amount }],
    external_reference: purchase.externalReference,
    back_urls: {
      success: `${appBaseUrl}${purchasePath(purchase, "exito")}`,
      pending: `${appBaseUrl}${purchasePath(purchase, "pendiente")}`,
      failure: `${appBaseUrl}${purchasePath(purchase, "fallo")}`,
    },
    auto_return: "approved",
    notification_url: notificationUrl,
    metadata: { purchase_id: purchase.id },
    expires: true,
    expiration_date_from: new Date(purchase.createdAt).toISOString(),
    expiration_date_to: new Date(expiresAt).toISOString(),
  }
}

export function isCheckoutProUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value ?? ""))
    const host = url.hostname.toLowerCase()
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (host === "mercadopago.com" || host.endsWith(".mercadopago.com") || host === "mercadopago.com.ar" || host.endsWith(".mercadopago.com.ar"))
      && !host.startsWith("sandbox.")
  } catch {
    return false
  }
}

/** Why a Preference answer is not the production Preference of this purchase, or null. */
export function preferenceProblem(preference: ProductionPreference, purchase: PurchaseProjection, config: MercadoPagoProductionConfig, expectedId: string | null): string | null {
  const id = idOf(preference.id)
  if (!PREFERENCE_ID_RE.test(id) || (expectedId !== null && id !== expectedId)) return "preference_id"
  if (idOf(preference.collector_id) !== config.sellerId) return "collector"
  if (!isCheckoutProUrl(preference.init_point)) return "checkout_url"
  if (preference.external_reference !== purchase.externalReference) return "reference"
  const metadata = preference.metadata as Record<string, unknown> | null | undefined
  if (!metadata || typeof metadata !== "object" || metadata.purchase_id !== purchase.id) return "metadata"
  const items = Array.isArray(preference.items) ? preference.items as Array<Record<string, unknown>> : []
  if (items.length !== 1 || items[0].id !== PRODUCT_CODE || items[0].quantity !== 1 || items[0].currency_id !== CURRENCY
    || items[0].unit_price !== purchase.amount) return "item"
  return null
}

export async function createProductionPreference(fetcher: typeof fetch, config: MercadoPagoProductionConfig, purchase: PurchaseProjection,
  appBaseUrl: string, notificationUrl: string, expiresAt: string): Promise<ProductionPreference> {
  const body = buildProductionPreferenceBody(purchase, appBaseUrl, notificationUrl, expiresAt)
  return await request(fetcher, config, "/checkout/preferences", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": purchase.id }, body: JSON.stringify(body),
  }, REQUEST_TIMEOUT_MS) as ProductionPreference
}

export async function fetchProductionPreference(fetcher: typeof fetch, config: MercadoPagoProductionConfig, preferenceId: string): Promise<ProductionPreference> {
  if (!PREFERENCE_ID_RE.test(preferenceId)) throw new Error("mercado_pago_preference_id_invalid")
  const body = await request(fetcher, config, `/checkout/preferences/${encodeURIComponent(preferenceId)}`, { method: "GET" }, READ_TIMEOUT_MS)
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("mercado_pago_preference_invalid")
  return body as ProductionPreference
}

/** Payment ids of one purchase (external_reference), oldest first; at most 50 (a purchase has a handful at most). */
export async function searchPaymentIds(fetcher: typeof fetch, config: MercadoPagoProductionConfig, externalReference: string): Promise<string[]> {
  const query = new URLSearchParams({ external_reference: externalReference, sort: "date_created", criteria: "asc", limit: "50" })
  const body = await request(fetcher, config, `/v1/payments/search?${query}`, { method: "GET" }, READ_TIMEOUT_MS)
  const results = (body as { results?: unknown })?.results
  if (!Array.isArray(results)) throw new Error("mercado_pago_search_invalid")
  const ids: string[] = []
  for (const result of results) {
    const id = idOf((result as { id?: unknown })?.id)
    if (!DIGITS_RE.test(id)) throw new Error("mercado_pago_search_invalid")
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * The production acceptance policy of a re-fetched payment. Every field is compared with Mercado Pago's own resources
 * and with the database purchase; the first mismatch is returned, null means accepted:
 *   seller     attested production seller = payment.collector_id = order.collector.id = preference.collector_id
 *   app        any application id the payment or the order exposes = the application of our Preference (client_id)
 *   binding    external_reference (payment, order, preference, purchase), metadata.purchase_id (payment, preference),
 *              order.preference_id = preference.id = the recorded one, payment ∈ order.payments
 *   money      currency ARS on payment, purchase and the single Preference item; transaction_amount = item price =
 *              the purchase snapshot (financing interest never changes transaction_amount)
 *   live_mode  exactly true: production payments are real
 * The purchase state is NOT filtered here: a late approval of a closed purchase must reach the database, which records
 * it as approved_after_close with requiresManualRefund instead of granting anything.
 */
export function productionPaymentProblem({ payment, order, preference, purchase, attestedSellerId, config }: {
  payment: MercadoPagoPayment & WithApplication
  order: MercadoPagoMerchantOrder & WithApplication
  preference: ProductionPreference
  purchase: PurchaseProjection
  attestedSellerId: string | null
  config: MercadoPagoProductionConfig
}): string | null {
  const sellerId = config.sellerId
  if (attestedSellerId === null || attestedSellerId !== sellerId) return "seller_not_attested"
  if (idOf(payment.collector_id) !== sellerId || idOf(order.collector?.id) !== sellerId || idOf(preference.collector_id) !== sellerId) return "collector"
  const application = idOf(preference.client_id)
  for (const exposed of [payment.application_id, payment.client_id, order.application_id]) {
    if (exposed === undefined || exposed === null || exposed === "") continue
    if (!DIGITS_RE.test(application) || idOf(exposed) !== application) return "application"
  }
  if (purchase.provider !== "MERCADO_PAGO" || purchase.providerEnvironment !== "production" || !purchase.providerPreferenceId) return "purchase"
  const reference = purchase.externalReference
  if (payment.external_reference !== reference || order.external_reference !== reference || preference.external_reference !== reference) return "reference"
  if (payment.metadata?.purchase_id !== purchase.id) return "metadata"
  const preferenceMetadata = preference.metadata as Record<string, unknown> | null | undefined
  if (!preferenceMetadata || typeof preferenceMetadata !== "object" || preferenceMetadata.purchase_id !== purchase.id) return "metadata"
  if (idOf(preference.id) !== purchase.providerPreferenceId || order.preference_id !== purchase.providerPreferenceId) return "preference"
  const paymentId = idOf(payment.id)
  if (!DIGITS_RE.test(paymentId) || !(order.payments || []).some(({ id }) => idOf(id) === paymentId)) return "order"
  if (payment.currency_id !== CURRENCY || purchase.currency !== CURRENCY) return "currency"
  if (typeof payment.transaction_amount !== "number" || payment.transaction_amount !== purchase.amount) return "amount"
  const items = Array.isArray(preference.items) ? preference.items as Array<Record<string, unknown>> : []
  if (items.length !== 1 || items[0].id !== PRODUCT_CODE || items[0].quantity !== 1 || items[0].currency_id !== CURRENCY
    || items[0].unit_price !== purchase.amount) return "preference_item"
  if (payment.live_mode !== true) return "live_mode"
  return null
}
