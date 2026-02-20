// supabase/functions/join-match-guest/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  const reqHeaders = req.headers.get("access-control-request-headers") ?? "";

  // IMPORTANTE: incluir apikey + authorization porque tu frontend los manda
  const required = ["content-type", "apikey", "authorization", "x-client-info"];

  const allowHeaders = Array.from(
    new Set(
      reqHeaders
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
        .concat(required)
    )
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
  const cors = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY')!

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ ok: false, reason: "missing_env" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ ok: false, reason: "invalid_json" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { partido_id, nombre, codigo, invite, guest_uuid, avatar_data_url } = body;

    if (!partido_id || !nombre?.trim() || !codigo?.trim() || !String(invite ?? "").trim()) {
      return new Response(
        JSON.stringify({ ok: false, reason: "missing_fields" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const partidoIdNum = Number(partido_id);
    if (Number.isNaN(partidoIdNum)) {
      return new Response(
        JSON.stringify({ ok: false, reason: "invalid_partido_id" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Idempotencia (solo si viene un UUID válido)
    if (guest_uuid && uuidRe.test(String(guest_uuid))) {
      const { data: existing } = await supabase
        .from("jugadores")
        .select("id,nombre,uuid")
        .eq("partido_id", partidoIdNum)
        .eq("uuid", guest_uuid)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({
            ok: true,
            already_joined: true,
            guest_uuid: existing.uuid,
            jugador: existing,
          }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    }

    // Partido + validación de código (TU TABLA TIENE "codigo")
    const { data: partido, error: partidoError } = await supabase
      .from("partidos")
      .select("id,codigo,cupo_jugadores")
      .eq("id", partidoIdNum)
      .maybeSingle();

    if (partidoError || !partido) {
      return new Response(
        JSON.stringify({ ok: false, reason: "not_found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (codigo.trim() !== String(partido.codigo ?? "").trim()) {
      return new Response(
        JSON.stringify({ ok: false, reason: "invalid_code" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Cupo
    const { count, error: countError } = await supabase
      .from("jugadores")
      .select("id", { count: "exact", head: true })
      .eq("partido_id", partidoIdNum);

    if (countError) {
      return new Response(
        JSON.stringify({ ok: false, reason: "player_count_error" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const jugadoresCount = count ?? 0;
    const capacity = Number(partido.cupo_jugadores ?? 0);
    const maxRosterSlots = capacity > 0 ? capacity + 2 : 0;
    if (maxRosterSlots > 0 && jugadoresCount >= maxRosterSlots) {
      return new Response(
        JSON.stringify({ ok: false, reason: "full" }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Validate + consume invite token (6h / 14 uses).
    const token = String(invite ?? "").trim();
    const { data: consumeRows, error: consumeErr } = await supabase.rpc(
      "consume_guest_match_invite",
      {
        p_partido_id: partidoIdNum,
        p_token: token,
      },
    );

    if (consumeErr) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "invite_consume_error",
          details: consumeErr.message ?? String(consumeErr),
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }
    const consume = Array.isArray(consumeRows) ? consumeRows[0] : null;
    if (!consume?.ok) {
      return new Response(
        JSON.stringify({ ok: false, reason: "invalid_invite" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const avatarDataUrl = typeof avatar_data_url === "string" ? avatar_data_url.trim() : "";
    const hasAvatar = avatarDataUrl.startsWith("data:image/") && avatarDataUrl.length <= 900_000;

    // Insert guest
    // jugadores.uuid es tipo uuid en DB, así que siempre debe ser UUID válido.
    const guestUuid = (guest_uuid && uuidRe.test(String(guest_uuid)))
      ? String(guest_uuid)
      : crypto.randomUUID();

    const { data: jugador, error: insertError } = await supabase
      .from("jugadores")
      .insert([
        {
          partido_id: partidoIdNum,
          usuario_id: null,
          nombre: nombre.trim().slice(0, 50),
          uuid: guestUuid,
          avatar_url: hasAvatar ? avatarDataUrl : null,
        },
      ])
      .select("id,nombre,uuid")
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ ok: false, reason: "db_error", details: insertError.message }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Best-effort admin notification so the host sees new joins in bell/activity.
    try {
      await supabase.rpc("enqueue_partido_notification", {
        p_partido_id: partidoIdNum,
        p_type: "match_update",
        p_title: "Nuevo jugador en el partido",
        p_message: `${nombre.trim().slice(0, 50)} se sumó al partido.`,
        p_payload: {
          match_id: partidoIdNum,
          matchId: partidoIdNum,
          player_name: nombre.trim().slice(0, 50),
          player_user_id: null,
          joined_via: "guest_invite",
          link: `/admin/${partidoIdNum}?tab=jugadores`,
        },
      });
    } catch (_notifyErr) {
      // Don't block join flow if notifications fail.
    }

    return new Response(
      JSON.stringify({
        ok: true,
        guest_uuid: guestUuid,
        jugador,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: "internal_error",
        details: (e as Error)?.message ?? String(e),
      }),
      { status: 500, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
