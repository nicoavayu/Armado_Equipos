// torneos-payments/handler.ts — the Mercado Pago Checkout Pro TEST payments service (MP-A3).
//
// Exactly two routes; every other method/path is 404 (no proxy, no CORS, no health probe):
//   POST /internal/v1/season-checkout-preference   caller: the Torneos gateway (HMAC, hmac.ts)
//        { "purchase_id": "<uuid>" } → Preference for a purchase the DB already authorized and priced.
//   POST /webhooks/mercadopago/v1                  caller: Mercado Pago (x-signature, provider manifest)
//        The payload only names a resource; payment / merchant order / chargeback are re-read from
//        Mercado Pago, bound server-side to the purchase, and the verified status is delegated to the MP-A2
//        RPCs (the database is the domain authority; no state machine here).
// Provider logic is the reused legacy provider (../_shared, byte-identical). Responses are whitelists;
// logs carry route, status and a short code only.
import {
  createMercadoPagoPaymentProvider,
  fetchMercadoPagoChargeback,
  fetchMercadoPagoMerchantOrder,
  fetchMercadoPagoPayment,
  type MercadoPagoMerchantOrder,
  type MercadoPagoPayment,
  normalizeMercadoPagoPaymentStatus,
  paymentIdFromMercadoPagoChargeback,
  verifyMercadoPagoPaymentBinding,
  verifyMercadoPagoWebhookSignature,
} from "../_shared/mercadoPagoPaymentProvider.ts"
import type { CheckoutPreference, PurchaseProjection } from "../_shared/paymentProvider.ts"
import { FUNCTION_NAME, INTERNAL_PATH, loadPaymentsConfig, type PaymentsConfig, routePath, WEBHOOK_PATH } from "./config.ts"
import { NonceCache, verifyInternalRequest } from "./hmac.ts"
import { createProviderFetch } from "./lab-fetch.ts"
import { DbError, type PaymentsDb } from "./rpc.ts"

export const PREFERENCE_TTL_MS = 30 * 60 * 1000
const MAX_INTERNAL_BODY = 1024
const MAX_WEBHOOK_BODY = 32 * 1024
const PROVIDER = "MERCADO_PAGO"
const ENVIRONMENT = "test"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const EXTERNAL_REFERENCE_RE = /^arma2:season:purchase:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const RESPONSE_HEADERS = { "content-type": "application/json", "cache-control": "no-store" }

type Result = { status: number; body: Record<string, unknown>; code: string }
type LogEntry = { fn: string; route: string; status: number; code: string; ms: number }

export type ServiceDeps = {
  env: Record<string, string | undefined>
  connectDb: (url: string, sslCa: string | undefined) => PaymentsDb
  fetcher?: typeof fetch
  now?: () => number
  log?: (entry: LogEntry | { fn: string; event: string }) => void
}

const result = (status: number, body: Record<string, unknown>, code = String(body.error ?? body.outcome ?? "ok")): Result =>
  ({ status, body, code })
const fail = (status: number, error: string): Result => result(status, { error }, error)

/** Reads at most `limit` bytes of the body; null when larger. */
async function readBody(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (!Number.isFinite(declared) || declared > limit) return null
  if (!req.body) return ""
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The DB projection as the provider's PurchaseProjection; null when its shape is not a season purchase. */
function toPurchase(raw: Record<string, unknown>): PurchaseProjection | null {
  const str = (v: unknown) => (typeof v === "string" ? v : null)
  const id = str(raw.id), org = str(raw.organizationId), season = str(raw.seasonId), ext = str(raw.externalReference)
  const created = str(raw.createdAt)
  if (!id || !org || !season || !ext || !created || raw.tournamentId !== null) return null
  return {
    id, organizationId: org, seasonId: season, tournamentId: null,
    productCode: String(raw.productCode ?? ""), provider: String(raw.provider ?? ""),
    providerEnvironment: String(raw.providerEnvironment ?? ""), providerPreferenceId: str(raw.providerPreferenceId),
    externalReference: ext, status: String(raw.status ?? ""), amount: raw.amount as number, currency: String(raw.currency ?? ""),
    createdAt: created, preferenceExpiresAt: str(raw.preferenceExpiresAt),
  }
}

/** Verifies the purchase is the MP TEST season Premium purchase it claims to be (defence in depth over the DB). */
function purchaseProblem(p: PurchaseProjection | null, expectedId: string | null): string | null {
  if (!p) return "shape"
  if (expectedId !== null && p.id !== expectedId) return "id"
  if (p.provider !== PROVIDER || p.providerEnvironment !== ENVIRONMENT) return "provider"
  if (p.currency !== "ARS" || typeof p.amount !== "number" || !Number.isInteger(p.amount) || p.amount <= 0) return "amount"
  if (p.productCode !== "torneos_premium" || p.externalReference !== `arma2:season:purchase:${p.id}`) return "product"
  return null
}

/** Provider error → HTTP: 5xx / 429 / auth / network are transient (503); malformed or foreign answers are not. */
function providerFailure(error: unknown, invalid: Result): Result {
  const message = error instanceof Error ? error.message : ""
  const api = /^mercado_pago_api_(\d{3})$/.exec(message)
  if (api) {
    const status = Number(api[1])
    if (status >= 500 || status === 429 || status === 401 || status === 403 || status === 408) return fail(503, "provider_unavailable")
    return invalid
  }
  if (/_binding_mismatch$|_invalid$/.test(message)) return invalid
  return fail(503, "provider_unavailable")
}

function dbFailure(error: unknown, map: Record<string, Result> = {}): Result {
  if (error instanceof DbError) {
    if (map[error.token]) return map[error.token]
    if (error.sqlstate === "22023" || error.sqlstate === "55000") return fail(422, "purchase_invalid")
    if (error.sqlstate === "P0002") return fail(404, "purchase_not_found")
  }
  return fail(503, "service_unavailable")
}

export function createPaymentsService(deps: ServiceDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)))
  let config: PaymentsConfig | null = null
  try {
    config = loadPaymentsConfig(deps.env)
  } catch {
    log({ fn: FUNCTION_NAME, event: "config_rejected" })
  }
  const db = config ? deps.connectDb(config.dbUrl, config.dbSslCa) : null
  const fetcher = config ? createProviderFetch(deps.fetcher ?? fetch, config.labMpApiOrigin) : null
  const provider = config && fetcher ? createMercadoPagoPaymentProvider({ config: config.mp, fetcher }) : null
  const nonces = new NonceCache()

  // ------------------------------------------------------------------ internal: season checkout preference
  async function checkoutPreference(req: Request, url: URL, cfg: PaymentsConfig, database: PaymentsDb): Promise<Result> {
    if (url.search) return fail(400, "invalid_request")
    if (req.headers.has("origin") || req.headers.has("authorization")) return fail(403, "forbidden")
    let raw: string | null
    try { raw = await readBody(req, MAX_INTERNAL_BODY) } catch { return fail(400, "invalid_request") }
    if (raw === null) return fail(413, "payload_too_large")
    const verdict = await verifyInternalRequest({
      secret: cfg.internalSecret, path: INTERNAL_PATH, time: req.headers.get("x-time"), nonce: req.headers.get("x-nonce"),
      signature: req.headers.get("x-signature"), body: raw, nowS: Math.floor(now() / 1000), nonces,
    })
    if (verdict !== "ok") return result(401, { error: "unauthorized" }, `unauthorized_${verdict}`)
    let input: unknown
    try { input = JSON.parse(raw) } catch { return fail(400, "invalid_request") }
    if (!isPlainObject(input) || Object.keys(input).length !== 1 || typeof input.purchase_id !== "string"
      || !UUID_RE.test(input.purchase_id)) {
      return fail(400, "invalid_request")
    }
    const purchaseId = input.purchase_id

    let purchase: PurchaseProjection | null
    try {
      purchase = toPurchase(await database.call("get_provider_tournament_purchase", [`arma2:season:purchase:${purchaseId}`, PROVIDER, ENVIRONMENT]))
    } catch (error) {
      return dbFailure(error)
    }
    const problem = purchaseProblem(purchase, purchaseId)
    if (problem || !purchase) return result(422, { error: "purchase_invalid" }, `purchase_invalid_${problem}`)
    const context = { appBaseUrl: cfg.appBaseUrl, notificationUrl: cfg.notificationUrl }
    const invalidAnswer = fail(502, "provider_response_invalid")

    if (purchase.status === "created") {
      // One expiry for Mercado Pago and the DB: now + 30 min.
      const expiresAt = new Date(now() + PREFERENCE_TTL_MS).toISOString()
      let preference: CheckoutPreference
      try {
        preference = await provider!.createPreference({ ...purchase, providerPreferenceId: null, preferenceExpiresAt: expiresAt }, context)
      } catch (error) {
        return providerFailure(error, invalidAnswer)
      }
      let recorded: Record<string, unknown>
      try {
        recorded = await database.call("record_tournament_purchase_preference",
          [purchase.id, PROVIDER, ENVIRONMENT, preference.preferenceId, expiresAt])
      } catch (error) {
        return dbFailure(error, {
          TORNEOS_PREFERENCE_CONFLICT: fail(409, "preference_conflict"),
          TORNEOS_PURCHASE_TRANSITION_INVALID: fail(409, "purchase_not_payable"),
        })
      }
      if (recorded.providerPreferenceId !== preference.preferenceId || typeof recorded.preferenceExpiresAt !== "string") {
        return fail(409, "preference_conflict")
      }
      return result(200, {
        provider: PROVIDER, preferenceId: preference.preferenceId, checkoutUrl: preference.checkoutUrl,
        expiresAt: new Date(recorded.preferenceExpiresAt).toISOString(),
      }, "preference_created")
    }

    if (purchase.status === "preference_created") {
      // Reuse: the provider re-reads the recorded preference (same id, seller, checkout host); nothing new is created.
      if (!purchase.providerPreferenceId) return result(422, { error: "purchase_invalid" }, "purchase_invalid_preference")
      const expires = Date.parse(String(purchase.preferenceExpiresAt ?? ""))
      if (!Number.isFinite(expires) || expires <= now()) return fail(409, "preference_expired")
      let preference: CheckoutPreference
      try {
        preference = await provider!.createPreference(purchase, context)
      } catch (error) {
        return providerFailure(error, invalidAnswer)
      }
      return result(200, {
        provider: PROVIDER, preferenceId: preference.preferenceId, checkoutUrl: preference.checkoutUrl,
        expiresAt: new Date(expires).toISOString(),
      }, "preference_reused")
    }
    return fail(409, "purchase_not_payable")
  }

  // ------------------------------------------------------------------ webhook: Mercado Pago notification
  async function mercadoPagoWebhook(req: Request, url: URL, cfg: PaymentsConfig, database: PaymentsDb): Promise<Result> {
    if (req.headers.has("origin")) return fail(400, "invalid_request")
    let raw: string | null
    try { raw = await readBody(req, MAX_WEBHOOK_BODY) } catch { return fail(400, "invalid_request") }
    if (raw === null) return fail(413, "payload_too_large")
    let payload: unknown
    try { payload = JSON.parse(raw) } catch { return fail(400, "invalid_request") }
    if (!isPlainObject(payload)) return fail(400, "invalid_request")
    const dataId = url.searchParams.get("data.id")
    if (!dataId || !/^\d{1,32}$/.test(dataId) || url.searchParams.getAll("data.id").length !== 1) return fail(400, "invalid_request")

    const signatureValid = await verifyMercadoPagoWebhookSignature({
      xSignature: req.headers.get("x-signature"), xRequestId: req.headers.get("x-request-id"), dataId, secret: cfg.mp.webhookSecret,
    }).catch(() => false)
    if (!signatureValid) return fail(401, "invalid_signature")

    const data = isPlainObject(payload.data) ? payload.data : {}
    const isPayment = payload.type === "payment"
    const isChargeback = payload.type === "topic_chargebacks_wh" && data.checkout === "PRO"
    if ((!isPayment && !isChargeback) || String(data.id ?? "") !== dataId || payload.live_mode !== false
      || String(payload.user_id ?? "") !== cfg.mp.sellerId) {
      return fail(400, "invalid_notification")
    }

    // Re-query Mercado Pago: the notification is not authority.
    const mismatch = fail(422, "payment_verification_failed")
    let paymentId: string
    let payment: MercadoPagoPayment
    try {
      paymentId = isChargeback
        ? paymentIdFromMercadoPagoChargeback(await fetchMercadoPagoChargeback(dataId, cfg.mp, fetcher!), dataId)
        : dataId
      payment = await fetchMercadoPagoPayment(paymentId, cfg.mp, fetcher!)
    } catch (error) {
      return providerFailure(error, mismatch)
    }
    if (String(payment.id ?? "") !== paymentId || typeof payment.external_reference !== "string"
      || !EXTERNAL_REFERENCE_RE.test(payment.external_reference) || !payment.order?.id || payment.order?.type !== "mercadopago") {
      return mismatch
    }
    let order: MercadoPagoMerchantOrder
    try {
      order = await fetchMercadoPagoMerchantOrder(String(payment.order.id), cfg.mp, fetcher!)
    } catch (error) {
      return providerFailure(error, mismatch)
    }

    let purchase: PurchaseProjection | null
    try {
      purchase = toPurchase(await database.call("get_provider_tournament_purchase", [payment.external_reference, PROVIDER, ENVIRONMENT]))
    } catch (error) {
      return dbFailure(error)
    }
    if (purchaseProblem(purchase, null) || !purchase) return mismatch
    try {
      // seller (payment + order), external_reference, metadata.purchase_id, amount, currency,
      // preference_id, payment ∈ order, live_mode=false.
      verifyMercadoPagoPaymentBinding(payment, order, purchase, cfg.mp)
    } catch {
      return mismatch
    }

    const normalized = normalizeMercadoPagoPaymentStatus(payment)
    if (!normalized) return result(202, { received: true, outcome: "unknown_status" })
    let applied: Record<string, unknown>
    try {
      applied = normalized.kind === "reversal"
        ? await database.call("apply_verified_tournament_payment_reversal", [purchase.id, PROVIDER, ENVIRONMENT, normalized.action,
          normalized.providerStatus, normalized.providerStatusDetail, paymentId])
        : await database.call("apply_verified_tournament_payment_status", [purchase.id, PROVIDER, ENVIRONMENT, normalized.status,
          normalized.providerStatus, normalized.providerStatusDetail, paymentId])
    } catch (error) {
      // Only "no preference recorded yet" is retryable; every other refusal is permanent.
      return dbFailure(error, { TORNEOS_PURCHASE_NOT_READY: fail(503, "purchase_not_ready") })
    }
    // Applied, replayed, ignored or anomaly recorded (incl. requiresManualRefund): all final → 200.
    return result(200, {
      received: true, outcome: String(applied.outcome ?? "applied"),
      requiresManualRefund: applied.requiresManualRefund === true, requiresManualReview: applied.requiresManualReview === true,
    })
  }

  return async (req: Request): Promise<Response> => {
    const started = now()
    const url = new URL(req.url)
    const route = routePath(url.pathname)
    const kind = req.method === "POST" && route === INTERNAL_PATH ? "internal"
      : req.method === "POST" && route === WEBHOOK_PATH ? "webhook" : null
    let outcome: Result
    if (!kind) {
      outcome = fail(404, "not_found")
    } else if (!config || !db) {
      outcome = fail(503, "service_unavailable")
    } else {
      try {
        outcome = kind === "internal"
          ? await checkoutPreference(req, url, config, db)
          : await mercadoPagoWebhook(req, url, config, db)
      } catch {
        // DbUnavailable or any unexpected fault: transient, nothing about it leaves the service.
        outcome = fail(503, "service_unavailable")
      }
    }
    if (kind) log({ fn: FUNCTION_NAME, route: kind, status: outcome.status, code: outcome.code, ms: now() - started })
    return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers: RESPONSE_HEADERS })
  }
}
