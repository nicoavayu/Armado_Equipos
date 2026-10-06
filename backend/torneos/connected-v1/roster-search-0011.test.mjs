// 0011 (a team's own responsible can search Arma2 players), read statically against the certified sources:
//   • the bodies it installs differ from the certified ones (baseline / 0005) ONLY in where the season guard sits;
//   • its rollback restores both certified bodies byte for byte; neither file grants or revokes anything;
//   • the md5 pins of the migration, its rollback and the operator driver are the same numbers.
// Behaviour on real Postgres + gateway: the promotion rehearsal (captain outside the organization searches and adds
// Arma2 players; an organization member without season access is still refused) — docs/torneos/connected-product/DEPLOY.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ROSTER_SEARCH } from './remote/db-0009-0011.mjs';

const read = (p) => fs.readFileSync(p, 'utf8');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const BASELINE = read('backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql');
const OFFICIALIZATION = read('backend/torneos/supabase/migrations/00000000000005_officialization_v1.sql');
const MIGRATION = read('backend/torneos/supabase/migrations/00000000000011_connected_roster_search.sql');
const ROLLBACK = read('backend/torneos/connected-v1/rollback/00000000000011_connected_roster_search.rollback.sql');

function body(text, header, open, close) {
  const at = text.indexOf(header);
  assert.notEqual(at, -1, header);
  const start = text.indexOf(open, at) + open.length;
  return text.slice(start, text.indexOf(close, start) + (close === '\n$$;' ? 1 : 0));
}
const searchOf = (text, header) => body(text, header, 'AS $$', '\n$$;');
const authOf = (text) => body(text, 'FUNCTION private.authorize_core_contract(', 'AS $function$', '$function$');

const certified = { search: searchOf(BASELINE, 'CREATE FUNCTION public.search_tournament_players('), auth: authOf(OFFICIALIZATION) };
const installed = { search: searchOf(MIGRATION, 'CREATE OR REPLACE FUNCTION public.search_tournament_players('), auth: authOf(MIGRATION) };
const restored = { search: searchOf(ROLLBACK, 'CREATE OR REPLACE FUNCTION public.search_tournament_players('), auth: authOf(ROLLBACK) };

test('0011 pins: certified and installed md5 equal the driver and the in-file guards', () => {
  assert.equal(md5(certified.search), ROSTER_SEARCH.certified.search_md5);
  assert.equal(md5(certified.auth), ROSTER_SEARCH.certified.authorize_md5);
  assert.equal(md5(installed.search), ROSTER_SEARCH.fixed.search_md5);
  assert.equal(md5(installed.auth), ROSTER_SEARCH.fixed.authorize_md5);
  for (const pin of [...Object.values(ROSTER_SEARCH.certified), ...Object.values(ROSTER_SEARCH.fixed)]) {
    assert.ok(MIGRATION.includes(pin) && ROLLBACK.includes(pin), `${pin} guarded in both files`);
  }
  assert.ok(OFFICIALIZATION.includes(ROSTER_SEARCH.certified.authorize_md5), '0005 pins the same certified authorize body');
});

// The whole change, literally: in each body exactly one clause is replaced, nothing else moves.
const CLAUSES = Object.freeze({
  search: {
    certified: "    or not (\n      public.has_tournament_organization_capability(\n        p_organization_id,\n        'roster_players.read'\n      )\n      or (\n        p_team_entry_id is not null\n        and public.can_edit_tournament_team_entry(\n          p_organization_id,\n          p_team_entry_id\n        )\n        and exists (\n          select 1\n          from public.tournament_team_entries entry\n          where entry.id = p_team_entry_id\n            and entry.organization_id = p_organization_id\n            and entry.tournament_id = p_tournament_id\n        )\n      )\n    )\n    or not exists (\n      select 1 from public.tournaments\n      where id = p_tournament_id and organization_id = p_organization_id and status <> 'archived'\n        and public.has_tournament_season_access(p_organization_id, season_id)\n    )\n",
    installed: "    or not (\n      (\n        public.has_tournament_organization_capability(\n          p_organization_id,\n          'roster_players.read'\n        )\n        and exists (\n          select 1 from public.tournaments\n          where id = p_tournament_id and organization_id = p_organization_id and status <> 'archived'\n            and public.has_tournament_season_access(p_organization_id, season_id)\n        )\n      )\n      or (\n        p_team_entry_id is not null\n        and public.can_edit_tournament_team_entry(\n          p_organization_id,\n          p_team_entry_id\n        )\n        and exists (\n          select 1\n          from public.tournament_team_entries entry\n          join public.tournaments tournament on tournament.id = entry.tournament_id\n          where entry.id = p_team_entry_id\n            and entry.organization_id = p_organization_id\n            and entry.tournament_id = p_tournament_id\n            and tournament.status <> 'archived'\n        )\n      )\n    )\n",
  },
  auth: {
    certified: "   IF NOT (\n     public.has_tournament_organization_capability(v_organization_id, 'roster_players.read')\n     OR (\n      v_team_entry_id IS NOT NULL\n      AND public.can_edit_tournament_team_entry(v_organization_id, v_team_entry_id)\n      AND EXISTS (\n       SELECT 1 FROM public.tournament_team_entries entry\n       WHERE entry.id = v_team_entry_id\n        AND entry.organization_id = v_organization_id\n        AND entry.tournament_id = v_tournament_id\n      )\n     )\n    ) OR NOT EXISTS (\n     SELECT 1 FROM public.tournaments\n     WHERE id = v_tournament_id AND organization_id = v_organization_id AND status <> 'archived'\n      AND public.has_tournament_season_access(v_organization_id, season_id)\n    )\n   THEN\n",
    installed: "   IF NOT (\n     (\n      public.has_tournament_organization_capability(v_organization_id, 'roster_players.read')\n      AND EXISTS (\n       SELECT 1 FROM public.tournaments\n       WHERE id = v_tournament_id AND organization_id = v_organization_id AND status <> 'archived'\n        AND public.has_tournament_season_access(v_organization_id, season_id)\n      )\n     )\n     OR (\n      v_team_entry_id IS NOT NULL\n      AND public.can_edit_tournament_team_entry(v_organization_id, v_team_entry_id)\n      AND EXISTS (\n       SELECT 1 FROM public.tournament_team_entries entry\n       JOIN public.tournaments tournament ON tournament.id = entry.tournament_id\n       WHERE entry.id = v_team_entry_id\n        AND entry.organization_id = v_organization_id\n        AND entry.tournament_id = v_tournament_id\n        AND tournament.status <> 'archived'\n      )\n     )\n    )\n   THEN\n",
  },
});

test('0011 changes nothing but where the season guard applies', () => {
  for (const kind of ['search', 'auth']) {
    const { certified: before, installed: after } = CLAUSES[kind];
    assert.equal(certified[kind].split(before).length, 2, `${kind}: the certified clause appears exactly once`);
    assert.equal(installed[kind], certified[kind].replace(before, after), `${kind}: installed = certified with that one clause replaced`);
    // The organization path keeps the season guard; the team entry path keeps the entry/tournament binding + not archived.
    assert.ok(after.includes('has_tournament_season_access') && after.indexOf('has_tournament_season_access') < after.indexOf('can_edit_tournament_team_entry'));
    assert.match(after, /entry\.tournament_id = (p|v)_tournament_id\s*(and|AND) tournament\.status <> 'archived'/);
  }
});

test('0011 rollback restores both certified bodies byte for byte; no file grants or revokes anything', () => {
  assert.equal(restored.search, certified.search);
  assert.equal(restored.auth, certified.auth);
  for (const text of [MIGRATION, ROLLBACK]) {
    const code = text.replace(/--[^\n]*/g, '');
    assert.doesNotMatch(code, /\b(GRANT|REVOKE)\b/i);
    assert.match(code, /TORNEOS_ROSTER_SEARCH_ACL_CHANGED/, 'the ACL post-check is present');
  }
});
