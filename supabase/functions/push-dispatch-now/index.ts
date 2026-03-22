import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type KickEventType =
  | "match_invite"
  | "friend_request"
  | "match_join_request"
  | "match_player_left"
  | "challenge_accepted"
  | "team_invite"
  | "call_to_vote"
  | "match_kicked";

type KickBody = {
  event_type?: unknown;
  match_id?: unknown;
  challenge_id?: unknown;
  invitation_id?: unknown;
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
  status?: string | null;
  error_text?: string | null;
};

type NotificationRow = {
  id: string;
  user_id: string | null;
  partido_id: number | null;
  type: string;
  title: string | null;
  message: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_WINDOW_SECONDS = 180;
const ALLOWED_EVENT_TYPES = new Set<KickEventType>([
  "match_invite",
  "friend_request",
  "match_join_request",
  "match_player_left",
  "challenge_accepted",
  "team_invite",
  "call_to_vote",
  "match_kicked",
]);

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

function isGuestOrInvalidRecipient(userId: string | null): boolean {
  const normalized = normalizeOptionalString(userId);
  if (!normalized) return true;
  return normalized.startsWith("guest_");
}

function buildVoteRoute(payload: Record<string, unknown> | null, matchId: number | null): string {
  const matchCode = readPayloadString(payload, "matchCode", "match_code", "codigo");
  if (matchCode) {
    return `/votar-equipos?codigo=${encodeURIComponent(matchCode)}`;
  }
  if (matchId !== null) {
    return `/votar-equipos?partidoId=${matchId}`;
  }
  return "/votar-equipos";
}

function shouldTreatSkippedVoteRequestRowAsHandled(row: DeliveryLogRow): boolean {
  if (row.status !== "skipped") return false;

  const reason = String(row.error_text ?? "").trim().toLowerCase();
  return reason === "user_active_on_match"
    || reason === "push_disabled"
    || reason === "not_match_admin";
}

async function isAuthorizedMatchAdmin(
  supabase: ReturnType<typeof createClient>,
  matchId: number,
  actorUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("partidos")
    .select("creado_por")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    console.error("[push-dispatch-now] match admin authorization failed", {
      matchId,
      actorUserId,
      message: error.message,
    });
    return false;
  }

  return normalizeOptionalString(data?.creado_por) === actorUserId;
}

async function isAuthorizedChallengeActor(
  supabase: ReturnType<typeof createClient>,
  challengeId: string,
  actorUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("challenge_user_is_owner_or_captain", {
    p_challenge_id: challengeId,
    p_user_id: actorUserId,
  });

  if (error) {
    console.error("[push-dispatch-now] challenge actor authorization failed", {
      challengeId,
      actorUserId,
      message: error.message,
    });
    return false;
  }

  return data === true;
}

async function isAuthorizedTeamInviteActor(
  supabase: ReturnType<typeof createClient>,
  invitationId: string,
  actorUserId: string,
  recipientUserId: string | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("team_invitations")
    .select("invited_by_user_id, invited_user_id")
    .eq("id", invitationId)
    .maybeSingle();

  if (error) {
    console.error("[push-dispatch-now] team invite actor authorization failed", {
      invitationId,
      actorUserId,
      message: error.message,
    });
    return false;
  }

  const inviterId = normalizeOptionalString(data?.invited_by_user_id);
  const invitedUserId = normalizeOptionalString(data?.invited_user_id);
  if (!inviterId || inviterId !== actorUserId) return false;
  if (recipientUserId && invitedUserId && invitedUserId !== recipientUserId) return false;
  return true;
}

async function fetchQueuedCandidateRows(
  supabase: ReturnType<typeof createClient>,
  {
    eventType,
    recipientUserId,
    matchId,
    windowStartIso,
  }: {
    eventType: KickEventType;
    recipientUserId: string | null;
    matchId: number | null;
    windowStartIso: string;
  },
): Promise<{ data: DeliveryLogRow[]; error: { message: string } | null }> {
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
  if (
    (
      eventType === "match_invite"
      || eventType === "match_join_request"
      || eventType === "match_player_left"
      || eventType === "call_to_vote"
      || eventType === "match_kicked"
    ) && matchId !== null
  ) {
    query = query.eq("partido_id", matchId);
  }

  const { data, error } = await query;
  return {
    data: ((data ?? []) as DeliveryLogRow[]),
    error: error ? { message: error.message } : null,
  };
}

async function enqueueChallengeAcceptedRows(
  supabase: ReturnType<typeof createClient>,
  {
    challengeId,
    recipientUserId,
    windowStartIso,
  }: {
    challengeId: string;
    recipientUserId: string | null;
    windowStartIso: string;
  },
): Promise<{ inserted: number; error: { message: string } | null }> {
  let notificationsQuery = supabase
    .from("notifications")
    .select("id, user_id, partido_id, type, title, message, data, created_at")
    .eq("type", "challenge_accepted")
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recipientUserId) {
    notificationsQuery = notificationsQuery.eq("user_id", recipientUserId);
  }

  const { data: notificationRows, error: notificationsError } = await notificationsQuery;
  if (notificationsError) {
    return { inserted: 0, error: { message: notificationsError.message } };
  }

  const matchingNotifications = ((notificationRows ?? []) as NotificationRow[])
    .filter((row) => readPayloadString(row.data, "challenge_id", "challengeId") === challengeId);

  if (matchingNotifications.length === 0) {
    return { inserted: 0, error: null };
  }

  const recipientIds = Array.from(new Set(
    matchingNotifications.map((row) => normalizeOptionalString(row.user_id)).filter(Boolean),
  ));

  let existingLogs: DeliveryLogRow[] = [];
  if (recipientIds.length > 0) {
    const existingQuery = supabase
      .from("notification_delivery_log")
      .select("id, notification_type, user_id, partido_id, created_at, payload_json")
      .eq("channel", "push")
      .eq("notification_type", "challenge_accepted")
      .gte("created_at", windowStartIso)
      .in("user_id", recipientIds)
      .limit(50);

    const { data: existingData, error: existingError } = await existingQuery;
    if (existingError) {
      return { inserted: 0, error: { message: existingError.message } };
    }
    existingLogs = (existingData ?? []) as DeliveryLogRow[];
  }

  const existingNotificationIds = new Set(
    existingLogs
      .map((row) => readPayloadString(row.payload_json, "notification_id"))
      .filter(Boolean),
  );

  const rowsToInsert = matchingNotifications
    .filter((row) => !existingNotificationIds.has(row.id))
    .map((row) => {
      const payload = row.data && typeof row.data === "object" ? row.data : {};
      return {
        partido_id: row.partido_id,
        user_id: row.user_id,
        notification_type: row.type,
        payload_json: {
          ...payload,
          event_channel: "ACCEPTED",
          notification_id: row.id,
          notification_type: row.type,
          title: row.title ?? "Desafio aceptado",
          message: row.message ?? "Tu desafío fue aceptado.",
          partido_id: row.partido_id,
          source: "push_dispatch_now_backfill",
        },
        channel: "push",
        status: "queued",
      };
    });

  if (rowsToInsert.length === 0) {
    return { inserted: 0, error: null };
  }

  const { error: insertError } = await supabase
    .from("notification_delivery_log")
    .insert(rowsToInsert);

  if (insertError) {
    return { inserted: 0, error: { message: insertError.message } };
  }

  return { inserted: rowsToInsert.length, error: null };
}

async function enqueueTeamInviteRows(
  supabase: ReturnType<typeof createClient>,
  {
    invitationId,
    recipientUserId,
    windowStartIso,
  }: {
    invitationId: string;
    recipientUserId: string | null;
    windowStartIso: string;
  },
): Promise<{ inserted: number; error: { message: string } | null }> {
  let notificationsQuery = supabase
    .from("notifications")
    .select("id, user_id, partido_id, type, title, message, data, created_at")
    .eq("type", "team_invite")
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recipientUserId) {
    notificationsQuery = notificationsQuery.eq("user_id", recipientUserId);
  }

  const { data: notificationRows, error: notificationsError } = await notificationsQuery;
  if (notificationsError) {
    return { inserted: 0, error: { message: notificationsError.message } };
  }

  const matchingNotifications = ((notificationRows ?? []) as NotificationRow[])
    .filter((row) => readPayloadString(row.data, "invitation_id", "invitationId") === invitationId);

  if (matchingNotifications.length === 0) {
    return { inserted: 0, error: null };
  }

  const recipientIds = Array.from(new Set(
    matchingNotifications.map((row) => normalizeOptionalString(row.user_id)).filter(Boolean),
  ));

  let existingLogs: DeliveryLogRow[] = [];
  if (recipientIds.length > 0) {
    const existingQuery = supabase
      .from("notification_delivery_log")
      .select("id, notification_type, user_id, partido_id, created_at, payload_json")
      .eq("channel", "push")
      .eq("notification_type", "team_invite")
      .gte("created_at", windowStartIso)
      .in("user_id", recipientIds)
      .limit(50);

    const { data: existingData, error: existingError } = await existingQuery;
    if (existingError) {
      return { inserted: 0, error: { message: existingError.message } };
    }
    existingLogs = (existingData ?? []) as DeliveryLogRow[];
  }

  const existingNotificationIds = new Set(
    existingLogs
      .map((row) => readPayloadString(row.payload_json, "notification_id"))
      .filter(Boolean),
  );

  const rowsToInsert = matchingNotifications
    .filter((row) => !existingNotificationIds.has(row.id))
    .map((row) => {
      const payload = row.data && typeof row.data === "object" ? row.data : {};
      return {
        partido_id: row.partido_id,
        user_id: row.user_id,
        notification_type: row.type,
        payload_json: {
          ...payload,
          event_channel: "INVITATION",
          notification_id: row.id,
          notification_type: row.type,
          title: row.title ?? "Invitacion de equipo",
          message: row.message ?? "Te invitaron a formar parte de un equipo.",
          partido_id: row.partido_id,
          link: "/desafios?tab=mis-equipos",
          route: "/desafios?tab=mis-equipos",
          source: "push_dispatch_now_backfill",
        },
        channel: "push",
        status: "queued",
      };
    });

  if (rowsToInsert.length === 0) {
    return { inserted: 0, error: null };
  }

  const { error: insertError } = await supabase
    .from("notification_delivery_log")
    .insert(rowsToInsert);

  if (insertError) {
    return { inserted: 0, error: { message: insertError.message } };
  }

  return { inserted: rowsToInsert.length, error: null };
}

async function enqueueCallToVoteRows(
  supabase: ReturnType<typeof createClient>,
  {
    matchId,
    recipientUserId,
    windowStartIso,
  }: {
    matchId: number;
    recipientUserId: string | null;
    windowStartIso: string;
  },
): Promise<{ inserted: number; error: { message: string } | null }> {
  let notificationsQuery = supabase
    .from("notifications")
    .select("id, user_id, partido_id, type, title, message, data, created_at")
    .eq("type", "call_to_vote")
    .eq("partido_id", matchId)
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(100);

  if (recipientUserId) {
    notificationsQuery = notificationsQuery.eq("user_id", recipientUserId);
  }

  const { data: notificationRows, error: notificationsError } = await notificationsQuery;
  if (notificationsError) {
    return { inserted: 0, error: { message: notificationsError.message } };
  }

  const matchingNotifications = ((notificationRows ?? []) as NotificationRow[])
    .filter((row) => !isGuestOrInvalidRecipient(row.user_id));

  if (matchingNotifications.length === 0) {
    return { inserted: 0, error: null };
  }

  const recipientIds = Array.from(new Set(
    matchingNotifications.map((row) => normalizeOptionalString(row.user_id)).filter(Boolean),
  ));

  let existingLogs: DeliveryLogRow[] = [];
  if (recipientIds.length > 0) {
    const { data: existingData, error: existingError } = await supabase
      .from("notification_delivery_log")
      .select("id, notification_type, user_id, partido_id, created_at, payload_json, status, error_text")
      .eq("channel", "push")
      .eq("notification_type", "call_to_vote")
      .eq("partido_id", matchId)
      .gte("created_at", windowStartIso)
      .in("user_id", recipientIds)
      .limit(200);

    if (existingError) {
      return { inserted: 0, error: { message: existingError.message } };
    }
    existingLogs = (existingData ?? []) as DeliveryLogRow[];
  }

  const existingNotificationIds = new Set(
    existingLogs
      .filter((row) => row.status !== "skipped" || shouldTreatSkippedVoteRequestRowAsHandled(row))
      .map((row) => readPayloadString(row.payload_json, "notification_id"))
      .filter(Boolean),
  );

  const rowsToInsert = matchingNotifications
    .filter((row) => !existingNotificationIds.has(row.id))
    .map((row) => {
      const payload = row.data && typeof row.data === "object" ? row.data : {};
      const route = buildVoteRoute(payload, row.partido_id);
      return {
        partido_id: row.partido_id,
        user_id: row.user_id,
        notification_type: row.type,
        payload_json: {
          ...payload,
          event_channel: "VOTE_REQUEST",
          notification_id: row.id,
          notification_type: row.type,
          title: row.title ?? "¡Hora de votar!",
          message: row.message ?? "Entrá a la app y calificá a los jugadores para armar los equipos.",
          partido_id: row.partido_id,
          link: route,
          route,
          source: "push_dispatch_now_backfill",
        },
        channel: "push",
        status: "queued",
      };
    });

  if (rowsToInsert.length === 0) {
    return { inserted: 0, error: null };
  }

  const { error: insertError } = await supabase
    .from("notification_delivery_log")
    .insert(rowsToInsert);

  if (insertError) {
    return { inserted: 0, error: { message: insertError.message } };
  }

  return { inserted: rowsToInsert.length, error: null };
}

async function enqueueMatchKickedRows(
  supabase: ReturnType<typeof createClient>,
  {
    matchId,
    recipientUserId,
    windowStartIso,
  }: {
    matchId: number;
    recipientUserId: string | null;
    windowStartIso: string;
  },
): Promise<{ inserted: number; error: { message: string } | null }> {
  let notificationsQuery = supabase
    .from("notifications")
    .select("id, user_id, partido_id, type, title, message, data, created_at")
    .eq("type", "match_kicked")
    .eq("partido_id", matchId)
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recipientUserId) {
    notificationsQuery = notificationsQuery.eq("user_id", recipientUserId);
  }

  const { data: notificationRows, error: notificationsError } = await notificationsQuery;
  if (notificationsError) {
    return { inserted: 0, error: { message: notificationsError.message } };
  }

  const matchingNotifications = ((notificationRows ?? []) as NotificationRow[])
    .filter((row) => !isGuestOrInvalidRecipient(row.user_id));

  if (matchingNotifications.length === 0) {
    return { inserted: 0, error: null };
  }

  const recipientIds = Array.from(new Set(
    matchingNotifications.map((row) => normalizeOptionalString(row.user_id)).filter(Boolean),
  ));

  let existingLogs: DeliveryLogRow[] = [];
  if (recipientIds.length > 0) {
    const { data: existingData, error: existingError } = await supabase
      .from("notification_delivery_log")
      .select("id, notification_type, user_id, partido_id, created_at, payload_json, status, error_text")
      .eq("channel", "push")
      .eq("notification_type", "match_kicked")
      .eq("partido_id", matchId)
      .gte("created_at", windowStartIso)
      .in("user_id", recipientIds)
      .limit(50);

    if (existingError) {
      return { inserted: 0, error: { message: existingError.message } };
    }
    existingLogs = (existingData ?? []) as DeliveryLogRow[];
  }

  const existingNotificationIds = new Set(
    existingLogs
      .filter((row) => row.status !== "skipped")
      .map((row) => readPayloadString(row.payload_json, "notification_id"))
      .filter(Boolean),
  );

  const rowsToInsert = matchingNotifications
    .filter((row) => !existingNotificationIds.has(row.id))
    .map((row) => {
      const payload = row.data && typeof row.data === "object" ? row.data : {};
      return {
        partido_id: row.partido_id,
        user_id: row.user_id,
        notification_type: row.type,
        payload_json: {
          ...payload,
          event_channel: "CANCELLATION",
          notification_id: row.id,
          notification_type: row.type,
          title: row.title ?? "Expulsado del partido",
          message: row.message ?? "Fuiste removido del partido.",
          partido_id: row.partido_id,
          route: "/notifications",
          link: "/notifications",
          source: "push_dispatch_now_backfill",
        },
        channel: "push",
        status: "queued",
      };
    });

  if (rowsToInsert.length === 0) {
    return { inserted: 0, error: null };
  }

  const { error: insertError } = await supabase
    .from("notification_delivery_log")
    .insert(rowsToInsert);

  if (insertError) {
    return { inserted: 0, error: { message: insertError.message } };
  }

  return { inserted: rowsToInsert.length, error: null };
}

async function enqueueMatchJoinRequestRows(
  supabase: ReturnType<typeof createClient>,
  {
    matchId,
    recipientUserId,
    requestId,
    requesterUserId,
    windowStartIso,
  }: {
    matchId: number | null;
    recipientUserId: string | null;
    requestId: string | null;
    requesterUserId: string;
    windowStartIso: string;
  },
): Promise<{ inserted: number; error: { message: string } | null }> {
  let notificationsQuery = supabase
    .from("notifications")
    .select("id, user_id, partido_id, type, title, message, data, created_at")
    .eq("type", "match_join_request")
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recipientUserId) {
    notificationsQuery = notificationsQuery.eq("user_id", recipientUserId);
  }

  if (matchId !== null) {
    notificationsQuery = notificationsQuery.eq("partido_id", matchId);
  }

  const { data: notificationRows, error: notificationsError } = await notificationsQuery;
  if (notificationsError) {
    return { inserted: 0, error: { message: notificationsError.message } };
  }

  const matchingNotifications = ((notificationRows ?? []) as NotificationRow[])
    .filter((row) => !isGuestOrInvalidRecipient(row.user_id))
    .filter((row) => {
      const payload = row.data && typeof row.data === "object" ? row.data : {};
      const payloadRequesterId = readPayloadString(payload, "request_user_id", "requester_user_id", "senderId", "sender_id");
      if (!payloadRequesterId || payloadRequesterId !== requesterUserId) return false;

      if (matchId !== null) {
        const payloadMatchId = normalizeOptionalInt(payload.match_id ?? payload.matchId ?? payload.partido_id ?? payload.partidoId);
        if (row.partido_id !== null && row.partido_id !== matchId) return false;
        if (payloadMatchId !== null && payloadMatchId !== matchId) return false;
      }

      if (requestId) {
        const payloadRequestId = readPayloadString(payload, "requestId", "request_id");
        if (!payloadRequestId || payloadRequestId !== requestId) return false;
      }

      return true;
    });

  if (matchingNotifications.length === 0) {
    return { inserted: 0, error: null };
  }

  const recipientIds = Array.from(new Set(
    matchingNotifications.map((row) => normalizeOptionalString(row.user_id)).filter(Boolean),
  ));

  let existingLogs: DeliveryLogRow[] = [];
  if (recipientIds.length > 0) {
    let existingQuery = supabase
      .from("notification_delivery_log")
      .select("id, notification_type, user_id, partido_id, created_at, payload_json, status, error_text")
      .eq("channel", "push")
      .eq("notification_type", "match_join_request")
      .gte("created_at", windowStartIso)
      .in("user_id", recipientIds)
      .limit(50);

    if (matchId !== null) {
      existingQuery = existingQuery.eq("partido_id", matchId);
    }

    const { data: existingData, error: existingError } = await existingQuery;
    if (existingError) {
      return { inserted: 0, error: { message: existingError.message } };
    }
    existingLogs = (existingData ?? []) as DeliveryLogRow[];
  }

  const existingNotificationIds = new Set(
    existingLogs
      .filter((row) => row.status !== "skipped")
      .map((row) => readPayloadString(row.payload_json, "notification_id"))
      .filter(Boolean),
  );

  const rowsToInsert = matchingNotifications
    .filter((row) => !existingNotificationIds.has(row.id))
    .map((row) => {
      const payload = row.data && typeof row.data === "object" ? row.data : {};
      const route = readPayloadString(payload, "link", "route") ?? `/admin/${row.partido_id ?? matchId ?? ""}?tab=solicitudes`;
      return {
        partido_id: row.partido_id,
        user_id: row.user_id,
        notification_type: "match_join_request",
        payload_json: {
          ...payload,
          event_channel: "JOIN_REQUEST",
          notification_id: row.id,
          notification_type: "match_join_request",
          title: row.title ?? "Nueva solicitud para unirse",
          message: row.message ?? "Tenés una nueva solicitud para revisar.",
          partido_id: row.partido_id,
          route,
          link: route,
          source: "push_dispatch_now_backfill",
        },
        channel: "push",
        status: "queued",
      };
    });

  if (rowsToInsert.length === 0) {
    return { inserted: 0, error: null };
  }

  const { error: insertError } = await supabase
    .from("notification_delivery_log")
    .insert(rowsToInsert);

  if (insertError) {
    return { inserted: 0, error: { message: insertError.message } };
  }

  return { inserted: rowsToInsert.length, error: null };
}

function isMatchPlayerLeftNotification(row: NotificationRow): boolean {
  const payload = row.data && typeof row.data === "object" ? row.data : {};
  const leftVia = readPayloadString(payload, "left_via", "leftVia");
  if (leftVia) return true;

  const title = String(row.title ?? "").trim().toLowerCase();
  const message = String(row.message ?? "").trim().toLowerCase();
  return title.includes("se baj") || message.includes("se baj");
}

async function enqueueMatchPlayerLeftRows(
  supabase: ReturnType<typeof createClient>,
  {
    matchId,
    recipientUserId,
    windowStartIso,
  }: {
    matchId: number;
    recipientUserId: string | null;
    windowStartIso: string;
  },
): Promise<{ inserted: number; error: { message: string } | null }> {
  let notificationsQuery = supabase
    .from("notifications")
    .select("id, user_id, partido_id, type, title, message, data, created_at")
    .eq("type", "match_update")
    .eq("partido_id", matchId)
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recipientUserId) {
    notificationsQuery = notificationsQuery.eq("user_id", recipientUserId);
  }

  const { data: notificationRows, error: notificationsError } = await notificationsQuery;
  if (notificationsError) {
    return { inserted: 0, error: { message: notificationsError.message } };
  }

  const matchingNotifications = ((notificationRows ?? []) as NotificationRow[])
    .filter((row) => !isGuestOrInvalidRecipient(row.user_id))
    .filter((row) => isMatchPlayerLeftNotification(row));

  if (matchingNotifications.length === 0) {
    return { inserted: 0, error: null };
  }

  const recipientIds = Array.from(new Set(
    matchingNotifications.map((row) => normalizeOptionalString(row.user_id)).filter(Boolean),
  ));

  let existingLogs: DeliveryLogRow[] = [];
  if (recipientIds.length > 0) {
    const { data: existingData, error: existingError } = await supabase
      .from("notification_delivery_log")
      .select("id, notification_type, user_id, partido_id, created_at, payload_json, status, error_text")
      .eq("channel", "push")
      .eq("notification_type", "match_player_left")
      .eq("partido_id", matchId)
      .gte("created_at", windowStartIso)
      .in("user_id", recipientIds)
      .limit(50);

    if (existingError) {
      return { inserted: 0, error: { message: existingError.message } };
    }
    existingLogs = (existingData ?? []) as DeliveryLogRow[];
  }

  const existingNotificationIds = new Set(
    existingLogs
      .filter((row) => row.status !== "skipped")
      .map((row) => readPayloadString(row.payload_json, "notification_id"))
      .filter(Boolean),
  );

  const rowsToInsert = matchingNotifications
    .filter((row) => !existingNotificationIds.has(row.id))
    .map((row) => {
      const payload = row.data && typeof row.data === "object" ? row.data : {};
      const route = readPayloadString(payload, "link", "route") ?? `/admin/${matchId}`;
      return {
        partido_id: row.partido_id,
        user_id: row.user_id,
        notification_type: "match_player_left",
        payload_json: {
          ...payload,
          event_channel: "ACTIVITY",
          notification_id: row.id,
          source_notification_type: row.type,
          notification_type: "match_player_left",
          title: row.title ?? "Jugador se bajó del partido",
          message: row.message ?? "Un jugador se bajó del partido.",
          partido_id: row.partido_id,
          route,
          link: route,
          source: "push_dispatch_now_backfill",
        },
        channel: "push",
        status: "queued",
      };
    });

  if (rowsToInsert.length === 0) {
    return { inserted: 0, error: null };
  }

  const { error: insertError } = await supabase
    .from("notification_delivery_log")
    .insert(rowsToInsert);

  if (insertError) {
    return { inserted: 0, error: { message: insertError.message } };
  }

  return { inserted: rowsToInsert.length, error: null };
}

function isEligibleRow(
  row: DeliveryLogRow,
  actorUserId: string,
  eventType: KickEventType,
  matchId: number | null,
  requestId: string | null,
  challengeId: string | null,
  invitationId: string | null,
): boolean {
  const payload = row.payload_json ?? {};

  if (eventType === "challenge_accepted") {
    if (!challengeId) return false;
    const payloadChallengeId = readPayloadString(payload, "challenge_id", "challengeId");
    return Boolean(payloadChallengeId && payloadChallengeId === challengeId);
  }

  if (eventType === "team_invite") {
    if (!invitationId) return false;
    const payloadInvitationId = readPayloadString(payload, "invitation_id", "invitationId");
    return Boolean(payloadInvitationId && payloadInvitationId === invitationId);
  }

  if (eventType === "call_to_vote") {
    if (matchId === null) return false;
    if (row.partido_id !== null) return row.partido_id === matchId;
    const payloadMatchId = normalizeOptionalInt(payload.match_id ?? payload.matchId);
    return payloadMatchId === matchId;
  }

  if (eventType === "match_kicked") {
    if (matchId === null) return false;
    if (row.partido_id !== null && row.partido_id !== matchId) return false;
    const payloadMatchId = normalizeOptionalInt(payload.match_id ?? payload.matchId ?? payload.partido_id ?? payload.partidoId);
    if (payloadMatchId !== null && payloadMatchId !== matchId) return false;
    return true;
  }

  if (eventType === "match_player_left") {
    if (matchId === null) return false;
    if (row.partido_id !== null && row.partido_id !== matchId) return false;
    const payloadMatchId = normalizeOptionalInt(payload.match_id ?? payload.matchId ?? payload.partido_id ?? payload.partidoId);
    if (payloadMatchId !== null && payloadMatchId !== matchId) return false;
    const playerUserId = readPayloadString(payload, "player_user_id", "playerUserId", "senderId", "sender_id");
    return Boolean(playerUserId && playerUserId === actorUserId);
  }

  if (eventType === "friend_request") {
    const senderId = readPayloadString(payload, "senderId", "sender_id");
    const payloadRequestId = readPayloadString(payload, "requestId", "request_id");
    if (!senderId || senderId !== actorUserId) return false;
    if (requestId && payloadRequestId !== requestId) return false;
    return true;
  }

  if (eventType === "match_join_request") {
    const requesterId = readPayloadString(payload, "request_user_id", "requester_user_id", "senderId", "sender_id");
    const payloadRequestId = readPayloadString(payload, "requestId", "request_id");
    if (!requesterId || requesterId !== actorUserId) return false;
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
  const challengeId = normalizeOptionalString((body as KickBody).challenge_id);
  const invitationId = normalizeOptionalString((body as KickBody).invitation_id);
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

  if (eventType === "challenge_accepted") {
    if (!challengeId) {
      return jsonResponse({ ok: false, reason: "invalid_challenge_id" }, 400, cors);
    }

    const isAllowedActor = await isAuthorizedChallengeActor(supabase, challengeId, actorUserId);
    if (!isAllowedActor) {
      return jsonResponse({ ok: false, reason: "forbidden" }, 403, cors);
    }
  }

  if (eventType === "call_to_vote" || eventType === "match_kicked") {
    if (matchId === null) {
      return jsonResponse({ ok: false, reason: "invalid_match_id" }, 400, cors);
    }

    const isAllowedActor = await isAuthorizedMatchAdmin(supabase, matchId, actorUserId);
    if (!isAllowedActor) {
      return jsonResponse({ ok: false, reason: "forbidden" }, 403, cors);
    }
  }

  if (eventType === "team_invite") {
    if (!invitationId) {
      return jsonResponse({ ok: false, reason: "invalid_invitation_id" }, 400, cors);
    }

    const isAllowedActor = await isAuthorizedTeamInviteActor(supabase, invitationId, actorUserId, recipientUserId);
    if (!isAllowedActor) {
      return jsonResponse({ ok: false, reason: "forbidden" }, 403, cors);
    }
  }

  let { data: candidateRows, error: candidateError } = await fetchQueuedCandidateRows(supabase, {
    eventType,
    recipientUserId,
    matchId,
    windowStartIso,
  });

  if (candidateError) {
    return jsonResponse(
      { ok: false, reason: "queued_lookup_failed", details: candidateError.message },
      500,
      cors,
    );
  }

  let candidates = candidateRows;
  const shouldBackfill =
    (eventType === "challenge_accepted" && candidates.length === 0 && challengeId)
    || (eventType === "team_invite" && candidates.length === 0 && invitationId)
    || eventType === "match_join_request"
    || (eventType === "call_to_vote" && matchId !== null)
    || (eventType === "match_player_left" && matchId !== null && recipientUserId !== null)
    || (eventType === "match_kicked" && matchId !== null && recipientUserId !== null);

  if (shouldBackfill) {
    const backfillResult = eventType === "team_invite"
      ? await enqueueTeamInviteRows(supabase, {
        invitationId: invitationId as string,
        recipientUserId,
        windowStartIso,
      })
      : eventType === "match_join_request"
        ? await enqueueMatchJoinRequestRows(supabase, {
          matchId,
          recipientUserId,
          requestId,
          requesterUserId: actorUserId,
          windowStartIso,
        })
      : eventType === "call_to_vote"
        ? await enqueueCallToVoteRows(supabase, {
          matchId: matchId as number,
          recipientUserId,
          windowStartIso,
        })
        : eventType === "match_player_left"
          ? await enqueueMatchPlayerLeftRows(supabase, {
            matchId: matchId as number,
            recipientUserId,
            windowStartIso,
          })
        : eventType === "match_kicked"
          ? await enqueueMatchKickedRows(supabase, {
            matchId: matchId as number,
            recipientUserId,
            windowStartIso,
          })
        : await enqueueChallengeAcceptedRows(supabase, {
          challengeId: challengeId as string,
          recipientUserId,
          windowStartIso,
        });

    if (backfillResult.error) {
      return jsonResponse(
        {
          ok: false,
          reason: "event_backfill_failed",
          details: backfillResult.error.message,
        },
        500,
        cors,
      );
    }

    console.log("[push-dispatch-now] backfill result", {
      eventType,
      matchId,
      recipientUserId,
      inserted: backfillResult.inserted,
    });

    const refetched = await fetchQueuedCandidateRows(supabase, {
      eventType,
      recipientUserId,
      matchId,
      windowStartIso,
    });

    if (refetched.error) {
      return jsonResponse(
        { ok: false, reason: "queued_lookup_failed", details: refetched.error.message },
        500,
        cors,
      );
    }

    candidates = refetched.data;
  }

  const eligibleRows = candidates.filter((row) => (
    isEligibleRow(row, actorUserId, eventType, matchId, requestId, challengeId, invitationId)
  ));

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

  const dispatchableRows = eligibleRows.slice(0, dispatchLimit);
  const dispatchLogIds = dispatchableRows.map((row) => row.id);
  console.log("[push-dispatch-now] dispatching eligible rows", {
    eventType,
    actorUserId,
    matchId,
    recipientUserId,
    candidateCount: candidates.length,
    eligibleCount: eligibleRows.length,
    dispatchCount: dispatchableRows.length,
    dispatchLogIds,
  });

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
      limit: dispatchableRows.length,
      log_ids: dispatchLogIds,
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
      dispatch_count: dispatchableRows.length,
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
