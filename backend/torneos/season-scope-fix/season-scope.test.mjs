// SEASON-SCOPE-FIX static contract: Git carries exactly the 0007 applied to the Production Torneos DB
// (onzpwnqxnvlgsevivngf, 2026-10-01, body a533331a → bf263aca). Reads local files only; never touches a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MIG_DIR = 'backend/torneos/supabase/migrations';
const M0007 = `${MIG_DIR}/00000000000007_season_entitlements_scope.sql`;
const R0007 = 'backend/torneos/season-scope-fix/rollback/00000000000007_season_entitlements_scope.rollback.sql';
const FN = 'get_effective_tournament_season_entitlements';
// sha256 pinned by the Production apply gate; md5(prosrc) observed in Production before / after.
const APPLIED_SHA256 = 'ba0450f965f3357679e493efc8ac465eb37c836dafccdf21138ea9244d85a205';
const ROLLBACK_SHA256 = '054985997ea06a0c7745f1e700489a9b879cbd40f0320d83d7049780f2758be3';
const POST_0006_MD5 = 'a533331a821dbbac90c6eedbc7b053b3';
const POST_0007_MD5 = 'bf263acafb185ee0993117d5805bc701';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
// md5(pg_proc.prosrc) is the md5 of the text between the dollar quotes.
function bodyMd5s(sql) {
  const out = [];
  const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${FN}\\(`, 'g');
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const start = sql.indexOf('AS $$', m.index) + 'AS $$'.length;
    out.push(md5(sql.slice(start, sql.indexOf('$$;', start))));
  }
  return out;
}

test('0007 is byte-identical to the migration applied in Production and yields the observed body', () => {
  const sql = read(M0007);
  assert.equal(sha256(sql), APPLIED_SHA256);
  assert.deepEqual(bodyMd5s(sql), [POST_0007_MD5]);
  assert.match(sql, new RegExp(`IF v_md5 NOT IN \\('${POST_0006_MD5}', '${POST_0007_MD5}'\\)`), 'precondition: POST_0006 or re-apply only');
  assert.match(sql, new RegExp(`IF v_md5 <> '${POST_0007_MD5}'`), 'postcondition pins the applied body');
});

test('0007 starts from the certified POST_0006 body: baseline defines it, no other migration redefines it', () => {
  const files = fs.readdirSync(path.join(REPO, MIG_DIR)).filter((f) => f.endsWith('.sql')).sort();
  // Successors are known by name; none of them may touch this function (checked right below).
  assert.deepEqual(files.slice(files.indexOf(path.basename(M0007)) + 1), ['00000000000008_social_v1_export_authorization.sql']);
  const defs = files.map((f) => [f, bodyMd5s(read(`${MIG_DIR}/${f}`))]).filter(([, b]) => b.length);
  assert.deepEqual(defs, [['00000000000000_torneos_baseline_v1.sql', [POST_0006_MD5]], [path.basename(M0007), [POST_0007_MD5]]]);
});

test('0007 replaces one function body and nothing else: no grant, owner, table or other function change', () => {
  const sql = read(M0007).replace(/^--.*$/gm, '');
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_effective_tournament_season_entitlements\(p_organization_id uuid, p_season_id uuid\) RETURNS jsonb\n\s+LANGUAGE plpgsql STABLE SECURITY DEFINER\n\s+SET search_path TO ''/);
  for (const forbidden of [/\bGRANT\b/, /\bREVOKE\b/, /\bALTER\b/, /(?<!ON COMMIT )\bDROP\b/, /\bINSERT INTO public\./, /\bUPDATE public\./, /\bDELETE FROM\b/, /CREATE (?:UNLOGGED )?TABLE/]) {
    assert.doesNotMatch(sql, forbidden);
  }
  assert.equal((sql.match(/CREATE TEMPORARY TABLE \w+ \(\n\s+attrs text NOT NULL\n\) ON COMMIT DROP;/g) || []).length, 1, 'only the transaction-local state table');
  assert.match(sql, /^BEGIN;$/m); assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /has_function_privilege\('anon', v_fn, 'EXECUTE'\)/, 'EXECUTE stays authenticated-only');
});

test('0007 refuses an unbound or unresolved (organization, season) with the existing 403 contract', () => {
  const sql = read(M0007);
  const body = sql.slice(sql.indexOf('AS $$'), sql.indexOf('$$;', sql.indexOf('AS $$')));
  assert.match(body, /p_organization_id is null or p_season_id is null or not exists \(\n\s+select 1 from public\.tournament_seasons season\n\s+where season\.organization_id=p_organization_id and season\.id=p_season_id\n\s+\) or not public\.has_tournament_season_access\(p_organization_id,p_season_id\) then/);
  assert.match(body, /if v_result is null then\n\s+raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';/);
  assert.equal((body.match(/errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN'/g) || []).length, 2);
  assert.doesNotMatch(body, /\binsert\b|\bupdate\b|\bdelete\b|\bexecute\b/i, 'read-only body');
});

test('rollback is pinned and restores the POST_0006 body byte for byte', () => {
  const sql = read(R0007);
  assert.equal(sha256(sql), ROLLBACK_SHA256);
  assert.deepEqual(bodyMd5s(sql), [POST_0006_MD5]);
  assert.match(sql, new RegExp(`'${POST_0007_MD5}'`));
});
