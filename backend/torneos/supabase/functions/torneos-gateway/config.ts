// torneos-gateway/config.ts — fail-closed configuration of the hosted gateway.
//
// Everything the Node gateway hard-coded for the loopback lab (its own origin, the Core
// Auth origin, the Core JWT issuer, the Core contract URL, the Torneos PostgREST origin,
// the two Torneos database logins, the RS256 key ring) is read once from the gateway's
// environment and validated before the first request is served. Any missing or malformed
// value disables the whole gateway: there is no default, no fallback and no "lab mode"
// switch. Which project may appear where is topology.ts: Core Production is accepted only
// as the HTTPS authority (CORE_*), never in a data-plane URL (REST / postgres), and naming
// it selects the pinned Production topology. Issuer/audience/TTL of the Torneos token are
// NOT configurable: they are constants of the certified baseline (token.ts).
import { assertCoreContractUrl, fromHex } from "./core-client.ts"
import { assertTopology, assertPublicKey, assertNoCoreAdminMaterial, PRODUCTION, TopologyError, type Topology } from "./topology.ts"
import type { BridgeConfig } from "./token.ts"

export const FUNCTION_NAME = "torneos-gateway"
// Hostnames of the local Compose lab: the only ones allowed to use plain http.
const LAB_HOSTS = new Set(["core-auth", "core-api", "torneos-rest", "torneos-db", "127.0.0.1", "localhost"])

export type GatewayConfig = {
  publicUrl: URL                 // how the browser reaches this function (host check, /config)
  allowedOrigin: string          // the exact web origin (TORNEOS_ALLOWED_ORIGIN)
  allowedOrigins: readonly string[] // exact origins allowed (CORS + Origin check): the web origin, + the Android app on Production
  coreAuthUrl: string            // GoTrue base (…/auth/v1 on hosted; http://core-auth:9999 in the lab)
  coreJwtIssuer: string          // expected `iss` of Core access tokens
  coreAnonKey: string | null     // Core public key for Kong's apikey (hosted only)
  coreContractUrl: string        // …/functions/v1/torneos-core-contract
  coreContractSecret: Uint8Array // HMAC service secret (hex ≥ 32 bytes)
  torneosRestUrl: string         // PostgREST base (…/rest/v1 on hosted; http://torneos-rest:3000 in the lab)
  torneosAnonKey: string | null  // Torneos public key for Kong's apikey (hosted only); also /config
  identityWriterUrl: string      // postgres:// login, NOINHERIT member of torneos_identity_writer
  coreAdapterUrl: string         // postgres:// login, NOINHERIT member of torneos_core_adapter
  dbSslCa: string | undefined
  bridge: BridgeConfig
  topology: Topology             // production (Core Production + Torneos data, pinned) or nonproduction
}

export class ConfigError extends Error {}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = (env[name] ?? "").trim()
  if (!value) throw new ConfigError(`missing ${name}`)
  return value
}
function optional(env: Record<string, string | undefined>, name: string): string | null {
  const value = (env[name] ?? "").trim()
  return value ? value : null
}

export function assertHttpOrigin(name: string, value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new ConfigError(`${name} is not a URL`) }
  if (url.search || url.hash || url.username || url.password) throw new ConfigError(`${name} carries credentials or query`)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LAB_HOSTS.has(url.hostname))) throw new ConfigError(`${name} must be https`)
  return url
}

export function assertPostgresUrl(name: string, value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new ConfigError(`${name} is not a URL`) }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new ConfigError(`${name} is not postgres://`)
  if (!url.username) throw new ConfigError(`${name} has no login`)
  return value
}

/** Accepts the value as given or base64-encoded (env files cannot carry PEM newlines). */
export function decodeEnvDocument(raw: string): string {
  const value = raw.trim()
  if (value.startsWith("{") || value.startsWith("-----BEGIN")) return value
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))) } catch { return value }
}

export function parseBridgeKeys(raw: string): BridgeConfig {
  let doc: any
  try { doc = JSON.parse(decodeEnvDocument(raw)) } catch { throw new ConfigError("TORNEOS_BRIDGE_KEYS is not JSON") }
  if (!doc || !Array.isArray(doc.keys) || typeof doc.activeKid !== "string" || !Array.isArray(doc.trustedKids)) throw new ConfigError("TORNEOS_BRIDGE_KEYS shape")
  for (const k of doc.keys) {
    if (typeof k?.kid !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(k.kid)) throw new ConfigError("TORNEOS_BRIDGE_KEYS kid")
    if (k.privateKey !== undefined && (typeof k.privateKey !== "string" || !k.privateKey.includes("-----BEGIN PRIVATE KEY-----"))) throw new ConfigError("TORNEOS_BRIDGE_KEYS privateKey")
    if (!k.publicKey || typeof k.publicKey !== "object" || k.publicKey.kty !== "RSA" || typeof k.publicKey.n !== "string" || typeof k.publicKey.e !== "string") throw new ConfigError("TORNEOS_BRIDGE_KEYS publicKey")
  }
  const active = doc.keys.find((k: any) => k.kid === doc.activeKid)
  if (!active?.privateKey) throw new ConfigError("TORNEOS_BRIDGE_KEYS active key has no private key")
  if (!doc.trustedKids.every((kid: unknown) => typeof kid === "string" && doc.keys.some((k: any) => k.kid === kid))) throw new ConfigError("TORNEOS_BRIDGE_KEYS trustedKids")
  if (!doc.trustedKids.includes(doc.activeKid)) throw new ConfigError("TORNEOS_BRIDGE_KEYS active key is not trusted")
  return { keys: doc.keys, activeKid: doc.activeKid, trustedKids: doc.trustedKids }
}

export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  try { assertNoCoreAdminMaterial(env) } catch (error) { throw asConfigError(error) }
  const publicUrl = assertHttpOrigin("TORNEOS_GATEWAY_PUBLIC_URL", required(env, "TORNEOS_GATEWAY_PUBLIC_URL"))
  const allowed = assertHttpOrigin("TORNEOS_ALLOWED_ORIGIN", required(env, "TORNEOS_ALLOWED_ORIGIN"))
  if (allowed.pathname !== "/" || allowed.href !== `${allowed.origin}/`) throw new ConfigError("TORNEOS_ALLOWED_ORIGIN must be a bare origin")
  const coreAuth = assertHttpOrigin("CORE_AUTH_URL", required(env, "CORE_AUTH_URL"))
  const issuer = assertHttpOrigin("CORE_JWT_ISSUER", required(env, "CORE_JWT_ISSUER"))
  const contract = assertHttpOrigin("CORE_CONTRACT_URL", required(env, "CORE_CONTRACT_URL"))
  const secretHex = required(env, "TORNEOS_CONTRACT_SERVICE_SECRET")
  if (!/^[0-9a-f]{64,}$/.test(secretHex) || secretHex.length % 2 !== 0) throw new ConfigError("TORNEOS_CONTRACT_SERVICE_SECRET must be hex of at least 32 bytes")
  const rest = assertHttpOrigin("TORNEOS_REST_URL", required(env, "TORNEOS_REST_URL"))
  const identityWriterUrl = assertPostgresUrl("TORNEOS_DB_IDENTITY_WRITER_URL", required(env, "TORNEOS_DB_IDENTITY_WRITER_URL"))
  const coreAdapterUrl = assertPostgresUrl("TORNEOS_DB_CORE_ADAPTER_URL", required(env, "TORNEOS_DB_CORE_ADAPTER_URL"))
  const dbSslCa = optional(env, "TORNEOS_DB_SSL_CA") ? decodeEnvDocument(optional(env, "TORNEOS_DB_SSL_CA")!) : undefined
  const coreAnonKey = optional(env, "CORE_ANON_KEY")
  const torneosAnonKey = optional(env, "TORNEOS_ANON_KEY")
  let topology: Topology
  try {
    assertPublicKey("CORE_ANON_KEY", coreAnonKey)
    assertPublicKey("TORNEOS_ANON_KEY", torneosAnonKey)
    topology = assertTopology({ publicUrl, allowedOrigin: allowed, coreAuth, coreIssuer: issuer, coreContract: contract, rest,
      identityWriter: new URL(identityWriterUrl), coreAdapter: new URL(coreAdapterUrl) },
      { dbSslCa: dbSslCa !== undefined, commerceMode: (env.TORNEOS_COMMERCE_MODE ?? "").trim() })
  } catch (error) { throw asConfigError(error) }
  let contractUrl: string
  try { contractUrl = assertCoreContractUrl(contract.href) } catch (error) { throw new ConfigError(`CORE_CONTRACT_URL rejected (${(error as Error).message})`) }
  // The Torneos data plane must not be the Core one: a shared origin would be a shared project (also for non-hosted hosts).
  if (rest.origin === coreAuth.origin && !LAB_HOSTS.has(rest.hostname)) throw new ConfigError("TORNEOS_REST_URL must not be the Core project")
  return {
    publicUrl,
    allowedOrigin: allowed.origin,
    allowedOrigins: Object.freeze(topology.kind === "production" ? [allowed.origin, PRODUCTION.nativeAppOrigin] : [allowed.origin]),
    coreAuthUrl: coreAuth.href.replace(/\/$/, ""),
    coreJwtIssuer: issuer.href.replace(/\/$/, ""),
    coreAnonKey,
    coreContractUrl: contractUrl,
    coreContractSecret: fromHex(secretHex),
    torneosRestUrl: rest.href.replace(/\/$/, ""),
    torneosAnonKey,
    identityWriterUrl,
    coreAdapterUrl,
    dbSslCa,
    bridge: parseBridgeKeys(required(env, "TORNEOS_BRIDGE_KEYS")),
    topology,
  }
}

function asConfigError(error: unknown): ConfigError {
  return error instanceof TopologyError ? new ConfigError(error.message) : error instanceof ConfigError ? error : new ConfigError("configuration rejected")
}

/** Strips the platform mount (`/functions/v1`) and the function name; null when not ours. */
export function routePath(pathname: string): string | null {
  let path = pathname
  if (path.startsWith("/functions/v1/")) path = path.slice("/functions/v1".length)
  const mount = `/${FUNCTION_NAME}`
  if (path === mount) return "/"
  if (!path.startsWith(`${mount}/`)) return null
  return path.slice(mount.length)
}
