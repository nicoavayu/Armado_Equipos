#!/usr/bin/env node
// MEDIA-V1 lab journey — LOCAL ONLY, against the media lab gateway (media-lab.mjs, 127.0.0.1:58440) and the lab's Core.
// Uses its own accounts and its own organizations; never touches the b04-* data.
//
//   setup                create the accounts and, through the product's own RPCs, «Lab Galería» (owner, admin with
//                        a season assignment, a team whose captain accepted the invitation and was approved) and
//                        «Lab Otra Liga» (another owner) — state in $MEDIA_LAB_STATE
//   <step>               see the steps at the bottom (matrix, retire-url, budget, …): each prints JSON evidence
//
// Lab keys come from the lab .runtime and are never printed; tokens are never printed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const RUNTIME = process.env.MEDIA_LAB_RUNTIME;
const STATE = process.env.MEDIA_LAB_STATE;
if (!RUNTIME || !fs.existsSync(path.join(RUNTIME, 'config.json'))) throw new Error('MEDIA_LAB_RUNTIME = the lab .runtime directory');
if (!STATE) throw new Error('MEDIA_LAB_STATE = a JSON file in the scratchpad');
const cfg = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'config.json'), 'utf8'));
const CORE = 'http://127.0.0.1:58424';
const GATEWAY = process.env.MEDIA_LAB_GATEWAY || 'http://127.0.0.1:58440';
const PASSWORD = 'media-lab-password-placeholder';
export const USERS = {
  owner: { email: 'galeria-owner@lab.test', name: 'Galería Owner' },
  admin: { email: 'galeria-admin@lab.test', name: 'Galería Admin' },
  captain: { email: 'galeria-capitan@lab.test', name: 'Galería Capitán' },
  outsider: { email: 'galeria-ajeno@lab.test', name: 'Galería Ajeno' },
  other: { email: 'galeria-otra@lab.test', name: 'Otra Liga Owner' },
};
const key = () => crypto.randomUUID();
export const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
export const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });

async function core(pathname, { method = 'POST', body, bearer = cfg.anonKey } = {}) {
  const r = await fetch(`${CORE}${pathname}`, {
    method, headers: { apikey: cfg.anonKey, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
async function ensureUser({ email, name }) {
  const signup = await core('/auth/v1/signup', { body: { email, password: PASSWORD, data: { full_name: name, nombre: name } } });
  if (signup.status === 200 && signup.json?.user?.id) return signup.json.user.id;
  const login = await core('/auth/v1/token?grant_type=password', { body: { email, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`user ${email}: signup ${signup.status}, login ${login.status}`);
  return login.json.user.id;
}
const coreTokens = new Map();
export async function token(role) {
  const user = USERS[role];
  let coreToken = coreTokens.get(role);
  if (!coreToken) {
    const session = await core('/auth/v1/token?grant_type=password', { body: { email: user.email, password: PASSWORD } });
    if (session.status !== 200) throw new Error(`login ${user.email} → ${session.status}`);
    coreToken = session.json.access_token;
    coreTokens.set(role, coreToken);
  }
  const exchanged = await fetch(`${GATEWAY}/exchange`, { method: 'POST', headers: { authorization: `Bearer ${coreToken}` } });
  const body = await exchanged.json().catch(() => null);
  if (exchanged.status !== 200) throw new Error(`exchange ${user.email} → ${exchanged.status}`);
  return body.access_token;
}
export async function rpc(role, name, params, { expect = 200 } = {}) {
  const bearer = role ? await token(role) : null;
  const r = await fetch(`${GATEWAY}/torneos/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(params), signal: AbortSignal.timeout(15000),
  });
  const json = await r.json().catch(() => null);
  if (expect !== null && r.status !== expect) throw new Error(`${role} ${name} → ${r.status} ${JSON.stringify(json).slice(0, 240)}`);
  return { status: r.status, json };
}
export async function media(role, route, { body, headers = {}, search = '' } = {}) {
  const bearer = role ? await token(role) : null;
  const r = await fetch(`${GATEWAY}/torneos/media/v1/${route}${search}`, {
    method: 'POST', headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers }, body,
    signal: AbortSignal.timeout(40000),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function setup() {
  for (const [role, user] of Object.entries(USERS)) state[`${role}CoreId`] = await ensureUser(user);
  if (!state.organizationId) {
    const org = (await rpc('owner', 'create_tournament_organization', { p_name: 'Lab Galería', p_slug: `lab-galeria-${crypto.randomBytes(3).toString('hex')}`, p_idempotency_key: key() })).json;
    state.organizationId = org.organization.id;
    state.seasonId = (await rpc('owner', 'create_tournament_season', { p_organization_id: state.organizationId, p_name: 'Temporada Galería', p_slug: 'temporada-galeria', p_start_date: null, p_end_date: null, p_idempotency_key: key() })).json.id;
    state.tournamentId = (await rpc('owner', 'create_tournament_with_defaults', { p_organization_id: state.organizationId, p_season_id: state.seasonId, p_name: 'Copa Galería', p_slug: 'copa-galeria', p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: key() })).json.id;
    const category = (await rpc('owner', 'save_tournament_category', { p_organization_id: state.organizationId, p_tournament_id: state.tournamentId, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' })).json;
    state.categoryId = category?.id || category?.categoryId || category?.category?.id || null;
    await rpc('owner', 'change_tournament_status', { p_organization_id: state.organizationId, p_tournament_id: state.tournamentId, p_status: 'registration' });
    save();
  }
  if (!state.entryId) {
    const entry = (await rpc('owner', 'create_tournament_team_entry', { p_organization_id: state.organizationId, p_tournament_id: state.tournamentId, p_category_id: state.categoryId, p_arma2_team_id: null, p_name: 'Galería FC', p_short_name: 'GFC', p_primary_color: '#7c3aed', p_secondary_color: '#facc15', p_registration_source: null, p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: key() })).json;
    state.entryId = entry.entryId; state.rosterId = entry.rosterId; save();
  }
  if (!state.captainAccepted) {
    const invitation = (await rpc('owner', 'invite_tournament_team_manager', { p_organization_id: state.organizationId, p_team_entry_id: state.entryId, p_email: USERS.captain.email, p_display_name: USERS.captain.name, p_role: 'captain' })).json;
    await rpc('captain', 'accept_tournament_team_invitation', { p_token: invitation.token });
    state.captainAccepted = true; save();
  }
  if (!state.entryApproved) {
    const positions = ['ARQ', 'DEF', 'DEF', 'MED', 'DEL', 'DEL'];
    for (const [index, position] of positions.entries()) {
      const player = (await rpc('owner', 'create_tournament_provisional_player', { p_organization_id: state.organizationId, p_team_entry_id: state.entryId, p_display_name: `Jugador Lab ${index + 1}` })).json;
      await rpc('owner', 'add_tournament_roster_player', { p_organization_id: state.organizationId, p_team_entry_id: state.entryId, p_roster_id: state.rosterId, p_arma2_user_id: null, p_provisional_player_id: player.id || player.provisionalPlayerId || player.playerId, p_display_name: `Jugador Lab ${index + 1}`, p_avatar_url: null, p_shirt_number: index + 1, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: position === 'ARQ' });
    }
    await rpc('captain', 'submit_tournament_team_entry', { p_organization_id: state.organizationId, p_team_entry_id: state.entryId });
    await rpc('owner', 'review_tournament_team_entry', { p_organization_id: state.organizationId, p_team_entry_id: state.entryId, p_decision: 'approved', p_reason: 'Plantel de laboratorio completo.', p_issues: [] });
    state.entryApproved = true; save();
  }
  if (!state.adminAccepted) {
    const invitation = (await rpc('owner', 'invite_tournament_organization_member', { p_organization_id: state.organizationId, p_email: USERS.admin.email, p_role: 'admin' })).json;
    const accepted = (await rpc('admin', 'accept_tournament_organization_invitation', { p_token: invitation.token })).json;
    state.adminMembershipId = accepted?.membershipId || accepted?.membership?.id || invitation?.membershipId || null;
    state.adminAccepted = true; save();
    if (state.adminMembershipId) {
      await rpc('owner', 'assign_tournament_season_member', { p_organization_id: state.organizationId, p_season_id: state.seasonId, p_membership_id: state.adminMembershipId });
    }
  }
  if (!state.otherOrganizationId) {
    const org = (await rpc('other', 'create_tournament_organization', { p_name: 'Lab Otra Liga', p_slug: `lab-otra-liga-${crypto.randomBytes(3).toString('hex')}`, p_idempotency_key: key() })).json;
    state.otherOrganizationId = org.organization.id;
    state.otherSeasonId = (await rpc('other', 'create_tournament_season', { p_organization_id: state.otherOrganizationId, p_name: 'Temporada Otra', p_slug: 'temporada-otra', p_start_date: null, p_end_date: null, p_idempotency_key: key() })).json.id;
    state.otherTournamentId = (await rpc('other', 'create_tournament_with_defaults', { p_organization_id: state.otherOrganizationId, p_season_id: state.otherSeasonId, p_name: 'Copa Otra', p_slug: 'copa-otra', p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: key() })).json.id;
    save();
  }
  console.log(JSON.stringify({ step: 'setup', organizationId: state.organizationId, tournamentId: state.tournamentId, categoryId: state.categoryId }, null, 2));
}

// The app callback URL that opens a Core session for <role> (magic link generated and verified server-side, like
// scripts/torneos-frontend/lab-fixtures.mjs login). It carries tokens: written to a 0600 file, never printed.
export async function loginUrl(role, appOrigin = process.env.MEDIA_LAB_APP_ORIGIN || 'http://localhost:3120') {
  const link = await core('/auth/v1/admin/generate_link', { bearer: cfg.serviceRoleKey, body: { type: 'magiclink', email: USERS[role].email } });
  if (link.status !== 200 || !link.json?.hashed_token) throw new Error(`generate_link → ${link.status}`);
  const verified = await core('/auth/v1/verify', { body: { type: 'magiclink', token_hash: link.json.hashed_token } });
  if (verified.status !== 200 || !verified.json?.access_token) throw new Error(`verify → ${verified.status}`);
  const { access_token, refresh_token, expires_in } = verified.json;
  const fragment = new URLSearchParams({ access_token, refresh_token, token_type: 'bearer', type: 'magiclink', expires_in: String(expires_in) });
  return `${appOrigin}/auth/callback#${fragment.toString()}`;
}

const steps = { setup };
// ─────────────────────────────────────────────────────────────────────────────── certification steps
const CLEAN = process.env.MEDIA_LAB_CLEAN;
const STORAGE_PUBLIC = 'http://127.0.0.1:58445';
const out = (entry) => console.log(JSON.stringify(entry));
const photo = (i) => fs.readFileSync(path.join(CLEAN, `p${String(i).padStart(2, '0')}.jpg`));
const thumbOf = (i) => fs.readFileSync(path.join(CLEAN, `t${String(i).padStart(2, '0')}.jpg`));
export async function upload(role, galleryId, i, { idempotencyKey = key(), withThumb = true } = {}) {
  const body = withThumb ? Buffer.concat([photo(i), thumbOf(i)]) : photo(i);
  const search = `?gallery=${galleryId}&key=${idempotencyKey}${withThumb ? `&thumb=${thumbOf(i).length}` : ''}`;
  return media(role, 'upload', { body, search, headers: { 'content-type': 'image/jpeg' } });
}
async function urls(role, ids, kind = 'detail') {
  return media(role, 'urls', { body: JSON.stringify({ items: ids.map((assetId) => ({ assetId, kind })) }), headers: { 'content-type': 'application/json' } });
}
async function gallery(role, organizationId, tournamentId, title, visibility = 'tournament_participants') {
  return (await rpc(role, 'create_tournament_media_gallery', { p_organization_id: organizationId, p_tournament_id: tournamentId, p_category_id: null, p_round_id: null, p_match_id: null, p_title: title, p_description: '', p_visibility: visibility, p_idempotency_key: key() })).json;
}
async function publishedIds(role) {
  const pub = (await rpc(role, 'get_published_tournament_media', { p_tournament_id: state.tournamentId, p_category_id: null, p_match_id: null, p_limit: 50, p_offset: 0 })).json;
  return pub.items.flatMap((g) => g.assets.map((a) => a.id));
}
const status = (r) => `${r.status}${r.json?.error ? ` ${r.json.error}` : ''}${r.json?.message ? ` ${r.json.message}` : ''}`;

steps.matrix = async () => {
  const ids = await publishedIds('owner');
  const draft = await gallery('owner', state.organizationId, state.tournamentId, 'Borrador matriz');
  state.matrixGallery = draft; save();
  const rows = [];
  const row = (actor, action, result) => { rows.push({ actor, action, result }); };
  row('owner', 'upload to own draft', status(await upload('owner', draft, 30)));
  row('admin (season assigned)', 'admin context', (await rpc('admin', 'get_tournament_media_admin_context', { p_organization_id: state.organizationId, p_tournament_id: null, p_status: null, p_limit: 30, p_offset: 0 }, { expect: null })).status);
  row('admin (season assigned)', 'upload to org draft', status(await upload('admin', draft, 31)));
  row('captain (participant)', 'published galleries of his tournament', (await rpc('captain', 'get_published_tournament_media', { p_tournament_id: state.tournamentId, p_category_id: null, p_match_id: null, p_limit: 50, p_offset: 0 }, { expect: null })).json?.items?.length ?? 'refused');
  row('captain (participant)', 'detail URLs of published photos', `${(await urls('captain', ids)).json?.items?.length} of ${ids.length}`);
  row('captain (participant)', 'admin context', (await rpc('captain', 'get_tournament_media_admin_context', { p_organization_id: state.organizationId, p_tournament_id: null, p_status: null, p_limit: 30, p_offset: 0 }, { expect: null })).status);
  row('captain (participant)', 'upload to org draft', status(await upload('captain', draft, 32)));
  row('captain (participant)', 'create a gallery', (await rpc('captain', 'create_tournament_media_gallery', { p_organization_id: state.organizationId, p_tournament_id: state.tournamentId, p_category_id: null, p_round_id: null, p_match_id: null, p_title: 'intruso', p_description: '', p_visibility: 'tournament_participants', p_idempotency_key: key() }, { expect: null })).status);
  row('captain (participant)', 'hide a published photo', (await rpc('captain', 'transition_tournament_media_asset', { p_asset_id: ids[0], p_action: 'hide', p_reason: 'intruso' }, { expect: null })).status);
  row('outsider (authenticated, no relation)', 'published galleries', (await rpc('outsider', 'get_published_tournament_media', { p_tournament_id: state.tournamentId, p_category_id: null, p_match_id: null, p_limit: 50, p_offset: 0 }, { expect: null })).status);
  row('outsider (authenticated, no relation)', 'detail URLs by asset id', `${(await urls('outsider', ids)).json?.items?.length} of ${ids.length}`);
  row('outsider (authenticated, no relation)', 'thumbnail URLs by asset id', `${(await urls('outsider', ids, 'thumbnail')).json?.items?.length} of ${ids.length}`);
  row('other org owner', 'admin context of Lab Galería', (await rpc('other', 'get_tournament_media_admin_context', { p_organization_id: state.organizationId, p_tournament_id: null, p_status: null, p_limit: 30, p_offset: 0 }, { expect: null })).status);
  row('other org owner', 'detail URLs of Lab Galería photos', `${(await urls('other', ids)).json?.items?.length} of ${ids.length}`);
  row('other org owner', 'upload to a Lab Galería gallery id', status(await upload('other', draft, 33)));
  row('other org owner', 'create gallery in Lab Galería', (await rpc('other', 'create_tournament_media_gallery', { p_organization_id: state.organizationId, p_tournament_id: state.tournamentId, p_category_id: null, p_round_id: null, p_match_id: null, p_title: 'ajena', p_description: '', p_visibility: 'tournament_participants', p_idempotency_key: key() }, { expect: null })).status);
  row('other org owner', 'publish a Lab Galería gallery', (await rpc('other', 'publish_tournament_media_gallery', { p_gallery_id: draft }, { expect: null })).status);
  row('other org owner', 'hide a Lab Galería photo', (await rpc('other', 'transition_tournament_media_asset', { p_asset_id: ids[0], p_action: 'hide', p_reason: 'ajena' }, { expect: null })).status);
  row('visitor (no session)', 'upload route', (await media(null, 'upload', { body: photo(34), search: `?gallery=${draft}&key=${key()}`, headers: { 'content-type': 'image/jpeg' } })).status);
  row('visitor (no session)', 'urls route', (await media(null, 'urls', { body: JSON.stringify({ items: [{ assetId: ids[0], kind: 'detail' }] }), headers: { 'content-type': 'application/json' } })).status);
  row('visitor (no session)', 'published galleries via the public route', (await fetch(`${GATEWAY}/torneos/public/v1/rpc/get_published_tournament_media`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_tournament_id: state.tournamentId }) })).status);
  const anyUrl = (await urls('owner', ids)).json.items[0].url;
  const objectPath = new URL(anyUrl).pathname.replace('/object/sign/', '');
  row('visitor (no session)', 'storage public URL of a real object', (await fetch(`${STORAGE_PUBLIC}/object/public/${objectPath}`)).status);
  row('visitor (no session)', 'storage authenticated URL without token', (await fetch(`${STORAGE_PUBLIC}/object/authenticated/${objectPath}`)).status);
  row('visitor (no session)', 'signed URL with a tampered token', (await fetch(anyUrl.replace(/token=.{6}/, 'token=xxxxxx'))).status);
  row('captain (participant)', 'own bridge token straight to storage (write)', (await fetch(`${STORAGE_PUBLIC}/object/tournament-media/${state.organizationId}/${state.tournamentId}/${draft}/${crypto.randomUUID()}.jpg`, { method: 'POST', headers: { authorization: `Bearer ${await token('owner')}`, 'content-type': 'image/jpeg' }, body: photo(35) })).status);
  row('captain (participant)', 'kind=original', (await urls('captain', ids.slice(0, 1), 'original')).status);
  for (const entry of rows) out({ step: 'matrix', ...entry });
};

steps['retire-url'] = async () => {
  const ids = await publishedIds('owner');
  const target = ids[ids.length - 1];
  const issued = (await urls('captain', [target])).json.items[0].url;
  const t0 = Date.now();
  const at = () => `${Math.round((Date.now() - t0) / 1000)} s`;
  out({ step: 'retire-url', at: at(), event: 'URL issued to the participant', get: (await fetch(issued)).status });
  await rpc('owner', 'transition_tournament_media_asset', { p_asset_id: target, p_action: 'hide', p_reason: 'Retiro de laboratorio' });
  out({ step: 'retire-url', at: at(), event: 'photo retired (hide)', oldUrlGet: (await fetch(issued)).status,
    newUrlsForParticipant: (await urls('captain', [target])).json.items.length, stillListed: (await publishedIds('captain')).includes(target),
    ownerCanStillSee: (await urls('owner', [target])).json.items.length });
  for (const wait of [60, 120, 240, 300, 310]) {
    await new Promise((resolve) => { setTimeout(resolve, Math.max(0, wait * 1000 - (Date.now() - t0))); });
    out({ step: 'retire-url', at: at(), event: 'old URL after retiring', get: (await fetch(issued)).status });
  }
  await rpc('owner', 'transition_tournament_media_asset', { p_asset_id: target, p_action: 'restore', p_reason: null });
  out({ step: 'retire-url', at: at(), event: 'restored', newUrlsForParticipant: (await urls('captain', [target])).json.items.length });
};

steps.retries = async () => {
  const draft = await gallery('owner', state.organizationId, state.tournamentId, 'Reintentos');
  const k = key();
  const first = await upload('owner', draft, 1, { idempotencyKey: k });
  const again = await upload('owner', draft, 1, { idempotencyKey: k });
  out({ step: 'retries', case: 'same key twice (lost answer)', first: status(first), second: status(again), sameAsset: first.json?.assetId === again.json?.assetId, replayed: again.json?.replayed === true });
  const k2 = key();
  const [a, b] = await Promise.all([upload('owner', draft, 2, { idempotencyKey: k2 }), upload('owner', draft, 2, { idempotencyKey: k2 })]);
  out({ step: 'retries', case: 'double tap (same key, concurrent)', results: [status(a), status(b)].sort() });
  const dupe = await upload('owner', draft, 1, { idempotencyKey: key() });
  out({ step: 'retries', case: 'same photo, new key', result: status(dupe) });
  const D = '/Applications/Docker.app/Contents/Resources/bin/docker';
  const { spawnSync } = await import('node:child_process');
  const count = spawnSync(D, ['exec', 'arma2-promo-rehearsal-torneos-db-1', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c',
    `select count(*) from public.tournament_media_assets where gallery_id = '${draft}'`], { encoding: 'utf8' }).stdout.trim();
  out({ step: 'retries', case: 'assets in the gallery after all of it', assets: Number(count), expected: 2 });
};

const DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker';
async function labSql(sql) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(DOCKER, ['exec', '-i', 'arma2-promo-rehearsal-torneos-db-1', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`lab sql: ${(r.stderr || '').split('\n').filter((l) => l.startsWith('ERROR')).join(' ')}`);
  return r.stdout.trim();
}
const usage = async (role, organizationId, seasonId) => (await rpc(role, 'get_tournament_season_media_usage', { p_organization_id: organizationId, p_season_id: seasonId })).json;

steps.quota = async () => {
  const before = await usage('owner', state.organizationId, state.seasonId);
  out({ step: 'quota', event: 'FREE season before', plan: before.plan, usage: before.usage, limit: before.limit });
  const draft = await gallery('owner', state.organizationId, state.tournamentId, 'Cuota FREE');
  let accepted = 0; let refusal = null; let lastAsset = null;
  for (let i = 3; i < 30 && !refusal; i += 1) {
    const r = await upload('owner', draft, i);
    if (r.status === 201) { accepted += 1; lastAsset = r.json.assetId; } else refusal = r;
  }
  out({ step: 'quota', event: 'uploads until the server refused', accepted, refusal: status(refusal), quota: refusal?.json?.quota });
  const full = await usage('owner', state.organizationId, state.seasonId);
  out({ step: 'quota', event: 'usage at the limit', usage: full.usage, limit: full.limit, remaining: full.remaining });
  await rpc('owner', 'transition_tournament_media_asset', { p_asset_id: lastAsset, p_action: 'reject', p_reason: 'Libera lugar en el laboratorio.' });
  const freed = await usage('owner', state.organizationId, state.seasonId);
  out({ step: 'quota', event: 'one photo rejected', usage: freed.usage, remaining: freed.remaining, nextUpload: status(await upload('owner', draft, 29)) });
  const grants = [];
  for (const name of ['grant_tournament_season_plan', 'create_tournament_season_plan_grant', 'set_tournament_season_plan', 'simulate_tournament_fake_payment', 'get_effective_tournament_season_entitlements']) {
    grants.push(`${name} ${(await rpc('owner', name, { p_organization_id: state.organizationId, p_season_id: state.seasonId }, { expect: null })).status}`);
  }
  out({ step: 'quota', event: 'client attempts to become PREMIUM', results: grants, planAfter: (await usage('owner', state.organizationId, state.seasonId)).plan });
};

steps.premium = async () => {
  // Lab-only operator simulation of a PREMIUM season (what a confirmed purchase grants), on the OTHER organization.
  await labSql(`insert into public.tournament_season_plan_grants (organization_id, season_id, plan_code, source, reason)
    select '${state.otherOrganizationId}', '${state.otherSeasonId}', 'PREMIUM', 'manual_legacy', 'Laboratorio MEDIA-V1: simulación de operador'
    where not exists (select 1 from public.tournament_season_plan_grants where season_id = '${state.otherSeasonId}');`);
  const premium = await usage('other', state.otherOrganizationId, state.otherSeasonId);
  const draft = await gallery('other', state.otherOrganizationId, state.otherTournamentId, 'Galería Premium');
  out({ step: 'premium', plan: premium.plan, limit: premium.limit, upload: status(await upload('other', draft, 36)),
    crossOrgStillRefused: `${(await urls('other', await publishedIds('owner'))).json.items.length} Lab Galería URLs` });
};

steps.budget = async () => {
  const budget = JSON.parse(await labSql('select public.tournament_media_storage_budget_status()'));
  const draft = await gallery('owner', state.organizationId, state.tournamentId, 'Presupuesto');
  try {
    await labSql(`update public.tournament_media_storage_budget set gallery_max_bytes = greatest(1048576, ${budget.galleryStoredBytes} + 1000), updated_at = now();`);
    out({ step: 'budget', event: 'gallery budget = stored + 1 KB', upload: status(await upload('owner', draft, 37)),
      storedBytes: JSON.parse(await labSql('select public.tournament_media_storage_budget_status()')).galleryStoredBytes });
  } finally {
    await labSql('update public.tournament_media_storage_budget set gallery_max_bytes = 419430400, updated_at = now();');
  }
  try {
    await labSql('update public.tournament_media_storage_budget set max_inflight_uploads = 1, updated_at = now();');
    // On the PREMIUM organization (room in its season): one slot project-wide, three photos at the same time.
    const premiumDraft = await gallery('other', state.otherOrganizationId, state.otherTournamentId, 'Concurrencia');
    const results = await Promise.all([10, 11, 12].map((i) => upload('other', premiumDraft, i)));
    out({ step: 'budget', event: 'three simultaneous uploads with 1 slot', results: results.map(status).sort() });
    const retried = await Promise.all(results.map((r, n) => (r.status === 429 ? upload('other', premiumDraft, [10, 11, 12][n]) : r)));
    out({ step: 'budget', event: 'the refused ones retried after', results: retried.map(status).sort() });
  } finally {
    await labSql('update public.tournament_media_storage_budget set max_inflight_uploads = 12, updated_at = now();');
  }
  out({ step: 'budget', event: 'restored', budget: JSON.parse(await labSql('select public.tournament_media_storage_budget_status()')) });
};

steps.cut = async () => {
  const http = await import('node:http');
  const { spawnSync } = await import('node:child_process');
  const draft = await gallery('other', state.otherOrganizationId, state.otherTournamentId, 'Corte de red');
  const idempotencyKey = key();
  const body = Buffer.concat([photo(13), thumbOf(13)]);
  const bearer = await token('other');
  const search = `?gallery=${draft}&key=${idempotencyKey}&thumb=${thumbOf(13).length}`;
  // The body trickles in 256-byte chunks; the gateway dies after the first chunks are on the wire.
  const cut = await new Promise((resolve) => {
    const request = http.request(`${GATEWAY}/torneos/media/v1/upload${search}`, { method: 'POST', headers: {
      authorization: `Bearer ${bearer}`, 'content-type': 'image/jpeg', 'content-length': String(body.length) } }, (response) => {
      response.resume(); response.on('end', () => resolve(`HTTP ${response.statusCode}`));
    });
    request.on('error', (error) => resolve(`client error ${error.code || error.message}`));
    let offset = 0;
    const timer = setInterval(() => {
      if (offset === 2048) spawnSync(DOCKER, ['kill', 'arma2-media-lab-gateway']);
      if (offset >= body.length) { clearInterval(timer); request.end(); return; }
      request.write(body.subarray(offset, offset + 256)); offset += 256;
    }, 20);
  });
  spawnSync(DOCKER, ['start', 'arma2-media-lab-gateway']);
  for (let i = 0; i < 30; i += 1) {
    const health = await fetch(`${GATEWAY}/health`).then((r) => r.status).catch(() => 0);
    if (health === 200) break;
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  const retried = await upload('other', draft, 13, { idempotencyKey });
  const replay = await upload('other', draft, 13, { idempotencyKey });
  const assets = await labSql(`select count(*) from public.tournament_media_assets where gallery_id = '${draft}'`);
  const sessions = await labSql(`select string_agg(status, ',' order by created_at) from public.tournament_media_upload_sessions where gallery_id = '${draft}'`);
  const orphanObjects = await labSql(`select count(*) from storage.objects o where o.bucket_id = 'tournament-media' and o.name like '%/${draft}/%'
    and not exists (select 1 from public.tournament_media_assets a where a.internal_path = o.name)
    and not exists (select 1 from public.tournament_media_variants v where v.internal_path = o.name)`);
  out({ step: 'cut', whileCut: cut, retrySameKey: status(retried), againSameKey: `${status(replay)}${replay.json?.replayed ? ' replayed' : ''}`,
    assetsInGallery: Number(assets), sessions, orphanObjects: Number(orphanObjects) });
};

steps.branding = async () => {
  // The lab's OWN stack (its Node gateway on 58420 and storage on 58425), untouched by MEDIA-V1: the existing
  // Lab Copa Conectada logos must still sign and load after the media uploads on the shared storage volume.
  const listed = await fetch('http://127.0.0.1:58420/torneos/public/v1/rpc/search_tournament_catalog', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_query: 'Lab Copa Conectada', p_scope: 'all' }) }).then((r) => r.json());
  const item = listed?.items?.[0];
  const result = {};
  for (const field of ['logoUrl', 'organizationLogoUrl']) {
    if (!item?.[field]) { result[field] = 'none'; continue; }
    const r = await fetch(item[field]);
    result[field] = `${r.status} ${r.headers.get('content-type')} ${(await r.arrayBuffer()).byteLength} bytes`;
  }
  out({ step: 'branding', call: item?.name ?? null, ...result });
};

steps.rollback = async () => {
  // The documented rollback, executed for real on the lab DB inside a transaction that is rolled back at the end:
  // it must run, pass its own postconditions, and leave the photos; nothing stays changed.
  const file = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../rollback/00000000000012_media_gallery_v1.rollback.sql'), 'utf8');
  const probe = `${file.replace(/^COMMIT;$/m, '')}
    select json_build_object('policies', (select count(*) from pg_policies where schemaname='storage' and policyname like 'tournament_media_%'),
      'begin_fn', to_regprocedure('public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint)') is not null,
      'assets_kept', (select count(*) from public.tournament_media_assets), 'objects_kept', (select count(*) from storage.objects where bucket_id='tournament-media'),
      'transition_granted', has_function_privilege('authenticated', 'public.transition_tournament_media_asset(uuid,text,text)', 'EXECUTE'));
    ROLLBACK;`;
  const inside = (await labSql(probe)).split('\n').filter((line) => line.startsWith('{')).pop();
  const after = await labSql(`select json_build_object('policies', (select count(*) from pg_policies where schemaname='storage' and policyname like 'tournament_media_%'),
    'begin_fn', to_regprocedure('public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint)') is not null)`);
  out({ step: 'rollback', insideRolledBackTransaction: JSON.parse(inside), afterwards: JSON.parse(after) });
};

// MEDIA-V1 0014 (product decision 2026-10-08): retiring a gallery's last published photo sends it back to DRAFT, never
// archives it; it can be published again. Run in «Lab Otra Liga» (PREMIUM), never in Lab Galería (its FREE season is
// kept at 25/25). The lab captain joins a team there (product RPCs) so a real participant sees and stops seeing it.
async function otherParticipant() {
  if (state.otherEntryApproved) return;
  if (!state.otherCategoryId) {
    const category = (await rpc('other', 'save_tournament_category', { p_organization_id: state.otherOrganizationId, p_tournament_id: state.otherTournamentId, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' })).json;
    state.otherCategoryId = category?.id || category?.categoryId || category?.category?.id || null;
    await rpc('other', 'change_tournament_status', { p_organization_id: state.otherOrganizationId, p_tournament_id: state.otherTournamentId, p_status: 'registration' });
    save();
  }
  if (!state.otherEntryId) {
    const entry = (await rpc('other', 'create_tournament_team_entry', { p_organization_id: state.otherOrganizationId, p_tournament_id: state.otherTournamentId, p_category_id: state.otherCategoryId, p_arma2_team_id: null, p_name: 'Otra FC', p_short_name: 'OFC', p_primary_color: '#0ea5e9', p_secondary_color: '#f97316', p_registration_source: null, p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: key() })).json;
    state.otherEntryId = entry.entryId; state.otherRosterId = entry.rosterId; save();
  }
  if (!state.otherCaptainAccepted) {
    const invitation = (await rpc('other', 'invite_tournament_team_manager', { p_organization_id: state.otherOrganizationId, p_team_entry_id: state.otherEntryId, p_email: USERS.captain.email, p_display_name: USERS.captain.name, p_role: 'captain' })).json;
    await rpc('captain', 'accept_tournament_team_invitation', { p_token: invitation.token });
    state.otherCaptainAccepted = true; save();
  }
  for (const [index, position] of ['ARQ', 'DEF', 'DEF', 'MED', 'DEL', 'DEL'].entries()) {
    const player = (await rpc('other', 'create_tournament_provisional_player', { p_organization_id: state.otherOrganizationId, p_team_entry_id: state.otherEntryId, p_display_name: `Jugador Otra ${index + 1}` })).json;
    await rpc('other', 'add_tournament_roster_player', { p_organization_id: state.otherOrganizationId, p_team_entry_id: state.otherEntryId, p_roster_id: state.otherRosterId, p_arma2_user_id: null, p_provisional_player_id: player.id || player.provisionalPlayerId || player.playerId, p_display_name: `Jugador Otra ${index + 1}`, p_avatar_url: null, p_shirt_number: index + 1, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: position === 'ARQ' });
  }
  await rpc('captain', 'submit_tournament_team_entry', { p_organization_id: state.otherOrganizationId, p_team_entry_id: state.otherEntryId });
  await rpc('other', 'review_tournament_team_entry', { p_organization_id: state.otherOrganizationId, p_team_entry_id: state.otherEntryId, p_decision: 'approved', p_reason: 'Plantel de laboratorio completo.', p_issues: [] });
  state.otherEntryApproved = true; save();
}

steps['draft-cycle'] = async () => {
  await otherParticipant();
  const sql = async (q) => JSON.parse(await labSql(`select row_to_json(x) from (${q}) x`));
  const galleryRow = (id) => sql(`select status, cover_asset_id is not null as has_cover, submitted_at is null as no_submitted, published_at is null as no_published, archived_at is null as no_archived, version from public.tournament_media_galleries where id = '${id}'`);
  const assetStatus = async (id) => (await sql(`select status from public.tournament_media_assets where id = '${id}'`)).status;
  const seen = async (role, galleryId) => {
    const r = await rpc(role, 'get_published_tournament_media', { p_tournament_id: state.otherTournamentId, p_category_id: null, p_match_id: null, p_limit: 50, p_offset: 0 }, { expect: null });
    return r.status === 200 ? (r.json?.items || []).some((g) => g.id === galleryId || g.galleryId === galleryId) : `refused ${r.status}`;
  };
  const move = (role, assetId, action, reason = null) => rpc(role, 'transition_tournament_media_asset', { p_asset_id: assetId, p_action: action, p_reason: reason }, { expect: null });
  const publish = (role, galleryId) => rpc(role, 'publish_tournament_media_gallery', { p_gallery_id: galleryId }, { expect: null });
  const cover = (role, galleryId, assetId) => rpc(role, 'set_tournament_media_cover', { p_gallery_id: galleryId, p_asset_id: assetId }, { expect: null });
  const code = (r) => `${r.status}${r.json?.message ? ` ${r.json.message}` : r.json?.error ? ` ${r.json.error}` : ''}`;

  const galleryId = await gallery('other', state.otherOrganizationId, state.otherTournamentId, `Ciclo borrador ${new Date().toISOString().slice(11, 19)}`);
  state.draftCycleGallery = galleryId; save();
  const first = await upload('other', galleryId, 38);
  const a = first.json?.assetId;
  out({ step: 'draft-cycle', event: 'upload p38 as owner', result: code(first) });
  await move('other', a, 'approve');
  await cover('other', galleryId, a);
  out({ step: 'draft-cycle', event: 'publish', result: code(await publish('other', galleryId)), gallery: await galleryRow(galleryId),
    participantSees: await seen('captain', galleryId), participantUrls: `${(await urls('captain', [a])).json?.items?.length ?? 0} of 1` });

  // The role matrix on the moderation that now sends the gallery back to draft: only staff of THIS organization.
  for (const role of ['captain', 'outsider', 'owner']) {
    out({ step: 'draft-cycle', actor: { captain: 'captain (participant)', outsider: 'outsider', owner: 'Lab Galería owner (other org)' }[role],
      hide: code(await move(role, a, 'hide', 'intento ajeno')), publish: code(await publish(role, galleryId)) });
  }
  out({ step: 'draft-cycle', actor: 'visitor (no session)', hide: (await fetch(`${GATEWAY}/torneos/rest/v1/rpc/transition_tournament_media_asset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p_asset_id: a, p_action: 'hide', p_reason: 'visitante' }) })).status });
  out({ step: 'draft-cycle', event: 'after the refused attempts', gallery: await galleryRow(galleryId), asset: await assetStatus(a) });

  const issued = (await urls('captain', [a])).json?.items?.[0]?.url;
  const retired = await move('other', a, 'hide', 'Retirada por el organizador');
  out({ step: 'draft-cycle', event: 'owner retires the only published photo (the cover)', result: code(retired), gallery: await galleryRow(galleryId),
    asset: await assetStatus(a), participantSees: await seen('captain', galleryId), newParticipantUrls: `${(await urls('captain', [a])).json?.items?.length ?? 0} of 1`,
    urlIssuedBefore: issued ? (await fetch(issued)).status : 'none', ownerSeesInAdmin: (await rpc('other', 'get_tournament_media_admin_context', { p_organization_id: state.otherOrganizationId, p_tournament_id: state.otherTournamentId, p_status: null, p_limit: 30, p_offset: 0 }, { expect: null })).json?.galleries?.some((g) => g.id === galleryId) ?? null });

  // In draft: the captain still cannot restore or publish it.
  out({ step: 'draft-cycle', actor: 'captain (participant) on the draft', restore: code(await move('captain', a, 'restore')), publish: code(await publish('captain', galleryId)) });

  // A photo pending review blocks publication; rejecting it unblocks.
  const pending = await upload('other', galleryId, 37);
  const p = pending.json?.assetId;
  out({ step: 'draft-cycle', event: 'pending photo in the draft', upload: code(pending), publishWithPending: code(await publish('other', galleryId)) });
  await move('other', p, 'reject', 'No corresponde a la galería');

  // Way back 1: approve ANOTHER photo while the retired one stays hidden; publish; the retired one stays out.
  const other = await upload('other', galleryId, 39);
  const b = other.json?.assetId;
  await move('other', b, 'approve');
  await cover('other', galleryId, b);
  out({ step: 'draft-cycle', event: 'approve another, set it as cover, publish (retired one still hidden)', result: code(await publish('other', galleryId)),
    gallery: await galleryRow(galleryId), assets: { retired: await assetStatus(a), another: await assetStatus(b) }, participantSees: await seen('captain', galleryId),
    participantUrls: `${(await urls('captain', [a, b])).json?.items?.length ?? 0} of 2 (only the new one)` });

  // Way back 2: restore the retired photo inside the published gallery: it is published again.
  out({ step: 'draft-cycle', event: 'restore the retired photo in the published gallery', result: code(await move('other', a, 'restore')), asset: await assetStatus(a),
    participantUrls: `${(await urls('captain', [a, b])).json?.items?.length ?? 0} of 2` });

  // Retire both (cover last) → draft again; restore → cover → publish (the plain way back).
  await move('other', a, 'hide', 'Retirada por el organizador');
  const last = await move('other', b, 'hide', 'Retirada por el organizador');
  out({ step: 'draft-cycle', event: 'retire both, the cover last', result: code(last), gallery: await galleryRow(galleryId), participantSees: await seen('captain', galleryId) });
  out({ step: 'draft-cycle', event: 'restore the cover photo in the draft', result: code(await move('other', b, 'restore')), asset: await assetStatus(b) });
  out({ step: 'draft-cycle', event: 'cover + publish again', cover: code(await cover('other', galleryId, b)), result: code(await publish('other', galleryId)),
    gallery: await galleryRow(galleryId), participantSees: await seen('captain', galleryId), assets: { a: await assetStatus(a), b: await assetStatus(b) } });

  // The explicit «Archivar galería» is unchanged and still final.
  out({ step: 'draft-cycle', event: 'explicit archive still works and is final',
    archive: code(await rpc('other', 'change_tournament_media_gallery_state', { p_gallery_id: galleryId, p_action: 'archive', p_reason: 'Cierre del ciclo de laboratorio' }, { expect: null })),
    gallery: (await galleryRow(galleryId)).status, restoreAfterArchive: code(await move('other', b, 'restore')), republish: code(await publish('other', galleryId)) });
  const audit = await labSql(`select string_agg(action, ',' order by id) from public.tournament_audit_log where resource_id = '${galleryId}'`).catch((e) => String(e.message));
  out({ step: 'draft-cycle', event: 'gallery audit trail', actions: audit });
};

const step = process.argv[2];
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly && steps[step]) await steps[step]();
else if (invokedDirectly && step) { console.error(`unknown step ${step}`); process.exit(2); }
