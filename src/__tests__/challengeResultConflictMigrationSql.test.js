const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260616173228_challenge_result_conflicts.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('challenge result conflict migration', () => {
  test('adds per-team reports and conflict metadata', () => {
    expect(normalizedSql).toContain('CREATE TABLE IF NOT EXISTS public.challenge_result_reports');
    expect(normalizedSql).toContain('team_match_id uuid NOT NULL REFERENCES public.team_matches(id) ON DELETE CASCADE');
    expect(normalizedSql).toContain('reporting_team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE');
    expect(normalizedSql).toContain("CHECK (reported_result_status IN ('team_a_win', 'team_b_win', 'draw'))");
    expect(normalizedSql).toContain('UNIQUE (team_match_id, reporting_team_id)');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_confirmed boolean NOT NULL DEFAULT false');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_conflict boolean NOT NULL DEFAULT false');
  });

  test('backfills existing single-reporter results as unconfirmed reports', () => {
    expect(normalizedSql).toContain('INSERT INTO public.challenge_result_reports');
    expect(normalizedSql).toContain('tm.result_reported_by_team_id IS NOT NULL');
    expect(normalizedSql).toContain('ON CONFLICT (team_match_id, reporting_team_id) DO NOTHING');
    expect(normalizedSql).toContain('result_confirmed = false');
  });

  test('RPC confirms compatible reports and marks incompatible reports as conflict', () => {
    expect(normalizedSql).toContain('COUNT(DISTINCT r.reported_result_status)::integer');
    expect(normalizedSql).toContain('IF v_report_count >= 2 AND v_distinct_status_count = 1 THEN');
    expect(normalizedSql).toContain('result_confirmed = true');
    expect(normalizedSql).toContain('ELSIF v_report_count >= 2 THEN');
    expect(normalizedSql).toContain('result_status = NULL');
    expect(normalizedSql).toContain('result_conflict = true');
    expect(normalizedSql).toContain('El resultado del desafio esta en conflicto y requiere revision manual');
    expect(normalizedSql).toContain('Tu equipo ya cargo el resultado de este desafio');
  });

  test('edit RPC keeps kebab edits available for creator or team admins without a past-time block', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_update_team_match_details');
    expect(normalizedSql).toContain('v_challenge.created_by_user_id = v_uid');
    expect(normalizedSql).toContain('public.team_user_is_admin_or_owner(v_match.team_a_id, v_uid)');
    expect(normalizedSql).toContain('public.team_user_is_admin_or_owner(v_match.team_b_id, v_uid)');
    expect(normalizedSql).toContain('public.team_user_is_captain_or_owner(v_match.team_a_id, v_uid)');
    expect(normalizedSql).toContain('public.team_user_is_captain_or_owner(v_match.team_b_id, v_uid)');
    expect(normalizedSql).toContain("v_has_result := v_match.result_status IN ('team_a_win', 'team_b_win', 'draw')");
    expect(normalizedSql).toContain('UPDATE public.challenges c SET scheduled_at = p_scheduled_at');
    expect(normalizedSql).toContain('field_price = p_cancha_cost');
    expect(normalizedSql).not.toContain('No se puede editar un partido pasado');
  });

  test('history and head-to-head stats exclude conflicts and provisional results', () => {
    expect(normalizedSql).toContain('COALESCE(e.result_conflict, false) = false');
    expect(normalizedSql).toContain("COALESCE(e.result_confirmed, true) = true AND e.result_status IN ('team_a_win', 'team_b_win', 'draw')");
    expect(normalizedSql).toContain('COALESCE(tm.result_conflict, false) = false');
    expect(normalizedSql).toContain("COALESCE(tm.result_confirmed, true) = true AND tm.result_status IN ('team_a_win', 'team_b_win', 'draw')");
  });

  test('backend fanout continues prompting only teams that have not reported', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.process_challenge_result_survey_notifications_backend');
    expect(normalizedSql).toContain('COALESCE(tm.result_confirmed, false) = false');
    expect(normalizedSql).toContain('COALESCE(tm.result_conflict, false) = false');
    expect(normalizedSql).toContain('FROM public.challenge_result_reports report');
    expect(normalizedSql).toContain('report.reporting_team_id = r.managed_team_id');
    expect(normalizedSql).toContain("'managed_team_id', r.managed_team_id");
  });
});
