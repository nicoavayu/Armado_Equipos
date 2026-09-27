import {
  type CheckoutPreference,
  type PaymentPreferenceContext,
  type PurchaseProjection,
  type TournamentPaymentProvider,
} from "./paymentProvider.ts"

const API_ORIGIN = "https://api.mercadopago.com"
const REQUEST_TIMEOUT_MS = 8_000
const WEBHOOK_READ_TIMEOUT_MS = 5_000

type RuntimeEnvironment = { get(name: string): string | undefined }

export type MercadoPagoTestConfig = {
  accessToken: string
  webhookSecret: string
  sellerId: string
}

export type MercadoPagoPayment = {
  id?: number | string
  status?: string
  status_detail?: string | null
  external_reference?: string | null
  currency_id?: string
  transaction_amount?: number
  collector_id?: number | string
  metadata?: Record<string, unknown> | null
  order?: { id?: number | string; type?: string } | null
  live_mode?: boolean
}

export type MercadoPagoMerchantOrder = {
  id?: number | string
  preference_id?: string | null
  external_reference?: string | null
  collector?: { id?: number | string } | null
  payments?: Array<{ id?: number | string }> | null
}

export type MercadoPagoChargeback = {
  id?: number | string
  payments?: Array<number | string> | number | string | null
  currency?: string
  amount?: number
  coverage_applied?: boolean | null
  live_mode?: boolean
}

export type NormalizedMercadoPagoStatus = {
  kind: "status" | "reversal"
  status?: "approved" | "pending" | "rejected" | "cancelled" | "expired"
  action?: "refund" | "chargeback_disputed" | "chargeback_restored" | "chargeback_buyer_won"
  providerStatus: string
  providerStatusDetail: string | null
}

function requiredRuntimeValue(environment: RuntimeEnvironment, name: string) {
  const value = environment.get(name)?.trim()
  if (!value) throw new Error(`missing_${name.toLowerCase()}`)
  return value
}

export function getMercadoPagoTestConfig(
  environment: RuntimeEnvironment = Deno.env,
): MercadoPagoTestConfig {
  if (environment.get("MERCADO_PAGO_ENVIRONMENT") !== "test") {
    throw new Error("mercado_pago_test_environment_required")
  }
  return {
    accessToken: requiredRuntimeValue(environment, "MERCADO_PAGO_TEST_ACCESS_TOKEN"),
    webhookSecret: requiredRuntimeValue(environment, "MERCADO_PAGO_TEST_WEBHOOK_SECRET"),
    sellerId: requiredRuntimeValue(environment, "MERCADO_PAGO_TEST_SELLER_ID"),
  }
}

export function requirePublicHttpsUrl(value: string) {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== "https:" || hostname === "localhost" || hostname === "127.0.0.1"
    || hostname === "[::1]") {
    throw new Error("app_public_url_must_be_public_https")
  }
  url.username = ""
  url.password = ""
  url.hash = ""
  return url.toString().replace(/\/+$/, "")
}

function purchasePath(purchase: PurchaseProjection, result: "exito" | "pendiente" | "fallo") {
  return `/torneos/organizacion/${encodeURIComponent(purchase.organizationId)}`
    + `/temporada/${encodeURIComponent(purchase.seasonId)}/plan/compra/`
    + `${encodeURIComponent(purchase.id)}/${result}`
}

export function buildMercadoPagoPreferenceBody(
  purchase: PurchaseProjection,
  context: PaymentPreferenceContext,
) {
  const appBaseUrl = requirePublicHttpsUrl(context.appBaseUrl)
  if (!context.notificationUrl) throw new Error("mercado_pago_notification_url_required")
  const notificationUrl = requirePublicHttpsUrl(context.notificationUrl)
  if (purchase.provider !== "MERCADO_PAGO" || purchase.providerEnvironment !== "test"
    || purchase.currency !== "ARS" || !Number.isInteger(purchase.amount)
    || purchase.amount <= 0 || !purchase.externalReference) {
    throw new Error("mercado_pago_purchase_invalid")
  }
  return {
    items: [{
      id: purchase.productCode,
      title: "Arma2 Torneos Premium",
      quantity: 1,
      currency_id: "ARS",
      unit_price: purchase.amount,
    }],
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
    expiration_date_to: new Date(String(purchase.preferenceExpiresAt)).toISOString(),
  }
}

function isMercadoPagoCheckoutUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value ?? ""))
    const hostname = url.hostname.toLowerCase()
    return url.protocol === "https:" && (
      hostname === "mercadopago.com" || hostname.endsWith(".mercadopago.com")
      || hostname === "mercadopago.com.ar" || hostname.endsWith(".mercadopago.com.ar")
    )
  } catch {
    return false
  }
}

async function mercadoPagoRequest(
  path: string,
  config: MercadoPagoTestConfig,
  init: RequestInit,
  fetcher: typeof fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const response = await fetcher(`${API_ORIGIN}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.headers || {}),
    },
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`mercado_pago_api_${response.status}`)
  return await response.json()
}

export function createMercadoPagoPaymentProvider({
  config = getMercadoPagoTestConfig(),
  fetcher = fetch,
}: {
  config?: MercadoPagoTestConfig
  fetcher?: typeof fetch
} = {}): TournamentPaymentProvider {
  return {
    code: "MERCADO_PAGO",
    async createPreference(purchase, context): Promise<CheckoutPreference> {
      const body = buildMercadoPagoPreferenceBody(purchase, context)
      const existingPreferenceId = purchase.providerPreferenceId?.trim()
      const result = existingPreferenceId
        ? await mercadoPagoRequest(
          `/checkout/preferences/${encodeURIComponent(existingPreferenceId)}`,
          config,
          { method: "GET" },
          fetcher,
        )
        : await mercadoPagoRequest("/checkout/preferences", config, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": purchase.id,
          },
          body: JSON.stringify(body),
        }, fetcher)
      const preferenceId = String(result?.id ?? "").trim()
      const checkoutUrl = result?.init_point
      if (!preferenceId || !isMercadoPagoCheckoutUrl(checkoutUrl)
        || String(result?.collector_id ?? "") !== config.sellerId
        || (existingPreferenceId && preferenceId !== existingPreferenceId)) {
        throw new Error("mercado_pago_preference_invalid")
      }
      return {
        provider: "MERCADO_PAGO",
        purchaseId: purchase.id,
        checkoutUrl,
        expiresAt: purchase.preferenceExpiresAt ?? null,
        preferenceId,
      } as CheckoutPreference & { preferenceId: string }
    },
  }
}

export async function fetchMercadoPagoPayment(
  paymentId: string,
  config = getMercadoPagoTestConfig(),
  fetcher: typeof fetch = fetch,
): Promise<MercadoPagoPayment> {
  if (!/^\d{1,32}$/.test(paymentId)) throw new Error("mercado_pago_payment_id_invalid")
  return await mercadoPagoRequest(
    `/v1/payments/${encodeURIComponent(paymentId)}`,
    config,
    { method: "GET" },
    fetcher,
    WEBHOOK_READ_TIMEOUT_MS,
  ) as MercadoPagoPayment
}

export async function fetchMercadoPagoMerchantOrder(
  orderId: string,
  config = getMercadoPagoTestConfig(),
  fetcher: typeof fetch = fetch,
): Promise<MercadoPagoMerchantOrder> {
  if (!/^\d{1,32}$/.test(orderId)) throw new Error("mercado_pago_order_id_invalid")
  return await mercadoPagoRequest(
    `/merchant_orders/${encodeURIComponent(orderId)}`,
    config,
    { method: "GET" },
    fetcher,
    WEBHOOK_READ_TIMEOUT_MS,
  ) as MercadoPagoMerchantOrder
}

export async function fetchMercadoPagoChargeback(
  chargebackId: string,
  config = getMercadoPagoTestConfig(),
  fetcher: typeof fetch = fetch,
): Promise<MercadoPagoChargeback> {
  if (!/^\d{1,32}$/.test(chargebackId)) throw new Error("mercado_pago_chargeback_id_invalid")
  return await mercadoPagoRequest(
    `/v1/chargebacks/${encodeURIComponent(chargebackId)}`,
    config,
    { method: "GET" },
    fetcher,
    WEBHOOK_READ_TIMEOUT_MS,
  ) as MercadoPagoChargeback
}

export function paymentIdFromMercadoPagoChargeback(
  chargeback: MercadoPagoChargeback,
  chargebackId: string,
) {
  const rawPayments = Array.isArray(chargeback.payments)
    ? chargeback.payments
    : [chargeback.payments]
  const paymentIds = rawPayments
    .map((paymentId) => String(paymentId ?? ""))
    .filter((paymentId) => /^\d{1,32}$/.test(paymentId))
  if (String(chargeback.id ?? "") !== chargebackId || chargeback.live_mode !== false
    || paymentIds.length !== 1) {
    throw new Error("mercado_pago_chargeback_binding_mismatch")
  }
  return paymentIds[0]
}

export function verifyMercadoPagoPaymentBinding(
  payment: MercadoPagoPayment,
  order: MercadoPagoMerchantOrder,
  purchase: PurchaseProjection,
  config: MercadoPagoTestConfig,
) {
  const paymentId = String(payment.id ?? "")
  const metadataPurchaseId = String(payment.metadata?.purchase_id ?? "")
  const orderPaymentIds = new Set((order.payments || []).map(({ id }) => String(id ?? "")))
  if (!paymentId || String(payment.collector_id ?? "") !== config.sellerId
    || String(order.collector?.id ?? "") !== config.sellerId
    || payment.external_reference !== purchase.externalReference
    || order.external_reference !== purchase.externalReference
    || metadataPurchaseId !== purchase.id
    || payment.currency_id !== purchase.currency
    || Number(payment.transaction_amount) !== purchase.amount
    || order.preference_id !== purchase.providerPreferenceId
    || payment.live_mode !== false
    || !orderPaymentIds.has(paymentId)) {
    throw new Error("mercado_pago_payment_binding_mismatch")
  }
}

export function normalizeMercadoPagoPaymentStatus(
  payment: MercadoPagoPayment,
): NormalizedMercadoPagoStatus | null {
  const providerStatus = String(payment.status ?? "").trim().toLowerCase()
  const detail = String(payment.status_detail ?? "").trim().toLowerCase() || null
  if (providerStatus === "approved") {
    return { kind: "status", status: "approved", providerStatus, providerStatusDetail: detail }
  }
  if (["pending", "in_process", "authorized"].includes(providerStatus)) {
    return { kind: "status", status: "pending", providerStatus, providerStatusDetail: detail }
  }
  if (providerStatus === "rejected") {
    return { kind: "status", status: "rejected", providerStatus, providerStatusDetail: detail }
  }
  if (providerStatus === "cancelled" || providerStatus === "canceled") {
    return {
      kind: "status",
      status: detail === "expired" ? "expired" : "cancelled",
      providerStatus,
      providerStatusDetail: detail,
    }
  }
  if (providerStatus === "refunded") {
    return {
      kind: "reversal", action: "refund", providerStatus,
      providerStatusDetail: detail,
    }
  }
  if (providerStatus === "charged_back" || providerStatus === "in_mediation") {
    const action = detail === "reimbursed" ? "chargeback_restored"
      : detail === "settled" ? "chargeback_buyer_won" : "chargeback_disputed"
    return { kind: "reversal", action, providerStatus, providerStatusDetail: detail }
  }
  return null
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export async function verifyMercadoPagoWebhookSignature({
  xSignature,
  xRequestId,
  dataId,
  secret,
}: {
  xSignature: string | null
  xRequestId: string | null
  dataId: string | null
  secret: string
}) {
  if (!xSignature || !xRequestId || !dataId || !/^\d{1,32}$/.test(dataId)) return false
  const parts = Object.fromEntries(xSignature.split(",").map((part) => {
    const separator = part.indexOf("=")
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
  }))
  if (!/^\d{10}$/.test(parts.ts || "") || !/^[a-f0-9]{64}$/i.test(parts.v1 || "")) {
    return false
  }
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parts.ts};`
  const key = await crypto.subtle.importKey(
    "raw",new TextEncoder().encode(secret),{ name: "HMAC", hash: "SHA-256" },false,["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(manifest))
  const expected = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2,"0")).join("")
  return constantTimeEqual(expected,parts.v1.toLowerCase())
}
