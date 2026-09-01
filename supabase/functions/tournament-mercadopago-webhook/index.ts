import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { jsonResponse } from "../_shared/commercialHttp.ts"
import {
  fetchMercadoPagoChargeback,
  fetchMercadoPagoMerchantOrder,
  fetchMercadoPagoPayment,
  getMercadoPagoTestConfig,
  normalizeMercadoPagoPaymentStatus,
  paymentIdFromMercadoPagoChargeback,
  verifyMercadoPagoPaymentBinding,
  verifyMercadoPagoWebhookSignature,
} from "../_shared/mercadoPagoPaymentProvider.ts"
import {
  createSupabaseCredentialFetch,
  getSupabaseSecretCredential,
} from "../_shared/supabaseApiKeys.ts"

const RESPONSE_HEADERS: Record<string, string> = {}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, {
      ...RESPONSE_HEADERS,
      Allow: "POST",
    })
  }
  const declaredLength = Number(req.headers.get("content-length") || "0")
  if (declaredLength > 32_768) {
    return jsonResponse({ error: "payload_too_large" }, 413, RESPONSE_HEADERS)
  }

  let config
  try {
    config = getMercadoPagoTestConfig()
  } catch {
    return jsonResponse({ error: "service_unavailable" }, 503, RESPONSE_HEADERS)
  }

  const url = new URL(req.url)
  const dataId = url.searchParams.get("data.id")
  const payloadBytes = await req.arrayBuffer().catch(() => null)
  if (!payloadBytes || payloadBytes.byteLength > 32_768) {
    return jsonResponse({ error: "payload_too_large" }, 413, RESPONSE_HEADERS)
  }
  const payload = (() => {
    try {
      return JSON.parse(new TextDecoder().decode(payloadBytes))
    } catch {
      return null
    }
  })()
  const payloadDataId = String(payload?.data?.id ?? "")
  const isPaymentNotification = payload?.type === "payment"
  const isChargebackNotification = payload?.type === "topic_chargebacks_wh"
    && payload?.data?.checkout === "PRO"
  if ((!isPaymentNotification && !isChargebackNotification) || payload?.live_mode !== false
    || String(payload?.user_id ?? "") !== config.sellerId
    || !dataId || dataId !== payloadDataId) {
    return jsonResponse({ error: "invalid_notification" }, 400, RESPONSE_HEADERS)
  }

  const signatureValid = await verifyMercadoPagoWebhookSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId,
    secret: config.webhookSecret,
  }).catch(() => false)
  if (!signatureValid) {
    return jsonResponse({ error: "invalid_signature" }, 401, RESPONSE_HEADERS)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!supabaseUrl) {
    return jsonResponse({ error: "service_unavailable" }, 503, RESPONSE_HEADERS)
  }

  try {
    const paymentId = isChargebackNotification
      ? paymentIdFromMercadoPagoChargeback(
        await fetchMercadoPagoChargeback(dataId,config),
        dataId,
      )
      : dataId
    const payment = await fetchMercadoPagoPayment(paymentId,config)
    if (String(payment.id ?? "") !== paymentId || !payment.external_reference
      || !payment.order?.id || payment.order?.type !== "mercadopago") {
      return jsonResponse({ error: "payment_verification_failed" }, 422, RESPONSE_HEADERS)
    }
    const order = await fetchMercadoPagoMerchantOrder(String(payment.order.id),config)
    const secret = getSupabaseSecretCredential()
    const service = createClient(supabaseUrl, secret.key, {
      global: { fetch: createSupabaseCredentialFetch(secret) },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const purchaseResult = await service.rpc("get_provider_tournament_purchase", {
      p_external_reference: payment.external_reference,
      p_provider: "MERCADO_PAGO",
      p_provider_environment: "test",
    })
    if (purchaseResult.error || !purchaseResult.data) {
      return jsonResponse({ error: "purchase_not_found" }, 404, RESPONSE_HEADERS)
    }
    const purchase = purchaseResult.data
    try {
      verifyMercadoPagoPaymentBinding(payment,order,purchase,config)
    } catch {
      return jsonResponse({ error: "payment_verification_failed" }, 422, RESPONSE_HEADERS)
    }
    const normalized = normalizeMercadoPagoPaymentStatus(payment)
    if (!normalized) {
      return jsonResponse({ accepted: true, stateChanged: false }, 202, RESPONSE_HEADERS)
    }
    const rpcName = normalized.kind === "reversal"
      ? "apply_verified_tournament_payment_reversal"
      : "apply_verified_tournament_payment_status"
    const rpcArgs = normalized.kind === "reversal" ? {
      p_purchase_id: purchase.id,
      p_provider: "MERCADO_PAGO",
      p_provider_environment: "test",
      p_action: normalized.action,
      p_provider_status: normalized.providerStatus,
      p_provider_status_detail: normalized.providerStatusDetail,
      p_provider_payment_id: paymentId,
    } : {
      p_purchase_id: purchase.id,
      p_provider: "MERCADO_PAGO",
      p_provider_environment: "test",
      p_status: normalized.status,
      p_provider_status: normalized.providerStatus,
      p_provider_status_detail: normalized.providerStatusDetail,
      p_provider_payment_id: paymentId,
      p_simulated_activation_error_code: null,
    }
    const transition = await service.rpc(rpcName,rpcArgs)
    if (transition.error || !transition.data) {
      return jsonResponse({ error: "transition_failed" }, 503, RESPONSE_HEADERS)
    }
    return jsonResponse({ accepted: true }, 200, RESPONSE_HEADERS)
  } catch {
    return jsonResponse({ error: "provider_unavailable" }, 503, RESPONSE_HEADERS)
  }
})
