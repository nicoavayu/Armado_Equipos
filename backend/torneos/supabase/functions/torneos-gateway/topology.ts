// torneos-gateway/topology.ts — which Supabase project may play which part for this gateway.
//
// Two planes, never the same project:
//   Core AUTHORITY  CORE_AUTH_URL, CORE_JWT_ISSUER, CORE_CONTRACT_URL. Reached ONLY over HTTPS: GoTrue
//                   (/user, /health) and the signed Core contract. Never a database, never a key above anon.
//   Torneos DATA    TORNEOS_REST_URL, TORNEOS_DB_IDENTITY_WRITER_URL, TORNEOS_DB_CORE_ADAPTER_URL. The only
//                   database this gateway ever opens, through the two torneos_edge_* logins.
//
// The rule is not "Production is forbidden". It is: Core Production is allowed EXCLUSIVELY as the HTTPS
// authority, and never as a data backend. Concretely:
//   • a data-plane URL (REST or postgres) that names any Core project (Production or the retired Staging)
//     is refused: no DB-to-DB, no Torneos REST on Core;
//   • an authority URL that names the Torneos data project is refused;
//   • all three authority URLs name the same project (or none: the loopback lab); same for the data plane;
//     the two planes never name the same project;
//   • naming Core Production OR the Torneos data project selects the PRODUCTION topology, which pins
//     both sides exactly (canonical URLs, logins, TLS, the certified web origin, no Edge Function host,
//     commerce off). A Production half with a non-Production other half is a configuration error.
//
// A "project named by a URL" is any 20-letter lowercase label of its hostname (`<ref>.supabase.co`,
// `db.<ref>.supabase.co`) or of its login (`<login>.<ref>` on the Supavisor pooler).

export const CORE_PRODUCTION_REF = "rcyuuoaqfwcembdajcss"
export const TORNEOS_DATA_REF = "onzpwnqxnvlgsevivngf"
// Core Staging: paused (INACTIVE) since INFRA-1 R3. It is a Core project, so it can never be a data plane.
export const CORE_STAGING_REF = "hhyvmhgpapyuzjgxfnqv"
export const CORE_REFS: readonly string[] = Object.freeze([CORE_PRODUCTION_REF, CORE_STAGING_REF])

// The Production topology, exactly. Issuer = the GoTrue URL of Core Production (no custom auth domain).
export const PRODUCTION = Object.freeze({
  coreAuthUrl: `https://${CORE_PRODUCTION_REF}.supabase.co/auth/v1`,
  coreJwtIssuer: `https://${CORE_PRODUCTION_REF}.supabase.co/auth/v1`,
  coreContractUrl: `https://${CORE_PRODUCTION_REF}.supabase.co/functions/v1/torneos-core-contract`,
  torneosRestUrl: `https://${TORNEOS_DATA_REF}.supabase.co/rest/v1`,
  allowedOrigin: "https://app.arma2.com.ar",
  // The Android app's WebView (Capacitor 7: androidScheme https, hostname localhost), measured on the wire
  // 2026-09-29. Pinned here, never from env; allowed only in addition to the web origin, only on Production.
  nativeAppOrigin: "https://localhost",
  identityWriterLogin: "torneos_edge_identity_writer",
  coreAdapterLogin: "torneos_edge_core_adapter",
  // Supavisor (session :5432 / transaction :6543) in the project's region, or the direct host.
  poolerHost: /^aws-\d+-sa-east-1\.pooler\.supabase\.com$/,
  directHost: `db.${TORNEOS_DATA_REF}.supabase.co`,
})

// Logins no gateway URL may carry, in any topology (admin, platform, API roles, payments).
const FORBIDDEN_LOGIN = /^(postgres|supabase_[a-z_]*|service_role|authenticator|anon|authenticated|pgbouncer|dashboard_user|torneos_payment[a-z_]*|torneos_identity_writer|torneos_core_adapter)$/
// Environment names that carry Core administrative material: never in this gateway's environment.
export const FORBIDDEN_CORE_ADMIN_ENV: readonly string[] = Object.freeze(["CORE_SERVICE_ROLE_KEY", "CORE_SECRET_KEY", "CORE_JWT_SECRET", "CORE_DB_URL", "CORE_DATABASE_URL"])

export class TopologyError extends Error {}

const REF_LABEL = /^[a-z]{20}$/

/** Every project ref a URL names (hostname labels + the pooler `<login>.<ref>` suffix). */
export function refsOf(url: URL): string[] {
  const labels = url.hostname.toLowerCase().split(".")
  const login = decodeURIComponent(url.username).toLowerCase().split(".")
  return [...new Set([...labels, ...login.slice(1)].filter((l) => REF_LABEL.test(l)))]
}

/** The plain login of a postgres URL (`<login>` or `<login>.<ref>`), lower-cased. */
export function loginOf(url: URL): string {
  return decodeURIComponent(url.username).toLowerCase().split(".")[0]
}

function planeRef(plane: string, urls: [string, URL][]): string | null {
  const named = urls.map(([, u]) => refsOf(u))
  const all = [...new Set(named.flat())]
  if (all.length > 1) throw new TopologyError(`${plane} names more than one project`)
  if (all.length === 1 && named.some((refs) => refs.length === 0)) throw new TopologyError(`${plane} mixes a hosted project with a non-hosted endpoint`)
  return all[0] ?? null
}

export type Topology = { kind: "production" | "nonproduction"; coreRef: string | null; dataRef: string | null }

export type PlaneUrls = {
  publicUrl: URL
  allowedOrigin: URL
  coreAuth: URL
  coreIssuer: URL
  coreContract: URL
  rest: URL
  identityWriter: URL
  coreAdapter: URL
}

/** Applies the two-plane rule; returns the topology or throws TopologyError (reason only, never a value). */
export function assertTopology(u: PlaneUrls, extra: { dbSslCa: boolean; commerceMode: string }): Topology {
  // Data plane: never a Core project, whatever the topology — the refs are checked in every part of the URL.
  for (const [name, url] of [["TORNEOS_REST_URL", u.rest], ["TORNEOS_DB_IDENTITY_WRITER_URL", u.identityWriter], ["TORNEOS_DB_CORE_ADAPTER_URL", u.coreAdapter]] as [string, URL][]) {
    const raw = decodeURIComponent(url.href).toLowerCase()
    if (CORE_REFS.some((ref) => raw.includes(ref))) throw new TopologyError(`${name} names a Core project (Core is reachable only over HTTPS as the authority)`)
  }
  for (const [name, url] of [["TORNEOS_DB_IDENTITY_WRITER_URL", u.identityWriter], ["TORNEOS_DB_CORE_ADAPTER_URL", u.coreAdapter]] as [string, URL][]) {
    if (FORBIDDEN_LOGIN.test(loginOf(url))) throw new TopologyError(`${name} uses a forbidden login`)
  }
  // Authority plane: never the Torneos data project.
  for (const [name, url] of [["CORE_AUTH_URL", u.coreAuth], ["CORE_JWT_ISSUER", u.coreIssuer], ["CORE_CONTRACT_URL", u.coreContract]] as [string, URL][]) {
    if (refsOf(url).includes(TORNEOS_DATA_REF)) throw new TopologyError(`${name} names the Torneos data project`)
  }
  // The browser-facing endpoints never name a Core project.
  for (const [name, url] of [["TORNEOS_GATEWAY_PUBLIC_URL", u.publicUrl], ["TORNEOS_ALLOWED_ORIGIN", u.allowedOrigin]] as [string, URL][]) {
    if (refsOf(url).some((ref) => CORE_REFS.includes(ref))) throw new TopologyError(`${name} names a Core project`)
  }
  const coreRef = planeRef("the Core authority plane", [["CORE_AUTH_URL", u.coreAuth], ["CORE_JWT_ISSUER", u.coreIssuer], ["CORE_CONTRACT_URL", u.coreContract]])
  const dataRef = planeRef("the Torneos data plane", [["TORNEOS_REST_URL", u.rest], ["TORNEOS_DB_IDENTITY_WRITER_URL", u.identityWriter], ["TORNEOS_DB_CORE_ADAPTER_URL", u.coreAdapter]])
  if (coreRef !== null && coreRef === dataRef) throw new TopologyError("the Core authority and the Torneos data plane name the same project")
  const production = coreRef === CORE_PRODUCTION_REF || dataRef === TORNEOS_DATA_REF
  if (!production) return { kind: "nonproduction", coreRef, dataRef }

  // ── Production: both halves, exactly ──
  if (coreRef !== CORE_PRODUCTION_REF) throw new TopologyError("the Torneos data project requires Core Production as the authority")
  if (dataRef !== TORNEOS_DATA_REF) throw new TopologyError("Core Production requires the Torneos data project as the data plane")
  const bare = (url: URL) => url.href.replace(/\/$/, "")
  if (bare(u.coreAuth) !== PRODUCTION.coreAuthUrl) throw new TopologyError("CORE_AUTH_URL is not the Core Production GoTrue URL")
  if (bare(u.coreIssuer) !== PRODUCTION.coreJwtIssuer) throw new TopologyError("CORE_JWT_ISSUER is not the Core Production issuer")
  if (bare(u.coreContract) !== PRODUCTION.coreContractUrl) throw new TopologyError("CORE_CONTRACT_URL is not the certified Core Production contract")
  if (bare(u.rest) !== PRODUCTION.torneosRestUrl) throw new TopologyError("TORNEOS_REST_URL is not the Torneos data project REST URL")
  if (u.allowedOrigin.origin !== PRODUCTION.allowedOrigin) throw new TopologyError("TORNEOS_ALLOWED_ORIGIN is not the certified web origin")
  // The gateway is an external app: never a Supabase Edge Function, never a Supabase-hosted URL.
  if (u.publicUrl.protocol !== "https:" || /(^|\.)supabase\.(co|in|com|net)$/.test(u.publicUrl.hostname) || refsOf(u.publicUrl).length) {
    throw new TopologyError("TORNEOS_GATEWAY_PUBLIC_URL must be the external gateway host (no Supabase / Edge Function host)")
  }
  const expected: [string, URL, string][] = [
    ["TORNEOS_DB_IDENTITY_WRITER_URL", u.identityWriter, PRODUCTION.identityWriterLogin],
    ["TORNEOS_DB_CORE_ADAPTER_URL", u.coreAdapter, PRODUCTION.coreAdapterLogin],
  ]
  for (const [name, url, login] of expected) {
    const user = decodeURIComponent(url.username).toLowerCase()
    const pooled = PRODUCTION.poolerHost.test(url.hostname)
    if (!pooled && url.hostname !== PRODUCTION.directHost) throw new TopologyError(`${name} host is neither the sa-east-1 pooler nor the Torneos direct host`)
    if (user !== (pooled ? `${login}.${TORNEOS_DATA_REF}` : login)) throw new TopologyError(`${name} login is not ${login}`)
    if (url.pathname !== "/postgres") throw new TopologyError(`${name} database is not postgres`)
  }
  if (u.identityWriter.host !== u.coreAdapter.host) throw new TopologyError("the two database logins target different hosts")
  if (!extra.dbSslCa) throw new TopologyError("TORNEOS_DB_SSL_CA is required against the Torneos data project (verified TLS)")
  if (extra.commerceMode !== "") throw new TopologyError("commerce must be OFF against Core Production")
  return { kind: "production", coreRef, dataRef }
}

/** Keys the gateway sends as `apikey`: public level only (publishable or an anon JWT), never secret level. */
export function assertPublicKey(name: string, value: string | null): void {
  if (value === null) return
  if (/^sb_secret_/.test(value)) throw new TopologyError(`${name} is a secret key`)
  if (/^eyJ[\w-]+\.eyJ[\w-]+\./.test(value)) {
    let role: unknown = null
    try { role = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))).role } catch { role = "unreadable" }
    if (role !== "anon") throw new TopologyError(`${name} is not an anon-level key`)
  }
}

/** Core administrative material never reaches this gateway: by name, or by value (a Core service_role JWT). */
export function assertNoCoreAdminMaterial(env: Record<string, string | undefined>): void {
  for (const name of FORBIDDEN_CORE_ADMIN_ENV) if ((env[name] ?? "").trim()) throw new TopologyError(`${name} must not be set on the gateway`)
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || !/^eyJ[\w-]+\.eyJ[\w-]+\./.test(value.trim())) continue
    let claims: Record<string, unknown> = {}
    try { claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.trim().split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))) } catch { continue }
    if (CORE_REFS.includes(String(claims.ref ?? "")) && claims.role !== "anon") throw new TopologyError(`${name} carries a Core key above anon`)
  }
}
