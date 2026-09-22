// R5 owner journey on the Torneos side: the sequence of staging-v1 RPCs a real organizer, a
// collaborator (seated admin) and an invited captain run, expressed over an rpc(name, actor, params)
// function so the SAME flow runs live (through the certified gateway with real Core staging sessions)
// and in the LOCAL rehearsal (direct PostgREST on R2 with seeded attestations). Only allowlisted RPC
// names are dispatched (FLOW_RPCS is unit-tested against the allowlist and the gate). Every created
// resource is journaled in the run registry the moment its creating call returns; cleanup scopes by
// the registry (r42/fixtures.mjs), never by the aggregate. Organization memberships have no RPC in
// staging v1 (Phase 2D contract): the collaborator seat is seeded, the season assignment is the RPC.
import crypto from 'node:crypto';
import {psql, sqlOne, lit, registerSecret, Stop} from '../r42/lib.mjs';

export const FLOW_RPCS = ['is_tournament_organization_slug_available', 'create_tournament_organization', 'get_tournament_workspace_context', 'set_tournament_workspace_preference',
  'update_tournament_organization', 'is_tournament_organization_member', 'has_tournament_organization_capability', 'tournament_role_capabilities', 'get_my_tournament_memberships',
  'create_tournament_season', 'update_tournament_season', 'set_active_tournament_context',
  'get_tournament_creation_eligibility', 'create_tournament_with_defaults', 'save_tournament_category', 'change_tournament_status', 'update_tournament_configuration',
  'get_tournament_competition_context', 'has_organization_consumed_free_tournament', 'has_tournament_capability',
  'assign_tournament_season_member', 'list_tournament_season_member_assignments', 'has_tournament_season_access', 'has_tournament_season_capability', 'get_tournament_teams_context', 'remove_tournament_season_member_assignment',
  'create_tournament_team_entry', 'update_tournament_team_entry', 'get_team_registration_context', 'can_read_tournament_team_entry', 'withdraw_tournament_team_entry',
  'create_tournament_provisional_player', 'add_tournament_roster_player', 'update_tournament_roster_player', 'remove_tournament_roster_player', 'search_tournament_players',
  'invite_tournament_team_manager', 'accept_tournament_team_invitation', 'is_tournament_team_manager', 'submit_tournament_team_entry',
  'search_tournament_arma2_teams', 'review_tournament_team_entry'];

export const PLAYERS = [['Arquera Uno', 1, 'ARQ', true], ['Defensora Dos', 2, 'DEF', false], ['Volante Tres', 3, 'MED', false], ['Delantera Cuatro', 4, 'DEL', false]];
export const P0 = 'review_tournament_team_entry';
export const slugs = (RUN) => ({league: `r5-league-${RUN}`, other: `r5-other-${RUN}`});
export const assert = (ok, detail) => { if (!ok) throw new Error('ASSERT ' + JSON.stringify(detail ?? null).slice(0, 600)); };
export const eq = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), {label, actual: a, expected: b});
const text = (v) => JSON.stringify(v ?? null);

/** Read-only state of one team entry (Phase 2D shape), used before/after every P0 decision. */
export function entryState(entryId) {
  return JSON.parse(psql(`select json_build_object(
    'entry', (select json_build_object('status', e.status, 'name', e.name, 'registration_source', e.registration_source, 'arma2_team_id', e.arma2_team_id, 'reviewed_by', e.reviewed_by, 'approved_at', e.approved_at is not null, 'rejected_at', e.rejected_at is not null) from public.tournament_team_entries e where e.id = ${lit(entryId)}),
    'rosters', (select json_agg(json_build_object('version', r.version, 'status', r.status) order by r.version) from public.tournament_rosters r where r.team_entry_id = ${lit(entryId)}),
    'players', (select json_agg(json_build_object('shirt', p.shirt_number, 'status', p.status, 'eligibility', p.eligibility_status, 'account', p.arma2_user_id) order by p.shirt_number) from public.tournament_roster_players p where p.team_entry_id = ${lit(entryId)} and p.status = 'active'),
    'managers', (select json_agg(json_build_object('role', m.role, 'status', m.status, 'user', m.user_id) order by m.created_at) from public.tournament_team_managers m where m.team_entry_id = ${lit(entryId)}),
    'reviews', (select count(*) from public.tournament_team_reviews v where v.team_entry_id = ${lit(entryId)}),
    'audit', (select count(*) from public.tournament_audit_log a where a.team_entry_id = ${lit(entryId)}))`));
}
export function lastAudit(entryId) {
  return JSON.parse(psql(`select coalesce((select json_build_object('action', a.action, 'actor_user_id', a.actor_user_id, 'actor_type', a.actor_type, 'metadata', a.metadata) from public.tournament_audit_log a where a.team_entry_id = ${lit(entryId)} order by a.id desc limit 1), 'null'::json)`));
}
export const countRows = (table, where) => Number(sqlOne(`select count(*) from ${table} where ${where}`));

/**
 * @param rpc      async (name, actor, params) → {status, body}; the flow decides what a non-200 means
 * @param actors   {owner, admin, captain, outsider} each with .identity (Torneos shadow id) and .email (Core)
 * @param RUN      run tag (slugs/names), registry createRunRegistry(RUN), exercised Set of RPC names that returned 200
 */
export function createFlow({rpc, actors, RUN, registry, exercised = new Set()}) {
  if (!registry || typeof registry.record !== 'function' || registry.RUN !== RUN) throw new Stop('FLOW_REGISTRY_REQUIRED');
  const {owner, admin, captain, outsider} = actors;
  const S = slugs(RUN);
  const F = {RUN, entries: {}, acceptance: []};
  const rec = (kind, id, meta) => registry.record(kind, id, meta);
  const call = async (name, who, params) => {
    if (!FLOW_RPCS.includes(name)) throw new Stop('FLOW_RPC_NOT_PLANNED', name);
    const r = await rpc(name, who, params);
    if (r.status === 200) exercised.add(name);
    return r;
  };
  const ok = async (name, params, who = owner) => {
    const r = await call(name, who, params);
    if (r.status !== 200) throw new Stop('FLOW_RPC_FAILED', `${name} (${who.role}) ${r.status} ${text(r.body).slice(0, 300)}`);
    return r.body;
  };
  const refused = async (name, who, params, status, message) => {
    const r = await call(name, who, params);
    assert(r.status === status && (message === undefined || r.body?.message === message || r.body?.error === message), {name, who: who.role, status: r.status, body: r.body, want: [status, message]});
    return r;
  };
  const mkTournament = async (org, season, slug, who = owner) => {
    const t = await ok('create_tournament_with_defaults', {p_organization_id: org, p_season_id: season, p_name: `Copa ${slug} ${RUN}`, p_slug: `${slug}-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID()}, who);
    rec('tournament', t.id, {org, season});
    const c = await ok('save_tournament_category', {p_organization_id: org, p_tournament_id: t.id, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active'}, who);
    rec('category', c.id, {org, tournament: t.id});
    const st = await ok('change_tournament_status', {p_organization_id: org, p_tournament_id: t.id, p_status: 'registration'}, who);
    eq(st.status, 'registration', 'tournament open for registration');
    return [t.id, c.id];
  };
  const entryArgs = (org, tournament, category, name, extra = {}) => ({p_organization_id: org, p_tournament_id: tournament, p_category_id: category, p_arma2_team_id: null, p_name: name, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: crypto.randomUUID(), ...extra});
  const provisional = async (entry, roster, display, shirt, position, gk) => {
    const p = await ok('create_tournament_provisional_player', {p_organization_id: F.org, p_team_entry_id: entry, p_display_name: `${display} ${RUN}`});
    rec('provisional_player', p.id, {org: F.org, entry});
    const a = await ok('add_tournament_roster_player', {p_organization_id: F.org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: null, p_provisional_player_id: p.id, p_display_name: `${display} ${RUN}`, p_avatar_url: null, p_shirt_number: shirt, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: gk});
    rec('roster_player', a.id, {org: F.org, entry, roster});
    eq(a.status, 'active', 'roster player active');
    return a.id;
  };
  const playerId = (entry, shirt) => sqlOne(`select id from public.tournament_roster_players where team_entry_id=${lit(entry)} and shirt_number=${shirt} and status='active'`);
  /** invite the captain (Core email) and let them accept: live = gateway → Core verified_email contract → attestation → RPC. */
  const inviteAndAccept = async (entry) => {
    const inv = await ok('invite_tournament_team_manager', {p_organization_id: F.org, p_team_entry_id: entry, p_email: captain.email, p_display_name: 'Capitana', p_role: 'captain'});
    registerSecret(inv.token);
    rec('manager_invitation', inv.invitationId ?? `${entry}/captain`, {org: F.org, entry});
    const acc = await ok('accept_tournament_team_invitation', {p_token: inv.token}, captain);
    rec('acceptance', `${entry}/${captain.identity}`, {org: F.org, entry, identity: captain.identity});
    F.acceptance.push({entry, status: 200, live: true});
    const mgr = sqlOne(`select status||','||coalesce(user_id::text,'') from public.tournament_team_managers where team_entry_id=${lit(entry)} and role='captain' order by created_at desc limit 1`);
    eq(mgr, `active,${captain.identity}`, 'captain manager active and bound to the captain identity');
    return {invitation: (inv.invitationId ?? '').slice(0, 8) || null, accepted: acc};
  };

  return {
    F, ok, call, refused, exercised,
    // ─── organizations / workspaces ───
    async workspace() {
      eq(await ok('is_tournament_organization_slug_available', {p_slug: S.league}), true, 'slug free');
      const org = await ok('create_tournament_organization', {p_name: `R5 League ${RUN}`, p_slug: S.league, p_idempotency_key: crypto.randomUUID()});
      F.org = rec('organization', org.organization.id, {slug: S.league});
      const pref = await ok('set_tournament_workspace_preference', {p_workspace_type: 'tournament_organization', p_organization_id: F.org});
      rec('workspace_preference', owner.identity, {org: F.org});
      eq([pref.workspaceType, pref.activeOrganizationId], ['tournament_organization', F.org], 'preference');
      const ctx = await ok('get_tournament_workspace_context', {});
      assert(text(ctx).includes(F.org) && text(ctx).includes('"owner"'), {ctx});
      const renamed = await ok('update_tournament_organization', {p_organization_id: F.org, p_name: `R5 League ${RUN} Oficial`});
      eq(sqlOne(`select name from public.tournament_organizations where id=${lit(F.org)}`), `R5 League ${RUN} Oficial`, 'renamed');
      eq([await ok('is_tournament_organization_member', {p_organization_id: F.org}), await ok('is_tournament_organization_member', {p_organization_id: F.org}, outsider)], [true, false], 'membership predicate');
      eq(await ok('has_tournament_organization_capability', {p_organization_id: F.org, p_capability: 'tournaments.create'}), true, 'owner capability');
      const caps = await ok('tournament_role_capabilities', {p_role: 'owner'});
      assert(Array.isArray(caps) && caps.length > 0, {caps});
      const org2 = await ok('create_tournament_organization', {p_name: `R5 Other ${RUN}`, p_slug: S.other, p_idempotency_key: crypto.randomUUID()}, outsider);
      F.org2 = rec('organization', org2.organization.id, {slug: S.other});
      return {org: F.org.slice(0, 8), org2: F.org2.slice(0, 8), renamed: renamed.name ?? true, capabilities: caps.length};
    },
    // ─── seasons ───
    async seasons() {
      const season = async (org, name, slug, who = owner) => rec('season', (await ok('create_tournament_season', {p_organization_id: org, p_name: name, p_slug: slug, p_start_date: null, p_end_date: null, p_idempotency_key: crypto.randomUUID()}, who)).id, {org});
      F.seasonA = await season(F.org, 'Temporada A', `a-${RUN}`);
      F.seasonB = await season(F.org, 'Temporada B', `b-${RUN}`);
      const upd = await ok('update_tournament_season', {p_organization_id: F.org, p_season_id: F.seasonA, p_name: 'Temporada A 2026'});
      eq(upd.name, 'Temporada A 2026', 'season renamed');
      const ctx = await ok('set_active_tournament_context', {p_organization_id: F.org, p_season_id: F.seasonA});
      rec('context_preference', `${owner.identity}/${F.org}`, {org: F.org});
      eq(ctx.activeSeasonId, F.seasonA, 'active season');
      F.season2 = await season(F.org2, 'Temporada X', `x-${RUN}`, outsider);
      return {seasonA: F.seasonA.slice(0, 8), seasonB: F.seasonB.slice(0, 8), season2: F.season2.slice(0, 8)};
    },
    // ─── tournaments ───
    async tournaments() {
      const elig = await ok('get_tournament_creation_eligibility', {p_organization_id: F.org});
      [F.tournamentA, F.categoryA] = await mkTournament(F.org, F.seasonA, 'alpha');
      const cfg = await ok('update_tournament_configuration', {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_patch: {name: `Copa Alpha ${RUN} Apertura`}});
      eq(sqlOne(`select name from public.tournaments where id=${lit(F.tournamentA)}`), `Copa Alpha ${RUN} Apertura`, 'tournament renamed');
      [F.tournamentB, F.categoryB] = await mkTournament(F.org, F.seasonB, 'bravo');
      [F.tournament2, F.category2] = await mkTournament(F.org2, F.season2, 'other', outsider);
      const comp = await ok('get_tournament_competition_context', {p_organization_id: F.org});
      assert(text(comp).includes(F.tournamentA) && text(comp).includes(F.tournamentB), 'competition context lists both tournaments');
      const consumed = await ok('has_organization_consumed_free_tournament', {p_organization_id: F.org});
      eq(await ok('has_tournament_capability', {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_capability: 'team_entries.review'}), true, 'owner reviews');
      const state = sqlOne(`select o.status||','||t.status||','||c.status from public.tournament_organizations o join public.tournaments t on t.organization_id=o.id join public.tournament_categories c on c.tournament_id=t.id where t.id=${lit(F.tournamentA)}`);
      eq(state, 'active,registration,active', 'org/tournament/category state');
      return {tournamentA: F.tournamentA.slice(0, 8), tournamentB: F.tournamentB.slice(0, 8), tournament2: F.tournament2.slice(0, 8), eligibility: typeof elig, consumedFree: consumed, configured: !!cfg};
    },
    // ─── collaborators (membership seeded per Phase 2D contract; the season seat is the RPC) ───
    async collaborator() {
      psql(`insert into public.tournament_organization_members(organization_id,user_id,role,joined_at) values (${lit(F.org)},${lit(admin.identity)},'admin',now());`);
      rec('membership_seed', `${F.org}/${admin.identity}`, {org: F.org, identity: admin.identity});
      F.membershipAdmin = sqlOne(`select id from public.tournament_organization_members where organization_id=${lit(F.org)} and user_id=${lit(admin.identity)}`);
      eq(await ok('is_tournament_organization_member', {p_organization_id: F.org}, admin), true, 'admin is a member');
      eq(await ok('has_tournament_season_access', {p_organization_id: F.org, p_season_id: F.seasonA}, admin), false, 'no seat yet');
      await ok('assign_tournament_season_member', {p_organization_id: F.org, p_season_id: F.seasonA, p_membership_id: F.membershipAdmin});
      rec('season_assignment', `${F.seasonA}/${F.membershipAdmin}`, {org: F.org, season: F.seasonA});
      const seats = await ok('list_tournament_season_member_assignments', {p_organization_id: F.org, p_season_id: F.seasonA});
      assert(text(seats).includes(F.membershipAdmin), {seats});
      const access = {adminA: await ok('has_tournament_season_access', {p_organization_id: F.org, p_season_id: F.seasonA}, admin), adminB: await ok('has_tournament_season_access', {p_organization_id: F.org, p_season_id: F.seasonB}, admin),
        ownerA: await ok('has_tournament_season_access', {p_organization_id: F.org, p_season_id: F.seasonA}), ownerB: await ok('has_tournament_season_access', {p_organization_id: F.org, p_season_id: F.seasonB})};
      eq(access, {adminA: true, adminB: false, ownerA: true, ownerB: true}, 'season scope');
      eq(await ok('has_tournament_season_capability', {p_organization_id: F.org, p_season_id: F.seasonA, p_capability: 'team_entries.review'}, admin), true, 'seated admin can review season A');
      const teams = await ok('get_tournament_teams_context', {p_organization_id: F.org, p_tournament_id: F.tournamentA}, admin);
      return {membership: F.membershipAdmin.slice(0, 8), access, teamsContext: typeof teams};
    },
    /** owner revokes the collaborator seat: the admin loses season A immediately (no cached grant). */
    async revokeCollaborator() {
      eq(await ok('remove_tournament_season_member_assignment', {p_organization_id: F.org, p_season_id: F.seasonA, p_membership_id: F.membershipAdmin}), true, 'seat removed');
      const seats = await ok('list_tournament_season_member_assignments', {p_organization_id: F.org, p_season_id: F.seasonA});
      assert(!text(seats).includes(F.membershipAdmin), {seats});
      eq(await ok('has_tournament_season_access', {p_organization_id: F.org, p_season_id: F.seasonA}, admin), false, 'admin lost season A');
      return {seatRemoved: true};
    },
    // ─── team registration (manual entry E1 + a withdrawn entry) ───
    async teamRegistration() {
      const e1 = await ok('create_tournament_team_entry', entryArgs(F.org, F.tournamentA, F.categoryA, `Alpha FC ${RUN}`));
      rec('team_entry', e1.entryId, {org: F.org, tournament: F.tournamentA}); rec('roster', e1.rosterId, {org: F.org, entry: e1.entryId});
      eq(e1.status, 'draft', 'entry draft');
      F.entries.manual = {entry: e1.entryId, roster: e1.rosterId};
      const upd = await ok('update_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: e1.entryId, p_patch: {shortName: 'ALP'}});
      eq(upd.status, 'in_progress', 'entry in progress');
      const ctx = await ok('get_team_registration_context', {p_organization_id: F.org, p_team_entry_id: e1.entryId});
      assert(text(ctx).includes(e1.entryId), 'registration context names the entry');
      eq([await ok('can_read_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: e1.entryId}), await ok('can_read_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: e1.entryId}, outsider)], [true, false], 'read predicate');
      const e3 = await ok('create_tournament_team_entry', entryArgs(F.org, F.tournamentA, F.categoryA, `Retirado FC ${RUN}`));
      rec('team_entry', e3.entryId, {org: F.org, tournament: F.tournamentA}); rec('roster', e3.rosterId, {org: F.org, entry: e3.entryId});
      const w = await ok('withdraw_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: e3.entryId, p_reason: 'El equipo no participa esta temporada'});
      eq(w.status, 'withdrawn', 'withdrawn');
      F.entries.withdrawn = {entry: e3.entryId, roster: e3.rosterId};
      const settings = sqlOne(`select minimum_players||','||maximum_players||','||minimum_goalkeepers from public.tournament_roster_settings where tournament_id=${lit(F.tournamentA)}`);
      eq(settings, '5,8,1', 'roster settings from tournament defaults');
      return {entry: e1.entryId.slice(0, 8), withdrawn: e3.entryId.slice(0, 8), settings};
    },
    // ─── basic roster on E1: 4 provisional players + the captain's Core-backed identity; edit; remove ───
    async roster() {
      const {entry, roster} = F.entries.manual;
      for (const [display, shirt, position, gk] of PLAYERS) await provisional(entry, roster, display, shirt, position, gk);
      const cap = await ok('add_tournament_roster_player', {p_organization_id: F.org, p_team_entry_id: entry, p_roster_id: roster, p_arma2_user_id: captain.identity, p_provisional_player_id: null, p_display_name: `Capitana Cinco ${RUN}`, p_avatar_url: null, p_shirt_number: 5, p_primary_position: 'DEF', p_secondary_position: null, p_is_goalkeeper: false});
      rec('roster_player', cap.id, {org: F.org, entry, roster, identity: captain.identity});
      const p3 = playerId(entry, 3);
      const upd = await ok('update_tournament_roster_player', {p_organization_id: F.org, p_team_entry_id: entry, p_roster_player_id: p3, p_shirt_number: 13, p_primary_position: 'MED', p_secondary_position: 'DEL', p_is_goalkeeper: false});
      eq(sqlOne(`select shirt_number from public.tournament_roster_players where id=${lit(p3)}`), '13', 'shirt updated');
      const sixth = await provisional(entry, roster, 'Suplente Seis', 6, 'DEL', false);
      const rm = await ok('remove_tournament_roster_player', {p_organization_id: F.org, p_team_entry_id: entry, p_roster_player_id: sixth});
      eq(rm.status, 'removed', 'player removed');
      const st = entryState(entry);
      eq(st.players.length, 5, 'five active players'); eq(st.players.find((p) => p.shirt === 5)?.account, captain.identity, 'captain identity on the roster');
      return {active: st.players.length, captainOnRoster: true, updated: upd.status ?? true};
    },
    /** directory_players through the Core contract: the captain's Core account resolves to the captain's shadow identity.
     * The query is the run tag: Core's normalizer (lower, accents, [^a-z0-9]+ → space) keeps it a substring of every QA
     * display name `QA R5 <role> <run>` of this run and of nothing else on staging. */
    async searchPlayers() {
      const r = await ok('search_tournament_players', {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_query: RUN, p_limit: 8, p_team_entry_id: null});
      assert(Array.isArray(r), {r});
      const hit = r.find((x) => x.userId === captain.identity);
      assert(hit && hit.linkedAccount === true, {items: r.length, hit});
      return {items: r.length, captainUserId: hit.userId.slice(0, 8), displayName: hit.displayName};
    },
    // ─── invitation: captain accepts (Core verified_email), edits as manager, submits E1 ───
    async invitation() {
      const {entry} = F.entries.manual;
      const inv = await inviteAndAccept(entry);
      eq([await ok('is_tournament_team_manager', {p_team_entry_id: entry, p_require_edit: true}, captain), await ok('is_tournament_team_manager', {p_team_entry_id: entry, p_require_edit: false})], [true, false], 'captain manages, owner is not a manager');
      eq(await ok('can_read_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: entry}, captain), true, 'captain reads own entry');
      const ctx = await ok('get_team_registration_context', {p_organization_id: F.org, p_team_entry_id: entry}, captain);
      assert(text(ctx).includes(entry), 'captain context');
      const p13 = playerId(entry, 13);
      await ok('update_tournament_roster_player', {p_organization_id: F.org, p_team_entry_id: entry, p_roster_player_id: p13, p_shirt_number: 3, p_primary_position: 'MED', p_secondary_position: null, p_is_goalkeeper: false}, captain);
      eq(sqlOne(`select shirt_number from public.tournament_roster_players where id=${lit(p13)}`), '3', 'captain edited the roster');
      const sub = await ok('submit_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: entry}, captain);
      eq([sub.status, sub.validation?.valid, sub.validation?.counts?.players, sub.validation?.counts?.goalkeepers], ['submitted', true, 5, 1], sub);
      return {...inv, submitted: sub.status, counts: sub.validation.counts};
    },
    // ─── Core team import: directory_teams → team_snapshot → E2, then a full registration on E2 ───
    async coreTeamImport(coreTeam) {
      assert(coreTeam?.id && coreTeam?.name, 'core team fixture required');
      const found = await ok('search_tournament_arma2_teams', {p_organization_id: F.org, p_tournament_id: F.tournamentA, p_query: coreTeam.name.slice(0, 40), p_limit: 8});
      assert(Array.isArray(found) && found.some((t) => t.id === coreTeam.id), {found});
      const e2 = await ok('create_tournament_team_entry', entryArgs(F.org, F.tournamentA, F.categoryA, null, {p_arma2_team_id: coreTeam.id, p_registration_source: 'arma2_team'}));
      rec('team_entry', e2.entryId, {org: F.org, tournament: F.tournamentA, coreTeam: coreTeam.id}); rec('roster', e2.rosterId, {org: F.org, entry: e2.entryId});
      F.entries.imported = {entry: e2.entryId, roster: e2.rosterId};
      const st = entryState(e2.entryId);
      eq([st.entry.status, st.entry.name, st.entry.registration_source, st.entry.arma2_team_id], ['draft', coreTeam.name, 'arma2_team', coreTeam.id], 'imported entry mirrors the Core team');
      const snap = sqlOne(`select core_team_id||','||name||','||imported_by||','||jsonb_array_length(players) from private.tournament_team_entry_core_snapshots where team_entry_id=${lit(e2.entryId)}`);
      eq(snap, `${coreTeam.id},${coreTeam.name},${owner.identity},${coreTeam.players ?? 0}`, 'frozen snapshot row');
      const again = await call('create_tournament_team_entry', owner, entryArgs(F.org, F.tournamentA, F.categoryA, null, {p_arma2_team_id: coreTeam.id, p_registration_source: 'arma2_team'}));
      assert(again.status !== 200 && (again.body?.message === 'TORNEOS_TEAM_ALREADY_REGISTERED' || again.body?.error === 'TORNEOS_CORE_ATTESTATION_REQUIRED' || again.body?.message === 'TORNEOS_CORE_ATTESTATION_REQUIRED'), {again: again.status, body: again.body});
      eq(countRows('public.tournament_team_entries', `arma2_team_id=${lit(coreTeam.id)}`), 1, 'one import only');
      await ok('update_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: e2.entryId, p_patch: {shortName: 'IMP'}});
      for (const [display, shirt, position, gk] of PLAYERS) await provisional(e2.entryId, e2.rosterId, display, shirt, position, gk);
      await provisional(e2.entryId, e2.rosterId, 'Delantera Cinco', 5, 'DEL', false);
      const inv = await inviteAndAccept(e2.entryId);
      const sub = await ok('submit_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: e2.entryId});
      eq([sub.status, sub.validation?.valid], ['submitted', true], sub);
      return {entry: e2.entryId.slice(0, 8), coreTeam: coreTeam.id.slice(0, 8), name: coreTeam.name, secondImport: again.status, invitation: inv.invitation, submitted: sub.status};
    },
    /** cross-user Core authority: the outsider imports the OWNER's Core team into their own workspace. */
    async coreTeamImportByOutsider(coreTeam, expect) {
      const before = countRows('public.tournament_team_entries', `organization_id=${lit(F.org2)}`);
      const r = await call('create_tournament_team_entry', outsider, entryArgs(F.org2, F.tournament2, F.category2, null, {p_arma2_team_id: coreTeam.id, p_registration_source: 'arma2_team'}));
      eq([r.status, r.body?.error ?? r.body?.message], expect, {r: r.body});
      eq(countRows('public.tournament_team_entries', `organization_id=${lit(F.org2)}`), before, 'zero writes');
      eq(countRows('private.core_contract_attestations', `identity_id=${lit(outsider.identity)} and contract='team_snapshot'`), 0, 'no attestation for the outsider');
      return {status: r.status, body: r.body};
    },
    // ─── P0 review_tournament_team_entry: changes_requested → fix → resubmit → approve (owner + seated admin) ───
    async review() {
      const E = F.entries;
      const review = (actor, entry, decision, reason = 'R5 review reason', issues = [], org = F.org) => call(P0, actor, {p_organization_id: org, p_team_entry_id: entry, p_decision: decision, p_reason: reason, p_issues: issues});
      const cr = await review(owner, E.imported.entry, 'changes_requested', 'Revisar dorsal 2', [{code: 'shirt_number', playerShirt: 2}]);
      eq([cr.status, cr.body?.status], [200, 'changes_requested'], cr.body); exercised.add(P0);
      let st = entryState(E.imported.entry); eq([st.entry.status, st.rosters.at(-1).status], ['changes_requested', 'changes_requested'], st);
      const a1 = lastAudit(E.imported.entry); eq([a1.action, a1.actor_user_id, a1.metadata?.issueCount], ['team_entry.changes_requested', owner.identity, 1], a1);
      const p2 = playerId(E.imported.entry, 2);
      await ok('update_tournament_roster_player', {p_organization_id: F.org, p_team_entry_id: E.imported.entry, p_roster_player_id: p2, p_shirt_number: 12, p_primary_position: 'DEF', p_secondary_position: null, p_is_goalkeeper: false});
      const re = await ok('submit_tournament_team_entry', {p_organization_id: F.org, p_team_entry_id: E.imported.entry});
      eq(re.status, 'submitted', 'resubmitted after changes');
      const adm = await review(admin, E.manual.entry, 'approved', 'Plantel completo (colaboradora)');
      eq([adm.status, adm.body?.status], [200, 'approved'], adm.body);
      st = entryState(E.manual.entry);
      eq([st.entry.status, st.entry.reviewed_by, st.entry.approved_at, st.players.map((p) => p.eligibility)], ['approved', admin.identity, true, ['eligible', 'eligible', 'eligible', 'eligible', 'eligible']], st);
      const a2 = lastAudit(E.manual.entry); eq([a2.action, a2.actor_user_id, a2.actor_type], ['team_entry.approved', admin.identity, 'user'], a2);
      const own = await review(owner, E.imported.entry, 'approved', 'Plantel completo (import)');
      eq([own.status, own.body?.status], [200, 'approved'], own.body);
      eq(entryState(E.imported.entry).entry.status, 'approved', 'imported entry approved');
      const before = entryState(E.manual.entry);
      const denied = [];
      for (const [label, r] of [['owner reviews an approved entry again', await review(owner, E.manual.entry, 'approved')], ['captain (manager) reviews own entry', await review(captain, E.manual.entry, 'approved')],
        ['outsider with the entry org', await review(outsider, E.manual.entry, 'approved')], ['outsider with their own org id', await review(outsider, E.manual.entry, 'approved', undefined, [], F.org2)]]) {
        denied.push({label, status: r.status, message: r.body?.message}); assert(r.status === 403 && r.body?.message === 'TORNEOS_RESOURCE_FORBIDDEN', {label, r: r.body});
      }
      const invalid = await review(owner, E.imported.entry, 'maybe'); eq([invalid.status, invalid.body?.message], [400, 'TORNEOS_INVALID_REVIEW'], invalid.body);
      eq(entryState(E.manual.entry), before, 'denials wrote nothing');
      const mine = await ok('get_my_tournament_memberships', {}, captain);
      assert(text(mine).includes(F.tournamentA), 'captain of an approved entry sees the tournament');
      const teams = await ok('get_tournament_teams_context', {p_organization_id: F.org, p_tournament_id: F.tournamentA});
      assert(text(teams).includes(E.manual.entry) && text(teams).includes(E.imported.entry), 'teams context lists both entries');
      return {changesRequested: cr.status, resubmitted: re.status, adminApproved: adm.status, ownerApproved: own.status, denied, invalid: invalid.status};
    },
  };
}
