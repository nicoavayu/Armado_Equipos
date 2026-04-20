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

// Best-effort cleanup — logs but never throws.
async function cleanupUserData(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  userId: string,
): Promise<void> {
  const steps: Array<{ label: string; fn: () => Promise<unknown> }> = [
    // Remove user from matches they were in (junction table)
    {
      label: "partidos_jugadores",
      fn: () => adminClient.from("partidos_jugadores").delete().eq("jugador_id", userId),
    },
    // Remove player rows linked to user
    {
      label: "jugadores",
      fn: () => adminClient.from("jugadores").delete().eq("usuario_id", userId),
    },
    // Remove votes cast by or about this user
    {
      label: "votos_votante",
      fn: () => adminClient.from("votos").delete().eq("votante_id", userId),
    },
    {
      label: "votos_votado",
      fn: () => adminClient.from("votos").delete().eq("votado_id", userId),
    },
    // Remove friend relationships
    {
      label: "amigos_user",
      fn: () => adminClient.from("amigos").delete().eq("user_id", userId),
    },
    {
      label: "amigos_friend",
      fn: () => adminClient.from("amigos").delete().eq("friend_id", userId),
    },
    // Orphan matches created by this user (preserve match data, remove user ref)
    {
      label: "partidos_creado_por",
      fn: () => adminClient.from("partidos").update({ creado_por: null }).eq("creado_por", userId),
    },
    // Remove notifications
    {
      label: "notifications",
      fn: () => adminClient.from("notifications").delete().eq("user_id", userId),
    },
    // Remove profiles row (Supabase default table)
    {
      label: "profiles",
      fn: () => adminClient.from("profiles").delete().eq("id", userId),
    },
  ];

  for (const step of steps) {
    try {
      await step.fn();
    } catch (err) {
      console.warn(`[delete-account] cleanup step "${step.label}" failed (non-fatal):`, err);
    }
  }
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
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ ok: false, message: "not_authenticated" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    if (!body?.confirm) {
      return new Response(JSON.stringify({ ok: false, message: "confirmation_required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

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

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Clean up dependent data before deleting the root row.
    await cleanupUserData(adminClient, user.id);

    // Delete main profile row.
    const { error: profileDeleteError } = await adminClient
      .from("usuarios")
      .delete()
      .eq("id", user.id);

    if (profileDeleteError) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "profile_delete_failed",
          details: profileDeleteError.message,
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Delete the auth user last (cascades auth-referenced tables).
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteAuthError) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "auth_delete_failed",
          details: deleteAuthError.message,
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "account_deleted",
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: "internal_error",
        details: (error as Error).message || String(error),
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
