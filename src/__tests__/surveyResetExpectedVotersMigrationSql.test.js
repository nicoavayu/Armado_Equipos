const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260616180000_fix_survey_reset_expected_voters_not_null.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('survey schedule-change reset migration', () => {
  test('redefines the schedule-change reset trigger function', () => {
    expect(normalizedSql).toContain(
      'CREATE OR REPLACE FUNCTION public.trg_reset_survey_window_on_schedule_change()',
    );
  });

  test('resets survey_expected_voters to 0, never NULL (NOT NULL column)', () => {
    expect(normalizedSql).toContain('NEW.survey_expected_voters := 0;');
    expect(normalizedSql).not.toContain('NEW.survey_expected_voters := NULL;');
  });

  test('keeps resetting the rest of the survey window so reschedules reopen it', () => {
    expect(normalizedSql).toContain("NEW.survey_status := 'open';");
    expect(normalizedSql).toContain('NEW.surveys_sent := false;');
    expect(normalizedSql).toContain('NEW.survey_opened_at := NULL;');
    expect(normalizedSql).toContain('NEW.survey_closes_at := NULL;');
  });
});
