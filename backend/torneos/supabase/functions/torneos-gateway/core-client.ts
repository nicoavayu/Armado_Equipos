// torneos-gateway/core-client.ts — Deno port of integration/torneos-core-contracts/core-client.mjs
// (the Node port of the certified Phase 2A CoreClient). Same signed transport (X-Time /
// X-Nonce / X-Signature = HMAC-SHA256 over path + "\n" + time + "\n" + nonce + "\n" + body),
// same 2 s timeout, 16 KiB request / 256 KiB response caps, same closed response schemas
// (schemas.json, byte-identical to Phase 2A; session.schema.json for the v1.1 operation),
// same team echo check, same 3 s freshness window (plus a bounded tolerance for a Core clock
// slightly AHEAD of this one, see FRESHNESS below) and the same sanitized errors: the
// downstream body never surfaces, only CORE_DENIED (4xx) or CORE_UNAVAILABLE.
//
// Transport policy (fail closed): the base URL is fixed at construction; it must be the
// lab's internal Core origin (http://core-api…) or an https:// origin, and may never
// name the Production project.
import schemasDoc from "./schemas.json" with { type: "json" }
import sessionDoc from "./session.schema.json" with { type: "json" }

type Schema = Record<string, any>
const SCHEMAS: Record<string, Schema> = { ...(schemasDoc as any).$defs, ...(sessionDoc as any).$defs }

export const PRODUCTION_REF = "rcyuuoaqfwcembdajcss"
export class Denied extends Error {
  status: number
  code: string
  constructor(status = 403, code = "FORBIDDEN") { super(code); this.status = status; this.code = code }
}

function kindOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number"
  return typeof value
}

/** Same keyword subset as phase2a/schema_validation.py; any violation fails closed. */
export function validate(value: unknown, schema: string | Schema): void {
  if (typeof schema === "string") schema = SCHEMAS[schema]
  if (!schema) throw new Error("SCHEMA_UNKNOWN")
  if (schema.type) {
    const kinds = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!kinds.includes(kindOf(value))) throw new Error("SCHEMA_TYPE")
  }
  if ("enum" in schema && !schema.enum.includes(value)) throw new Error("SCHEMA_ENUM")
  if (kindOf(value) === "object") {
    const v = value as Record<string, unknown>
    const keys = Object.keys(v).sort()
    if (JSON.stringify(keys) !== JSON.stringify([...schema.required].sort())) throw new Error("SCHEMA_KEYS")
    for (const k of keys) validate(v[k], schema.properties[k])
  } else if (kindOf(value) === "array") {
    const v = value as unknown[]
    if (v.length > schema.maxItems) throw new Error("SCHEMA_SIZE")
    for (const item of v) validate(item, schema.items)
  } else if (typeof value === "string") {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new Error("SCHEMA_LENGTH")
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error("SCHEMA_PATTERN")
  } else if (kindOf(value) === "integer") {
    const v = value as number
    if (v < (schema.minimum ?? -Infinity) || v > (schema.maximum ?? Infinity)) throw new Error("SCHEMA_RANGE")
  }
}

/**
 * FRESHNESS of a time-bound Core verdict (`checked_at` / `captured_at`: integer unix seconds,
 * truncated on Core's Postgres clock). `age = now − observed` must satisfy
 *   −MAX_FUTURE_SKEW_SECONDS ≤ age ≤ MAX_RESPONSE_AGE_SECONDS
 * MAX_RESPONSE_AGE_SECONDS is the certified Phase 2A window (2 s HTTP timeout + integer rounding):
 * anything older is stale and fails closed as CORE_UNAVAILABLE (no cache, no stale verdict).
 * MAX_FUTURE_SKEW_SECONDS bounds a Core clock AHEAD of this one. R4.2 run 20260918T224221Z
 * (Core staging vs the local gateway, ≈0.15 s apart) rejected valid verdicts whenever the
 * truncated `checked_at` crossed a second boundary before this clock did (age ∈ (−0.25, 0)),
 * i.e. `age >= 0` treated tiny future skew as staleness. 5 s is the tolerance already certified
 * for the bridge token (token.ts clockTolerance) and by the attestation table
 * (core_contract_attestations_fresh: observed_at ≤ created_at + 5 s); a verdict further in the
 * future is a broken clock, not skew, and still fails closed. NaN never passes.
 */
export const MAX_RESPONSE_AGE_SECONDS = 3
export const MAX_FUTURE_SKEW_SECONDS = 5
export function isFreshObservation(observed: unknown, now: number): boolean {
  if (typeof observed !== "number" || !Number.isFinite(observed) || !Number.isFinite(now)) return false
  const age = now - observed
  return age >= -MAX_FUTURE_SKEW_SECONDS && age <= MAX_RESPONSE_AGE_SECONDS
}

export const ROUTES: Record<string, string> = {
  verified_email: "/v1/verified-email",
  directory_players: "/v1/directory",
  directory_teams: "/v1/directory",
  team_snapshot: "/v1/team-snapshot",
  session: "/v1/session",
}

const encoder = new TextEncoder()
function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes as ArrayBuffer), (b) => b.toString(16).padStart(2, "0")).join("")
}
export function fromHex(value: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(value)) throw new Error("HEX")
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Accepts the lab's internal Core origin or an https origin; never Production. */
export function assertCoreContractUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl)
  const labInternal = parsed.protocol === "http:" && parsed.hostname === "core-api"
  if ((!labInternal && parsed.protocol !== "https:") || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("CORE_CONTRACT_URL_REJECTED")
  }
  if (parsed.hostname.split(".").includes(PRODUCTION_REF)) throw new Error("CORE_CONTRACT_URL_PRODUCTION_REJECTED")
  return baseUrl.replace(/\/$/, "")
}

export class CoreClient {
  baseUrl: string
  key: Uint8Array
  clock: () => number
  extraHeaders: Record<string, string>
  fetchImpl: typeof fetch
  /**
   * @param baseUrl fixed Core endpoint base (…/functions/v1/torneos-core-contract)
   * @param key     service secret shared with Core (never in the browser)
   */
  constructor(baseUrl: string, key: Uint8Array, options: { clock?: () => number; extraHeaders?: Record<string, string>; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = assertCoreContractUrl(baseUrl)
    this.key = key
    this.clock = options.clock ?? (() => Date.now() / 1000)
    this.extraHeaders = options.extraHeaders ?? {}
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async sign(path: string, time: string, nonce: string, body: Uint8Array): Promise<string> {
    const key = await crypto.subtle.importKey("raw", this.key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const prefix = encoder.encode(`${path}\n${time}\n${nonce}\n`)
    const signed = new Uint8Array(prefix.length + body.length)
    signed.set(prefix, 0)
    signed.set(body, prefix.length)
    return hex(await crypto.subtle.sign("HMAC", key, signed))
  }

  async call(path: string, request: Record<string, unknown>): Promise<Record<string, any>> {
    const body = encoder.encode(JSON.stringify(request))
    if (body.length > 16384) throw new Denied(400, "INVALID_REQUEST")
    const time = String(Math.floor(this.clock()))
    const nonce = hex(crypto.getRandomValues(new Uint8Array(16)))
    const signature = await this.sign(path, time, nonce, body)
    let response: Response
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method: "POST", body, redirect: "error", signal: AbortSignal.timeout(2000),
        headers: { "content-type": "application/json", "x-time": time, "x-nonce": nonce, "x-signature": signature, ...this.extraHeaders },
      })
    } catch {
      throw new Denied(503, "CORE_UNAVAILABLE")
    }
    let raw: Uint8Array
    try {
      raw = new Uint8Array(await response.arrayBuffer())
    } catch {
      throw new Denied(503, "CORE_UNAVAILABLE")
    }
    if (response.status !== 200) {
      // Keep the downstream body out of errors and logs.
      throw new Denied(response.status, response.status < 500 ? "CORE_DENIED" : "CORE_UNAVAILABLE")
    }
    try {
      if (raw.length > 262144) throw new Error("RESPONSE_TOO_LARGE")
      const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))
      const schema = ({
        "/v1/verified-email": "verifiedEmailResponse", "/v1/team-snapshot": "teamSnapshotResponse", "/v1/session": "sessionResponse",
        "/v1/directory": request.kind === "players" ? "playersResponse" : "teamsResponse",
      } as Record<string, string>)[path]
      validate(result, schema)
      if (path === "/v1/team-snapshot" && result.core_team_id !== request.core_team_id) throw new Error("WRONG_TEAM")
      if (path !== "/v1/directory") {
        const observed = result.checked_at ?? result.captured_at
        if (!isFreshObservation(observed, this.clock())) throw new Error("STALE_RESPONSE")
      }
      return result
    } catch {
      throw new Denied(503, "CORE_UNAVAILABLE")
    }
  }
}
