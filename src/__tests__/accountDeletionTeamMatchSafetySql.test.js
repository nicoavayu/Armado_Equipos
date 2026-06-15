const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260615170000_account_deletion_team_match_safety.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim();
// Executable SQL only (drop `--` comment lines), used for assertions that must
// ignore the explanatory header.
const codeOnlySql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

describe('account deletion team_match safety migration', () => {
  test('runs inside a single transaction', () => {
    expect(normalizedSql.startsWith('-- ')).toBe(true);
    expect(normalizedSql).toContain('BEGIN;');
    expect(normalizedSql).toContain('COMMIT;');
  });

  test('makes every user reference nullable so a detached account leaves NULL', () => {
    for (const entry of [
      ['teams', 'owner_user_id'],
      ['challenges', 'created_by_user_id'],
      ['challenges', 'accepted_by_user_id'],
      ['team_members', 'user_id'],
      ['team_chat_messages', 'user_id'],
      ['challenge_team_squad', 'selected_by'],
    ]) {
      expect(normalizedSql).toContain(`'${entry[0]}', '${entry[1]}',`);
    }
    expect(normalizedSql).toContain('ALTER COLUMN %I DROP NOT NULL');
  });

  test('re-points auth.users references to ON DELETE SET NULL', () => {
    expect(normalizedSql).toContain("'teams_owner_user_id_fkey',");
    expect(normalizedSql).toContain("'challenges_created_by_user_id_fkey',");
    expect(normalizedSql).toContain("'challenges_accepted_by_user_id_fkey',");
    expect(normalizedSql).toContain("'auth', 'users', 'id'");
    expect(normalizedSql).toContain("'SET NULL'");
  });

  test('covers usuarios references in the team module', () => {
    expect(normalizedSql).toContain("'team_members_user_id_fkey',");
    expect(normalizedSql).toContain("'team_chat_messages_user_id_fkey',");
    expect(normalizedSql).toContain("'challenge_team_squad_selected_by_fkey',");
    expect(normalizedSql).toContain("'public', 'usuarios', 'id'");
  });

  test('keeps the new manual-result team reference safe (SET NULL to teams)', () => {
    expect(normalizedSql).toContain("'team_matches_result_reported_by_team_id_fkey',");
    expect(normalizedSql).toContain("'result_reported_by_team_id',");
  });

  test('is idempotent: drops existing FK by discovery before recreating', () => {
    expect(normalizedSql).toContain('DROP CONSTRAINT IF EXISTS');
    expect(normalizedSql).toContain('con.contype = \'f\'');
    expect(normalizedSql).toContain('ADD CONSTRAINT %I FOREIGN KEY');
  });

  test('preserves match history: never weakens team_matches team_a/team_b FKs', () => {
    // Those stay ON DELETE RESTRICT; the migration must not touch them, otherwise
    // a deleted team could orphan matches and corrupt head-to-head history.
    expect(codeOnlySql).not.toContain('team_a_id');
    expect(codeOnlySql).not.toContain('team_b_id');
  });

  test('guards against missing tables/columns across environments', () => {
    expect(normalizedSql).toContain('to_regclass(format(\'public.%I\', v_ref.table_name)) IS NULL');
    expect(normalizedSql).toContain('information_schema.columns');
    expect(normalizedSql).toContain('CONTINUE;');
  });
});
