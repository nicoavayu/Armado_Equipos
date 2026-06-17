const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260616193000_team_challenge_rankings.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

// SQL with `-- ...` line comments removed, so the safety-net assertions check
// the actual executed code and not the documentation header (which intentionally
// names the sensitive objects it promises to leave untouched).
const codeOnlySql = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe('team challenge rankings migration', () => {
  test('defines the helper + both read-only RPCs', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.team_challenge_confirmed_team_stats(');
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_get_team_challenge_rankings(');
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_search_challengeable_teams(');
  });

  // Tests 1-4: count ONLY confirmed, agreed results. Provisional results,
  // conflicts, and unreported matches must never reach the ranking.
  test('counts only result_confirmed=true, no conflict, valid result_status', () => {
    expect(normalizedSql).toContain('AND tm.result_confirmed = true');
    expect(normalizedSql).toContain('AND COALESCE(tm.result_conflict, false) = false');
    expect(normalizedSql).toContain("AND tm.result_status IN ('team_a_win', 'team_b_win', 'draw')");
    expect(normalizedSql).toContain("(lower(COALESCE(tm.origin_type, '')) = 'challenge' OR tm.challenge_id IS NOT NULL)");
  });

  // Test 5: wins/draws/losses derived correctly for BOTH team_a and team_b.
  test('maps win/draw/loss from both perspectives', () => {
    // team_a (challenger) perspective
    expect(normalizedSql).toContain('c.team_a_id AS team_id');
    expect(normalizedSql).toContain("CASE WHEN c.result_status = 'team_a_win' THEN 1 ELSE 0 END AS won");
    expect(normalizedSql).toContain("CASE WHEN c.result_status = 'team_b_win' THEN 1 ELSE 0 END AS lost");
    // team_b (accepted) perspective
    expect(normalizedSql).toContain('c.team_b_id AS team_id');
    expect(normalizedSql).toContain("CASE WHEN c.result_status = 'team_b_win' THEN 1 ELSE 0 END AS won");
    expect(normalizedSql).toContain("CASE WHEN c.result_status = 'team_a_win' THEN 1 ELSE 0 END AS lost");
    // draw counts for both, and played_count adds one per team via UNION ALL
    expect(normalizedSql).toContain("CASE WHEN c.result_status = 'draw' THEN 1 ELSE 0 END AS drew");
    expect(normalizedSql).toContain('UNION ALL');
    expect(normalizedSql).toContain('COUNT(*)::bigint AS played_count');
    expect(normalizedSql).toContain('MAX(pt.played_at) AS last_played_at');
  });

  test('win_rate is 0 when played_count is 0, otherwise wins/played*100 rounded', () => {
    expect(normalizedSql).toContain('CASE WHEN s.played_count > 0 THEN round(s.wins * 100.0 / s.played_count) ELSE 0 END');
  });

  // Tests 6-7: ordering for "mas jugaron" (played) and "mas ganaron" (wins).
  test('orders by played then wins for sort=played, and wins then win_rate for sort=wins', () => {
    expect(normalizedSql).toContain("CASE WHEN v_sort = 'wins' THEN s.wins END DESC NULLS LAST");
    expect(normalizedSql).toContain("CASE WHEN v_sort = 'wins' THEN s.played_count END DESC NULLS LAST");
    expect(normalizedSql).toContain("CASE WHEN v_sort <> 'wins' THEN s.played_count END DESC NULLS LAST");
    expect(normalizedSql).toContain("CASE WHEN v_sort <> 'wins' THEN s.wins END DESC NULLS LAST");
  });

  // Tests 8-9: filters by format and free-text zone (base_zone).
  test('filters by format and zone (base_zone ILIKE)', () => {
    expect(normalizedSql).toContain('v_format IS NULL OR t.format = v_format');
    expect(normalizedSql).toContain("v_zone IS NULL OR t.base_zone ILIKE '%' || v_zone || '%'");
  });

  test('ranking supports the optional 90-day period filter', () => {
    expect(normalizedSql).toContain("now() - interval '90 days'");
  });

  // Directory: active teams, including ones with no confirmed match (zeros).
  test('directory left-joins stats so teams with no confirmed match still appear', () => {
    expect(normalizedSql).toContain('LEFT JOIN stats s ON s.team_id = t.id');
    expect(normalizedSql).toContain("v_query IS NULL OR t.name ILIKE '%' || v_query || '%'");
  });

  // Security: SECURITY DEFINER, authenticated-only, active teams, locked helper.
  test('is read-only, authenticated-only, active teams, and locked down', () => {
    expect(normalizedSql).toContain('SECURITY DEFINER');
    expect(normalizedSql).toContain('SET search_path = public');
    expect(normalizedSql).toContain('Usuario no autenticado');
    expect(normalizedSql).toContain('t.is_active = true');
    expect(normalizedSql).toContain('REVOKE ALL ON FUNCTION public.team_challenge_confirmed_team_stats(timestamptz) FROM public');
    expect(normalizedSql).toContain('GRANT EXECUTE ON FUNCTION public.rpc_get_team_challenge_rankings(text, text, text, int, text) TO authenticated, service_role');
    expect(normalizedSql).toContain('GRANT EXECUTE ON FUNCTION public.rpc_search_challengeable_teams(text, text, text, int) TO authenticated, service_role');
  });

  // Tests 19-24 safety net: the migration must not touch any sensitive object.
  test('does NOT modify tables, triggers, sensitive functions, or write data', () => {
    expect(codeOnlySql).not.toContain('enforce_team_member_permissions');
    expect(codeOnlySql).not.toContain('account_deletion');
    expect(codeOnlySql).not.toContain('validate_challenge_payload');
    expect(codeOnlySql).not.toContain('ALTER TABLE');
    expect(codeOnlySql).not.toContain('DROP TABLE');
    expect(codeOnlySql).not.toContain('CREATE TRIGGER');
    expect(codeOnlySql).not.toContain('INSERT INTO');
    expect(codeOnlySql).not.toContain('DELETE FROM');
    expect(codeOnlySql).not.toContain('UPDATE public.');
  });
});
