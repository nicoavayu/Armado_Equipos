const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260622160000_drop_global_storage_policies.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();

// Code with SQL line comments stripped, so the explanatory header prose (which
// names the scoped Phase 1 policies, team-crests, compute_awards_for_match,
// etc.) does not trip the "does not drop / does not touch X" assertions.
// Mirrors the storageScopedPolicies / revokeAnonInternalFuncs test style.
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

// Every executable DROP POLICY statement in this migration (comments stripped).
const dropPolicyBlocks = code
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.startsWith('DROP POLICY'));

const GLOBAL_POLICIES = [
  'Public access for upload and download yw9jo2_0',
  'Public access for upload and download yw9jo2_1',
  'Public access for upload and download yw9jo2_2',
  'Public access for upload and download yw9jo2_3',
];

const PROTECTED_POLICIES = [
  'avatars_public_read',
  'jugadores_fotos_public_read',
  'jugadores_fotos_anon_authenticated_insert',
  'jugadores_fotos_anon_authenticated_update',
  'team_crests_public_read',
  'team_crests_insert_owner_folder',
  'team_crests_update_owner_folder',
  'team_crests_delete_owner_folder',
];

describe('drop global storage policies migration (Phase 2)', () => {
  test('drops exactly the four dangerous global policies and nothing else', () => {
    expect(dropPolicyBlocks).toHaveLength(4);
    GLOBAL_POLICIES.forEach((name) => {
      expect(code).toContain(
        `DROP POLICY IF EXISTS "${name}" ON storage.objects`,
      );
    });
  });

  test('every drop is idempotent (IF EXISTS) and scoped to storage.objects', () => {
    dropPolicyBlocks.forEach((block) => {
      expect(block).toContain('DROP POLICY IF EXISTS');
      expect(block).toContain('ON storage.objects');
    });
  });

  test('does NOT drop the four scoped Phase 1 policies', () => {
    // Phase 1 (jugadores-fotos guest flow + avatars read) must keep working.
    [
      'avatars_public_read',
      'jugadores_fotos_public_read',
      'jugadores_fotos_anon_authenticated_insert',
      'jugadores_fotos_anon_authenticated_update',
    ].forEach((name) => {
      expect(code).not.toContain(name);
    });
  });

  test('does NOT drop the team-crests owner-folder policies', () => {
    [
      'team_crests_public_read',
      'team_crests_insert_owner_folder',
      'team_crests_update_owner_folder',
      'team_crests_delete_owner_folder',
    ].forEach((name) => {
      expect(code).not.toContain(name);
    });
    expect(code).not.toContain('team-crests');
    expect(code).not.toContain('team_crests');
  });

  test('every protected policy is left untouched', () => {
    PROTECTED_POLICIES.forEach((name) => {
      expect(code).not.toContain(name);
    });
  });

  test('does NOT create any new policy', () => {
    expect(code).not.toContain('CREATE POLICY');
  });

  test('does NOT touch RPCs, function grants or compute_awards_for_match', () => {
    expect(code).not.toContain('FUNCTION');
    expect(code).not.toContain('GRANT');
    expect(code).not.toContain('REVOKE');
    expect(code).not.toContain('compute_awards_for_match');
  });

  test('does NOT touch public-schema tables (no table policies / DML / DDL)', () => {
    expect(code).not.toContain('ON public.');
    expect(code).not.toContain('ALTER TABLE');
    expect(code).not.toMatch(/\b(INSERT INTO|UPDATE |DELETE FROM)\b/);
    // Public join / voting / roster / notifications tables are never referenced.
    ['partidos', 'jugadores', 'votos', 'usuarios', 'public_voters', 'notifications'].forEach(
      (table) => {
        expect(code).not.toContain(table);
      },
    );
  });

  test('wraps the changes in a single transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });
});
