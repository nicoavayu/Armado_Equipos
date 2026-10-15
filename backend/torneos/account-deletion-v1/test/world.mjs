// ACCOUNT ERASURE 0021 — the fictional world the rehearsal erases people from. Every name is invented («Ficticio»), every
// email ends in .invalid, every phone is a made-up number. Built through the product's own RPCs as each actor (PostgREST
// emulated exactly like the certified MP-A helpers: SET LOCAL ROLE authenticated + the bridge claims), except the few
// rows the UI cannot create without Core (team-manager acceptance, a frozen Core snapshot, a Core attestation, a claimed
// provisional player, inbox rows, a portrait, a gallery photo) which the installer inserts with the same shape.
//
// People (one per scenario the design names):
//   olga     owner of «Liga Norte» with members (admins ana — the oldest — and beto, collaborator carla, admin dora) → transfer to ana
//   solo     owner of «Torneo Solo», alone, with a published public page and a listed catalog entry with WhatsApp → archive
//   premium  owner of «Liga Premium», alone, with an APPROVED Premium purchase of its season → archive, purchase untouched
//   lidia    owner of «Liga Colaborativa» whose only other member is a collaborator (carla) → archive (no promotion)
//   carla    collaborator in two organizations (Liga Norte and Liga Colaborativa) → both memberships removed
//   capi     captain of «Club Uno» (active team manager), applicant with a message → manager revoked, message cleared
//   pedro    player of «Club Uno» (Arma2 account) with goals and a card in an OFFICIAL report of a COMPLETED tournament,
//            in the public stats, a frozen Core snapshot, an attestation, availability with a comment, inbox, prefs
//   paula    provisional player of «Club Dos» she claimed (name, email, phone) → pseudonym, contacts cleared
//   dora     admin, author of a published announcement → author kept (pseudonymous), text kept
//   foto     player of «Club Dos» with a portrait and a consent; photographer with a gallery photo → portrait to delete_pending
//   nadie    a Core user who never used Torneos → no_identity
import { randomUUID, randomBytes } from 'node:crypto';

export const RUN = `ad${randomBytes(3).toString('hex')}`;

export class World {
  constructor(pool) { this.pool = pool; this.people = {}; this.ids = {}; }

  async q(text, params = []) { return (await this.pool.query(text, params)).rows; }
  async one(text, params = []) { const rows = await this.q(text, params); return rows[0] ? Object.values(rows[0])[0] : null; }

  claims(actor) {
    const now = Math.floor(Date.now() / 1000);
    return { role: 'authenticated', iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', sub: actor.id,
      core_user_id: actor.core, session_id: randomUUID(), jti: randomUUID(), iat: now, nbf: now, exp: now + 120 };
  }

  /** One RPC as an authenticated identity, named arguments, one transaction (what PostgREST does). */
  async rpc(actor, name, params = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(this.claims(actor))]);
      const keys = Object.keys(params);
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      const values = keys.map((k) => { const v = params[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
      const { rows } = await client.query(`SELECT to_jsonb(public.${name}(${args})) AS result`, values);
      await client.query('COMMIT');
      return rows[0].result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`${name} as ${actor.label}: ${error.message}`);
    } finally {
      client.release();
    }
  }

  async person(label, { identity = true } = {}) {
    const actor = { label, id: randomUUID(), core: randomUUID() };
    if (identity) {
      // What the gateway's /exchange writes (torneos_identity_writer); the installer owns the table in Production's topology.
      await this.q('INSERT INTO public.torneos_identity(id, core_user_id) VALUES ($1, $2)', [actor.id, actor.core]);
      await this.q('insert into public.tournament_user_profiles(user_id, display_name) values ($1, $2)', [actor.id, `${label[0].toUpperCase()}${label.slice(1)} Ficticio`]);
    }
    this.people[label] = actor;
    return actor;
  }

  async member(org, actor, role, joinedMinutesAgo) {
    return this.one(`insert into public.tournament_organization_members(organization_id, user_id, role, status, joined_at, created_at)
      values ($1, $2, $3, 'active', now() - make_interval(mins => $4), now() - make_interval(mins => $4)) returning id`,
    [org, actor.id, role, joinedMinutesAgo]);
  }

  async organization(owner, name) {
    const r = await this.rpc(owner, 'create_tournament_organization', { p_name: `${name} ${RUN}`, p_slug: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${RUN}`, p_idempotency_key: randomUUID() });
    return r.organization.id;
  }
  async season(owner, org, name) {
    return (await this.rpc(owner, 'create_tournament_season', { p_organization_id: org, p_name: name, p_slug: `${name.toLowerCase()}-${RUN}`,
      p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
  }
  async tournament(owner, org, season, slug) {
    const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    const t = await this.rpc(owner, 'create_tournament_with_defaults', { p_organization_id: org, p_season_id: season, p_name: `Copa ${slug}`,
      p_slug: `${slug}-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open',
      p_start_date: day(-1), p_end_date: day(60), p_idempotency_key: randomUUID() });
    const c = await this.rpc(owner, 'save_tournament_category', { p_organization_id: org, p_tournament_id: t.id, p_category_id: null, p_name: 'Libre',
      p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null,
      p_team_size: null, p_status: 'active' });
    await this.rpc(owner, 'change_tournament_status', { p_organization_id: org, p_tournament_id: t.id, p_status: 'registration' });
    return { id: t.id, category: c.id, org, season };
  }

  /** Manual entry → five provisional players (+ extra Arma2 players) → submitted → approved. */
  async team(owner, t, name, { captain, arma2 = [], provisional = [] } = {}) {
    const created = await this.rpc(owner, 'create_tournament_team_entry', { p_organization_id: t.org, p_tournament_id: t.id, p_category_id: t.category,
      p_arma2_team_id: null, p_name: `${name} ${RUN}`, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual',
      p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
    const entry = created.entryId; const roster = created.rosterId;
    await this.rpc(owner, 'update_tournament_team_entry', { p_organization_id: t.org, p_team_entry_id: entry, p_patch: { shortName: name.slice(-3).toUpperCase() } });
    // The captain's acceptance needs the Core verified-email contract: the accepted manager row is written as it would end.
    const manager = await this.one(`insert into public.tournament_team_managers(organization_id, team_entry_id, user_id, email_normalized, display_name, role, status, invited_by, accepted_at)
      values ($1, $2, $3, $4, $5, 'captain', 'active', $6, now()) returning id`,
    [t.org, entry, captain.id, `${captain.label}.ficticio@example.invalid`, `${captain.label[0].toUpperCase()}${captain.label.slice(1)} Ficticio`, owner.id]);
    const players = [];
    const base = [['Arquero', 1, 'ARQ', true], ['Defensor', 2, 'DEF', false], ['Volante', 3, 'MED', false], ['Delantero', 4, 'DEL', false], ['Lateral', 5, 'DEF', false]];
    for (const [display, shirt, position, gk] of base) {
      const prov = await this.rpc(owner, 'create_tournament_provisional_player', { p_organization_id: t.org, p_team_entry_id: entry, p_display_name: `${display} ${name}` });
      const added = await this.rpc(owner, 'add_tournament_roster_player', { p_organization_id: t.org, p_team_entry_id: entry, p_roster_id: roster,
        p_arma2_user_id: null, p_provisional_player_id: prov.id, p_display_name: `${display} ${name}`, p_avatar_url: null, p_shirt_number: shirt,
        p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: gk });
      players.push({ id: added.id, name: `${display} ${name}`, provisional: prov.id });
    }
    for (const [i, extra] of provisional.entries()) {
      const prov = await this.rpc(owner, 'create_tournament_provisional_player', { p_organization_id: t.org, p_team_entry_id: entry, p_display_name: extra.name });
      const added = await this.rpc(owner, 'add_tournament_roster_player', { p_organization_id: t.org, p_team_entry_id: entry, p_roster_id: roster,
        p_arma2_user_id: null, p_provisional_player_id: prov.id, p_display_name: extra.name, p_avatar_url: 'https://example.invalid/paula.jpg',
        p_shirt_number: 20 + i, p_primary_position: 'MED', p_secondary_position: null, p_is_goalkeeper: false });
      players.push({ id: added.id, name: extra.name, provisional: prov.id, label: extra.label });
    }
    for (const [i, actor] of arma2.entries()) {
      const added = await this.rpc(owner, 'add_tournament_roster_player', { p_organization_id: t.org, p_team_entry_id: entry, p_roster_id: roster,
        p_arma2_user_id: actor.id, p_provisional_player_id: null, p_display_name: `${actor.label[0].toUpperCase()}${actor.label.slice(1)} Ficticio`,
        p_avatar_url: `https://example.invalid/${actor.label}.jpg`, p_shirt_number: 9 + i, p_primary_position: 'DEL', p_secondary_position: null, p_is_goalkeeper: false });
      players.push({ id: added.id, name: `${actor.label} Ficticio`, label: actor.label });
    }
    await this.rpc(owner, 'submit_tournament_team_entry', { p_organization_id: t.org, p_team_entry_id: entry });
    await this.rpc(owner, 'review_tournament_team_entry', { p_organization_id: t.org, p_team_entry_id: entry, p_decision: 'approved', p_reason: 'Plantel verificado', p_issues: [] });
    return { entry, roster, players, manager, name: `${name} ${RUN}` };
  }
}

/** Builds the whole fictional world. Returns the World (people, ids) for the assertions. */
export async function buildWorld(pool, { onStep = () => {}, paymentsCall } = {}) {
  const w = new World(pool);
  const P = {};
  for (const label of ['olga', 'ana', 'beto', 'carla', 'dora', 'solo', 'premium', 'lidia', 'capi', 'pedro', 'paula', 'foto', 'rival']) P[label] = await w.person(label);
  P.nadie = await w.person('nadie', { identity: false });
  onStep('people');

  // ---- Liga Norte (olga owns; ana is the longest-standing admin; beto newer admin; carla collaborator; dora admin)
  const norte = await w.organization(P.olga, 'Liga Norte');
  await w.member(norte, P.ana, 'admin', 600);
  await w.member(norte, P.beto, 'admin', 60);
  const doraNorte = await w.member(norte, P.dora, 'admin', 300);
  const carlaNorte = await w.member(norte, P.carla, 'collaborator', 30);
  const seasonN = await w.season(P.olga, norte, 'Apertura');
  for (const membership of [doraNorte]) { // a FREE season admits one seat
    await w.q(`insert into public.tournament_season_member_assignments(organization_id, season_id, membership_id) values ($1, $2, $3)`, [norte, seasonN, membership]);
  }
  const T = await w.tournament(P.olga, norte, seasonN, 'norte');
  const uno = await w.team(P.olga, T, 'Club Uno', { captain: P.capi, arma2: [P.pedro] });
  const dos = await w.team(P.olga, T, 'Club Dos', { captain: P.rival, arma2: [P.foto], provisional: [{ name: 'Paula Ficticia', label: 'paula' }] });
  onStep('teams');

  // capi: the active captain of Club Uno, through an invitation he accepted (his email is in it).
  const capiManager = uno.manager;
  await w.q(`insert into public.tournament_team_invitations(organization_id, tournament_id, team_entry_id, manager_id, email_normalized, role, token_hash, status, expires_at, created_by, accepted_at)
    values ($1, $2, $3, $4, 'capi.ficticio@example.invalid', 'captain', $5, 'accepted', now() + interval '7 days', $6, now())`,
  [norte, T.id, uno.entry, capiManager, randomBytes(32).toString('hex'), P.olga.id]);
  await w.q(`insert into public.tournament_team_applications(team_entry_id, organization_id, tournament_id, category_id, applicant_user_id, message, accepted_conditions_at)
    values ($1, $2, $3, $4, $5, 'Somos los de siempre, escribime al 1155550000', now())`, [uno.entry, norte, T.id, T.category, P.capi.id]);
  // paula claimed her provisional player (name, email, phone given by the organizer).
  const paulaRow = dos.players.find((p) => p.label === 'paula');
  await w.q(`update public.tournament_provisional_players set claimed_by_user_id = $1, claim_status = 'claimed',
    contact_email = 'paula.ficticia@example.invalid', contact_phone = '1155551234' where id = $2`, [P.paula.id, paulaRow.provisional]);
  // The frozen Core snapshot of Club Uno lists pedro (and a teammate who keeps his account).
  await w.q(`insert into private.tournament_team_entry_core_snapshots(team_entry_id, organization_id, tournament_id, core_team_id, name, crest_url, players, source_revision, captured_at, imported_by)
    values ($1, $2, $3, $4, 'Club Uno', null, $5::jsonb, 1, now(), $6)`,
  [uno.entry, norte, T.id, randomUUID(), JSON.stringify([
    { core_user_id: P.pedro.core, display_name: 'Pedro Ficticio', avatar_url: 'https://example.invalid/pedro.jpg', positions: ['DEL'] },
    { core_user_id: P.rival.core, display_name: 'Rival Ficticio', avatar_url: null, positions: ['DEF'] }]), P.olga.id]);
  await w.q(`insert into private.core_contract_attestations(identity_id, session_id, contract, request_hash, response, observed_at)
    values ($1, $2, 'directory_players', $3, $4::jsonb, now())`,
  [P.olga.id, randomUUID(), randomBytes(32).toString('hex'), JSON.stringify({ items: [{ core_user_id: P.pedro.core, display_name: 'Pedro Ficticio' }] })]);
  await w.q(`insert into private.core_contract_attestations(identity_id, session_id, contract, request_hash, response, observed_at)
    values ($1, $2, 'verified_email', $3, '{"verified": true}'::jsonb, now())`, [P.pedro.id, randomUUID(), randomBytes(32).toString('hex')]);
  onStep('roles');

  // ---- fixture → start → schedule → availability → squads → official report → standings → public page → finish
  const scope = { p_organization_id: norte, p_tournament_id: T.id, p_category_id: T.category };
  await w.rpc(P.olga, 'freeze_tournament_participants', { ...scope, p_idempotency_key: randomUUID() });
  const fixture = (await w.rpc(P.olga, 'generate_tournament_fixture', { ...scope, p_seed: `seed-${RUN}`, p_configuration: {}, p_idempotency_key: randomUUID() })).fixtureVersionId;
  await w.rpc(P.olga, 'publish_tournament_fixture', { p_organization_id: norte, p_fixture_version_id: fixture });
  await w.rpc(P.olga, 'start_tournament_competition', { p_organization_id: norte, p_tournament_id: T.id });
  const match = (await w.q(`select m.id, m.phase_id, hp.team_entry_id home, ap.team_entry_id away from public.tournament_matches m
    left join public.tournament_competition_participants hp on hp.id = m.home_participant_id
    left join public.tournament_competition_participants ap on ap.id = m.away_participant_id
    where m.fixture_version_id = $1 order by m.match_number limit 1`, [fixture]))[0];
  const venue = (await w.rpc(P.olga, 'create_tournament_venue', { p_organization_id: norte, p_name: `Club ${RUN}`, p_address: 'Calle Ficticia 123',
    p_place_id: null, p_latitude: null, p_longitude: null, p_locality: 'Ciudad Ficticia', p_timezone: 'America/Argentina/Buenos_Aires', p_notes: null })).id;
  const court = (await w.rpc(P.olga, 'create_tournament_court', { p_organization_id: norte, p_venue_id: venue, p_name: 'Cancha 1', p_sport_modality: 'football_5', p_notes: null })).id;
  const at = new Date(Date.now() + 2 * 3600_000); at.setUTCMinutes(0, 0, 0);
  await w.rpc(P.olga, 'schedule_tournament_match', { p_organization_id: norte, p_match_id: match.id, p_scheduled_at: at.toISOString(), p_venue_id: venue,
    p_court_id: court, p_duration_minutes: 60, p_override_warnings: true, p_override_reason: 'Ensayo de borrado' });
  await w.rpc(P.pedro, 'respond_match_availability', { p_match_id: match.id, p_response: 'available', p_comment: 'Llego tarde por el trabajo' });
  const teams = { [uno.entry]: uno, [dos.entry]: dos };
  const squad = (players) => players.map((p, index) => ({ rosterPlayerId: p.id, availabilityStatus: 'no_response', callupStatus: 'called_up',
    lineupStatus: index < 5 ? 'starter' : 'substitute', isGoalkeeper: index === 0, isCaptain: index === 1, attendanceStatus: 'present' }));
  for (const entry of [match.home, match.away]) {
    await w.rpc(P.olga, 'save_match_squad', { p_organization_id: norte, p_match_id: match.id, p_team_entry_id: entry, p_players: squad(teams[entry].players) });
    await w.rpc(P.olga, 'submit_match_squad', { p_organization_id: norte, p_match_id: match.id, p_team_entry_id: entry });
  }
  onStep('squads');
  const opened = await w.rpc(P.olga, 'open_tournament_match_operation', { p_organization_id: norte, p_match_id: match.id, p_override_reason: 'Ensayo de borrado' });
  const op = opened.operation?.id ?? opened.id;
  const base = { p_organization_id: norte, p_match_operation_id: op };
  const pedroRow = uno.players.find((p) => p.label === 'pedro');
  const homeIsUno = match.home === uno.entry;
  await w.rpc(P.olga, 'set_tournament_match_outcome', { ...base, p_outcome: { outcomeType: 'played', countsForStandings: true, countsForPlayerStats: true, requiresResolution: false } });
  await w.rpc(P.olga, 'set_tournament_match_score', { ...base, p_score: { homeScore: homeIsUno ? 2 : 1, awayScore: homeIsUno ? 1 : 2, scoreType: 'played' } });
  await w.rpc(P.olga, 'add_tournament_match_event', { ...base, p_event: { teamEntryId: uno.entry, rosterPlayerId: pedroRow.id, eventType: 'goal', minute: 10, period: 'first_half' } });
  await w.rpc(P.olga, 'add_tournament_match_event', { ...base, p_event: { teamEntryId: uno.entry, rosterPlayerId: pedroRow.id, eventType: 'goal', minute: 30, period: 'first_half' } });
  await w.rpc(P.olga, 'add_tournament_match_event', { ...base, p_event: { teamEntryId: uno.entry, rosterPlayerId: pedroRow.id, eventType: 'yellow_card', minute: 35, period: 'first_half' } });
  await w.rpc(P.olga, 'add_tournament_match_event', { ...base, p_event: { teamEntryId: dos.entry, rosterPlayerId: dos.players[3].id, eventType: 'goal', minute: 40, period: 'second_half' } });
  await w.rpc(P.olga, 'submit_tournament_match_operation', base);
  await w.rpc(P.olga, 'review_tournament_match_operation', { ...base, p_decision: 'approved', p_reason: 'Acta verificada' });
  await w.rpc(P.olga, 'validate_tournament_match_operation', base);
  await w.rpc(P.olga, 'make_tournament_match_official', base);
  const standingsScope = { ...scope, p_phase_id: match.phase_id, p_group_id: null };
  const revision = await w.rpc(P.olga, 'rebuild_tournament_standings', { ...standingsScope, p_reason: 'Resultado oficial', p_idempotency_key: randomUUID() });
  await w.rpc(P.olga, 'publish_tournament_standings_revision', { p_revision_id: revision?.revisionId ?? revision?.id ?? revision, p_reason: 'Publicación' });
  const page = await w.rpc(P.olga, 'set_tournament_public_page_published', { p_organization_id: norte, p_tournament_id: T.id, p_published: true });
  onStep('official');

  // dora authors a published announcement; pedro reads it, acknowledges a document, sets preferences and a hub category.
  const draft = await w.rpc(P.dora, 'create_tournament_announcement_draft', { p_organization_id: norte, p_tournament_id: T.id, p_category_id: null,
    p_announcement_type: 'schedule_change', p_title: 'Cambio de horario', p_summary: 'Se movió un partido', p_body: 'La fecha 1 cambia de horario.',
    p_priority: 'important', p_acknowledgement_mode: 'none', p_scheduled_for: null, p_supersedes_id: null, p_correction_reason: null, p_idempotency_key: randomUUID() });
  const announcement = draft.id ?? draft.announcementId ?? draft;
  await w.rpc(P.dora, 'replace_tournament_announcement_audience', { p_announcement_id: announcement, p_audience_type: 'tournament', p_category_id: null,
    p_team_entry_id: null, p_match_id: null, p_specific_user_id: null });
  const preview = await w.rpc(P.dora, 'preview_tournament_announcement_audience', { p_announcement_id: announcement });
  await w.rpc(P.dora, 'publish_tournament_announcement', { p_announcement_id: announcement, p_expected_recipient_count: Number(preview?.estimatedRecipients ?? preview?.recipientCount) });
  await w.rpc(P.pedro, 'mark_tournament_announcement_read', { p_announcement_id: announcement, p_confirm: false });
  const doc = await w.rpc(P.olga, 'create_tournament_document', { p_organization_id: norte, p_tournament_id: T.id, p_category_id: null, p_document_type: 'regulation',
    p_title: 'Reglamento', p_summary: 'Reglas del torneo', p_body: 'Artículo 1: se juega limpio.', p_acknowledgement_mode: 'explicit', p_effective_at: null, p_idempotency_key: randomUUID() });
  const versionId = doc.versionId ?? doc.version?.id ?? doc.currentVersionId;
  await w.rpc(P.olga, 'publish_tournament_document_version', { p_version_id: versionId });
  await w.rpc(P.pedro, 'acknowledge_tournament_document', { p_version_id: versionId, p_confirm: true });
  await w.rpc(P.pedro, 'update_my_tournament_notification_preferences', { p_tournament_id: T.id, p_general: true, p_match_changes: true, p_callups: false,
    p_discipline: true, p_documents: true, p_summaries: false });
  await w.rpc(P.pedro, 'set_my_tournament_hub_category', { p_tournament_id: T.id, p_category_id: T.category });
  await w.q(`insert into public.tournament_user_notifications(recipient_user_id, organization_id, tournament_id, team_entry_id, audience, kind, title, body)
    values ($1, $2, $3, $4, 'team', 'registration.approved', 'Inscripción aprobada', 'Club Uno quedó inscripto.')`, [P.capi.id, norte, T.id, uno.entry]);
  await w.q(`insert into public.tournament_user_notifications(recipient_user_id, organization_id, tournament_id, team_entry_id, audience, kind, title, body)
    values ($1, $2, $3, $4, 'team', 'registration.approved', 'Inscripción aprobada', 'Club Uno quedó inscripto.')`, [P.pedro.id, norte, T.id, uno.entry]);
  onStep('communications');

  // foto: a portrait (active, approved, consent granted) of her roster player, and a media consent naming her.
  const fotoRow = dos.players.find((p) => p.label === 'foto');
  const portrait = randomUUID();
  await w.q(`insert into public.tournament_player_portraits(id, organization_id, tournament_id, team_entry_id, roster_player_id, object_path, mime_type, byte_size, width, height,
      editorial_status, publication_consent, lifecycle_status, uploaded_by, reviewed_by, reviewed_at, consent_actor_user_id, consent_changed_at)
    values ($1, $2, $3, $4, $5, $6, 'image/jpeg', 2048, 400, 400, 'approved', 'granted', 'active', $7, $8, now(), $7, now())`,
  [portrait, norte, T.id, dos.entry, fotoRow.id, `organizations/${norte}/roster-players/${fotoRow.id}/${portrait}.jpg`, P.foto.id, P.olga.id]);

  // Finish the competition: from here every official report row is guarded (completed).
  await w.rpc(P.olga, 'finish_tournament_competition', { p_organization_id: norte, p_tournament_id: T.id });
  onStep('finished');

  // ---- Torneo Solo (solo owns, alone): public page + listed catalog entry with WhatsApp
  const soloOrg = await w.organization(P.solo, 'Torneo Solo');
  const soloSeason = await w.season(P.solo, soloOrg, 'Unica');
  const soloT = await w.tournament(P.solo, soloOrg, soloSeason, 'solo');
  await w.rpc(P.solo, 'set_tournament_public_page_published', { p_organization_id: soloOrg, p_tournament_id: soloT.id, p_published: true });
  await w.q(`insert into public.tournament_catalog_listings(tournament_id, organization_id, status, applications_state, summary, contact_whatsapp, listed_at, listed_by, updated_by)
    values ($1, $2, 'listed', 'open', 'Torneo ficticio de prueba para el ensayo', '5491155550000', now(), $3, $3)`, [soloT.id, soloOrg, P.solo.id]);
  onStep('solo');

  // ---- Liga Premium (premium owns, alone) with an approved Premium purchase of its season — written as the payments service would.
  const premiumOrg = await w.organization(P.premium, 'Liga Premium');
  const premiumSeason = await w.season(P.premium, premiumOrg, 'Premium');
  await w.rpc(P.premium, 'update_tournament_season', { p_organization_id: premiumOrg, p_season_id: premiumSeason, p_status: 'active' });
  await w.q(`update public.tournament_commerce_production_settings set checkout_scope = 'open', reason = 'Ensayo de borrado de cuenta', updated_at = now()`);
  const checkout = await w.rpc(P.premium, 'create_tournament_season_production_checkout_purchase', { p_organization_id: premiumOrg, p_season_id: premiumSeason, p_idempotency_key: randomUUID() });
  const purchase = checkout.purchaseId ?? checkout.id ?? checkout.purchase?.id;
  await paymentsCall('public.record_production_tournament_purchase_preference', [purchase, `123456789-${randomUUID()}`, new Date(Date.now() + 30 * 60_000).toISOString()]);
  const approved = await paymentsCall('public.apply_production_tournament_payment_status',
    [purchase, 'approved', 'approved', null, String(Date.now()).slice(-9) + '7001', new Date().toISOString()]);
  if (approved?.outcome !== 'approved') throw new Error(`premium purchase not approved: ${JSON.stringify(approved)}`);
  await w.q(`update public.tournament_commerce_production_settings set checkout_scope = 'off', reason = 'Ensayo de borrado: cerrado', updated_at = now()`);

  // ---- Liga Colaborativa (lidia owns; carla is its only other member, a collaborator)
  const colab = await w.organization(P.lidia, 'Liga Colaborativa');
  await w.member(colab, P.carla, 'collaborator', 120);
  onStep('orgs');

  Object.assign(w.ids, { norte, seasonN, T, uno, dos, match, op, fixture, page, announcement, versionId, portrait, soloOrg, soloT, premiumOrg, premiumSeason, purchase, colab,
    pedroRow, paulaRow, fotoRow, capiManager });
  return w;
}
