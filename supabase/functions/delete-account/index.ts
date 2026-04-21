import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type QueryError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

type CleanupStep = {
  label: string;
  fn: () => Promise<unknown>;
  ignoreMissingSchema?: boolean;
};

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

function getQueryError(result: unknown): QueryError | null {
  if (!result || typeof result !== "object" || !("error" in result)) return null;
  return ((result as { error?: QueryError | null }).error) ?? null;
}

function describeQueryError(error: QueryError): string {
  return [
    error.message,
    error.details,
    error.code,
    error.hint,
  ].filter(Boolean).join(" | ");
}

function isMissingSchemaError(error: QueryError): boolean {
  const code = String(error.code || "");
  const text = describeQueryError(error).toLowerCase();

  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code)
    || text.includes("does not exist")
    || text.includes("could not find")
    || text.includes("schema cache");
}

function isMatchJoinRequestsFkError(error: QueryError): boolean {
  const text = describeQueryError(error).toLowerCase();
  return error.code === "23503" && text.includes("match_join_requests");
}

async function runCleanupStep(step: CleanupStep): Promise<void> {
  try {
    const result = await step.fn();
    const error = getQueryError(result);

    if (!error) return;

    if (step.ignoreMissingSchema !== false && isMissingSchemaError(error)) {
      console.warn(
        `[delete-account] cleanup step "${step.label}" skipped: ${describeQueryError(error)}`,
      );
      return;
    }

    console.warn(
      `[delete-account] cleanup step "${step.label}" failed (non-fatal): ${describeQueryError(error)}`,
    );
  } catch (err) {
    console.warn(`[delete-account] cleanup step "${step.label}" failed (non-fatal):`, err);
  }
}

async function runCleanupSteps(steps: CleanupStep[]): Promise<void> {
  for (const step of steps) {
    await runCleanupStep(step);
  }
}

async function cleanupMatchJoinRequests(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  userId: string,
): Promise<void> {
  await runCleanupSteps([
    // Preserve historical requests where this user only resolved the request.
    {
      label: "match_join_requests_decided_by",
      fn: () =>
        adminClient
          .from("match_join_requests")
          .update({ decided_by: null })
          .eq("decided_by", userId),
    },
    {
      label: "match_join_requests_reconciled_decided_by",
      fn: () =>
        adminClient
          .from("match_join_requests")
          .update({ reconciled_decided_by: null })
          .eq("reconciled_decided_by", userId),
    },
    // Delete requests made by this user. Extra legacy column names are tolerated.
    {
      label: "match_join_requests_user_id",
      fn: () => adminClient.from("match_join_requests").delete().eq("user_id", userId),
    },
    {
      label: "match_join_requests_usuario_id",
      fn: () => adminClient.from("match_join_requests").delete().eq("usuario_id", userId),
    },
    {
      label: "match_join_requests_requester_user_id",
      fn: () => adminClient.from("match_join_requests").delete().eq("requester_user_id", userId),
    },
  ]);
}

// Best-effort cleanup — logs query errors and exceptions but never throws.
async function cleanupUserData(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  userId: string,
): Promise<void> {
  const steps: CleanupStep[] = [
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
    // Remove public votes
    {
      label: "votos_publicos_votante",
      fn: () => adminClient.from("votos_publicos").delete().eq("votante_id", userId),
    },
    {
      label: "votos_publicos_votado",
      fn: () => adminClient.from("votos_publicos").delete().eq("votado_id", userId),
    },
    // Remove post-match surveys submitted by this user
    {
      label: "post_match_surveys",
      fn: () => adminClient.from("post_match_surveys").delete().eq("votante_id", userId),
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
    {
      label: "notifications_user_id",
      fn: () => adminClient.from("notifications_ext").delete().eq("user_id", userId),
    },
    // Remove profiles row (Supabase default table)
    {
      label: "profiles",
      fn: () => adminClient.from("profiles").delete().eq("id", userId),
    },
  ];

  await runCleanupSteps(steps);
  await cleanupMatchJoinRequests(adminClient, userId);
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
    let profileDeleteError: QueryError | null = null;
    {
      const { error } = await adminClient
        .from("usuarios")
        .delete()
        .eq("id", user.id);
      profileDeleteError = error;
    }

    if (profileDeleteError && isMatchJoinRequestsFkError(profileDeleteError)) {
      console.warn(
        `[delete-account] retrying profile delete after match_join_requests cleanup: ${describeQueryError(profileDeleteError)}`,
      );
      await cleanupMatchJoinRequests(adminClient, user.id);

      const { error } = await adminClient
        .from("usuarios")
        .delete()
        .eq("id", user.id);
      profileDeleteError = error;
    }

    if (profileDeleteError) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "profile_delete_failed",
          details: profileDeleteError.message,
          code: profileDeleteError.code,
          hint: profileDeleteError.hint,
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
          code: (deleteAuthError as { code?: string }).code,
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
