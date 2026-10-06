// Per-worker environment of the lab router (MP-A3 hardening). The edge-runtime container carries the
// configuration of every function it hosts; each worker receives only the variables on its own list:
// the gateway never sees Mercado Pago / payments secrets, torneos-payments never sees Core, bridge or
// gateway DB credentials, and no worker receives the container's own variables (PATH, HOME, …).
// Hosted Supabase shares Edge Function secrets across the whole project: this isolation exists only in the
// lab and remains a Production blocker for the real deployment.
// MP-A4: the gateway reads TORNEOS_COMMERCE_MODE; only when it is set does it also receive the link to
// torneos-payments (internal URL + the shared HMAC key) — never a Mercado Pago value or the payments DB login.
const GATEWAY_ENV = [
  "TORNEOS_GATEWAY_PUBLIC_URL", "TORNEOS_ALLOWED_ORIGIN", "CORE_AUTH_URL", "CORE_JWT_ISSUER", "CORE_ANON_KEY",
  "CORE_CONTRACT_URL", "TORNEOS_CONTRACT_SERVICE_SECRET", "TORNEOS_REST_URL", "TORNEOS_ANON_KEY",
  "TORNEOS_DB_IDENTITY_WRITER_URL", "TORNEOS_DB_CORE_ADAPTER_URL", "TORNEOS_DB_SSL_CA", "TORNEOS_BRIDGE_KEYS",
  "TORNEOS_COMMERCE_MODE",
  // CONNECTED-V1: the opt-in mode only (no secret); absent in the container → absent in the worker.
  "TORNEOS_CONNECTED_MODE",
] as const
const GATEWAY_COMMERCE_ENV = ["TORNEOS_PAYMENTS_INTERNAL_URL", "TORNEOS_PAYMENTS_INTERNAL_SECRET"] as const
const PAYMENTS_ENV = [
  "TORNEOS_PAYMENT_PROVIDER", "MERCADO_PAGO_ENVIRONMENT", "MERCADO_PAGO_TEST_ACCESS_TOKEN", "MERCADO_PAGO_TEST_WEBHOOK_SECRET",
  "MERCADO_PAGO_TEST_SELLER_ID", "APP_PUBLIC_URL", "TORNEOS_PAYMENTS_NOTIFICATION_URL", "TORNEOS_PAYMENTS_INTERNAL_SECRET",
  "TORNEOS_PAYMENTS_DB_URL", "TORNEOS_PAYMENTS_DB_SSL_CA", "TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN",
] as const

const ENV_BY_WORKER = new Map<string, readonly string[]>([
  ["torneos-gateway", GATEWAY_ENV],
  ["torneos-payments", PAYMENTS_ENV],
])
/** The only function names the router mounts. */
export const WORKERS: ReadonlySet<string> = new Set(ENV_BY_WORKER.keys())

export function workerEnv(serviceName: string, env: Record<string, string | undefined>): [string, string][] {
  const names = ENV_BY_WORKER.get(serviceName)
  if (!names) throw new Error("unknown worker")
  const commerce = serviceName === "torneos-gateway" && (env.TORNEOS_COMMERCE_MODE ?? "").trim() !== ""
  return (commerce ? [...names, ...GATEWAY_COMMERCE_ENV] : names).filter((name) => typeof env[name] === "string").map((name) => [name, env[name] as string])
}
