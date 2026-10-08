// MEDIA-V1 0014 (retiring a gallery's last published photo returns it to draft) and its rollback, read as text. The
// behaviour against real Postgres + Storage is certified in the lab (REPORT.md, evidence/draft-on-retire.jsonl).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MIGRATION = fs.readFileSync('backend/torneos/supabase/migrations/00000000000014_media_gallery_draft_on_retire.sql', 'utf8');
const ROLLBACK = fs.readFileSync('backend/torneos/media-v1/rollback/00000000000014_media_gallery_draft_on_retire.rollback.sql', 'utf8');
const BASELINE = fs.readFileSync('backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql', 'utf8');
const code = (text) => text.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const fnText = (text, head) => {
  const i = text.indexOf(head);
  assert.ok(i >= 0, head);
  const tag = /\bAS (\$[a-z_]*\$)/i.exec(text.slice(i))[1];
  const open = text.indexOf(tag, i) + tag.length;
  return text.slice(i, text.indexOf(tag, open) + tag.length);
};
const TRANSITION = 'FUNCTION public.transition_tournament_media_asset(';
const PUBLISH = 'FUNCTION public.publish_tournament_media_gallery(';
// Lines present in `after` and not in `before` (and vice versa), as multisets: the whole difference between two bodies.
function lineDiff(before, after) {
  const count = (text) => text.split('\n').reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const [a, b] = [count(before), count(after)];
  const minus = (x, y) => [...x].flatMap(([l, n]) => Array(Math.max(0, n - (y.get(l) || 0))).fill(l));
  return { removed: minus(a, b), added: minus(b, a) };
}

test('0014: one transaction after 0012, fail-closed pins before and after, independent of 0013', () => {
  assert.match(MIGRATION, /^BEGIN;$/m);
  assert.match(MIGRATION, /^COMMIT;$/m);
  assert.match(MIGRATION, /TORNEOS_MEDIA_V1_0014_PRECONDITION_FAILED: 00000000000012 is not in force/);
  assert.equal((MIGRATION.match(/TORNEOS_MEDIA_V1_0014_PRECONDITION_FAILED: \w+ body is not the expected one/g) || []).length, 2);
  assert.equal((MIGRATION.match(/TORNEOS_MEDIA_V1_0014_POSTCONDITION_FAILED: \w+ body is not the expected one/g) || []).length, 2);
  assert.match(MIGRATION, /grants, SECURITY DEFINER or search_path changed/);
  // 0013 (COMMERCE-PRODUCTION) pins its purchase / payment / grant / entitlement chain: 0014 redefines none of it.
  assert.doesNotMatch(code(MIGRATION), /production|purchase|payment|entitlement|has_tournament_season_capability|has_tournament_org_capability|CREATE OR REPLACE FUNCTION public\.has_tournament_season_access/i);
});

test('0014 changes exactly two bodies and nothing else: no grant, owner, table, policy or data', () => {
  const sql = code(MIGRATION);
  assert.deepEqual(sql.match(/CREATE OR REPLACE FUNCTION [a-z_.]+/g),
    ['CREATE OR REPLACE FUNCTION public.transition_tournament_media_asset', 'CREATE OR REPLACE FUNCTION public.publish_tournament_media_gallery']);
  // Statements, case-sensitive like the file: 'revoke' / 'hide' are moderation actions inside the bodies.
  for (const forbidden of [/^\s*GRANT\b/im, /^\s*REVOKE\b/im, /\bALTER (FUNCTION|TABLE|POLICY)\b/i, /\bDROP (FUNCTION|TABLE|POLICY)\b/i, /CREATE (?:UNLOGGED )?TABLE/i, /CREATE POLICY/i,
    /\bINSERT INTO public\.tournament_media_(?!moderation_actions)/i, /^\s*DELETE FROM public\.tournament_media_galleries/im, /tournament_plan_catalog/i,
    /tournament_media_pipeline_configuration/i, /storage\.(buckets|objects)/i]) {
    assert.doesNotMatch(sql, forbidden, String(forbidden));
  }
});

test('transition: only the "no published photo left" branch changes — draft with cleared stamps, audited, never archived', () => {
  const before = fnText(BASELINE, `CREATE ${TRANSITION}`).replace(/^CREATE /, '');
  const after = fnText(MIGRATION, `CREATE OR REPLACE ${TRANSITION}`).replace(/^CREATE OR REPLACE /, '');
  const { removed, added } = lineDiff(before, after);
  assert.deepEqual(removed, ["      SET status = 'archived',cover_asset_id = NULL,archived_at = now(),"]);
  assert.deepEqual(added.filter((l) => !l.trim().startsWith('--')), [
    "      SET status = 'draft',cover_asset_id = NULL,submitted_at = NULL,published_at = NULL,published_by = NULL,",
    '      PERFORM public.append_tournament_audit(',
    "        v_asset.organization_id,'media.gallery.unpublished','media_gallery',v_gallery.id,",
    "        null,v_asset.tournament_id,jsonb_build_object('assetId',p_asset_id,'action',p_action)",
    '      );',
  ]);
  // The lifecycle check: draft carries no submitted / published / archived / revoked stamps.
  assert.match(BASELINE, /\(status = 'draft'::text\) AND \(submitted_at IS NULL\) AND \(published_at IS NULL\) AND \(archived_at IS NULL\) AND \(revoked_at IS NULL\)/);
  // Moderation never archives any more; the explicit «Archivar galería» RPC is not redefined.
  assert.doesNotMatch(code(after), /status = 'archived'/);
  assert.doesNotMatch(MIGRATION, /CREATE OR REPLACE FUNCTION public\.change_tournament_media_gallery_state/);
});

test('publish: approved photos are published; hidden / revoked / rejected stay out without blocking; pending review still blocks', () => {
  const before = fnText(BASELINE, `CREATE ${PUBLISH}`).replace(/^CREATE /, '');
  const after = fnText(MIGRATION, `CREATE OR REPLACE ${PUBLISH}`).replace(/^CREATE OR REPLACE /, '');
  const { removed, added } = lineDiff(before, after);
  assert.deepEqual(removed.sort(), [
    "      and asset.status <> 'approved'",
    '    where item.gallery_id = p_gallery_id',
    '    where item.gallery_id = p_gallery_id',
    '  where item.gallery_id = p_gallery_id;',
  ].sort());
  assert.deepEqual(added.filter((l) => !l.trim().startsWith('--')).sort(), [
    "      and asset.status not in ('approved','hidden','revoked','rejected')",
    "  where item.gallery_id = p_gallery_id and asset.status = 'approved';",
    '    join public.tournament_media_assets asset on asset.id = item.asset_id',
    '    join public.tournament_media_assets asset on asset.id = item.asset_id',
    "    where item.gallery_id = p_gallery_id and asset.status = 'approved'",
    "    where item.gallery_id = p_gallery_id and asset.status = 'approved'",
  ].sort());
  // Unchanged: only approved photos become published; the capability and season checks; the cover must be approved.
  assert.match(after, /set status = 'published',published_at = now\(\)\n  where asset\.gallery_id = p_gallery_id and asset\.status = 'approved';/);
  assert.match(after, /has_tournament_media_capability\(\n    v_gallery\.organization_id,'media\.publish'\n  \) and public\.has_tournament_season_access/);
  assert.match(after, /asset\.id = v_gallery\.cover_asset_id\n      and asset\.gallery_id = p_gallery_id and asset\.status = 'approved'/);
});

test('rollback-0014 restores both baseline bodies and the baseline comment verbatim, and never touches data', () => {
  for (const head of [TRANSITION, PUBLISH]) {
    assert.equal(fnText(ROLLBACK, `CREATE OR REPLACE ${head}`).replace(/^CREATE OR REPLACE /, ''), fnText(BASELINE, `CREATE ${head}`).replace(/^CREATE /, ''), head);
  }
  const comment = /COMMENT ON FUNCTION public\.transition_tournament_media_asset[^\n]*/;
  assert.equal(comment.exec(ROLLBACK)[0], comment.exec(BASELINE)[0]);
  assert.notEqual(comment.exec(MIGRATION)[0], comment.exec(BASELINE)[0]);
  assert.match(ROLLBACK, /TORNEOS_MEDIA_V1_0014_ROLLBACK_PRECONDITION_FAILED/);
  assert.match(ROLLBACK, /TORNEOS_MEDIA_V1_0014_ROLLBACK_POSTCONDITION_FAILED/);
  // Outside the two restored bodies: no data write, grant or drop.
  const outside = code(ROLLBACK).replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$\$;/g, '');
  for (const forbidden of [/\bUPDATE\b/i, /\bINSERT\b/i, /\bDELETE\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bDROP\b/i]) {
    assert.doesNotMatch(outside, forbidden, String(forbidden));
  }
});
