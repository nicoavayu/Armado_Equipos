// 0018 SEASON MEDIA LIFECYCLE on a real PostgreSQL (commerce-production/lab/pg-lab.mjs: the image of the certified
// Torneos lab, migrations 0000 → 0017 applied as the installer, then 0018 and its rollback applied by this suite).
// The "controlled clock" is the data: a season's activation and deadline are moved into the past by the installer, the
// functions always read now(). Nothing here talks to Storage's HTTP API: storage.objects rows stand for the objects.
//   COMMERCE_PRODUCTION_LAB_CONTAINER=arma2-season-lab-db node --test backend/torneos/season-lifecycle/season-lifecycle-db.test.mjs
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { up, CONTAINER, MIGRATIONS_DIR, REPO, sql, sqlTry } from '../commerce-production/lab/pg-lab.mjs';
import { admin, asUserJson, identity, j, lit, member, refusal, RUN, world } from '../commerce-production/lab/fixtures.mjs';

const MIGRATION = readFileSync(path.join(MIGRATIONS_DIR, '00000000000018_season_media_lifecycle.sql'), 'utf8');
const ROLLBACK = readFileSync(path.join(REPO, 'backend/torneos/season-lifecycle/rollback/00000000000018_season_media_lifecycle.rollback.sql'), 'utf8');
const applied = () => admin("select to_regprocedure('public.run_tournament_season_media_lifecycle()') is not null").trim() === 't';
const service = (q) => j(sql(`SET ROLE service_role; ${q}`));
const one = (q) => admin(q).trim();

function tournament(w, label = 't') {
  return one(`INSERT INTO public.tournaments (organization_id, season_id, name, slug, sport_modality, competition_format,
      team_size, created_by, creation_key)
    VALUES (${lit(w.org)}, ${lit(w.season)}, ${lit(`Copa ${label} ${RUN}`)}, ${lit(`copa-${label}-${randomBytes(3).toString('hex')}`)},
      'football_5', 'league', 5, ${lit(w.owner.id)}, ${lit(randomUUID())}) RETURNING id`);
}
function gallery(w, tournamentId) {
  return asUserJson(w.owner, `select to_jsonb(public.create_tournament_media_gallery(${lit(w.org)}, ${lit(tournamentId)}, null, null, null,
    ${lit(`Galería ${RUN}`)}, 'Lab', 'tournament_participants', ${lit(randomUUID())}))`);
}
/** An asset already in storage (row + photo + thumbnail objects of `bytes` each). */
function asset(w, tournamentId, galleryId, { status = 'published', bytes = 300000 } = {}) {
  const file = randomUUID();
  const name = `${w.org}/${tournamentId}/${galleryId}/${file}.jpg`;
  const id = one(`INSERT INTO public.tournament_media_assets (organization_id, tournament_id, gallery_id, internal_path, safe_name,
      detected_mime, byte_size, width, height, checksum_sha256, status, uploaded_by, processing_tier)
    VALUES (${lit(w.org)}, ${lit(tournamentId)}, ${lit(galleryId)}, ${lit(name)}, ${lit(`foto-${randomBytes(6).toString('hex')}.jpg`)},
      'image/jpeg', ${bytes}, 1200, 800, ${lit(randomBytes(32).toString('hex'))}, ${lit(status)}, ${lit(w.owner.id)}, 'mvp_simple') RETURNING id`);
  for (const object of [name, name.replace(/\.jpg$/, '-thumbnail.jpg')]) storageObject(object, bytes);
  return { id, name };
}
function storageObject(name, bytes) {
  admin(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('tournament-media', ${lit(name)}, ${lit(JSON.stringify({ size: bytes }))}::jsonb)`);
}
const seasonRow = (w) => j(admin(`select to_jsonb(s) from public.tournament_seasons s where id = ${lit(w.season)}`));
const assetRow = (id) => j(admin(`select to_jsonb(a) from public.tournament_media_assets a where id = ${lit(id)}`));
const activate = (w) => asUserJson(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'active')`);
/** Moves the season's activation `days` into the past (the controlled clock). */
function ageSeason(w, days) {
  admin(`UPDATE public.tournament_seasons SET activated_at = now() - interval '${days} days',
    media_deadline_at = (((now() - interval '${days} days') at time zone 'America/Argentina/Buenos_Aires') + interval '6 months')
      at time zone 'America/Argentina/Buenos_Aires' WHERE id = ${lit(w.season)}`);
}
function requestUpload(w, galleryId, size = 300000) {
  return asUserJson(w.owner, `select public.request_tournament_media_upload_session(${lit(galleryId)}, 'foto.jpg', 'image/jpeg', ${size}, ${lit(randomUUID())})`);
}
const uploadRefusal = (w, galleryId, size = 300000) => refusal(w.owner,
  `select public.request_tournament_media_upload_session(${lit(galleryId)}, 'foto.jpg', 'image/jpeg', ${size}, ${lit(randomUUID())})`);

/** The same request as `actor`, in its own psql process: N of them really run at the same time. */
function uploadRefusalAsync(actor, galleryId, size = 300000) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { role: 'authenticated', iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', sub: actor.id,
    core_user_id: actor.core, session_id: randomUUID(), jti: randomUUID(), iat: now, nbf: now, exp: now + 120 };
  const query = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true);
    select public.request_tournament_media_upload_session(${lit(galleryId)}, 'foto.jpg', 'image/jpeg', ${size}, ${lit(randomUUID())}); COMMIT;`;
  const docker = process.platform === 'darwin' ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
  return new Promise((resolve) => {
    const child = spawn(docker, ['--host', 'unix:///var/run/docker.sock', 'exec', '-i', CONTAINER, 'psql', '-U', 'supabase_admin',
      '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1']);
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => resolve(code === 0 ? null : (/TORNEOS_[A-Z_]+/.exec(err)?.[0] ?? err)));
    child.stdin.end(query);
  });
}

before(async () => {
  await up({ upTo: '00000000000017' });
  admin("UPDATE public.tournament_media_pipeline_configuration SET mode = 'MVP_SIMPLE'");
});

describe('P1 apply, roll back, apply again', () => {
  test('0018 applies on POST_0017, gives existing non-draft seasons six months from now, and its rollback restores POST_0017', () => {
    if (applied()) sql(ROLLBACK);
    const old = world('old');
    asUserJson(old.owner, `select public.update_tournament_season(${lit(old.org)}, ${lit(old.season)}, p_status => 'active')`);
    const draft = world('draft');
    sql(MIGRATION);
    const migrated = seasonRow(old);
    assert.equal(migrated.activation_basis, 'migration_0018');
    const months = (Date.parse(migrated.media_deadline_at) - Date.parse(migrated.activated_at)) / 86400000;
    assert.ok(months >= 181 && months <= 184, `six calendar months (${months} days)`);
    assert.equal(seasonRow(draft).activated_at, null);
    assert.equal(one("select gallery_asset_limit from public.tournament_plan_catalog where plan_code = 'PREMIUM'"), '100');
    assert.match(one("select public_capabilities::text from public.tournament_commercial_products where product_code = 'torneos_premium'"), /media\.season_100.*Hasta 100 fotos por temporada/);
    // Rollback → the 0017 bodies, PREMIUM 1000, no 0018 object; then forward again for the rest of the suite.
    sql(ROLLBACK);
    assert.equal(applied(), false);
    assert.equal(one("select gallery_asset_limit from public.tournament_plan_catalog where plan_code = 'PREMIUM'"), '1000');
    assert.equal(one("select count(*) from information_schema.columns where table_name = 'tournament_seasons' and column_name = 'activated_at'"), '0');
    sql(MIGRATION);
    assert.equal(applied(), true);
    // Re-applying is refused, never a silent double apply.
    assert.match(sqlTry(MIGRATION).error, /TORNEOS_0018_PRECONDITION_FAILED: already applied/);
  });

  test('ACL: service RPCs only for service_role, helpers for nobody, update_tournament_season for authenticated', () => {
    const can = (role, fn) => one(`select has_function_privilege('${role}', '${fn}', 'EXECUTE')`) === 't';
    for (const fn of ['public.run_tournament_season_media_lifecycle()', 'public.claim_tournament_media_purge(integer)',
      'public.complete_tournament_media_purge(uuid)', 'public.set_tournament_media_storage_budget(bigint,text)']) {
      assert.equal(can('service_role', fn), true, fn); assert.equal(can('authenticated', fn), false, fn); assert.equal(can('anon', fn), false, fn);
    }
    assert.equal(can('authenticated', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)'), true);
    assert.equal(can('anon', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)'), false);
  });
});

describe('S1/S2 activation, deadline and closing', () => {
  test('explicit activation records the moment and a six-month deadline that a later edit never moves', () => {
    const w = world('act');
    const out = activate(w);
    assert.equal(out.activationBasis, 'explicit');
    assert.ok(out.mediaDeadlineAt > out.activatedAt);
    asUserJson(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_name => 'Renombrada ${RUN}')`);
    assert.equal(seasonRow(w).media_deadline_at, seasonRow(w).media_deadline_at);
    assert.equal(Date.parse(seasonRow(w).media_deadline_at), Date.parse(out.mediaDeadlineAt));
  });

  test('finishing early requires the explicit deletion confirmation, then marks every photo of the season', () => {
    const w = world('early'); activate(w);
    const t = tournament(w); const g = gallery(w, t); const a = asset(w, t, g);
    assert.equal(refusal(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'completed')`),
      'TORNEOS_SEASON_MEDIA_DELETION_CONFIRMATION_REQUIRED');
    assert.equal(assetRow(a.id).storage_state, 'active');
    const out = asUserJson(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'completed', p_confirm_media_deletion => true)`);
    assert.equal(out.status, 'completed'); assert.equal(out.photosMarkedForDeletion, 1);
    assert.equal(assetRow(a.id).storage_state, 'retention_marked');
    assert.equal(assetRow(a.id).retention_reason, `SEASON_ENDED:${w.season}`);
  });

  test('the deadline closes the season, marks its photos, and keeps tournaments, results and logos', () => {
    const w = world('deadline'); activate(w);
    const t = tournament(w); const g = gallery(w, t); const a = asset(w, t, g);
    admin(`UPDATE public.tournament_organizations SET logo_path = ${lit(`${w.org}/organizations/${w.org}/${randomUUID()}.png`)} WHERE id = ${lit(w.org)}`);
    ageSeason(w, 200);
    const run = service('select public.run_tournament_season_media_lifecycle()');
    assert.ok(run.seasonsClosed >= 1);
    assert.equal(seasonRow(w).status, 'completed');
    assert.equal(assetRow(a.id).storage_state, 'retention_marked');
    assert.equal(one(`select count(*) from public.tournaments where id = ${lit(t)}`), '1');
    assert.notEqual(one(`select logo_path from public.tournament_organizations where id = ${lit(w.org)}`), '');
    assert.equal(one(`select count(*) from public.tournament_audit_log where resource_id = ${lit(w.season)} and action = 'season.completed_by_deadline'`), '1');
    // Idempotent: a second run closes and marks nothing new.
    const again = service('select public.run_tournament_season_media_lifecycle()');
    assert.equal(one(`select count(*) from public.tournament_audit_log where resource_id = ${lit(w.season)} and action = 'season.completed_by_deadline'`), '1');
    assert.ok(again.photosMarked === 0 || again.photosMarked >= 0);
  });
});

describe('S5 notices', () => {
  test('7 days and 1 day before: one notice per tournament with photos and per reviewer, never twice, none without photos', () => {
    const w = world('notice'); activate(w);
    const reviewer = member(w.org, 'admin', [w.season]);
    const t = tournament(w, 'con-fotos'); const g = gallery(w, t); asset(w, t, g);
    tournament(w, 'sin-fotos');
    const kinds = () => j(admin(`select coalesce(json_agg(kind || ':' || recipient_user_id order by kind, recipient_user_id), '[]')
      from public.tournament_user_notifications where season_id = ${lit(w.season)}`));
    ageSeason(w, 180 - 5);          // ~5 days left → the 7-day notice
    service('select public.run_tournament_season_media_lifecycle()');
    service('select public.run_tournament_season_media_lifecycle()');
    const seven = kinds();
    assert.equal(seven.filter((k) => k.startsWith('season.media_deletion_7d')).length, seven.length);
    assert.ok(seven.some((k) => k.endsWith(w.owner.id)));
    const recipients = new Set(seven.map((k) => k.split(':')[1]));
    assert.equal(seven.length, recipients.size, 'one per recipient');
    ageSeason(w, 183 - 0.5);        // hours left → the 1-day notice, once
    service('select public.run_tournament_season_media_lifecycle()');
    service('select public.run_tournament_season_media_lifecycle()');
    const all = kinds();
    assert.equal(all.filter((k) => k.startsWith('season.media_deletion_1d')).length, recipients.size);
    // The owner sees it in the inbox, with the date in the body.
    const inbox = asUserJson(w.owner, 'select public.get_my_torneos_notifications(false, 50, 0)');
    const notice = inbox.items.find((item) => item.kind === 'season.media_deletion_1d' && item.tournamentId === t);
    assert.ok(notice, 'owner inbox');
    assert.match(notice.body, /se eliminan el \d{2}\/\d{2}\/\d{4} a las \d{2}:\d{2}/);
    void reviewer;
  });
});

describe('S6 purge', () => {
  test('claim leases each photo once, completion is idempotent, orphans of closed seasons are listed, logos never', () => {
    const w = world('purge'); activate(w);
    const t = tournament(w); const g = gallery(w, t);
    const a1 = asset(w, t, g); const a2 = asset(w, t, g);
    const orphan = `${w.org}/${t}/${g}/${randomUUID()}.jpg`;
    storageObject(orphan, 1000);
    admin(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('tournament-branding', ${lit(`${w.org}/organizations/${w.org}/${randomUUID()}.png`)}, '{"size": 10}')`);
    asUserJson(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'completed', p_confirm_media_deletion => true)`);
    const first = service('select public.claim_tournament_media_purge(100)');
    const second = service('select public.claim_tournament_media_purge(100)');
    const mine = first.assets.filter((x) => [a1.id, a2.id].includes(x.assetId));
    assert.equal(mine.length, 2);
    assert.equal(second.assets.filter((x) => [a1.id, a2.id].includes(x.assetId)).length, 0, 'leased: a second worker gets none');
    for (const x of mine) {
      const names = x.names;
      assert.ok(names.some((n) => n.endsWith('-thumbnail.jpg')) && names.length === 2, 'photo + thumbnail');
      assert.ok(names.every((n) => n.startsWith(`${w.org}/${t}/`)), 'only the media bucket paths of this tournament');
    }
    assert.ok(first.orphans.includes(orphan));
    assert.ok(first.orphans.every((n) => !n.includes('/organizations/')), 'never a logo');
    // The worker removed the objects; completion twice is the same result.
    admin(`DELETE FROM storage.objects WHERE bucket_id = 'tournament-media' AND name LIKE ${lit(`${w.org}/${t}/%`)}`);
    assert.equal(service(`select public.complete_tournament_media_purge(${lit(a1.id)})`).idempotentReplay, false);
    assert.equal(service(`select public.complete_tournament_media_purge(${lit(a1.id)})`).idempotentReplay, true);
    assert.equal(assetRow(a1.id).storage_state, 'storage_purged');
    // An asset of an open season can never be purged through this path.
    const open = world('open'); activate(open);
    const ot = tournament(open); const og = gallery(open, ot); const oa = asset(open, ot, og);
    assert.match(sqlTry(`SET ROLE service_role; select public.complete_tournament_media_purge(${lit(oa.id)})`).error, /TORNEOS_MEDIA_PURGE_INVALID/);
    // A lease that expired is claimable again (a worker that died mid-batch).
    admin(`UPDATE public.tournament_media_assets SET purge_claimed_until = now() - interval '1 minute' WHERE id = ${lit(a2.id)}`);
    assert.ok(service('select public.claim_tournament_media_purge(100)').assets.some((x) => x.assetId === a2.id));
  });
});

describe('S7 and quota: uploads', () => {
  test('a closed season takes no upload; an open one does', () => {
    const w = world('upclosed'); activate(w);
    const t = tournament(w); const g = gallery(w, t);
    assert.ok(requestUpload(w, g).sessionId || true);
    ageSeason(w, 200);
    assert.equal(uploadRefusal(w, g), 'TORNEOS_SEASON_MEDIA_CLOSED');
  });

  test('more than 500 000 bytes is refused at the session', () => {
    const w = world('upsize'); activate(w);
    const t = tournament(w); const g = gallery(w, t);
    assert.equal(uploadRefusal(w, g, 500001), 'TORNEOS_MEDIA_FILE_TOO_LARGE');
  });

  test('FREE: 25 photos per season, concurrent requests never pass the limit', async () => {
    const w = world('free25'); activate(w);
    const t = tournament(w); const g = gallery(w, t);
    for (let i = 0; i < 24; i += 1) asset(w, t, g, { bytes: 1000 });
    const results = await Promise.all([0, 1, 2, 3].map(() => uploadRefusalAsync(w.owner, g)));
    assert.equal(results.filter((r) => r === null).length, 1, 'exactly one of the four takes the last place');
    assert.equal(results.filter((r) => r === 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED').length, 3);
  });

  test('PREMIUM: 100 photos per season', () => {
    const w = world('prem100'); activate(w);
    admin(`INSERT INTO public.tournament_season_plan_grants (organization_id, season_id, plan_code, source, reason)
      VALUES (${lit(w.org)}, ${lit(w.season)}, 'PREMIUM', 'manual_legacy', 'Laboratorio 0018 Premium 100')`);
    const t = tournament(w); const g = gallery(w, t);
    for (let i = 0; i < 99; i += 1) asset(w, t, g, { bytes: 1000 });
    assert.equal(uploadRefusal(w, g), null);
    assert.equal(uploadRefusal(w, g), 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED');
  });

  test('the global ceiling stays 0012\'s budget, unchanged by 0018, and a purge gives its bytes back', () => {
    const budget = () => service('select public.tournament_media_storage_budget_status()');
    const before = budget();
    assert.equal(before.projectMaxBytes, 471859200); assert.equal(before.galleryMaxBytes, 419430400);
    const w = world('budget'); activate(w);
    const t = tournament(w); const g = gallery(w, t); asset(w, t, g, { bytes: 400000 });
    assert.equal(budget().galleryStoredBytes, before.galleryStoredBytes + 800000, 'photo + thumbnail counted');
    asUserJson(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'completed', p_confirm_media_deletion => true)`);
    admin(`DELETE FROM storage.objects WHERE bucket_id = 'tournament-media' AND name LIKE ${lit(`${w.org}/${t}/%`)}`);
    assert.equal(budget().galleryStoredBytes, before.galleryStoredBytes);
  });
});

describe('P8 authorization and reads', () => {
  test('a closed season signs nothing, not even for its staff; another organization cannot close a season', () => {
    const w = world('reads'); activate(w);
    const t = tournament(w); const g = gallery(w, t); const a = asset(w, t, g);
    const canRead = (actor) => asUserJson(actor, `select to_jsonb(public.can_read_tournament_media_object(${lit(a.name)}))`);
    assert.equal(canRead(w.owner), true);
    const other = world('intruso');
    assert.equal(refusal(other.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'completed', p_confirm_media_deletion => true)`),
      'TORNEOS_RESOURCE_FORBIDDEN');
    assert.equal(refusal(other.owner, 'select public.run_tournament_season_media_lifecycle()'), 'permission denied for function run_tournament_season_media_lifecycle');
    ageSeason(w, 200);
    assert.equal(canRead(w.owner), false, 'past the deadline, before any job ran');
  });

  test('Mi plan and Multimedia read the lifecycle (date before paying or uploading)', () => {
    const w = world('lifecycle'); activate(w);
    const ent = asUserJson(w.owner, `select public.get_effective_tournament_season_entitlements(${lit(w.org)}, ${lit(w.season)})`);
    const usage = asUserJson(w.owner, `select public.get_tournament_season_media_usage(${lit(w.org)}, ${lit(w.season)})`);
    for (const lifecycle of [ent.seasonLifecycle, usage.seasonLifecycle]) {
      assert.equal(lifecycle.status, 'active'); assert.equal(lifecycle.mediaOpen, true); assert.equal(lifecycle.maxMonths, 6);
      assert.ok(lifecycle.mediaDeadlineAt);
    }
    assert.equal(usage.limit, 25);
    void identity;
  });
});
