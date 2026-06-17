const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260617122000_team_challenge_push_channels.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('team challenge push channels migration', () => {
  test('maps the 3 new types to push-allowed channels', () => {
    expect(normalizedSql).toContain('CREATE OR REPLACE FUNCTION public.notification_event_channel(');
    expect(normalizedSql).toContain("WHEN 'team_challenge_received' THEN RETURN 'INVITATION'");
    expect(normalizedSql).toContain("WHEN 'team_challenge_accepted' THEN RETURN 'ACCEPTED'");
    expect(normalizedSql).toContain("WHEN 'team_challenge_rejected' THEN RETURN 'SOCIAL'");
  });

  test('does not route them through MATCH_UPDATE (which is gated for team_challenge)', () => {
    expect(normalizedSql).not.toContain("WHEN 'team_challenge_received' THEN RETURN 'MATCH_UPDATE'");
    expect(normalizedSql).not.toContain("WHEN 'team_challenge_accepted' THEN RETURN 'MATCH_UPDATE'");
    expect(normalizedSql).not.toContain("WHEN 'team_challenge_rejected' THEN RETURN 'MATCH_UPDATE'");
  });

  test('keeps prior mappings (verbatim) so nothing regresses', () => {
    expect(normalizedSql).toContain("WHEN 'friend_request' THEN RETURN 'INVITATION'");
    expect(normalizedSql).toContain("WHEN 'match_update' THEN RETURN 'MATCH_UPDATE'");
    expect(normalizedSql).toContain("ELSE RETURN 'INFO'");
  });
});
