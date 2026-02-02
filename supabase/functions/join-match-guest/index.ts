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

    const { partido_id, nombre, codigo, guest_uuid } = body;

    if (!partido_id || !nombre?.trim() || !codigo?.trim()) {
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

    // Idempotencia
    if (guest_uuid) {
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
      .select("id,codigo,cupo")
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
    if (partido.cupo && jugadoresCount >= partido.cupo) {
      return new Response(
        JSON.stringify({ ok: false, reason: "full" }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Insert guest
    const guestUuid =
      guest_uuid || `guest_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    const { data: jugador, error: insertError } = await supabase
      .from("jugadores")
      .insert([
        {
          partido_id: partidoIdNum,
          usuario_id: null,
          nombre: nombre.trim().slice(0, 50),
          uuid: guestUuid,
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
      JSON.stringify({ ok: false, reason: "internal_error" }),
      { status: 500, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
