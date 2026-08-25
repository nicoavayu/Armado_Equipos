export function corsHeaders(req: Request, methods = "GET,POST,OPTIONS") {
  const origin = req.headers.get("origin") ?? "*"
  const requested = req.headers.get("access-control-request-headers") ?? ""
  const allowHeaders = Array.from(new Set(
    requested.split(",").map((header) => header.trim().toLowerCase()).filter(Boolean)
      .concat(["content-type", "apikey", "authorization", "x-client-info"]),
  )).join(", ")
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  }
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

export function safeUuid(value: unknown) {
  const normalized = String(value ?? "").trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : null
}
