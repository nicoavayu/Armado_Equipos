// supabase/functions/issue-voting-photo-token/index.ts
//
// Public (verify_jwt=false) capability-token issuer for the guest voting-photo
// upload flow. A guest voting session that has claimed a roster slot can obtain
// a single-use, short-lived token bound to (match_id, player_id,
// guest_session_id). The companion function `upload-voting-photo` requires that
// token and derives match_id/player_id ONLY from it.
//
// Identity caveat: the public voting flow does not prove a guest IS a given
// player (name self-selection under a shared match code). This token does not
// add identity proof; it enforces that a session can only ever upload for the
// ONE slot it first claimed, single-use, short expiry, rate-limited, and only
// for guest roster slots (usuario_id IS NULL) — never registered accounts.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

const MAX_REQUEST_BYTES = 4_000
const TOKEN_TTL_MS = 5 * 60 * 1000
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX_MATCH_TOKENS = 30
const RATE_LIMIT_MAX_SESSION_TOKENS = 8

const MATCH_CODE_RE = /^[A-Za-z0-9]{4,16}$/
const GUEST_SESSION_RE = /^[A-Za-z0-9_-]{6,128}$/

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

function normalizeMatchCode(value: unknown) {
  const raw = String(value ?? "").trim()
  return MATCH_CODE_RE.test(raw) ? raw : null
}

function normalizeGuestSession(value: unknown) {
  const raw = String(value ?? "").trim()
  return GUEST_SESSION_RE.test(raw) ? raw : null
}

function toPositiveInt(value: unknown) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

serve(async (req) => {
  const cors = buildCorsHeaders(req)
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonResponse(cors, 405, { error: "method_not_allowed" })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(cors, 500, { error: "server_misconfigured" })
  }

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > MAX_REQUEST_BYTES) return jsonResponse(cors, 413, { error: "payload_too_large" })
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return jsonResponse(cors, 400, { error: "invalid_json" })
  }

  const codigo = normalizeMatchCode(body?.codigo)
  const matchId = toPositiveInt(body?.matchId)
  const playerId = toPositiveInt(body?.playerId)
  const guestSessionId = normalizeGuestSession(body?.guestSessionId)

  if (!codigo || !matchId || !playerId || !guestSessionId) {
    return jsonResponse(cors, 400, { error: "invalid_arguments" })
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1) match + code must match
  const { data: match, error: matchErr } = await supabase
    .from("partidos")
    .select("id, codigo")
    .eq("id", matchId)
    .maybeSingle()
  if (matchErr) return jsonResponse(cors, 500, { error: "lookup_failed" })
  if (!match || String(match.codigo ?? "") !== codigo) {
    return jsonResponse(cors, 403, { error: "invalid_match_code" })
  }

  // 2) public voting window must be open
  const { data: votingOpen, error: votingErr } = await supabase.rpc("is_public_voting_open", {
    p_partido_id: matchId,
  })
  if (votingErr) return jsonResponse(cors, 500, { error: "voting_gate_failed" })
  if (!votingOpen) return jsonResponse(cors, 403, { error: "voting_closed" })

  // 3) player must belong to the match AND be a guest slot (no registered account)
  const { data: player, error: playerErr } = await supabase
    .from("jugadores")
    .select("id, partido_id, usuario_id")
    .eq("id", playerId)
    .eq("partido_id", matchId)
    .maybeSingle()
  if (playerErr) return jsonResponse(cors, 500, { error: "lookup_failed" })
  if (!player) return jsonResponse(cors, 404, { error: "player_not_in_match" })
  if (player.usuario_id) return jsonResponse(cors, 403, { error: "registered_player_slot" })

  const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()

  // 4) one session = one slot: reject if this session already bound another slot
  const { data: sessionRows } = await supabase
    .from("voting_photo_upload_tokens")
    .select("player_id, created_at")
    .eq("match_id", matchId)
    .eq("guest_session_id", guestSessionId)
    .gte("created_at", sinceIso)
  if (Array.isArray(sessionRows)) {
    if (sessionRows.some((r) => Number(r.player_id) !== playerId)) {
      return jsonResponse(cors, 409, { error: "session_claimed_other_slot" })
    }
    if (sessionRows.length >= RATE_LIMIT_MAX_SESSION_TOKENS) {
      return jsonResponse(cors, 429, { error: "rate_limited" })
    }
  }

  // 5) per-match rate limit
  const { count: matchCount } = await supabase
    .from("voting_photo_upload_tokens")
    .select("token_hash", { count: "exact", head: true })
    .eq("match_id", matchId)
    .gte("created_at", sinceIso)
  if (Number(matchCount ?? 0) >= RATE_LIMIT_MAX_MATCH_TOKENS) {
    return jsonResponse(cors, 429, { error: "rate_limited" })
  }

  // 6) mint single-use token
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "")
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  const { error: insertErr } = await supabase
    .from("voting_photo_upload_tokens")
    .insert({
      token_hash: tokenHash,
      match_id: matchId,
      player_id: playerId,
      guest_session_id: guestSessionId,
      expires_at: expiresAt,
    })
  if (insertErr) return jsonResponse(cors, 500, { error: "token_issue_failed" })

  return jsonResponse(cors, 200, { token, expires_at: expiresAt })
})
