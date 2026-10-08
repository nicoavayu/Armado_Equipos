// torneos-gateway/adapter.ts — Deno port of integration/torneos-core-contracts/adapter.mjs
// (the real counterpart of backend/torneos/phase2b/adapter.py):
//
//   verified local bearer → private.authorize_core_contract (as torneos_core_adapter)
//   → REAL Core endpoint (signed) → single-use attestation (INSERT-only role)
//   → the unchanged historical RPC, executed by PostgREST with the user's bearer.
//
// The adapter never runs as the user, never reads attestations back, never bypasses the
// RPC's own checks, and derives identity/session only from the bearer the gateway already
// verified. Nothing here is a client-settable GUC, a request-body flag, an email claim or
// a browser-readable table.
import { CoreClient, Denied, ROUTES } from "./core-client.ts"
import { asRole, isUnavailable, type Sql } from "./db.ts"
import type { TorneosClaims } from "./token.ts"

type Body = Record<string, any>
// The private functions that pre-authorize a Core contract. Fixed names only: the SQL text is built from this list.
export const AUTHORIZERS: readonly string[] = Object.freeze(["authorize_core_contract", "authorize_applicant_core_contract"])
// CONNECTED-V1: the applicant requests are the only ones carrying these keys. The request object is built by the
// mappers below from a fixed set of keys (a client cannot add one), so its shape names its authorizer; the authorizer
// itself then re-checks the exact key set. The certified authenticated route of index.ts stays unchanged.
const APPLICANT_KEYS: readonly string[] = Object.freeze(["applicant_public_slug", "application_public_slug"])
export function authorizerFor(request: Record<string, unknown>): string {
  return APPLICANT_KEYS.some((key) => Object.hasOwn(request, key)) ? "authorize_applicant_core_contract" : "authorize_core_contract"
}
export const CONTRACTS: Record<string, { contract: string; request: (b: Body) => Record<string, unknown> | null }> = {
  accept_tournament_team_invitation: {
    contract: "verified_email",
    request: (b) => ({ token: b.p_token }),
  },
  // OFFICIALIZATION-V1: same Core contract, keyed by the organization invitation (private.authorize_core_contract).
  accept_tournament_organization_invitation: {
    contract: "verified_email",
    request: (b) => ({ organization_invitation_token: b.p_token }),
  },
  search_tournament_players: {
    contract: "directory_players",
    request: (b) => ({ organization_id: b.p_organization_id, tournament_id: b.p_tournament_id,
      team_entry_id: b.p_team_entry_id ?? null, query: b.p_query, limit: b.p_limit ?? 8 }),
  },
  search_tournament_arma2_teams: {
    contract: "directory_teams",
    request: (b) => ({ organization_id: b.p_organization_id, tournament_id: b.p_tournament_id,
      query: b.p_query, limit: b.p_limit ?? 8 }),
  },
  create_tournament_team_entry: {
    contract: "team_snapshot",
    // Only the Core import path needs an attestation; manual/provisional entries do not.
    request: (b) => (b.p_arma2_team_id ? { organization_id: b.p_organization_id, tournament_id: b.p_tournament_id,
      category_id: b.p_category_id, core_team_id: b.p_arma2_team_id } : null),
  },
  // CONNECTED-V1: the applicant's own Core teams and their frozen snapshot, pre-authorized by
  // private.authorize_applicant_core_contract (an open call in the catalog, never an organization capability).
  search_my_applicable_core_teams: {
    contract: "directory_teams",
    request: (b) => ({ applicant_public_slug: b.p_public_slug, query: b.p_query, limit: b.p_limit ?? 8 }),
  },
  // Core contract v1.2: the applicant's own teams (can register / only a member); a fixed limit, no client input.
  list_my_core_teams_for_application: {
    contract: "my_teams",
    request: (b) => ({ applicant_public_slug: b.p_public_slug, limit: 30 }),
  },
  start_tournament_application: {
    contract: "team_snapshot",
    // Only a request for an existing Core team needs an attestation; a new team does not.
    request: (b) => (b.p_core_team_id ? { application_public_slug: b.p_public_slug, category_slug: b.p_category_slug,
      core_team_id: b.p_core_team_id } : null),
  },
}

export class AdapterDenied extends Error {
  status: number
  code: string
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code }
}

export function mapSqlError(error: unknown): AdapterDenied {
  const message = String((error as { message?: unknown })?.message ?? "")
  const code = (error as { code?: unknown })?.code
  if (/^TORNEOS_[A-Z_]+$/.test(message)) {
    if (message === "TORNEOS_SEARCH_RATE_LIMITED") return new AdapterDenied(429, message)
    if (code === "22023") return new AdapterDenied(400, message)
    // ERROR-CONTRACT-V1 custom statuses (PT409 / PT422 / PT429) keep their HTTP meaning before PostgREST is reached.
    if (typeof code === "string" && /^PT4(?:09|22|29)$/.test(code)) return new AdapterDenied(Number(code.slice(2)), message)
    return new AdapterDenied(403, message)
  }
  return new AdapterDenied(503, "TORNEOS_UNAVAILABLE")
}

export type Authorization = { identity_id: string; request_hash: string; core_request: Record<string, unknown> }

export class Adapter {
  sql: Sql
  client: CoreClient
  /** @param sql login that is a NOINHERIT member of torneos_core_adapter */
  constructor(sql: Sql, client: CoreClient) {
    this.sql = sql
    this.client = client
  }

  // postgres.js serializes a parameter the server describes as json/jsonb with JSON.stringify;
  // handing it an already-serialized string would double-encode it into a jsonb *string*.
  // JSON parameters are therefore passed as objects (pg, in the Node gateway, sends text verbatim).
  async _asAdapter<T>(claims: TorneosClaims, fn: (tx: any) => Promise<T>): Promise<T> {
    return await asRole(this.sql, "torneos_core_adapter", async (tx) => {
      await tx.unsafe("SELECT set_config('request.jwt.claims', $1::text, true)", [JSON.stringify(claims)])
      return await fn(tx)
    })
  }

  async authorize(claims: TorneosClaims, contract: string, request: Record<string, unknown>,
    authorizer = authorizerFor(request)): Promise<Authorization> {
    if (!AUTHORIZERS.includes(authorizer)) throw new AdapterDenied(403, "TORNEOS_RESOURCE_FORBIDDEN")
    try {
      const rows = await this._asAdapter(claims, (tx) =>
        tx.unsafe(`SELECT private.${authorizer}($1, $2::jsonb) AS authorization`, [contract, request]))
      return rows[0].authorization as Authorization
    } catch (error) {
      if (isUnavailable(error)) throw new AdapterDenied(503, "TORNEOS_UNAVAILABLE")
      throw mapSqlError(error)
    }
  }

  async attest(claims: TorneosClaims, contract: string, requestHash: string, response: Record<string, unknown>, observedAt: number): Promise<void> {
    try {
      await this._asAdapter(claims, (tx) => tx.unsafe(
        `INSERT INTO private.core_contract_attestations (identity_id, session_id, contract, request_hash, response, observed_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, to_timestamp($6))`,
        [claims.sub, claims.session_id, contract, requestHash, response, Math.floor(observedAt)]))
    } catch (error) {
      if (isUnavailable(error)) throw new AdapterDenied(503, "TORNEOS_UNAVAILABLE")
      throw mapSqlError(error)
    }
  }

  /** Local authorization first; Core second; attestation last. Any failure leaves nothing behind. */
  async prepare(claims: TorneosClaims, contract: string, request: Record<string, unknown>,
    authorizer?: string): Promise<Authorization> {
    const authorization = await this.authorize(claims, contract, request, authorizer)
    if (authorization.identity_id !== claims.sub) throw new AdapterDenied(403, "TORNEOS_RESOURCE_FORBIDDEN")
    const response = await this.client.call(ROUTES[contract], {
      core_user_id: claims.core_user_id, session_id: claims.session_id, ...authorization.core_request,
    })
    const observed = response.checked_at ?? response.captured_at ?? Math.floor(Date.now() / 1000)
    await this.attest(claims, contract, authorization.request_hash, response, observed)
    return authorization
  }
}

export { Denied }
