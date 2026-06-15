const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260615120000_challenge_manual_results.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('challenge manual results migration', () => {
  test('adds explicit manual-result columns to team_matches', () => {
    expect(normalizedSql).toContain('ALTER TABLE public.team_matches');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_status text NULL');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_reported_by_team_id uuid NULL');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_reported_at timestamptz NULL');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_updated_at timestamptz NULL');
  });

  test('constrains result_status to the three manual outcomes', () => {
    expect(normalizedSql).toContain("result_status IN ('team_a_win', 'team_b_win', 'draw')");
  });

  test('backfills existing played matches from legacy scores without inventing goals', () => {
    expect(normalizedSql).toContain('UPDATE public.team_matches');
    expect(normalizedSql).toContain("WHEN COALESCE(score_a, 0) > COALESCE(score_b, 0) THEN 'team_a_win'");
    expect(normalizedSql).toContain("WHEN COALESCE(score_a, 0) < COALESCE(score_b, 0) THEN 'team_b_win'");
    expect(normalizedSql).toContain("ELSE 'draw'");
    expect(normalizedSql).toContain("WHERE lower(COALESCE(status, '')) = 'played' AND result_status IS NULL");
  });

  test('reporting RPC enforces permissions and an accepted rival', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_report_challenge_result(');
    expect(normalizedSql).toContain('public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid)');
    expect(normalizedSql).toContain('public.team_user_is_admin_or_owner(v_challenge.accepted_team_id, v_uid)');
    expect(normalizedSql).toContain('Challenge sin equipo rival');
    expect(normalizedSql).toContain("v_challenge.status NOT IN ('accepted', 'confirmed', 'completed')");
    expect(normalizedSql).toContain("v_challenge.status = 'accepted'");
    expect(normalizedSql).toContain('v_challenge.scheduled_at > now()');
    expect(normalizedSql).toContain("status = 'played'");
    // Never writes a fabricated scoreline.
    expect(normalizedSql).not.toContain('score_a = 1');
    expect(normalizedSql).not.toContain('p_score_a');
  });

  test('head-to-head exposes played vs encounters and derives winner from result_status', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_get_challenge_head_to_head_stats(');
    expect(normalizedSql).toContain('"totalEncounters" bigint');
    expect(normalizedSql).toContain('"totalMatchesPlayed" bigint');
    expect(normalizedSql).toContain('"draws" bigint');
    expect(normalizedSql).toContain('p_exclude_match_id uuid DEFAULT NULL');
    expect(normalizedSql).toContain("WHEN e.result_status = 'team_a_win' THEN e.team_a_id");
    expect(normalizedSql).toContain("lower(COALESCE(sm.status, '')) <> 'cancelled'");
  });

  test('per-rival history uses manual result with a legacy score fallback', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_team_history_by_rival(');
    expect(normalizedSql).toContain("WHEN tm.result_status = 'team_a_win'");
    expect(normalizedSql).toContain("WHEN tm.result_status = 'draw' THEN 'draw'");
    expect(normalizedSql).toContain("WHEN tm.result_status = 'team_b_win'");
    expect(normalizedSql).toContain("lower(COALESCE(tm.status, '')) = 'played'");
  });
});
