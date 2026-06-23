const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
);

const migrationPath = path.join(
  migrationsDir,
  '20260623120000_reset_voting_rebuild_current_roster_notifications.sql',
);
const notificationDedupeIndexPath = path.join(migrationsDir, 'add_surveys_sent_column.sql');

const sql = fs.readFileSync(migrationPath, 'utf8');
const notificationDedupeIndexSql = fs.readFileSync(notificationDedupeIndexPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();
const normalizedNotificationDedupeIndexSql = notificationDedupeIndexSql.replace(/\s+/g, ' ').trim();
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

describe('reset_votacion current-roster notification rebuild migration', () => {
  test('keeps reset_votacion admin-only and unavailable to anon', () => {
    expect(normalized).toContain('v_uid uuid := auth.uid()');
    expect(normalized).toContain('v_admin_id IS DISTINCT FROM v_uid');
    expect(normalized).toContain("USING ERRCODE = '42501'");
    expect(normalized).toContain('REVOKE ALL ON FUNCTION public.reset_votacion(bigint) FROM PUBLIC');
    expect(normalized).toContain('REVOKE ALL ON FUNCTION public.reset_votacion(bigint) FROM anon');
    expect(normalized).toContain('GRANT EXECUTE ON FUNCTION public.reset_votacion(bigint) TO authenticated, service_role');
  });

  test('cleans prior voting access rows before rebuilding notifications', () => {
    const cleanupIndex = normalized.indexOf('PERFORM public.cleanup_voting_access_state(match_id)');
    const rebuildIndex = normalized.indexOf('rebuilt_vote_notifications AS');

    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(rebuildIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(rebuildIndex);
    expect(normalized).toContain('DELETE FROM public.votos WHERE partido_id = match_id');
    expect(normalized).toContain('DELETE FROM public.votos_publicos WHERE partido_id = match_id');
    expect(normalized).toContain('DELETE FROM public.public_voters WHERE partido_id = match_id');
  });

  test('uses current jugadores roster as the recipient source, not previous votes or teams', () => {
    expect(normalized).toContain('WITH current_roster AS ( SELECT DISTINCT j.usuario_id AS user_id FROM public.jugadores j');
    expect(normalized).toContain('WHERE j.partido_id = match_id AND j.usuario_id IS NOT NULL AND COALESCE(j.is_substitute, false) = false');
    expect(normalized).toContain('FROM current_roster r');
    expect(code).not.toContain('resolve_partido_survey_notification_recipients');
    expect(code).not.toContain('partido_team_confirmations');
    expect(code).not.toContain('survey_team_a');
    expect(code).not.toContain('final_team_a');
  });

  test('rebuilds call_to_vote rows for exactly the current registered voter roster', () => {
    expect(normalized).toContain("'call_to_vote'");
    expect(normalized).toContain("'match_id', match_id::text");
    expect(normalized).toContain("'matchId', match_id");
    expect(normalized).toContain("'matchCode', v_match_code");
    expect(normalized).toContain('read, created_at, send_at');
  });

  test('does not duplicate reset notifications when reset runs repeatedly', () => {
    expect(normalized).toContain("ON CONFLICT (user_id, (data ->> 'match_id'), type)");
    expect(normalized).toContain('DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, partido_id = EXCLUDED.partido_id, data = EXCLUDED.data, read = false, send_at = now()');
  });

  test('has the unique JSONB expression index required by the ON CONFLICT target', () => {
    expect(normalizedNotificationDedupeIndexSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uniq_notif_user_match_type ON public\.notifications \(user_id, \(data\s*->>\s*'match_id'\), type\)/i,
    );
    expect(normalized).toContain("ON CONFLICT (user_id, (data ->> 'match_id'), type)");
  });

  test('keeps public voting link/code open without changing public guest RPCs', () => {
    expect(normalized).toContain('public_voting_marker AS');
    expect(normalized).toContain("'pre_match_vote'");
    expect(normalized).toContain('WHERE NOT EXISTS (SELECT 1 FROM current_roster)');
    expect(normalized).toContain('read = true');
    [
      'resolve_match_by_code',
      'get_partido_by_invite',
      'public_get_or_create_voter',
      'public_submit_player_rating',
      'public_submit_no_lo_conozco',
      'public_mark_voter_completed',
      'public_has_voter_already_voted',
      'validate_guest_match_invite',
    ].forEach((fn) => expect(code).not.toContain(fn));
  });

  test('does not touch storage, broad policies, ranking, teams, payments, versions, or release code', () => {
    [
      'storage.objects',
      'CREATE POLICY',
      'ALTER POLICY',
      'DROP POLICY',
      'ranking',
      'team_rankings',
      'payments',
      'version',
      'release',
    ].forEach((term) => expect(code).not.toContain(term));
  });
});
