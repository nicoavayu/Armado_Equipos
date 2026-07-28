// supabase/functions/join-match-guest/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  createSupabaseCredentialFetch,
  getSupabaseSecretCredential,
} from "../_shared/supabaseApiKeys.ts"

const MAX_REQUEST_BYTES = 200_000
const MAX_PLAYER_NAME_LENGTH = 40
const MAX_GUEST_AVATAR_DATA_URL_LENGTH = 150_000
const ATTEMPT_RETENTION_DAYS = 7
const CLEANUP_SAMPLE_RATE = 0.03
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX_IP_ATTEMPTS = 18
const RATE_LIMIT_MAX_MATCH_ATTEMPTS = 8
const RATE_LIMIT_MAX_IP_FAILURES = 10
const RATE_LIMIT_MAX_MATCH_FAILURES = 5
const RETRY_AFTER_SECONDS = 10 * 60

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MATCH_CODE_RE = /^[A-Za-z0-9]{4,16}$/
const INVITE_TOKEN_RE = /^[a-f0-9]{32}$/i
const SAFE_NAME_RE = /^[\p{L}\p{N} .,'_-]+$/u
const AVATAR_DATA_URL_RE = /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i

type SupabaseClient = ReturnType<typeof createClient>

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*"
  const reqHeaders = req.headers.get("access-control-request-headers") ?? ""
  const required = ["content-type", "apikey", "authorization", "x-client-info"]

  const allowHeaders = Array.from(
    new Set(
      reqHeaders
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean)
        .concat(required),
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

function jsonResponse(
  cors: Record<string, string>,
  status: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  })
}

function normalizePlayerName(value: unknown) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!raw) return null
  if (raw.length > MAX_PLAYER_NAME_LENGTH) return null
  if (!SAFE_NAME_RE.test(raw)) return null
  return raw
}

function normalizeMatchCode(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!MATCH_CODE_RE.test(raw)) return null
  return raw
}

function normalizeInviteToken(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!INVITE_TOKEN_RE.test(raw)) return null
  return raw
}

function normalizeGuestUuid(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  if (!UUID_RE.test(raw)) return null
  return raw
}

function normalizeAvatarDataUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) {
    return { avatarDataUrl: null, avatarRejected: false }
  }
  if (raw.length > MAX_GUEST_AVATAR_DATA_URL_LENGTH) {
    return { avatarDataUrl: null, avatarRejected: true }
  }
  if (!AVATAR_DATA_URL_RE.test(raw)) {
    return { avatarDataUrl: null, avatarRejected: true }
  }
  return { avatarDataUrl: raw, avatarRejected: false }
}

function getClientIp(req: Request) {
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ]
  const first = candidates.find((value) => typeof value === "string" && value.trim() !== "")
  return first?.trim() ?? "unknown"
}

function getUserAgent(req: Request) {
  return String(req.headers.get("user-agent") ?? "").trim().slice(0, 255) || null
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function cleanupOldAttempts(supabase: SupabaseClient) {
  if (Math.random() > CLEANUP_SAMPLE_RATE) return
  const cutoff = new Date(Date.now() - (ATTEMPT_RETENTION_DAYS * 24 * 60 * 60 * 1000)).toISOString()
  try {
    await supabase
      .from("guest_join_attempt_log")
      .delete()
      .lt("created_at", cutoff)
  } catch (error) {
    console.warn("[INVITE] guest join attempt cleanup failed", error)
  }
}

async function countAttempts(
  supabase: SupabaseClient,
  sinceIso: string,
  {
    ipHash,
    partidoId,
    failureOnly = false,
  }: {
    ipHash: string
    partidoId?: number
    failureOnly?: boolean
  },
) {
  let query = supabase
    .from("guest_join_attempt_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceIso)

  if (typeof partidoId === "number") {
    query = query.eq("partido_id", partidoId)
  }

  if (failureOnly) {
    query = query.not("failure_reason", "is", null)
  }

  const { count, error } = await query
  if (error) {
    console.warn("[INVITE] guest join attempt count failed", {
      code: error.code,
      message: error.message,
    })
    return 0
  }
  return Number(count ?? 0)
}

async function recordAttempt(
  supabase: SupabaseClient,
  {
    ipHash,
    partidoId,
    inviteTokenHash,
    guestUuid,
    outcome,
    failureReason,
    userAgent,
  }: {
    ipHash: string
    partidoId: number
    inviteTokenHash: string
    guestUuid?: string | null
    outcome: string
    failureReason?: string | null
    userAgent?: string | null
  },
) {
  try {
    await supabase
      .from("guest_join_attempt_log")
      .insert({
        ip_hash: ipHash,
        partido_id: partidoId,
        invite_token_hash: inviteTokenHash,
        guest_uuid: guestUuid ?? null,
        outcome,
        failure_reason: failureReason ?? null,
        user_agent: userAgent ?? null,
      })
  } catch (error) {
    console.warn("[INVITE] guest join attempt log failed", error)
  }
}

async function enforceRateLimit(
  supabase: SupabaseClient,
  {
    ipHash,
    partidoId,
  }: {
    ipHash: string
    partidoId: number
  },
) {
  const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const [ipAttempts, matchAttempts, ipFailures, matchFailures] = await Promise.all([
    countAttempts(supabase, sinceIso, { ipHash }),
    countAttempts(supabase, sinceIso, { ipHash, partidoId }),
    countAttempts(supabase, sinceIso, { ipHash, failureOnly: true }),
    countAttempts(supabase, sinceIso, { ipHash, partidoId, failureOnly: true }),
  ])

  const limited = (
    ipAttempts >= RATE_LIMIT_MAX_IP_ATTEMPTS
    || matchAttempts >= RATE_LIMIT_MAX_MATCH_ATTEMPTS
    || ipFailures >= RATE_LIMIT_MAX_IP_FAILURES
    || matchFailures >= RATE_LIMIT_MAX_MATCH_FAILURES
  )

  return {
    limited,
    ipAttempts,
    matchAttempts,
    ipFailures,
    matchFailures,
  }
}

async function notifyMatchJoin({
  supabase,
  partidoId,
  playerName,
}: {
  supabase: SupabaseClient
  partidoId: number
  playerName: string
}) {
  const payload = {
    match_id: partidoId,
    matchId: partidoId,
    player_name: playerName,
    player_user_id: null,
    joined_via: "guest_invite",
    link: `/partido-publico/${partidoId}`,
  }

  const { error: participantErr } = await supabase.rpc("enqueue_match_participant_notification", {
    p_partido_id: partidoId,
    p_type: "match_update",
    p_title: "Nuevo jugador en el partido",
    p_message: `${playerName} se sumó al partido.`,
    p_payload: payload,
    p_exclude_user_id: null,
    p_include_admin: true,
  })

  if (!participantErr) {
    return { ok: true, mode: "participant_fanout" }
  }

  console.warn("[INVITE] participant notification fanout failed", {
    partidoId,
    code: participantErr.code,
    message: participantErr.message,
  })

  const { error: adminErr } = await supabase.rpc("enqueue_partido_notification", {
    p_partido_id: partidoId,
    p_type: "match_update",
    p_title: "Nuevo jugador en el partido",
    p_message: `${playerName} se sumó al partido.`,
    p_payload: {
      ...payload,
      participant_fanout_fallback: true,
      participant_fanout_reason: participantErr.message ?? "rpc_error",
    },
  })

  if (!adminErr) {
    return { ok: true, mode: "admin_fallback" }
  }

  console.warn("[INVITE] admin notification fallback failed", {
    partidoId,
    code: adminErr.code,
    message: adminErr.message,
  })
  return { ok: false, mode: "failed" }
}

serve(async (req) => {
  const cors = buildCorsHeaders(req)
  let supabase: SupabaseClient | null = null
  let auditPartidoId: number | null = null
  let auditInviteHash = ""
  let auditIpHash = ""
  let auditGuestUuid: string | null = null
  let auditUserAgent: string | null = null

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== "POST") {
    return jsonResponse(cors, 405, { ok: false, reason: "method_not_allowed" })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceCredential = getSupabaseSecretCredential()

    if (!supabaseUrl) {
      return jsonResponse(cors, 500, { ok: false, reason: "missing_env" })
    }

    const contentType = String(req.headers.get("content-type") ?? "")
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(cors, 415, { ok: false, reason: "unsupported_content_type" })
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0")
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return jsonResponse(cors, 413, { ok: false, reason: "payload_too_large" })
    }

    const rawBody = await req.text()
    if (!rawBody) {
      return jsonResponse(cors, 400, { ok: false, reason: "invalid_json" })
    }

    const rawBodySize = new TextEncoder().encode(rawBody).length
    if (rawBodySize > MAX_REQUEST_BYTES) {
      return jsonResponse(cors, 413, { ok: false, reason: "payload_too_large" })
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(rawBody)
    } catch {
      return jsonResponse(cors, 400, { ok: false, reason: "invalid_json" })
    }
    const partidoIdNum = Number(body?.partido_id)
    const playerName = normalizePlayerName(body?.nombre)
    const codigo = normalizeMatchCode(body?.codigo)
    const inviteToken = normalizeInviteToken(body?.invite)
    const guestUuid = normalizeGuestUuid(body?.guest_uuid)
    const { avatarDataUrl, avatarRejected } = normalizeAvatarDataUrl(body?.avatar_data_url)

    if (!Number.isSafeInteger(partidoIdNum) || partidoIdNum <= 0) {
      return jsonResponse(cors, 400, { ok: false, reason: "invalid_partido_id" })
    }

    if (!playerName) {
      return jsonResponse(cors, 400, { ok: false, reason: "invalid_name" })
    }

    if (!codigo || !inviteToken) {
      return jsonResponse(cors, 400, { ok: false, reason: "invalid_payload" })
    }

    auditPartidoId = partidoIdNum
    auditGuestUuid = guestUuid
    auditUserAgent = getUserAgent(req)
    auditIpHash = await sha256Hex(getClientIp(req))
    auditInviteHash = await sha256Hex(inviteToken)

    supabase = createClient(supabaseUrl, serviceCredential.key, {
      global: { fetch: createSupabaseCredentialFetch(serviceCredential) },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    await cleanupOldAttempts(supabase)

    const rateLimit = await enforceRateLimit(supabase, {
      ipHash: auditIpHash,
      partidoId: partidoIdNum,
    })

    if (rateLimit.limited) {
      console.warn("[INVITE] guest join rate limited", {
        partidoId: partidoIdNum,
        ipHash: auditIpHash,
        ipAttempts: rateLimit.ipAttempts,
        matchAttempts: rateLimit.matchAttempts,
        ipFailures: rateLimit.ipFailures,
        matchFailures: rateLimit.matchFailures,
      })

      await recordAttempt(supabase, {
        ipHash: auditIpHash,
        partidoId: partidoIdNum,
        inviteTokenHash: auditInviteHash,
        guestUuid,
        outcome: "rate_limited",
        failureReason: "rate_limited",
        userAgent: auditUserAgent,
      })

      return jsonResponse(
        cors,
        429,
        {
          ok: false,
          reason: "rate_limited",
          retry_after_seconds: RETRY_AFTER_SECONDS,
        },
        { "Retry-After": String(RETRY_AFTER_SECONDS) },
      )
    }

    const { data: partido, error: partidoError } = await supabase
      .from("partidos")
      .select("id,codigo,cupo_jugadores")
      .eq("id", partidoIdNum)
      .maybeSingle()

    if (partidoError || !partido) {
      await recordAttempt(supabase, {
        ipHash: auditIpHash,
        partidoId: partidoIdNum,
        inviteTokenHash: auditInviteHash,
        guestUuid,
        outcome: "not_found",
        failureReason: "not_found",
        userAgent: auditUserAgent,
      })
      return jsonResponse(cors, 404, { ok: false, reason: "not_found" })
    }

    if (codigo !== String(partido.codigo ?? "").trim()) {
      await recordAttempt(supabase, {
        ipHash: auditIpHash,
        partidoId: partidoIdNum,
        inviteTokenHash: auditInviteHash,
        guestUuid,
        outcome: "invalid_code",
        failureReason: "invalid_code",
        userAgent: auditUserAgent,
      })
      return jsonResponse(cors, 401, { ok: false, reason: "invalid_code" })
    }

    if (avatarRejected) {
      console.warn("[INVITE] guest avatar payload rejected", {
        partidoId: partidoIdNum,
        ipHash: auditIpHash,
      })
    }

    const safeGuestUuid = guestUuid ?? crypto.randomUUID()

    const { data: joinRows, error: joinError } = await supabase.rpc(
      "join_guest_match_with_invite",
      {
        p_partido_id: partidoIdNum,
        p_token: inviteToken,
        p_guest_uuid: safeGuestUuid,
        p_nombre: playerName,
        p_avatar_url: avatarDataUrl,
      },
    )

    if (joinError) {
      console.warn("[INVITE] atomic guest join failed", {
        partidoId: partidoIdNum,
        code: joinError.code,
        message: joinError.message,
      })
      await recordAttempt(supabase, {
        ipHash: auditIpHash,
        partidoId: partidoIdNum,
        inviteTokenHash: auditInviteHash,
        guestUuid: safeGuestUuid,
        outcome: "db_error",
        failureReason: "db_error",
        userAgent: auditUserAgent,
      })
      return jsonResponse(cors, 500, { ok: false, reason: "db_error" })
    }

    const join = Array.isArray(joinRows) ? joinRows[0] : null
    const joinStatus = String(join?.status ?? "db_error")

    if (!join?.ok) {
      const responseByStatus: Record<string, { status: number; reason: string }> = {
        invalid_invite: { status: 401, reason: "invalid_invite" },
        full: { status: 409, reason: "full" },
        guest_identity_conflict: { status: 409, reason: "guest_identity_conflict" },
        invalid_payload: { status: 400, reason: "invalid_payload" },
        not_found: { status: 404, reason: "not_found" },
      }
      const failure = responseByStatus[joinStatus] ?? { status: 500, reason: "db_error" }

      await recordAttempt(supabase, {
        ipHash: auditIpHash,
        partidoId: partidoIdNum,
        inviteTokenHash: auditInviteHash,
        guestUuid: safeGuestUuid,
        outcome: joinStatus,
        failureReason: failure.reason,
        userAgent: auditUserAgent,
      })
      return jsonResponse(cors, failure.status, { ok: false, reason: failure.reason })
    }

    const jugador = {
      id: join.jugador_id,
      nombre: join.nombre,
      uuid: join.uuid,
      is_substitute: join.is_substitute,
      substitute_order: join.substitute_order,
    }

    if (joinStatus === "already_joined") {
      await recordAttempt(supabase, {
        ipHash: auditIpHash,
        partidoId: partidoIdNum,
        inviteTokenHash: auditInviteHash,
        guestUuid: safeGuestUuid,
        outcome: "already_joined",
        userAgent: auditUserAgent,
      })
      return jsonResponse(cors, 200, {
        ok: true,
        already_joined: true,
        guest_uuid: jugador.uuid,
        jugador,
      })
    }

    await recordAttempt(supabase, {
      ipHash: auditIpHash,
      partidoId: partidoIdNum,
      inviteTokenHash: auditInviteHash,
      guestUuid: safeGuestUuid,
      outcome: "accepted",
      userAgent: auditUserAgent,
    })

    await notifyMatchJoin({
      supabase,
      partidoId: partidoIdNum,
      playerName,
    })

    return jsonResponse(cors, 200, {
      ok: true,
      guest_uuid: jugador.uuid,
      jugador,
    })
  } catch (error) {
    console.error("[INVITE] join-match-guest unexpected error", error)

    if (supabase && auditPartidoId && auditIpHash && auditInviteHash) {
      await recordAttempt(supabase, {
        ipHash: auditIpHash,
        partidoId: auditPartidoId,
        inviteTokenHash: auditInviteHash,
        guestUuid: auditGuestUuid,
        outcome: "internal_error",
        failureReason: "internal_error",
        userAgent: auditUserAgent,
      })
    }

    return jsonResponse(cors, 500, {
      ok: false,
      reason: "internal_error",
    })
  }
})
