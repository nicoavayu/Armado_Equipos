import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const rootMigrationsDir = path.join(repoRoot, 'migrations');
const supabaseMigrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const allowlistPath = path.join(rootMigrationsDir, 'ROOT_SQL_ALLOWLIST.txt');
const expectedCanonicalMigrations = [
  '20260727090000_arma2_canonical_baseline.sql',
  '20260727215106_canonical_core_rls_contracts.sql',
  '20260801090000_tournament_context_reads_are_pure.sql',
  '20260802090000_tournament_media_upload_pipeline.sql',
  '20260802120000_tournament_media_trusted_processing.sql',
  '20260803090000_tournament_social_studio.sql',
  '20260809232508_tournament_media_free_mvp.sql',
];

const exitWithError = (message) => {
  console.error(`[migrations:guard] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(rootMigrationsDir)) {
  exitWithError('Missing `migrations/` directory.');
}

if (!fs.existsSync(supabaseMigrationsDir)) {
  exitWithError('Missing `supabase/migrations/` directory.');
}

if (!fs.existsSync(allowlistPath)) {
  exitWithError('Missing `migrations/ROOT_SQL_ALLOWLIST.txt` allowlist file.');
}

const allowlist = new Set(
  fs.readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#')),
);

const rootSqlFiles = fs.readdirSync(rootMigrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const unexpectedRootSql = rootSqlFiles.filter((file) => !allowlist.has(file));
if (unexpectedRootSql.length > 0) {
  exitWithError(
    [
      'Detected new SQL files under `migrations/` (legacy archive).',
      'Add new migrations only under `supabase/migrations/`.',
      `Unexpected files: ${unexpectedRootSql.join(', ')}`,
    ].join(' '),
  );
}

const canonicalSqlFiles = fs.readdirSync(supabaseMigrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (
  canonicalSqlFiles.length !== expectedCanonicalMigrations.length
  || canonicalSqlFiles.some(
    (file, index) => file !== expectedCanonicalMigrations[index],
  )
) {
  exitWithError(
    [
      'Canonical migration set must contain exactly the approved files.',
      `Expected: ${expectedCanonicalMigrations.join(', ')}`,
      `Found: ${canonicalSqlFiles.join(', ') || '(none)'}`,
    ].join(' '),
  );
}

console.log('[migrations:guard] OK. Exactly the approved canonical migrations are present.');
