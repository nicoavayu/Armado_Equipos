const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260617121000_team_country_code.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();

describe('teams.country_code migration', () => {
  test('adds country_code char(2) NOT NULL DEFAULT AR with ISO check', () => {
    expect(normalizedSql).toContain("ADD COLUMN IF NOT EXISTS country_code char(2) NOT NULL DEFAULT 'AR'");
    expect(normalizedSql).toContain('teams_country_code_check');
    expect(normalizedSql).toContain("CHECK (country_code ~ '^[A-Z]{2}$')");
  });

  test('both ranking RPCs are dropped + recreated exposing country_code', () => {
    expect(normalizedSql).toContain('DROP FUNCTION IF EXISTS public.rpc_get_team_challenge_rankings(text, text, text, int, text)');
    expect(normalizedSql).toContain('DROP FUNCTION IF EXISTS public.rpc_search_challengeable_teams(text, text, text, int)');
    // country_code present in RETURNS TABLE (twice: ranking + directory)
    const returnsCountry = (normalizedSql.match(/country_code text/g) || []).length;
    expect(returnsCountry).toBeGreaterThanOrEqual(2);
    // selected from the teams row in both
    const selectCountry = (normalizedSql.match(/t\.country_code::text/g) || []).length;
    expect(selectCountry).toBeGreaterThanOrEqual(2);
  });

  test('re-grants execute to authenticated/service_role', () => {
    expect(normalizedSql).toContain('GRANT EXECUTE ON FUNCTION public.rpc_get_team_challenge_rankings(text, text, text, int, text) TO authenticated, service_role');
    expect(normalizedSql).toContain('GRANT EXECUTE ON FUNCTION public.rpc_search_challengeable_teams(text, text, text, int) TO authenticated, service_role');
  });
});
