import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  const reqHeaders = req.headers.get("access-control-request-headers") ?? "";
  const required = ["content-type", "apikey", "authorization", "x-client-info"];
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

function normalizeRequestId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

async function requestImmediateApprovalPush({
  supabaseUrl,
  anonKey,
  authHeader,
  matchId,
  requestId,
  recipientUserId,
}: {
  supabaseUrl: string;
  anonKey: string;
  authHeader: string;
  matchId: number;
  requestId: string;
  recipientUserId: string;
}) {
  if (!authHeader.trim()) return { ok: false, reason: "missing_auth_header" };

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/push-dispatch-now`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: anonKey,
      },
      body: JSON.stringify({
        event_type: "match_join_approved",
        match_id: matchId,
        request_id: requestId,
        recipient_user_id: recipientUserId,
        limit: 5,
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.warn("[APPROVE_JOIN_REQUEST] immediate approval push dispatch failed", {
        matchId,
        requestId,
        recipientUserId,
        status: response.status,
        details,
      });
      return { ok: false, reason: "dispatch_http_error", status: response.status, details };
    }

    const data = await response.json().catch(() => null);
    if (!data?.ok) {
      console.warn("[APPROVE_JOIN_REQUEST] immediate approval push dispatch rejected", {
        matchId,
        requestId,
        recipientUserId,
        reason: data?.reason ?? "unknown",
      });
      return { ok: false, reason: data?.reason ?? "dispatch_rejected" };
    }

    return { ok: true, result: data };
  } catch (error) {
    console.warn("[APPROVE_JOIN_REQUEST] immediate approval push dispatch exception", {
      matchId,
      requestId,
      recipientUserId,
      message: (error as Error)?.message ?? String(error),
    });
    return { ok: false, reason: "dispatch_exception" };
  }
}

serve(async (req) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "method_not_allowed" }, 405, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ ok: false, message: "missing_env" }, 500, cors);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ ok: false, message: "not_authenticated" }, 401, cors);
  }

  const body = await req.json().catch(() => null);
  const requestId = normalizeRequestId(body?.request_id ?? body?.requestId);
  if (!requestId) {
    return jsonResponse({ ok: false, message: "invalid_request_id" }, 400, cors);
  }

  const { data, error } = await userClient.rpc("approve_join_request", {
    p_request_id: requestId,
  });

  if (error) {
    const message = normalizeString(error.message) ?? "approve_failed";
    if (error.code === "42501" || message === "Forbidden") {
      return jsonResponse({ ok: false, message: "forbidden" }, 403, cors);
    }
    if (message.includes("Solicitud no encontrada")) {
      return jsonResponse({ ok: false, message: "not_found" }, 404, cors);
    }
    if (message.includes("El jugador ya está en el partido") || error.code === "23505") {
      return jsonResponse({
        ok: true,
        status: "already_in_match",
        request_id: requestId,
        notification_id: null,
        push_dispatch: null,
      }, 200, cors);
    }
    return jsonResponse({ ok: false, message: "approve_failed", details: message }, 500, cors);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const matchId = normalizeRequestId(row?.match_id);
  const recipientUserId = normalizeString(row?.user_id);
  const normalizedRequestId = normalizeString(row?.request_id) ?? String(requestId);

  let pushResult: Record<string, unknown> | null = null;
  if (matchId && recipientUserId) {
    pushResult = await requestImmediateApprovalPush({
      supabaseUrl,
      anonKey,
      authHeader,
      matchId,
      requestId: normalizedRequestId,
      recipientUserId,
    });
  }

  return jsonResponse({
    ok: true,
    status: normalizeString(row?.status) ?? "approved",
    match_id: row?.match_id ?? null,
    user_id: row?.user_id ?? null,
    request_id: row?.request_id ?? requestId,
    notification_id: row?.notification_id ?? null,
    push_dispatch: pushResult,
  }, 200, cors);
});
