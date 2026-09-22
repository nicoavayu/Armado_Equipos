// R4.2 local fixtures for the P0 (review_tournament_team_entry), built the way Phase 2D certified
// them: through the allowlisted RPCs (here: through the REAL gateway with REAL Core sessions), plus
// the two seeded rows that have no RPC (organization memberships). Everything is tagged by run and
// removed by cleanupFixtures(), which is verified by exact per-table row counts against the baseline
// taken before the run. Nothing here touches the catalog.
//
// Every resource is journaled in a run registry IMMEDIATELY after its creating call succeeds, so the
// cleanup scope never depends on buildFixtures() returning: R4.2 20260918T224221Z aborted mid-way
// (FIXTURE_RPC_FAILED), the aggregate F stayed null, cleanup ran with orgs = [] → 0 deletes → count
// mismatch → rollback, and 98 rows / 21 tables were left behind.
import crypto from 'node:crypto';
import {psql, psqlTry, sqlOne, lit, tableCounts, Stop, registerSecret} from './lib.mjs';

/**
 * Incremental journal of the run's resources: {kind, id, ...meta, at}. `record()` is called right after each
 * successful creation (never before, never batched at the end). Cleanup reads `orgs` from here.
 */
export function createRunRegistry(RUN) {
  if (typeof RUN !== 'string' || !RUN) throw new Stop('REGISTRY_RUN_REQUIRED');
  const entries = [];
  const registry = {
    RUN, entries,
    record(kind, id, meta = {}) {
      if (typeof kind !== 'string' || !kind) throw new Stop('REGISTRY_KIND_REQUIRED');
      if (id === undefined || id === null || id === '') throw new Stop('REGISTRY_ID_MISSING', kind);
      entries.push({kind, id: String(id), ...meta, at: new Date().toISOString()});
      return id;
    },
    ids(kind) { return [...new Set(entries.filter((e) => e.kind === kind).map((e) => e.id))]; },
    get orgs() { return registry.ids('organization'); },
    counts() { const out = {}; for (const e of entries) out[e.kind] = (out[e.kind] ?? 0) + 1; return out; },
    snapshot() { return entries.map((e) => ({...e})); },
  };
  return registry;
}

export const PLAYERS = [['Arquero Uno', 1, 'ARQ', true], ['Defensor Dos', 2, 'DEF', false], ['Volante Tres', 3, 'MED', false], ['Delantero Cuatro', 4, 'DEL', false], ['Defensor Cinco', 5, 'DEF', false]];
export const ENTRY_NAMES = {matrix: 'Matrix FC', approve: 'Approve FC', changes: 'Changes FC', reject: 'Reject FC', invalid: 'Invalid FC', admin: 'Admin Seat FC', bravo: 'Bravo FC'};

/**
 * @param rpc      async (name, actor, params) → {status, body}; must throw on non-200 (caller decides)
 * @param actors   {owner, admin, member, outsider, captain} with .identity (local id) and .email (Core)
 * @param RUN      short run tag for slugs/names
 * @param accept   async (invitationToken) → {status, body}: live acceptance as captain (verified_email contract)
 */
/**
 * @param registry createRunRegistry(RUN): every created resource is recorded here the moment its call returns 200
 */
export async function buildFixtures({rpc, actors, RUN, accept, exercised, registry}) {
  if (!registry || typeof registry.record !== 'function' || registry.RUN !== RUN) throw new Stop('FIXTURE_REGISTRY_REQUIRED');
  const {owner, admin, member, outsider} = actors;
  const ok = async (name, params, who = owner) => {
    const r = await rpc(name, who, params);
    if (r.status !== 200) throw new Stop('FIXTURE_RPC_FAILED', `${name} ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    exercised?.add(name);
    return r.body;
  };
  const rec = (kind, id, meta) => registry.record(kind, id, meta);
  const F = {RUN, entries: {}, acceptance: []};
  F.org = rec('organization', (await ok('create_tournament_organization', {p_name: `R42 League ${RUN}`, p_slug: `r42-league-${RUN}`, p_idempotency_key: crypto.randomUUID()})).organization.id, {slug: `r42-league-${RUN}`});
  F.org2 = rec('organization', (await ok('create_tournament_organization', {p_name: `R42 Other ${RUN}`, p_slug: `r42-other-${RUN}`, p_idempotency_key: crypto.randomUUID()}, outsider)).organization.id, {slug: `r42-other-${RUN}`});
  F.seasonA = rec('season', (await ok('create_tournament_season', {p_organization_id: F.org, p_name: 'Season Alpha', p_slug: `alpha-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID()})).id, {org: F.org});
  F.seasonB = rec('season', (await ok('create_tournament_season', {p_organization_id: F.org, p_name: 'Season Bravo', p_slug: `bravo-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID()})).id, {org: F.org});
  const mkTournament = async (season, slug) => {
    const tnt = await ok('create_tournament_with_defaults', {p_organization_id: F.org, p_season_id: season, p_name: `Copa ${slug} ${RUN}`, p_slug: `${slug}-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID()});
    rec('tournament', tnt.id, {org: F.org, season});
    const cat = await ok('save_tournament_category', {p_organization_id: F.org, p_tournament_id: tnt.id, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active'});
    rec('category', cat.id, {org: F.org, tournament: tnt.id});
    const st = await ok('change_tournament_status', {p_organization_id: F.org, p_tournament_id: tnt.id, p_status: 'registration'});
    if (st.status !== 'registration') throw new Stop('FIXTURE_TOURNAMENT_STATUS', JSON.stringify(st).slice(0, 200));
    return [tnt.id, cat.id];
  };
  [F.tournamentA, F.categoryA] = await mkTournament(F.seasonA, 'alpha');
  [F.tournamentB, F.categoryB] = await mkTournament(F.seasonB, 'bravo');
  // Memberships have no RPC (table under RLS): seeded as in Phase 2D. The season seat is the RPC.
  for (const a of [admin, member]) { psql(`insert into public.tournament_organization_members(organization_id,user_id,role,joined_at) values (${lit(F.org)},${lit(a.identity)},'admin',now());`); rec('membership_seed', `${F.org}/${a.identity}`, {org: F.org, identity: a.identity}); }
  const membership = (a) => sqlOne(`select id from public.tournament_organization_members where organization_id=${lit(F.org)} and user_id=${lit(a.identity)}`);
  F.membershipAdmin = membership(admin); F.membershipMember = membership(member);
  await ok('assign_tournament_season_member', {p_organization_id: F.org, p_season_id: F.seasonA, p_membership_id: F.membershipAdmin});
  rec('season_assignment', `${F.seasonA}/${F.membershipAdmin}`, {org: F.org, season: F.seasonA});
  const seats = await ok('list_tournament_season_member_assignments', {p_organization_id: F.org, p_season_id: F.seasonA});
  const seatText = JSON.stringify(seats);
  if (!seatText.includes(F.membershipAdmin) || seatText.includes(F.membershipMember)) throw new Stop('FIXTURE_SEATS', 'season A seat must hold admin only');
  const state = sqlOne(`select organization.status || ',' || t.status || ',' || c.status from public.tournament_organizations organization join public.tournaments t on t.organization_id = organization.id join public.tournament_categories c on c.tournament_id = t.id where t.id = ${lit(F.tournamentA)}`);
  if (state !== 'active,registration,active') throw new Stop('FIXTURE_STATE', state);

  async function submittedEntry(tournament, category, name) {
    const created = await ok('create_tournament_team_entry', {p_organization_id: F.org, p_tournament_id: tournament, p_category_id: category, p_arma2_team_id: null, p_name: `${name} ${RUN}`, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: crypto.randomUUID()});
    const entry = created.entryId, roster = created.rosterId;
    rec('team_entry', entry, {org: F.org, tournament}); rec('roster', roster, {org: F.org, entry});
    if (created.status !== 'draft') throw new Stop('FIXTURE_ENTRY_STATUS', created.status);
    const upd = await ok('update_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: entry, p_patch: {shortName: name.slice(0, 3).toUpperCase()}});
    if (upd.status !== 'in_progress') throw new Stop('FIXTURE_ENTRY_STATUS', upd.status);
    for (const [display, shirt, position, gk] of PLAYERS) {
      const prov = await ok('create_tournament_provisional_player', {p_organization_id: F.org, p_team_entry_id: entry, p_display_name: `${display} ${RUN}`});
      rec('provisional_player', prov.id, {org: F.org, entry});
      const added = await ok('add_tournament_roster_player', {p_organization_id: F.org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: null, p_provisional_player_id: prov.id, p_display_name: `${display} ${RUN}`, p_avatar_url: null, p_shirt_number: shirt, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: gk});
      rec('roster_player', added.id ?? `${roster}/${shirt}`, {org: F.org, entry, roster});
      if (added.status !== 'active') throw new Stop('FIXTURE_PLAYER_STATUS', added.status);
    }
    const invite = await ok('invite_tournament_team_manager', {p_organization_id: F.org, p_team_entry_id: entry, p_email: actors.captain.email, p_display_name: 'Captain', p_role: 'captain'});
    registerSecret(invite.token);
    rec('manager_invitation', invite.managerId ?? invite.id ?? `${entry}/captain`, {org: F.org, entry});
    // Live: the captain accepts through the gateway → Core verified_email contract → attestation → RPC.
    let accepted = null;
    if (accept) {
      const r = await accept(invite.token);
      accepted = {status: r.status, live: r.status === 200, code: r.body?.code ?? r.body?.error ?? null};
      if (r.status === 200) { exercised?.add('accept_tournament_team_invitation'); rec('acceptance_attestation', `${entry}/${actors.captain.identity}`, {org: F.org, entry, identity: actors.captain.identity}); }
    }
    if (!accepted?.live) {
      // Same seeded state Phase 2D used when the contract is not exercised.
      psql(`update public.tournament_team_managers set user_id=${lit(actors.captain.identity)}, status='active', accepted_at=now() where team_entry_id=${lit(entry)} and status='pending'`);
    }
    F.acceptance.push({entry: name, ...(accepted ?? {live: false, seeded: true}), seeded: !accepted?.live});
    const submitted = await ok('submit_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: entry});
    if (submitted.status !== 'submitted' || submitted.validation?.valid !== true) throw new Stop('FIXTURE_SUBMIT', JSON.stringify(submitted).slice(0, 300));
    const counts = submitted.validation.counts ?? {};
    if (!(counts.players === 5 && counts.goalkeepers === 1 && counts.minimumPlayers === 5 && counts.maximumPlayers === 8)) throw new Stop('FIXTURE_COUNTS', JSON.stringify(counts));
    return {entry, roster};
  }
  for (const [key, name] of Object.entries(ENTRY_NAMES)) {
    const tournament = key === 'bravo' ? F.tournamentB : F.tournamentA;
    const category = key === 'bravo' ? F.categoryB : F.categoryA;
    F.entries[key] = await submittedEntry(tournament, category, name);
  }
  const settings = sqlOne(`select minimum_players||','||maximum_players||','||minimum_goalkeepers||','||unique_shirt_numbers||','||require_individual_player_approval from public.tournament_roster_settings where tournament_id=${lit(F.tournamentA)}`);
  if (settings !== '5,8,1,true,false') throw new Stop('FIXTURE_ROSTER_SETTINGS', settings);
  return F;
}

// ─────────────────────────────── state readers (Phase 2D shape) ───────────────────────────────
export function entryState(entryId) {
  return JSON.parse(psql(`select json_build_object(
    'entry', (select json_build_object('status', e.status, 'reviewed_by', e.reviewed_by, 'reviewed_at', e.reviewed_at, 'approved_at', e.approved_at, 'rejected_at', e.rejected_at) from public.tournament_team_entries e where e.id = ${lit(entryId)}),
    'rosters', (select json_agg(json_build_object('id', r.id, 'version', r.version, 'status', r.status, 'approved_at', r.approved_at) order by r.version) from public.tournament_rosters r where r.team_entry_id = ${lit(entryId)}),
    'players', (select json_agg(json_build_object('shirt', p.shirt_number, 'status', p.status, 'eligibility', p.eligibility_status) order by p.shirt_number) from public.tournament_roster_players p where p.team_entry_id = ${lit(entryId)}),
    'reviews', (select count(*) from public.tournament_team_reviews v where v.team_entry_id = ${lit(entryId)}),
    'audit', (select count(*) from public.tournament_audit_log a where a.team_entry_id = ${lit(entryId)} and a.action in ('team_entry.approved','team_entry.rejected','team_entry.changes_requested'))
  )`));
}
export function lastReview(entryId) {
  return JSON.parse(psql(`select coalesce((select json_build_object('decision', v.decision, 'reason', v.reason, 'issues', v.issues, 'created_by', v.created_by, 'roster_id', v.roster_id, 'organization_id', v.organization_id) from public.tournament_team_reviews v where v.team_entry_id = ${lit(entryId)} order by v.created_at desc limit 1), 'null'::json)`));
}
export function lastAudit(entryId) {
  return JSON.parse(psql(`select coalesce((select json_build_object('action', a.action, 'resource_type', a.resource_type, 'resource_id', a.resource_id, 'team_entry_id', a.team_entry_id, 'tournament_id', a.tournament_id, 'actor_user_id', a.actor_user_id, 'actor_type', a.actor_type, 'metadata', a.metadata) from public.tournament_audit_log a where a.team_entry_id = ${lit(entryId)} and a.action in ('team_entry.approved','team_entry.rejected','team_entry.changes_requested') order by a.id desc limit 1), 'null'::json)`));
}

// ─────────────────────────────── cleanup ───────────────────────────────
/** Columns of every public/private table, to choose a run-scoped predicate per table. */
export function tableColumns() {
  const out = psql(`SELECT n.nspname||'.'||c.relname||'|'||string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE c.relkind='r' AND n.nspname IN ('public','private') GROUP BY n.nspname, c.relname ORDER BY 1;`);
  const cols = {};
  for (const line of out.trim().split('\n').filter(Boolean)) { const [name, list] = line.split('|'); cols[name] = list.split(','); }
  return cols;
}
const inList = (values) => values.length ? values.map(lit).join(',') : 'NULL';
/** Pure: the DELETE statement for one table, or null when no run-scoped predicate exists. */
export function deletePlan(table, columns, {orgs, identities, coreUserIds}) {
  const has = (c) => columns.includes(c);
  const [schema, name] = table.split('.');
  const target = `${schema}.${name}`;
  if (table === 'public.tournament_organizations') return `DELETE FROM ${target} WHERE id IN (${inList(orgs)})`;
  if (table === 'public.torneos_identity') return `DELETE FROM ${target} WHERE core_user_id IN (${inList(coreUserIds)})`;
  if (has('organization_id')) return `DELETE FROM ${target} WHERE organization_id IN (${inList(orgs)})`;
  if (has('identity_id')) return `DELETE FROM ${target} WHERE identity_id IN (${inList(identities)})`;
  if (has('user_id')) return `DELETE FROM ${target} WHERE user_id IN (${inList(identities)})`;
  if (has('actor_user_id')) return `DELETE FROM ${target} WHERE actor_user_id IN (${inList(identities)})`;
  if (has('created_by')) return `DELETE FROM ${target} WHERE created_by IN (${inList(identities)})`;
  return null;
}
/** Organizations whose slug carries this run's tag: the on-disk truth for a creation whose response was lost. */
export function orgsBySlug(RUN) {
  if (typeof RUN !== 'string' || RUN.length < 4) throw new Stop('CLEANUP_RUN_TAG_REQUIRED');
  return psql(`select id from public.tournament_organizations where slug in (${lit(`r42-league-${RUN}`)}, ${lit(`r42-other-${RUN}`)}) order by created_at`).trim().split('\n').filter(Boolean);
}
/**
 * Removes every row this run created, in one transaction with session_replication_role=replica
 * (append-only audit triggers and FK cascades are bypassed because every touched table is deleted
 * explicitly), then verifies every table is back at its baseline count BEFORE committing.
 * `orgs` comes from the run registry (recorded per creation), never from the fixture aggregate; with
 * `RUN` the organizations tagged by slug are merged in, so an org whose creating response never reached
 * the harness is still in scope. The count verification refuses any scope that is too wide or too narrow.
 */
export function cleanupFixtures({baseline, orgs, identities, coreUserIds, RUN}) {
  const discovered = RUN ? orgsBySlug(RUN) : [];
  const scopeOrgs = [...new Set([...(orgs ?? []), ...discovered])];
  const before = tableCounts();
  const columns = tableColumns();
  const delta = Object.keys(before).filter((t) => before[t] !== (baseline[t] ?? 0));
  const plan = [], unplanned = [];
  for (const table of delta) { const stmt = deletePlan(table, columns[table] ?? [], {orgs: scopeOrgs, identities, coreUserIds}); if (stmt) plan.push({table, stmt}); else unplanned.push(table); }
  const scope = {orgs: scopeOrgs, discoveredOrgs: discovered, identities: identities?.length ?? 0, coreUserIds: coreUserIds?.length ?? 0};
  if (unplanned.length) return {ok: false, reason: 'UNPLANNED_TABLES', unplanned, delta, before, executed: false, scope};
  if (!plan.length) return {ok: true, delta: [], executed: false, after: before, scope};
  const verify = Object.entries(baseline).map(([t, n]) => `SELECT CASE WHEN (SELECT count(*) FROM ${t}) = ${n} THEN NULL ELSE ${lit(t)} END`).join(' UNION ALL ');
  const sql = `BEGIN; SET LOCAL session_replication_role = replica; ${plan.map((p) => p.stmt + ';').join(' ')}
    DO $$ DECLARE bad text; BEGIN SELECT string_agg(t, ',') INTO bad FROM (${verify}) v(t) WHERE t IS NOT NULL; IF bad IS NOT NULL THEN RAISE EXCEPTION 'R42_CLEANUP_COUNT_MISMATCH: %', bad; END IF; END $$;
    COMMIT;`;
  const r = psqlTry(sql);
  const after = tableCounts();
  const mismatches = Object.keys(after).filter((t) => after[t] !== (baseline[t] ?? 0));
  return {ok: r.ok && mismatches.length === 0, executed: true, error: r.error, delta, planned: plan.map((p) => p.table), mismatches, after, scope};
}
