const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260620140000_payment_reminder_push_channel.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('payment reminder push channel migration', () => {
  test('redefines notification_event_channel', () => {
    expect(normalized).toContain('CREATE OR REPLACE FUNCTION public.notification_event_channel');
  });

  test('maps payment_reminder to the push-allowed REMINDER channel', () => {
    expect(normalized).toContain("WHEN 'payment_reminder' THEN RETURN 'REMINDER'");
  });

  test('keeps existing channel branches intact (no regressions)', () => {
    [
      "WHEN 'match_invite' THEN RETURN 'INVITATION'",
      "WHEN 'survey_results_ready' THEN RETURN 'SURVEY_RESULTS'",
      "WHEN 'awards_ready' THEN RETURN 'AWARDS_READY'",
      "WHEN 'match_update' THEN RETURN 'MATCH_UPDATE'",
      "WHEN 'team_challenge_received' THEN RETURN 'INVITATION'",
    ].forEach((branch) => expect(normalized).toContain(branch));
  });

  test('only redefines the channel function — no cron / http / edge-function DDL', () => {
    // Strip SQL line comments so the explanatory header (which mentions the
    // scheduler in prose) doesn't trip these assertions.
    const code = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(code).not.toContain('cron.schedule');
    expect(code).not.toContain('net.http_post');
    expect(code).not.toContain('functions.invoke');
    expect(code).not.toContain('CREATE TRIGGER');
  });
});
