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

export const CONTRACTS = {
  accept_tournament_team_invitation: {
    contract: 'verified_email',
    request: (b) => ({ token: b.p_token }),
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
};

export class AdapterDenied extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function mapSqlError(error) {
  const message = String(error?.message ?? '');
  if (/^TORNEOS_[A-Z_]+$/.test(message)) {
    if (message === 'TORNEOS_SEARCH_RATE_LIMITED') return new AdapterDenied(429, message);
    if (error.code === '22023') return new AdapterDenied(400, message);
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

  async authorize(claims, contract, request) {
    try {
      const { rows } = await this._asAdapter(claims, (c) =>
        c.query('SELECT private.authorize_core_contract($1, $2::jsonb) AS authorization', [contract, JSON.stringify(request)]));
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
  async prepare(claims, contract, request) {
    const authorization = await this.authorize(claims, contract, request);
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
