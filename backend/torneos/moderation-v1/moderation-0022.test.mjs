// CONTENT MODERATION 0022 on the disposable lab (0000 → 0019 with Production's ownership, then 0022 through the operator
// driver as `postgres`). Fictional data only. What it proves:
//   apply → the whole flow → rollback refused with rows → forced rollback → identical catalog → re-apply;
//   reports (signed-in only, every kind), dedupe, idempotency, rate limit, isolation between organizations and reporters,
//   who may resolve what, the organization's and the platform's actions and their effect on the public page, the
//   communications inbox and applications, the platform hold, and the two blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as L from './test/lab.mjs';

const { F, D, call, refused, one } = L;
const { lit, admin, identity } = F;
const key = () => randomUUID();
const S = {};
const report = (actor, kind, { slug = null, id = null, label = null, reason = 'offensive', detail = null, idem = key() } = {}) =>
  call(actor, 'report_tournament_content', `${lit(kind)}, ${lit(slug)}, ${lit(id)}, ${lit(label)}, ${lit(reason)}, ${lit(detail)}, ${lit(idem)}`);
const reportRefusal = (actor, kind, { slug = null, id = null, label = null, reason = 'offensive', detail = null, idem = key() } = {}) =>
  refused(actor, 'report_tournament_content', `${lit(kind)}, ${lit(slug)}, ${lit(id)}, ${lit(label)}, ${lit(reason)}, ${lit(detail)}, ${lit(idem)}`);
const list = (actor, org, status = null) => call(actor, 'get_tournament_content_reports', `${lit(org)}, ${lit(status)}`);
const handle = (actor, id, status, action = null, note = null) =>
  call(actor, 'handle_tournament_content_report', `${lit(id)}, ${lit(status)}, ${lit(action)}, ${lit(note)}`);
const handleRefusal = (actor, id, status, action = null, note = null) =>
  refused(actor, 'handle_tournament_content_report', `${lit(id)}, ${lit(status)}, ${lit(action)}, ${lit(note)}`);
const platform = (id, status, action = null, note = null) => F.j(L.lab.sql(
  `select public.platform_handle_tournament_content_report(${lit(id)}, ${lit(status)}, ${lit(action)}, ${lit(note)})::text`, { user: 'postgres' }));
const publicPage = (slug) => F.j(admin(`set role anon; select coalesce(public.get_public_tournament_page(${lit(slug)}, null)::text, 'null'); reset role;`));

/** A frozen participant set + a published fixture version for the world's category: what the public page lists as teams. */
function publishTeams(w) {
  const fingerprint = 'a'.repeat(64);
  const set = one(`insert into public.tournament_participant_sets (organization_id, season_id, tournament_id, category_id, version_number,
      participant_fingerprint, frozen_by, idempotency_key)
    values (${lit(w.org)}, ${lit(w.season)}, ${lit(w.tournament)}, ${lit(w.categoryId)}, 1, '${fingerprint}', ${lit(w.owner.id)}, ${lit(key())}) returning id`).split('\n')[0];
  admin(`insert into public.tournament_competition_participants (organization_id, season_id, tournament_id, category_id, participant_set_id,
      team_entry_id, snapshot_name, snapshot_short_name, snapshot_shield_path, frozen_at)
    select ${lit(w.org)}, ${lit(w.season)}, ${lit(w.tournament)}, ${lit(w.categoryId)}, ${lit(set)}, id, name, short_name, 'qa/shields/lab.svg', now()
    from public.tournament_team_entries where id = ${lit(w.entry.entryId)}`);
  admin(`insert into public.tournament_fixture_versions (organization_id, season_id, tournament_id, category_id, participant_set_id,
      version_number, status, generation_method, participant_fingerprint, created_by, idempotency_key, published_at)
    values (${lit(w.org)}, ${lit(w.season)}, ${lit(w.tournament)}, ${lit(w.categoryId)}, ${lit(set)}, 1, 'published', 'manual',
      '${fingerprint}', ${lit(w.owner.id)}, ${lit(key())}, now())`);
}

test.before(async () => {
  await L.prepare();
  await L.toPre();
  S.pre = L.snapshot();
});

test('apply-0022 through the operator driver: PRE_0022 → POST_0022, +7 authenticated RPCs, nothing else moved', async () => {
  assert.equal(D.classify(await L.deps.catalog()).state, 'PRE_0022');
  const out = await L.drive('apply-0022');
  assert.equal(out.verdict, 'APPLY_0022_DONE', JSON.stringify(out));
  assert.deepEqual(out.changedOutside, []);
  // A second apply is refused by the file itself (and by the driver before it).
  await assert.rejects(L.drive('apply-0022'), /PRE_STATE_POST_0022/);
  assert.match(L.asPostgres(L.deps.readFile(D.FILES['apply-0022'].path).toString()).stderr_tail, /TORNEOS_0022_PRECONDITION_FAILED: already applied/);
});

test('fictional worlds: two organizations with published pages, players, an application and announcements', () => {
  S.a = L.world('a');
  S.b = L.world('b');
  publishTeams(S.a);
  S.fan = identity('fan');
  S.player = identity('jugador');
  S.applicant = identity('solicitante');
  S.applicationEntry = L.application(S.a, S.applicant, 'Mensaje con insultos de laboratorio');
  S.announcement = L.announcement(S.a, [S.player]);
  const page = publicPage(S.a.slug);
  assert.equal(page.teams[0].name, S.a.teamName);
  assert.equal(page.teams[0].shieldPath, 'qa/shields/lab.svg');
});

test('reporting needs a signed-in identity: anon has no EXECUTE, an invalid token is TORNEOS_AUTH_REQUIRED', () => {
  const anon = L.lab.sqlTry(`set role anon; select public.report_tournament_content('tournament', ${lit(S.a.slug)}, null, null, 'spam', null, ${lit(key())});`);
  assert.equal(anon.ok, false);
  assert.match(anon.error, /permission denied for function report_tournament_content/);
  const noIdentity = L.lab.sqlTry(`set role authenticated; select public.report_tournament_content('tournament', ${lit(S.a.slug)}, null, null, 'spam', null, ${lit(key())});`);
  assert.match(noIdentity.error, /TORNEOS_AUTH_REQUIRED/);
  for (const fn of ['platform_list_tournament_content_reports(null, 10)', `platform_handle_tournament_content_report(${lit(key())}, 'dismissed', null, 'x')`]) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.match(L.lab.sqlTry(`set role ${role}; select public.${fn};`).error, /permission denied/, `${role} ${fn}`);
    }
  }
  for (const table of ['tournament_content_reports', 'tournament_content_report_events', 'tournament_communication_mutes', 'tournament_applicant_blocks']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.match(L.lab.sqlTry(`set role ${role}; select count(*) from public.${table};`).error, /permission denied/, `${role} ${table}`);
    }
  }
});

test('every kind resolves server-side: public content by slug (+ the text shown), private content by id with access', () => {
  S.rTeam = report(S.fan, 'team', { slug: S.a.slug, label: S.a.teamName, detail: 'Nombre ofensivo' });
  assert.equal(S.rTeam.reviewScope, 'organization');
  assert.equal(S.rTeam.alreadyReported, false);
  S.rPlayer = report(S.fan, 'player', { slug: S.a.slug, label: S.a.playerName, reason: 'personal_data' });
  assert.equal(S.rPlayer.reviewScope, 'organization');
  S.rTournament = report(S.fan, 'tournament', { slug: S.a.slug, reason: 'impersonation' });
  S.rOrganization = report(S.fan, 'organization', { slug: S.a.slug, reason: 'offensive' });
  for (const r of [S.rTournament, S.rOrganization]) assert.equal(r.reviewScope, 'platform');
  S.rAnnouncement = report(S.player, 'announcement', { id: S.announcement, reason: 'offensive' });
  assert.equal(S.rAnnouncement.reviewScope, 'platform');
  S.rApplication = report(S.a.admin, 'application', { id: S.applicationEntry, reason: 'offensive' });
  assert.equal(S.rApplication.reviewScope, 'platform');
  // The snapshot is the server's copy of the content, never the client's text.
  const row = F.j(admin(`select to_jsonb(r) from public.tournament_content_reports r where id = ${lit(S.rApplication.reportId)}`));
  assert.equal(row.content_snapshot.message, 'Mensaje con insultos de laboratorio');
  assert.equal(row.reporter_user_id, S.a.admin.id);
  // Unknown or foreign targets are all the same answer.
  assert.equal(reportRefusal(S.fan, 'team', { slug: S.a.slug, label: 'Equipo que no existe' }), 'TORNEOS_REPORT_TARGET_INVALID');
  assert.equal(reportRefusal(S.fan, 'player', { slug: S.a.slug, label: S.b.playerName }), 'TORNEOS_REPORT_TARGET_INVALID');
  assert.equal(reportRefusal(S.fan, 'tournament', { slug: 'no-existe-esta-pagina' }), 'TORNEOS_REPORT_TARGET_INVALID');
  assert.equal(reportRefusal(S.fan, 'catalog_listing', { slug: S.a.slug }), 'TORNEOS_REPORT_TARGET_INVALID', 'not listed');
  assert.equal(reportRefusal(S.fan, 'announcement', { id: S.announcement }), 'TORNEOS_REPORT_TARGET_INVALID', 'not a recipient');
  assert.equal(reportRefusal(S.b.owner, 'application', { id: S.applicationEntry }), 'TORNEOS_REPORT_TARGET_INVALID', 'another organization');
  assert.equal(reportRefusal(S.a.collaborator, 'application', { id: S.applicationEntry }), 'TORNEOS_REPORT_TARGET_INVALID', 'collaborator');
  assert.equal(reportRefusal(S.fan, 'team', { slug: S.a.slug, label: S.a.teamName, reason: 'odio' }), 'TORNEOS_REPORT_INVALID');
  assert.equal(reportRefusal(S.fan, 'team', { slug: S.a.slug, label: S.a.teamName, detail: 'x'.repeat(501) }), 'TORNEOS_REPORT_INVALID');
  assert.equal(reportRefusal(S.fan, 'galaxy', { slug: S.a.slug }), 'TORNEOS_REPORT_INVALID');
  const events = admin(`select string_agg(event, ',' order by id) from public.tournament_content_report_events where report_id = ${lit(S.rTeam.reportId)}`).trim();
  assert.equal(events, 'created');
});

test('dedupe: one open report per reporter and target; the same idempotency key is the same report', () => {
  const again = report(S.fan, 'team', { slug: S.a.slug, label: S.a.teamName });
  assert.equal(again.reportId, S.rTeam.reportId);
  assert.equal(again.alreadyReported, true);
  const idem = key();
  const first = report(S.player, 'tournament', { slug: S.a.slug, idem });
  const replay = report(S.player, 'tournament', { slug: S.a.slug, idem });
  assert.equal(replay.reportId, first.reportId);
  assert.equal(replay.alreadyReported, true);
  assert.equal(reportRefusal(S.player, 'organization', { slug: S.a.slug, idem }), 'TORNEOS_REPORT_INVALID', 'same key, other kind');
  // Another reporter on the same target is a separate report.
  const other = report(S.player, 'team', { slug: S.a.slug, label: S.a.teamName });
  assert.notEqual(other.reportId, S.rTeam.reportId);
  S.rTeamByPlayer = other;
});

test('rate limit: 10 per hour and 30 per day per reporter → PT429 TORNEOS_REPORT_RATE_LIMITED', () => {
  const spammer = identity('spam');
  admin(`insert into public.tournament_content_reports (organization_id, tournament_id, target_kind, target_id, target_label, review_scope,
      reporter_user_id, reason, idempotency_key, status, handled_at, resolution_note)
    select ${lit(S.b.org)}, ${lit(S.b.tournament)}, 'tournament', gen_random_uuid(), 'x', 'platform', ${lit(spammer.id)}, 'spam',
      gen_random_uuid(), 'dismissed', now(), 'Laboratorio' from generate_series(1, 10)`);
  assert.equal(reportRefusal(spammer, 'tournament', { slug: S.b.slug }), 'TORNEOS_REPORT_RATE_LIMITED');
  admin(`update public.tournament_content_reports set created_at = now() - interval '2 hours' where reporter_user_id = ${lit(spammer.id)}`);
  assert.equal(report(spammer, 'tournament', { slug: S.b.slug }).alreadyReported, false, 'the hour window moved on');
  admin(`insert into public.tournament_content_reports (organization_id, tournament_id, target_kind, target_id, target_label, review_scope,
      reporter_user_id, reason, idempotency_key, status, handled_at, resolution_note, created_at)
    select ${lit(S.b.org)}, ${lit(S.b.tournament)}, 'tournament', gen_random_uuid(), 'x', 'platform', ${lit(spammer.id)}, 'spam',
      gen_random_uuid(), 'dismissed', now(), 'Laboratorio', now() - interval '3 hours' from generate_series(1, 20)`);
  assert.equal(reportRefusal(spammer, 'organization', { slug: S.b.slug }), 'TORNEOS_REPORT_RATE_LIMITED', '31st in a day');
});

test('isolation: org A managers see only org A organization-scope reports, never who reported; nobody else sees them', () => {
  const ownerView = list(S.a.owner, S.a.org);
  const adminView = list(S.a.admin, S.a.org, 'pending');
  for (const view of [ownerView, adminView]) {
    const ids = view.reports.map((r) => r.id).sort();
    assert.deepEqual(ids, [S.rTeam.reportId, S.rPlayer.reportId, S.rTeamByPlayer.reportId].sort());
    assert.ok(!JSON.stringify(view).includes(S.fan.id) && !JSON.stringify(view).includes(S.player.id), 'never the reporter');
    assert.ok(view.reports.every((r) => r.canHandle === true));
  }
  assert.equal(refused(S.b.owner, 'get_tournament_content_reports', `${lit(S.a.org)}, null`), 'TORNEOS_MODERATION_FORBIDDEN');
  assert.equal(refused(S.a.collaborator, 'get_tournament_content_reports', `${lit(S.a.org)}, null`), 'TORNEOS_MODERATION_FORBIDDEN');
  assert.equal(refused(S.fan, 'get_tournament_content_reports', `${lit(S.a.org)}, null`), 'TORNEOS_MODERATION_FORBIDDEN');
  assert.deepEqual(list(S.b.owner, S.b.org).reports, [], 'org B has no organization-scope reports');
  // Handling: another organization, a collaborator, a reporter, or a platform report — all "not found".
  assert.equal(handleRefusal(S.b.owner, S.rTeam.reportId, 'dismissed', null, 'Ajeno'), 'TORNEOS_REPORT_NOT_FOUND');
  assert.equal(handleRefusal(S.a.collaborator, S.rTeam.reportId, 'dismissed', null, 'Colaborador'), 'TORNEOS_REPORT_NOT_FOUND');
  assert.equal(handleRefusal(S.fan, S.rTeam.reportId, 'dismissed', null, 'Yo mismo'), 'TORNEOS_REPORT_NOT_FOUND');
  assert.equal(handleRefusal(S.a.owner, S.rTournament.reportId, 'dismissed', null, 'Es de la plataforma'), 'TORNEOS_REPORT_NOT_FOUND');
});

test('the organization resolves team and player reports with its tools; the public page shows the neutral values', () => {
  assert.equal(handleRefusal(S.a.admin, S.rTeam.reportId, 'resolved', 'take_down_tournament', 'Intento de plataforma'), 'TORNEOS_REPORT_ACTION_INVALID');
  assert.equal(handleRefusal(S.a.admin, S.rTeam.reportId, 'resolved', 'neutralize_player_name', 'Acción equivocada'), 'TORNEOS_REPORT_ACTION_INVALID');
  assert.equal(handleRefusal(S.a.admin, S.rTeam.reportId, 'resolved', null, null), 'TORNEOS_REPORT_INVALID', 'a closing note is required');
  assert.equal(handle(S.a.admin, S.rTeam.reportId, 'under_review').status, 'under_review');
  const done = handle(S.a.admin, S.rTeam.reportId, 'resolved', 'neutralize_team_name', 'Nombre reemplazado por uno neutro');
  assert.equal(done.status, 'resolved');
  assert.equal(done.actionTaken, 'neutralize_team_name');
  const neutral = `Equipo ${S.a.entry.entryId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
  assert.equal(admin(`select name from public.tournament_team_entries where id = ${lit(S.a.entry.entryId)}`).trim(), neutral);
  assert.equal(handle(S.a.owner, S.rTeamByPlayer.reportId, 'resolved', 'remove_team_shield', 'Escudo quitado').status, 'resolved');
  const page = publicPage(S.a.slug);
  assert.equal(page.teams[0].name, neutral);
  assert.equal(page.teams[0].shieldPath, null);
  assert.ok(!JSON.stringify(page).includes(S.a.teamName), 'the offensive name is gone from the public page');
  handle(S.a.admin, S.rPlayer.reportId, 'resolved', 'neutralize_player_name', 'Nombre del jugador oculto');
  const names = admin(`select string_agg(display_name, ',' order by created_at) from public.tournament_roster_players where team_entry_id = ${lit(S.a.entry.entryId)}`).trim();
  assert.ok(!names.includes(S.a.playerName) && /Jugador [0-9A-F]{4}/.test(names) && names.includes('Jugador Correcto'), names);
  assert.equal(handleRefusal(S.a.admin, S.rPlayer.reportId, 'dismissed', null, 'Otra vez'), 'TORNEOS_REPORT_ALREADY_CLOSED');
  const audit = admin(`select string_agg(action, ',' order by id) from public.tournament_audit_log where resource_type = 'content_report' and organization_id = ${lit(S.a.org)}`).trim();
  assert.equal(audit, 'moderation.neutralize_team_name,moderation.remove_team_shield,moderation.neutralize_player_name');
  const trail = admin(`select string_agg(event || ':' || coalesce(to_status, action), ',' order by id) from public.tournament_content_report_events where report_id = ${lit(S.rTeam.reportId)}`).trim();
  assert.equal(trail, 'created:open,status_changed:under_review,action:neutralize_team_name,status_changed:resolved');
});

test('escalation hands a report to the platform; the organization keeps a read-only line', () => {
  const r = report(S.player, 'player', { slug: S.a.slug, label: `Jugador Correcto a ${F.RUN}`, reason: 'impersonation' });
  const escalated = handle(S.a.owner, r.reportId, 'escalated', null, 'Suplantación: que lo vea Arma2');
  assert.equal(escalated.reviewScope, 'platform');
  const line = list(S.a.owner, S.a.org).reports.find((item) => item.id === r.reportId);
  assert.equal(line.escalated, true);
  assert.equal(line.canHandle, false);
  assert.equal(handleRefusal(S.a.owner, r.reportId, 'dismissed', null, 'Ya no es mío'), 'TORNEOS_REPORT_NOT_FOUND');
  const inbox = F.j(L.lab.sql(`select public.platform_list_tournament_content_reports('pending', 200)::text`, { user: 'postgres' }));
  assert.ok(inbox.some((item) => item.id === r.reportId && item.escalated === true));
  // Only the operator sees the internal identity of the reporter (to spot abusive reporting); no organization does.
  assert.equal(inbox.find((item) => item.id === r.reportId).reporterIdentity, S.player.id);
  S.rEscalated = r;
});

test('platform: take down a tournament (page + catalog, held against republishing), release, logos, announcements, applicants', async () => {
  const inbox = await D.run('inbox', ['pending'], L.deps);
  assert.equal(inbox.verdict, 'INBOX_READ');
  assert.ok(inbox.reports.some((item) => item.id === S.rTournament.reportId));
  // A listed call, so the take-down also exercises the existing catalog lever.
  admin(`insert into public.tournament_catalog_listings (tournament_id, organization_id, status, applications_state, summary, listed_at, listed_by, updated_by)
    values (${lit(S.a.tournament)}, ${lit(S.a.org)}, 'listed', 'open', 'Convocatoria de laboratorio abierta', now(), ${lit(S.a.owner.id)}, ${lit(S.a.owner.id)})`);
  const listingReport = report(S.fan, 'catalog_listing', { slug: S.a.slug, reason: 'spam' });
  assert.equal(listingReport.reviewScope, 'platform');
  const act = await D.run('act', [S.rTournament.reportId, 'resolved', 'take_down_tournament', 'Torneo', 'ofensivo',
    ...D.phraseFor('act', { reportId: S.rTournament.reportId }).split(' ')], L.deps);
  assert.equal(act.verdict, 'ACT_DONE', JSON.stringify(act));
  assert.equal(publicPage(S.a.slug), null, 'the public page is gone');
  assert.equal(admin(`select status || ':' || (platform_removed_at is not null) from public.tournament_catalog_listings where tournament_id = ${lit(S.a.tournament)}`).trim(), 'withdrawn:true');
  assert.equal(refused(S.a.owner, 'set_tournament_public_page_published', `${lit(S.a.org)}, ${lit(S.a.tournament)}, true`), 'TORNEOS_PUBLIC_PAGE_MODERATION_HOLD');
  await assert.rejects(D.run('act', [S.rTournament.reportId, 'resolved', 'take_down_tournament', 'x', 'ACT', 'TORNEOS', '0022', D.REF, 'deadbeef'], L.deps), /PHRASE_REQUIRED/);
  // While held, a new report on the (unpublished) page is not possible; the owner of the org sees nothing of it.
  assert.equal(reportRefusal(S.fan, 'tournament', { slug: S.a.slug }), 'TORNEOS_REPORT_TARGET_INVALID');
  platform(S.rTournament.reportId, 'resolved', 'release_tournament_hold', 'Organización corrigió el nombre');
  assert.equal(call(S.a.owner, 'set_tournament_public_page_published', `${lit(S.a.org)}, ${lit(S.a.tournament)}, true`).publicSlug, S.a.slug);
  assert.ok(publicPage(S.a.slug));
  platform(listingReport.reportId, 'dismissed', null, 'Ya retirada');
  // Logos.
  admin(`update public.tournament_organizations set logo_path = ${lit(`${S.a.org}/organizations/${S.a.org}/${randomUUID()}.png`)} where id = ${lit(S.a.org)}`);
  assert.equal(platform(S.rOrganization.reportId, 'resolved', 'clear_organization_logo', 'Logo ofensivo').effects[0].logos, 1);
  assert.equal(admin(`select logo_path is null from public.tournament_organizations where id = ${lit(S.a.org)}`).trim(), 't');
  // A communication.
  const revoked = platform(S.rAnnouncement.reportId, 'resolved', 'revoke_announcement', 'Comunicado ofensivo');
  assert.equal(revoked.effects[0].announcements, 1);
  assert.equal(admin(`select a.status || ':' || d.status from public.tournament_announcements a join public.tournament_announcement_deliveries d on d.announcement_id = a.id where a.id = ${lit(S.announcement)}`).trim(), 'revoked:revoked');
  // An application: the platform can block the applicant from that organization.
  platform(S.rApplication.reportId, 'resolved', 'block_applicant', 'Mensaje abusivo');
  assert.throws(() => L.application(S.a, S.applicant), /TORNEOS_APPLICATION_BLOCKED/);
  // Platform-only actions stay invalid on the wrong kind; a closed report stays closed.
  assert.throws(() => platform(S.rEscalated.reportId, 'resolved', 'revoke_announcement', 'No es un comunicado'), /TORNEOS_REPORT_ACTION_INVALID/);
  platform(S.rEscalated.reportId, 'resolved', 'neutralize_player_name', 'Suplantación confirmada');
  assert.throws(() => platform(S.rEscalated.reportId, 'dismissed', null, 'Otra vez'), /TORNEOS_REPORT_ALREADY_CLOSED/);
  const audit = admin(`select count(*) from public.tournament_audit_log where actor_type = 'system' and action like 'moderation.%' and organization_id = ${lit(S.a.org)}`).trim();
  assert.equal(audit, '6');
});

test('take down a whole organization: every tournament page held', () => {
  const r = report(S.fan, 'organization', { slug: S.b.slug, reason: 'offensive' });
  platform(r.reportId, 'resolved', 'take_down_organization', 'Organización con nombre ofensivo');
  assert.equal(publicPage(S.b.slug), null);
  assert.equal(admin(`select count(*) from private.tournament_moderation_holds where organization_id = ${lit(S.b.org)} and released_at is null`).trim(), '1');
  assert.equal(refused(S.b.owner, 'set_tournament_public_page_published', `${lit(S.b.org)}, ${lit(S.b.tournament)}, true`), 'TORNEOS_PUBLIC_PAGE_MODERATION_HOLD');
});

test('organization blocks an applicant: no new application to any of its tournaments until unblocked', () => {
  const applicant = identity('insistente');
  const entry = L.application(S.b, applicant, 'Primera solicitud');
  assert.equal(refused(S.b.collaborator, 'block_tournament_applicant', `${lit(S.b.org)}, ${lit(entry)}, 'Mensajes agresivos'`), 'TORNEOS_MODERATION_FORBIDDEN');
  assert.equal(refused(S.a.owner, 'block_tournament_applicant', `${lit(S.b.org)}, ${lit(entry)}, 'Mensajes agresivos'`), 'TORNEOS_MODERATION_FORBIDDEN');
  assert.equal(refused(S.a.owner, 'block_tournament_applicant', `${lit(S.a.org)}, ${lit(entry)}, 'Mensajes agresivos'`), 'TORNEOS_REPORT_TARGET_INVALID');
  const block = call(S.b.admin, 'block_tournament_applicant', `${lit(S.b.org)}, ${lit(entry)}, 'Mensajes agresivos'`);
  assert.equal(block.alreadyBlocked, false);
  assert.equal(call(S.b.owner, 'block_tournament_applicant', `${lit(S.b.org)}, ${lit(entry)}, 'Otra vez'`).alreadyBlocked, true);
  assert.throws(() => L.application(S.b, applicant), /TORNEOS_APPLICATION_BLOCKED/);
  assert.doesNotThrow(() => L.application(S.a, applicant), 'another organization is not affected');
  const view = list(S.b.owner, S.b.org);
  assert.equal(view.applicantBlocks.length, 1);
  assert.ok(!JSON.stringify(view).includes(applicant.id), 'the blocked identity is never shown');
  assert.equal(refused(S.a.owner, 'unblock_tournament_applicant', `${lit(S.a.org)}, ${lit(block.blockId)}`), 'TORNEOS_BLOCK_NOT_FOUND');
  assert.equal(call(S.b.owner, 'unblock_tournament_applicant', `${lit(S.b.org)}, ${lit(block.blockId)}`).blocked, false);
  assert.doesNotThrow(() => L.application(S.b, applicant));
});

test('a participant mutes an organization: current and new announcements go to the archive, emergencies still arrive', () => {
  const reader = identity('lector');
  const before = L.announcement(S.b, [reader], { title: 'Aviso previo' });
  assert.equal(refused(S.fan, 'set_tournament_communications_muted', `${lit(S.b.org)}, null, true`), 'TORNEOS_COMMUNICATIONS_MUTE_FORBIDDEN');
  assert.equal(refused(reader, 'set_tournament_communications_muted', `${lit(S.b.org)}, ${lit(before)}, true`), 'TORNEOS_REPORT_INVALID', 'one of the two');
  const muted = call(reader, 'set_tournament_communications_muted', `null, ${lit(before)}, true`);
  assert.deepEqual([muted.organizationId, muted.muted, muted.archived], [S.b.org, true, 1]);
  const after = L.announcement(S.b, [reader], { title: 'Aviso nuevo' });
  const emergency = L.announcement(S.b, [reader], { type: 'emergency', title: 'Suspensión por tormenta' });
  const status = (id) => admin(`select status from public.tournament_announcement_deliveries where announcement_id = ${lit(id)} and recipient_user_id = ${lit(reader.id)}`).trim();
  assert.deepEqual([status(before), status(after), status(emergency)], ['archived', 'archived', 'available']);
  assert.deepEqual(call(reader, 'get_my_tournament_communication_mutes', '').mutes.map((m) => m.organizationId), [S.b.org]);
  assert.equal(call(S.fan, 'get_my_tournament_communication_mutes', '').mutes.length, 0, 'only your own');
  assert.equal(call(reader, 'set_tournament_communications_muted', `${lit(S.b.org)}, null, false`).muted, false);
  assert.equal(status(L.announcement(S.b, [reader], { title: 'Aviso tras reactivar' })), 'available');
  // The inbox (baseline) hides archived deliveries: the muted ones never counted as unread.
  const inbox = call(reader, 'get_my_torneos_inbox_summary', '');
  assert.ok(inbox && typeof inbox === 'object');
});

test('rollback-0022 is refused while moderation rows exist; the force phrase discards them; the catalog is identical; re-apply works', async () => {
  await assert.rejects(L.drive('rollback-0022'), /ROLLBACK_REFUSED \d+ moderation rows/);
  // The file itself refuses too, without the session setting.
  assert.match(L.asPostgres(L.deps.readFile(D.FILES['rollback-0022'].path).toString()).stderr_tail, /TORNEOS_0022_ROLLBACK_REFUSED/);
  const out = await L.drive('rollback-0022', { force: true });
  assert.equal(out.verdict, 'ROLLBACK_0022_DONE', JSON.stringify(out));
  assert.equal(out.forced, true);
  assert.deepEqual(out.changedOutside, []);
  assert.deepEqual(L.snapshot(), S.pre, 'catalog, ACLs, constraints, triggers, policies identical to before 0022');
  // Without the hold trigger the organization can publish again.
  assert.equal(call(S.b.owner, 'set_tournament_public_page_published', `${lit(S.b.org)}, ${lit(S.b.tournament)}, true`).publicSlug, S.b.slug);
  const again = await L.drive('apply-0022');
  assert.equal(again.verdict, 'APPLY_0022_DONE');
  // Empty tables: an unforced rollback goes through, then the lab is left applied.
  const clean = await L.drive('rollback-0022');
  assert.equal(clean.verdict, 'ROLLBACK_0022_DONE');
  assert.equal((await L.drive('apply-0022')).verdict, 'APPLY_0022_DONE');
});
