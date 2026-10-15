// PREMIUM SPONSORS 0020 rehearsal on the lab (test/lab.mjs, Production's topology): apply → refused re-apply → rollback →
// re-apply, every step through db-0020.mjs's run() AS `postgres`, with the catalog, permissions and neighbours proved
// identical after apply → rollback; the rollback refuses (file and driver) while sponsor rows exist and only the force
// phrase discards them. Prints one JSON evidence line per step. Leaves the lab at POST_0020.
//   COMMERCE_PRODUCTION_LAB_CONTAINER=arma2-sponsors-lab-db node --test backend/torneos/sponsors-v1/sponsors-0020-rollback.test.mjs
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { F, D, applied, asPostgres, deps, drive, one, prepare, snapshot, toPre } from './test/lab.mjs';

const evidence = (step, out) => console.log(JSON.stringify({ step, verdict: out.verdict, before: out.before, after: out.after, forced: out.forced,
  changedOutside: out.changedOutside, failures: out.failures, psql: out.psql?.code, error: out.psql?.stderr_tail || undefined }));
const structure = (s) => { const { data, ...rest } = s; return rest; };
const fileText = (mode) => fs.readFileSync(D.FILES[mode].path, 'utf8');
const IN_USE_0017 = 'fd7eb865713c713c96e595f9a35ce230';
const inUseMd5 = () => one("select md5(prosrc) from pg_proc where oid = 'private.tournament_branding_object_in_use(text)'::regprocedure");

let pre;
before(async () => {
  await prepare();
  await toPre();
  pre = snapshot();
});

test('PRE_0020: the 0017 in_use body, nothing of 0020; apply → POST_0020; a second apply is refused before any write', async () => {
  const observed = await D.run('observe', [], deps);
  assert.deepEqual(observed.verdict, { state: 'PRE_0020', failures: [] });
  assert.equal(inUseMd5(), IN_USE_0017);
  const out = await drive('apply-0020');
  evidence('apply as postgres', out);
  assert.equal(out.verdict, 'APPLY_0020_DONE', JSON.stringify(out));
  await assert.rejects(drive('apply-0020'), /PRE_STATE_POST_0020/);
  // The file itself also refuses (its own precondition), whatever the driver says.
  assert.match(asPostgres(fileText('apply-0020')).stderr_tail, /TORNEOS_0020_PRECONDITION_FAILED: already applied/);
});

test('rollback with no rows: catalog, permissions, constraints, policies and the bucket exactly as before 0020', async () => {
  const out = await drive('rollback-0020');
  evidence('rollback as postgres (no rows)', out);
  assert.equal(out.verdict, 'ROLLBACK_0020_DONE', JSON.stringify(out));
  assert.equal(inUseMd5(), IN_USE_0017, 'the 0017 body, byte for byte');
  assert.deepEqual(snapshot(), pre);
  await assert.rejects(drive('rollback-0020'), /PRE_STATE_PRE_0020/, 'nothing to roll back');
  const again = await drive('apply-0020');
  evidence('re-apply as postgres', again);
  assert.equal(again.verdict, 'APPLY_0020_DONE', JSON.stringify(again));
});

test('rows exist: the file and the driver refuse and change nothing; the force phrase discards them; re-apply works', async () => {
  const w = F.world('rb');
  F.admin(`INSERT INTO public.tournament_season_plan_grants (organization_id, season_id, plan_code, source, reason)
    VALUES (${F.lit(w.org)}, ${F.lit(w.season)}, 'PREMIUM', 'manual_legacy', 'Laboratorio 0020 rollback')`);
  const path = `${w.org}/organizations/${w.org}/${randomUUID()}.png`;
  F.asUserJson(w.owner, `select public.upsert_tournament_organization_sponsor(${F.lit(w.org)}, null, 'Sponsor ensayo', ${F.lit(path)}, null)`);
  assert.equal(one(`select private.tournament_branding_object_in_use(${F.lit(path)})`), 't');
  await assert.rejects(drive('rollback-0020'), /ROLLBACK_REFUSED 1 sponsor rows/);
  const raw = asPostgres(fileText('rollback-0020'));
  assert.match(raw.stderr_tail, /TORNEOS_0020_ROLLBACK_REFUSED: 1 sponsor rows exist/);
  assert.equal(D.classify(await deps.catalog()).state, 'POST_0020', 'nothing changed');
  assert.equal(one('select count(*) from public.tournament_organization_sponsors'), '1');
  await assert.rejects(D.run('rollback-0020', [...D.phraseFor('rollback-0020').split(' '), 'DISCARD'], deps), /PHRASE_REQUIRED/);
  const forced = await drive('rollback-0020', { force: true });
  evidence('rollback as postgres --force (1 row discarded)', forced);
  assert.equal(forced.verdict, 'ROLLBACK_0020_DONE', JSON.stringify(forced));
  assert.equal(applied(), false);
  assert.equal(one(`select private.tournament_branding_object_in_use(${F.lit(path)})`), 'f', 'the logo is unreferenced (removable)');
  assert.deepEqual(structure(snapshot()), structure(pre));
  const back = await drive('apply-0020');
  evidence('re-apply as postgres (final state)', back);
  assert.equal(back.verdict, 'APPLY_0020_DONE', JSON.stringify(back));
  assert.equal(one('select count(*) from public.tournament_organization_sponsors'), '0', 'a re-apply never brings rows back');
  console.log(JSON.stringify({ step: 'files', apply: D.FILES['apply-0020'].sha256, rollback: D.FILES['rollback-0020'].sha256 }));
});
