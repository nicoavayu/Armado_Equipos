const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260616181500_challenge_result_resolution.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('challenge result resolution migration', () => {
  test('adds resolver metadata columns to team_matches', () => {
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_resolved_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(normalizedSql).toContain('ADD COLUMN IF NOT EXISTS result_resolved_at timestamptz NULL');
  });

  // Spec point 8 + "Permisos esperados": only the challenge creator resolves.
  test('only the challenge creator can resolve a conflict', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.rpc_resolve_challenge_result');
    expect(normalizedSql).toContain('v_challenge.created_by_user_id <> v_uid');
    expect(normalizedSql).toContain('Solo el creador del desafio puede resolver el conflicto');
  });

  // Test 15: resolving confirms the chosen result so statistics can count it.
  test('resolution requires an active conflict and confirms the chosen result', () => {
    expect(normalizedSql).toContain('IF NOT COALESCE(v_match.result_conflict, false) THEN');
    expect(normalizedSql).toContain('No hay un conflicto para resolver');
    expect(normalizedSql).toContain('result_status = p_result_status');
    expect(normalizedSql).toContain('result_confirmed = true');
    expect(normalizedSql).toContain('result_conflict = false');
    expect(normalizedSql).toContain('result_resolved_by_user_id = v_uid');
    expect(normalizedSql).toContain('result_resolved_at = now()');
  });

  test('resolving closes pending report/conflict prompts for the match', () => {
    expect(normalizedSql).toContain("n.type IN ('challenge_result_survey', 'challenge_result_pending', 'challenge_result_conflict')");
    expect(normalizedSql).toContain("status = 'resolved'");
  });

  // "Auditar notificaciones": a fresh conflict notifies the challenge creator.
  test('reporting an incompatible result notifies the challenge creator', () => {
    expect(normalizedSql).toContain('ELSIF v_report_count >= 2 THEN');
    expect(normalizedSql).toContain("'challenge_result_conflict'");
    expect(normalizedSql).toContain('v_challenge.created_by_user_id');
    expect(normalizedSql).toContain("'action', 'open_challenge_resolve_modal'");
    expect(normalizedSql).toContain('INSERT INTO public.notification_delivery_log');
    expect(normalizedSql).toContain("'event_channel', 'ACTION'");
    // Idempotent: never duplicate an open conflict prompt for the same match.
    expect(normalizedSql).toContain('IF NOT EXISTS ( SELECT 1 FROM public.notifications n');
  });

  // Tests 3, 5, 6 (backend gate): captain/admin scope, single team, no rewrite.
  test('report RPC keeps captain/admin-only gating and rejects rival/double reports', () => {
    expect(normalizedSql).toContain('public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid)');
    expect(normalizedSql).toContain('public.team_user_is_captain_or_owner(v_challenge.accepted_team_id, v_uid)');
    expect(normalizedSql).toContain('Solo owner/capitan/admin involucrado puede responder el resultado');
    expect(normalizedSql).toContain('No se pudo identificar un unico equipo para responder el resultado');
    expect(normalizedSql).toContain('Tu equipo ya cargo el resultado de este desafio');
  });

  test('grants execute on the resolve RPC to authenticated and service_role', () => {
    expect(normalizedSql).toContain('GRANT EXECUTE ON FUNCTION public.rpc_resolve_challenge_result(uuid, text) TO authenticated, service_role');
  });
});
