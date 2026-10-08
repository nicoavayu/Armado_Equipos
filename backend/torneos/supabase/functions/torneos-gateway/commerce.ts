// torneos-gateway/commerce.ts — MP-A4 gateway commerce (Mercado Pago Checkout Pro TEST); MP-B1.1 R2 remote TEST.
//
// ONE implementation, run by both gateways: the Edge Function (index.ts) imports it statically, the Node lab
// gateway (integration/torneos-core-contracts/gateway.mjs) imports it only when its commerce configuration
// names a mode. Each gateway lends its own certified primitives (bridge verification, Core session check,
// identity lookup, dependency classification) through hooks; the order they run in lives here, once.
//
//   TORNEOS_COMMERCE_MODE   unset / blank → commerce OFF: this module adds nothing (no route, no allowlist, no
//                           other variable read). "test" → commerce TEST. Anything else → configuration error:
//                           the whole gateway fails closed. There is no live / production mode.
//   TEST adds exactly:
//     • POST /commerce/v1/season-checkout — the only way to call create_tournament_season_checkout_purchase:
//         1 method/path  2 bridge bearer  3 Core session (online)  4 Torneos identity  5 body
//         6 DB wrapper with the USER bearer (the DB decides billing.manage, price, provider, idempotency)
//         7 only for an open purchase: HMAC-signed internal call to torneos-payments (the MP-A3 signer)
//         8 whitelisted answer {purchase, preference}
//       Core down → no DB, no payments. DB refusal → no payments. No automatic retry: the client repeats with
//       the same idempotencyKey.
//     • the commerce TEST read allowlist (commerce-test-rpc-allowlist.json): 2 reads on top of the 43.
//   TORNEOS_COMMERCE_DEPLOYMENT (read only in TEST) — where TEST runs:
//     unset / blank / "local-lab" → the certified MP-A4 lab, unchanged: the internal payments URL must be the lab
//       edge-runtime mount and the gateway itself must be published on loopback; no remote host may be declared.
//     "remote-test" → a hosted TEST deployment, prepared but not provisioned. It additionally requires, explicitly:
//       TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST   the one public hostname of this gateway (its public URL must be
//                                              https://<it>/functions/v1/torneos-gateway, default port, no userinfo);
//       TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST  the one hostname of torneos-payments; the internal URL must be exactly
//                                              https://<it>/functions/v1/torneos-payments (compared byte for byte);
//       and every Core / Torneos / browser endpoint the gateway uses (context.dependencyUrls) must be https.
//       No host, URL or endpoint may be Production (remote-hosts.ts: Production ref, Production web hostnames,
//       live / prod / production labels). Hosts are exact names: no wildcard, no suffix match, no IP, no port.
//     anything else → configuration error. There is no live / production deployment.
//   The gateway holds TORNEOS_PAYMENTS_INTERNAL_SECRET and nothing of Mercado Pago or the payments DB, in both
//   deployments (a secret scope shared with torneos-payments makes the gateway refuse to boot).
//
// COMMERCE-PRODUCTION: "production" → Mercado Pago Checkout Pro PRODUCTION, a separate mode with its own pieces, never a
// relaxed TEST. It adds, on top of the same 1–5 checks:
//     • POST /commerce/v1/season-checkout → create_tournament_season_production_checkout_purchase (the DB fixes
//       MERCADO_PAGO/production and checks the operator switch) → torneos-payments-production (HMAC) → Preference;
//     • POST /commerce/v1/purchase-refresh → get_tournament_purchase with the USER bearer (the DB decides who may see the
//       purchase) → torneos-payments-production reconcile (HMAC; asks Mercado Pago, throttled per purchase) → the same
//       read again → {purchase, refresh}. The return URL never grants anything: this route only re-reads the provider;
//     • the production read allowlist (commerce-production-rpc-allowlist.json): 3 reads.
//   TORNEOS_COMMERCE_DEPLOYMENT (read only in production): "production" (default) → hosted: the declared payments host
//   TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST (canonical, no test / sandbox / lab label), the internal URL exactly
//   https://<it>/functions/v1/torneos-payments-production, this gateway and every dependency https;
//   "local-lab" → the lab (loopback gateway, lab payments host). The TEST-only names refuse the boot here.
import { signInternal } from "../torneos-payments/hmac.ts"
import { canonicalRemoteHost, productionHostProblem } from "../torneos-payments/remote-hosts.ts"
import commerceAllowlistDoc from "./commerce-test-rpc-allowlist.json" with { type: "json" }
import commerceProductionAllowlistDoc from "./commerce-production-rpc-allowlist.json" with { type: "json" }

export const COMMERCE_ROUTE = "/commerce/v1/season-checkout"
export const CHECKOUT_RPC = "create_tournament_season_checkout_purchase"
export const PAYMENTS_INTERNAL_PATH = "/internal/v1/season-checkout-preference"
export const COMMERCE_TIMEOUTS = Object.freeze({ restMs: 4000, paymentsMs: 8000 })
export const MAX_CHECKOUT_BODY = 1024
export const EXPECTED_COMMERCE_RPCS: readonly string[] = Object.freeze(["get_effective_tournament_season_entitlements", "get_tournament_purchase", "get_tournament_season_purchases"])
export const GATEWAY_COMMERCE_ENV: readonly string[] = Object.freeze(["TORNEOS_COMMERCE_MODE", "TORNEOS_COMMERCE_DEPLOYMENT", "TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST",
  "TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST", "TORNEOS_PAYMENTS_INTERNAL_URL", "TORNEOS_PAYMENTS_INTERNAL_SECRET"])
export const COMMERCE_DEPLOYMENTS: readonly string[] = Object.freeze(["local-lab", "remote-test"])
// COMMERCE-PRODUCTION
export const REFRESH_ROUTE = "/commerce/v1/purchase-refresh"
export const PRODUCTION_CHECKOUT_RPC = "create_tournament_season_production_checkout_purchase"
export const PAYMENTS_RECONCILE_PATH = "/internal/v1/purchase-reconcile"
export const EXPECTED_PRODUCTION_COMMERCE_RPCS: readonly string[] = Object.freeze(["get_effective_tournament_season_entitlements", "get_tournament_purchase", "get_tournament_season_purchases"])
export const GATEWAY_COMMERCE_PRODUCTION_ENV: readonly string[] = Object.freeze(["TORNEOS_COMMERCE_MODE", "TORNEOS_COMMERCE_DEPLOYMENT",
  "TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST", "TORNEOS_PAYMENTS_INTERNAL_URL", "TORNEOS_PAYMENTS_INTERNAL_SECRET"])
export const PRODUCTION_COMMERCE_DEPLOYMENTS: readonly string[] = Object.freeze(["local-lab", "production"])
const PRODUCTION_PAYMENTS_MOUNT = "/functions/v1/torneos-payments-production"
const LAB_PRODUCTION_PAYMENTS_MOUNTS = new Set(["/torneos-payments-production", "/functions/v1/torneos-payments-production"])
const NON_PRODUCTION_LABEL_RE = /(?:^|-)(?:test|testing|sandbox|qa|lab|staging|stage|preview|dev|local)(?:-|$)/

const PRODUCTION_REF = "rcyuuoaqfwcembdajcss"
const LAB_GATEWAY_HOSTS = new Set(["127.0.0.1", "localhost"])
const LAB_PAYMENTS_HOSTS = new Set(["torneos-functions", "127.0.0.1", "localhost"])
const PAYMENTS_MOUNTS = new Set(["/torneos-payments", "/functions/v1/torneos-payments"])
const REMOTE_GATEWAY_PATHS = new Set(["/functions/v1/torneos-gateway", "/functions/v1/torneos-gateway/"])
const REMOTE_PAYMENTS_MOUNT = "/functions/v1/torneos-payments"
// Payments-side material the gateway must never hold (refused at boot in TEST).
const FORBIDDEN_GATEWAY_ENV = [/^MERCADO_PAGO_/, /^TORNEOS_PAYMENT_PROVIDER$/, /^TORNEOS_PAYMENTS_DB_/, /^TORNEOS_PAYMENTS_NOTIFICATION_URL$/, /^TORNEOS_PAYMENTS_LAB_/]
const WRITE_RPC_RE = /^(create|update|delete|insert|upsert|set|record|apply|activate|cancel|grant|revoke|submit|approve|reject|register|remove|add|publish|archive|restore|invite|accept|assign|change|save|withdraw|review|import|mark|close|open|start|finish|confirm|reset|refresh|sync|process|transition|move|upload|attach|detach|link|unlink|enable|disable)_/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPEN_STATUSES = new Set(["created", "preference_created"])
const PURCHASE_FIELDS = ["schemaVersion", "id", "organizationId", "seasonId", "tournamentId", "productCode", "offerCode", "offerVersion", "listAmount", "amount",
  "currency", "provider", "providerEnvironment", "providerPreferenceId", "externalReference", "status", "providerStatus", "providerStatusDetail",
  "preferenceExpiresAt", "approvedAt", "entitlementActivatedAt", "activationErrorCode", "createdAt", "updatedAt", "idempotentReplay", "existingOpenPurchase"]
// DB refusals by message token (PostgREST answers 55000 with 500, 22023 with 400: the token decides, not the status).
const DB_REFUSALS: Record<string, [number, string]> = {
  TORNEOS_BILLING_FORBIDDEN: [403, "TORNEOS_BILLING_FORBIDDEN"],
  TORNEOS_PURCHASE_FORBIDDEN: [403, "TORNEOS_PURCHASE_FORBIDDEN"],
  TORNEOS_SEASON_ALREADY_PREMIUM: [409, "TORNEOS_SEASON_ALREADY_PREMIUM"],
  TORNEOS_SEASON_PREMIUM_SUSPENDED: [409, "TORNEOS_SEASON_PREMIUM_SUSPENDED"],
  TORNEOS_IDEMPOTENCY_CONFLICT: [409, "TORNEOS_IDEMPOTENCY_CONFLICT"],
  TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT: [409, "TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT"],
  TORNEOS_PRODUCT_UNAVAILABLE: [409, "TORNEOS_PRODUCT_UNAVAILABLE"],
  TORNEOS_OFFER_UNAVAILABLE: [409, "TORNEOS_OFFER_UNAVAILABLE"],
  TORNEOS_PURCHASE_INVALID: [400, "TORNEOS_CHECKOUT_INVALID"],
  TORNEOS_AUTH_REQUIRED: [401, "access denied"],
  TORNEOS_BILLING_DISABLED: [409, "TORNEOS_BILLING_DISABLED"],
}
// torneos-payments internal answers (MP-A3 contract) → gateway answer. Anything unlisted is a contract fault (502).
const PAYMENTS_REFUSALS: Record<string, [number, string]> = {
  preference_expired: [409, "TORNEOS_CHECKOUT_EXPIRED"],
  purchase_not_payable: [409, "TORNEOS_PURCHASE_NOT_PAYABLE"],
  preference_conflict: [409, "TORNEOS_PREFERENCE_CONFLICT"],
}

export class CommerceConfigError extends Error {}

export type CommerceOff = { mode: "off" }
export type CommerceDeployment = "local-lab" | "remote-test"
export type CommerceTest = { mode: "test"; deployment: CommerceDeployment; paymentsUrl: string; secret: Uint8Array; readRpcs: ReadonlySet<string> }
export type CommerceProductionDeployment = "local-lab" | "production"
export type CommerceProduction = { mode: "production"; deployment: CommerceProductionDeployment; paymentsUrl: string; secret: Uint8Array; readRpcs: ReadonlySet<string> }
export type CommerceEnabled = CommerceTest | CommerceProduction
export type CommerceConfig = CommerceOff | CommerceTest | CommerceProduction
export type CommerceContext = {
  baseAllowlist: ReadonlySet<string>        // the 43 staging v1 RPCs the gateway already loaded
  gatewayPublicUrl: string | URL            // where this gateway is published (lab = loopback)
  distinctFrom: (string | null | undefined)[] // Core contract secret, bridge key material, public keys
  dependencyUrls?: (string | URL | null | undefined)[] // Core Auth, issuer, contract, Torneos REST, browser origin (remote-test)
}
type Env = Record<string, string | undefined>

// ============================================================================ configuration
export function validateCommerceAllowlist(doc: unknown, base: ReadonlySet<string>, mode: "test" | "production" = "test",
  expected: readonly string[] = mode === "test" ? EXPECTED_COMMERCE_RPCS : EXPECTED_PRODUCTION_COMMERCE_RPCS): ReadonlySet<string> {
  const d = doc as { mode?: unknown; rpcs?: unknown }
  if (!d || typeof d !== "object" || d.mode !== mode || !Array.isArray(d.rpcs)) throw new CommerceConfigError("commerce allowlist shape")
  const names = d.rpcs as unknown[]
  if (!names.every((n) => typeof n === "string" && /^[a-z0-9_]+$/.test(n))) throw new CommerceConfigError("commerce allowlist names")
  const set = new Set(names as string[])
  if (set.size !== names.length) throw new CommerceConfigError("commerce allowlist repeats a name")
  for (const name of set) {
    if (name === CHECKOUT_RPC || name === PRODUCTION_CHECKOUT_RPC || WRITE_RPC_RE.test(name)) throw new CommerceConfigError("commerce allowlist contains a write")
    if (base.has(name)) throw new CommerceConfigError("commerce allowlist repeats a staging v1 RPC")
    if (!expected.includes(name)) throw new CommerceConfigError("commerce allowlist has an extra name")
  }
  if (!expected.every((name) => set.has(name))) throw new CommerceConfigError("commerce allowlist misses a read")
  return set
}

function paymentsUrlOf(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL is not a URL") }
  if (url.href.includes(PRODUCTION_REF)) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL names Production")
  if (url.protocol !== "http:" || !LAB_PAYMENTS_HOSTS.has(url.hostname)) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL must be the lab payments host")
  if (url.username || url.password || url.search || url.hash || raw.includes("?") || raw.includes("#")) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL carries credentials, query or fragment")
  const mount = url.pathname.replace(/\/$/, "")
  if (!PAYMENTS_MOUNTS.has(mount)) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL must be the torneos-payments mount")
  return `${url.origin}${mount}`
}

function secretOf(hex: string, distinctFrom: CommerceContext["distinctFrom"]): Uint8Array {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 64) {
    throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_SECRET must be lowercase hex of at least 32 bytes")
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  if (new Set(bytes).size < 16) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_SECRET is low-entropy")
  for (const other of distinctFrom) {
    const value = (other ?? "").trim().toLowerCase()
    if (value && (value === hex || value.includes(hex) || (value.length >= 32 && hex.includes(value)))) {
      throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_SECRET must be distinct from the Core contract and bridge secrets")
    }
  }
  return bytes
}

// ---------------------------------------------------------------------------- remote-test (MP-B1.1 R2)
function declaredHost(env: Env, name: string): string {
  const value = (env[name] ?? "").trim()
  if (!value) throw new CommerceConfigError(`remote TEST requires ${name}`)
  const host = canonicalRemoteHost(value)
  if (!host) throw new CommerceConfigError(`${name} must be one exact lowercase public DNS hostname`)
  const production = productionHostProblem(host)
  if (production) throw new CommerceConfigError(`${name} ${production}`)
  return host
}

/** A parsed https URL on the default port without userinfo, query or fragment, not naming Production. */
function remoteUrl(label: string, raw: string | URL): URL {
  let url: URL
  try { url = new URL(String(raw)) } catch { throw new CommerceConfigError(`${label} is not a URL`) }
  const production = productionHostProblem(url.hostname)
  if (production || String(raw).includes(PRODUCTION_REF)) throw new CommerceConfigError(`${label} ${production ?? "names the Production project"}`)
  if (url.protocol !== "https:") throw new CommerceConfigError(`${label} must be https for remote TEST`)
  if (url.username || url.password) throw new CommerceConfigError(`${label} carries userinfo`)
  if (url.port) throw new CommerceConfigError(`${label} names a port`)
  if (url.search || url.hash) throw new CommerceConfigError(`${label} carries a query or fragment`)
  if (LAB_GATEWAY_HOSTS.has(url.hostname) || LAB_PAYMENTS_HOSTS.has(url.hostname) || !canonicalRemoteHost(url.hostname)) {
    throw new CommerceConfigError(`${label} is not a public hostname`)
  }
  return url
}

function remoteTestLinks(env: Env, ctx: CommerceContext, paymentsRaw: string): string {
  const gatewayHost = declaredHost(env, "TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST")
  const paymentsHost = declaredHost(env, "TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST")
  // This gateway (already parsed by its own config on Edge, a string on Node: judged on the parsed form, identically):
  // exactly the declared host, the platform mount.
  const gateway = remoteUrl("gateway public URL", ctx.gatewayPublicUrl)
  if (gateway.hostname !== gatewayHost) throw new CommerceConfigError("gateway public URL is not the declared remote TEST gateway host")
  if (!REMOTE_GATEWAY_PATHS.has(gateway.pathname)) throw new CommerceConfigError("gateway public URL is not the torneos-gateway mount")
  // torneos-payments: compared byte for byte with the only accepted form (no normalisation can smuggle a host).
  const canonical = `https://${paymentsHost}${REMOTE_PAYMENTS_MOUNT}`
  if (paymentsRaw !== canonical && paymentsRaw !== `${canonical}/`) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL is not the declared remote TEST payments URL")
  const payments = remoteUrl("TORNEOS_PAYMENTS_INTERNAL_URL", paymentsRaw)
  if (payments.hostname !== paymentsHost) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL is not the declared remote TEST payments host")
  // Everything else this gateway talks to (or accepts browsers from) must be https and not Production.
  const dependencies = ctx.dependencyUrls ?? []
  if (dependencies.length === 0) throw new CommerceConfigError("remote TEST requires the gateway dependency URLs")
  for (const dependency of dependencies) {
    if (dependency === null || dependency === undefined || String(dependency).trim() === "") throw new CommerceConfigError("remote TEST dependency URL missing")
    remoteUrl("gateway dependency URL", dependency)
  }
  return canonical
}

// ---------------------------------------------------------------------------- production (COMMERCE-PRODUCTION)
function productionLinks(env: Env, ctx: CommerceContext, paymentsRaw: string): string {
  const hostValue = (env.TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST ?? "").trim()
  if (!hostValue) throw new CommerceConfigError("production requires TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST")
  const paymentsHost = canonicalRemoteHost(hostValue)
  if (!paymentsHost) throw new CommerceConfigError("TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST must be one exact lowercase public DNS hostname")
  if (paymentsHost.split(".").some((label) => NON_PRODUCTION_LABEL_RE.test(label))) {
    throw new CommerceConfigError("TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST carries a test / sandbox / lab label")
  }
  if (paymentsHost.includes(PRODUCTION_REF)) throw new CommerceConfigError("TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST names the Core project")
  const canonical = `https://${paymentsHost}${PRODUCTION_PAYMENTS_MOUNT}`
  if (paymentsRaw !== canonical && paymentsRaw !== `${canonical}/`) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL is not the declared production payments URL")
  // This gateway and everything it talks to (or accepts browsers from): https, public, never loopback or Core.
  const targets: Array<[string, string | URL | null | undefined]> = [["gateway public URL", ctx.gatewayPublicUrl]]
  for (const dependency of ctx.dependencyUrls ?? []) targets.push(["gateway dependency URL", dependency])
  for (const [label, raw] of targets) {
    if (raw === null || raw === undefined || String(raw).trim() === "") throw new CommerceConfigError(`production ${label} missing`)
    let url: URL
    try { url = new URL(String(raw)) } catch { throw new CommerceConfigError(`${label} is not a URL`) }
    if (url.protocol !== "https:" || url.username || url.password) throw new CommerceConfigError(`${label} must be https for production commerce`)
    if (LAB_GATEWAY_HOSTS.has(url.hostname) || LAB_PAYMENTS_HOSTS.has(url.hostname) || url.hostname === "[::1]") {
      throw new CommerceConfigError(`${label} is not a public hostname`)
    }
  }
  if (!ctx.dependencyUrls?.length) throw new CommerceConfigError("production requires the gateway dependency URLs")
  return canonical
}

function labProductionPaymentsUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL is not a URL") }
  if (url.href.includes(PRODUCTION_REF)) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL names Production")
  if (url.protocol !== "http:" || !LAB_PAYMENTS_HOSTS.has(url.hostname)) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL must be the lab payments host")
  if (url.username || url.password || url.search || url.hash || raw.includes("?") || raw.includes("#")) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL carries credentials, query or fragment")
  const mount = url.pathname.replace(/\/$/, "")
  if (!LAB_PRODUCTION_PAYMENTS_MOUNTS.has(mount)) throw new CommerceConfigError("TORNEOS_PAYMENTS_INTERNAL_URL must be the torneos-payments-production mount")
  return `${url.origin}${mount}`
}

function loadProductionCommerce(env: Env, ctx: CommerceContext, allowlistDoc: unknown): CommerceProduction {
  for (const [name, value] of Object.entries(env)) {
    if ((value ?? "").trim() && FORBIDDEN_GATEWAY_ENV.some((re) => re.test(name))) throw new CommerceConfigError(`refusing ${name} in the gateway`)
  }
  for (const name of ["TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST", "TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST"]) {
    if ((env[name] ?? "").trim()) throw new CommerceConfigError(`${name} is for remote TEST only`)
  }
  const deployment = (env.TORNEOS_COMMERCE_DEPLOYMENT ?? "").trim() || "production"
  if (!PRODUCTION_COMMERCE_DEPLOYMENTS.includes(deployment)) throw new CommerceConfigError("production commerce runs only hosted or in the local lab")
  const url = (env.TORNEOS_PAYMENTS_INTERNAL_URL ?? "").trim()
  const secret = (env.TORNEOS_PAYMENTS_INTERNAL_SECRET ?? "").trim()
  if (!url) throw new CommerceConfigError("missing TORNEOS_PAYMENTS_INTERNAL_URL")
  if (!secret) throw new CommerceConfigError("missing TORNEOS_PAYMENTS_INTERNAL_SECRET")
  let paymentsUrl: string
  if (deployment === "local-lab") {
    if ((env.TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST ?? "").trim()) throw new CommerceConfigError("TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST is for hosted production only")
    let gateway: URL
    try { gateway = new URL(String(ctx.gatewayPublicUrl)) } catch { throw new CommerceConfigError("gateway public URL") }
    if (!LAB_GATEWAY_HOSTS.has(gateway.hostname)) throw new CommerceConfigError("local-lab production commerce is loopback-only")
    paymentsUrl = labProductionPaymentsUrl(url)
  } else {
    paymentsUrl = productionLinks(env, ctx, url)
  }
  return {
    mode: "production",
    deployment: deployment as CommerceProductionDeployment,
    paymentsUrl,
    secret: secretOf(secret, ctx.distinctFrom),
    readRpcs: validateCommerceAllowlist(allowlistDoc, ctx.baseAllowlist, "production"),
  }
}

/** Fail-closed commerce configuration. OFF reads nothing but the mode; any fault throws CommerceConfigError. */
export function loadCommerceConfig(env: Env, ctx: CommerceContext, allowlistDoc: unknown = commerceAllowlistDoc,
  productionAllowlistDoc: unknown = commerceProductionAllowlistDoc): CommerceConfig {
  const mode = (env.TORNEOS_COMMERCE_MODE ?? "").trim()
  if (!mode) return { mode: "off" }
  if (mode === "production") return loadProductionCommerce(env, ctx, productionAllowlistDoc)
  if (mode !== "test") throw new CommerceConfigError("TORNEOS_COMMERCE_MODE accepts only test or production")
  if ((env.TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST ?? "").trim()) throw new CommerceConfigError("TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST is for production only")
  for (const [name, value] of Object.entries(env)) {
    if ((value ?? "").trim() && FORBIDDEN_GATEWAY_ENV.some((re) => re.test(name))) throw new CommerceConfigError(`refusing ${name} in the gateway`)
  }
  const deployment = (env.TORNEOS_COMMERCE_DEPLOYMENT ?? "").trim() || "local-lab"
  if (!COMMERCE_DEPLOYMENTS.includes(deployment)) throw new CommerceConfigError("TORNEOS_COMMERCE_DEPLOYMENT accepts only the lab or remote TEST deployment")
  const url = (env.TORNEOS_PAYMENTS_INTERNAL_URL ?? "").trim()
  const secret = (env.TORNEOS_PAYMENTS_INTERNAL_SECRET ?? "").trim()
  let paymentsUrl: string
  if (deployment === "local-lab") {
    for (const name of ["TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST", "TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST"]) {
      if ((env[name] ?? "").trim()) throw new CommerceConfigError(`${name} is for remote TEST only`)
    }
    let gateway: URL
    try { gateway = new URL(String(ctx.gatewayPublicUrl)) } catch { throw new CommerceConfigError("gateway public URL") }
    if (!LAB_GATEWAY_HOSTS.has(gateway.hostname)) throw new CommerceConfigError("commerce test is lab-only")
    if (!url) throw new CommerceConfigError("missing TORNEOS_PAYMENTS_INTERNAL_URL")
    if (!secret) throw new CommerceConfigError("missing TORNEOS_PAYMENTS_INTERNAL_SECRET")
    paymentsUrl = paymentsUrlOf(url)
  } else {
    if (!url) throw new CommerceConfigError("missing TORNEOS_PAYMENTS_INTERNAL_URL")
    if (!secret) throw new CommerceConfigError("missing TORNEOS_PAYMENTS_INTERNAL_SECRET")
    paymentsUrl = remoteTestLinks(env, ctx, url)
  }
  return {
    mode: "test",
    deployment: deployment as CommerceDeployment,
    paymentsUrl,
    secret: secretOf(secret, ctx.distinctFrom),
    readRpcs: validateCommerceAllowlist(allowlistDoc, ctx.baseAllowlist),
  }
}

/** Generic proxy allowlist: the 43 when OFF (the same set), 43 + the commerce reads in TEST or production. */
export function effectiveRpcAllowlist(base: ReadonlySet<string>, commerce: CommerceConfig): ReadonlySet<string> {
  if (commerce.mode === "off") return base
  return new Set([...base, ...commerce.readRpcs])
}

// ============================================================================ the checkout route
export type BridgeClaims = { sub: string; core_user_id: string; session_id: string }
export type CheckoutRequest = {
  authorization: string | null
  search: string
  contentLength: string | null
  body: AsyncIterable<Uint8Array> | null
}
export type CheckoutHooks = {
  verifyBridge(token: string): Promise<BridgeClaims>
  activeSession(claims: BridgeClaims): Promise<void>
  identityExists(claims: BridgeClaims): Promise<boolean>
  isUnavailable(error: unknown): boolean
  restUrl: string
  restApiKey: string | null
  fetch?: typeof fetch
  now?: () => number
  log?: (entry: CheckoutLog) => void
  timeouts?: { restMs: number; paymentsMs: number }
}
export type CheckoutLog = { fn: string; route: string; rid: string; purchaseId: string | null; status: number; code: string; ms: number }
export type CheckoutResult = { status: number; body: Record<string, unknown> }

const answer = (status: number, error: string): CheckoutResult => ({ status, body: { error } })
const DENIED = () => answer(401, "access denied")
const INVALID = () => answer(400, "TORNEOS_CHECKOUT_INVALID")
const FAILED = () => answer(502, "TORNEOS_CHECKOUT_FAILED")

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** At most `limit` bytes; null when larger (declared or streamed). Oversized streams are drained up to 64 KiB. */
async function readLimited(source: AsyncIterable<Uint8Array> | null, declared: string | null, limit: number): Promise<Uint8Array | null> {
  if (declared !== null && (!/^[0-9]{1,9}$/.test(declared) || Number(declared) > limit)) return null
  if (!source) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of source) {
    size += chunk.byteLength
    if (size > 64 * 1024) break
    if (size <= limit) chunks.push(chunk)
  }
  if (size > limit) return null
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

type CheckoutInput = { organizationId: string; seasonId: string; idempotencyKey: string }
function parseInput(raw: Uint8Array): CheckoutInput | null {
  let value: unknown
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return null }
  if (!isPlainObject(value)) return null
  const keys = Object.keys(value).sort()
  if (keys.length !== 3 || keys.join(",") !== "idempotencyKey,organizationId,seasonId") return null
  const { organizationId, seasonId, idempotencyKey } = value
  if (![organizationId, seasonId, idempotencyKey].every((v) => typeof v === "string" && UUID_RE.test(v))) return null
  return { organizationId: (organizationId as string).toLowerCase(), seasonId: (seasonId as string).toLowerCase(), idempotencyKey: (idempotencyKey as string).toLowerCase() }
}

async function readText(response: Response, limit = 64 * 1024): Promise<string | null> {
  const text = await response.text()
  return text.length > limit ? null : text
}
function parseJson(text: string | null): unknown {
  if (text === null) return null
  try { return JSON.parse(text) } catch { return null }
}

type Step = { result: CheckoutResult } | { purchase: Record<string, unknown> }

/** Step 6: the DB wrapper with the user's own bearer. Business refusals keep their code; only transients are 503. */
async function createPurchase(token: string, input: CheckoutInput, hooks: CheckoutHooks, doFetch: typeof fetch, restMs: number,
  environment: "test" | "production" = "test"): Promise<Step> {
  let response: Response
  let text: string | null
  try {
    response = await doFetch(`${hooks.restUrl}/rpc/${environment === "production" ? PRODUCTION_CHECKOUT_RPC : CHECKOUT_RPC}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json",
        ...(hooks.restApiKey ? { apikey: hooks.restApiKey } : {}) },
      body: JSON.stringify({ p_organization_id: input.organizationId, p_season_id: input.seasonId, p_idempotency_key: input.idempotencyKey }),
      redirect: "error", signal: AbortSignal.timeout(restMs),
    })
    text = await readText(response)
  } catch {
    return { result: answer(503, "TORNEOS_UNAVAILABLE") }
  }
  const body = parseJson(text)
  if (response.status === 200) {
    if (!isPlainObject(body) || typeof body.id !== "string" || !UUID_RE.test(body.id) || typeof body.status !== "string"
      || body.provider !== "MERCADO_PAGO" || body.providerEnvironment !== environment) return { result: FAILED() }
    return { purchase: body }
  }
  const refusal = isPlainObject(body) && typeof body.message === "string" ? body.message : null
  if (refusal && Object.hasOwn(DB_REFUSALS, refusal)) { const [status, code] = DB_REFUSALS[refusal]; return { result: answer(status, code) } }
  if (response.status === 401) return { result: DENIED() }
  if (response.status >= 500) return { result: answer(503, "TORNEOS_UNAVAILABLE") }
  return { result: FAILED() }
}

/** Step 7: HMAC-signed internal call to torneos-payments (manifest = MP-A3 signInternal). One attempt, 8 s. */
async function requestPreference(cfg: CommerceEnabled, purchaseId: string, doFetch: typeof fetch, nowMs: number, paymentsMs: number): Promise<CheckoutResult | { preference: Record<string, string> }> {
  const body = JSON.stringify({ purchase_id: purchaseId })
  const time = String(Math.floor(nowMs / 1000))
  const nonce = crypto.randomUUID()
  let response: Response
  let text: string | null
  try {
    const signature = await signInternal(cfg.secret, PAYMENTS_INTERNAL_PATH, time, nonce, body)
    response = await doFetch(`${cfg.paymentsUrl}${PAYMENTS_INTERNAL_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-time": time, "x-nonce": nonce, "x-signature": signature },
      body, redirect: "error", signal: AbortSignal.timeout(paymentsMs),
    })
    text = await readText(response, 8192)
  } catch {
    return answer(503, "TORNEOS_PAYMENTS_UNAVAILABLE")
  }
  const parsed = parseJson(text)
  if (response.status === 200) {
    if (!isPlainObject(parsed)) return FAILED()
    const { provider, preferenceId, checkoutUrl, expiresAt } = parsed
    if (provider !== "MERCADO_PAGO" || typeof preferenceId !== "string" || preferenceId.length < 3 || preferenceId.length > 200
      || typeof checkoutUrl !== "string" || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return FAILED()
    let url: URL
    try { url = new URL(checkoutUrl) } catch { return FAILED() }
    if (url.protocol !== "https:" || url.username || url.password) return FAILED()
    return { preference: { provider, preferenceId, checkoutUrl, expiresAt } }
  }
  if (response.status === 503) return answer(503, "TORNEOS_PAYMENTS_UNAVAILABLE")
  const code = isPlainObject(parsed) && typeof parsed.error === "string" ? parsed.error : null
  if (response.status === 409 && code && Object.hasOwn(PAYMENTS_REFUSALS, code)) { const [status, mapped] = PAYMENTS_REFUSALS[code]; return answer(status, mapped) }
  return FAILED()
}

function projection(purchase: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PURCHASE_FIELDS) if (Object.hasOwn(purchase, key)) out[key] = purchase[key]
  return out
}

/** POST /commerce/v1/season-checkout, after the gateway matched method + path and commerce is TEST or production. */
export async function seasonCheckout(req: CheckoutRequest, cfg: CommerceEnabled, hooks: CheckoutHooks): Promise<CheckoutResult> {
  const now = hooks.now ?? (() => Date.now())
  const started = now()
  const rid = crypto.randomUUID()
  let purchaseId: string | null = null
  const done = (result: CheckoutResult): CheckoutResult => {
    const code = result.status === 200 ? (result.body.preference ? "preference" : "no_preference") : String(result.body.error)
    hooks.log?.({ fn: "torneos-gateway", route: "commerce.season_checkout", rid, purchaseId, status: result.status, code, ms: now() - started })
    return result
  }
  const doFetch = hooks.fetch ?? fetch
  const { restMs, paymentsMs } = hooks.timeouts ?? COMMERCE_TIMEOUTS
  try {
    // 2. bridge bearer (the certified verifier of this gateway)
    const header = req.authorization
    if (!header?.startsWith("Bearer ") || header.length > 12000) return done(DENIED())
    const token = header.slice(7)
    let claims: BridgeClaims
    try { claims = await hooks.verifyBridge(token) } catch { return done(DENIED()) }
    // 3. Core session, online
    try { await hooks.activeSession(claims) } catch (error) {
      return done(hooks.isUnavailable(error) ? answer(503, "CORE_UNAVAILABLE") : DENIED())
    }
    // 4. Torneos identity mapping
    try {
      if (!await hooks.identityExists(claims)) return done(DENIED())
    } catch (error) {
      return done(hooks.isUnavailable(error) ? answer(503, "TORNEOS_UNAVAILABLE") : DENIED())
    }
    // 5. body: exactly the three UUIDs; the client never sends price, provider, environment or URLs
    if (req.search) return done(INVALID())
    const raw = await readLimited(req.body, req.contentLength, MAX_CHECKOUT_BODY).catch(() => undefined)
    if (raw === null) return done(answer(413, "TORNEOS_CHECKOUT_TOO_LARGE"))
    const input = raw ? parseInput(raw) : null
    if (!input) return done(INVALID())
    // 6. the DB decides authorization, plan, price, provider, environment and idempotency
    const created = await createPurchase(token, input, hooks, doFetch, restMs, cfg.mode === "production" ? "production" : "test")
    if ("result" in created) return done(created.result)
    const purchase = created.purchase
    purchaseId = purchase.id as string
    // 7. only an open purchase gets a Preference
    if (purchase.status === "expired") return done(answer(409, "TORNEOS_CHECKOUT_EXPIRED"))
    if (!OPEN_STATUSES.has(purchase.status as string)) return done({ status: 200, body: { purchase: projection(purchase), preference: null } })
    const preference = await requestPreference(cfg, purchaseId, doFetch, now(), paymentsMs)
    if (!("preference" in preference)) return done(preference)
    // 8. whitelisted answer
    return done({ status: 200, body: { purchase: projection(purchase), preference: preference.preference } })
  } catch {
    return done(FAILED())
  }
}

// ============================================================================ the refresh route (COMMERCE-PRODUCTION)
const REFRESHABLE = new Set(["preference_created", "pending", "approved", "charged_back"])

/** Step 6 of the refresh: the buyer's (or a billing manager's) own read; the DB decides who may see the purchase. */
async function readPurchase(token: string, purchaseId: string, hooks: CheckoutHooks, doFetch: typeof fetch, restMs: number): Promise<Step> {
  let response: Response
  let text: string | null
  try {
    response = await doFetch(`${hooks.restUrl}/rpc/get_tournament_purchase`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json",
        ...(hooks.restApiKey ? { apikey: hooks.restApiKey } : {}) },
      body: JSON.stringify({ p_purchase_id: purchaseId }), redirect: "error", signal: AbortSignal.timeout(restMs),
    })
    text = await readText(response)
  } catch {
    return { result: answer(503, "TORNEOS_UNAVAILABLE") }
  }
  const body = parseJson(text)
  if (response.status === 200) {
    if (!isPlainObject(body) || body.id !== purchaseId || typeof body.status !== "string") return { result: FAILED() }
    return { purchase: body }
  }
  const refusal = isPlainObject(body) && typeof body.message === "string" ? body.message : null
  if (refusal && Object.hasOwn(DB_REFUSALS, refusal)) { const [status, code] = DB_REFUSALS[refusal]; return { result: answer(status, code) } }
  if (response.status === 401) return { result: DENIED() }
  if (response.status >= 500) return { result: answer(503, "TORNEOS_UNAVAILABLE") }
  return { result: FAILED() }
}

/** HMAC-signed reconcile request to torneos-payments-production. Its own failures never hide the purchase. */
async function requestReconcile(cfg: CommerceProduction, purchaseId: string, doFetch: typeof fetch, nowMs: number, paymentsMs: number): Promise<string> {
  const body = JSON.stringify({ purchase_id: purchaseId })
  const time = String(Math.floor(nowMs / 1000))
  const nonce = crypto.randomUUID()
  try {
    const signature = await signInternal(cfg.secret, PAYMENTS_RECONCILE_PATH, time, nonce, body)
    const response = await doFetch(`${cfg.paymentsUrl}${PAYMENTS_RECONCILE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-time": time, "x-nonce": nonce, "x-signature": signature },
      body, redirect: "error", signal: AbortSignal.timeout(paymentsMs),
    })
    const parsed = parseJson(await readText(response, 8192))
    if (response.status === 200 && isPlainObject(parsed) && typeof parsed.outcome === "string" && /^[a-z][a-z0-9_]{1,59}$/.test(parsed.outcome)) {
      return parsed.outcome
    }
    return response.status === 503 ? "unavailable" : "failed"
  } catch {
    return "unavailable"
  }
}

type RefreshInput = { purchaseId: string }
function parseRefreshInput(raw: Uint8Array): RefreshInput | null {
  let value: unknown
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return null }
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || typeof value.purchaseId !== "string" || !UUID_RE.test(value.purchaseId)) return null
  return { purchaseId: value.purchaseId.toLowerCase() }
}

/**
 * POST /commerce/v1/purchase-refresh {purchaseId} (production only): "I already paid" / "update". The buyer's read decides
 * access; only a production purchase that could still change is reconciled with Mercado Pago (the payments service
 * throttles per purchase); the answer is the buyer's read again plus the reconcile outcome. Grants come only from the
 * verified payment inside the payments service, never from this route.
 */
export async function purchaseRefresh(req: CheckoutRequest, cfg: CommerceProduction, hooks: CheckoutHooks): Promise<CheckoutResult> {
  const now = hooks.now ?? (() => Date.now())
  const started = now()
  const rid = crypto.randomUUID()
  let purchaseId: string | null = null
  const done = (result: CheckoutResult): CheckoutResult => {
    const code = result.status === 200 ? String(result.body.refresh ?? "read") : String(result.body.error)
    hooks.log?.({ fn: "torneos-gateway", route: "commerce.purchase_refresh", rid, purchaseId, status: result.status, code, ms: now() - started })
    return result
  }
  const doFetch = hooks.fetch ?? fetch
  const { restMs, paymentsMs } = hooks.timeouts ?? COMMERCE_TIMEOUTS
  try {
    const header = req.authorization
    if (!header?.startsWith("Bearer ") || header.length > 12000) return done(DENIED())
    const token = header.slice(7)
    let claims: BridgeClaims
    try { claims = await hooks.verifyBridge(token) } catch { return done(DENIED()) }
    try { await hooks.activeSession(claims) } catch (error) {
      return done(hooks.isUnavailable(error) ? answer(503, "CORE_UNAVAILABLE") : DENIED())
    }
    try {
      if (!await hooks.identityExists(claims)) return done(DENIED())
    } catch (error) {
      return done(hooks.isUnavailable(error) ? answer(503, "TORNEOS_UNAVAILABLE") : DENIED())
    }
    if (req.search) return done(INVALID())
    const raw = await readLimited(req.body, req.contentLength, MAX_CHECKOUT_BODY).catch(() => undefined)
    if (raw === null) return done(answer(413, "TORNEOS_CHECKOUT_TOO_LARGE"))
    const input = raw ? parseRefreshInput(raw) : null
    if (!input) return done(INVALID())
    purchaseId = input.purchaseId
    const first = await readPurchase(token, input.purchaseId, hooks, doFetch, restMs)
    if ("result" in first) return done(first.result)
    const production = first.purchase.provider === "MERCADO_PAGO" && first.purchase.providerEnvironment === "production"
    if (!production || !REFRESHABLE.has(first.purchase.status as string)) {
      return done({ status: 200, body: { purchase: projection(first.purchase), refresh: "not_applicable" } })
    }
    const refresh = await requestReconcile(cfg, input.purchaseId, doFetch, now(), paymentsMs)
    const second = await readPurchase(token, input.purchaseId, hooks, doFetch, restMs)
    const purchase = "purchase" in second ? second.purchase : first.purchase
    return done({ status: 200, body: { purchase: projection(purchase), refresh } })
  } catch {
    return done(FAILED())
  }
}
