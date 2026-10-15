// PREMIUM SPONSORS 0020 on a real PostgreSQL (test/lab.mjs: the commerce-production lab image, 0000 → 0019, Production's
// ownership). 0020 is applied by db-0020.mjs's run() AS `postgres` (the hosted installer), then every rule of spec §2.1 is
// exercised as real identities (PostgREST emulated: SET LOCAL ROLE authenticated + the bridge claims):
// two-organization isolation, roles, the Premium entitlement and its revocation, the selection limits, the logo path, and
// the media store's "in use" rule. The rollback / re-apply rehearsal is sponsors-0020-rollback.test.mjs (same lab).
//   COMMERCE_PRODUCTION_LAB_CONTAINER=arma2-sponsors-lab-db node --test backend/torneos/sponsors-v1/sponsors-0020.test.mjs
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { F, D, applied, drive, deps, one, prepare, toPre } from './test/lab.mjs';

const { lit, admin, asUser, asUserJson, identity, member, world, RUN } = F;

// ---------------------------------------------------------------------------------------------- fixtures
const logo = (org, ext = 'png') => `${org}/organizations/${org}/${randomUUID()}.${ext}`;
function tournament(w, season = w.season, label = 't') {
  return one(`INSERT INTO public.tournaments (organization_id, season_id, name, slug, sport_modality, competition_format,
      team_size, created_by, creation_key)
    VALUES (${lit(w.org)}, ${lit(season)}, ${lit(`Copa ${label} ${RUN}`)}, ${lit(`copa-${label}-${randomBytes(3).toString('hex')}`)},
      'football_5', 'league', 5, ${lit(w.owner.id)}, ${lit(randomUUID())}) RETURNING id`);
}
function premium(w, season = w.season) {
  return one(`INSERT INTO public.tournament_season_plan_grants (organization_id, season_id, plan_code, source, reason)
    VALUES (${lit(w.org)}, ${lit(season)}, 'PREMIUM', 'manual_legacy', 'Laboratorio 0020 sponsors') RETURNING id`);
}
/** A grant lifecycle event (refund, chargeback, restore), as the payments service records it. */
function grantEvent(grantId, type) {
  admin(`INSERT INTO public.tournament_season_plan_grant_events (season_grant_id, event_type, reason_code, reason, actor_type)
    VALUES (${lit(grantId)}, ${lit(type)}, 'lab_${type}', 'Laboratorio 0020 ${type}', 'service')`);
}
const ids = (list) => `array[${list.map(lit).join(', ')}]::uuid[]`;

const get = (actor, org, season = null) => asUserJson(actor, `select public.get_tournament_organization_sponsors(${lit(org)}, ${lit(season)}::uuid)`);
const upsertSql = (org, id, name, path, sort = null) =>
  `select public.upsert_tournament_organization_sponsor(${lit(org)}, ${lit(id)}::uuid, ${lit(name)}, ${lit(path)}, ${sort === null ? 'null' : Number(sort)}::integer)`;
const upsert = (actor, org, id, name, path, sort = null) => asUserJson(actor, upsertSql(org, id, name, path, sort));
const archiveSql = (org, id) => `select public.archive_tournament_organization_sponsor(${lit(org)}, ${lit(id)}::uuid)`;
const archive = (actor, org, id) => asUserJson(actor, archiveSql(org, id));
const authorizeSql = (season, tournamentId, theme, list) =>
  `select public.authorize_tournament_social_sponsors(${lit(season)}, ${lit(tournamentId)}, ${lit(theme)}, ${list === null ? 'null::uuid[]' : ids(list)})`;
const authorize = (actor, season, tournamentId, theme, list) => asUserJson(actor, authorizeSql(season, tournamentId, theme, list));

/** The refusal of a statement as `actor`: { code, state, detail } (null when it succeeded). */
function failure(actor, query) {
  try { asUser(actor, query); } catch (error) {
    const m = error.message;
    return { code: /TORNEOS_[A-Z_]+|permission denied[^\n]*/.exec(m)?.[0] ?? m, state: /ERROR:\s+([0-9A-Z]{5}):/.exec(m)?.[1] ?? null,
      detail: /DETAIL:\s+(.*)/.exec(m)?.[1]?.trim() ?? null };
  }
  return null;
}
const code = (actor, query) => failure(actor, query)?.code ?? null;
const inUse = (path) => one(`select private.tournament_branding_object_in_use(${lit(path)})`) === 't';
const deletable = (actor, path) => asUserJson(actor,
  `select to_jsonb(public.authorize_tournament_storage_objects('tournament-branding', 'delete', array[${lit(path)}]))`);

let A; let B;
before(async () => {
  await prepare();
  await toPre();
  const out = await drive('apply-0020');
  console.log(JSON.stringify({ step: 'apply-0020 as postgres (lab, hosted topology)', verdict: out.verdict, before: out.before,
    after: out.after, changedOutside: out.changedOutside, failures: out.failures, psql: out.psql?.code, error: out.psql?.stderr_tail || undefined }));
  assert.equal(out.verdict, 'APPLY_0020_DONE', JSON.stringify(out));
  A = world('spa'); A.t = tournament(A);
  B = world('spb'); B.t = tournament(B);
});

describe('the installed surface', () => {
  test('owned by the installer, POST_0020 by the driver catalog, authenticated only, table closed to every API role', async () => {
    assert.equal(applied(), true);
    assert.equal(D.classify(await deps.catalog()).state, 'POST_0020');
    assert.equal(one(`select string_agg(distinct pg_get_userbyid(proowner), ',') from pg_proc where proname in ('get_tournament_organization_sponsors',
      'upsert_tournament_organization_sponsor', 'archive_tournament_organization_sponsor', 'authorize_tournament_social_sponsors',
      'tournament_sponsors_entitled', 'tournament_branding_object_in_use')`), 'postgres');
    assert.equal(one("select pg_get_userbyid(relowner) || ' ' || relrowsecurity from pg_class where oid = 'public.tournament_organization_sponsors'::regclass"), 'postgres true');
    // anon and service_role never; the table never directly (not even SELECT for a manager).
    for (const role of ['anon', 'service_role']) {
      const r = F.admin(`select has_function_privilege('${role}', 'public.get_tournament_organization_sponsors(uuid,uuid)', 'EXECUTE')`).trim();
      assert.equal(r, 'f', role);
    }
    assert.match(code(A.owner, 'select count(*) from public.tournament_organization_sponsors'), /permission denied/);
    assert.match(code(A.owner, `select private.tournament_sponsors_entitled(${lit(A.org)}, null, null)`), /permission denied/);
    assert.match(code(A.owner, `select private.tournament_branding_object_in_use('x')`), /permission denied/);
  });
});

describe('entitlement (Premium capability `sponsors`)', () => {
  test('FREE: reading works (entitled false), creating and authorizing are refused; an empty selection is a no-op', () => {
    const w = world('free'); const t = tournament(w);
    const ctx = get(w.owner, w.org);
    assert.deepEqual([ctx.organizationId, ctx.canManage, ctx.entitled, ctx.sponsors], [w.org, true, false, []]);
    assert.deepEqual(ctx.limits, { maxActive: 20, maxPerExport: 3, nameMaxLength: 60 });
    assert.equal(get(w.owner, w.org, w.season).entitled, false);
    assert.equal(code(w.owner, upsertSql(w.org, null, 'Bar El Gol', logo(w.org))), 'TORNEOS_SPONSORS_PREMIUM_REQUIRED');
    assert.equal(code(w.owner, authorizeSql(w.season, t, 'heritage', [randomUUID()])), 'TORNEOS_SPONSORS_PREMIUM_REQUIRED');
    // FREE exports never send sponsors: nothing to authorize, and the 0008 export authorization is the same as before.
    assert.deepEqual(authorize(w.owner, w.season, t, 'base', []).sponsors, []);
    const exported = asUserJson(w.owner, `select public.authorize_tournament_social_export(${lit(w.org)}, ${lit(t)}, 'round_results', 'base', true)`);
    assert.deepEqual([exported.authorized, exported.plan, exported.includeArma2Branding], [true, 'FREE', true]);
  });

  test('PREMIUM on one season: the organization may manage; only that season\'s tournaments may export sponsors', () => {
    const w = world('prem'); premium(w); const t = tournament(w);
    const other = F.season(w.owner, w.org, 'free2'); const tFree = tournament(w, other, 'f');
    assert.equal(get(w.owner, w.org).entitled, true);
    assert.equal(get(w.owner, w.org, w.season).entitled, true);
    assert.equal(get(w.owner, w.org, other).entitled, false, 'with a season, `entitled` is that season\'s');
    const s = upsert(w.owner, w.org, null, '  Bar El Gol  ', logo(w.org));
    assert.equal(s.sponsor.name, 'Bar El Gol', 'trimmed');
    assert.equal(authorize(w.owner, w.season, t, 'street', [s.sponsor.id]).sponsors.length, 1);
    assert.equal(code(w.owner, authorizeSql(other, tFree, 'street', [s.sponsor.id])), 'TORNEOS_SPONSORS_PREMIUM_REQUIRED');
  });

  test('grant suspended / revoked: rows kept and listed, archive allowed, upsert and authorize refused; restored: back', () => {
    const w = world('rev'); const grant = premium(w); const t = tournament(w);
    const kept = upsert(w.owner, w.org, null, 'Kiosco Norte', logo(w.org)).sponsor;
    const toArchive = upsert(w.owner, w.org, null, 'Ferretería Sur', logo(w.org)).sponsor;
    for (const [down, up] of [['suspended', 'restored'], ['revoked', null]]) {
      grantEvent(grant, down);
      const ctx = get(w.owner, w.org, w.season);
      assert.equal(ctx.entitled, false, down);
      assert.ok(ctx.sponsors.some((x) => x.id === kept.id), `${down}: the sponsors stay`);
      assert.equal(code(w.owner, upsertSql(w.org, null, 'Nuevo', null)), 'TORNEOS_SPONSORS_PREMIUM_REQUIRED', down);
      assert.equal(code(w.owner, upsertSql(w.org, kept.id, 'Kiosco Norte 2', kept.logoPath)), 'TORNEOS_SPONSORS_PREMIUM_REQUIRED', down);
      assert.equal(code(w.owner, authorizeSql(w.season, t, 'heritage', [kept.id])), 'TORNEOS_SPONSORS_PREMIUM_REQUIRED', down);
      if (up) { grantEvent(grant, up); assert.equal(get(w.owner, w.org).entitled, true, 'Premium back'); assert.equal(authorize(w.owner, w.season, t, 'heritage', [kept.id]).sponsors[0].id, kept.id); }
    }
    // Revoked for good: archiving still works (the client then removes the logo).
    const out = archive(w.owner, w.org, toArchive.id);
    assert.deepEqual([out.archived, out.alreadyArchived, out.previousLogoPath], [true, false, toArchive.logoPath]);
  });
});

describe('roles', () => {
  test('owner and admin manage; a collaborator reads only; a non-member gets nothing', () => {
    const w = world('roles'); premium(w); const t = tournament(w);
    const adm = member(w.org, 'admin', [w.season]);
    const col = member(w.org, 'collaborator', [w.season]);
    const stranger = identity('stranger');
    const byAdmin = upsert(adm, w.org, null, 'Panadería Admin', logo(w.org)).sponsor;
    assert.equal(get(adm, w.org).canManage, true);
    const colCtx = get(col, w.org, w.season);
    assert.deepEqual([colCtx.canManage, colCtx.entitled, colCtx.sponsors.map((x) => x.id)], [false, true, [byAdmin.id]]);
    assert.equal(code(col, upsertSql(w.org, null, 'Colaborador', null)), 'TORNEOS_SPONSORS_FORBIDDEN');
    assert.equal(code(col, upsertSql(w.org, byAdmin.id, 'Colaborador', null)), 'TORNEOS_SPONSORS_FORBIDDEN');
    assert.equal(code(col, archiveSql(w.org, byAdmin.id)), 'TORNEOS_SPONSORS_FORBIDDEN');
    // Social export: a collaborator needs the organization's export grant (0008 rule), and the season.
    assert.equal(code(col, authorizeSql(w.season, t, 'heritage', [byAdmin.id])), 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN');
    admin(`INSERT INTO public.tournament_social_permissions (organization_id, user_id, can_export, granted_by)
      VALUES (${lit(w.org)}, ${lit(col.id)}, true, ${lit(w.owner.id)})`);
    // Deliberate rule (B1 of the E2E demo): with social.export a collaborator keeps exporting, but WITHOUT sponsors —
    // putting sponsors on a piece needs organization.update (owner, admin), and that is checked before any input.
    assert.deepEqual(authorize(col, w.season, t, 'heritage', []).sponsors, [], 'empty selection: the export goes on');
    assert.deepEqual(authorize(col, w.season, t, 'base', []).sponsors, []);
    assert.deepEqual(failure(col, authorizeSql(w.season, t, 'heritage', [byAdmin.id])),
      { code: 'TORNEOS_SPONSORS_FORBIDDEN', state: '42501', detail: null });
    assert.equal(code(col, authorizeSql(w.season, t, 'base', [byAdmin.id])), 'TORNEOS_SPONSORS_FORBIDDEN', 'access before the theme');
    assert.equal(code(col, authorizeSql(w.season, t, 'heritage', [randomUUID()])), 'TORNEOS_SPONSORS_FORBIDDEN', 'access before the ids');
    assert.equal(code(col, authorizeSql(w.season, t, 'heritage', null)), 'TORNEOS_SPONSORS_SELECTION_INVALID');
    // Owner and admin (organization.update, social.export by role) may.
    for (const manager of [w.owner, adm]) {
      assert.deepEqual(authorize(manager, w.season, t, 'heritage', [byAdmin.id]).sponsors.map((x) => x.id), [byAdmin.id]);
    }
    const unassigned = member(w.org, 'admin', []);
    assert.equal(code(unassigned, authorizeSql(w.season, t, 'heritage', [byAdmin.id])), 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN', 'season access');
    assert.equal(code(unassigned, `select public.get_tournament_organization_sponsors(${lit(w.org)}, ${lit(w.season)})`), 'TORNEOS_SPONSORS_FORBIDDEN');
    for (const q of [`select public.get_tournament_organization_sponsors(${lit(w.org)}, null)`, upsertSql(w.org, null, 'Intruso', null),
      archiveSql(w.org, byAdmin.id), authorizeSql(w.season, t, 'heritage', [byAdmin.id])]) {
      assert.match(code(stranger, q), /TORNEOS_SPONSORS_FORBIDDEN|TORNEOS_SOCIAL_EXPORT_FORBIDDEN/, q);
    }
    // A suspended membership holds nothing.
    admin(`UPDATE public.tournament_organization_members SET status = 'suspended' WHERE id = ${lit(adm.membership)}`);
    assert.equal(code(adm, upsertSql(w.org, null, 'Suspendido', null)), 'TORNEOS_SPONSORS_FORBIDDEN');
    assert.equal(code(adm, `select public.get_tournament_organization_sponsors(${lit(w.org)}, null)`), 'TORNEOS_SPONSORS_FORBIDDEN');
  });
});

describe('two-organization isolation', () => {
  test('organization B never lists, edits, archives or authorizes A\'s sponsors, and cannot tell them from missing ones', () => {
    premium(A); premium(B);
    const a = upsert(A.owner, A.org, null, 'Sponsor A', logo(A.org)).sponsor;
    upsert(B.owner, B.org, null, 'Sponsor B', logo(B.org));
    assert.ok(!get(B.owner, B.org).sponsors.some((x) => x.id === a.id));
    assert.equal(code(B.owner, `select public.get_tournament_organization_sponsors(${lit(A.org)}, null)`), 'TORNEOS_SPONSORS_FORBIDDEN');
    assert.equal(code(B.owner, `select public.get_tournament_organization_sponsors(${lit(B.org)}, ${lit(A.season)})`), 'TORNEOS_SPONSORS_FORBIDDEN');
    assert.equal(code(B.owner, upsertSql(A.org, a.id, 'Robado', null)), 'TORNEOS_SPONSORS_FORBIDDEN');
    assert.equal(code(B.owner, archiveSql(A.org, a.id)), 'TORNEOS_SPONSORS_FORBIDDEN');
    assert.equal(code(B.owner, authorizeSql(A.season, A.t, 'heritage', [a.id])), 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN');
    assert.equal(code(B.owner, authorizeSql(B.season, A.t, 'heritage', [a.id])), 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN', 'mismatched season/tournament pair');
    // Through B's own organization, A's sponsor id behaves exactly like an id that does not exist.
    const missing = randomUUID();
    for (const [q, qMissing] of [
      [upsertSql(B.org, a.id, 'Robado', null), upsertSql(B.org, missing, 'Robado', null)],
      [archiveSql(B.org, a.id), archiveSql(B.org, missing)],
      [authorizeSql(B.season, B.t, 'heritage', [a.id]), authorizeSql(B.season, B.t, 'heritage', [missing])],
    ]) {
      const leaked = failure(B.owner, q); const plain = failure(B.owner, qMissing);
      assert.deepEqual(leaked, plain, q);
      assert.match(leaked.code, /TORNEOS_SPONSOR_NOT_FOUND|TORNEOS_SPONSORS_SELECTION_UNAVAILABLE/);
    }
    // A's logo path is never accepted by B (another organization's folder).
    assert.deepEqual(failure(B.owner, upsertSql(B.org, null, 'Copia', a.logoPath)), { code: 'TORNEOS_SPONSOR_INVALID', state: '22023', detail: 'logo_path' });
    assert.equal(get(A.owner, A.org).sponsors.find((x) => x.id === a.id).name, 'Sponsor A', 'untouched');
  });
});

describe('writes', () => {
  test('validation: name 1..60 trimmed, no control characters; logo of the organization\'s own folder; sort order 0..999', () => {
    const w = world('val'); premium(w);
    const bad = (name, path, sort, detail) => assert.deepEqual(failure(w.owner, upsertSql(w.org, null, name, path, sort)),
      { code: 'TORNEOS_SPONSOR_INVALID', state: '22023', detail }, `${name} ${path} ${sort}`);
    bad(null, null, null, 'name'); bad('', null, null, 'name'); bad('    ', null, null, 'name'); bad('x'.repeat(61), null, null, 'name');
    bad('Bar\nGol', null, null, 'name');
    const other = randomUUID();
    bad('Ok', `${other}/organizations/${other}/${randomUUID()}.png`, null, 'logo_path');
    bad('Ok', `${w.org}/organizations/${other}/${randomUUID()}.png`, null, 'logo_path');
    bad('Ok', `${w.org}/tournaments/${w.org}/${randomUUID()}.png`, null, 'logo_path');
    bad('Ok', `${w.org}/organizations/${w.org}/${randomUUID()}.gif`, null, 'logo_path');
    bad('Ok', `${w.org}/organizations/${w.org}/../${randomUUID()}.png`, null, 'logo_path');
    bad('Ok', `https://example.invalid/${randomUUID()}.png`, null, 'logo_path');
    bad('Ok', null, 1000, 'sort_order'); bad('Ok', null, -1, 'sort_order');
    assert.equal(upsert(w.owner, w.org, null, 'y'.repeat(60), null).sponsor.name.length, 60);
    for (const ext of ['jpg', 'png', 'webp']) assert.match(upsert(w.owner, w.org, null, `Logo ${ext}`, logo(w.org, ext)).sponsor.logoPath, new RegExp(`\\.${ext}$`));
    assert.equal(code(w.owner, archiveSql(w.org, null)), 'TORNEOS_SPONSOR_INVALID');
  });

  test('create, edit (previousLogoPath only when the logo changed), order, at most 20 active, archive frees a place', () => {
    const w = world('crud'); premium(w);
    const first = upsert(w.owner, w.org, null, 'Primero', logo(w.org));
    assert.deepEqual([first.sponsor.sortOrder, first.previousLogoPath], [0, null]);
    const second = upsert(w.owner, w.org, null, 'Segundo', null);
    assert.equal(second.sponsor.sortOrder, 1, 'appended');
    const replacement = logo(w.org, 'webp');
    const edited = upsert(w.owner, w.org, first.sponsor.id, 'Primero SA', replacement, 5);
    assert.deepEqual([edited.sponsor.id, edited.sponsor.name, edited.sponsor.logoPath, edited.sponsor.sortOrder, edited.previousLogoPath],
      [first.sponsor.id, 'Primero SA', replacement, 5, first.sponsor.logoPath]);
    assert.equal(upsert(w.owner, w.org, first.sponsor.id, 'Primero SA', replacement).previousLogoPath, null, 'same logo: nothing to remove');
    assert.equal(upsert(w.owner, w.org, first.sponsor.id, 'Primero SA', replacement).sponsor.sortOrder, 5, 'sort order kept when omitted');
    const removedLogo = upsert(w.owner, w.org, first.sponsor.id, 'Primero SA', null);
    assert.deepEqual([removedLogo.sponsor.logoPath, removedLogo.previousLogoPath], [null, replacement]);
    assert.deepEqual(get(w.owner, w.org).sponsors.map((x) => x.name), ['Segundo', 'Primero SA']);
    for (let i = 2; i < 20; i += 1) upsert(w.owner, w.org, null, `Sponsor ${i}`, null);
    assert.equal(get(w.owner, w.org).sponsors.length, 20);
    assert.deepEqual(failure(w.owner, upsertSql(w.org, null, 'Veintiuno', null)), { code: 'TORNEOS_SPONSOR_LIMIT_REACHED', state: 'PT422', detail: null });
    // Editing at the limit is fine; archiving frees a place.
    assert.equal(upsert(w.owner, w.org, second.sponsor.id, 'Segundo bis', null).sponsor.name, 'Segundo bis');
    const archived = archive(w.owner, w.org, second.sponsor.id);
    assert.deepEqual([archived.sponsorId, archived.archived, archived.alreadyArchived, archived.previousLogoPath], [second.sponsor.id, true, false, null]);
    assert.equal(upsert(w.owner, w.org, null, 'Veintiuno', null).sponsor.name, 'Veintiuno');
    // Archived: idempotent, gone from the list, not editable; an unknown id is not found.
    assert.deepEqual(archive(w.owner, w.org, second.sponsor.id), { sponsorId: second.sponsor.id, archived: true, alreadyArchived: true, previousLogoPath: null });
    assert.ok(!get(w.owner, w.org).sponsors.some((x) => x.id === second.sponsor.id));
    assert.deepEqual(failure(w.owner, upsertSql(w.org, second.sponsor.id, 'Revivir', null)), { code: 'TORNEOS_SPONSOR_NOT_FOUND', state: 'PT409', detail: null });
    assert.equal(code(w.owner, archiveSql(w.org, randomUUID())), 'TORNEOS_SPONSOR_NOT_FOUND');
  });
});

describe('authorize_tournament_social_sponsors', () => {
  test('Premium theme, at most 3 distinct active sponsors with a logo, in the selection order; everything else refused', () => {
    const w = world('auth'); premium(w); const t = tournament(w);
    const s = ['Uno', 'Dos', 'Tres', 'Cuatro'].map((name) => upsert(w.owner, w.org, null, name, logo(w.org)).sponsor);
    const noLogo = upsert(w.owner, w.org, null, 'Sin logo', null).sponsor;
    const gone = upsert(w.owner, w.org, null, 'Archivado', logo(w.org)).sponsor; archive(w.owner, w.org, gone.id);
    for (const theme of ['heritage', 'street', 'scoreboard', 'editorial']) {
      const out = authorize(w.owner, w.season, t, theme, [s[2].id, s[0].id, s[1].id]);
      assert.deepEqual([out.authorized, out.organizationId, out.seasonId, out.tournamentId, out.theme, out.capability],
        [true, w.org, w.season, t, theme, 'sponsors']);
      assert.deepEqual(out.sponsors, [s[2], s[0], s[1]].map((x) => ({ id: x.id, name: x.name, logoPath: x.logoPath })), theme);
    }
    const refused = (theme, list, expected, state) => assert.deepEqual(
      (({ code: c, state: st }) => ({ code: c, state: st }))(failure(w.owner, authorizeSql(w.season, t, theme, list))), { code: expected, state }, `${theme} ${list}`);
    refused('base', [s[0].id], 'TORNEOS_SPONSORS_THEME_UNSUPPORTED', '22023');
    refused(null, [s[0].id], 'TORNEOS_SOCIAL_THEME_UNKNOWN', '22023');
    refused('neon', [s[0].id], 'TORNEOS_SOCIAL_THEME_UNKNOWN', '22023');
    refused('heritage', s.map((x) => x.id), 'TORNEOS_SPONSORS_SELECTION_INVALID', '22023');
    refused('heritage', [s[0].id, s[0].id], 'TORNEOS_SPONSORS_SELECTION_INVALID', '22023');
    refused('heritage', null, 'TORNEOS_SPONSORS_SELECTION_INVALID', '22023');
    assert.equal(code(w.owner, `select public.authorize_tournament_social_sponsors(${lit(w.season)}, ${lit(t)}, 'heritage', array[null]::uuid[])`),
      'TORNEOS_SPONSORS_SELECTION_INVALID');
    refused('heritage', [s[0].id, gone.id], 'TORNEOS_SPONSORS_SELECTION_UNAVAILABLE', 'PT409');
    refused('heritage', [noLogo.id], 'TORNEOS_SPONSORS_SELECTION_UNAVAILABLE', 'PT409');
    refused('heritage', [randomUUID()], 'TORNEOS_SPONSORS_SELECTION_UNAVAILABLE', 'PT409');
    assert.deepEqual(authorize(w.owner, w.season, t, 'base', []).sponsors, [], 'nothing selected: nothing to authorize');
  });
});

describe('the media store\'s "in use" rule', () => {
  test('an active sponsor\'s logo cannot be deleted; a replaced or archived one can; other references unchanged', () => {
    const w = world('inuse'); premium(w);
    const path = logo(w.org);
    const s = upsert(w.owner, w.org, null, 'Logo en uso', path).sponsor;
    assert.equal(inUse(path), true);
    assert.deepEqual(deletable(w.owner, path), [], 'the store refuses to delete it');
    const next = logo(w.org);
    const replaced = upsert(w.owner, w.org, s.id, 'Logo en uso', next);
    assert.equal(replaced.previousLogoPath, path);
    assert.deepEqual([inUse(path), inUse(next)], [false, true]);
    assert.deepEqual(deletable(w.owner, path), [path], 'the replaced object is removable');
    const out = archive(w.owner, w.org, s.id);
    assert.equal(out.previousLogoPath, next);
    assert.equal(inUse(next), false);
    assert.deepEqual(deletable(w.owner, next), [next]);
    // The organization logo (same folder) is still in use through 0017's rule.
    const orgLogo = logo(w.org);
    asUserJson(w.owner, `select public.set_tournament_branding_reference(${lit(w.org)}, 'organization', ${lit(w.org)}, ${lit(orgLogo)})`);
    assert.equal(inUse(orgLogo), true);
    assert.deepEqual(deletable(w.owner, orgLogo), []);
  });
});
