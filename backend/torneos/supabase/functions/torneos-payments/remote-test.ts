// torneos-payments/remote-test.ts — PAYMENTS TEST (2026-09-26): the hosted TEST deployment of the payments service.
//
// A payments service whose database is not an offline host (lab container, loopback, `.invalid` fixture) is a hosted
// deployment, and a hosted deployment exists in exactly one shape: TORNEOS_PAYMENTS_DEPLOYMENT=remote-test, a dedicated
// Deno Deploy app (torneos-payments-test) next to — never inside — the Production gateway, which stays commerce OFF.
// remote-test adds, on top of every MP-A3 / MP-B1.1 guard:
//   • DB    exactly the Arma2 Torneos data plane: Supavisor pooler of TORNEOS_REF in sa-east-1, `<login>.<TORNEOS_REF>`,
//           port 5432 | 6543, database postgres, no query, a CA for verify-full. Any other project / host → refused.
//   • env   no Core, Supabase, gateway, bridge, contract, REST or commerce-gateway variable at all (public ones too):
//           the TEST runtime holds Mercado Pago TEST + its own DB login + its own HMAC key, nothing else.
//   • Host  requests are served only on the host of TORNEOS_PAYMENTS_NOTIFICATION_URL (canonical public DNS name).
//   • LIVE  Checkout Pro has no TEST-prefixed credentials: its TEST credentials are the production-format credentials of
//           a Mercado Pago TEST seller account, so the token shape cannot tell TEST from LIVE. The provider itself is
//           asked (GET /users/me): the account must be exactly MERCADO_PAGO_TEST_SELLER_ID, carry the `test_user` tag and
//           be MLA. Until that attestation passes nothing reaches Mercado Pago or the database; a non-TEST answer disables
//           the service for the life of the isolate (a real seller token is never used for anything else).
// No I/O except the attestation request; no env reads outside the value handed in by config.ts.
import { canonicalRemoteHost } from "./remote-hosts.ts"

export const DEPLOYMENT_REMOTE_TEST = "remote-test"
/** The Arma2 Torneos data plane (sa-east-1). Pinned like the gateway topology (G1): never an argument. */
export const TORNEOS_REF = "onzpwnqxnvlgsevivngf"
const POOLER_HOST_RE = /^aws-\d{1,2}-sa-east-1\.pooler\.supabase\.com$/
const POOLER_PORTS = new Set(["5432", "6543"])
const OFFLINE_DB_HOSTS = new Set(["torneos-db", "localhost", "127.0.0.1", "[::1]"])
// Hosted remote-test refuses these families outright (non-blank), public or private: the TEST runtime never needs them.
export const REMOTE_TEST_FORBIDDEN_ENV_RE =
  /^(CORE_|SUPABASE_|TORNEOS_COMMERCE_|TORNEOS_GATEWAY_|TORNEOS_BRIDGE_|TORNEOS_CONTRACT_|TORNEOS_DB_|TORNEOS_REST_|TORNEOS_ANON_|TORNEOS_ALLOWED_|DATABASE_)/
export const ATTESTATION_TIMEOUT_MS = 5000
export const ATTESTATION_RETRY_MS = 10_000
/** The provider's fixed API origin (the byte-pinned _shared provider uses the same one). */
export const MERCADO_PAGO_API_ORIGIN = "https://api.mercadopago.com"
export const TEST_SELLER_SITE = "MLA"

/** A database host that cannot be a hosted database (lab container, loopback, `.invalid` fixture). */
export function isOfflineDbHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return OFFLINE_DB_HOSTS.has(host) || host.endsWith(".invalid")
}

/** Why this DB URL is not the Arma2 Torneos pooler login of remote-test, or null. */
export function remoteTestDbProblem(url: URL): string | null {
  if (!POOLER_HOST_RE.test(url.hostname)) return "host"
  if (!POOLER_PORTS.has(url.port)) return "port"
  if (url.pathname !== "/postgres" || url.search || url.hash) return "database"
  const user = decodeURIComponent(url.username)
  const dot = user.indexOf(".")
  if (dot <= 0 || user.slice(dot + 1) !== TORNEOS_REF) return "project"
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(user.slice(0, dot))) return "login"
  return null
}

/** The declared public host of the TEST app: the canonical host of the notification URL, or null. */
export function remoteTestHost(notificationUrl: URL): string | null {
  if (notificationUrl.port || notificationUrl.username || notificationUrl.password) return null
  return canonicalRemoteHost(notificationUrl.hostname)
}

export type AttestationVerdict = "ok" | "not_test" | "unavailable"

/**
 * Asks Mercado Pago who the access token belongs to. `ok` only for exactly the configured seller, tagged `test_user`,
 * site MLA. 401/403 and any other account are `not_test` (permanent); transport faults, 5xx and 429 are `unavailable`.
 * Nothing from the answer leaves this function (it carries payer-grade account data).
 */
export async function attestTestSeller(fetcher: typeof fetch, apiOrigin: string, accessToken: string, sellerId: string): Promise<AttestationVerdict> {
  let response: Response
  try {
    response = await fetcher(`${apiOrigin}/users/me`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(ATTESTATION_TIMEOUT_MS),
    })
  } catch {
    return "unavailable"
  }
  if (response.status === 401 || response.status === 403) { await response.body?.cancel().catch(() => {}); return "not_test" }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); return "unavailable" }
  let body: unknown
  try { body = await response.json() } catch { return "unavailable" }
  if (typeof body !== "object" || body === null) return "not_test"
  const account = body as { id?: unknown; tags?: unknown; site_id?: unknown }
  const tags = Array.isArray(account.tags) ? account.tags.map((t) => String(t)) : []
  return String(account.id ?? "") === sellerId && tags.includes("test_user") && account.site_id === TEST_SELLER_SITE ? "ok" : "not_test"
}
