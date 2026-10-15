// ACCOUNT ERASURE 0021 — shared support of the lab suites: the erasure as the gateway runs it, digests, evidence.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { gatewayLoginUrl, lab, WITH_0020 } from './lab.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_DIR = path.join(HERE, '../evidence');
const EVIDENCE = process.env.ACCOUNT_DELETION_EVIDENCE === '1';

/** One JSON line per named check, into evidence/<file>.jsonl (only with ACCOUNT_DELETION_EVIDENCE=1). */
export function evidence(file) {
  const target = path.join(EVIDENCE_DIR, `${file}${WITH_0020 ? '-with-0020' : ''}.jsonl`);
  if (EVIDENCE) { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(target, ''); }
  return (entry) => { if (EVIDENCE) fs.appendFileSync(target, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); };
}

/** The erasure exactly as the gateway runs it: the core-adapter login, SET LOCAL ROLE torneos_core_adapter, one call. */
export function adapterDb() {
  const pool = new pg.Pool({ connectionString: gatewayLoginUrl('coreAdapter'), max: 3 });
  return {
    async erase(core, requestId = randomUUID()) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE torneos_core_adapter');
        await client.query('SET LOCAL statement_timeout = 15000');
        const { rows } = await client.query('SELECT private.erase_tournament_account($1::uuid, $2::uuid) AS result', [core, requestId]);
        await client.query('COMMIT');
        return rows[0].result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    end: () => pool.end(),
  };
}

/** Runs one statement as a role (PostgREST-like), returns the error message or null. */
export async function refusalAs(pool, role, text, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(text, params);
    await client.query('ROLLBACK');
    return null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return error.message;
  } finally { client.release(); }
}

// Every table the erasure can write, digested whole (row text, ordered): equal digests = nothing moved anywhere.
export const TOUCHABLE = Object.freeze(['public.torneos_identity', 'public.tournament_user_profiles', 'public.tournament_user_notifications',
  'public.tournament_notification_preferences', 'public.tournament_participant_hub_preferences', 'public.user_tournament_context_preferences',
  'public.user_workspace_preferences', 'public.tournament_organization_members', 'public.tournament_organizations', 'public.tournament_public_pages',
  'public.tournament_catalog_listings', 'public.tournament_season_member_assignments', 'public.tournament_team_managers', 'public.tournament_team_invitations',
  'public.tournament_organization_invitations', 'public.tournament_provisional_players', 'public.tournament_roster_players',
  'public.tournament_match_squad_players', 'public.tournament_match_operation_players', 'public.tournament_match_availability_responses',
  'public.tournament_team_applications', 'private.tournament_team_entry_core_snapshots', 'private.core_contract_attestations',
  'public.tournament_media_consents', 'public.tournament_media_relations', 'public.tournament_media_assignments', 'public.tournament_media_upload_sessions',
  'public.tournament_player_portraits', 'public.tournament_audit_log', 'public.tournament_purchases', 'public.tournament_purchase_events',
  'public.tournament_season_plan_grants', 'public.tournament_announcements', 'public.tournament_announcement_deliveries',
  'public.tournament_document_acknowledgements', 'public.tournament_match_events', 'public.tournament_match_scores', 'public.tournament_player_statistics',
  'public.tournament_team_standings', 'public.tournament_discipline_ledgers']);

export async function digests(pool, tables = TOUCHABLE, extra = []) {
  const list = [...tables, ...extra.filter(Boolean), ...(WITH_0020 && tables === TOUCHABLE ? ['public.tournament_organization_sponsors'] : [])];
  const parts = list.map((t) => `select '${t}' as t, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as d from ${t} x`);
  const { rows } = await pool.query(parts.join(' union all '));
  return Object.fromEntries(rows.map((r) => [r.t, r.d]));
}
export function changedTables(a, b) { return Object.keys(a).filter((k) => a[k] !== b[k]).sort(); }

/** The anonymous public page, as the public route serves it (anon role). */
export async function publicPage(pool, slug) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE anon');
    const { rows } = await client.query('SELECT public.get_public_tournament_page($1, null) AS page', [slug]);
    await client.query('ROLLBACK');
    return rows[0].page;
  } finally { client.release(); }
}
/** The page with every person-name field blanked (and person lists re-sorted, since the name is their last sort key):
 *  what must stay numerically identical. */
export function withoutNames(page) {
  const person = (v) => v && typeof v === 'object' && !Array.isArray(v) && ('goals' in v || 'yellowCards' in v);
  return JSON.parse(JSON.stringify(page), function reviver(key, value) {
    if (key === 'name' && person(this)) return '·';
    if (Array.isArray(value) && value.length && value.every(person)) return [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return value;
  });
}
export { lab };
