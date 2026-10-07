// COMMERCE-PRODUCTION lab fixtures: identities, organizations, seasons and the three kinds of database sessions the
// production checkout meets in real life:
//   • asUser(actor, sql)   PostgREST emulated exactly like the certified MP-A helpers: SET LOCAL ROLE authenticated +
//                          request.jwt.claims of the bridge token (private.current_identity_id() validates them);
//   • paymentsDb(kind)     the real payment LOGIN over TCP (session_user = the login), one transaction per call with
//                          SET LOCAL ROLE <service role> — the shape of torneos-payments(-production)/db.ts;
//   • admin (sql)          the installer, for fixtures and inspection only.
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { LOGINS, loginUrl, sql, sqlTry } from './pg-lab.mjs';

export const RUN = `cp${randomBytes(3).toString('hex')}`;
export const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
export const j = (s) => JSON.parse(String(s).trim().split('\n').filter(Boolean).pop());
export const admin = (q) => sql(q);

function claimsOf(actor) {
  const now = Math.floor(Date.now() / 1000);
  return { role: 'authenticated', iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', sub: actor.id, core_user_id: actor.core,
    session_id: randomUUID(), jti: randomUUID(), iat: now, nbf: now, exp: now + 120 };
}

/** Runs one statement as an authenticated identity; returns its last output line. Throws the SQL error text. */
export function asUser(actor, query) {
  const r = sqlTry(`\\set VERBOSITY verbose\nBEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claimsOf(actor)))}, true); ${query}; COMMIT;`);
  if (!r.ok) throw new Error(r.error || 'sql failed');
  return r.out.trim().split('\n').pop();
}
export const asUserJson = (actor, query) => j(asUser(actor, query));
/** The SQL error token of a statement that must fail as this identity. */
export function refusal(actor, query) {
  try { asUser(actor, query); } catch (error) { return /TORNEOS_[A-Z_]+|permission denied[^\n]*/.exec(error.message)?.[0] ?? error.message; }
  return null;
}

export function identity(label) {
  const actor = { label, id: randomUUID(), core: randomUUID() };
  admin(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(actor.id)}, ${lit(actor.core)}); RESET ROLE;`);
  return actor;
}

export function organization(owner, label = 'org') {
  return asUserJson(owner, `select public.create_tournament_organization(${lit(`Lab ${label} ${RUN}`)}, ${lit(`lab-${label}-${RUN}-${randomBytes(2).toString('hex')}`)}, ${lit(randomUUID())})`).organization.id;
}
export function season(owner, org, label = 'season') {
  return asUserJson(owner, `select public.create_tournament_season(${lit(org)}, ${lit(`Temporada ${label} ${RUN}`)}, ${lit(`t-${label}-${RUN}-${randomBytes(2).toString('hex')}`)}, null, null, ${lit(randomUUID())})`).id;
}
/** An active member of the organization (role admin | collaborator), assigned to the given seasons. */
export function member(org, role, seasons = []) {
  const actor = identity(role);
  const membership = admin(`INSERT INTO public.tournament_organization_members (organization_id, user_id, role, status, joined_at)
    VALUES (${lit(org)}, ${lit(actor.id)}, ${lit(role)}, 'active', now()) RETURNING id`).trim();
  for (const s of seasons) assign(org, s, membership);
  return { ...actor, membership };
}
export function assign(org, s, membership) {
  return admin(`INSERT INTO public.tournament_season_member_assignments (organization_id, season_id, membership_id)
    VALUES (${lit(org)}, ${lit(s)}, ${lit(membership)}) RETURNING id`).trim();
}

/** A fresh organization + owner + season (one purchase per season). */
export function world(label = 'w') {
  const owner = identity(`owner-${label}`);
  const org = organization(owner, label);
  const s = season(owner, org, label);
  return { owner, org, season: s };
}

export function setScope(scope, reason = `Laboratorio ${scope} ${RUN}`) {
  admin(`UPDATE public.tournament_commerce_production_settings SET checkout_scope = ${lit(scope)}, reason = ${lit(reason)}, updated_at = now()`);
}
export function allow(org) {
  admin(`INSERT INTO public.tournament_commerce_production_allowlist (organization_id, reason) VALUES (${lit(org)}, ${lit(`Primer cobro ${RUN}`)}) ON CONFLICT DO NOTHING`);
}

export const checkout = (actor, w, key = randomUUID()) => asUserJson(actor,
  `select public.create_tournament_season_production_checkout_purchase(${lit(w.org)}, ${lit(w.season)}, ${lit(key)})`);
export const testCheckout = (actor, w, key = randomUUID()) => asUserJson(actor,
  `select public.create_tournament_season_checkout_purchase(${lit(w.org)}, ${lit(w.season)}, ${lit(key)})`);

export const purchaseRow = (id) => j(admin(`select to_jsonb(x) from public.tournament_purchases x where id = ${lit(id)}`));
export const eventTypes = (id) => j(admin(`select coalesce(json_agg(event_type order by id), '[]') from public.tournament_purchase_events where purchase_id = ${lit(id)}`));
export const grantEvents = (id) => j(admin(`select coalesce(json_agg(e.event_type order by e.id), '[]') from public.tournament_season_plan_grant_events e
  join public.tournament_season_plan_grants g on g.id = e.season_grant_id where g.origin_purchase_id = ${lit(id)}`));
/** The season plan as the server resolves it (FREE | PREMIUM), read as the installer. */
export const planOf = (org, s) => j(admin(`select to_jsonb(public.resolve_effective_tournament_season_entitlements_at(${lit(org)}, ${lit(s)}, now(), false, null))`)).plan;
export const entitlementsOf = (org, s) => j(admin(`select to_jsonb(public.resolve_effective_tournament_season_entitlements_at(${lit(org)}, ${lit(s)}, now(), false, null))`));

/**
 * A payments database session exactly like torneos-payments(-production)/db.ts: the login (session_user) connects, every call is
 * one transaction with SET LOCAL ROLE of the service role and a statement timeout, then one function call.
 */
export function paymentsDb(kind) {
  const { role } = LOGINS[kind];
  const pool = new pg.Pool({ connectionString: loginUrl(kind), max: 2 });
  return {
    async call(fn, args = []) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query('SET LOCAL statement_timeout = 3000');
        const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
        const { rows } = await client.query(`SELECT ${fn}(${placeholders}) AS result`, args);
        await client.query('COMMIT');
        return rows[0]?.result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    /** Raw statement in the login's own session (no SET ROLE): what a compromised runtime could try. */
    async raw(text, args = []) {
      const client = await pool.connect();
      try { return (await client.query(text, args)).rows; } finally { client.release(); }
    },
    end: () => pool.end(),
  };
}
export async function refusedBy(promise) {
  try { await promise; } catch (error) { return /TORNEOS_[A-Z_]+|permission denied[^\n]*/.exec(error.message)?.[0] ?? error.message; }
  return null;
}

/** Moves a purchase back in time (fixtures only; the snapshot trigger would otherwise stamp updated_at = now()). */
export function age(id, { createdMinutes = 0, updatedMinutes = 0, expiresMinutes = null } = {}) {
  admin(`SET session_replication_role = replica;
    UPDATE public.tournament_purchases SET
      created_at = created_at - make_interval(mins => ${Number(createdMinutes)}),
      updated_at = now() - make_interval(mins => ${Number(updatedMinutes)})
      ${expiresMinutes === null ? '' : `, preference_expires_at = now() - make_interval(mins => ${Number(expiresMinutes)})`}
    WHERE id = ${lit(id)};
    SET session_replication_role = origin;`);
}
