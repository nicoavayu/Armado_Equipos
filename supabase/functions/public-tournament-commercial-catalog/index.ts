import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { corsHeaders, jsonResponse } from "../_shared/commercialHttp.ts"
import {
  createSupabaseCredentialFetch,
  getSupabasePublishableCredential,
} from "../_shared/supabaseApiKeys.ts"

serve(async (req) => {
  const cors = corsHeaders(req, "GET,OPTIONS")
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, cors)

  const version = Number(new URL(req.url).searchParams.get("v") ?? "1")
  if (version !== 1) return jsonResponse({ error: "unsupported_version" }, 400, cors)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!supabaseUrl) return jsonResponse({ error: "service_unavailable" }, 503, cors)

  try {
    const credential = getSupabasePublishableCredential()
    const client = createClient(supabaseUrl, credential.key, {
      global: { fetch: createSupabaseCredentialFetch(credential) },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client.rpc("get_public_tournament_commercial_catalog", {
      p_version: version,
    })
    if (error || !data) return jsonResponse({ error: "catalog_unavailable" }, 503, cors)
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    })
  } catch {
    return jsonResponse({ error: "catalog_unavailable" }, 503, cors)
  }
})
