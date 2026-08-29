import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { corsHeaders, jsonResponse, safeUuid } from "../_shared/commercialHttp.ts"
import {
  enabledFakeProviderEnvironment,
  fakePaymentProvider,
} from "../_shared/fakePaymentProvider.ts"
import {
  createSupabaseCredentialFetch,
  getSupabasePublishableCredential,
  getSupabaseSecretCredential,
} from "../_shared/supabaseApiKeys.ts"

serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, cors)
  if (!enabledFakeProviderEnvironment()) {
    return jsonResponse({ error: "fake_provider_disabled" }, 404, cors)
  }
  const body = await req.json().catch(() => null)
  const purchaseId = safeUuid(body?.purchaseId)
  const simulation = fakePaymentProvider.normalizeSimulation(body?.status)
  if (!purchaseId || !simulation) return jsonResponse({ error: "invalid_request" }, 400, cors)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!supabaseUrl) return jsonResponse({ error: "service_unavailable" }, 503, cors)
  try {
    const publishable = getSupabasePublishableCredential()
    const userClient = createClient(supabaseUrl, publishable.key, {
      global: {
        fetch: createSupabaseCredentialFetch(publishable),
        headers: { Authorization: req.headers.get("authorization") || "" },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await userClient.auth.getUser()
    if (authError || !auth.user) return jsonResponse({ error: "not_authenticated" }, 401, cors)
    const visible = await userClient.rpc("get_tournament_purchase", { p_purchase_id: purchaseId })
    if (visible.error) return jsonResponse({ error: "purchase_not_found" }, 404, cors)

    const secret = getSupabaseSecretCredential()
    const service = createClient(supabaseUrl, secret.key, {
      global: { fetch: createSupabaseCredentialFetch(secret) },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await service.rpc("apply_fake_tournament_payment_status", {
      p_purchase_id: purchaseId,
      p_status: simulation,
      p_provider_status_detail: `fake_${simulation}`,
      p_provider_payment_id: simulation === "approved" ? `fake_pay_${purchaseId}` : null,
      p_simulated_activation_error_code: null,
    })
    if (error) return jsonResponse({ error: "simulation_failed" }, 409, cors)
    return jsonResponse({ purchase: data }, 200, cors)
  } catch {
    return jsonResponse({ error: "simulation_unavailable" }, 503, cors)
  }
})
