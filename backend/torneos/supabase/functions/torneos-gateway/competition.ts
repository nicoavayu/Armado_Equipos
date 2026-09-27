// backend/torneos/supabase/functions/torneos-gateway/competition.ts
//
// COMPETITION-V1 — the full-competition contract of the gateway, shared by the Edge gateway (index.ts) and the
// Node lab gateway (integration/torneos-core-contracts/gateway.mjs), exactly like commerce.ts:
//
//   • the authenticated allowlist (competition-v1-rpc-allowlist.json `features`): RPCs served by the generic
//     route POST /torneos/rest/v1/rpc/<name> on top of the 43 staging v1 RPCs, with the same bearer + live Core
//     session + identity checks as before (nothing about that route changes except the set of names);
//   • the PUBLIC READ-ONLY route POST /torneos/public/v1/rpc/<name> (`public`): no credential is accepted —
//     a request that carries one is refused — and the RPC runs as the database role anon with a fixed,
//     validated body. It exists for the anonymous public tournament page and serves nothing else.
//
// Fail closed: a malformed document, an empty section, an invalid name, or a name listed twice (inside the
// document or against the staging v1 set) makes the loader throw, and the gateway refuses to boot.
import allowlistDoc from "./competition-v1-rpc-allowlist.json" with { type: "json" }

export const PUBLIC_RPC_ROUTE = /^\/torneos\/public\/v1\/rpc\/([a-z0-9_]+)$/
const NAME = /^[a-z0-9_]+$/
const PUBLIC_BODY_LIMIT = 2048

// The exact body of every public RPC: each named argument, a string of bounded length or null. PostgREST
// resolves the function by the full set of named arguments, so both always travel (absent → null).
const PUBLIC_PARAMS: Record<string, Record<string, { max: number; required: boolean }>> = {
  get_public_tournament_page: {
    p_public_slug: { max: 96, required: true },
    p_category_slug: { max: 48, required: false },
  },
}

export class CompetitionConfigError extends Error {}

export type CompetitionContract = {
  /** RPCs of the generic authenticated route that COMPETITION-V1 adds (disjoint from staging v1). */
  rpcs: ReadonlySet<string>
  /** RPCs of the anonymous public read-only route. */
  publicRpcs: ReadonlySet<string>
  /** feature → RPC names, for diagnostics and tests. */
  features: Readonly<Record<string, readonly string[]>>
}

function names(section: unknown, label: string): Record<string, string[]> {
  if (!section || typeof section !== "object" || Array.isArray(section)) throw new CompetitionConfigError(`${label} section`)
  const out: Record<string, string[]> = {}
  for (const [feature, list] of Object.entries(section as Record<string, unknown>)) {
    if (!NAME.test(feature) || !Array.isArray(list) || list.length === 0) throw new CompetitionConfigError(`${label}.${feature}`)
    if (!list.every((n) => typeof n === "string" && NAME.test(n))) throw new CompetitionConfigError(`${label}.${feature} names`)
    out[feature] = [...list] as string[]
  }
  if (Object.keys(out).length === 0) throw new CompetitionConfigError(`${label} is empty`)
  return out
}

/** Validates the committed document against the staging v1 set the gateway already loaded. */
export function loadCompetitionContract(stagingV1: ReadonlySet<string>, doc: unknown = allowlistDoc): CompetitionContract {
  if (!doc || typeof doc !== "object" || (doc as { phase?: unknown }).phase !== "COMPETITION-V1") {
    throw new CompetitionConfigError("competition allowlist document")
  }
  const features = names((doc as { features?: unknown }).features, "features")
  const publicSection = names((doc as { public?: unknown }).public, "public")
  const all = Object.values(features).flat()
  const pub = Object.values(publicSection).flat()
  const rpcs = new Set(all)
  const publicRpcs = new Set(pub)
  if (rpcs.size !== all.length || publicRpcs.size !== pub.length) throw new CompetitionConfigError("duplicate names")
  if ([...rpcs].some((n) => stagingV1.has(n))) throw new CompetitionConfigError("overlaps staging v1")
  if ([...publicRpcs].some((n) => rpcs.has(n) || stagingV1.has(n))) throw new CompetitionConfigError("public RPC also authenticated")
  if ([...publicRpcs].some((n) => !PUBLIC_PARAMS[n])) throw new CompetitionConfigError("public RPC without a body contract")
  return { rpcs, publicRpcs, features: Object.freeze(Object.fromEntries(Object.entries(features).map(([k, v]) => [k, Object.freeze(v)]))) }
}

/** Generic authenticated route: staging v1 ∪ COMPETITION-V1 (commerce, when on, adds its reads on top). */
export function withCompetition(stagingV1: ReadonlySet<string>, contract: CompetitionContract): ReadonlySet<string> {
  return new Set([...stagingV1, ...contract.rpcs])
}

export type PublicRequest = {
  name: string
  authorization: string | null
  apikey: string | null
  contentType: string | null
  contentLength: string | null
  body: AsyncIterable<Uint8Array> | null
}
export type PublicDecision =
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

/**
 * Decides a public request without touching any dependency: refuses credentials, names outside the public
 * list and any body that is not exactly the declared arguments; otherwise returns the PostgREST path and the
 * normalized body to forward as anon (no Authorization header, ever).
 */
export async function preparePublicRpc(req: PublicRequest, contract: CompetitionContract): Promise<PublicDecision> {
  // A public call never carries an identity: an Authorization (or a caller-chosen apikey) is refused instead of
  // silently dropped, so a client cannot believe it is authenticated here.
  if (req.authorization !== null || req.apikey !== null) return { ok: false, status: 400, error: "public route accepts no credentials" }
  if (!contract.publicRpcs.has(req.name)) return { ok: false, status: 403, error: "rpc not enabled" }
  const declared = req.contentLength
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > PUBLIC_BODY_LIMIT)) {
    return { ok: false, status: 413, error: "body too large" }
  }
  if (!/^application\/json(;|$)/i.test((req.contentType ?? "").trim())) return { ok: false, status: 415, error: "json required" }
  const raw = await readLimited(req.body)
  if (raw === null) return { ok: false, status: 413, error: "body too large" }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { return { ok: false, status: 400, error: "invalid json" } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, status: 400, error: "invalid json" }
  const spec = PUBLIC_PARAMS[req.name]
  const input = parsed as Record<string, unknown>
  if (Object.keys(input).some((k) => !Object.hasOwn(spec, k))) return { ok: false, status: 400, error: "invalid arguments" }
  const body: Record<string, string | null> = {}
  for (const [key, rule] of Object.entries(spec)) {
    const value = input[key] ?? null
    if (value === null ? rule.required : (typeof value !== "string" || value.length === 0 || value.length > rule.max)) {
      return { ok: false, status: 400, error: "invalid arguments" }
    }
    body[key] = value as string | null
  }
  return { ok: true, path: `/rpc/${req.name}`, body: JSON.stringify(body) }
}
