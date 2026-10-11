// BRANDING-V1 — logos and shields on the REAL local hybrid stack: Supabase Storage on the isolated Torneos database
// (compose.branding.yaml), trusting only what HOSTED Storage trusts (the project's ES256 key + the legacy HS256 secret),
// 00000000000010 (private bucket + storage RLS), 00000000000017 (authorize_tournament_storage_objects) and the
// torneos-media-store worker (MEDIA-STORE-V1), with the gateway under test (Node by default, Edge with GATEWAY=edge).
//
//   A. install: 0010 and 0017 recorded once; the bucket is private; exactly the five branding policies.
//   B. organizer: uploads a tournament logo to the OWNER route (the store names the object and asks the database with
//      the organizer's own token), switches the reference, and its branding context comes back with a signed URL that
//      serves exactly those bytes. Before publication nobody else can sign it.
//   C. publication: catalog search, the call and the public page carry signed URLs (one signature batch per response);
//      the organization logo is the fallback mark; replacing a logo retires the old object for everyone.
//   D. refusals: another identity can neither store nor reference nor remove; wrong type, size and path are refused
//      before storage; a name chosen by the browser is refused; a referenced logo cannot be removed; no bearer, no route.
//   E. a team's own responsible stores its shield and sees it signed in its registration context; nobody else can.
//   F. unpublishing the page withdraws every public signature (storage RLS, not only the gateway).
//
//   G. hosted parity: the bridge token straight at Storage is refused ("alg" not allowed), as on hosted Supabase.
//
// Runs after `TORNEOS_CONNECTED_MODE=on TORNEOS_BRANDING_MODE=on node lab.mjs up`. Nothing touches a remote target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
import { decodeJwt } from 'jose';
import { sql, inGateway, config, BASE, GATEWAY_BASE, GATEWAY_NAME, STORAGE_PUBLIC_BASE } from './lab.mjs';

const RUN = 'bv1' + randomBytes(3).toString('hex');
const torneosSql = (q) => sql('torneos-db', q);
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}
// A small, real PNG (one colour per call) so every stored object is distinguishable.
function png(seed, size = 24) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = seed & 255; raw[o + 1] = (seed >> 8) & 255; raw[o + 2] = (x * 9) & 255; raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function request(path, token, method = 'GET', data, extraHeaders = {}) {
  const base = path.startsWith('/auth/v1') ? BASE : GATEWAY_BASE;
  const raw = Buffer.isBuffer(data);
  const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(data !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    body: data === undefined ? undefined : (raw ? data : JSON.stringify(data)) });
  const text = await r.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
}
const gw = (name, token, params = {}) => request(`/torneos/rest/v1/rpc/${name}`, token, 'POST', params);
const pub = (name, data) => request(`/torneos/public/v1/rpc/${name}`, null, 'POST', data);
const object = (path, token, method = 'POST', bytes = undefined, headers = {}) =>
  request(`/torneos/branding/v1/object/${path}`, token, method, bytes, method === 'POST' ? { 'content-type': 'image/png', ...headers } : headers);
// MEDIA-STORE-V1: the browser names the OWNER only; the store generates the object name (uuid + real extension).
const owner = (org, folder, entity) => `${org}/${folder}/${entity}`;
const stores = async (ownerPath, token, bytes, headers = {}) => {
  const r = await object(ownerPath, token, 'POST', bytes, headers);
  if (r.status === 200) {
    assert.match(r.body.path, new RegExp(`^${ownerPath}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`), show(r));
    assert.deepEqual(Object.keys(r.body), ['path']);
  }
  return r;
};

async function exchange(u) {
  const r = await request('/exchange', u.coreToken, 'POST');
  assert.equal(r.status, 200, `exchange for ${u.label}: ${show(r)}`);
  u.token = r.body.access_token; u.tokenAt = Date.now(); u.identity = decodeJwt(u.token).sub;
  return u.token;
}
async function tok(u) { if (!u.token || Date.now() - u.tokenAt > 80_000) await exchange(u); return u.token; }
async function coreActor(label) {
  const s = await request('/auth/v1/signup', null, 'POST', { email: `${RUN}-${label}@example.test`, password: `${randomUUID()}Aa!`,
    data: { full_name: `${RUN} ${label}` } });
  assert.equal(s.status, 200, `GoTrue signup for ${label}`);
  const u = { label, coreToken: s.body.access_token, coreUserId: s.body.user.id };
  await exchange(u);
  return u;
}
// What a browser does with a signed URL: a plain GET to the storage's public base.
async function fetchSigned(url) {
  assert.ok(typeof url === 'string' && url.startsWith(`${STORAGE_PUBLIC_BASE}/object/sign/tournament-branding/`), `signed URL: ${url}`);
  const r = await fetch(url, { headers: { connection: 'close' } });
  return { status: r.status, type: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()) };
}
// Straight at storage as anon, from inside the lab network (the policy itself, not the gateway).
function anonCanSign(path, anonKey) {
  const out = inGateway(`const r = await fetch('http://torneos-storage:5000/object/sign/tournament-branding', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ${JSON.stringify(anonKey)} },
      body: JSON.stringify({ expiresIn: 60, paths: [${JSON.stringify(path)}] }) });
    const body = await r.json().catch(() => null);
    console.log(JSON.stringify({ status: r.status, ok: Array.isArray(body) && !body[0]?.error && Boolean(body[0]?.signedURL) }));`);
  return JSON.parse(out.trim().split('\n').pop());
}

test(`BRANDING-V1 — logos and shields on the real hybrid stack (${GATEWAY_NAME} gateway)`, async (t) => {
  const check = (name, fn) => t.test(name, fn);
  const ok = async (name, who, params = {}) => {
    const r = await gw(name, await tok(who), params);
    assert.equal(r.status, 200, `${name} as ${who.label}: ${show(r)}`);
    return r.body;
  };
  const { anonKey } = await config();
  const S = {};

  await check('A. 0010 installed once; private bucket; exactly the branding policies; no public URL', async () => {
    assert.equal(torneosSql("select count(*) from lab_meta.torneos_migrations where name in ('00000000000010_branding_v1.sql', '00000000000017_media_store_v1.sql')").trim(), '2');
    assert.equal(torneosSql(`select has_function_privilege('authenticated', 'public.authorize_tournament_storage_objects(text,text,text[])', 'EXECUTE')
      || '/' || has_function_privilege('anon', 'public.authorize_tournament_storage_objects(text,text,text[])', 'EXECUTE')`).trim(), 'true/false');
    assert.equal(torneosSql("select public::text from storage.buckets where id = 'tournament-branding'").trim(), 'false');
    assert.equal(torneosSql(`select string_agg(policyname || ':' || cmd || ':' || roles::text, ',' order by policyname)
      from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tournament_branding_%'`).trim(),
    'tournament_branding_delete_authorized:DELETE:{authenticated},tournament_branding_insert_authorized:INSERT:{authenticated},'
      + 'tournament_branding_select_authorized:SELECT:{authenticated},tournament_branding_select_public:SELECT:{anon},'
      + 'tournament_branding_update_denied:UPDATE:{authenticated}');
    assert.equal(torneosSql(`select has_function_privilege('anon', 'public.can_read_tournament_branding_object(text)', 'EXECUTE')
      || '/' || has_function_privilege('anon', 'public.is_public_tournament_branding_object(text)', 'EXECUTE')`).trim(), 'false/true');
  });

  await check('B. organizer stores a logo with its own token; the branding context is signed; nobody else signs it yet', async () => {
    S.organizer = await coreActor('organizer');
    S.applicant = await coreActor('applicant');
    S.other = await coreActor('other');
    S.org = (await ok('create_tournament_organization', S.organizer, { p_name: `Liga ${RUN}`, p_slug: `liga-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
    S.season = (await ok('create_tournament_season', S.organizer, { p_organization_id: S.org, p_name: 'Apertura', p_slug: `apertura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    S.tournament = (await ok('create_tournament_with_defaults', S.organizer, { p_organization_id: S.org, p_season_id: S.season, p_name: `Copa ${RUN}`, p_slug: `copa-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    await ok('save_tournament_category', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' });
    await ok('change_tournament_status', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_status: 'registration' });

    S.logoBytes = png(0x3a7f);
    const stored = await stores(owner(S.org, 'tournaments', S.tournament), await tok(S.organizer), S.logoBytes);
    assert.equal(stored.status, 200, show(stored));
    S.logo = stored.body.path;
    // Stored by the service role after the database said yes: no client identity owns the object.
    assert.equal(torneosSql(`select count(*) || '/' || count(owner_id) from storage.objects where bucket_id = 'tournament-branding' and name = '${S.logo}'`).trim(), '1/0');
    const reference = await ok('set_tournament_branding_reference', S.organizer, { p_organization_id: S.org, p_entity_kind: 'tournament', p_entity_id: S.tournament, p_path: S.logo });
    assert.equal(reference.previousPath ?? null, null);

    const context = await ok('get_tournament_branding_context', S.organizer, { p_organization_id: S.org, p_tournament_id: null });
    const entry = context.tournaments.find((item) => item.id === S.tournament);
    assert.equal(entry.logoPath, S.logo);
    const served = await fetchSigned(entry.logoUrl);
    assert.deepEqual([served.status, served.type], [200, 'image/png']);
    assert.ok(served.bytes.equals(S.logoBytes), 'the signed URL serves exactly the stored object');
    assert.equal(anonCanSign(S.logo, anonKey).ok, false, 'an unpublished logo is not signable as anon (storage RLS)');
    const foreignContext = await gw('get_tournament_branding_context', await tok(S.other), { p_organization_id: S.org, p_tournament_id: null });
    assert.notEqual(foreignContext.status, 200, 'another identity reads no branding context of this organization');
  });

  await check('C. published: catalog, call and public page carry signed URLs; the organization logo is the fallback mark', async () => {
    S.slug = (await ok('set_tournament_public_page_published', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_published: true })).publicSlug;
    await ok('save_tournament_catalog_listing', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament,
      p_summary: 'Fútbol 5 los sábados por la tarde.', p_locality: 'Rosario', p_venue_id: null, p_entry_fee_cents: null,
      p_entry_fee_includes: null, p_payment_note: null, p_requirements: null, p_rules_summary: null,
      p_entry_fee_unit: 'team', p_contact_whatsapp: null, p_contact_public: null });
    await ok('set_tournament_catalog_listing_status', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_listed: true });
    await ok('set_tournament_applications_state', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_state: 'open' });

    S.orgBytes = png(0x51c2);
    const orgStored = await stores(owner(S.org, 'organizations', S.org), await tok(S.organizer), S.orgBytes);
    assert.equal(orgStored.status, 200, show(orgStored));
    S.orgLogo = orgStored.body.path;
    await ok('set_tournament_branding_reference', S.organizer, { p_organization_id: S.org, p_entity_kind: 'organization', p_entity_id: S.org, p_path: S.orgLogo });

    const search = await pub('search_tournament_catalog', { p_query: RUN, p_scope: 'all' });
    assert.equal(search.status, 200, show(search));
    const card = search.body.items[0];
    assert.deepEqual([card.logoPath, card.organizationLogoPath], [S.logo, S.orgLogo]);
    assert.ok((await fetchSigned(card.logoUrl)).bytes.equals(S.logoBytes));
    assert.ok((await fetchSigned(card.organizationLogoUrl)).bytes.equals(S.orgBytes));
    const call = await pub('get_tournament_catalog_entry', { p_public_slug: S.slug });
    assert.ok((await fetchSigned(call.body.logoUrl)).bytes.equals(S.logoBytes), 'the call');
    assert.equal((await pub('get_public_tournament_page', { p_public_slug: S.slug, p_category_slug: null })).status, 200);
    // The public page's logos: the baseline's get_public_tournament_branding, projected to names and logos.
    const logos = await pub('get_public_tournament_branding', { p_public_slug: S.slug });
    assert.equal(logos.status, 200, show(logos));
    assert.deepEqual(Object.keys(logos.body.tournament).sort(), ['logoPath', 'logoUrl', 'name']);
    assert.doesNotMatch(JSON.stringify(logos.body).replace(/"logo(Path|Url)":"[^"]*"/g, ''), /[0-9a-f]{8}-[0-9a-f]{4}-/, 'no internal id');
    assert.ok((await fetchSigned(logos.body.tournament.logoUrl)).bytes.equals(S.logoBytes), 'the public page');
    assert.ok((await fetchSigned(logos.body.organization.logoUrl)).bytes.equals(S.orgBytes));
    assert.equal((await pub('get_public_tournament_branding', { p_public_slug: S.slug, p_extra: 1 })).status, 400, 'exact body');
    assert.equal(anonCanSign(S.logo, anonKey).ok, true, 'the current logo of a published page is public');
  });

  await check('C2. replacing a logo retires the old object: no signature, removed by its owner', async () => {
    const nextBytes = png(0x0b0b);
    const nextStored = await stores(owner(S.org, 'tournaments', S.tournament), await tok(S.organizer), nextBytes);
    assert.equal(nextStored.status, 200, show(nextStored));
    const next = nextStored.body.path;
    // While referenced, not even its organizer can remove it (the database's in-use rule).
    assert.deepEqual([(await object(S.logo, await tok(S.organizer), 'DELETE')).status], [403], 'a referenced logo stays');
    const reference = await ok('set_tournament_branding_reference', S.organizer, { p_organization_id: S.org, p_entity_kind: 'tournament', p_entity_id: S.tournament, p_path: next });
    assert.equal(reference.previousPath, S.logo);
    assert.equal(anonCanSign(S.logo, anonKey).ok, false, 'an old version is never public');
    const removed = await object(S.logo, await tok(S.organizer), 'DELETE');
    assert.deepEqual([removed.status, removed.body], [200, { removed: true }], show(removed));
    assert.equal(torneosSql(`select count(*) from storage.objects where bucket_id = 'tournament-branding' and name = '${S.logo}'`).trim(), '0');
    const card = (await pub('search_tournament_catalog', { p_query: RUN, p_scope: 'all' })).body.items[0];
    assert.equal(card.logoPath, next);
    assert.ok((await fetchSigned(card.logoUrl)).bytes.equals(nextBytes));
    S.logo = next; S.logoBytes = nextBytes;
  });

  await check('D. refusals: foreign identity, type, size, path and no bearer', async () => {
    const stored = await stores(owner(S.org, 'tournaments', S.tournament), await tok(S.other), png(1));
    assert.deepEqual([stored.status, stored.body?.error], [403, 'TORNEOS_BRANDING_FORBIDDEN'], show(stored));
    const reference = await gw('set_tournament_branding_reference', await tok(S.other), { p_organization_id: S.org, p_entity_kind: 'tournament', p_entity_id: S.tournament, p_path: S.logo });
    assert.notEqual(reference.status, 200, 'another identity cannot switch the reference');
    const removed = await object(S.logo, await tok(S.other), 'DELETE');
    assert.notEqual(removed.status, 200, show(removed));
    assert.equal(torneosSql(`select count(*) from storage.objects where bucket_id = 'tournament-branding' and name = '${S.logo}'`).trim(), '1');
    const token = await tok(S.organizer);
    const before = torneosSql(`select count(*) from storage.objects where bucket_id = 'tournament-branding' and name like '${S.org}/%'`).trim();
    const ownerPath = owner(S.org, 'tournaments', S.tournament);
    assert.equal((await object(ownerPath, token, 'POST', png(2), { 'content-type': 'image/jpeg' })).status, 415, 'the REAL type decides');
    assert.equal((await object(ownerPath, token, 'POST', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { 'content-type': 'image/png' })).status, 415);
    assert.equal((await object(ownerPath, token, 'POST', Buffer.from('not an image at all'), { 'content-type': 'image/webp' })).status, 415);
    assert.equal((await object(ownerPath, token, 'POST', png(2), { 'content-type': 'image/gif' })).status, 415);
    const huge = await object(ownerPath, token, 'POST', Buffer.alloc(2 * 1024 * 1024 + 1, 1));
    assert.equal(huge.status, 413);
    const named = await object(`${ownerPath}/${randomUUID()}.png`, token, 'POST', png(3));
    assert.deepEqual([named.status, named.body?.error], [400, 'TORNEOS_BRANDING_INVALID_REFERENCE'], 'the browser never names the object');
    assert.equal((await object(`${S.org}/tournaments/${S.tournament}/../x.png`, token, 'POST', png(3))).status, 404, 'not an owner route');
    assert.equal((await object(`${S.org}/tournaments/${S.org}`, token, 'POST', png(5))).status, 403, 'an entity that is not this tournament');
    assert.equal((await object(ownerPath, null, 'POST', png(4))).status, 401);
    assert.equal(torneosSql(`select count(*) from storage.objects where bucket_id = 'tournament-branding' and name like '${S.org}/%'`).trim(), before, 'nothing stored');
  });

  await check('E. team shield: the organization stores it (visual policy organization_only); the team responsible sees it signed; nobody else', async () => {
    await ok('update_my_torneos_profile', S.applicant, { p_display_name: 'Capi Halcones', p_notify_registration_requests: true });
    const started = await ok('start_tournament_application', S.applicant, { p_public_slug: S.slug, p_category_slug: 'libre',
      p_core_team_id: null, p_team_name: `Halcones ${RUN}`, p_message: null, p_accept_conditions: true, p_idempotency_key: randomUUID() });
    S.entry = started.teamEntryId;
    const shieldOwner = owner(S.org, 'teams', S.entry);
    S.shieldBytes = png(0x7e11);
    // The tournament's default visual policy keeps team branding with the organization: the captain cannot store it.
    const byCaptain = await stores(shieldOwner, await tok(S.applicant), S.shieldBytes);
    assert.deepEqual([byCaptain.status, byCaptain.body?.error], [403, 'TORNEOS_BRANDING_FORBIDDEN'], show(byCaptain));
    assert.equal((await stores(shieldOwner, await tok(S.other), S.shieldBytes)).status, 403, 'not their organization');
    const shield = await stores(shieldOwner, await tok(S.organizer), S.shieldBytes);
    assert.equal(shield.status, 200, show(shield));
    S.shield = shield.body.path;
    await ok('set_tournament_branding_reference', S.organizer, { p_organization_id: S.org, p_entity_kind: 'team', p_entity_id: S.entry, p_path: S.shield });
    const context = await ok('get_team_registration_context', S.applicant, { p_organization_id: S.org, p_team_entry_id: S.entry });
    assert.equal(context.entry.shieldPath, S.shield);
    assert.ok((await fetchSigned(context.entry.shieldUrl)).bytes.equals(S.shieldBytes), 'the responsible sees its team shield');
    assert.equal(anonCanSign(S.shield, anonKey).ok, false, 'a shield is public only once the published fixture shows the team');
    const teams = await ok('get_tournament_teams_context', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament });
    const listed = JSON.stringify(teams);
    assert.ok(listed.includes(S.shield) && listed.includes('/object/sign/tournament-branding/'), 'the organizer sees it in the teams list');
  });

  await check('F. unpublishing the page withdraws every public signature (storage RLS, not only the gateway)', async () => {
    await ok('set_tournament_catalog_listing_status', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_listed: false });
    await ok('set_tournament_public_page_published', S.organizer, { p_organization_id: S.org, p_tournament_id: S.tournament, p_published: false });
    assert.equal(anonCanSign(S.logo, anonKey).ok, false);
    assert.equal(anonCanSign(S.orgLogo, anonKey).ok, false);
    assert.equal((await pub('get_public_tournament_branding', { p_public_slug: S.slug })).body, null, 'no public logos left');
    const context = await ok('get_tournament_branding_context', S.organizer, { p_organization_id: S.org, p_tournament_id: null });
    assert.ok((await fetchSigned(context.tournaments.find((item) => item.id === S.tournament).logoUrl)).bytes.equals(S.logoBytes),
      'the organizer still sees its own logo');
  });
  await check('G. hosted parity: a bridge token straight at Storage is refused before any policy ("alg" not allowed)', async () => {
    const bearer = await tok(S.organizer);
    const out = inGateway(`const h = { authorization: 'Bearer ' + ${JSON.stringify(bearer)}, 'content-type': 'application/json' };
      const put = await fetch('http://torneos-storage:5000/object/tournament-branding/${owner(S.org, 'tournaments', S.tournament)}/${randomUUID()}.png',
        { method: 'POST', headers: { ...h, 'content-type': 'image/png' }, body: new Uint8Array([137, 80, 78, 71]) });
      const sign = await fetch('http://torneos-storage:5000/object/sign/tournament-branding', { method: 'POST', headers: h,
        body: JSON.stringify({ expiresIn: 60, paths: [${JSON.stringify(S.logo)}] }) });
      console.log(JSON.stringify({ put: put.status, putBody: await put.text(), sign: sign.status, signBody: await sign.text() }));`);
    const r = JSON.parse(out.trim().split('\n').pop());
    assert.deepEqual([r.put, r.sign], [400, 400], JSON.stringify(r));
    assert.match(r.putBody, /alg.*not allowed/i);
    assert.match(r.signBody, /alg.*not allowed/i);
  });
});
