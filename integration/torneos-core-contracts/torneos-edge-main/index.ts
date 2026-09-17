// Lab main service for Supabase's edge-runtime hosting the TORNEOS project's functions
// (backend/torneos/supabase/functions). Mounts ONLY torneos-gateway; every other name is
// refused. Mirrors edge-main/index.ts, which hosts only Core's torneos-core-contract.
const ALLOWED = new Set(["torneos-gateway"]);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname === "/_internal/health") {
    return new Response(JSON.stringify({ message: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const serviceName = url.pathname.split("/")[1];
  if (!serviceName || !ALLOWED.has(serviceName)) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
  }
  try {
    const envVarsObj = Deno.env.toObject();
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${serviceName}`,
      memoryLimitMb: 256,
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
    // Worker faults are reported without request details.
    console.error("[torneos-edge-main] worker failed:", e instanceof Error ? e.name : "unknown");
    return new Response(JSON.stringify({ error: "access denied" }), { status: 503, headers: { "content-type": "application/json" } });
  }
});
