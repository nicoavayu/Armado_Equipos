// Per-worker environment of the lab router (MP-A3 hardening). The edge-runtime container carries the
// configuration of every function it hosts; each worker receives only the variables on its own list:
// the gateway never sees Mercado Pago / payments secrets, torneos-payments never sees Core, bridge or
// gateway DB credentials, and no worker receives the container's own variables (PATH, HOME, …).
// Hosted Supabase shares Edge Function secrets across the whole project: this isolation exists only in the
// lab and remains a Production blocker for the real deployment.
// MP-A4: the gateway reads TORNEOS_COMMERCE_MODE; only when it is set does it also receive the link to
// torneos-payments (internal URL + the shared HMAC key) — never a Mercado Pago value or the payments DB login.
// COMMERCE-PRODUCTION: in `production` mode the router itself pins TORNEOS_COMMERCE_DEPLOYMENT=local-lab (the
// container's own value is never forwarded, so this lab can become neither remote TEST nor hosted production) and hands
// the gateway the HMAC key of torneos-payments-production (PRODUCTION_PAYMENTS__TORNEOS_PAYMENTS_INTERNAL_SECRET), never
// the unprefixed one the TEST worker reads: the two workers never share a key.
const GATEWAY_ENV = [
  "TORNEOS_GATEWAY_PUBLIC_URL", "TORNEOS_ALLOWED_ORIGIN", "CORE_AUTH_URL", "CORE_JWT_ISSUER", "CORE_ANON_KEY",
  "CORE_CONTRACT_URL", "TORNEOS_CONTRACT_SERVICE_SECRET", "TORNEOS_REST_URL", "TORNEOS_ANON_KEY",
  "TORNEOS_DB_IDENTITY_WRITER_URL", "TORNEOS_DB_CORE_ADAPTER_URL", "TORNEOS_DB_SSL_CA", "TORNEOS_BRIDGE_KEYS",
  "TORNEOS_COMMERCE_MODE",
  // PLAN READ / SOCIAL-V1: the gateway's non-secret opt-ins, so a lab can mirror Production's flags (absent → absent).
  "TORNEOS_PLAN_READ_MODE", "TORNEOS_SOCIAL_MODE",
  // CONNECTED-V1: the opt-in mode only (no secret); absent in the container → absent in the worker.
  "TORNEOS_CONNECTED_MODE",
  // BRANDING-V1: the opt-in mode and the storage targets (no secret; the anon key is already listed above).
  "TORNEOS_BRANDING_MODE", "TORNEOS_STORAGE_URL", "TORNEOS_STORAGE_PUBLIC_URL",
  // MEDIA-V1: the photo galleries' opt-in mode only (no secret; it reuses the BRANDING-V1 storage targets above).
  "TORNEOS_MEDIA_MODE",
] as const
const GATEWAY_COMMERCE_ENV = ["TORNEOS_PAYMENTS_INTERNAL_URL", "TORNEOS_PAYMENTS_INTERNAL_SECRET"] as const
const PAYMENTS_ENV = [
  "TORNEOS_PAYMENT_PROVIDER", "MERCADO_PAGO_ENVIRONMENT", "MERCADO_PAGO_TEST_ACCESS_TOKEN", "MERCADO_PAGO_TEST_WEBHOOK_SECRET",
  "MERCADO_PAGO_TEST_SELLER_ID", "APP_PUBLIC_URL", "TORNEOS_PAYMENTS_NOTIFICATION_URL", "TORNEOS_PAYMENTS_INTERNAL_SECRET",
  "TORNEOS_PAYMENTS_DB_URL", "TORNEOS_PAYMENTS_DB_SSL_CA", "TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN",
] as const
// COMMERCE-PRODUCTION (lab only): torneos-payments-production reads the same generic names as torneos-payments
// (APP_PUBLIC_URL, TORNEOS_PAYMENTS_DB_URL, …) with other values. The container keeps them under the
// PRODUCTION_PAYMENTS__ prefix and only this worker receives them, unprefixed: the TEST worker never sees a
// production value and this one never sees a TEST value. TORNEOS_PAYMENTS_DEPLOYMENT is not on the list, so the
// lab worker always runs the offline (.invalid, lab database, mp-stub) configuration.
const PRODUCTION_PAYMENTS_PREFIX = "PRODUCTION_PAYMENTS__"
const PRODUCTION_PAYMENTS_ENV = [
  "TORNEOS_PAYMENT_PROVIDER", "MERCADO_PAGO_ENVIRONMENT", "MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN",
  "MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET", "MERCADO_PAGO_PRODUCTION_SELLER_ID", "APP_PUBLIC_URL",
  "TORNEOS_PAYMENTS_NOTIFICATION_URL", "TORNEOS_PAYMENTS_INTERNAL_SECRET", "TORNEOS_PAYMENTS_DB_URL",
  "TORNEOS_PAYMENTS_DB_SSL_CA", "TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN",
] as const

const ENV_BY_WORKER = new Map<string, readonly string[]>([
  ["torneos-gateway", GATEWAY_ENV],
  ["torneos-payments", PAYMENTS_ENV],
  ["torneos-payments-production", PRODUCTION_PAYMENTS_ENV],
])
/** The only function names the router mounts. */
export const WORKERS: ReadonlySet<string> = new Set(ENV_BY_WORKER.keys())

export function workerEnv(serviceName: string, env: Record<string, string | undefined>): [string, string][] {
  const names = ENV_BY_WORKER.get(serviceName)
  if (!names) throw new Error("unknown worker")
  if (serviceName === "torneos-payments-production") {
    return names.filter((name) => typeof env[`${PRODUCTION_PAYMENTS_PREFIX}${name}`] === "string")
      .map((name) => [name, env[`${PRODUCTION_PAYMENTS_PREFIX}${name}`] as string])
  }
  const mode = serviceName === "torneos-gateway" ? (env.TORNEOS_COMMERCE_MODE ?? "").trim() : ""
  const pick = (list: readonly string[]) => list.filter((name) => typeof env[name] === "string").map((name): [string, string] => [name, env[name] as string])
  if (mode !== "production") return pick(mode !== "" ? [...names, ...GATEWAY_COMMERCE_ENV] : names)
  const key = env[`${PRODUCTION_PAYMENTS_PREFIX}TORNEOS_PAYMENTS_INTERNAL_SECRET`]
  return [...pick([...names, "TORNEOS_PAYMENTS_INTERNAL_URL"]), ...(typeof key === "string" ? [["TORNEOS_PAYMENTS_INTERNAL_SECRET", key] as [string, string]] : []),
    ["TORNEOS_COMMERCE_DEPLOYMENT", "local-lab"]]
}
