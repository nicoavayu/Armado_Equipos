// supabase/functions/torneos-core-contract/index.ts
//
// Core → Torneos contract v1 (Phase 3A). The ONLY surface through which the
// isolated Torneos backend learns anything from Core: verified-email check at
// invitation acceptance, the restricted player/team directory, and the frozen
// team snapshot for competition import. Core remains the source of truth; the
// caller is the Torneos server, never a browser.
//
// Service-to-service like push-sender: verify_jwt = false and the handler
// authenticates each request with an HMAC-SHA256 signature over
// `path + "\n" + X-Time + "\n" + X-Nonce + "\n" + body` (±30 s window). Nonce
// replay, the Core session check, rate limiting and every projection run inside
// public.torneos_contract_execute in one transaction, executed with the service
// credential. Request/response schemas: backend/torneos/phase2a/schemas.json.
//
// No email address, verification timestamp, phone, document, password, session
// or membership data crosses this boundary beyond the strict allowlist. Nothing
// about a request, its headers or its body is ever logged.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  createSupabaseCredentialFetch,
  getSupabaseSecretCredential,
} from "../_shared/supabaseApiKeys.ts"
import {
  handleContractRequest,
  parseServiceSecret,
} from "../_shared/torneosCoreContract.ts"

const RELEASE = "0.1.0"
const FUNCTION_NAME = "torneos-core-contract"

type ServiceClient = ReturnType<typeof createClient>

let cachedService: ServiceClient | null = null

function service(): ServiceClient {
  if (cachedService) return cachedService
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  if (!supabaseUrl) throw new Error("supabase_url_misconfigured")
  const credential = getSupabaseSecretCredential()
  cachedService = createClient(supabaseUrl, credential.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseCredentialFetch(credential) },
  })
  return cachedService
}

const secret = parseServiceSecret(Deno.env.get("TORNEOS_CONTRACT_SERVICE_SECRET"))
if (!secret) {
  // Fail closed: every request answers 503 until the secret is configured.
  console.error(`[TORNEOS_CORE_CONTRACT] release=${RELEASE} service secret misconfigured`)
}

serve((req: Request) =>
  handleContractRequest(req, {
    functionName: FUNCTION_NAME,
    secret,
    async execute(operation, nonce, request) {
      const { data, error } = await service().rpc("torneos_contract_execute", {
        p_operation: operation,
        p_nonce: nonce,
        p_request: request,
      })
      if (error) throw new Error("torneos_contract_execute_failed")
      return data
    },
  })
)
