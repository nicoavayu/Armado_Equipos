// SOCIAL-V1 static contract of 0008, its rollback and the operator driver. Reads local files only; never touches a
// database (the Docker lab, lab/run-lab.sh, is the behavioural proof: evidence/sql-cases-0008.txt).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, run, FILES, KEPT_MD5, AUTHORIZE, REF } from './remote/db8.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const CONTRACT = JSON.parse(read('backend/torneos/social-v1/contract.json'));
const M8 = CONTRACT.migration;
const R8 = CONTRACT.rollback;
const BASELINE = 'backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql';
function bodies(sql, fn = 'authorize_tournament_social_export') {
  const out = [];
  const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(`, 'g');
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const start = sql.indexOf('AS $$', m.index) + 'AS $$'.length;
    out.push(sql.slice(start, sql.indexOf('$$;', start)));
  }
  return out;
}

test('0008 and its rollback are the pinned bytes; the bodies are the pinned md5s', () => {
  assert.equal(sha256(read(M8)), CONTRACT.pins.migration_sha256);
  assert.equal(sha256(read(R8)), CONTRACT.pins.rollback_sha256);
  assert.equal(FILES.apply.sha256, CONTRACT.pins.migration_sha256);
  assert.equal(FILES.rollback.sha256, CONTRACT.pins.rollback_sha256);
  assert.deepEqual(bodies(read(M8)).map(md5), [CONTRACT.pins.authorize_post_md5]);
  assert.deepEqual(bodies(read(R8)).map(md5), [CONTRACT.pins.authorize_pre_md5]);
  assert.deepEqual(bodies(read(BASELINE)).map(md5), [CONTRACT.pins.authorize_pre_md5], 'baseline = POST_0007 body');
  for (const f of fs.readdirSync(path.join(REPO, 'backend/torneos/supabase/migrations')).filter((n) => /^0000000000000[1-7]_/.test(n))) {
    assert.deepEqual(bodies(read(`backend/torneos/supabase/migrations/${f}`)), [], `${f} never redefines authorize`);
  }
});

test('the new body is the baseline plus exactly the three NULL guards (no coercion, no default)', () => {
  const before = bodies(read(BASELINE))[0];
  const after = bodies(read(M8))[0];
  const expected = before
    .replace("  if p_theme not in ('base','heritage','street','scoreboard','editorial') then",
      "  -- SOCIAL-V1: NULL is never a valid theme, piece or branding choice (no coercion, no implicit default).\n  if p_theme is null or p_theme not in ('base','heritage','street','scoreboard','editorial') then")
    .replace('  if p_piece not in (', '  if p_piece is null or p_piece not in (')
    .replace("    raise exception using errcode='22023',message='TORNEOS_SOCIAL_PIECE_UNKNOWN';\n  end if;\n",
      "    raise exception using errcode='22023',message='TORNEOS_SOCIAL_PIECE_UNKNOWN';\n  end if;\n  if p_include_arma2_branding is null then\n    raise exception using errcode='22023',message='TORNEOS_SOCIAL_BRANDING_INVALID';\n  end if;\n");
  assert.notEqual(expected, before);
  assert.equal(after, expected);
  assert.doesNotMatch(after, /coalesce\(p_include_arma2_branding/);
  // The access check still runs before any input validation (an identity without access learns nothing).
  assert.ok(after.indexOf('TORNEOS_SOCIAL_EXPORT_FORBIDDEN') < after.indexOf('TORNEOS_SOCIAL_THEME_UNKNOWN'));
});

test('0008 touches one function and grants one EXECUTE to authenticated; nothing else', () => {
  const sql = read(M8).replace(/^--.*$/gm, '');
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.authorize_tournament_social_export\(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_theme text, p_include_arma2_branding boolean\) RETURNS jsonb\n\s+LANGUAGE plpgsql STABLE SECURITY DEFINER\n\s+SET search_path TO ''/);
  assert.deepEqual(sql.match(/^GRANT [^;]+;$/gm), ['GRANT EXECUTE ON FUNCTION public.authorize_tournament_social_export(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_theme text, p_include_arma2_branding boolean) TO authenticated;']);
  for (const forbidden of [/\bREVOKE\b/, /\bALTER\b/, /\bTO anon\b/, /\bTO PUBLIC\b/i, /(?<!ON COMMIT )\bDROP\b/, /\bINSERT INTO public\./, /\bUPDATE public\./, /\bDELETE FROM\b/, /CREATE (?:UNLOGGED )?TABLE/, /set_tournament_social_permission\(p_/]) {
    assert.doesNotMatch(sql, forbidden, String(forbidden));
  }
  assert.match(sql, /^BEGIN;$/m); assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /TORNEOS_SOCIAL_V1_PRECONDITION_FAILED/); assert.match(sql, /TORNEOS_SOCIAL_V1_POSTCONDITION_FAILED/);
  assert.match(sql, new RegExp(`v_md5 NOT IN \\('${CONTRACT.pins.authorize_pre_md5}', '${CONTRACT.pins.authorize_post_md5}'\\)`));
  assert.match(sql, /\(172, 12\)/); assert.match(sql, /THEN 172 ELSE 171 END, 12/);
  for (const [sig, hash] of Object.entries(KEPT_MD5)) assert.ok(sql.includes(`'public.${sig}', '${hash}'`), `precondition pins ${sig}`);
});

test('the rollback revokes exactly that EXECUTE and restores the POST_0007 body; nothing else', () => {
  const sql = read(R8).replace(/^--.*$/gm, '');
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.deepEqual(sql.match(/^REVOKE [^;]+;$/gm), ['REVOKE EXECUTE ON FUNCTION public.authorize_tournament_social_export(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_theme text, p_include_arma2_branding boolean) FROM authenticated;']);
  assert.doesNotMatch(sql, /\bGRANT\b/);
  assert.match(sql, /\(171, 12\)/);
  assert.match(sql, /TORNEOS_SOCIAL_V1_ROLLBACK_PRECONDITION_FAILED/);
});

test('contract: three RPCs, the permission RPC excluded, one grant', () => {
  assert.equal(CONTRACT.phase, 'SOCIAL-V1');
  assert.deepEqual(CONTRACT.rpcs, ['get_tournament_social_studio_context', 'get_tournament_social_snapshot', 'authorize_tournament_social_export']);
  assert.deepEqual(CONTRACT.grant, ['public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)']);
  assert.ok(CONTRACT.excluded.set_tournament_social_permission);
  assert.deepEqual([CONTRACT.pins.acl_pre, CONTRACT.pins.acl_post], [[171, 12], [172, 12]]);
});

test('lab evidence: the matrix ran green against these exact files', () => {
  const evidence = read('backend/torneos/social-v1/evidence/sql-cases-0008.txt');
  assert.match(evidence, /TOTAL PASS=\d+ FAIL=0/);
  assert.doesNotMatch(evidence, /^FAIL/m);
  for (const name of ['N1 FREE theme NULL', 'N2 FREE piece NULL', 'N4 FREE branding NULL', 'N8 unknown theme', 'N11 unknown piece', 'G6 cross org', 'G8 cross season',
    'G9 nonexistent tournament', 'G1 bearer absent', 'G2 unknown identity', 'G3 identity without membership', 'F6 FREE round_results/heritage', 'F5 FREE mvp/base',
    'F7 FREE Base removing the Arma2 signature', 'P1 PREMIUM standings/base signed', 'P2 PREMIUM Base branding OFF', 'P3 PREMIUM editorial asked WITH Arma2',
    'RED-F1', '0008 refuses anon EXECUTE', 'catalog after rollback = POST_0007', 'rollback re-run = no-op', 'catalog after re-apply']) {
    assert.match(evidence, new RegExp(`^PASS ${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'm'), name);
  }
  const diff = read('backend/torneos/social-v1/evidence/catalog-diff-0007-0008.txt');
  assert.equal(diff.split('\n').filter((l) => /^[<>]/.test(l)).length, 2, 'only the authorize row changes');
});

// ── db8 operator driver, offline ───────────────────────────────────────────────────────────────────────────────
function catalogAt(state, mutate = (c) => c) {
  const social = Object.fromEntries(Object.entries(KEPT_MD5).map(([sig, hash]) => [sig, { md5: hash, secdef: true, volatile: 's', config: ['search_path=""'], exec: { anon: false, authenticated: false, service_role: true, public: false } }]));
  social[AUTHORIZE] = { md5: state === 'POST_0008' ? CONTRACT.pins.authorize_post_md5 : CONTRACT.pins.authorize_pre_md5, secdef: true, volatile: 's', config: ['search_path=""'],
    exec: { anon: false, authenticated: state === 'POST_0008', service_role: true, public: false } };
  const counts = state === 'POST_0008' ? { authenticated: 172, anon: 12 } : { authenticated: 171, anon: 12 };
  return mutate({ torneos_tables: true, counts, social, other_fn: { count: 300, digest: 'a' }, relations: { count: 90, digest: 'b' }, policies: { count: 40, digest: 'c' } });
}
const phrase = (mode) => `${mode.toUpperCase()} TORNEOS 0008 ${REF} ${FILES[mode].sha256.slice(0, 12)}`.split(' ');

test('db8 classify: POST_0007, POST_0008, and every drift fails closed', () => {
  assert.equal(classify(catalogAt('POST_0007')).state, 'POST_0007');
  assert.equal(classify(catalogAt('POST_0008')).state, 'POST_0008');
  for (const mutate of [
    (c) => { c.social[AUTHORIZE].md5 = 'f'.repeat(32); return c; },
    (c) => { c.social[AUTHORIZE].exec.anon = true; return c; },
    (c) => { c.social[AUTHORIZE].exec.public = true; return c; },
    (c) => { c.social[AUTHORIZE].exec.authenticated = true; return c; },
    (c) => { c.counts.authenticated = 172; return c; },
    (c) => { c.counts.anon = 13; return c; },
    (c) => { c.social['get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)'].md5 = '0'.repeat(32); return c; },
    (c) => { delete c.social['tournament_social_role_capabilities(text)']; return c; },
    (c) => { c.social['new_social_thing()'] = c.social[AUTHORIZE]; return c; },
    (c) => { c.social[AUTHORIZE].config = []; return c; },
    (c) => { c.torneos_tables = false; return c; },
  ]) assert.equal(classify(catalogAt('POST_0007', mutate)).state, 'DRIFT');
  assert.equal(classify(null).state, 'DRIFT');
});

test('db8 apply/rollback: phrase, file hash and exact states gate every write', async () => {
  let applied = 0;
  let current = 'POST_0007';
  const deps = {
    catalog: async () => catalogAt(current),
    applySql: async (sql) => { applied += 1; current = sql.includes('REVOKE EXECUTE') ? 'POST_0007' : 'POST_0008'; return { code: 0 }; },
  };
  await assert.rejects(run('apply', ['APPLY', 'TORNEOS', '0008'], deps), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply', phrase('apply'), { ...deps, readFile: () => Buffer.from('tampered') }), /FILE_HASH_MISMATCH/);
  await assert.rejects(run('rollback', phrase('rollback'), deps), /PRE_STATE_POST_0007/);
  assert.equal(applied, 0, 'nothing sent before every gate passes');
  const done = await run('apply', phrase('apply'), deps);
  assert.equal(done.verdict, 'APPLY_0008_DONE'); assert.equal(applied, 1);
  await assert.rejects(run('apply', phrase('apply'), deps), /PRE_STATE_POST_0008/, 'never re-applied on POST_0008');
  const back = await run('rollback', phrase('rollback'), deps);
  assert.equal(back.verdict, 'ROLLBACK_0008_DONE'); assert.equal(applied, 2);
  // A write that moves anything outside authorize, or lands in the wrong state, is reported FAILED.
  current = 'POST_0007';
  const moved = await run('apply', phrase('apply'), { ...deps, catalog: async () => catalogAt(current, (c) => { if (current === 'POST_0008') c.relations.digest = 'changed'; return c; }) });
  assert.equal(moved.verdict, 'APPLY_0008_FAILED'); assert.deepEqual(moved.changedOutsideAuthorize, ['relations']);
  current = 'POST_0007';
  const failed = await run('apply', phrase('apply'), { ...deps, applySql: async () => ({ code: 3 }) });
  assert.equal(failed.verdict, 'APPLY_0008_FAILED');
  const observed = await run('observe', [], deps);
  assert.equal(observed.verdict.state, 'POST_0007');
});
