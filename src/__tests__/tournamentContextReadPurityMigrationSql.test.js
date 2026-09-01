import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260801090000_tournament_context_reads_are_pure.sql',
);
const baselinePath = path.join(
  process.cwd(),
  'supabase/migrations/20260727090000_arma2_canonical_baseline.sql',
);
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
const baselineSql = fs.readFileSync(baselinePath, 'utf8');

function functionDefinition(sql, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `create or replace function [^\\n]*[".]${escapedName}["(][\\s\\S]*?\\$\\$;`,
    'ig',
  );
  const matches = [...sql.matchAll(pattern)];
  if (matches.length === 0) {
    throw new Error(`Missing SQL definition for ${name}`);
  }
  return matches.at(-1)[0];
}

const getters = [
  'get_tournament_workspace_context',
  'get_tournament_competition_context',
];
const readOnlyHelpers = [
  'has_tournament_organization_capability',
  'tournament_role_capabilities',
  'tournament_registration_checklist',
];
const writeStatement = /\b(insert\s+into|update\s+|delete\s+from|merge\s+into|truncate\s+|execute\s+)/i;

describe('tournament context getter purity migration', () => {
  test.each(getters)('%s is a stable, hardened, direct read', (name) => {
    const definition = functionDefinition(migrationSql, name);

    expect(definition).toMatch(/language\s+"?plpgsql"?\s+stable\s+security\s+definer/i);
    expect(definition).toMatch(/set\s+"?search_path"?\s+to\s+''/i);
    expect(definition).not.toMatch(writeStatement);
    expect(definition).not.toMatch(/\bset_(tournament_workspace_preference|active_tournament_context)\s*\(/i);
  });

  test.each(readOnlyHelpers)('%s keeps the obvious helper chain read-only', (name) => {
    const definition = functionDefinition(baselineSql, name);

    expect(definition).toMatch(/\b(stable|immutable)\b/i);
    expect(definition).not.toMatch(writeStatement);
  });

  test('keeps the public JSON field contract and explicit setters intact', () => {
    const workspace = functionDefinition(
      migrationSql,
      'get_tournament_workspace_context',
    );
    const competition = functionDefinition(
      migrationSql,
      'get_tournament_competition_context',
    );

    [
      'workspaceType',
      'activeOrganizationId',
      'updatedAt',
      'organizations',
    ].forEach((field) => expect(workspace).toContain(`'${field}'`));
    [
      'organizationId',
      'activeSeasonId',
      'activeTournamentId',
      'updatedAt',
      'seasons',
      'tournaments',
      'modalities',
      'formats',
    ].forEach((field) => expect(competition).toContain(`'${field}'`));

    expect(migrationSql).not.toMatch(/create\s+or\s+replace\s+function[^\n]*set_tournament_workspace_preference/i);
    expect(migrationSql).not.toMatch(/create\s+or\s+replace\s+function[^\n]*set_active_tournament_context/i);
  });

  test('uses complete deterministic fallback ordering', () => {
    const competition = functionDefinition(
      migrationSql,
      'get_tournament_competition_context',
    );

    expect(competition).toMatch(/order by tournament\.updated_at desc, tournament\.id/i);
    expect(competition).toMatch(/order by season\.updated_at desc, season\.id/i);
  });

  test('applies both replacements atomically without grant or owner churn', () => {
    expect(migrationSql.trim()).toMatch(/^--[\s\S]*\bBEGIN;/i);
    expect(migrationSql.trim()).toMatch(/COMMIT;$/i);
    expect(migrationSql).not.toMatch(/\b(grant|revoke|alter\s+function\s+.*owner)\b/i);
    expect(migrationSql).not.toMatch(/\b(create|alter|drop)\s+policy\b/i);
    expect(migrationSql).not.toMatch(/\balter\s+table\b/i);
  });
});
