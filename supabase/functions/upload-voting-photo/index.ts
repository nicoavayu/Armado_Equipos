// supabase/functions/upload-voting-photo/index.ts
//
// Public (verify_jwt=false) guest voting-photo upload. Requires a single-use
// capability token issued by `issue-voting-photo-token`. The token is consumed
// ATOMICALLY and match_id/player_id are derived EXCLUSIVELY from the consumed
// row — never from the client. The photo is stored under a random name (no
// overwrite) with service_role, and only the matching GUEST roster slot's
// jugadores.avatar_url is updated. usuarios.avatar_url is never touched, and a
// registered participant's slot can never be modified through this path.
//
// If the upload fails AFTER the token is consumed, the caller must request a
// fresh token (subject to the issuer's rate limit).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

const MAX_DATA_URL_LENGTH = 8_000_000 // ~6 MB image encoded as base64 data URL
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TOKEN_RE = /^[A-Za-z0-9-]{32,160}$/
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

type SupabaseClient = ReturnType<typeof createClient>

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*"
  const reqHeaders = req.headers.get("access-control-request-headers") ?? ""
  const required = ["content-type", "apikey", "authorization", "x-client-info"]
  const allowHeaders = Array.from(
    new Set(
      reqHeaders.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).concat(required),
    ),
  ).join(", ")
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  }
}

function jsonResponse(cors: Record<string, string>, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

serve(async (req) => {
  const cors = buildCorsHeaders(req)
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonResponse(cors, 405, { error: "method_not_allowed" })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return jsonResponse(cors, 500, { error: "server_misconfigured" })

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > MAX_DATA_URL_LENGTH + 4_000) return jsonResponse(cors, 413, { error: "payload_too_large" })
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return jsonResponse(cors, 400, { error: "invalid_json" })
  }

  const token = String(body?.token ?? "").trim()
  const imageDataUrl = String(body?.imageBase64 ?? "").trim()

  if (!TOKEN_RE.test(token)) return jsonResponse(cors, 400, { error: "invalid_token_format" })
  if (!imageDataUrl || imageDataUrl.length > MAX_DATA_URL_LENGTH) {
    return jsonResponse(cors, 400, { error: "invalid_image" })
  }

  const match = DATA_URL_RE.exec(imageDataUrl)
  if (!match) return jsonResponse(cors, 415, { error: "unsupported_media_type" })
  const mime = match[1].toLowerCase() === "jpg" ? "image/jpeg" : `image/${match[1].toLowerCase()}`
  const ext = EXT_BY_MIME[mime] ?? "jpg"

  let bytes: Uint8Array
  try {
    bytes = decodeBase64(match[2])
  } catch {
    return jsonResponse(cors, 400, { error: "invalid_image" })
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    return jsonResponse(cors, 413, { error: "image_too_large" })
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // --- Consume the capability token ATOMICALLY --------------------------------
  // UPDATE ... SET used_at = now() WHERE token_hash = ? AND used_at IS NULL
  //   AND expires_at > now() RETURNING match_id, player_id, guest_session_id
  const tokenHash = await sha256Hex(token)
  const nowIso = new Date().toISOString()
  const { data: consumed, error: consumeErr } = await supabase
    .from("voting_photo_upload_tokens")
    .update({ used_at: nowIso })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("match_id, player_id, guest_session_id")
  if (consumeErr) return jsonResponse(cors, 500, { error: "token_consume_failed" })
  if (!Array.isArray(consumed) || consumed.length === 0) {
    return jsonResponse(cors, 401, { error: "invalid_or_expired_token" })
  }

  const matchId = Number(consumed[0].match_id)
  const playerId = Number(consumed[0].player_id)

  // --- Defense in depth: re-validate voting window + guest slot ---------------
  const { data: votingOpen, error: votingErr } = await supabase.rpc("is_public_voting_open", {
    p_partido_id: matchId,
  })
  if (votingErr) return jsonResponse(cors, 500, { error: "voting_gate_failed" })
  if (!votingOpen) return jsonResponse(cors, 403, { error: "voting_closed" })

  const { data: player, error: playerErr } = await supabase
    .from("jugadores")
    .select("id, partido_id, usuario_id")
    .eq("id", playerId)
    .eq("partido_id", matchId)
    .maybeSingle()
  if (playerErr) return jsonResponse(cors, 500, { error: "lookup_failed" })
  if (!player) return jsonResponse(cors, 404, { error: "player_not_in_match" })
  if (player.usuario_id) return jsonResponse(cors, 403, { error: "registered_player_slot" })

  // --- Upload with a random name (no overwrite), then point the slot at it ----
  const objectName = `guest/${matchId}/${crypto.randomUUID()}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from("jugadores-fotos")
    .upload(objectName, bytes, { contentType: mime, upsert: false })
  if (uploadErr) {
    // Token already consumed; caller must request a fresh token to retry.
    return jsonResponse(cors, 502, { error: "upload_failed" })
  }

  const { data: publicUrlData } = supabase.storage.from("jugadores-fotos").getPublicUrl(objectName)
  const publicUrl = publicUrlData?.publicUrl
  if (!publicUrl) return jsonResponse(cors, 500, { error: "public_url_failed" })
  const cacheBusted = `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}cb=${Date.now()}`

  // Only the matching GUEST slot; never usuarios, never a registered slot.
  const { error: updateErr } = await supabase
    .from("jugadores")
    .update({ avatar_url: cacheBusted })
    .eq("id", playerId)
    .eq("partido_id", matchId)
    .is("usuario_id", null)
  if (updateErr) return jsonResponse(cors, 500, { error: "slot_update_failed" })

  return jsonResponse(cors, 200, { url: cacheBusted })
})
