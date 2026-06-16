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
const followupMigrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260615222854_challenge_manual_results_followup.sql',
);
const acceptedStatusFixMigrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260616121000_fix_challenge_result_accepted_status.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();
const followupSql = fs.readFileSync(followupMigrationPath, 'utf8');
const normalizedFollowupSql = followupSql.replace(/\s+/g, ' ').trim();
const acceptedStatusFixSql = fs.readFileSync(acceptedStatusFixMigrationPath, 'utf8');
const normalizedAcceptedStatusFixSql = acceptedStatusFixSql.replace(/\s+/g, ' ').trim();

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

  test('reporting RPC enforces owner/admin/captain permissions and an accepted rival', () => {
    expect(normalizedFollowupSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_report_challenge_result(');
    expect(normalizedFollowupSql).toContain('public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid)');
    expect(normalizedFollowupSql).toContain('public.team_user_is_admin_or_owner(v_challenge.accepted_team_id, v_uid)');
    expect(normalizedFollowupSql).toContain('public.team_user_is_captain_or_owner(v_challenge.challenger_team_id, v_uid)');
    expect(normalizedFollowupSql).toContain('public.team_user_is_captain_or_owner(v_challenge.accepted_team_id, v_uid)');
    expect(normalizedFollowupSql).toContain('Solo owner/capitan/admin involucrado puede responder el resultado');
    expect(normalizedFollowupSql).toContain('No se pudo identificar un unico equipo para responder el resultado');
    expect(normalizedFollowupSql).toContain('Challenge sin equipo rival');
    expect(normalizedFollowupSql).toContain("v_challenge.status NOT IN ('accepted', 'confirmed', 'completed')");
    expect(normalizedFollowupSql).toContain("v_challenge.status = 'accepted'");
    expect(normalizedFollowupSql).toContain('v_challenge.scheduled_at IS NULL OR v_challenge.scheduled_at > now()');
    expect(normalizedFollowupSql).toContain("status = 'played'");
    // Never writes a fabricated scoreline.
    expect(normalizedFollowupSql).not.toContain('score_a = 1');
    expect(normalizedFollowupSql).not.toContain('p_score_a');
  });

  test('accepted-status fix reports result without completing the challenge', () => {
    expect(normalizedAcceptedStatusFixSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_report_challenge_result(');
    expect(normalizedAcceptedStatusFixSql).toContain("v_challenge.status NOT IN ('accepted', 'confirmed', 'completed')");
    expect(normalizedAcceptedStatusFixSql).toContain("v_challenge.status = 'accepted'");
    expect(normalizedAcceptedStatusFixSql).toContain('v_challenge.scheduled_at IS NULL OR v_challenge.scheduled_at > now()');
    expect(normalizedAcceptedStatusFixSql).toContain("status = 'played'");
    expect(normalizedAcceptedStatusFixSql).toContain('IF v_match.result_status IS NOT NULL THEN');
    expect(normalizedAcceptedStatusFixSql).toContain('El resultado del desafio ya fue cargado');
    expect(normalizedAcceptedStatusFixSql).not.toContain("SET status = 'completed'");
    expect(normalizedAcceptedStatusFixSql).not.toContain('UPDATE public.challenges c SET');
  });

  test('follow-up clears fabricated scoreless backfills', () => {
    expect(normalizedFollowupSql).toContain('UPDATE public.team_matches tm');
    expect(normalizedFollowupSql).toContain('tm.result_reported_by_team_id IS NULL');
    expect(normalizedFollowupSql).toContain('tm.score_a IS NULL OR tm.score_b IS NULL');
    expect(normalizedFollowupSql).toContain('result_status = NULL');
  });

  test('head-to-head exposes played vs encounters and derives winner from result_status', () => {
    expect(normalizedFollowupSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_get_challenge_head_to_head_stats(');
    expect(normalizedFollowupSql).toContain('"totalEncounters" bigint');
    expect(normalizedFollowupSql).toContain('"totalMatchesPlayed" bigint');
    expect(normalizedFollowupSql).toContain('"draws" bigint');
    expect(normalizedFollowupSql).toContain('p_exclude_match_id uuid DEFAULT NULL');
    expect(normalizedFollowupSql).toContain("WHEN e.result_status = 'team_a_win' THEN e.team_a_id");
    expect(normalizedFollowupSql).toContain("lower(COALESCE(sm.status, '')) <> 'cancelled'");
    expect(normalizedFollowupSql).toContain("e.result_status IN ('team_a_win', 'team_b_win', 'draw')");
    expect(normalizedFollowupSql).toContain('e.score_a IS NOT NULL AND e.score_b IS NOT NULL');
  });

  test('per-rival history uses manual result with a legacy score fallback', () => {
    expect(normalizedFollowupSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_team_history_by_rival(');
    expect(normalizedFollowupSql).toContain("WHEN tm.result_status = 'team_a_win'");
    expect(normalizedFollowupSql).toContain("WHEN tm.result_status = 'draw' THEN 'draw'");
    expect(normalizedFollowupSql).toContain("WHEN tm.result_status = 'team_b_win'");
    expect(normalizedFollowupSql).toContain("lower(COALESCE(tm.status, '')) = 'played'");
    expect(normalizedFollowupSql).toContain("tm.result_status IN ('team_a_win', 'team_b_win', 'draw')");
    expect(normalizedFollowupSql).toContain('tm.score_a IS NOT NULL AND tm.score_b IS NOT NULL');
    expect(normalizedFollowupSql).not.toContain('COALESCE(tm.score_a, 0) = COALESCE(tm.score_b, 0)');
  });
});
