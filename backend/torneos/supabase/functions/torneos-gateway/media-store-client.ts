// backend/torneos/supabase/functions/torneos-gateway/media-store-client.ts
//
// MEDIA-STORE-V1 — how the gateway reaches the torneos-media-store Edge Function (backend/torneos/supabase/functions/
// torneos-media-store), the only component that touches the private buckets (with the service key, inside Supabase).
// Hosted Storage refuses the bridge's RS256 tokens, so BRANDING-V1 and MEDIA-V1 no longer call Storage with the caller's
// token: every write, removal and authenticated signature goes through this client. The gateway holds no service key.
//
//   • target: hosted, the Torneos project's own function URL, derived from TORNEOS_REST_URL; the local lab, exactly
//     http://torneos-functions:9000/torneos-media-store. Anything else refuses to boot;
//   • each call carries the caller's (or the session claim's) bridge token as the identity the database judges, and an
//     HMAC-SHA256 with TORNEOS_MEDIA_STORE_SECRET over method, path, query, timestamp, body hash and identity hash.
import { parseSecret, sign, signingInput } from "./media-store-protocol.ts"

export class MediaStoreConfigError extends Error {}

export type MediaStoreContract = { url: string; secret: Uint8Array }

const HOSTED_REST = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/rest\/v1$/
const LAB_URL = "http://torneos-functions:9000/torneos-media-store"

export function loadMediaStore(env: Record<string, string | undefined>, restUrl: string,
  Fault: new (message: string) => Error = MediaStoreConfigError): MediaStoreContract {
  const secret = parseSecret(env.TORNEOS_MEDIA_STORE_SECRET)
  if (!secret) throw new Fault("TORNEOS_MEDIA_STORE_SECRET must be 64–128 hex characters")
  const hosted = HOSTED_REST.exec(restUrl.replace(/\/$/, ""))
  const explicit = (env.TORNEOS_MEDIA_STORE_URL ?? "").trim().replace(/\/$/, "")
  if (hosted) {
    const derived = `https://${hosted[1]}.supabase.co/functions/v1/torneos-media-store`
    if (explicit && explicit !== derived) throw new Fault("TORNEOS_MEDIA_STORE_URL must be the Torneos project's own function")
    return Object.freeze({ url: derived, secret })
  }
  if (explicit !== LAB_URL) throw new Fault("the media store is only the Torneos project's function (or the local lab's)")
  return Object.freeze({ url: explicit, secret })
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type StoreReply = { status: number; body: Record<string, unknown> }
export class MediaStoreUnavailable extends Error {}

/** One signed call. `identity`: the bridge token the database will judge. Throws MediaStoreUnavailable on outages. */
export async function storeCall(store: MediaStoreContract, op: string, identity: string,
  { query = "", body = new Uint8Array(0), contentType = "application/json", timeoutMs = 15000 }:
    { query?: string; body?: Uint8Array; contentType?: string; timeoutMs?: number } = {},
  fetchImpl: FetchLike = fetch, now: () => number = Date.now): Promise<StoreReply> {
  const search = query ? `?${query}` : ""
  const timestamp = String(Math.floor(now() / 1000))
  const signature = await sign(store.secret, await signingInput("POST", `/torneos-media-store/v1/${op}`, search, timestamp, body, identity))
  let response: Response
  try {
    response = await fetchImpl(`${store.url}/v1/${op}${search}`, {
      method: "POST",
      headers: { "content-type": contentType, "x-torneos-store-identity": identity, "x-torneos-store-timestamp": timestamp,
        "x-torneos-store-signature": signature },
      body: body as unknown as BodyInit, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new MediaStoreUnavailable()
  }
  let payload: unknown = null
  try { payload = await response.json() } catch { payload = null }
  if (response.status >= 500 || response.status === 401 || response.status === 404) throw new MediaStoreUnavailable()
  return { status: response.status, body: payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {} }
}

export const storeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
