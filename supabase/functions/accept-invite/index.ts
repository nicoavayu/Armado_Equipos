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
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}

function normalizePlayerName(value: unknown, fallback = "Un jugador") {
  const raw = String(value ?? "").trim().slice(0, 50);
  return raw || fallback;
}

async function notifyMatchJoin({
  supabase,
  partidoId,
  playerName,
  playerUserId,
}: {
  supabase: ReturnType<typeof createClient>;
  partidoId: number;
  playerName: string;
  playerUserId: string;
}) {
  const payload = {
    match_id: partidoId,
    matchId: partidoId,
    player_name: playerName,
    player_user_id: playerUserId,
    joined_via: "magic_link",
    link: `/partido-publico/${partidoId}`,
  };

  const { error: participantErr } = await supabase.rpc("enqueue_match_participant_notification", {
    p_partido_id: partidoId,
    p_type: "match_update",
    p_title: "Nuevo jugador en el partido",
    p_message: `${playerName} se sumó al partido.`,
    p_payload: payload,
    p_exclude_user_id: playerUserId,
    p_include_admin: true,
  });

  if (!participantErr) return { ok: true, mode: "participant_fanout" };

  console.warn("[ACCEPT_INVITE] participant notification fanout failed", {
    partidoId,
    code: participantErr.code,
    message: participantErr.message,
  });

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
  });

  if (!adminErr) return { ok: true, mode: "admin_fallback" };

  console.warn("[ACCEPT_INVITE] admin notification fallback failed", {
    partidoId,
    code: adminErr.code,
    message: adminErr.message,
  });
  return { ok: false, mode: "failed" };
}

serve(async (req) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, message: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response(JSON.stringify({ ok: false, message: "missing_env" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ ok: false, message: "not_authenticated" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const token = String(body?.token || "").trim();

    if (!token) {
      return new Response(JSON.stringify({ ok: false, message: "missing_token" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await adminClient.rpc("accept_invite_for_user", {
      p_token: token,
      p_user_id: user.id,
    });

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, message: "accept_failed", details: error.message }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    const status = row?.status || "invalid";
    const partidoId = row?.partido_id ?? null;

    if (status === "accepted" && partidoId) {
      const metadataName = user?.user_metadata?.nombre
        || user?.user_metadata?.name
        || user?.user_metadata?.full_name
        || user?.email?.split("@")[0];
      const safePlayerName = normalizePlayerName(metadataName, "Un jugador");

      await notifyMatchJoin({
        supabase: adminClient,
        partidoId: Number(partidoId),
        playerName: safePlayerName,
        playerUserId: user.id,
      });
    }

    if (status === "accepted" || status === "already_accepted") {
      return new Response(
        JSON.stringify({ ok: true, status, partido_id: partidoId }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (status === "match_full") {
      return new Response(
        JSON.stringify({ ok: false, status, message: "El partido ya está completo." }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: false, status, message: "Invitación inválida o expirada" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, message: "internal_error", details: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
