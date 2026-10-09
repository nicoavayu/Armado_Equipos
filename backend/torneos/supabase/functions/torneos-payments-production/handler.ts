// torneos-payments-production/handler.ts — the Mercado Pago Checkout Pro PRODUCTION payments service.
//
// Three routes; every other method/path is 404 (no proxy, no CORS, no health probe):
//   POST /internal/v1/season-checkout-preference   caller: the Torneos gateway (HMAC, ../torneos-payments/hmac.ts)
//        { "purchase_id": "<uuid>" } → the Preference of a purchase the database already authorized and priced.
//        Same contract and answers as the certified TEST route, so the gateway maps both identically.
//   POST /internal/v1/purchase-reconcile           caller: the Torneos gateway (HMAC), after the buyer's own read
//        { "purchase_id": "<uuid>" } → asks Mercado Pago for the purchase's payments (by external_reference) and applies
//        whatever is verified. It is how "I already paid" works when the webhook is late or lost.
//   POST /webhooks/mercadopago/v1                  caller: Mercado Pago (x-signature with the PRODUCTION secret)
// plus reconcileDue(), run by the platform cron (index.ts): open purchases, recent approvals (refunds, chargebacks) and
// recently closed purchases (late approvals → manual refund flag), throttled per purchase in the database.
//
// A notification, a return URL or a reconcile request never grants anything: every payment is re-read from Mercado Pago,
// bound to its purchase and Preference (provider.ts) and only then handed to the production RPCs, whose state machine,
// watermark and idempotency are the database's (00000000000013). Responses are whitelists; logs carry route, status, a
// short code and the purchase id, never provider bodies, payer data, headers or secrets.
import {
  fetchMercadoPagoChargeback,
  fetchMercadoPagoMerchantOrder,
  fetchMercadoPagoPayment,
  type MercadoPagoMerchantOrder,
  type MercadoPagoPayment,
  normalizeMercadoPagoPaymentStatus,
} from "../_shared/mercadoPagoPaymentProvider.ts"
import type { PurchaseProjection } from "../_shared/paymentProvider.ts"
import { NonceCache, verifyInternalRequest } from "../torneos-payments/hmac.ts"
import { createProviderFetch } from "../torneos-payments/lab-fetch.ts"
import { webhookTimeVerdict } from "../torneos-payments/webhook-freshness.ts"
import { parseMercadoPagoSignature, verifyMercadoPagoSignature } from "../torneos-payments/webhook-signature.ts"
import {
  FUNCTION_NAME, INTERNAL_PREFERENCE_PATH, INTERNAL_RECONCILE_PATH, loadProductionPaymentsConfig, type ProductionPaymentsConfig,
  routePath, WEBHOOK_PATH,
} from "./config.ts"
import {
  type AttestationVerdict, attestProductionSeller, createProductionPreference, fetchProductionPreference, preferenceProblem,
  productionPaymentProblem, searchPaymentIds,
} from "./provider.ts"
import { DbError, type ProductionPaymentRpc, type ProductionPaymentsDb } from "./rpc.ts"

export const PREFERENCE_TTL_MS = 30 * 60 * 1000
/** A buyer's "update" never reaches Mercado Pago more than once per purchase in this window. */
export const REFRESH_MIN_INTERVAL_S = 15
/** The cron's own throttle per purchase (the candidate list already spaces checks by state). */
export const CRON_MIN_INTERVAL_S = 60
export const CRON_BATCH = 20
export const ATTESTATION_RETRY_MS = 10_000
const MAX_INTERNAL_BODY = 1024
const MAX_WEBHOOK_BODY = 32 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const EXTERNAL_REFERENCE_RE = /^arma2:season:purchase:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const RESPONSE_HEADERS = { "content-type": "application/json", "cache-control": "no-store" }

type Result = { status: number; body: Record<string, unknown>; code: string; purchaseId?: string | null }
type LogEntry = { fn: string; route: string; status: number; code: string; ms: number; purchaseId?: string | null }
type SummaryEntry = { fn: string; event: string; [key: string]: unknown }

export type ServiceDeps = {
  env: Record<string, string | undefined>
  connectDb: (url: string, sslCa: string | undefined) => ProductionPaymentsDb
  fetcher?: typeof fetch
  now?: () => number
  log?: (entry: LogEntry | SummaryEntry) => void
}
export type ProductionPaymentsService = {
  fetch: (req: Request) => Promise<Response>
  reconcileDue: () => Promise<Record<string, unknown>>
}

const result = (status: number, body: Record<string, unknown>, code = String(body.error ?? body.outcome ?? "ok"), purchaseId: string | null = null): Result =>
  ({ status, body, code, purchaseId })
const fail = (status: number, error: string, purchaseId: string | null = null): Result => result(status, { error }, error, purchaseId)

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

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The DB projection as a PurchaseProjection; null when it is not a season production purchase. */
export function toProductionPurchase(raw: unknown): PurchaseProjection | null {
  if (!isPlainObject(raw)) return null
  const str = (v: unknown) => (typeof v === "string" ? v : null)
  const id = str(raw.id), org = str(raw.organizationId), season = str(raw.seasonId), ext = str(raw.externalReference), created = str(raw.createdAt)
  if (!id || !org || !season || !ext || !created || raw.tournamentId !== null) return null
  const purchase: PurchaseProjection = {
    id, organizationId: org, seasonId: season, tournamentId: null,
    productCode: String(raw.productCode ?? ""), provider: String(raw.provider ?? ""), providerEnvironment: String(raw.providerEnvironment ?? ""),
    providerPreferenceId: str(raw.providerPreferenceId), externalReference: ext, status: String(raw.status ?? ""),
    amount: raw.amount as number, currency: String(raw.currency ?? ""), createdAt: created, preferenceExpiresAt: str(raw.preferenceExpiresAt),
  }
  if (purchase.provider !== "MERCADO_PAGO" || purchase.providerEnvironment !== "production") return null
  if (purchase.currency !== "ARS" || typeof purchase.amount !== "number" || !Number.isInteger(purchase.amount) || purchase.amount <= 0) return null
  if (purchase.productCode !== "torneos_premium" || purchase.externalReference !== `arma2:season:purchase:${purchase.id}`) return null
  return purchase
}

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

export function createProductionPaymentsService(deps: ServiceDeps): ProductionPaymentsService {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)))
  let config: ProductionPaymentsConfig | null = null
  try {
    config = loadProductionPaymentsConfig(deps.env)
  } catch {
    log({ fn: FUNCTION_NAME, event: "config_rejected" })
  }
  const db = config ? deps.connectDb(config.dbUrl, config.dbSslCa) : null
  const fetcher = config ? createProviderFetch(deps.fetcher ?? fetch, config.labMpApiOrigin) : null
  const nonces = new NonceCache()
  const call = (name: ProductionPaymentRpc, args: unknown[]) => db!.call(name, args)

  // One provider attestation per isolate: "not_production" is final, "unavailable" retried at most every 10 s.
  let attested: AttestationVerdict | null = null
  let attesting: Promise<AttestationVerdict> | null = null
  let retryAt = 0
  function attestation(cfg: ProductionPaymentsConfig): Promise<AttestationVerdict> {
    if (attested !== null) return Promise.resolve(attested)
    if (attesting) return attesting
    if (now() < retryAt) return Promise.resolve("unavailable")
    attesting = attestProductionSeller(fetcher!, cfg.mp).then((verdict) => {
      attesting = null
      if (verdict === "unavailable") retryAt = now() + ATTESTATION_RETRY_MS
      else attested = verdict
      if (verdict === "not_production") log({ fn: FUNCTION_NAME, event: "provider_not_production" })
      return verdict
    })
    return attesting
  }
  if (config && db) void attestation(config)
  const attestedSeller = () => (attested === "ok" && config ? config.mp.sellerId : null)

  async function lookup(externalReference: string): Promise<PurchaseProjection | null | "not_found"> {
    try {
      return toProductionPurchase(await call("get_production_provider_tournament_purchase", [externalReference]))
    } catch (error) {
      if (error instanceof DbError && error.sqlstate === "P0002") return "not_found"
      throw error
    }
  }

  // ------------------------------------------------------------------ one payment, verified and applied
  /** Re-reads one payment from Mercado Pago, binds it and applies it. `expected` = the purchase it must belong to. */
  async function applyPayment(cfg: ProductionPaymentsConfig, paymentId: string, expected: string | null): Promise<Result> {
    const mismatch = fail(422, "payment_verification_failed", expected)
    let payment: MercadoPagoPayment & { date_last_updated?: unknown; application_id?: unknown; client_id?: unknown }
    try {
      payment = await fetchMercadoPagoPayment(paymentId, cfg.mp, fetcher!)
    } catch (error) {
      return providerFailure(error, mismatch)
    }
    if (String(payment.id ?? "") !== paymentId) return mismatch
    // A payment of this seller that is not a Torneos season purchase (another integration of the same account):
    // acknowledged and ignored, never retried forever.
    if (typeof payment.external_reference !== "string" || !EXTERNAL_REFERENCE_RE.test(payment.external_reference)) {
      return result(200, { received: true, outcome: "ignored_foreign_payment" }, "ignored_foreign_payment", expected)
    }
    let purchase: PurchaseProjection | null | "not_found"
    try {
      purchase = await lookup(payment.external_reference)
    } catch (error) {
      return dbFailure(error)
    }
    if (purchase === "not_found") return result(200, { received: true, outcome: "ignored_unknown_purchase" }, "ignored_unknown_purchase", expected)
    if (purchase === null) return mismatch
    if (expected !== null && purchase.id !== expected) return mismatch
    if (!payment.order?.id || payment.order?.type !== "mercadopago" || !purchase.providerPreferenceId) return fail(422, "payment_verification_failed", purchase.id)
    let order: MercadoPagoMerchantOrder & { application_id?: unknown }
    let preference
    try {
      order = await fetchMercadoPagoMerchantOrder(String(payment.order.id), cfg.mp, fetcher!)
      preference = await fetchProductionPreference(fetcher!, cfg.mp, purchase.providerPreferenceId)
    } catch (error) {
      return providerFailure(error, fail(422, "payment_verification_failed", purchase.id))
    }
    const problem = productionPaymentProblem({ payment, order, preference, purchase, attestedSellerId: attestedSeller(), config: cfg.mp })
    if (problem) return result(422, { error: "payment_verification_failed" }, `payment_verification_failed_${problem}`, purchase.id)
    // Only the independently re-fetched payment supplies the ordering timestamp (never the notification, never our clock).
    const providerUpdatedAt = payment.date_last_updated
    if (typeof providerUpdatedAt !== "string" || !ISO_RE.test(providerUpdatedAt) || !Number.isFinite(Date.parse(providerUpdatedAt))) {
      return fail(422, "payment_verification_failed", purchase.id)
    }
    const normalized = normalizeMercadoPagoPaymentStatus(payment)
    if (!normalized) return result(202, { received: true, outcome: "unknown_status" }, "unknown_status", purchase.id)
    let applied: Record<string, unknown>
    try {
      applied = normalized.kind === "reversal"
        ? await call("apply_production_tournament_payment_reversal", [purchase.id, normalized.action, normalized.providerStatus,
          normalized.providerStatusDetail, paymentId, providerUpdatedAt]) as Record<string, unknown>
        : await call("apply_production_tournament_payment_status", [purchase.id, normalized.status, normalized.providerStatus,
          normalized.providerStatusDetail, paymentId, providerUpdatedAt]) as Record<string, unknown>
    } catch (error) {
      return { ...dbFailure(error, { TORNEOS_PURCHASE_NOT_READY: fail(503, "purchase_not_ready") }), purchaseId: purchase.id }
    }
    return result(200, {
      received: true, outcome: String(applied.outcome ?? "applied"), status: applied.status,
      requiresManualRefund: applied.requiresManualRefund === true, requiresManualReview: applied.requiresManualReview === true,
    }, String(applied.outcome ?? "applied"), purchase.id)
  }

  // ------------------------------------------------------------------ one purchase, reconciled
  async function reconcilePurchase(cfg: ProductionPaymentsConfig, purchase: PurchaseProjection): Promise<{ outcome: string; results: Result[] }> {
    let ids: string[]
    try {
      ids = await searchPaymentIds(fetcher!, cfg.mp, purchase.externalReference)
    } catch (error) {
      const failure = providerFailure(error, fail(502, "provider_response_invalid", purchase.id))
      return { outcome: failure.code, results: [failure] }
    }
    if (ids.length === 0) return { outcome: "no_payment", results: [] }
    const results: Result[] = []
    for (const id of ids) results.push(await applyPayment(cfg, id, purchase.id))
    const failed = results.find((r) => r.status >= 500)
    const rejected = results.find((r) => r.status >= 400 && r.status < 500)
    const outcome = failed ? failed.code : rejected ? rejected.code : results.some((r) => r.body.requiresManualRefund === true)
      ? "requires_manual_refund" : results.some((r) => r.body.requiresManualReview === true) ? "requires_manual_review" : "verified"
    return { outcome: outcome.replace(/[^a-z0-9_]/g, "_").slice(0, 60), results }
  }

  async function complete(purchaseId: string, outcome: string): Promise<void> {
    try { await call("complete_production_tournament_purchase_check", [purchaseId, /^[a-z][a-z0-9_]{1,59}$/.test(outcome) ? outcome : "unknown"]) } catch { /* bookkeeping only */ }
  }

  // ------------------------------------------------------------------ internal routes (gateway, HMAC)
  async function internalInput(req: Request, url: URL, cfg: ProductionPaymentsConfig, path: string): Promise<{ purchaseId: string } | Result> {
    if (url.search) return fail(400, "invalid_request")
    if (req.headers.has("origin") || req.headers.has("authorization")) return fail(403, "forbidden")
    let raw: string | null
    try { raw = await readBody(req, MAX_INTERNAL_BODY) } catch { return fail(400, "invalid_request") }
    if (raw === null) return fail(413, "payload_too_large")
    const verdict = await verifyInternalRequest({
      secret: cfg.internalSecret, path, time: req.headers.get("x-time"), nonce: req.headers.get("x-nonce"),
      signature: req.headers.get("x-signature"), body: raw, nowS: Math.floor(now() / 1000), nonces,
    })
    if (verdict !== "ok") return result(401, { error: "unauthorized" }, `unauthorized_${verdict}`)
    let input: unknown
    try { input = JSON.parse(raw) } catch { return fail(400, "invalid_request") }
    if (!isPlainObject(input) || Object.keys(input).length !== 1 || typeof input.purchase_id !== "string" || !UUID_RE.test(input.purchase_id)) {
      return fail(400, "invalid_request")
    }
    return { purchaseId: input.purchase_id }
  }

  async function checkoutPreference(req: Request, url: URL, cfg: ProductionPaymentsConfig): Promise<Result> {
    const input = await internalInput(req, url, cfg, INTERNAL_PREFERENCE_PATH)
    if ("status" in input) return input
    const purchaseId = input.purchaseId
    let found: PurchaseProjection | null | "not_found"
    try { found = await lookup(`arma2:season:purchase:${purchaseId}`) } catch (error) { return dbFailure(error) }
    if (found === "not_found") return fail(404, "purchase_not_found", purchaseId)
    if (found === null || found.id !== purchaseId) return result(422, { error: "purchase_invalid" }, "purchase_invalid_shape", purchaseId)
    const purchase = found
    const invalidAnswer = fail(502, "provider_response_invalid", purchaseId)

    if (purchase.status === "created") {
      const expiresAt = new Date(now() + PREFERENCE_TTL_MS).toISOString()
      let preference
      try {
        preference = await createProductionPreference(fetcher!, cfg.mp, purchase, cfg.appBaseUrl, cfg.notificationUrl, expiresAt)
      } catch (error) {
        return providerFailure(error, invalidAnswer)
      }
      const problem = preferenceProblem(preference, purchase, cfg.mp, null)
      if (problem) return result(502, { error: "provider_response_invalid" }, `provider_response_invalid_${problem}`, purchaseId)
      const preferenceId = String(preference.id)
      let recorded: Record<string, unknown>
      try {
        recorded = await call("record_production_tournament_purchase_preference", [purchase.id, preferenceId, expiresAt]) as Record<string, unknown>
      } catch (error) {
        return dbFailure(error, {
          TORNEOS_PREFERENCE_CONFLICT: fail(409, "preference_conflict", purchaseId),
          TORNEOS_PURCHASE_TRANSITION_INVALID: fail(409, "purchase_not_payable", purchaseId),
        })
      }
      if (recorded.providerPreferenceId !== preferenceId || typeof recorded.preferenceExpiresAt !== "string") return fail(409, "preference_conflict", purchaseId)
      return result(200, { provider: "MERCADO_PAGO", preferenceId, checkoutUrl: preference.init_point,
        expiresAt: new Date(recorded.preferenceExpiresAt).toISOString() }, "preference_created", purchaseId)
    }

    if (purchase.status === "preference_created") {
      if (!purchase.providerPreferenceId) return result(422, { error: "purchase_invalid" }, "purchase_invalid_preference", purchaseId)
      const expires = Date.parse(String(purchase.preferenceExpiresAt ?? ""))
      if (!Number.isFinite(expires) || expires <= now()) return fail(409, "preference_expired", purchaseId)
      let preference
      try {
        preference = await fetchProductionPreference(fetcher!, cfg.mp, purchase.providerPreferenceId)
      } catch (error) {
        return providerFailure(error, invalidAnswer)
      }
      const problem = preferenceProblem(preference, purchase, cfg.mp, purchase.providerPreferenceId)
      if (problem) return result(502, { error: "provider_response_invalid" }, `provider_response_invalid_${problem}`, purchaseId)
      return result(200, { provider: "MERCADO_PAGO", preferenceId: purchase.providerPreferenceId, checkoutUrl: preference.init_point,
        expiresAt: new Date(expires).toISOString() }, "preference_reused", purchaseId)
    }
    return fail(409, "purchase_not_payable", purchaseId)
  }

  async function purchaseReconcile(req: Request, url: URL, cfg: ProductionPaymentsConfig): Promise<Result> {
    const input = await internalInput(req, url, cfg, INTERNAL_RECONCILE_PATH)
    if ("status" in input) return input
    const purchaseId = input.purchaseId
    let claim: Record<string, unknown>
    try {
      claim = await call("claim_production_tournament_purchase_check", [purchaseId, REFRESH_MIN_INTERVAL_S]) as Record<string, unknown>
    } catch (error) {
      return dbFailure(error, { TORNEOS_PURCHASE_INVALID: fail(404, "purchase_not_found", purchaseId) })
    }
    const purchase = toProductionPurchase(claim)
    if (!purchase || purchase.id !== purchaseId) return result(422, { error: "purchase_invalid" }, "purchase_invalid_shape", purchaseId)
    if (claim.claimed !== true) return result(200, { outcome: "recently_checked", status: purchase.status }, "recently_checked", purchaseId)
    if (purchase.status === "created" || !purchase.providerPreferenceId) {
      await complete(purchaseId, "no_preference")
      return result(200, { outcome: "no_preference", status: purchase.status }, "no_preference", purchaseId)
    }
    const { outcome, results } = await reconcilePurchase(cfg, purchase)
    await complete(purchaseId, outcome)
    const transient = results.find((r) => r.status >= 500)
    if (transient) return { ...transient, purchaseId }
    const last = results.filter((r) => r.status === 200 && typeof r.body.status === "string").at(-1)
    return result(200, { outcome, status: last ? last.body.status : purchase.status }, outcome, purchaseId)
  }

  // ------------------------------------------------------------------ webhook (Mercado Pago)
  async function mercadoPagoWebhook(req: Request, url: URL, cfg: ProductionPaymentsConfig): Promise<Result> {
    if (req.headers.has("origin")) return fail(400, "invalid_request")
    let raw: string | null
    try { raw = await readBody(req, MAX_WEBHOOK_BODY) } catch { return fail(400, "invalid_request") }
    if (raw === null) return fail(413, "payload_too_large")
    let payload: unknown
    try { payload = JSON.parse(raw) } catch { return fail(400, "invalid_request") }
    if (!isPlainObject(payload)) return fail(400, "invalid_request")
    const dataId = url.searchParams.get("data.id")
    if (!dataId || !/^\d{1,32}$/.test(dataId) || url.searchParams.getAll("data.id").length !== 1) return fail(400, "invalid_request")
    const signature = parseMercadoPagoSignature(req.headers.get("x-signature"))
    const signatureValid = signature !== null && await verifyMercadoPagoSignature({
      signature, xRequestId: req.headers.get("x-request-id"), dataId, secret: cfg.mp.webhookSecret,
    }).catch(() => false)
    if (!signature || !signatureValid) return fail(401, "invalid_signature")
    if (webhookTimeVerdict(signature.ts, now()) !== "ok") return result(401, { error: "invalid_signature" }, "invalid_signature_future_ts")
    const data = isPlainObject(payload.data) ? payload.data : {}
    const isPayment = payload.type === "payment"
    const isChargeback = payload.type === "topic_chargebacks_wh" && data.checkout === "PRO"
    // Production notifications are live: live_mode exactly true, from exactly the production seller.
    if ((!isPayment && !isChargeback) || String(data.id ?? "") !== dataId || payload.live_mode !== true
      || String(payload.user_id ?? "") !== cfg.mp.sellerId) {
      return fail(400, "invalid_notification")
    }
    let paymentId = dataId
    if (isChargeback) {
      let chargeback
      try {
        chargeback = await fetchMercadoPagoChargeback(dataId, cfg.mp, fetcher!)
      } catch (error) {
        return providerFailure(error, fail(422, "payment_verification_failed"))
      }
      const raws = Array.isArray(chargeback.payments) ? chargeback.payments : [chargeback.payments]
      const ids = raws.map((id) => String(id ?? "")).filter((id) => /^\d{1,32}$/.test(id))
      if (String(chargeback.id ?? "") !== dataId || chargeback.live_mode !== true || ids.length !== 1 || raws.length !== 1) {
        return fail(422, "payment_verification_failed")
      }
      paymentId = ids[0]
    }
    return await applyPayment(cfg, paymentId, null)
  }

  // ------------------------------------------------------------------ cron
  let running = false
  async function reconcileDue(): Promise<Record<string, unknown>> {
    const summary: Record<string, unknown> = { fn: FUNCTION_NAME, event: "reconcile_summary", candidates: 0, checked: 0, verified: 0,
      noPayment: 0, manualRefund: 0, manualReview: 0, failures: 0, skipped: 0 }
    if (!config || !db) {
      summary.disabled = true
      return summary
    }
    if (running) { summary.overlap = true; return summary }
    running = true
    const started = now()
    try {
      if ((await attestation(config)) !== "ok") { summary.attestation = attested ?? "unavailable"; log(summary as SummaryEntry); return summary }
      const candidates = await call("list_production_tournament_purchases_to_reconcile", [CRON_BATCH])
      const list = Array.isArray(candidates) ? candidates : []
      summary.candidates = list.length
      for (const raw of list) {
        const purchase = toProductionPurchase(raw)
        if (!purchase) { summary.failures = Number(summary.failures) + 1; continue }
        const claim = await call("claim_production_tournament_purchase_check", [purchase.id, CRON_MIN_INTERVAL_S]) as Record<string, unknown>
        if (claim.claimed !== true) { summary.skipped = Number(summary.skipped) + 1; continue }
        const { outcome } = await reconcilePurchase(config, purchase)
        await complete(purchase.id, outcome)
        summary.checked = Number(summary.checked) + 1
        if (outcome === "verified") summary.verified = Number(summary.verified) + 1
        else if (outcome === "no_payment") summary.noPayment = Number(summary.noPayment) + 1
        else if (outcome === "requires_manual_refund") summary.manualRefund = Number(summary.manualRefund) + 1
        else if (outcome === "requires_manual_review") summary.manualReview = Number(summary.manualReview) + 1
        else summary.failures = Number(summary.failures) + 1
      }
    } catch {
      summary.failures = Number(summary.failures) + 1
      summary.error = "reconcile_aborted"
    } finally {
      running = false
    }
    summary.ms = now() - started
    log(summary as SummaryEntry)
    return summary
  }

  async function handle(req: Request): Promise<Response> {
    const started = now()
    const url = new URL(req.url)
    const route = routePath(url.pathname)
    const kind = req.method !== "POST" ? null
      : route === INTERNAL_PREFERENCE_PATH ? "internal" : route === INTERNAL_RECONCILE_PATH ? "reconcile" : route === WEBHOOK_PATH ? "webhook" : null
    let outcome: Result
    if (!kind) {
      outcome = fail(404, "not_found")
    } else if (!config || !db) {
      outcome = fail(503, "service_unavailable")
    } else if (config.host !== null && url.hostname !== config.host) {
      outcome = result(403, { error: "forbidden" }, "forbidden_host")
    } else if ((await attestation(config)) !== "ok") {
      outcome = attested === "not_production" ? result(503, { error: "service_unavailable" }, "provider_not_production") : fail(503, "provider_unavailable")
    } else {
      try {
        outcome = kind === "internal" ? await checkoutPreference(req, url, config)
          : kind === "reconcile" ? await purchaseReconcile(req, url, config)
            : await mercadoPagoWebhook(req, url, config)
      } catch {
        outcome = fail(503, "service_unavailable")
      }
    }
    if (kind) log({ fn: FUNCTION_NAME, route: kind, status: outcome.status, code: outcome.code, ms: now() - started, purchaseId: outcome.purchaseId ?? null })
    return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers: RESPONSE_HEADERS })
  }

  return { fetch: handle, reconcileDue }
}
