// backend/torneos/supabase/functions/torneos-media-store/index.ts
//
// MEDIA-STORE-V1 entry point (Supabase Edge Function of the Torneos project, deployed with verify_jwt = false: the
// platform's JWT check only knows the project's own keys, and this function authenticates its caller itself — the
// gateway's HMAC — and the user through the Data API). A faulty configuration refuses every request (fail closed) and
// says nothing about why.
import { handle, loadStoreConfig, type StoreConfig } from "./store.ts"

let config: StoreConfig | null = null
try {
  config = loadStoreConfig(Deno.env.toObject())
} catch (error) {
  console.error("[torneos-media-store] disabled:", error instanceof Error ? error.message : "configuration")
}

Deno.serve((req: Request) => config
  ? handle(req, config)
  : new Response(JSON.stringify({ error: "UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } }))
