// ACCOUNT ERASURE 0021 — the erasure itself, on the hosted-like lab (Production's ownership: everything owned by the
// non-superuser installer `postgres`), with FICTIONAL people only (test/world.mjs). Every person the design names is
// erased through the gateway's own database path (the core-adapter login, SET LOCAL ROLE torneos_core_adapter) and the
// outcome is checked table by table: deleted / anonymised / kept. Also: idempotency, a failure injected mid-way and the
// retry, isolation (one person's erasure never moves another's data, nor any other organization's), permissions, no
// orphan organizations, public pages and standings numerically unchanged, purchases byte-identical.
//   node --test --test-concurrency=1 backend/torneos/account-deletion-v1/erasure-0021.test.mjs
//   ACCOUNT_DELETION_EVIDENCE=1 …   writes evidence/erasure-0021-lab.jsonl
//   ACCOUNT_DELETION_WITH_0020=<0020 sql> …   the same on main + 0020 (sponsors), its own lab container
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { prepare, toPost, installerPool, gatewayLoginUrl, lab, WITH_0020 } from './test/lab.mjs';
import { buildWorld, RUN } from './test/world.mjs';
import { adapterDb, changedTables, digests, evidence, publicPage, refusalAs, withoutNames } from './test/support.mjs';

const record = evidence('erasure-0021-lab');
let pool; let db; let pay; let writer; let adapter; let w; let P; let I;
const step = async (name, fn) => {
  try { const details = await fn(); record({ check: name, ok: true, ...(details ? { details } : {}) }); }
  catch (error) { record({ check: name, ok: false, error: String(error.message).slice(0, 400) }); throw error; }
};
const rows = async (text, params = []) => (await pool.query(text, params)).rows;
const val = async (text, params = []) => { const r = await rows(text, params); return r[0] ? Object.values(r[0])[0] : null; };
const label = (kind, person, org) => val('select private.account_erasure_label($1, $2, $3)', [kind, person.id, org]);
const orgsOfRun = () => [I.norte, I.soloOrg, I.premiumOrg, I.colab];
/** Rows of OTHER worlds (earlier runs on this disposable lab): must never move, whoever is erased here. */
async function othersDigest() {
  const { rows: r } = await pool.query(`select
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.tournament_roster_players x where not (x.organization_id = any($1))) roster,
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.tournament_team_managers x where not (x.organization_id = any($1))) managers,
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.tournament_organization_members x where not (x.organization_id = any($1))) members,
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.tournament_organizations x where not (x.id = any($1))) orgs,
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.tournament_match_squad_players x where not (x.organization_id = any($1))) squads,
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.tournament_user_profiles x where not (x.user_id = any($2))) profiles,
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.torneos_identity x where not (x.id = any($2))) identities,
    (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.tournament_purchases x) purchases`, [orgsOfRun(), Object.values(P).map((p) => p.id)]);
  return r[0];
}

test.before(async () => {
  await prepare();
  await toPost();
  pool = installerPool();
  db = adapterDb();
  pay = new pg.Pool({ connectionString: lab.loginUrl('production'), max: 1 });
  writer = new pg.Pool({ connectionString: gatewayLoginUrl('identityWriter'), max: 1 });
  adapter = new pg.Pool({ connectionString: gatewayLoginUrl('coreAdapter'), max: 1 });
  const paymentsCall = async (fn, args) => {
    const c = await pay.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE torneos_payment_production_service');
      const { rows: r } = await c.query(`SELECT ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args);
      await c.query('COMMIT'); return r[0].r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  };
  w = await buildWorld(pool, { paymentsCall });
  P = w.people; I = w.ids;
  if (WITH_0020) {
    // A sponsor created by olga in Liga Norte: its creator link must go, the sponsor (organization content) stays.
    await pool.query(`insert into public.tournament_organization_sponsors(organization_id, name, created_by) values ($1, 'Panadería Ficticia', $2)`, [I.norte, P.olga.id]);
  }
  record({ check: 'world', ok: true, details: { run: RUN, with0020: Boolean(WITH_0020), people: Object.keys(P).length,
    organizations: orgsOfRun().length } });
});
test.after(async () => { await db?.end(); await pool?.end(); await pay?.end(); await writer?.end(); await adapter?.end(); });

let pageBefore; let projectionBefore; let othersBefore; let purchaseBefore;
test('E0 baseline: the public page shows the real player names; official history, standings and the purchase are captured', async () => step('E0 baseline', async () => {
  pageBefore = await publicPage(pool, I.page.publicSlug ?? I.page.public_slug ?? await val('select public_slug from public.tournament_public_pages where tournament_id = $1', [I.T.id]));
  assert.ok(pageBefore, 'the published page is served');
  assert.match(JSON.stringify(pageBefore), /Pedro Ficticio/, 'pedro is named on the public page before the erasure');
  projectionBefore = await digests(pool, ['public.tournament_match_events', 'public.tournament_match_scores', 'public.tournament_match_outcomes',
    'public.tournament_player_statistics', 'public.tournament_team_standings', 'public.tournament_discipline_ledgers', 'public.tournament_standings_revisions',
    'public.tournament_announcements', 'public.tournament_document_acknowledgements', 'public.tournament_announcement_deliveries']);
  purchaseBefore = await rows(`select to_jsonb(p) row, (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') from public.tournament_purchase_events e where e.purchase_id = p.id) events,
    (select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]') from public.tournament_season_plan_grants g where g.origin_purchase_id = p.id) grants
    from public.tournament_purchases p where p.id = $1`, [I.purchase]);
  assert.equal(purchaseBefore[0].row.status, 'approved');
  othersBefore = await othersDigest();
  return { players: pageBefore.competition?.[0]?.players?.length, purchase: purchaseBefore[0].row.status };
}));

test('E1 permissions: only torneos_core_adapter may erase; no client role reads the ledger or calls the pseudonym', async () => step('E1 permissions', async () => {
  const call = 'select private.erase_tournament_account(gen_random_uuid(), gen_random_uuid())';
  const out = {};
  const as = (role) => (role === 'torneos_identity_writer' ? writer : pool);
  for (const role of ['anon', 'authenticated', 'service_role', 'torneos_identity_writer']) {
    out[role] = await refusalAs(as(role), role, call);
    assert.match(out[role] ?? '', /permission denied/, `${role} must not erase`);
    assert.match(await refusalAs(as(role), role, 'select count(*) from private.tournament_account_erasures') ?? '', /permission denied/, `${role} must not read the ledger`);
    assert.match(await refusalAs(as(role), role, "select private.account_erasure_label('x', gen_random_uuid(), null)") ?? '', /permission denied/);
  }
  // The gateway's role may call it (a random Core user: no_identity, nothing written), and nothing else.
  assert.equal(await refusalAs(adapter, 'torneos_core_adapter', call), null, 'the gateway role may');
  assert.match(await refusalAs(adapter, 'torneos_core_adapter', 'select count(*) from private.tournament_account_erasures') ?? '', /permission denied/, 'the adapter only calls; it never reads the ledger');
  assert.match(await refusalAs(adapter, 'torneos_core_adapter', "update public.torneos_identity set core_user_id = gen_random_uuid() where false") ?? '', /permission denied/, 'no direct write on identities');
  return out;
}));

test('E2 a Core user who never used Torneos: no_identity, nothing moves anywhere', async () => step('E2 nadie', async () => {
  const before = await digests(pool);
  const r = await db.erase(P.nadie.core);
  assert.equal(r.outcome, 'no_identity');
  assert.deepEqual(changedTables(before, await digests(pool)), []);
  return r;
}));

let pedroSummary;
test('E3 pedro (player with goals and a card, official report, completed tournament): pseudonym everywhere, numbers kept, personal rows deleted', async () => step('E3 pedro', async () => {
  const pseudo = await label('Jugador eliminado', P.pedro, I.norte);
  const before = await digests(pool);
  pedroSummary = await db.erase(P.pedro.core);
  assert.equal(pedroSummary.outcome, 'erased');
  const c = pedroSummary.counts;
  assert.deepEqual([c.rosterPlayersAnonymised, c.squadSnapshotsAnonymised, c.matchReportSnapshotsAnonymised, c.availabilityNotesCleared,
    c.coreSnapshotsScrubbed, c.coreAttestationsDeleted, c.notificationsDeleted, c.notificationPreferencesDeleted, c.hubPreferencesDeleted, c.profilesDeleted],
  [1, 1, 1, 1, 1, 2, 1, 1, 1, 1], JSON.stringify(c));
  // ANONYMISED
  const roster = await rows('select display_name, avatar_url, arma2_user_id, shirt_number, status from public.tournament_roster_players where id = $1', [I.pedroRow.id]);
  assert.deepEqual(roster[0], { display_name: pseudo, avatar_url: null, arma2_user_id: P.pedro.id, shirt_number: 9, status: 'active' });
  assert.match(pseudo, /^Jugador eliminado [0-9A-F]{6}$/);
  assert.deepEqual(await rows('select display_name_snapshot, avatar_url_snapshot from public.tournament_match_squad_players where roster_player_id = $1', [I.pedroRow.id]),
    [{ display_name_snapshot: pseudo, avatar_url_snapshot: null }]);
  assert.deepEqual(await rows('select display_name_snapshot, avatar_url_snapshot from public.tournament_match_operation_players where roster_player_id = $1', [I.pedroRow.id]),
    [{ display_name_snapshot: pseudo, avatar_url_snapshot: null }]);
  assert.equal(await val('select comment from public.tournament_match_availability_responses where roster_player_id = $1', [I.pedroRow.id]), null);
  const snapshot = await val('select players from private.tournament_team_entry_core_snapshots where team_entry_id = $1', [I.uno.entry]);
  assert.deepEqual(snapshot.map((p) => p.display_name), ['Rival Ficticio'], 'pedro left the frozen Core snapshot; his teammate stays');
  // DELETED
  for (const [table, column] of [['tournament_user_profiles', 'user_id'], ['tournament_user_notifications', 'recipient_user_id'],
    ['tournament_notification_preferences', 'user_id'], ['tournament_participant_hub_preferences', 'user_id']]) {
    assert.equal(await val(`select count(*)::int from public.${table} where ${column} = $1`, [P.pedro.id]), 0, table);
  }
  assert.equal(await val(`select count(*)::int from private.core_contract_attestations where identity_id = $1 or strpos(response::text, $2) > 0`, [P.pedro.id, P.pedro.core]), 0);
  // SEVERED identity, KEPT history (same identity row, pointed at by the events, deliveries and acknowledgements)
  assert.equal(await val('select count(*)::int from public.torneos_identity where core_user_id = $1', [P.pedro.core]), 0);
  assert.equal(await val('select count(*)::int from public.torneos_identity where id = $1', [P.pedro.id]), 1);
  assert.equal(await val('select count(*)::int from public.tournament_match_events where roster_player_id = $1 and voided_at is null', [I.pedroRow.id]), 3, 'two goals and a card');
  assert.equal(await val('select count(*)::int from public.tournament_document_acknowledgements where user_id = $1', [P.pedro.id]), 1);
  assert.equal(await val('select count(*)::int from public.tournament_announcement_deliveries where recipient_user_id = $1', [P.pedro.id]), 1);
  const ledger = await rows('select core_user_sha256, identity_id from private.tournament_account_erasures where identity_id = $1', [P.pedro.id]);
  assert.equal(ledger.length, 1);
  assert.match(ledger[0].core_user_sha256, /^[0-9a-f]{64}$/);
  // PUBLIC: the page no longer names him, the numbers are the same.
  const page = await publicPage(pool, pageBefore.publicSlug);
  assert.doesNotMatch(JSON.stringify(page), /Pedro/);
  assert.match(JSON.stringify(page), new RegExp(pseudo));
  assert.deepEqual(withoutNames(page), withoutNames(pageBefore));
  const moved = changedTables(before, await digests(pool));
  return { counts: c, pseudonym: pseudo, tablesMoved: moved };
}));

test('E4 idempotency: erasing pedro again (new request id) is a no-op: already_erased, nothing moves', async () => step('E4 idempotency', async () => {
  const before = await digests(pool);
  const again = await db.erase(P.pedro.core);
  assert.equal(again.outcome, 'already_erased');
  const third = await db.erase(P.pedro.core, randomUUID());
  assert.equal(third.outcome, 'already_erased');
  assert.deepEqual(changedTables(before, await digests(pool)), []);
  return { second: again.outcome, third: third.outcome };
}));

test('E5 olga (owner with members): Liga Norte goes to ana, the longest-standing active admin; beto/dora/carla untouched; page stays', async () => step('E5 olga', async () => {
  const r = await db.erase(P.olga.core);
  assert.deepEqual(r.organizationsTransferred, [I.norte]);
  assert.deepEqual(r.organizationsArchived, []);
  const members = await rows(`select i.id, m.role, m.status from public.tournament_organization_members m join public.torneos_identity i on i.id = m.user_id
    where m.organization_id = $1 order by m.joined_at`, [I.norte]);
  const by = Object.fromEntries(members.map((m) => [m.id, `${m.role}/${m.status}`]));
  assert.equal(by[P.ana.id], 'owner/active');
  assert.equal(by[P.olga.id], 'admin/removed');
  assert.equal(by[P.beto.id], 'admin/active');
  assert.equal(by[P.dora.id], 'admin/active');
  assert.equal(by[P.carla.id], 'collaborator/active');
  assert.equal(await val('select status from public.tournament_organizations where id = $1', [I.norte]), 'active');
  assert.equal(await val(`select count(*)::int from public.tournament_audit_log where organization_id = $1 and action = 'organization.owner_transferred' and actor_type = 'system'`, [I.norte]), 1);
  assert.ok(await publicPage(pool, pageBefore.publicSlug), 'the transferred organization keeps its public page');
  if (WITH_0020) {
    assert.deepEqual(await rows('select name, created_by from public.tournament_organization_sponsors where organization_id = $1', [I.norte]),
      [{ name: 'Panadería Ficticia', created_by: null }], '0020: the sponsor stays, its creator link goes');
    assert.equal(r.counts.sponsorsDetached, 1);
  } else {
    assert.equal(r.counts.sponsorsDetached, undefined, 'main without 0020: the sponsors step is skipped');
  }
  return { transferred: r.organizationsTransferred, counts: r.counts };
}));

test('E6 solo (owner alone): archived, public page unpublished (the public route returns null), listing withdrawn without WhatsApp', async () => step('E6 solo', async () => {
  const slug = await val('select public_slug from public.tournament_public_pages where tournament_id = $1', [I.soloT.id]);
  assert.ok(await publicPage(pool, slug));
  const r = await db.erase(P.solo.core);
  assert.deepEqual(r.organizationsArchived, [I.soloOrg]);
  assert.deepEqual(await rows('select status, archived_at is not null as archived from public.tournament_organizations where id = $1', [I.soloOrg]), [{ status: 'archived', archived: true }]);
  assert.equal(await val('select status from public.tournament_public_pages where tournament_id = $1', [I.soloT.id]), 'unpublished');
  assert.equal(await publicPage(pool, slug), null);
  assert.deepEqual(await rows('select status, applications_state, contact_whatsapp, withdrawn_by from public.tournament_catalog_listings where tournament_id = $1', [I.soloT.id]),
    [{ status: 'withdrawn', applications_state: 'closed', contact_whatsapp: null, withdrawn_by: P.solo.id }]);
  assert.deepEqual([r.counts.publicPagesUnpublished, r.counts.catalogListingsClosed], [1, 1]);
  return r.counts;
}));

test('E7 premium (owner alone with an APPROVED Premium purchase): archived; purchase, its events and the season grant byte-identical', async () => step('E7 premium', async () => {
  const r = await db.erase(P.premium.core);
  assert.deepEqual(r.organizationsArchived, [I.premiumOrg]);
  const after = await rows(`select to_jsonb(p) row, (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') from public.tournament_purchase_events e where e.purchase_id = p.id) events,
    (select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]') from public.tournament_season_plan_grants g where g.origin_purchase_id = p.id) grants
    from public.tournament_purchases p where p.id = $1`, [I.purchase]);
  assert.deepEqual(after, purchaseBefore, 'no amount, state, event or grant changed');
  assert.equal(after[0].row.buyer_user_id, P.premium.id, 'the buyer is the same (now severed) identity');
  assert.equal(await val('select count(*)::int from public.torneos_identity where id = $1 and core_user_id = $2', [P.premium.id, P.premium.core]), 0);
  return { purchase: after[0].row.status, amount: after[0].row.amount_snapshot, events: after[0].events.length };
}));

test('E8 lidia (only a collaborator besides her): archived, the collaborator is NOT promoted', async () => step('E8 lidia', async () => {
  const r = await db.erase(P.lidia.core);
  assert.deepEqual(r.organizationsArchived, [I.colab]);
  assert.deepEqual(await rows(`select role, status from public.tournament_organization_members where organization_id = $1 and user_id = $2`, [I.colab, P.carla.id]),
    [{ role: 'collaborator', status: 'active' }]);
  assert.equal(await val(`select count(*)::int from public.tournament_organization_members where organization_id = $1 and role = 'owner' and status = 'active'`, [I.colab]), 0);
  return r.counts;
}));

test('E9 carla (collaborator in two organizations, one of them archived): both memberships removed', async () => step('E9 carla', async () => {
  const r = await db.erase(P.carla.core);
  assert.equal(r.counts.membershipsRemoved, 2);
  assert.deepEqual(await rows(`select status from public.tournament_organization_members where user_id = $1 order by organization_id`, [P.carla.id]),
    [{ status: 'removed' }, { status: 'removed' }]);
  return r.counts;
}));

test('E10 capi (captain + applicant): manager revoked with pseudonym and no email, his invitation email replaced, application message cleared, the team entry unchanged', async () => step('E10 capi', async () => {
  const entryBefore = await rows('select to_jsonb(e) - $2::text as e from public.tournament_team_entries e where id = $1', [I.uno.entry, 'updated_at']);
  const r = await db.erase(P.capi.core);
  const pseudo = await label('Responsable eliminado', P.capi, I.norte);
  assert.deepEqual(await rows('select display_name, email_normalized, status, revoked_at is not null as revoked from public.tournament_team_managers where id = $1', [I.capiManager]),
    [{ display_name: pseudo, email_normalized: null, status: 'revoked', revoked: true }]);
  const invitation = await val('select email_normalized from public.tournament_team_invitations where manager_id = $1', [I.capiManager]);
  assert.match(invitation, /^eliminado-[0-9a-f]{12}@cuenta-eliminada\.invalid$/);
  assert.equal(await val('select message from public.tournament_team_applications where applicant_user_id = $1', [P.capi.id]), null);
  assert.equal(await val('select count(*)::int from public.tournament_team_applications where applicant_user_id = $1', [P.capi.id]), 1, 'the application stays (registration history)');
  assert.deepEqual(await rows('select to_jsonb(e) - $2::text as e from public.tournament_team_entries e where id = $1', [I.uno.entry, 'updated_at']), entryBefore);
  assert.equal(await val('select count(*)::int from public.tournament_user_notifications where recipient_user_id = $1', [P.capi.id]), 0);
  return r.counts;
}));

test('E11 paula (claimed provisional player): name, normalized name, email and phone gone; her roster row and squad snapshot carry the pseudonym', async () => step('E11 paula', async () => {
  const r = await db.erase(P.paula.core);
  const pseudo = await label('Jugador eliminado', P.paula, I.norte);
  assert.deepEqual(await rows('select display_name, normalized_name, contact_email, contact_phone, claimed_by_user_id from public.tournament_provisional_players where id = $1', [I.paulaRow.provisional]),
    [{ display_name: pseudo, normalized_name: pseudo.toLowerCase(), contact_email: null, contact_phone: null, claimed_by_user_id: P.paula.id }]);
  assert.deepEqual(await rows('select display_name, avatar_url from public.tournament_roster_players where id = $1', [I.paulaRow.id]), [{ display_name: pseudo, avatar_url: null }]);
  assert.equal(await val('select display_name_snapshot from public.tournament_match_squad_players where roster_player_id = $1', [I.paulaRow.id]), pseudo);
  assert.deepEqual([r.counts.provisionalPlayersAnonymised, r.counts.rosterPlayersAnonymised], [1, 1]);
  return r.counts;
}));

test('E12 dora (admin, author of a published announcement): text kept, author link to the severed identity kept, season seat and membership gone', async () => step('E12 dora', async () => {
  const announcementBefore = await rows('select title, summary, body, status, author_user_id from public.tournament_announcements where id = $1', [I.announcement]);
  const r = await db.erase(P.dora.core);
  assert.deepEqual(await rows('select title, summary, body, status, author_user_id from public.tournament_announcements where id = $1', [I.announcement]), announcementBefore);
  assert.equal(announcementBefore[0].author_user_id, P.dora.id);
  assert.equal(r.counts.seasonAssignmentsDeleted, 1);
  assert.equal(await val(`select status from public.tournament_organization_members where user_id = $1`, [P.dora.id]), 'removed');
  return r.counts;
}));

test('E13 foto (player with a portrait and photographer): portrait → delete_pending + consent revoked, the object listed for the operator, Storage untouched', async () => step('E13 foto', async () => {
  const storageBefore = await val('select count(*)::int from storage.objects');
  const r = await db.erase(P.foto.core);
  assert.deepEqual(await rows('select lifecycle_status, publication_consent, storage_purged_at from public.tournament_player_portraits where id = $1', [I.portrait]),
    [{ lifecycle_status: 'delete_pending', publication_consent: 'revoked', storage_purged_at: null }]);
  const pending = await val('select pending_storage_objects from private.tournament_account_erasures where identity_id = $1', [P.foto.id]);
  assert.deepEqual(pending, [{ bucket: 'tournament-player-portraits', objectPath: `organizations/${I.norte}/roster-players/${I.fotoRow.id}/${I.portrait}.jpg` }]);
  assert.equal(await val('select count(*)::int from storage.objects'), storageBefore, 'no object is purged by the erasure');
  assert.deepEqual([r.counts.portraitsMarkedForDeletion, r.counts.storageObjectsPending], [1, 1]);
  return r.counts;
}));

test('E14 a failure injected mid-way rolls EVERYTHING back (guards re-enabled, identity intact); the retry completes and transfers Liga Norte again', async () => step('E14 partial failure + retry', async () => {
  // ana now owns Liga Norte; her erasure must transfer it to beto. A trigger on the profile delete (step 8 of 9) fails it.
  await pool.query(`create function public.lab_inject_erasure_failure() returns trigger language plpgsql as $$ begin raise exception 'LAB_INJECTED_FAILURE'; end $$`);
  await pool.query('create trigger lab_inject_erasure_failure before delete on public.tournament_user_profiles for each row execute function public.lab_inject_erasure_failure()');
  const before = await digests(pool);
  let failure = null;
  try { await db.erase(P.ana.core); } catch (error) { failure = error.message; }
  assert.match(failure ?? '', /LAB_INJECTED_FAILURE/);
  assert.deepEqual(changedTables(before, await digests(pool)), [], 'nothing half-done');
  assert.equal(await val(`select count(*)::int from pg_trigger where tgname in ('torneos_identity_immutable','tournament_organization_members_protect_owner',
    'tournament_match_squad_players_history_guard','tournament_match_operation_players_history_guard') and tgenabled = 'O'`), 4, 'guards enabled');
  assert.equal(await val('select count(*)::int from public.torneos_identity where core_user_id = $1', [P.ana.core]), 1);
  await pool.query('drop trigger lab_inject_erasure_failure on public.tournament_user_profiles');
  await pool.query('drop function public.lab_inject_erasure_failure()');
  const retry = await db.erase(P.ana.core);
  assert.equal(retry.outcome, 'erased');
  assert.deepEqual(retry.organizationsTransferred, [I.norte]);
  assert.equal(await val(`select i.id from public.tournament_organization_members m join public.torneos_identity i on i.id = m.user_id
    where m.organization_id = $1 and m.role = 'owner' and m.status = 'active'`, [I.norte]), P.beto.id);
  return { failure: failure.slice(0, 80), retry: retry.outcome };
}));

test('E15 concurrent erasures serialize (advisory lock): beto and rival at the same time, both erased, Liga Norte archived after its last admin', async () => step('E15 concurrency', async () => {
  const [a, b] = await Promise.all([db.erase(P.beto.core), db.erase(P.rival.core)]);
  assert.deepEqual([a.outcome, b.outcome], ['erased', 'erased']);
  assert.equal(await val('select status from public.tournament_organizations where id = $1', [I.norte]), 'archived', 'no active admin left: closed, not orphaned');
  return { beto: a.organizationsArchived, rival: b.counts.teamManagersAnonymised };
}));

test('E16 invariants: no organization is active without an active owner whose identity is live; every guard enabled; official history still immutable', async () => step('E16 invariants', async () => {
  const orphans = await val(`select count(*)::int from public.tournament_organizations o where o.status = 'active' and not exists (
    select 1 from public.tournament_organization_members m where m.organization_id = o.id and m.role = 'owner' and m.status = 'active'
      and not exists (select 1 from private.tournament_account_erasures e where e.identity_id = m.user_id))`);
  assert.equal(orphans, 0);
  assert.equal(await val(`select count(*)::int from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'O'
    and t.tgrelid in (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private'))`), 0);
  const refused = await refusalAs(pool, 'postgres', 'update public.tournament_match_operation_players set display_name_snapshot = $1 where roster_player_id = $2', ['Otro', I.pedroRow.id]);
  assert.match(refused ?? '', /TORNEOS_/, 'outside an erasure the official report stays immutable');
  const historyAfter = await digests(pool, ['public.tournament_match_events', 'public.tournament_match_scores', 'public.tournament_match_outcomes',
    'public.tournament_player_statistics', 'public.tournament_team_standings', 'public.tournament_discipline_ledgers', 'public.tournament_standings_revisions',
    'public.tournament_announcements', 'public.tournament_document_acknowledgements', 'public.tournament_announcement_deliveries']);
  assert.deepEqual(changedTables(projectionBefore, historyAfter), [], 'results, events, standings, statistics, discipline, communications: identical');
  return { orphans, refused: refused.slice(0, 60) };
}));

test('E17 isolation: other worlds on this lab and the people never erased here are untouched; purchases byte-identical', async () => step('E17 isolation', async () => {
  const after = await othersDigest();
  for (const key of Object.keys(othersBefore)) assert.equal(after[key], othersBefore[key], key);
  const ledger = await val('select count(*)::int from private.tournament_account_erasures e join public.torneos_identity i on i.id = e.identity_id where i.id = any($1)',
    [Object.values(P).map((p) => p.id)]);
  return { erasedHere: ledger };
}));
