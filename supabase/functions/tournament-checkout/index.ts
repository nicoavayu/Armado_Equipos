import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { corsHeaders, jsonResponse, safeUuid } from "../_shared/commercialHttp.ts"
import {
  enabledFakeProviderEnvironment,
  fakePaymentProvider,
} from "../_shared/fakePaymentProvider.ts"
import { type PurchaseProjection } from "../_shared/paymentProvider.ts"
import {
  createSupabaseCredentialFetch,
  getSupabasePublishableCredential,
} from "../_shared/supabaseApiKeys.ts"

serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, cors)
  const body = await req.json().catch(() => null)
  const organizationId = safeUuid(body?.organizationId)
  const tournamentId = safeUuid(body?.tournamentId)
  const idempotencyKey = safeUuid(body?.idempotencyKey)
  if (!organizationId || !tournamentId || !idempotencyKey) {
    return jsonResponse({ error: "invalid_request" }, 400, cors)
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const appBaseUrl = Deno.env.get("APP_PUBLIC_URL") || new URL(req.url).origin
  const configuredEnvironment = enabledFakeProviderEnvironment()
  if (!configuredEnvironment) {
    return jsonResponse({ error: "fake_provider_disabled" }, 404, cors)
  }
  if (!supabaseUrl) return jsonResponse({ error: "service_unavailable" }, 503, cors)

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
    const { data, error } = await client.rpc("create_fake_tournament_purchase", {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_product_code: "torneos_premium",
      p_idempotency_key: idempotencyKey,
      p_provider_environment: configuredEnvironment,
    })
    if (error) {
      const forbidden = String(error.message).includes("FORBIDDEN")
      const premium = String(error.message).includes("ALREADY_PREMIUM")
      return jsonResponse({ error: premium ? "already_premium" : "checkout_unavailable" }, forbidden ? 403 : 409, cors)
    }
    const purchase = data as PurchaseProjection
    return jsonResponse({ purchase, preference: fakePaymentProvider.createPreference(purchase, appBaseUrl) }, 200, cors)
  } catch {
    return jsonResponse({ error: "checkout_unavailable" }, 503, cors)
  }
})
