// torneos-payments/config.ts — fail-closed configuration of the Mercado Pago TEST payments service.
//
// MP-A3 knows exactly one environment: Mercado Pago Checkout Pro TEST. Everything is read once from the
// function environment and validated before the first request; any missing, blank or out-of-contract value
// disables the whole service (503 on its two routes). There is no live/production mode, no default and no
// fallback. The Mercado Pago part is validated by the reused provider itself (getMercadoPagoTestConfig,
// requirePublicHttpsUrl), unchanged.
//
// Lab only: TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN points the provider's fixed API origin at the local mp-stub
// (see lab-fetch.ts). It is accepted solely as http://mp-stub:<port>, and only together with a non-routable
// (.invalid) APP_PUBLIC_URL and the lab database host, so a hosted deployment can never be half-lab.
import {
  getMercadoPagoTestConfig,
  type MercadoPagoTestConfig,
  requirePublicHttpsUrl,
} from "../_shared/mercadoPagoPaymentProvider.ts"
import { canonicalRemoteHost, productionHostProblem } from "./remote-hosts.ts"
import {
  DEPLOYMENT_REMOTE_TEST,
  isOfflineDbHost,
  isQaOrganizationId,
  QA_ORGANIZATION_ENV,
  REMOTE_TEST_FORBIDDEN_ENV_RE,
  remoteTestDbProblem,
  remoteTestHost,
} from "./remote-test.ts"

export const FUNCTION_NAME = "torneos-payments"
export const INTERNAL_PATH = "/internal/v1/season-checkout-preference"
export const WEBHOOK_PATH = "/webhooks/mercadopago/v1"
const PRODUCTION_REF = "rcyuuoaqfwcembdajcss"
const LAB_DB_HOSTS = new Set(["torneos-db"])
// Logins that are never the payments identity: platform/API roles, owners, and the gateway's own logins
// (MP-B1.1 R3: including the hosted torneos_edge_* logins the gateway connects with).
const FORBIDDEN_DB_LOGINS = new Set([
  "postgres", "supabase_admin", "supabase_auth_admin", "supabase_storage_admin", "supabase_replication_admin",
  "supabase_read_only_user", "supabase_realtime_admin", "dashboard_user", "pgbouncer", "service_role", "authenticator",
  "anon", "authenticated", "torneos_payment_service", "torneos_identity_writer", "torneos_core_adapter",
  "torneos_edge_identity_writer", "torneos_edge_core_adapter", "lab_identity_writer", "lab_core_adapter",
])
// MP-B1.1 R3: material that belongs to the gateway, Core, the Supabase admin plane or a platform database binding.
// Its presence means the secret scope is not the dedicated payments app's own: the boot is refused. Exact names of
// private values only (public configuration stays tolerated); PG* variables are refused as a family because
// postgres.js 3.4.7 silently reads PGHOST/PGUSER/PGPASSWORD/PGDATABASE/… and PG<OPTION> (PGSSL, PGIDLE_TIMEOUT, …)
// for anything the URL and the options leave unset.
const FORBIDDEN_PAYMENTS_ENV = new Set([
  "TORNEOS_BRIDGE_KEYS", "TORNEOS_CONTRACT_SERVICE_SECRET", "TORNEOS_DB_IDENTITY_WRITER_URL", "TORNEOS_DB_CORE_ADAPTER_URL",
  "CORE_SERVICE_ROLE_KEY", "CORE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_DB_URL", "DATABASE_URL",
])
const FORBIDDEN_PAYMENTS_ENV_RE = /^PG[A-Z_]+$/
// Every Mercado Pago variable the service may see; anything else (MERCADO_PAGO_ACCESS_TOKEN, *_LIVE_*,
// *_PRODUCTION_* …) is a live-looking credential and refuses the boot.
const ALLOWED_MERCADO_PAGO_VARS = new Set([
  "MERCADO_PAGO_ENVIRONMENT", "MERCADO_PAGO_TEST_ACCESS_TOKEN", "MERCADO_PAGO_TEST_WEBHOOK_SECRET", "MERCADO_PAGO_TEST_SELLER_ID",
])

export class ConfigError extends Error {}

export type PaymentsConfig = {
  mp: MercadoPagoTestConfig      // TEST access token, webhook secret, seller id
  appBaseUrl: string             // public https origin of the app (back_urls)
  notificationUrl: string        // public https URL of this function's webhook route
  internalSecret: Uint8Array     // gateway → payments HMAC key (≥ 32 bytes)
  dbUrl: string                  // postgres:// dedicated login, NOINHERIT member of torneos_payment_service
  dbSslCa: string | undefined
  labMpApiOrigin: string | null  // lab only: http://mp-stub:<port>
  // PAYMENTS TEST: "remote-test" = the hosted TEST app (remote-test.ts); null = lab / loopback / offline fixture.
  deployment: typeof DEPLOYMENT_REMOTE_TEST | null
  remoteHost: string | null      // remote-test only: the only Host the app answers on
  qaOrganizationId: string | null // remote-test only: the one QA organization it may serve (null = serves no purchase)
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
function namesProduction(url: URL): boolean {
  return url.hostname.split(".").includes(PRODUCTION_REF) || decodeURIComponent(url.username).includes(PRODUCTION_REF)
}

function parseSecret(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 64) {
    throw new ConfigError("TORNEOS_PAYMENTS_INTERNAL_SECRET must be lowercase hex of at least 32 bytes")
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  if (bytes.every((b) => b === bytes[0])) throw new ConfigError("TORNEOS_PAYMENTS_INTERNAL_SECRET is degenerate")
  return bytes
}

function parseDbUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new ConfigError("TORNEOS_PAYMENTS_DB_URL is not a URL") }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new ConfigError("TORNEOS_PAYMENTS_DB_URL is not postgres://")
  if (!url.username || !url.hostname) throw new ConfigError("TORNEOS_PAYMENTS_DB_URL has no login")
  if (namesProduction(url)) throw new ConfigError("TORNEOS_PAYMENTS_DB_URL names Production")
  // Pooler logins are `<login>.<project ref>`; the login part decides.
  const login = decodeURIComponent(url.username).split(".")[0].toLowerCase()
  if (FORBIDDEN_DB_LOGINS.has(login)) throw new ConfigError("TORNEOS_PAYMENTS_DB_URL must be the dedicated payments login")
  return url
}

export function loadPaymentsConfig(env: Env): PaymentsConfig {
  if (required(env, "TORNEOS_PAYMENT_PROVIDER") !== "MERCADO_PAGO") throw new ConfigError("provider must be MERCADO_PAGO")
  for (const name of Object.keys(env)) {
    if (name.startsWith("MERCADO_PAGO_") && !ALLOWED_MERCADO_PAGO_VARS.has(name)) throw new ConfigError(`refusing ${name}`)
    if ((env[name] ?? "").trim() && (FORBIDDEN_PAYMENTS_ENV.has(name) || FORBIDDEN_PAYMENTS_ENV_RE.test(name))) {
      throw new ConfigError(`refusing ${name} in the payments service`)
    }
  }
  let mp: MercadoPagoTestConfig
  try {
    // Exactly MERCADO_PAGO_ENVIRONMENT=test plus the three TEST values (the provider's own contract).
    mp = getMercadoPagoTestConfig({ get: (name: string) => env[name] })
  } catch {
    throw new ConfigError("Mercado Pago TEST configuration invalid")
  }
  if (!/^[1-9]\d{3,19}$/.test(mp.sellerId)) throw new ConfigError("MERCADO_PAGO_TEST_SELLER_ID must be numeric")

  let appBaseUrl: string
  let notificationUrl: string
  try {
    appBaseUrl = requirePublicHttpsUrl(required(env, "APP_PUBLIC_URL"))
    notificationUrl = requirePublicHttpsUrl(required(env, "TORNEOS_PAYMENTS_NOTIFICATION_URL"))
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError("public URLs must be public https")
  }
  const app = new URL(appBaseUrl)
  const notification = new URL(notificationUrl)
  if (namesProduction(app) || namesProduction(notification)) throw new ConfigError("public URL names Production")
  // MP-B1.1 R2: TEST never sends buyers back to, nor receives notifications on, a Production host (web or Supabase).
  if (productionHostProblem(app.hostname) || productionHostProblem(notification.hostname)) throw new ConfigError("public URL names Production")
  if (app.search || notification.search) throw new ConfigError("public URLs carry a query")
  if (!notification.pathname.endsWith(`/${FUNCTION_NAME}${WEBHOOK_PATH}`)) throw new ConfigError("notification URL is not the payments webhook")

  const internalSecret = parseSecret(required(env, "TORNEOS_PAYMENTS_INTERNAL_SECRET"))
  const secretHex = required(env, "TORNEOS_PAYMENTS_INTERNAL_SECRET")
  if (secretHex === mp.webhookSecret || secretHex === mp.accessToken || mp.webhookSecret === mp.accessToken) {
    throw new ConfigError("secrets must be distinct")
  }

  const dbUrl = required(env, "TORNEOS_PAYMENTS_DB_URL")
  const db = parseDbUrl(dbUrl)
  const sslCa = optional(env, "TORNEOS_PAYMENTS_DB_SSL_CA")

  const labOrigin = optional(env, "TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN")
  if (labOrigin !== null) {
    const m = /^http:\/\/mp-stub:(\d{2,5})$/.exec(labOrigin)
    if (!m || Number(m[1]) > 65535) throw new ConfigError("TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN must be http://mp-stub:<port>")
    if (!app.hostname.endsWith(".invalid") || !notification.hostname.endsWith(".invalid") || !LAB_DB_HOSTS.has(db.hostname)) {
      throw new ConfigError("the lab Mercado Pago origin requires the lab public URLs and database")
    }
  }

  // PAYMENTS TEST: a database that is not offline is a hosted deployment, and a hosted deployment is remote-test only.
  const deploymentValue = optional(env, "TORNEOS_PAYMENTS_DEPLOYMENT")
  if (deploymentValue !== null && deploymentValue !== DEPLOYMENT_REMOTE_TEST) throw new ConfigError("TORNEOS_PAYMENTS_DEPLOYMENT must be remote-test")
  const deployment = deploymentValue === DEPLOYMENT_REMOTE_TEST ? DEPLOYMENT_REMOTE_TEST : null
  if (deployment === null && !isOfflineDbHost(db.hostname)) {
    throw new ConfigError("a hosted payments database requires TORNEOS_PAYMENTS_DEPLOYMENT=remote-test")
  }
  let remoteHost: string | null = null
  const qaOrganizationId = optional(env, QA_ORGANIZATION_ENV)
  if (qaOrganizationId !== null && (deployment === null || !isQaOrganizationId(qaOrganizationId))) {
    throw new ConfigError(`${QA_ORGANIZATION_ENV} must be a lowercase uuid, remote-test only`)
  }
  if (deployment !== null) {
    for (const name of Object.keys(env)) {
      if ((env[name] ?? "").trim() && REMOTE_TEST_FORBIDDEN_ENV_RE.test(name)) throw new ConfigError(`refusing ${name} in remote-test`)
    }
    if (labOrigin !== null) throw new ConfigError("remote-test never uses the lab Mercado Pago origin")
    if (remoteTestDbProblem(db) !== null) throw new ConfigError("remote-test requires the Arma2 Torneos pooler login")
    if (!sslCa) throw new ConfigError("remote-test requires TORNEOS_PAYMENTS_DB_SSL_CA")
    remoteHost = remoteTestHost(notification)
    if (remoteHost === null || app.port || canonicalRemoteHost(app.hostname) === null) {
      throw new ConfigError("remote-test public URLs must be canonical public hosts")
    }
  }

  return {
    deployment,
    remoteHost,
    qaOrganizationId,
    mp,
    appBaseUrl,
    notificationUrl,
    internalSecret,
    dbUrl,
    dbSslCa: sslCa ? decodeEnvDocument(sslCa) : undefined,
    labMpApiOrigin: labOrigin,
  }
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
