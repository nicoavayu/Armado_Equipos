const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260622140000_revoke_anon_internal_funcs.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();

// Code with SQL line comments stripped, so the explanatory header prose (which
// names compute_awards_for_match and the public guest RPCs) does not trip the
// "does not touch X" assertions. Mirrors paymentReminderPushChannel test style.
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

describe('revoke anon access from internal functions migration', () => {
  test('revokes EXECUTE on fanout_survey_start_notifications() from PUBLIC, anon, authenticated', () => {
    ['PUBLIC', 'anon', 'authenticated'].forEach((role) => {
      expect(normalized).toContain(
        `REVOKE EXECUTE ON FUNCTION public.fanout_survey_start_notifications() FROM ${role}`,
      );
    });
  });

  test('re-grants fanout_survey_start_notifications() to service_role', () => {
    expect(normalized).toContain(
      'GRANT EXECUTE ON FUNCTION public.fanout_survey_start_notifications() TO service_role',
    );
  });

  test('revokes EXECUTE on cleanup_voting_access_state(bigint) from PUBLIC and anon', () => {
    ['PUBLIC', 'anon'].forEach((role) => {
      expect(normalized).toContain(
        `REVOKE EXECUTE ON FUNCTION public.cleanup_voting_access_state(bigint) FROM ${role}`,
      );
    });
  });

  test('keeps cleanup_voting_access_state(bigint) granted to authenticated and service_role', () => {
    expect(normalized).toContain(
      'GRANT EXECUTE ON FUNCTION public.cleanup_voting_access_state(bigint) TO authenticated, service_role',
    );
  });

  test('does NOT revoke or alter compute_awards_for_match', () => {
    expect(code).not.toContain('compute_awards_for_match');
  });

  test('does NOT touch the public guest-flow RPCs', () => {
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

  test('does NOT touch storage or broad RLS policies', () => {
    expect(code).not.toContain('storage.objects');
    expect(code).not.toContain('CREATE POLICY');
    expect(code).not.toContain('ALTER POLICY');
    expect(code).not.toContain('DROP POLICY');
  });

  test('wraps the changes in a single transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });
});
