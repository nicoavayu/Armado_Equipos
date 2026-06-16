const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260616130000_challenge_result_survey_recent_window.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('challenge result survey recent-window fanout migration', () => {
  test('replaces the backend fanout function without editing applied migrations', () => {
    expect(normalizedSql).toContain(
      'CREATE OR REPLACE FUNCTION public.process_challenge_result_survey_notifications_backend',
    );
    // It must not redefine the cron job (kept by the original migration).
    expect(normalizedSql).not.toContain("cron.schedule(");
  });

  test('only prompts 60 minutes after the scheduled kickoff', () => {
    expect(normalizedSql).toContain(
      "COALESCE(tm.scheduled_at, c.scheduled_at) + interval '60 minutes' <= now()",
    );
  });

  test('applies a 48h anti-backfill window so old matches do not spam fresh pushes', () => {
    expect(normalizedSql).toContain(
      "COALESCE(tm.scheduled_at, c.scheduled_at) >= now() - interval '48 hours'",
    );
  });

  test('orders newest first so the LIMIT prioritizes recent matches', () => {
    expect(normalizedSql).toContain('ORDER BY COALESCE(tm.scheduled_at, c.scheduled_at) DESC');
  });

  test('keeps the eligibility guards (accepted rival, valid status, no loaded result)', () => {
    expect(normalizedSql).toContain('c.accepted_team_id IS NOT NULL');
    expect(normalizedSql).toContain("lower(COALESCE(c.status, '')) IN ('accepted', 'confirmed', 'completed')");
    expect(normalizedSql).toContain("lower(COALESCE(c.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'cancelado', 'rejected')");
    expect(normalizedSql).toContain("lower(COALESCE(tm.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'cancelado', 'rejected')");
    expect(normalizedSql).toContain('tm.result_status IS NULL');
  });

  test('does not reuse the wrong team_match status whitelist that omitted pending', () => {
    expect(normalizedSql).not.toContain("lower(COALESCE(tm.status, '')) IN ('accepted', 'confirmed', 'played', 'completed')");
  });

  test('keeps single notification per user/team_match and the push payload contract', () => {
    expect(normalizedSql).toContain("pg_advisory_xact_lock(hashtext('challenge_result_survey_backend_fanout'))");
    expect(normalizedSql).toContain('SELECT DISTINCT ON (e.team_match_id, r.user_id)');
    expect(normalizedSql).toContain('ON CONFLICT DO NOTHING');
    expect(normalizedSql).toContain("'action', 'open_challenge_result_modal'");
    expect(normalizedSql).toContain(
      "'/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal'",
    );
    expect(normalizedSql).toContain("'notification_type', 'challenge_result_survey'");
  });

  test('neutralizes legacy out-of-window prompts without deleting data', () => {
    expect(normalizedSql).toContain('WITH aged_notifications AS');
    expect(normalizedSql).toContain("COALESCE(tm.scheduled_at, c.scheduled_at) < now() - interval '48 hours'");
    expect(normalizedSql).toContain('read = true');
    expect(normalizedSql).toContain("status = 'resolved'");
    expect(normalizedSql).not.toContain('DELETE FROM public.notifications');
  });

  test('skips stale queued pushes for out-of-window matches', () => {
    expect(normalizedSql).toContain('UPDATE public.notification_delivery_log l');
    expect(normalizedSql).toContain("status = 'skipped'");
    expect(normalizedSql).toContain("l.status IN ('queued', 'processing', 'retryable_failed')");
    expect(normalizedSql).toContain("l.notification_type = 'challenge_result_survey'");
  });
});
