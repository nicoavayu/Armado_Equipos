// Core lab main service for Supabase's edge-runtime (the platform router substitute).
// Mounts only the user-facing Core functions. Push senders are deliberately absent so
// the lab can never deliver a real notification. `verify_jwt` mirrors
// supabase/config.toml: when true, the platform rejects a request whose bearer is not
// a valid JWT signed by the project before the function runs.
const FUNCTIONS: Record<string, { verifyJwt: boolean }> = {
  "accept-invite": { verifyJwt: true },
  "approve-join-request": { verifyJwt: true },
  "delete-account": { verifyJwt: true },
  "join-match-guest": { verifyJwt: false },
  "issue-voting-photo-token": { verifyJwt: false },
  "upload-voting-photo": { verifyJwt: false },
};

const secret = new TextEncoder().encode(Deno.env.get("LAB_JWT_SECRET") ?? "");
const hmacKey = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);

function b64urlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function validJwt(authorization: string | null): Promise<boolean> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    if (header.alg !== "HS256") return false;
    const ok = await crypto.subtle.verify("HMAC", hmacKey, b64urlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    return typeof payload.exp !== "number" || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname === "/_internal/health") return json(200, { message: "ok" });
  const serviceName = url.pathname.split("/")[1];
  const fn = serviceName ? FUNCTIONS[serviceName] : undefined;
  if (!fn) return json(404, { error: "not found" });
  if (fn.verifyJwt && req.method !== "OPTIONS" && !(await validJwt(req.headers.get("authorization")))) {
    return json(401, { code: 401, message: "Invalid JWT" });
  }
  try {
    const envVarsObj = Deno.env.toObject();
    delete envVarsObj.LAB_JWT_SECRET;
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${serviceName}`,
      memoryLimitMb: 150,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]]),
      forceCreate: false,
      netAccessDisabled: false,
      cpuTimeSoftLimitMs: 10_000,
      cpuTimeHardLimitMs: 20_000,
    });
    return await worker.fetch(req, { signal: new AbortController().signal });
  } catch (e) {
    console.error("[core-lab edge-main] worker failed:", e instanceof Error ? e.name : "unknown");
    return json(503, { error: "FUNCTION_UNAVAILABLE" });
  }
});
