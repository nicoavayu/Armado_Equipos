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
