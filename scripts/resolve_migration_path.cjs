const fs = require('node:fs');
const path = require('node:path');

const resolveMigrationPath = (repoRoot, migrationFile) => {
  if (
    typeof migrationFile !== 'string'
    || !migrationFile.endsWith('.sql')
    || migrationFile.length === 0
    || /[\\/]/.test(migrationFile)
  ) {
    throw new Error(`Invalid migration filename: ${String(migrationFile)}`);
  }

  const candidates = [
    path.join(repoRoot, 'supabase', 'migrations', migrationFile),
    path.join(repoRoot, 'supabase', 'migrations_history', migrationFile),
  ];
  const matches = candidates.filter((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  if (matches.length > 1) {
    throw new Error(`Ambiguous migration found in active and history: ${migrationFile}`);
  }
  if (matches.length === 0) {
    throw new Error(`Missing migration in active and history: ${migrationFile}`);
  }

  return matches[0];
};

module.exports = { resolveMigrationPath };
