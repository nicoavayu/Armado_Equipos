import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardPath = path.join(repoRoot, 'scripts', 'guard_migration_source.mjs');
const autoMatchMigration = '20260806120000_auto_match_stop_search_atomic_exit.sql';
const contractRepairMigration = '20260831034314_restore_current_product_contracts.sql';
const mediaSessionReuseMigration = '20260831163520_fix_tournament_media_session_reuse.sql';
const globalAvailabilityMigration = '20260831200904_global_availability_atomic_contract.sql';
const approvedMigrations = fs.readdirSync(path.join(repoRoot, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort();

const createFixture = (migrationFiles) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-migrations-guard-'));
  const legacyDir = path.join(fixtureRoot, 'migrations');
  const canonicalDir = path.join(fixtureRoot, 'supabase', 'migrations');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'ROOT_SQL_ALLOWLIST.txt'), '# fixture\n');
  for (const file of migrationFiles) {
    fs.writeFileSync(path.join(canonicalDir, file), '-- fixture\n');
  }
  return fixtureRoot;
};

const runGuard = (cwd) => spawnSync(process.execPath, [guardPath], {
  cwd,
  encoding: 'utf8',
});

test('accepts the closed set including Auto-Match, contract repair and global availability', (t) => {
  assert.equal(approvedMigrations.length, 40);
  assert.ok(approvedMigrations.includes(autoMatchMigration));
  assert.ok(approvedMigrations.includes(contractRepairMigration));
  assert.ok(approvedMigrations.includes(mediaSessionReuseMigration));
  assert.ok(approvedMigrations.includes(globalAvailabilityMigration));
  assert.equal(
    approvedMigrations.filter(
      (file) => file !== autoMatchMigration
        && file !== contractRepairMigration
        && file !== globalAvailabilityMigration,
    ).length,
    37,
  );

  const fixtureRoot = createFixture(approvedMigrations);
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runGuard(fixtureRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Exactly the approved canonical migrations are present/);
});

test('rejects a migration outside the closed approved set', (t) => {
  const unexpectedMigration = '20990101000000_unapproved_fixture.sql';
  const fixtureRoot = createFixture([...approvedMigrations, unexpectedMigration]);
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runGuard(fixtureRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Canonical migration set must contain exactly the approved files/);
  assert.match(result.stderr, new RegExp(unexpectedMigration));
});

test('does not accept an approved migration from history as active', (t) => {
  const activeMigrations = approvedMigrations.filter(
    (file) => file !== contractRepairMigration,
  );
  const fixtureRoot = createFixture(activeMigrations);
  const historyDir = path.join(fixtureRoot, 'supabase', 'migrations_history');
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, contractRepairMigration), '-- historical fixture\n');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runGuard(fixtureRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Canonical migration set must contain exactly the approved files/);
  assert.match(result.stderr, new RegExp(contractRepairMigration));
});
