// backend/torneos/supabase/functions/torneos-gateway/media-store-protocol.ts
//
// MEDIA-STORE-V1 — the request signature shared by the gateway (media-store-client.ts) and the torneos-media-store
// function (store.ts). HMAC-SHA256 with TORNEOS_MEDIA_STORE_SECRET over:
//   method \n canonical path \n query (with its "?") \n unix seconds \n sha256(body) \n sha256(identity token)
// The identity is the bridge token the database will judge: hashing it into the signature binds that token to that one
// request, so a signed request cannot be replayed with another identity.
const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("")

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))
}

export async function signingInput(method: string, pathname: string, search: string, timestamp: string, body: Uint8Array,
  identity: string): Promise<string> {
  return [method, pathname, search, timestamp, await sha256Hex(body), await sha256Hex(encoder.encode(identity))].join("\n")
}

export async function sign(secret: Uint8Array, input: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret as unknown as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(input)))
}

export function parseSecret(value: string | undefined): Uint8Array | null {
  const secretHex = (value ?? "").trim()
  if (!/^[0-9a-f]{64,128}$/.test(secretHex) || secretHex.length % 2 !== 0) return null
  return new Uint8Array(secretHex.match(/../g)!.map((pair) => parseInt(pair, 16)))
}
