// torneos-payments-production/config.ts — fail-closed configuration of the Mercado Pago PRODUCTION payments service.
//
// One environment only: Mercado Pago Checkout Pro PRODUCTION. Read once, validated before the first request; any
// missing, blank or out-of-contract value disables the whole service (503 on every route). There is no TEST mode, no
// default and no fallback: TEST material (MERCADO_PAGO_TEST_*, the QA pin, the TEST login) refuses the boot, and the
// TEST service refuses every MERCADO_PAGO_PRODUCTION_* name in turn (its own allowlist).
//
// Two shapes, decided by the database host, exactly like the TEST service:
//   • lab (offline database host: lab container, loopback, `.invalid` fixture): public URLs must be `.invalid`, so a
//     non-hosted production configuration can never send a buyer or a notification anywhere real. The lab Mercado Pago
//     origin (http://mp-stub:<port>) is accepted only here.
//   • hosted (TORNEOS_PAYMENTS_DEPLOYMENT=production): the Arma2 Torneos pooler with the dedicated production login
//     (torneos_payments_prod.<ref>), TLS verify-full with a CA, buyers return to https://app.arma2.com.ar only,
//     notifications arrive on one declared canonical host that carries no test / sandbox / lab label, and no Core,
//     Supabase, gateway, bridge or database variable of any other component may be present.
import { canonicalRemoteHost } from "../torneos-payments/remote-hosts.ts"

export const FUNCTION_NAME = "torneos-payments-production"
export const INTERNAL_PREFERENCE_PATH = "/internal/v1/season-checkout-preference"
export const INTERNAL_RECONCILE_PATH = "/internal/v1/purchase-reconcile"
export const WEBHOOK_PATH = "/webhooks/mercadopago/v1"
export const DEPLOYMENT_PRODUCTION = "production"
/** The Arma2 Torneos data plane (sa-east-1). Pinned, never an argument. */
export const TORNEOS_REF = "onzpwnqxnvlgsevivngf"
export const PRODUCTION_LOGIN = "torneos_payments_prod"
export const TEST_LOGIN = "torneos_payments_test"
/** Where production buyers come back to (Checkout Pro back_urls). */
export const PRODUCTION_APP_URL = "https://app.arma2.com.ar"
export const PRODUCTION_SELLER_SITE = "MLA"
const CORE_PRODUCTION_REF = "rcyuuoaqfwcembdajcss"
const POOLER_HOST_RE = /^aws-\d{1,2}-sa-east-1\.pooler\.supabase\.com$/
const POOLER_PORTS = new Set(["5432", "6543"])
const OFFLINE_DB_HOSTS = new Set(["torneos-db", "localhost", "127.0.0.1", "[::1]"])
const LAB_DB_HOSTS = new Set(["torneos-db"])
// A production notification host never looks like a test, sandbox, QA, lab, staging, preview or local deployment.
const NON_PRODUCTION_LABEL_RE = /(?:^|-)(?:test|testing|sandbox|qa|lab|staging|stage|preview|dev|local)(?:-|$)/
const FORBIDDEN_DB_LOGINS = new Set([
  "postgres", "supabase_admin", "supabase_auth_admin", "supabase_storage_admin", "supabase_replication_admin",
  "supabase_read_only_user", "supabase_realtime_admin", "dashboard_user", "pgbouncer", "service_role", "authenticator",
  "anon", "authenticated", "torneos_payment_service", "torneos_payment_production_service", "torneos_identity_writer",
  "torneos_core_adapter", "torneos_edge_identity_writer", "torneos_edge_core_adapter", "lab_identity_writer", "lab_core_adapter",
  "lab_payment_service", TEST_LOGIN,
])
// Material of other components: its presence means this is not the dedicated production payments scope.
const FORBIDDEN_ENV = new Set([
  "TORNEOS_BRIDGE_KEYS", "TORNEOS_CONTRACT_SERVICE_SECRET", "TORNEOS_DB_IDENTITY_WRITER_URL", "TORNEOS_DB_CORE_ADAPTER_URL",
  "CORE_SERVICE_ROLE_KEY", "CORE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_DB_URL", "DATABASE_URL",
  "TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID",
])
const FORBIDDEN_ENV_RE = /^PG[A-Z_]+$/
const HOSTED_FORBIDDEN_ENV_RE =
  /^(CORE_|SUPABASE_|TORNEOS_COMMERCE_|TORNEOS_GATEWAY_|TORNEOS_BRIDGE_|TORNEOS_CONTRACT_|TORNEOS_DB_|TORNEOS_REST_|TORNEOS_ANON_|TORNEOS_ALLOWED_|DATABASE_)/
const ALLOWED_MERCADO_PAGO_VARS = new Set([
  "MERCADO_PAGO_ENVIRONMENT", "MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN", "MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET",
  "MERCADO_PAGO_PRODUCTION_SELLER_ID",
])

export class ConfigError extends Error {}

export type MercadoPagoProductionConfig = { accessToken: string; webhookSecret: string; sellerId: string }

export type ProductionPaymentsConfig = {
  mp: MercadoPagoProductionConfig
  appBaseUrl: string
  notificationUrl: string
  internalSecret: Uint8Array
  dbUrl: string
  dbSslCa: string | undefined
  labMpApiOrigin: string | null
  deployment: typeof DEPLOYMENT_PRODUCTION | null // null = lab / offline fixture
  host: string | null                             // hosted: the only Host the service answers on
}

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = (env[name] ?? "").trim()
  if (!value) throw new ConfigError(`missing ${name}`)
  return value
}
function optional(env: Env, name: string): string | null {
  const value = (env[name] ?? "").trim()
  return value ? value : null
}

function parseSecret(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 64) {
    throw new ConfigError("TORNEOS_PAYMENTS_INTERNAL_SECRET must be lowercase hex of at least 32 bytes")
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  if (new Set(bytes).size < 16) throw new ConfigError("TORNEOS_PAYMENTS_INTERNAL_SECRET is low-entropy")
  return bytes
}

/** https, no credentials, no query, no fragment; returned without a trailing slash. */
function publicHttpsUrl(name: string, raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new ConfigError(`${name} is not a URL`) }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || raw.includes("?") || raw.includes("#")) {
    throw new ConfigError(`${name} must be a plain https URL`)
  }
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") throw new ConfigError(`${name} must be public`)
  if (host.includes(CORE_PRODUCTION_REF)) throw new ConfigError(`${name} names the Core project`)
  return url
}

function isOfflineHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return OFFLINE_DB_HOSTS.has(host) || host.endsWith(".invalid")
}

function parseDbUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new ConfigError("TORNEOS_PAYMENTS_DB_URL is not a URL") }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new ConfigError("TORNEOS_PAYMENTS_DB_URL is not postgres://")
  if (!url.username || !url.hostname) throw new ConfigError("TORNEOS_PAYMENTS_DB_URL has no login")
  if (url.hostname.includes(CORE_PRODUCTION_REF) || decodeURIComponent(url.username).includes(CORE_PRODUCTION_REF)) {
    throw new ConfigError("TORNEOS_PAYMENTS_DB_URL names the Core project")
  }
  const login = decodeURIComponent(url.username).split(".")[0].toLowerCase()
  if (FORBIDDEN_DB_LOGINS.has(login)) throw new ConfigError("TORNEOS_PAYMENTS_DB_URL must be the dedicated production payments login")
  return url
}

/** Why this DB URL is not the hosted production login on the Arma2 Torneos pooler, or null. */
export function hostedDbProblem(url: URL): string | null {
  if (!POOLER_HOST_RE.test(url.hostname)) return "host"
  if (!POOLER_PORTS.has(url.port)) return "port"
  if (url.pathname !== "/postgres" || url.search || url.hash) return "database"
  const user = decodeURIComponent(url.username)
  if (user !== `${PRODUCTION_LOGIN}.${TORNEOS_REF}`) return "login"
  return null
}

/** Why this hostname cannot be the production notification host, or null. */
export function notificationHostProblem(hostname: string): string | null {
  const host = canonicalRemoteHost(hostname)
  if (!host) return "not a canonical public DNS name"
  if (host.split(".").some((label) => NON_PRODUCTION_LABEL_RE.test(label))) return "carries a non-production label"
  if (host === new URL(PRODUCTION_APP_URL).hostname) return "is the web app host"
  return null
}

export function loadProductionPaymentsConfig(env: Env): ProductionPaymentsConfig {
  if (required(env, "TORNEOS_PAYMENT_PROVIDER") !== "MERCADO_PAGO") throw new ConfigError("provider must be MERCADO_PAGO")
  if (required(env, "MERCADO_PAGO_ENVIRONMENT") !== "production") throw new ConfigError("MERCADO_PAGO_ENVIRONMENT must be production")
  for (const name of Object.keys(env)) {
    const present = (env[name] ?? "").trim() !== ""
    if (name.startsWith("MERCADO_PAGO_") && !ALLOWED_MERCADO_PAGO_VARS.has(name)) throw new ConfigError(`refusing ${name}`)
    if (present && (FORBIDDEN_ENV.has(name) || FORBIDDEN_ENV_RE.test(name))) throw new ConfigError(`refusing ${name} in the production payments service`)
  }
  const mp: MercadoPagoProductionConfig = {
    accessToken: required(env, "MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN"),
    webhookSecret: required(env, "MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET"),
    sellerId: required(env, "MERCADO_PAGO_PRODUCTION_SELLER_ID"),
  }
  if (!/^[1-9]\d{3,19}$/.test(mp.sellerId)) throw new ConfigError("MERCADO_PAGO_PRODUCTION_SELLER_ID must be numeric")
  // Mercado Pago production access tokens are APP_USR-…; a TEST-… token is never production.
  if (!/^APP_USR-[A-Za-z0-9-]{20,300}$/.test(mp.accessToken)) throw new ConfigError("MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN is not a production token")
  if (mp.webhookSecret.length < 16 || /\s/.test(mp.webhookSecret)) throw new ConfigError("MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET is malformed")

  const app = publicHttpsUrl("APP_PUBLIC_URL", required(env, "APP_PUBLIC_URL"))
  const notification = publicHttpsUrl("TORNEOS_PAYMENTS_NOTIFICATION_URL", required(env, "TORNEOS_PAYMENTS_NOTIFICATION_URL"))
  if (!notification.pathname.endsWith(`/${FUNCTION_NAME}${WEBHOOK_PATH}`)) throw new ConfigError("notification URL is not the production payments webhook")

  const secretHex = required(env, "TORNEOS_PAYMENTS_INTERNAL_SECRET")
  const internalSecret = parseSecret(secretHex)
  if (secretHex === mp.webhookSecret || secretHex === mp.accessToken || mp.webhookSecret === mp.accessToken) {
    throw new ConfigError("secrets must be distinct")
  }

  const dbUrl = required(env, "TORNEOS_PAYMENTS_DB_URL")
  const db = parseDbUrl(dbUrl)
  const sslCa = optional(env, "TORNEOS_PAYMENTS_DB_SSL_CA")
  const labOrigin = optional(env, "TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN")
  const deploymentValue = optional(env, "TORNEOS_PAYMENTS_DEPLOYMENT")
  if (deploymentValue !== null && deploymentValue !== DEPLOYMENT_PRODUCTION) throw new ConfigError("TORNEOS_PAYMENTS_DEPLOYMENT must be production")

  if (deploymentValue === null) {
    // Lab / offline: nothing real can be reached.
    if (!isOfflineHost(db.hostname)) throw new ConfigError("a hosted payments database requires TORNEOS_PAYMENTS_DEPLOYMENT=production")
    if (!app.hostname.endsWith(".invalid") || !notification.hostname.endsWith(".invalid")) {
      throw new ConfigError("a non-hosted production configuration only accepts .invalid public URLs")
    }
    if (labOrigin !== null) {
      const m = /^http:\/\/mp-stub:(\d{2,5})$/.exec(labOrigin)
      if (!m || Number(m[1]) > 65535) throw new ConfigError("TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN must be http://mp-stub:<port>")
      if (!LAB_DB_HOSTS.has(db.hostname)) throw new ConfigError("the lab Mercado Pago origin requires the lab database")
    }
    return { mp, appBaseUrl: app.origin, notificationUrl: notification.href, internalSecret, dbUrl,
      dbSslCa: sslCa ? decodeEnvDocument(sslCa) : undefined, labMpApiOrigin: labOrigin, deployment: null, host: null }
  }

  // Hosted production.
  for (const name of Object.keys(env)) {
    if ((env[name] ?? "").trim() && HOSTED_FORBIDDEN_ENV_RE.test(name)) throw new ConfigError(`refusing ${name} in hosted production`)
  }
  if (labOrigin !== null) throw new ConfigError("hosted production never uses the lab Mercado Pago origin")
  const dbProblem = hostedDbProblem(db)
  if (dbProblem) throw new ConfigError(`hosted production requires the production pooler login (${dbProblem})`)
  if (!sslCa) throw new ConfigError("hosted production requires TORNEOS_PAYMENTS_DB_SSL_CA")
  if (`${app.origin}` !== PRODUCTION_APP_URL || (app.pathname !== "/" && app.pathname !== "")) throw new ConfigError("APP_PUBLIC_URL must be the production web app")
  if (notification.port) throw new ConfigError("the notification URL names a port")
  const problem = notificationHostProblem(notification.hostname)
  if (problem) throw new ConfigError(`notification host ${problem}`)
  return { mp, appBaseUrl: PRODUCTION_APP_URL, notificationUrl: notification.href, internalSecret, dbUrl,
    dbSslCa: decodeEnvDocument(sslCa), labMpApiOrigin: null, deployment: DEPLOYMENT_PRODUCTION, host: notification.hostname }
}

/** Accepts a PEM as given or base64-encoded (env files cannot carry newlines). */
function decodeEnvDocument(raw: string): string {
  if (raw.startsWith("-----BEGIN")) return raw
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))) } catch { return raw }
}

/** Strips the platform mount (`/functions/v1`) and the function name; null when not ours. */
export function routePath(pathname: string): string | null {
  let path = pathname
  if (path.startsWith("/functions/v1/")) path = path.slice("/functions/v1".length)
  const mount = `/${FUNCTION_NAME}`
  if (!path.startsWith(`${mount}/`)) return null
  return path.slice(mount.length)
}
