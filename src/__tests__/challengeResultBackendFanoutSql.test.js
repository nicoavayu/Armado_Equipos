const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260616120000_challenge_result_survey_backend_fanout.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('challenge result backend fanout migration', () => {
  test('adds a dedicated backend scheduler function and cron job', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.process_challenge_result_survey_notifications_backend');
    expect(normalizedSql).toContain('process_challenge_result_survey_notifications_backend(200)');
    expect(normalizedSql).toContain('challenge_result_survey_backend_fanout');
    expect(normalizedSql).toContain("'* * * * *'");
  });

  test('selects only eligible accepted past challenge matches without loaded results', () => {
    expect(normalizedSql).toContain('tm.challenge_id IS NOT NULL');
    expect(normalizedSql).toContain('c.accepted_team_id IS NOT NULL');
    expect(normalizedSql).toContain('tm.team_a_id = c.challenger_team_id');
    expect(normalizedSql).toContain('tm.team_b_id = c.accepted_team_id');
    expect(normalizedSql).toContain('COALESCE(tm.scheduled_at, tm.played_at, c.scheduled_at) <= now()');
    expect(normalizedSql).toContain("lower(COALESCE(c.status, '')) IN ('accepted', 'confirmed', 'completed')");
    expect(normalizedSql).toContain("lower(COALESCE(tm.status, '')) IN ('accepted', 'confirmed', 'played', 'completed')");
    expect(normalizedSql).toContain("lower(COALESCE(c.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'rejected')");
    expect(normalizedSql).toContain('tm.result_status IS NULL');
  });

  test('generates only one notification per user and team match', () => {
    expect(normalizedSql).toContain("pg_advisory_xact_lock(hashtext('challenge_result_survey_backend_fanout'))");
    expect(normalizedSql).toContain('SELECT DISTINCT ON (e.team_match_id, r.user_id)');
    expect(normalizedSql).toContain("existing.user_id = r.user_id AND existing.type = 'challenge_result_survey'");
    expect(normalizedSql).toContain("COALESCE(existing.data ->> 'team_match_id', existing.data ->> 'teamMatchId') = e.team_match_id::text");
    expect(normalizedSql).toContain('ON CONFLICT DO NOTHING');
  });

  test('targets only owner, admin, or captain-style users from both teams', () => {
    expect(normalizedSql).toContain('t.owner_user_id AS user_id');
    expect(normalizedSql).toContain('tm.user_id AS user_id');
    expect(normalizedSql).toContain('j.usuario_id AS user_id');
    expect(normalizedSql).toContain('COALESCE(tm.is_captain, false) = true');
    expect(normalizedSql).toContain("lower(COALESCE(tm.permissions_role, '')) IN ('owner', 'admin')");
  });

  test('creates the required copy, route, and push payload', () => {
    expect(normalizedSql).toContain("'challenge_result_survey'");
    expect(normalizedSql).toContain("'Resultado pendiente'");
    expect(normalizedSql).toContain("'¿Cómo salió el desafío vs '");
    expect(normalizedSql).toContain("'action', 'open_challenge_result_modal'");
    expect(normalizedSql).toContain("'/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal'");
    expect(normalizedSql).toContain("'notification_type', 'challenge_result_survey'");
    expect(normalizedSql).toContain("'event_channel', 'ACTION'");
  });

  test('queues real push delivery through notification_delivery_log', () => {
    expect(normalizedSql).toContain('INSERT INTO public.notification_delivery_log');
    expect(normalizedSql).toContain("'push'");
    expect(normalizedSql).toContain("'queued'");
    expect(normalizedSql).toContain("'source', 'backend_scheduler'");
  });

  test('resolves stale challenge result prompts after a result is loaded', () => {
    expect(normalizedSql).toContain('WITH stale_notifications AS');
    expect(normalizedSql).toContain('tm.result_status IS NOT NULL');
    expect(normalizedSql).toContain('read = true');
    expect(normalizedSql).toContain("status = 'resolved'");
  });
});
