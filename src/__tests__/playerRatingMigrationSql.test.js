import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260703052313_enforce_player_rating_max_five.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('player rating database invariant migration', () => {
  test('new users default to 5.0', () => {
    expect(sql).toMatch(/ALTER COLUMN ranking SET DEFAULT 5\.0/i);
    expect(sql).toMatch(/avatar_url,\s*5\.0,\s*0,/i);
  });

  test('legacy overflow is normalized and future writes are capped', () => {
    expect(sql).toMatch(/SET ranking = 5\.0\s*WHERE ranking > 5\.0/i);
    expect(sql).toMatch(/NEW\.ranking := LEAST\(COALESCE\(NEW\.ranking, 5\.0\), 5\.0\)/i);
    expect(sql).toMatch(/CHECK \(ranking IS NULL OR ranking <= 5\.0\)/i);
  });
});
