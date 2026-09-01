const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveMigrationPath } = require('./resolve_migration_path.cjs');

const createFixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-migration-path-'));
  fs.mkdirSync(path.join(root, 'supabase', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(root, 'supabase', 'migrations_history'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('resolves an active migration from supabase/migrations', (t) => {
  const root = createFixture(t);
  const file = '20260806120000_active.sql';
  const expected = path.join(root, 'supabase', 'migrations', file);
  fs.writeFileSync(expected, '-- active\n');

  assert.equal(resolveMigrationPath(root, file), expected);
});

test('resolves an archived migration from supabase/migrations_history', (t) => {
  const root = createFixture(t);
  const file = '20260716120000_historical.sql';
  const expected = path.join(root, 'supabase', 'migrations_history', file);
  fs.writeFileSync(expected, '-- historical\n');

  assert.equal(resolveMigrationPath(root, file), expected);
});

test('fails explicitly when a migration does not exist', (t) => {
  const root = createFixture(t);

  assert.throws(
    () => resolveMigrationPath(root, '20990101000000_missing.sql'),
    /Missing migration in active and history/,
  );
});

test('rejects an ambiguous migration present in active and history', (t) => {
  const root = createFixture(t);
  const file = '20260806120000_duplicated.sql';
  fs.writeFileSync(path.join(root, 'supabase', 'migrations', file), '-- active\n');
  fs.writeFileSync(path.join(root, 'supabase', 'migrations_history', file), '-- historical\n');

  assert.throws(
    () => resolveMigrationPath(root, file),
    /Ambiguous migration found in active and history/,
  );
});

test('rejects paths instead of traversing arbitrary directories', (t) => {
  const root = createFixture(t);

  assert.throws(
    () => resolveMigrationPath(root, '../outside.sql'),
    /Invalid migration filename/,
  );
});
