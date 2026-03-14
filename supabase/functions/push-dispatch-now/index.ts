import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type KickEventType = "match_invite" | "friend_request";

type KickBody = {
  event_type?: unknown;
  match_id?: unknown;
  request_id?: unknown;
  recipient_user_id?: unknown;
  limit?: unknown;
};

type DeliveryLogRow = {
  id: string;
  notification_type: string;
  user_id: string | null;
  partido_id: number | null;
  created_at: string;
  payload_json: Record<string, unknown> | null;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_WINDOW_SECONDS = 180;
const ALLOWED_EVENT_TYPES = new Set<KickEventType>(["match_invite", "friend_request"]);

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  const reqHeaders = req.headers.get("access-control-request-headers") ?? "";
  const required = ["content-type", "authorization", "apikey", "x-client-info"];
  const allowHeaders = Array.from(
    new Set(
      reqHeaders
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
        .concat(required),
    ),
  ).join(", ");

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function parseBearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

function decodeBase64Url(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(normalized + padding);
  } catch {
    return null;
  }
}

function parseJwtClaims(req: Request): Record<string, unknown> | null {
  const token = parseBearerToken(req);
  if (!token) return null;

  const segments = token.split(".");
  if (segments.length < 2) return null;

  const payload = decodeBase64Url(segments[1]);
  if (!payload) return null;

  try {
    const claims = JSON.parse(payload);
    if (!claims || typeof claims !== "object") return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseAuthUserId(req: Request): string | null {
  const claims = parseJwtClaims(req);
  if (!claims) return null;

  const sub = String(claims.sub ?? "").trim();
  return sub || null;
}

function normalizeEventType(value: unknown): KickEventType | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!ALLOWED_EVENT_TYPES.has(normalized as KickEventType)) return null;
  return normalized as KickEventType;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

function coerceDispatchLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

function readPayloadString(payload: Record<string, unknown> | null, ...keys: string[]): string {
  if (!payload || typeof payload !== "object") return "";
  for (const key of keys) {
    const raw = payload[key];
    if (typeof raw !== "string") continue;
    const normalized = raw.trim();
    if (normalized) return normalized;
  }
  return "";
}

function isEligibleRow(
  row: DeliveryLogRow,
  actorUserId: string,
  eventType: KickEventType,
  requestId: string | null,
): boolean {
  const payload = row.payload_json ?? {};

  if (eventType === "friend_request") {
    const senderId = readPayloadString(payload, "senderId", "sender_id");
    const payloadRequestId = readPayloadString(payload, "requestId", "request_id");
    if (!senderId || senderId !== actorUserId) return false;
    if (requestId && payloadRequestId !== requestId) return false;
    return true;
  }

  const inviterId = readPayloadString(payload, "inviter_id", "inviterId", "senderId", "sender_id");
  if (!inviterId || inviterId !== actorUserId) return false;
  return true;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, reason: "method_not_allowed" }, 405, cors);
  }

  const actorUserId = parseAuthUserId(req);
  if (!actorUserId) {
    return jsonResponse({ ok: false, reason: "unauthorized" }, 401, cors);
  }

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRoleKey = String(Deno.env.get("SERVICE_ROLE_KEY") ?? "").trim();
  const senderSecret = String(Deno.env.get("PUSH_SENDER_SECRET") ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey || !senderSecret) {
    return jsonResponse({ ok: false, reason: "missing_sender_env" }, 500, cors);
  }

  const body = await req.json().catch(() => ({} as KickBody));
  const eventType = normalizeEventType((body as KickBody).event_type);
  if (!eventType) {
    return jsonResponse({ ok: false, reason: "invalid_event_type" }, 400, cors);
  }

  const requestId = normalizeOptionalString((body as KickBody).request_id);
  const recipientUserId = normalizeOptionalString((body as KickBody).recipient_user_id);
  const matchId = normalizeOptionalInt((body as KickBody).match_id);
  const dispatchLimit = coerceDispatchLimit((body as KickBody).limit);
  const windowSeconds = Math.max(
    30,
    Number(Deno.env.get("PUSH_DISPATCH_KICK_WINDOW_SECONDS") ?? DEFAULT_WINDOW_SECONDS) || DEFAULT_WINDOW_SECONDS,
  );
  const windowStartIso = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let query = supabase
    .from("notification_delivery_log")
    .select("id, notification_type, user_id, partido_id, created_at, payload_json")
    .eq("channel", "push")
    .eq("status", "queued")
    .eq("notification_type", eventType)
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (recipientUserId) {
    query = query.eq("user_id", recipientUserId);
  }
  if (eventType === "match_invite" && matchId !== null) {
    query = query.eq("partido_id", matchId);
  }

  const { data: candidateRows, error: candidateError } = await query;
  if (candidateError) {
    return jsonResponse(
      { ok: false, reason: "queued_lookup_failed", details: candidateError.message },
      500,
      cors,
    );
  }

  const candidates = (candidateRows ?? []) as DeliveryLogRow[];
  const eligibleRows = candidates.filter((row) => isEligibleRow(row, actorUserId, eventType, requestId));

  if (eligibleRows.length === 0) {
    return jsonResponse({
      ok: true,
      invoked: false,
      reason: "no_recent_eligible_queued_rows",
      event_type: eventType,
      candidate_count: candidates.length,
      eligible_count: 0,
    }, 200, cors);
  }

  const pushSenderUrl = String(Deno.env.get("PUSH_SENDER_URL") ?? "").trim() ||
    `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/push-sender`;

  const pushRes = await fetch(pushSenderUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "x-push-sender-secret": senderSecret,
    },
    body: JSON.stringify({
      worker_id: `immediate_dispatch_${eventType}`,
      limit: dispatchLimit,
      dry_run: false,
    }),
  });

  const rawSenderBody = await pushRes.text();
  let senderBody: Record<string, unknown> | null = null;
  try {
    senderBody = JSON.parse(rawSenderBody) as Record<string, unknown>;
  } catch {
    senderBody = null;
  }

  if (!pushRes.ok) {
    return jsonResponse(
      {
        ok: false,
        reason: "push_sender_http_error",
        http_status: pushRes.status,
        sender_reason: senderBody?.reason ?? null,
      },
      502,
      cors,
    );
  }

  if (senderBody && senderBody.ok !== true) {
    return jsonResponse(
      {
        ok: false,
        reason: "push_sender_rejected",
        sender_reason: senderBody.reason ?? null,
        sender_status: senderBody.status ?? null,
      },
      502,
      cors,
    );
  }

  return jsonResponse(
    {
      ok: true,
      invoked: true,
      event_type: eventType,
      eligible_count: eligibleRows.length,
      dispatched_by: "push-dispatch-now",
      sender_summary: senderBody
        ? {
          ok: senderBody.ok ?? null,
          processed: senderBody.processed ?? null,
          sent: senderBody.sent ?? null,
          failed: senderBody.failed ?? null,
          retryable_failed: senderBody.retryable_failed ?? null,
          reason: senderBody.reason ?? null,
        }
        : null,
    },
    200,
    cors,
  );
});
