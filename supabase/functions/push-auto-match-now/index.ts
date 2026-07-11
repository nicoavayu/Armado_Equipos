import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Body = { event_type?: unknown; limit?: unknown };
type DeliveryRow = {
  id: string;
  user_id: string | null;
  notification_type: string;
  payload_json: Record<string, unknown> | null;
  created_at: string;
};

const ALLOWED_TYPES = new Set([
  "auto_match_gestating",
  "auto_match_almost_full",
  "auto_match_ready",
  "auto_match_cancelled",
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  const requested = req.headers.get("access-control-request-headers") ?? "";
  const headers = Array.from(new Set(
    requested.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
      .concat(["content-type", "authorization", "apikey", "x-client-info"]),
  )).join(", ");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": headers,
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function bearer(req: Request): string | null {
  const raw = req.headers.get("authorization") ?? "";
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  return raw.slice(7).trim() || null;
}

function decodeUserId(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const claims = JSON.parse(atob(padded));
    return String(claims?.sub ?? "").trim() || null;
  } catch {
    return null;
  }
}

function proposalId(payload: Record<string, unknown> | null): number | null {
  const parsed = Number(payload?.proposal_id ?? payload?.proposalId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405, headers);

  const token = bearer(req);
  const actorUserId = token ? decodeUserId(token) : null;
  if (!actorUserId) return json({ ok: false, reason: "unauthorized" }, 401, headers);

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRoleKey = String(Deno.env.get("SERVICE_ROLE_KEY") ?? "").trim();
  const senderSecret = String(Deno.env.get("PUSH_SENDER_SECRET") ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey || !senderSecret) {
    return json({ ok: false, reason: "missing_sender_env" }, 500, headers);
  }

  const body = await req.json().catch(() => ({} as Body));
  const eventType = String((body as Body).event_type ?? "").trim().toLowerCase();
  if (!ALLOWED_TYPES.has(eventType)) {
    return json({ ok: false, reason: "invalid_event_type" }, 400, headers);
  }

  const requestedLimit = Number((body as Body).limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.round(requestedLimit))) : 100;
  const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error: rowsError } = await admin
    .from("notification_delivery_log")
    .select("id, user_id, notification_type, payload_json, created_at")
    .eq("channel", "push")
    .eq("status", "queued")
    .eq("notification_type", eventType)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (rowsError) {
    return json({ ok: false, reason: "queued_lookup_failed", details: rowsError.message }, 500, headers);
  }

  const candidates = (rows ?? []) as DeliveryRow[];
  const proposalIds = Array.from(new Set(candidates.map((row) => proposalId(row.payload_json)).filter((id): id is number => id !== null)));
  if (proposalIds.length === 0) {
    return json({ ok: true, invoked: false, reason: "no_recent_rows" }, 200, headers);
  }

  const { data: memberships, error: membershipError } = await admin
    .from("auto_match_proposal_members")
    .select("proposal_id")
    .eq("user_id", actorUserId)
    .in("proposal_id", proposalIds);

  if (membershipError) {
    return json({ ok: false, reason: "membership_lookup_failed", details: membershipError.message }, 500, headers);
  }

  const allowedProposalIds = new Set((memberships ?? []).map((row) => Number(row.proposal_id)));
  const eligibleIds = candidates
    .filter((row) => {
      const id = proposalId(row.payload_json);
      return id !== null && allowedProposalIds.has(id);
    })
    .map((row) => row.id);

  if (eligibleIds.length === 0) {
    return json({ ok: true, invoked: false, reason: "no_eligible_rows" }, 200, headers);
  }

  const pushSenderUrl = String(Deno.env.get("PUSH_SENDER_URL") ?? "").trim()
    || `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/push-sender`;

  const senderResponse = await fetch(pushSenderUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "x-push-sender-secret": senderSecret,
    },
    body: JSON.stringify({
      worker_id: `immediate_${eventType}`,
      limit: eligibleIds.length,
      log_ids: eligibleIds,
      dry_run: false,
    }),
  });

  const raw = await senderResponse.text();
  let senderBody: Record<string, unknown> | null = null;
  try { senderBody = JSON.parse(raw); } catch { senderBody = null; }

  if (!senderResponse.ok || senderBody?.ok !== true) {
    return json({
      ok: false,
      reason: "push_sender_rejected",
      status: senderResponse.status,
      sender_reason: senderBody?.reason ?? null,
    }, 502, headers);
  }

  return json({
    ok: true,
    invoked: true,
    event_type: eventType,
    dispatch_count: eligibleIds.length,
    sender_summary: senderBody,
  }, 200, headers);
});
