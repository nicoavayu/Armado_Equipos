// Torneos server adapter (Phase 3A): the real counterpart of phase2b/adapter.py.
//
//   verified local bearer → private.authorize_core_contract (as torneos_core_adapter)
//   → REAL Core endpoint (signed) → single-use attestation (INSERT-only role)
//   → the unchanged historical RPC, executed by PostgREST with the user's bearer.
//
// The adapter never runs as the user, never reads attestations back, never
// bypasses the RPC's own checks, and derives identity/session only from the
// bearer the gateway already verified. Nothing here is a client-settable GUC, a
// request-body flag, an email claim or a browser-readable table.
import { Denied, ROUTES } from './core-client.mjs';

// The private functions that pre-authorize a Core contract. Fixed names only: the SQL text is built from this list.
export const AUTHORIZERS = Object.freeze(['authorize_core_contract', 'authorize_applicant_core_contract']);
// CONNECTED-V1: the applicant requests are the only ones carrying these keys. The request object is built by the
// mappers below from a fixed set of keys (a client cannot add one), so its shape names its authorizer; the authorizer
// itself then re-checks the exact key set.
const APPLICANT_KEYS = Object.freeze(['applicant_public_slug', 'application_public_slug']);
export function authorizerFor(request) {
  return APPLICANT_KEYS.some((key) => Object.hasOwn(request, key)) ? 'authorize_applicant_core_contract' : 'authorize_core_contract';
}
export const CONTRACTS = {
  accept_tournament_team_invitation: {
    contract: 'verified_email',
    request: (b) => ({ token: b.p_token }),
  },
  // OFFICIALIZATION-V1: same Core contract, keyed by the organization invitation (private.authorize_core_contract).
  accept_tournament_organization_invitation: {
    contract: 'verified_email',
    request: (b) => ({ organization_invitation_token: b.p_token }),
  },
  search_tournament_players: {
    contract: 'directory_players',
    request: (b) => ({ organization_id: b.p_organization_id, tournament_id: b.p_tournament_id,
      team_entry_id: b.p_team_entry_id ?? null, query: b.p_query, limit: b.p_limit ?? 8 }),
  },
  search_tournament_arma2_teams: {
    contract: 'directory_teams',
    request: (b) => ({ organization_id: b.p_organization_id, tournament_id: b.p_tournament_id,
      query: b.p_query, limit: b.p_limit ?? 8 }),
  },
  create_tournament_team_entry: {
    contract: 'team_snapshot',
    // Only the Core import path needs an attestation; manual/provisional entries do not.
    request: (b) => (b.p_arma2_team_id ? { organization_id: b.p_organization_id, tournament_id: b.p_tournament_id,
      category_id: b.p_category_id, core_team_id: b.p_arma2_team_id } : null),
  },
  // CONNECTED-V1: the applicant's own Core teams and their frozen snapshot, pre-authorized by
  // private.authorize_applicant_core_contract (an open call in the catalog, never an organization capability).
  search_my_applicable_core_teams: {
    contract: 'directory_teams',
    request: (b) => ({ applicant_public_slug: b.p_public_slug, query: b.p_query, limit: b.p_limit ?? 8 }),
  },
  start_tournament_application: {
    contract: 'team_snapshot',
    // Only a request for an existing Core team needs an attestation; a new team does not.
    request: (b) => (b.p_core_team_id ? { application_public_slug: b.p_public_slug, category_slug: b.p_category_slug,
      core_team_id: b.p_core_team_id } : null),
  },
};

export class AdapterDenied extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function mapSqlError(error) {
  const message = String(error?.message ?? '');
  if (/^TORNEOS_[A-Z_]+$/.test(message)) {
    if (message === 'TORNEOS_SEARCH_RATE_LIMITED') return new AdapterDenied(429, message);
    if (error.code === '22023') return new AdapterDenied(400, message);
    // ERROR-CONTRACT-V1 custom statuses (PT409 / PT422 / PT429) keep their HTTP meaning before PostgREST is reached.
    if (typeof error.code === 'string' && /^PT4(?:09|22|29)$/.test(error.code)) return new AdapterDenied(Number(error.code.slice(2)), message);
    return new AdapterDenied(403, message);
  }
  return new AdapterDenied(503, 'TORNEOS_UNAVAILABLE');
}

export class Adapter {
  /**
   * @param {import('pg').Pool} pool  login that is a NOINHERIT member of torneos_core_adapter
   * @param {import('./core-client.mjs').CoreClient} client
   */
  constructor(pool, client) {
    this.pool = pool;
    this.client = client;
  }

  async _asAdapter(claims, fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE torneos_core_adapter');
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      c.release();
    }
  }

  async authorize(claims, contract, request, authorizer = authorizerFor(request)) {
    if (!AUTHORIZERS.includes(authorizer)) throw new AdapterDenied(403, 'TORNEOS_RESOURCE_FORBIDDEN');
    try {
      const { rows } = await this._asAdapter(claims, (c) =>
        c.query(`SELECT private.${authorizer}($1, $2::jsonb) AS authorization`, [contract, JSON.stringify(request)]));
      return rows[0].authorization;
    } catch (error) {
      throw mapSqlError(error);
    }
  }

  async attest(claims, contract, requestHash, response, observedAt) {
    try {
      await this._asAdapter(claims, (c) => c.query(
        `INSERT INTO private.core_contract_attestations (identity_id, session_id, contract, request_hash, response, observed_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, to_timestamp($6))`,
        [claims.sub, claims.session_id, contract, requestHash, JSON.stringify(response), Math.floor(observedAt)]));
    } catch (error) {
      throw mapSqlError(error);
    }
  }

  /** Local authorization first; Core second; attestation last. Any failure leaves nothing behind. */
  async prepare(claims, contract, request, authorizer) {
    const authorization = await this.authorize(claims, contract, request, authorizer);
    if (authorization.identity_id !== claims.sub) throw new AdapterDenied(403, 'TORNEOS_RESOURCE_FORBIDDEN');
    const response = await this.client.call(ROUTES[contract], {
      core_user_id: claims.core_user_id, session_id: claims.session_id, ...authorization.core_request,
    });
    const observed = response.checked_at ?? response.captured_at ?? Math.floor(Date.now() / 1000);
    await this.attest(claims, contract, authorization.request_hash, response, observed);
    return authorization;
  }
}

export { Denied };
