import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const rootMigrationsDir = path.join(repoRoot, 'migrations');
const supabaseMigrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const allowlistPath = path.join(rootMigrationsDir, 'ROOT_SQL_ALLOWLIST.txt');

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

if (canonicalSqlFiles.length === 0) {
  exitWithError('No SQL files found in `supabase/migrations/`.');
}

console.log(`[migrations:guard] OK. Canonical migrations in supabase/migrations: ${canonicalSqlFiles.length} files.`);
