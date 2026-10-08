// backend/torneos/supabase/functions/torneos-gateway/connected.ts
//
// CONNECTED-V1 — the connected product (Torneos profile, Torneos inbox, catalog management, registration requests and
// the public catalog "Explorar torneos"), shared by the Edge gateway (index.ts) and the Node lab gateway
// (integration/torneos-core-contracts/gateway.mjs). Strictly opt-in, like SOCIAL-V1:
//
//   • TORNEOS_CONNECTED_MODE absent, "" or "off" → nothing changes (no RPC added, no public RPC served);
//   • "on" → the authenticated generic route gains exactly the `features` of connected-v1-rpc-allowlist.json and the
//     public read-only route gains exactly its `public` RPCs, each with a fixed body contract (CONNECTED_PUBLIC_PARAMS);
//   • any other value, a malformed document, a name listed twice or already served by another contract, or a public
//     RPC without a body contract throws ConnectedConfigError and the gateway refuses to boot (fail closed).
//
// The public route keeps the COMPETITION-V1 discipline: no credential accepted, body = exactly the declared arguments
// (absent → null), anon only, bounded by the same PublicGate.
import connectedDoc from "./connected-v1-rpc-allowlist.json" with { type: "json" }

export class ConnectedConfigError extends Error {}

const NAME = /^[a-z0-9_]+$/
const PUBLIC_BODY_LIMIT = 2048
const TEXT = /^[\p{L}\p{N} .,'’()\-/]{1,80}$/u
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

type Rule = { max: number; pattern: RegExp; required: boolean }

// The exact body of every public CONNECTED-V1 RPC: each named argument a string of the shape the function itself
// validates, or null. PostgREST resolves the function by the full set of named arguments, so all of them travel.
export const CONNECTED_PUBLIC_PARAMS: Readonly<Record<string, Readonly<Record<string, Rule>>>> = Object.freeze({
  search_tournament_catalog: Object.freeze({
    p_query: { max: 80, pattern: TEXT, required: false },
    p_locality: { max: 80, pattern: TEXT, required: false },
    p_sport: { max: 32, pattern: /^[a-z0-9_]{2,32}$/, required: false },
    p_gender: { max: 6, pattern: /^(?:male|female|mixed|open)$/, required: false },
    p_scope: { max: 4, pattern: /^(?:open|all)$/, required: false },
    p_from: { max: 10, pattern: DATE, required: false },
    p_to: { max: 10, pattern: DATE, required: false },
    p_sort: { max: 8, pattern: /^(?:closing|starting|recent)$/, required: false },
    p_page: { max: 3, pattern: /^[1-9][0-9]{0,2}$/, required: false },
  }),
  get_tournament_catalog_facets: Object.freeze({}),
  get_tournament_catalog_entry: Object.freeze({
    p_public_slug: { max: 96, pattern: SLUG, required: true },
  }),
})

export type ConnectedContract = {
  mode: "on" | "off"
  /** RPCs of the authenticated generic route that CONNECTED-V1 adds (disjoint from everything else). */
  rpcs: ReadonlySet<string>
  /** RPCs of the anonymous public read-only route that CONNECTED-V1 adds. */
  publicRpcs: ReadonlySet<string>
  features: Readonly<Record<string, readonly string[]>>
}

const OFF: ConnectedContract = Object.freeze({ mode: "off", rpcs: new Set<string>(), publicRpcs: new Set<string>(), features: Object.freeze({}) })

function section(value: unknown, label: string): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectedConfigError(`${label} section`)
  const out: Record<string, string[]> = {}
  for (const [feature, list] of Object.entries(value as Record<string, unknown>)) {
    if (!NAME.test(feature) || !Array.isArray(list) || list.length === 0) throw new ConnectedConfigError(`${label}.${feature}`)
    if (!list.every((name) => typeof name === "string" && NAME.test(name))) throw new ConnectedConfigError(`${label}.${feature} names`)
    out[feature] = [...list] as string[]
  }
  if (Object.keys(out).length === 0) throw new ConnectedConfigError(`${label} is empty`)
  return out
}

/**
 * @param authenticated every RPC the authenticated route already serves (every contract booted before this one)
 * @param publicRpcs    every RPC the public route already serves (COMPETITION-V1)
 */
export function loadConnectedContract(env: Record<string, string | undefined>, authenticated: ReadonlySet<string>,
  publicRpcs: ReadonlySet<string>, doc: unknown = connectedDoc): ConnectedContract {
  const mode = env.TORNEOS_CONNECTED_MODE ?? "off"
  if (mode === "" || mode === "off") return OFF
  if (mode !== "on") throw new ConnectedConfigError("TORNEOS_CONNECTED_MODE must be on or off")
  if (!doc || typeof doc !== "object" || (doc as { phase?: unknown }).phase !== "CONNECTED-V1") {
    throw new ConnectedConfigError("connected-v1 allowlist is not the CONNECTED-V1 contract")
  }
  const features = section((doc as { features?: unknown }).features, "features")
  const publicSection = section((doc as { public?: unknown }).public, "public")
  const all = Object.values(features).flat()
  const pub = Object.values(publicSection).flat()
  const rpcs = new Set(all)
  const added = new Set(pub)
  if (rpcs.size !== all.length || added.size !== pub.length) throw new ConnectedConfigError("duplicate names")
  if ([...rpcs].some((name) => authenticated.has(name) || publicRpcs.has(name))) throw new ConnectedConfigError("overlaps an earlier contract")
  if ([...added].some((name) => rpcs.has(name) || authenticated.has(name) || publicRpcs.has(name))) {
    throw new ConnectedConfigError("public RPC also served elsewhere")
  }
  const contracts = Object.keys(CONNECTED_PUBLIC_PARAMS)
  if (contracts.length !== added.size || contracts.some((name) => !added.has(name))) {
    throw new ConnectedConfigError("public RPCs and body contracts differ")
  }
  if ([...rpcs, ...added].some((name) => name.startsWith("platform_"))) throw new ConnectedConfigError("platform RPCs are never served")
  return Object.freeze({
    mode: "on",
    rpcs,
    publicRpcs: added,
    features: Object.freeze(Object.fromEntries(Object.entries(features).map(([key, list]) => [key, Object.freeze(list)]))),
  })
}

/** Authenticated generic route: everything already served ∪ CONNECTED-V1 (when on). */
export function withConnected(base: ReadonlySet<string>, contract: ConnectedContract): ReadonlySet<string> {
  return new Set([...base, ...contract.rpcs])
}

export type ConnectedPublicRequest = {
  name: string
  authorization: string | null
  apikey: string | null
  contentType: string | null
  contentLength: string | null
  body: AsyncIterable<Uint8Array> | null
}
export type ConnectedPublicDecision =
  | { ok: false; status: number; error: string }
  | { ok: true; path: string; body: string }

async function readLimited(body: AsyncIterable<Uint8Array> | null): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.length
    if (size > PUBLIC_BODY_LIMIT) return null
    chunks.push(chunk)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

/** Same decision as competition.ts preparePublicRpc, for the CONNECTED-V1 public RPCs. */
export async function prepareConnectedPublicRpc(req: ConnectedPublicRequest, contract: ConnectedContract): Promise<ConnectedPublicDecision> {
  if (req.authorization !== null || req.apikey !== null) return { ok: false, status: 400, error: "public route accepts no credentials" }
  if (!contract.publicRpcs.has(req.name) || !Object.hasOwn(CONNECTED_PUBLIC_PARAMS, req.name)) return { ok: false, status: 403, error: "rpc not enabled" }
  const declared = req.contentLength
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > PUBLIC_BODY_LIMIT)) {
    return { ok: false, status: 413, error: "body too large" }
  }
  if (!/^application\/json(;|$)/i.test((req.contentType ?? "").trim())) return { ok: false, status: 415, error: "json required" }
  const raw = await readLimited(req.body)
  if (raw === null) return { ok: false, status: 413, error: "body too large" }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.length ? raw : new TextEncoder().encode("{}"))) } catch {
    return { ok: false, status: 400, error: "invalid json" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, status: 400, error: "invalid json" }
  const spec = CONNECTED_PUBLIC_PARAMS[req.name]
  const input = parsed as Record<string, unknown>
  if (Object.keys(input).some((key) => !Object.hasOwn(spec, key))) return { ok: false, status: 400, error: "invalid arguments" }
  const body: Record<string, string | null> = {}
  for (const [key, rule] of Object.entries(spec)) {
    const value = input[key] ?? null
    if (value === null ? rule.required : (typeof value !== "string" || value.length === 0 || value.length > rule.max || !rule.pattern.test(value))) {
      return { ok: false, status: 400, error: "invalid arguments" }
    }
    body[key] = value as string | null
  }
  return { ok: true, path: `/rpc/${req.name}`, body: JSON.stringify(body) }
}
