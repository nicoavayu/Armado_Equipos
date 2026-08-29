import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { corsHeaders, jsonResponse, safeUuid } from "../_shared/commercialHttp.ts"
import {
  enabledFakeProviderEnvironment,
  fakePaymentProvider,
} from "../_shared/fakePaymentProvider.ts"
import {
  createMercadoPagoPaymentProvider,
  getMercadoPagoTestConfig,
  requirePublicHttpsUrl,
} from "../_shared/mercadoPagoPaymentProvider.ts"
import {
  type PurchaseProjection,
  type TournamentPaymentProvider,
} from "../_shared/paymentProvider.ts"
import {
  createSupabaseCredentialFetch,
  getSupabasePublishableCredential,
  getSupabaseSecretCredential,
} from "../_shared/supabaseApiKeys.ts"

serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, cors)
  const body = await req.json().catch(() => null)
  const organizationId = safeUuid(body?.organizationId)
  const seasonId = safeUuid(body?.seasonId)
  const idempotencyKey = safeUuid(body?.idempotencyKey)
  if (!organizationId || !seasonId || !idempotencyKey) {
    return jsonResponse({ error: "invalid_request" }, 400, cors)
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!supabaseUrl) return jsonResponse({ error: "service_unavailable" }, 503, cors)
  // The local Supabase edge runtime is deliberately self-identifying through
  // its internal Kong origin. It has no production credentials, so local QA
  // can exercise the complete purchase/status route without silently opting
  // into Mercado Pago or requiring a secret that belongs to another runtime.
  const isLocalRuntime = supabaseUrl === "http://kong:8000"
  const selectedProvider = Deno.env.get("TOURNAMENT_PAYMENT_PROVIDER")
    || (isLocalRuntime ? "FAKE" : "")

  let providerEnvironment: "local" | "qa" | "test"
  let appBaseUrl: string
  let notificationUrl: string | null = null
  let provider: TournamentPaymentProvider
  try {
    if (selectedProvider === "FAKE") {
      const fakeEnvironment = enabledFakeProviderEnvironment()
        || (isLocalRuntime ? "local" : null)
      if (!fakeEnvironment) {
        return jsonResponse({ error: "fake_provider_disabled" }, 404, cors)
      }
      providerEnvironment = fakeEnvironment
      appBaseUrl = Deno.env.get("APP_PUBLIC_URL") || new URL(req.url).origin
      provider = fakePaymentProvider
    } else if (selectedProvider === "MERCADO_PAGO") {
      providerEnvironment = "test"
      appBaseUrl = requirePublicHttpsUrl(Deno.env.get("APP_PUBLIC_URL") || "")
      notificationUrl = requirePublicHttpsUrl(
        `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/tournament-mercadopago-webhook`,
      )
      provider = createMercadoPagoPaymentProvider({ config: getMercadoPagoTestConfig() })
    } else {
      return jsonResponse({ error: "payment_provider_disabled" }, 404, cors)
    }
  } catch {
    return jsonResponse({ error: "payment_provider_misconfigured" }, 503, cors)
  }

  try {
    const credential = getSupabasePublishableCredential()
    const authorization = req.headers.get("authorization") || ""
    const client = createClient(supabaseUrl, credential.key, {
      global: {
        fetch: createSupabaseCredentialFetch(credential),
        headers: { Authorization: authorization },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await client.auth.getUser()
    if (authError || !auth.user) return jsonResponse({ error: "not_authenticated" }, 401, cors)
    const purchaseRequest = selectedProvider === "FAKE"
      ? await client.rpc("create_fake_tournament_season_purchase", {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_product_code: "torneos_premium",
        p_idempotency_key: idempotencyKey,
        p_provider_environment: providerEnvironment,
      })
      : await client.rpc("create_tournament_season_purchase", {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_product_code: "torneos_premium",
        p_idempotency_key: idempotencyKey,
        p_provider: selectedProvider,
        p_provider_environment: providerEnvironment,
      })
    const { data, error } = purchaseRequest
    if (error) {
      const forbidden = String(error.message).includes("FORBIDDEN")
      const premium = String(error.message).includes("ALREADY_PREMIUM")
      return jsonResponse({ error: premium ? "already_premium" : "checkout_unavailable" }, forbidden ? 403 : 409, cors)
    }
    const purchase = data as PurchaseProjection
    const preference = await provider.createPreference(purchase, {
      appBaseUrl,
      notificationUrl,
    })
    if (selectedProvider === "MERCADO_PAGO") {
      const secret = getSupabaseSecretCredential()
      const service = createClient(supabaseUrl, secret.key, {
        global: { fetch: createSupabaseCredentialFetch(secret) },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const recorded = await service.rpc("record_tournament_purchase_preference", {
        p_purchase_id: purchase.id,
        p_provider: "MERCADO_PAGO",
        p_provider_environment: "test",
        p_provider_preference_id: preference.preferenceId,
        p_preference_expires_at: preference.expiresAt,
      })
      if (recorded.error || !recorded.data) {
        return jsonResponse({ error: "checkout_unavailable" }, 503, cors)
      }
      return jsonResponse({ purchase: recorded.data, preference }, 200, cors)
    }
    return jsonResponse({ purchase, preference }, 200, cors)
  } catch {
    return jsonResponse({ error: "checkout_unavailable" }, 503, cors)
  }
})
