// backend/torneos/supabase/functions/torneos-gateway/index.ts
//
// Phase 3B — the certified Torneos identity gateway (integration/torneos-core-contracts/
// gateway.mjs: Phase 1.5 bridge + Phase 3A Core-contract adapter + Phase 2D staging v1 RPC
// allowlist) ported to a Supabase Edge Function of the TORNEOS project. Same semantics:
//
//   • Core session validation online on every exchange and on every proxied RPC
//   • RS256 emission/verification with the certified key ring (token.ts, jose)
//   • sub = local identity, core_user_id + session_id bindings, jti, iss/aud/TTL constants
//   • Core-contract adapter with request-hash binding and single-use attestations
//   • staging v1 RPC allowlist applied after the bearer is verified (403 `rpc not enabled`)
//   • logout / revocation / ban / deletion → 401; Core or Torneos dependency down → 503
//   • fail closed: any unexpected error is `401 {error:'access denied'}`; nothing is logged
//
// What changes, and only this: the loopback constants become validated configuration
// (config.ts); the Core session lookup is no longer a SQL read of Core's auth schema but
// the Core contract's `session` operation over HTTPS (Core is reached ONLY over HTTPS);
// `/auth/v1/*` is not proxied (the browser talks to Core Auth directly); CORS is answered
// for exactly one allowed origin; the trusted JWKS is published for verifiers. Secrets
// (service HMAC, RS256 private key, database logins) live only in this function's env.
//
// MP-A4: commerce (commerce.ts, shared with the Node lab gateway). TORNEOS_COMMERCE_MODE unset → nothing
// changes. "test" → POST /commerce/v1/season-checkout and the 2 commerce reads on top of the 43, in the local lab
// or (MP-B1.1 R2, TORNEOS_COMMERCE_DEPLOYMENT=remote-test) on exactly declared https hosts, never Production;
// any other value, or a faulty commerce configuration, disables the whole gateway like any config fault.
//
// COMPETITION-V1 (competition.ts): the generic route serves the full-competition RPCs on top of the 43
// (same bearer / Core session / identity checks), and POST /torneos/public/v1/rpc/<name> serves the public
// read-only RPCs as anon, refusing any credential. A malformed competition allowlist disables the gateway.
//
// OFFICIALIZATION-V1 (competition.ts, officialization-v1-rpc-allowlist.json): organization membership and the
// per-tournament dual-control policy on the generic route; accepting an organization invitation goes through the
// Core-contract adapter (verified_email), like a team invitation.
//
// ERROR-CONTRACT-V1 (competition.ts domainErrorStatus): a proxied 500 whose body is a legacy-SQLSTATE (55000 / 54000)
// Torneos domain error is answered with its contract status (409 / 422 / 429), body unchanged; every other status,
// including a genuine 500 and the 503 of a timeout, passes through as before.
import { decodeJwt } from "npm:jose@6.2.12"
import { issueToken, verifyToken, uuid, jwks, TTL, type TorneosClaims } from "./token.ts"
import { CoreClient, Denied, ROUTES } from "./core-client.ts"
import { Adapter, AdapterDenied, CONTRACTS } from "./adapter.ts"
import { connect, allocateIdentity, identityExists, isUnavailable, type Sql } from "./db.ts"
import { loadConfig, routePath, ConfigError, type GatewayConfig } from "./config.ts"
import { COMMERCE_ROUTE, CommerceConfigError, effectiveRpcAllowlist, loadCommerceConfig, seasonCheckout, type CommerceConfig } from "./commerce.ts"
import { CompetitionConfigError, domainErrorStatus, loadCompetitionContract, loadOfficializationContract, preparePublicRpc, PublicGate, PUBLIC_RPC_ROUTE, withCompetition, withOfficialization, type CompetitionContract } from "./competition.ts"
import allowlistDoc from "./staging-v1-rpc-allowlist.json" with { type: "json" }

// Staging v1 RPC allowlist: fail closed if the document is malformed or empty.
const RPC_ALLOWLIST = new Set(Object.values((allowlistDoc as { features?: Record<string, string[]> }).features ?? {}).flat().filter((n) => /^[a-z0-9_]+$/.test(n)))
if (RPC_ALLOWLIST.size === 0) throw new Error("staging v1 RPC allowlist is empty")

class Unavailable extends Error {}
// The Core contract endpoint (session verdicts) is unreachable or faulting: the same
// sanitized code the adapter uses for Core-dependent RPCs, so the client sees one signal.
class CoreUnavailable extends Unavailable {}

type Runtime = {
  cfg: GatewayConfig
  identity: Sql
  adapterSql: Sql
  adapter: Adapter
  core: CoreClient
  commerce: CommerceConfig
  competition: CompetitionContract
  publicGate: PublicGate
  rpcAllowlist: ReadonlySet<string>
}
let runtime: Runtime | null = null
let bootError: string | null = null

export function boot(env: Record<string, string | undefined>): Runtime {
  const cfg = loadConfig(env)
  // COMPETITION-V1 and commerce are validated before any connection is opened: a fault disables the gateway.
  const competition = loadCompetitionContract(RPC_ALLOWLIST)
  const competitionAllowlist = withCompetition(RPC_ALLOWLIST, competition)
  // OFFICIALIZATION-V1: membership + dual-control policy on the authenticated route (a faulty document disables the gateway).
  const baseAllowlist = withOfficialization(competitionAllowlist, loadOfficializationContract(competitionAllowlist, competition))
  const commerce = loadCommerceConfig(env, { baseAllowlist, gatewayPublicUrl: cfg.publicUrl,
    distinctFrom: [env.TORNEOS_CONTRACT_SERVICE_SECRET, env.TORNEOS_BRIDGE_KEYS, ...cfg.bridge.keys.map((k) => k.privateKey), cfg.coreAnonKey, cfg.torneosAnonKey],
    dependencyUrls: [cfg.coreAuthUrl, cfg.coreJwtIssuer, cfg.coreContractUrl, cfg.torneosRestUrl, cfg.allowedOrigin] })
  const identity = connect(cfg.identityWriterUrl, { sslCa: cfg.dbSslCa })
  const adapterSql = connect(cfg.coreAdapterUrl, { sslCa: cfg.dbSslCa })
  const coreHeaders = cfg.coreAnonKey ? { apikey: cfg.coreAnonKey } : {}
  // The Core service secret lives only in this function's env and in Core's function env.
  const core = new CoreClient(cfg.coreContractUrl, cfg.coreContractSecret, { extraHeaders: coreHeaders })
  return { cfg, identity, adapterSql, adapter: new Adapter(adapterSql, core), core, commerce, competition, publicGate: new PublicGate(), rpcAllowlist: effectiveRpcAllowlist(baseAllowlist, commerce) }
}

function getRuntime(): Runtime {
  if (runtime) return runtime
  if (bootError) throw new Unavailable()
  try {
    runtime = boot(Deno.env.toObject())
    return runtime
  } catch (error) {
    // Configuration faults disable the gateway; the reason is logged once, without values.
    bootError = error instanceof ConfigError || error instanceof CommerceConfigError || error instanceof CompetitionConfigError ? error.message : "boot failed"
    console.error(`[torneos-gateway] disabled: ${bootError}`)
    throw new Unavailable()
  }
}

const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" }
function corsHeaders(cfg: GatewayConfig | null, origin: string | null): Record<string, string> {
  if (!cfg || !origin || !cfg.allowedOrigins.includes(origin)) return {}
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept, prefer, range, apikey, x-client-info, x-supabase-api-version",
    "access-control-expose-headers": "content-range",
    "access-control-max-age": "600",
    "vary": "origin",
  }
}
function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...NO_STORE, ...extra } })
}
async function dependencyFetch(url: string, options: RequestInit): Promise<Response> {
  try { return await fetch(url, options) } catch { throw new Unavailable() }
}
function bearer(req: Request): string {
  const value = req.headers.get("authorization")
  if (!value?.startsWith("Bearer ") || value.length > 12000) throw new Error("unauthorized")
  return value.slice(7)
}
async function body(req: Request): Promise<Uint8Array> {
  const declared = req.headers.get("content-length")
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > 16384)) throw new Error("body too large")
  if (!req.body) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = req.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 16384) { await reader.cancel(); throw new Error("body too large") }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

/**
 * Core session authority, over HTTPS only: GoTrue health + the Core contract `session` verdict.
 * PERF-V2 G1: both are asked at the same time and both must settle; they are then read in the original
 * order (health first), so every outcome (503, CORE_UNAVAILABLE, 401) is the one the serial code gave.
 */
async function activeSession(rt: Runtime, userId: string, sessionId: string): Promise<void> {
  if (!uuid(userId) || !uuid(sessionId)) throw new Error("unauthorized")
  const [health, verdict] = await Promise.allSettled([
    dependencyFetch(`${rt.cfg.coreAuthUrl}/health`, {
      headers: rt.cfg.coreAnonKey ? { apikey: rt.cfg.coreAnonKey } : {}, signal: AbortSignal.timeout(2000) }),
    rt.core.call(ROUTES.session, { core_user_id: userId, session_id: sessionId }),
  ])
  // Explicit fail-closed contract even if GoTrue is down while its DB is alive.
  if (health.status === "rejected") throw health.reason
  if (!health.value.ok) throw new Unavailable()
  try {
    if (verdict.status === "rejected") throw verdict.reason
    if (verdict.value.active !== true) throw new Error("inactive session")
  } catch (error) {
    if (error instanceof Denied) {
      if (error.status >= 500) throw new CoreUnavailable()
      throw new Error("inactive session")
    }
    throw error
  }
}

async function verifiedCore(rt: Runtime, token: string): Promise<{ userId: string; sessionId: string }> {
  const response = await dependencyFetch(`${rt.cfg.coreAuthUrl}/user`, {
    headers: { authorization: `Bearer ${token}`, ...(rt.cfg.coreAnonKey ? { apikey: rt.cfg.coreAnonKey } : {}) },
    signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error("unauthorized")
  const user = await response.json()
  // Decode only after GoTrue has cryptographically verified this exact bearer.
  const p = decodeJwt(token) as Record<string, unknown>
  if (p.sub !== user.id || p.aud !== "authenticated" || p.role !== "authenticated" ||
      p.iss !== `${rt.cfg.coreJwtIssuer}` || user.is_anonymous === true) throw new Error("unauthorized")
  if (typeof p.session_id !== "string") throw new Error("unauthorized")
  await activeSession(rt, user.id, p.session_id)
  return { userId: user.id, sessionId: p.session_id }
}

async function proxy(rt: Runtime, req: Request, url: string, token: string | undefined, raw: Uint8Array | undefined, cors: Record<string, string>): Promise<Response> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (rt.cfg.torneosAnonKey) headers.apikey = rt.cfg.torneosAnonKey
  for (const name of ["accept", "content-type", "prefer", "range"]) {
    const value = req.headers.get(name)
    if (value) headers[name] = value
  }
  const r = await dependencyFetch(url, { method: req.method, headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : (raw ?? await body(req)),
    redirect: "error", signal: AbortSignal.timeout(5000) })
  const out: Record<string, string> = { "content-type": r.headers.get("content-type") ?? "application/json", ...NO_STORE, ...cors }
  if (r.headers.has("content-range")) out["content-range"] = r.headers.get("content-range")!
  const payload = await r.arrayBuffer()
  // ERROR-CONTRACT-V1: a legacy-SQLSTATE domain error (DB without 0006) is answered with its contract status.
  return new Response(payload, { status: domainErrorStatus(r.status, payload), headers: out })
}

export async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin")
  let cors: Record<string, string> = {}
  try {
    const rt = getRuntime()
    cors = corsHeaders(rt.cfg, origin)
    const expectedHost = rt.cfg.publicUrl.host
    const hostOk = [req.headers.get("host"), req.headers.get("x-forwarded-host")].includes(expectedHost)
    if (!hostOk || (origin && !rt.cfg.allowedOrigins.includes(origin))) return json(403, { error: "origin rejected" })
    const url = new URL(req.url)
    const path = routePath(url.pathname)
    if (path === null) return json(404, { error: "not found" }, cors)
    if (req.method === "OPTIONS") {
      return new Response(null, { status: origin && cors["access-control-allow-origin"] ? 204 : 403, headers: { ...NO_STORE, ...cors } })
    }
    if (req.method === "GET" && path === "/config") {
      return json(200, { coreUrl: rt.cfg.coreAuthUrl.replace(/\/auth\/v1$/, ""), torneosUrl: `${rt.cfg.publicUrl.href.replace(/\/$/, "")}/torneos`,
        anonKey: rt.cfg.torneosAnonKey ?? "" }, cors)
    }
    if (req.method === "GET" && path === "/.well-known/jwks.json") return json(200, jwks(rt.cfg.bridge), cors)
    if (req.method === "GET" && path === "/health") {
      const r = await dependencyFetch(`${rt.cfg.coreAuthUrl}/health`, { headers: rt.cfg.coreAnonKey ? { apikey: rt.cfg.coreAnonKey } : {}, signal: AbortSignal.timeout(2000) })
      return json(r.ok ? 200 : 503, { ready: r.ok }, cors)
    }
    if (req.method === "POST" && path === "/exchange") {
      const raw = await body(req)
      const text = new TextDecoder().decode(raw)
      if (raw.length && text !== "{}") return json(400, { error: "exchange accepts no identity or role input" }, cors)
      const c = await verifiedCore(rt, bearer(req))
      const row = await allocateIdentity(rt.identity, c.userId)
      const token = await issueToken(rt.cfg.bridge, row, c.sessionId)
      return json(200, { access_token: token, token_type: "Bearer", expires_in: TTL }, cors)
    }
    if (rt.commerce.mode === "test" && req.method === "POST" && path === COMMERCE_ROUTE) {
      const r = await seasonCheckout({ authorization: req.headers.get("authorization"), search: url.search,
        contentLength: req.headers.get("content-length"), body: req.body }, rt.commerce, {
        verifyBridge: (token) => verifyToken(token, rt.cfg.bridge),
        activeSession: (c) => activeSession(rt, c.core_user_id, c.session_id),
        identityExists: (c) => identityExists(rt.identity, c.sub, c.core_user_id),
        isUnavailable: (error) => error instanceof Unavailable || isUnavailable(error),
        restUrl: rt.cfg.torneosRestUrl, restApiKey: rt.cfg.torneosAnonKey,
        log: (entry) => console.log(JSON.stringify(entry)),
      })
      return json(r.status, r.body, cors)
    }
    // COMPETITION-V1: the public read-only route. No bearer, no Core session, no identity: anon only.
    const publicRpc = PUBLIC_RPC_ROUTE.exec(path)
    if (publicRpc) {
      if (req.method !== "POST") return json(405, { error: "method not allowed" }, cors)
      const decision = await preparePublicRpc({ name: publicRpc[1], authorization: req.headers.get("authorization"),
        apikey: req.headers.get("apikey"), contentType: req.headers.get("content-type"),
        contentLength: req.headers.get("content-length"), body: req.body }, rt.competition)
      if (!decision.ok) return json(decision.status, { error: decision.error }, cors)
      if (!rt.publicGate.tryEnter()) return json(503, { error: "public route busy" }, { ...cors, "retry-after": "1" })
      try {
        const r = await dependencyFetch(`${rt.cfg.torneosRestUrl}${decision.path}`, { method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...(rt.cfg.torneosAnonKey ? { apikey: rt.cfg.torneosAnonKey } : {}) },
          body: decision.body, redirect: "error", signal: AbortSignal.timeout(5000) })
        return new Response(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", ...NO_STORE, ...cors } })
      } finally {
        rt.publicGate.leave()
      }
    }
    const rest = /^\/torneos\/rest\/v1\/(rpc\/([a-z0-9_]+)|[a-z0-9_]+)$/.exec(path)
    if (rest && ["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(req.method)) {
      const token = bearer(req)
      const p: TorneosClaims = await verifyToken(token, rt.cfg.bridge)
      const rpc = rest[2]
      // Phase 2D: RPC names outside the staging v1 allowlist never reach PostgREST through this
      // gateway (verified bearer or not; the answer is a plain refusal, not a proxied 42501).
      if (rpc && !rt.rpcAllowlist.has(rpc)) return json(403, { error: "rpc not enabled" }, cors)
      // PERF-V2 G1: the Core session and the local identity (a read-only SELECT of the verified claims) are
      // checked at the same time; both must settle and both must pass, read in the original order (session
      // first). Nothing that writes (the adapter, PostgREST) starts before that.
      const [session, identity] = await Promise.allSettled([
        activeSession(rt, p.core_user_id, p.session_id),
        identityExists(rt.identity, p.sub, p.core_user_id),
      ])
      if (session.status === "rejected") throw session.reason
      if (identity.status === "rejected") throw identity.reason
      if (!identity.value) throw new Error("identity mismatch")
      let raw: Uint8Array | undefined
      if (req.method === "POST" && rpc && CONTRACTS[rpc]) {
        raw = await body(req)
        let parsed: unknown
        try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return json(400, { error: "invalid json" }, cors) }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, { error: "invalid json" }, cors)
        const request = CONTRACTS[rpc].request(parsed as Record<string, unknown>)
        if (request) {
          try {
            await rt.adapter.prepare(p, CONTRACTS[rpc].contract, request)
          } catch (error) {
            if (error instanceof AdapterDenied || error instanceof Denied) return json(error.status, { error: error.code }, cors)
            throw error
          }
        }
      }
      return await proxy(rt, req, `${rt.cfg.torneosRestUrl}${path.slice("/torneos/rest/v1".length)}${url.search}`, token, raw, cors)
    }
    return json(404, { error: "not found" }, cors)
  } catch (error) {
    // Never log request, bearer, SQL, errors with context, or response bodies.
    if (error instanceof CoreUnavailable) return json(503, { error: "CORE_UNAVAILABLE" }, cors)
    const unavailable = error instanceof Unavailable || isUnavailable(error)
    return json(unavailable ? 503 : 401, { error: "access denied" }, cors)
  }
}

// deno-lint-ignore no-explicit-any
if (typeof (globalThis as any).Deno?.serve === "function") (globalThis as any).Deno.serve(handle)
