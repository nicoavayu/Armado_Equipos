// CONNECTED-V1 — the connected product on the REAL local hybrid stack (the Phase 3A lab): real Core (GoTrue sessions
// + the Core contract Edge Function for team authority), Torneos baseline + 0001…0009 behind PostgREST, and the gateway
// under test (Node by default, Edge with GATEWAY=edge), with TORNEOS_CONNECTED_MODE=on.
//
//   A. install / ACL: 0009 recorded once by the lab ledger; the certified private.authorize_core_contract untouched;
//      the applicant authorizer executable only by the adapter; tables unreachable; platform lever never served.
//   B. public route: the three catalog RPCs as anon with their exact body contract; credentials refused.
//   C. journey: organizer publishes a call (page + listing + open applications, three explicit steps); an applicant
//      with a Core team searches ITS teams (Core directory, attested), requests with it (Core team snapshot, attested),
//      completes the roster, submits; the organizer sees the request in the inbox and in the Torneos inbox, approves;
//      the applicant is notified and the tournament becomes theirs. A Core team the applicant does not administer is
//      refused by Core. Closing applications stops submissions.
//   D. attacker position: straight at PostgREST with a valid bridge bearer, a Core team request without an
//      attestation is refused; an attestation is single-use.
//
// Runs after `TORNEOS_CONNECTED_MODE=on node lab.mjs up`. Nothing touches a remote target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { sql, inGateway, BASE, GATEWAY_BASE, GATEWAY_NAME } from './lab.mjs';

const RUN = 'cv1' + randomBytes(3).toString('hex');
const torneosSql = (q) => sql('torneos-db', q);
const coreSql = (q) => sql('core-db', q, 'postgres');
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function request(path, token, method = 'GET', data) {
  const base = path.startsWith('/auth/v1') ? BASE : GATEWAY_BASE;
  const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: data !== undefined ? JSON.stringify(data) : undefined });
  const text = await r.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
}
const gw = (name, token, params = {}) => request(`/torneos/rest/v1/rpc/${name}`, token, 'POST', params);
const pub = (name, data) => request(`/torneos/public/v1/rpc/${name}`, null, 'POST', data);
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
function restBatch(calls) {
  const out = inGateway(`const calls = ${JSON.stringify(calls)}; const out = [];
    for (const c of calls) {
      const r = await fetch('http://torneos-rest:3000' + c.path, { method: 'POST',
        headers: { 'content-type': 'application/json', ...(c.token ? { authorization: 'Bearer ' + c.token } : {}) },
        body: JSON.stringify(c.body ?? {}) });
      const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
      out.push({ id: c.id, status: r.status, body });
    }
    console.log(JSON.stringify(out));`);
  return JSON.parse(out.trim().split('\n').pop());
}

async function coreActor(label) {
  const email = `${RUN}-${label}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const s = await request('/auth/v1/signup', null, 'POST', { email, password, data: { full_name: `${RUN} ${label}` } });
  assert.equal(s.status, 200, `GoTrue signup for ${label}`);
  const u = { label, coreToken: s.body.access_token, coreUserId: s.body.user.id };
  await exchange(u);
  return u;
}
async function exchange(u) {
  const r = await request('/exchange', u.coreToken, 'POST');
  assert.equal(r.status, 200, `exchange for ${u.label}: ${show(r)}`);
  u.token = r.body.access_token; u.tokenAt = Date.now(); u.identity = decodeJwt(u.token).sub;
  return u.token;
}
async function tok(u) { if (!u.token || Date.now() - u.tokenAt > 80_000) await exchange(u); return u.token; }
function coreTeam(owner, name) {
  return coreSql(`insert into public.teams (owner_user_id, name, format) values (${lit(owner.coreUserId)}, ${lit(name)}, 5) returning id`).trim();
}

test(`CONNECTED-V1 — connected product on the real hybrid stack (${GATEWAY_NAME} gateway)`, async (t) => {
  const check = (name, fn) => t.test(name, fn);
  const ok = async (name, who, params = {}) => {
    const r = await gw(name, await tok(who), params);
    assert.equal(r.status, 200, `${name} as ${who.label}: ${show(r)}`);
    return r.body;
  };
  const S = {};

  await check('A. 0009 installed once; certified authorizer untouched; applicant authorizer only for the adapter; tables closed', async () => {
    assert.equal(torneosSql("select count(*) from lab_meta.torneos_migrations where name = '00000000000009_connected_product_v1.sql'").trim(), '1');
    assert.equal(torneosSql("select md5(prosrc) from pg_proc where oid = 'private.authorize_core_contract(text,jsonb)'::regprocedure").trim(),
      '1ac5d5131cd7c3914ad6bda7df30019b', 'OFFICIALIZATION-V1 body of private.authorize_core_contract');
    assert.equal(torneosSql(`select has_function_privilege('torneos_core_adapter', 'private.authorize_applicant_core_contract(text,jsonb)', 'EXECUTE')
      || '/' || has_function_privilege('authenticated', 'private.authorize_applicant_core_contract(text,jsonb)', 'EXECUTE')
      || '/' || has_function_privilege('anon', 'private.authorize_applicant_core_contract(text,jsonb)', 'EXECUTE')`).trim(), 'true/false/false');
    assert.equal(torneosSql(`select bool_or(has_table_privilege(r, ('public.' || t)::regclass, 'SELECT'))
      from unnest(array['tournament_user_profiles','tournament_catalog_listings','tournament_category_capacities','tournament_team_applications','tournament_user_notifications']) t,
      unnest(array['anon','authenticated','service_role']) r`).trim(), 'f');
    assert.equal(torneosSql(`select has_function_privilege('service_role', 'public.platform_remove_tournament_catalog_listing(uuid,text)', 'EXECUTE')
      || '/' || has_function_privilege('authenticated', 'public.platform_remove_tournament_catalog_listing(uuid,text)', 'EXECUTE')`).trim(), 'true/false');
  });

  await check('B. public catalog: anon only, exact body contract, no credentials', async () => {
    const empty = await pub('search_tournament_catalog', { p_query: RUN, p_scope: 'all' });
    assert.equal(empty.status, 200, show(empty));
    assert.equal(empty.body.total, 0);
    assert.equal((await pub('get_tournament_catalog_facets', {})).status, 200);
    assert.equal((await pub('search_tournament_catalog', { p_sort: 'cheapest' })).status, 400);
    assert.equal((await pub('search_tournament_catalog', { p_unknown: 'x' })).status, 400);
    assert.equal((await pub('get_tournament_catalog_entry', {})).status, 400, 'required slug');
    assert.equal((await pub('get_my_torneos_profile', {})).status, 403, 'authenticated RPCs are never public');
    assert.equal((await pub('platform_remove_tournament_catalog_listing', {})).status, 403);
    const withBearer = await request('/torneos/public/v1/rpc/search_tournament_catalog', 'x', 'POST', {});
    assert.equal(withBearer.status, 400);
  });

  await check('C1. organizer: page, listing and applications are three explicit steps', async () => {
    S.organizer = await coreActor('organizer');
    S.applicant = await coreActor('applicant');
    S.other = await coreActor('other');
    S.org = (await ok('create_tournament_organization', S.organizer, { p_name: `Liga ${RUN}`, p_slug: `liga-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
    S.season = (await ok('create_tournament_season', S.organizer, { p_organization_id: S.org, p_name: 'Apertura', p_slug: `apertura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    const tnt = await ok('create_tournament_with_defaults', S.organizer, { p_organization_id: S.org, p_season_id: S.season, p_name: `Copa ${RUN}`, p_slug: `copa-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() });
    S.tournament = tnt.id;
    S.category = (await ok('save_tournament_category', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' })).id;
    await ok('change_tournament_status', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_status: 'registration' });
    S.slug = (await ok('set_tournament_public_page_published', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_published: true })).publicSlug;
    assert.ok(S.slug, 'published page slug');
    assert.equal((await pub('get_tournament_catalog_entry', { p_public_slug: S.slug })).body, null, 'a public page is not a call');
    await ok('save_tournament_catalog_listing', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament,
      p_summary: 'Fútbol 5 los sábados por la tarde.', p_locality: 'Rosario', p_venue_id: null, p_entry_fee_cents: 0,
      p_entry_fee_includes: null, p_payment_note: null, p_requirements: null, p_rules_summary: null });
    await ok('set_tournament_catalog_listing_status', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_listed: true });
    const listed = await pub('search_tournament_catalog', { p_query: RUN, p_scope: 'all' });
    assert.deepEqual([listed.body.total, listed.body.items[0]?.state], [1, 'closed'], 'listed, applications still closed');
    await ok('set_tournament_applications_state', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_state: 'open' });
    const open = await pub('search_tournament_catalog', { p_query: RUN });
    assert.equal(open.body.items[0]?.state, 'open');
    const strings = JSON.stringify([open.body, (await pub('get_tournament_catalog_entry', { p_public_slug: S.slug })).body]);
    assert.doesNotMatch(strings, UUID, 'no internal identifier in the public projection');
  });

  await check('C2. applicant: own Core teams only (attested directory); foreign team refused by Core', async () => {
    S.coreTeam = coreTeam(S.applicant, `Halcones ${RUN}`);
    S.foreignTeam = coreTeam(S.other, `Ajeno ${RUN}`);
    await ok('update_my_torneos_profile', S.applicant, { p_display_name: 'Capi Halcones', p_notify_registration_requests: true });
    const teams = await ok('search_my_applicable_core_teams', S.applicant, { p_public_slug: S.slug, p_query: RUN, p_limit: 8 });
    assert.deepEqual(teams.items.map((item) => item.id), [S.coreTeam], 'only the Core team the applicant administers');
    const foreign = await gw('start_tournament_application', await tok(S.applicant), { p_public_slug: S.slug, p_category_slug: 'libre',
      p_core_team_id: S.foreignTeam, p_team_name: null, p_message: null, p_accept_conditions: true, p_idempotency_key: randomUUID() });
    assert.ok([403, 404].includes(foreign.status) && foreign.body?.error === 'CORE_DENIED', `foreign Core team: ${show(foreign)}`);
  });

  await check('C3. request with the Core team, roster, submit; organizer inbox + Torneos inbox; approval reaches the applicant', async () => {
    const started = await ok('start_tournament_application', S.applicant, { p_public_slug: S.slug, p_category_slug: 'libre',
      p_core_team_id: S.coreTeam, p_team_name: null, p_message: 'Jugamos los sábados', p_accept_conditions: true, p_idempotency_key: randomUUID() });
    assert.equal(started.status, 'in_progress');
    S.entry = started.teamEntryId;
    assert.equal(torneosSql(`select name from private.tournament_team_entry_core_snapshots where team_entry_id = ${lit(S.entry)}`).trim(), `Halcones ${RUN}`,
      'the frozen Core snapshot backs the entry name');
    const again = await gw('start_tournament_application', await tok(S.applicant), { p_public_slug: S.slug, p_category_slug: 'libre',
      p_core_team_id: S.coreTeam, p_team_name: null, p_message: null, p_accept_conditions: true, p_idempotency_key: randomUUID() });
    assert.equal(again.status, 409, `duplicate: ${show(again)}`);
    assert.equal(again.body?.message, 'TORNEOS_TEAM_ALREADY_REGISTERED');

    const registration = await ok('get_team_registration_context', S.applicant, { p_organization_id: S.org, p_team_entry_id: S.entry });
    for (let index = 1; index <= 5; index += 1) {
      const provisional = await ok('create_tournament_provisional_player', S.applicant, { p_organization_id: S.org, p_team_entry_id: S.entry, p_display_name: `Jugador ${index} ${RUN}` });
      await ok('add_tournament_roster_player', S.applicant, { p_organization_id: S.org, p_team_entry_id: S.entry, p_roster_id: registration.roster.id,
        p_arma2_user_id: null, p_provisional_player_id: provisional.id, p_display_name: `Jugador ${index}`, p_avatar_url: null,
        p_shirt_number: index, p_primary_position: index === 1 ? 'ARQ' : 'MED', p_secondary_position: null, p_is_goalkeeper: index === 1 });
    }
    await ok('set_tournament_applications_state', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_state: 'paused' });
    const paused = await gw('submit_tournament_team_entry', await tok(S.applicant), { p_organization_id: S.org, p_team_entry_id: S.entry });
    assert.equal(paused.status, 409, `paused: ${show(paused)}`);
    assert.equal(paused.body?.message, 'TORNEOS_APPLICATIONS_CLOSED');
    await ok('set_tournament_applications_state', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_state: 'open' });
    assert.equal((await ok('submit_tournament_team_entry', S.applicant, { p_organization_id: S.org, p_team_entry_id: S.entry })).status, 'submitted');

    const inbox = await ok('get_tournament_application_inbox', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_status: 'submitted', p_limit: 20, p_offset: 0 });
    assert.deepEqual([inbox.items[0]?.teamName, inbox.items[0]?.responsible?.displayName, inbox.items[0]?.roster?.valid], [`Halcones ${RUN}`, 'Capi Halcones', true]);
    await ok('update_my_torneos_profile', S.applicant, { p_display_name: 'Capi Halcones Rojo', p_notify_registration_requests: true });
    const renamed = await ok('get_tournament_application_inbox', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_status: 'submitted', p_limit: 20, p_offset: 0 });
    assert.equal(renamed.items[0]?.responsible?.displayName, 'Capi Halcones Rojo', 'the inbox shows the current Torneos name');
    const organizerSummary = await ok('get_my_torneos_inbox_summary', S.organizer);
    assert.equal(organizerSummary.notificationsUnread, 1, 'the organizer is told about the request');
    const outsiderInbox = await gw('get_tournament_application_inbox', await tok(S.other), { p_organization_id: S.org, p_tournament_id: S.tournament, p_status: 'submitted', p_limit: 20, p_offset: 0 });
    assert.equal(outsiderInbox.status, 403);

    await ok('review_tournament_team_entry', S.organizer, { p_organization_id: S.org, p_team_entry_id: S.entry, p_decision: 'approved', p_reason: 'Bienvenidos', p_issues: [] });
    const notifications = await ok('get_my_torneos_notifications', S.applicant, { p_unread_only: true, p_limit: 10, p_offset: 0 });
    assert.deepEqual(notifications.items.map((item) => item.kind), ['registration.approved', 'registration.received']);
    const memberships = await ok('get_my_tournament_memberships', S.applicant, { p_limit: 50, p_offset: 0 });
    assert.ok(memberships.items.some((item) => item.tournamentId === S.tournament), 'approved: the tournament is the applicant\'s');
    const mine = await ok('get_my_tournament_registrations', S.applicant, { p_limit: 20, p_offset: 0 });
    assert.equal(mine.items.find((item) => item.teamEntryId === S.entry)?.status, 'approved');
  });

  await check('D. straight at PostgREST: a Core team request needs a fresh attestation, and each one is single-use', async () => {
    S.coreTeam2 = coreTeam(S.applicant, `Halcones B ${RUN}`);
    const token = await tok(S.applicant);
    const [direct] = restBatch([{ id: 'direct', token, path: '/rpc/start_tournament_application', body: { p_public_slug: S.slug,
      p_category_slug: 'libre', p_core_team_id: S.coreTeam2, p_team_name: null, p_message: null, p_accept_conditions: true, p_idempotency_key: randomUUID() } }]);
    assert.equal(direct.status, 403, JSON.stringify(direct.body));
    assert.equal(direct.body?.message, 'TORNEOS_CORE_ATTESTATION_REQUIRED');
    const [search] = restBatch([{ id: 'search', token, path: '/rpc/search_my_applicable_core_teams', body: { p_public_slug: S.slug, p_query: RUN, p_limit: 8 } }]);
    assert.equal(search.body?.message, 'TORNEOS_CORE_ATTESTATION_REQUIRED', 'the directory needs its attestation too');
    const [anon] = restBatch([{ id: 'anon', token: null, path: '/rpc/get_my_torneos_profile', body: {} }]);
    assert.ok([401, 403].includes(anon.status), `anon at PostgREST: ${anon.status}`);
    // A refused request (duplicate) rolls back its consumption: that attestation stays unconsumed, bound to its exact
    // request, and expires within seconds. None outlives its short window.
    assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where identity_id = ${lit(S.applicant.identity)}
      and expires_at > created_at + interval '30 seconds'`).trim(), '0', 'every attestation is short-lived');
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    assert.equal(torneosSql(`select count(*) from private.core_contract_attestations where identity_id = ${lit(S.applicant.identity)}
      and consumed_at is null and expires_at > now()`).trim(), '0', 'no attestation of the journey is still usable');
  });
});
