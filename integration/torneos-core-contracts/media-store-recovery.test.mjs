// MEDIA-STORE-V1 — the documented recoveries, executed on the hosted-like lab with traffic in between (Node gateway):
//   R1. baseline: a logo and a photo are stored.
//   R2. rollback-0017 (the real driver, as postgres) while the store runs: every write and authenticated signature fails
//       CLOSED (403), nothing is written, public pages keep working; apply-0017 again restores service.
//   R3. Galería off at the database (db-0012 mode PROCESSOR_EXTERNAL): uploads refused before any byte; MVP_SIMPLE again.
//   R4. the function unreachable: 503, nothing half-written; back → the same key succeeds.
// The lab ends exactly as it started (POST_0017, MVP_SIMPLE). Runs after media-store.test.mjs's prerequisites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { decodeJwt } from 'jose';
import { sql, sqlTry, dc, BASE, MEDIA } from './lab.mjs';
import { phraseFor, run as run0017 } from '../../backend/torneos/media-store-v1/remote/db-0017.mjs';
import { REF, run as run0012 } from '../../backend/torneos/media-v1/remote/db-0012.mjs';

const RUN = 'rc' + randomBytes(3).toString('hex');
const torneosSql = (q) => sql('torneos-db', q).trim();
const CLEAN = fs.readFileSync(new URL('../../scripts/edge-functions/fixtures/tournament-media/clean-64x48.jpg', import.meta.url));
const PNG = fs.readFileSync(new URL('../../scripts/edge-functions/fixtures/tournament-media/clean-64x48.png', import.meta.url));
// One byte of the entropy-coded scan differs per seed (never 0xFF, never next to one): still a clean 64×48 JPEG.
const SAFE = (() => {
  let i = 2;
  while (!(CLEAN[i] === 0xff && CLEAN[i + 1] === 0xda)) i += 2 + CLEAN.readUInt16BE(i + 2);
  for (let p = i + 3 + CLEAN.readUInt16BE(i + 2); ; p += 1) if (CLEAN[p - 1] !== 0xff && CLEAN[p] !== 0xff && CLEAN[p + 1] !== 0xff) return p;
})();
const jpeg = (seed) => { const b = Buffer.from(CLEAN); b[SAFE] = (seed * 37) % 254; return b; };
const readOnly = (q) => `BEGIN TRANSACTION READ ONLY;\nselect (\n${q}\n)::text;\nROLLBACK;\n`;
const catalogDeps = (file) => {
  const q = fs.readFileSync(new URL(file, import.meta.url), 'utf8').trim();
  return {
    catalog: async () => JSON.parse(sqlTry('torneos-db', readOnly(q), 'postgres').out.trim().split('\n').filter(Boolean).pop()),
    applySql: async (text) => { const r = sqlTry('torneos-db', text, 'postgres'); return { code: r.ok ? 0 : 1, stderr_tail: r.error ?? '' }; },
  };
};
const D17 = catalogDeps('../../backend/torneos/media-store-v1/remote/sql-catalog-0017.sql');
const D12 = catalogDeps('../../backend/torneos/media-v1/remote/sql-catalog.sql');

async function request(path, token, method = 'GET', data, extra = {}) {
  const raw = Buffer.isBuffer(data);
  const r = await fetch(`${BASE}${path}`, { method, headers: { connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(data !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...extra },
  body: data === undefined ? undefined : (raw ? data : JSON.stringify(data)), signal: AbortSignal.timeout(60000) });
  const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

test('MEDIA-STORE-V1 recoveries with traffic in between (node gateway)', async (t) => {
  assert.ok(MEDIA);
  const u = {};
  const tok = async () => {
    if (!u.token || Date.now() - u.at > 80_000) { u.token = (await request('/exchange', u.core, 'POST')).body.access_token; u.at = Date.now(); }
    return u.token;
  };
  const ok = async (name, params) => { const r = await request(`/torneos/rest/v1/rpc/${name}`, await tok(), 'POST', params); assert.equal(r.status, 200, `${name} ${JSON.stringify(r.body)}`); return r.body; };
  const photo = async (seed, key = randomUUID()) => request(`/torneos/media/v1/upload?gallery=${u.gallery}&key=${key}`, await tok(), 'POST', jpeg(seed), { 'content-type': 'image/jpeg' });
  const logo = async () => request(`/torneos/branding/v1/object/${u.org}/tournaments/${u.tournament}`, await tok(), 'POST', PNG, { 'content-type': 'image/png' });
  const objects = () => Number(torneosSql(`select count(*) from storage.objects where name like '${u.org}/%'`));

  await t.test('R1. baseline: logo and photo stored', async () => {
    const s = await request('/auth/v1/signup', null, 'POST', { email: `${RUN}@example.test`, password: `${randomUUID()}Aa!`, data: { full_name: RUN } });
    u.core = s.body.access_token;
    u.org = (await ok('create_tournament_organization', { p_name: `Liga ${RUN}`, p_slug: `liga-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
    const season = (await ok('create_tournament_season', { p_organization_id: u.org, p_name: 'Apertura', p_slug: `apertura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    u.tournament = (await ok('create_tournament_with_defaults', { p_organization_id: u.org, p_season_id: season, p_name: `Copa ${RUN}`, p_slug: `copa-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
    u.gallery = await ok('create_tournament_media_gallery', { p_organization_id: u.org, p_tournament_id: u.tournament, p_category_id: null, p_round_id: null, p_match_id: null, p_title: 'Recuperación', p_description: '', p_visibility: 'tournament_participants', p_idempotency_key: randomUUID() });
    assert.equal((await logo()).status, 200);
    assert.equal((await photo(1)).status, 201);
    assert.equal(objects(), 2);
    assert.ok(decodeJwt(await tok()).sub);
  });

  await t.test('R2. rollback-0017 under traffic: fail closed, nothing written; apply-0017 restores', async () => {
    const back = await run0017('rollback-0017', phraseFor('rollback-0017').split(' '), D17);
    assert.deepEqual([back.verdict, back.changedOutside], ['ROLLBACK_0017_DONE', []]);
    try {
      const before = objects();
      const l = await logo();
      const p = await photo(2);
      assert.deepEqual([l.status, l.body?.error], [403, 'TORNEOS_BRANDING_FORBIDDEN'], JSON.stringify(l));
      assert.equal(p.status, 403, JSON.stringify(p));
      assert.equal(objects(), before, 'nothing written without the database decision');
      const ctx = await request('/torneos/rest/v1/rpc/get_tournament_branding_context', await tok(), 'POST', { p_organization_id: u.org, p_tournament_id: null });
      assert.equal(ctx.status, 200, 'the RPCs keep answering (URLs just come back unsigned)');
    } finally {
      const again = await run0017('apply-0017', phraseFor('apply-0017').split(' '), D17);
      assert.deepEqual([again.verdict, again.changedOutside], ['APPLY_0017_DONE', []]);
    }
    assert.equal((await photo(3)).status, 201);
  });

  await t.test('R3. Galería off at the database: refused before any byte; MVP_SIMPLE again restores', async () => {
    const off = await run0012('mode', ['PROCESSOR_EXTERNAL', ...`SET TORNEOS MEDIA PIPELINE MODE PROCESSOR_EXTERNAL ${REF}`.split(' ')], D12);
    assert.deepEqual([off.verdict, off.changedOutside], ['MODE_PROCESSOR_EXTERNAL_DONE', []]);
    try {
      const before = objects();
      const r = await photo(4);
      assert.ok(r.status >= 400 && r.status !== 500, JSON.stringify(r));
      assert.equal(objects(), before);
    } finally {
      const on = await run0012('mode', ['MVP_SIMPLE', ...`SET TORNEOS MEDIA PIPELINE MODE MVP_SIMPLE ${REF}`.split(' ')], D12);
      assert.equal(on.verdict, 'MODE_MVP_SIMPLE_DONE');
    }
    assert.equal((await photo(5)).status, 201);
  });

  await t.test('R4. the function unreachable: 503, nothing half-written; back, the same key succeeds', async () => {
    const key = randomUUID();
    const before = objects();
    dc(['stop', 'torneos-functions'], undefined, true);
    let down;
    try { down = await photo(6, key); } finally { dc(['start', 'torneos-functions'], undefined, true); }
    assert.equal(down.status, 503, JSON.stringify(down));
    assert.equal(objects(), before);
    let back = null;
    for (let i = 0; i < 40 && back?.status !== 201; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 1500); });
      back = await photo(6, key);
    }
    assert.equal(back.status, 201, JSON.stringify(back));
    assert.equal(torneosSql("select mode from public.tournament_media_pipeline_configuration where singleton"), 'MVP_SIMPLE');
    assert.equal((await run0017('observe', [], D17)).verdict.state, 'POST_0017');
  });
});
