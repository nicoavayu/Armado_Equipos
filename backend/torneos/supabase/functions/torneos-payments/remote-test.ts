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
//   • SANDBOX (2026-09-26 decision) Mercado Pago Checkout Pro sandbox answers `live_mode: true` for payments of the TEST
//           seller, test buyer and test card (measured on 180983139696 / 180983221818), so `live_mode` cannot be the
//           TEST/LIVE boundary here. remote-test replaces it — explicitly, never by rewriting the field — with the policy of
//           remoteTestSandboxProblem(): the attested TEST seller + the exact provider resources (payment, merchant order,
//           and our own Preference, all re-read from Mercado Pago) + the exact QA binding (pinned QA organization, purchase,
//           preference, metadata, ARS 39.900). `live_mode` must still be a boolean and is only reported. Outside remote-test
//           the certified guard (`live_mode === false`, provider binding) is unchanged.
//   • QA    TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID pins the one QA organization whose purchases this app may serve; absent,
//           remote-test serves no purchase at all (preference 422, webhook 422).
// No I/O except the attestation request and fetchRemoteTestPreference; no env reads outside the values handed in by config.ts.
import type { MercadoPagoChargeback, MercadoPagoMerchantOrder, MercadoPagoPayment } from "../_shared/mercadoPagoPaymentProvider.ts"
import type { PurchaseProjection } from "../_shared/paymentProvider.ts"
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

// ------------------------------------------------------------------ SANDBOX policy (live_mode is not the boundary)
export const QA_ORGANIZATION_ENV = "TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID"
/** The one product remote-test sells: torneos_premium, 1 × ARS 39.900 (the DB launch offer; the DB stays the authority). */
export const REMOTE_TEST_PRODUCT = Object.freeze({ code: "torneos_premium", amount: 39900, currency: "ARS", quantity: 1 })
/** Purchase states a verified provider event may address (a preference was recorded by this runtime). */
const PAYABLE_OR_SETTLED = new Set(["preference_created", "pending", "approved", "refunded", "charged_back"])
const DIGITS_RE = /^\d{1,32}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The provider's own view of the Preference this runtime created (GET /checkout/preferences/{id}). */
export type RemoteTestPreference = {
  id?: unknown
  collector_id?: unknown
  client_id?: unknown
  external_reference?: unknown
  metadata?: unknown
  items?: unknown
}
type WithApplication = { application_id?: unknown; client_id?: unknown }

export function isQaOrganizationId(value: string): boolean {
  return UUID_RE.test(value)
}

const idOf = (value: unknown) => (typeof value === "number" || typeof value === "string" ? String(value) : "")
const exactKeys = (value: unknown, keys: string[]) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",")

/** remote-test: why this purchase is outside the pinned QA scope / the TEST product, or null. */
export function remoteTestPurchaseProblem(purchase: PurchaseProjection, qaOrganizationId: string | null): string | null {
  if (qaOrganizationId === null) return "qa_scope_unset"
  if (purchase.organizationId !== qaOrganizationId || purchase.tournamentId !== null) return "qa_scope"
  if (purchase.productCode !== REMOTE_TEST_PRODUCT.code || purchase.amount !== REMOTE_TEST_PRODUCT.amount
    || purchase.currency !== REMOTE_TEST_PRODUCT.currency) return "product"
  if (purchase.externalReference !== `arma2:season:purchase:${purchase.id}`) return "reference"
  return null
}

/** remote-test chargebacks: the same exact shape as the certified binding (one payment, same id); live_mode only typed. */
export function remoteTestChargebackPaymentId(chargeback: MercadoPagoChargeback, chargebackId: string): string | null {
  const raw = Array.isArray(chargeback.payments) ? chargeback.payments : [chargeback.payments]
  const ids = raw.map((id) => idOf(id)).filter((id) => DIGITS_RE.test(id))
  if (idOf(chargeback.id) !== chargebackId || typeof chargeback.live_mode !== "boolean" || ids.length !== 1 || raw.length !== 1) return null
  return ids[0]
}

/**
 * The explicit remote-test acceptance policy of a re-fetched payment (live_mode true or false). Every field is compared
 * with the provider's own resources and with the DB purchase; the first mismatch is returned, null means accepted:
 *   seller     the attestation passed for exactly this seller; payment.collector_id = order.collector.id =
 *              preference.collector_id = that seller
 *   app        the application that created our Preference (preference.client_id); any application id the payment or the
 *              merchant order exposes must be exactly it
 *   binding    external_reference (payment, order, preference, purchase) = arma2:season:purchase:<purchase>, metadata
 *              exactly {purchase_id} on payment and preference, order.preference_id = preference.id = the recorded one,
 *              payment ∈ order.payments
 *   QA         purchase of the pinned QA organization, no tournament, a recorded preference, a payable/settled state
 *   amount     ARS 39.900: purchase, payment.transaction_amount / currency_id and the single Preference item
 *   live_mode  a boolean (reported, never trusted, never rewritten)
 */
export function remoteTestSandboxProblem({ payment, order, preference, purchase, attestedSellerId, sellerId, qaOrganizationId }: {
  payment: MercadoPagoPayment & WithApplication
  order: MercadoPagoMerchantOrder & WithApplication
  preference: RemoteTestPreference
  purchase: PurchaseProjection
  attestedSellerId: string | null
  sellerId: string
  qaOrganizationId: string | null
}): string | null {
  if (attestedSellerId === null || attestedSellerId !== sellerId) return "seller_not_attested"
  if (idOf(payment.collector_id) !== sellerId || idOf(order.collector?.id) !== sellerId || idOf(preference.collector_id) !== sellerId) return "collector"
  const application = idOf(preference.client_id)
  for (const exposed of [payment.application_id, payment.client_id, order.application_id]) {
    if (exposed === undefined || exposed === null || exposed === "") continue
    if (!DIGITS_RE.test(application) || idOf(exposed) !== application) return "application"
  }
  const scope = remoteTestPurchaseProblem(purchase, qaOrganizationId)
  if (scope) return scope
  if (!purchase.providerPreferenceId || !PAYABLE_OR_SETTLED.has(purchase.status)) return "purchase_state"
  const reference = purchase.externalReference
  if (payment.external_reference !== reference || order.external_reference !== reference || preference.external_reference !== reference) return "reference"
  if (!exactKeys(payment.metadata, ["purchase_id"]) || payment.metadata?.purchase_id !== purchase.id) return "metadata"
  if (!exactKeys(preference.metadata, ["purchase_id"]) || (preference.metadata as Record<string, unknown>).purchase_id !== purchase.id) return "metadata"
  if (idOf(preference.id) !== purchase.providerPreferenceId || order.preference_id !== purchase.providerPreferenceId) return "preference"
  const paymentId = idOf(payment.id)
  if (!DIGITS_RE.test(paymentId) || !(order.payments || []).some(({ id }) => idOf(id) === paymentId)) return "order"
  if (payment.currency_id !== REMOTE_TEST_PRODUCT.currency || payment.currency_id !== purchase.currency) return "currency"
  if (typeof payment.transaction_amount !== "number" || payment.transaction_amount !== purchase.amount) return "amount"
  const items = Array.isArray(preference.items) ? preference.items as Array<Record<string, unknown>> : []
  if (items.length !== 1 || items[0].id !== REMOTE_TEST_PRODUCT.code || items[0].quantity !== REMOTE_TEST_PRODUCT.quantity
    || items[0].currency_id !== REMOTE_TEST_PRODUCT.currency || items[0].unit_price !== purchase.amount) return "preference_item"
  if (typeof payment.live_mode !== "boolean") return "live_mode_shape"
  return null
}

/** GET /checkout/preferences/{id} with the TEST token, through the service's origin-locked fetcher. Throws like the provider. */
export async function fetchRemoteTestPreference(fetcher: typeof fetch, accessToken: string, preferenceId: string): Promise<RemoteTestPreference> {
  if (!/^\d{1,20}-[0-9a-f-]{36}$/.test(preferenceId)) throw new Error("mercado_pago_preference_id_invalid")
  const response = await fetcher(`${MERCADO_PAGO_API_ORIGIN}/checkout/preferences/${encodeURIComponent(preferenceId)}`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(ATTESTATION_TIMEOUT_MS),
  })
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`mercado_pago_api_${response.status}`) }
  const body = await response.json()
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("mercado_pago_preference_invalid")
  return body as RemoteTestPreference
}
