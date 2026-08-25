import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { corsHeaders, jsonResponse, safeUuid } from "../_shared/commercialHttp.ts"
import {
  createSupabaseCredentialFetch,
  getSupabasePublishableCredential,
} from "../_shared/supabaseApiKeys.ts"

serve(async (req) => {
  const cors = corsHeaders(req, "GET,OPTIONS")
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, cors)
  const purchaseId = safeUuid(new URL(req.url).searchParams.get("purchaseId"))
  if (!purchaseId) return jsonResponse({ error: "invalid_request" }, 400, cors)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!supabaseUrl) return jsonResponse({ error: "service_unavailable" }, 503, cors)
  try {
    const credential = getSupabasePublishableCredential()
    const client = createClient(supabaseUrl, credential.key, {
      global: {
        fetch: createSupabaseCredentialFetch(credential),
        headers: { Authorization: req.headers.get("authorization") || "" },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await client.auth.getUser()
    if (authError || !auth.user) return jsonResponse({ error: "not_authenticated" }, 401, cors)
    const { data, error } = await client.rpc("get_tournament_purchase", { p_purchase_id: purchaseId })
    if (error) return jsonResponse({ error: "purchase_not_found" }, 404, cors)
    return jsonResponse({ purchase: data }, 200, cors)
  } catch {
    return jsonResponse({ error: "purchase_unavailable" }, 503, cors)
  }
})

