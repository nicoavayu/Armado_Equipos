const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260622150000_storage_scoped_policies.sql',
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim();

// Code with SQL line comments stripped, so the explanatory header prose (which
// names the global policies, team-crests, compute_awards_for_match, etc.) does
// not trip the "does not touch / does not drop X" assertions. Mirrors the
// revokeAnonInternalFuncs test style.
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

// Every executable CREATE POLICY statement in this migration (comments stripped).
const createPolicyBlocks = code
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.startsWith('CREATE POLICY'));

describe('storage scoped policies migration (Phase 1, additive)', () => {
  test('creates exactly the four scoped policies and nothing else', () => {
    expect(createPolicyBlocks).toHaveLength(4);
  });

  test('adds a public read policy for avatars', () => {
    expect(normalized).toContain('CREATE POLICY avatars_public_read');
    const block = createPolicyBlocks.find((b) =>
      b.startsWith('CREATE POLICY avatars_public_read'),
    );
    expect(block).toBeDefined();
    expect(block).toContain('FOR SELECT');
    expect(block).toContain('TO public');
    expect(block).toContain("bucket_id = 'avatars'");
  });

  test('adds a public read policy for jugadores-fotos', () => {
    expect(normalized).toContain('CREATE POLICY jugadores_fotos_public_read');
    const block = createPolicyBlocks.find((b) =>
      b.startsWith('CREATE POLICY jugadores_fotos_public_read'),
    );
    expect(block).toBeDefined();
    expect(block).toContain('FOR SELECT');
    expect(block).toContain('TO public');
    expect(block).toContain("bucket_id = 'jugadores-fotos'");
  });

  test('adds an anon+authenticated INSERT policy for jugadores-fotos', () => {
    expect(normalized).toContain(
      'CREATE POLICY jugadores_fotos_anon_authenticated_insert',
    );
    const block = createPolicyBlocks.find((b) =>
      b.startsWith('CREATE POLICY jugadores_fotos_anon_authenticated_insert'),
    );
    expect(block).toBeDefined();
    expect(block).toContain('FOR INSERT');
    expect(block).toContain('TO anon, authenticated');
    expect(block).toContain("WITH CHECK (bucket_id = 'jugadores-fotos')");
  });

  test('adds an anon+authenticated UPDATE policy for jugadores-fotos', () => {
    expect(normalized).toContain(
      'CREATE POLICY jugadores_fotos_anon_authenticated_update',
    );
    const block = createPolicyBlocks.find((b) =>
      b.startsWith('CREATE POLICY jugadores_fotos_anon_authenticated_update'),
    );
    expect(block).toBeDefined();
    expect(block).toContain('FOR UPDATE');
    expect(block).toContain('TO anon, authenticated');
    expect(block).toContain("USING (bucket_id = 'jugadores-fotos')");
    expect(block).toContain("WITH CHECK (bucket_id = 'jugadores-fotos')");
  });

  test('does NOT add any DELETE policy (no delete flow exists)', () => {
    createPolicyBlocks.forEach((block) => {
      expect(block).not.toContain('FOR DELETE');
    });
  });

  test('avatars is read-only: no new INSERT/UPDATE/DELETE for it', () => {
    const avatarsBlocks = createPolicyBlocks.filter((b) =>
      b.includes("bucket_id = 'avatars'"),
    );
    expect(avatarsBlocks).toHaveLength(1);
    expect(avatarsBlocks[0]).toContain('FOR SELECT');
    expect(avatarsBlocks[0]).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });

  test('drops the three dead legacy JPG-folder policies', () => {
    ['yw9jo2_0', 'yw9jo2_1', 'yw9jo2_2'].forEach((suffix) => {
      expect(code).toContain(
        `DROP POLICY IF EXISTS "Give anon users access to JPG images in folder ${suffix}" ON storage.objects`,
      );
    });
  });

  test('does NOT drop the four dangerous global policies (deferred to Phase 2)', () => {
    // The global names appear only in explanatory comments, never in an
    // executable DROP, so the comment-stripped code must not mention them.
    for (let i = 0; i <= 3; i += 1) {
      expect(code).not.toContain(`Public access for upload and download yw9jo2_${i}`);
    }
  });

  test('does NOT touch team-crests (its policies live elsewhere)', () => {
    expect(code).not.toContain('team-crests');
    expect(code).not.toContain('team_crests');
  });

  test('only touches storage.objects', () => {
    [...createPolicyBlocks].forEach((block) => {
      expect(block).toContain('ON storage.objects');
    });
    // No table policies on the public schema.
    expect(code).not.toContain('ON public.');
  });

  test('does NOT touch RPCs, function grants or compute_awards_for_match', () => {
    expect(code).not.toContain('FUNCTION');
    expect(code).not.toContain('GRANT EXECUTE');
    expect(code).not.toContain('REVOKE');
    expect(code).not.toContain('compute_awards_for_match');
  });

  test('wraps the changes in a single transaction', () => {
    expect(normalized).toContain('BEGIN;');
    expect(normalized).toContain('COMMIT;');
  });
});
