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
const socialStudioThemeMigration = '20260901120000_social_studio_theme_export_contract.sql';
const torneosCoreContractMigration = '20260914120000_torneos_core_contract_v1.sql';
const torneosCoreContractSessionMigration = '20260915120000_torneos_core_contract_v1_1_session.sql';
const coreReviewMigrations = [
  '20261010120000_core_trigger_helper_execute_grants.sql',
  '20261010121000_core_public_voting_roster_identity.sql',
  '20261010122000_core_notifications_ext_match_columns.sql',
  '20261010123000_core_reset_votacion_score_default.sql',
  '20261010124000_core_usuarios_profile_rpcs.sql',
  '20261010125000_core_public_match_reads_by_code.sql',
  '20261010126000_core_team_roster_identity.sql',
  '20261010127000_core_post_match_surveys_result_columns.sql',
  '20261010128000_core_contact_phone_and_public_profile_list.sql',
  '20261010129000_core_survey_finalization_recovery.sql',
  '20261010130000_core_client_build_reports.sql',
  '20261010131000_core_survey_server_finalization.sql',
  '20261010132000_core_friend_request_acceptance.sql',
  '20261010133000_core_match_access_code.sql',
  '20261010134000_core_partidos_template_link.sql',
  '20261010135000_core_private_profile_fields.sql',
  '20261010136000_core_match_roster_visibility.sql',
];
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
  assert.equal(approvedMigrations.length, 60);
  for (const migration of coreReviewMigrations) assert.ok(approvedMigrations.includes(migration));
  assert.ok(approvedMigrations.includes(autoMatchMigration));
  assert.ok(approvedMigrations.includes(contractRepairMigration));
  assert.ok(approvedMigrations.includes(mediaSessionReuseMigration));
  assert.ok(approvedMigrations.includes(globalAvailabilityMigration));
  assert.ok(approvedMigrations.includes(socialStudioThemeMigration));
  assert.ok(approvedMigrations.includes(torneosCoreContractMigration));
  assert.ok(approvedMigrations.includes(torneosCoreContractSessionMigration));
  assert.equal(
    approvedMigrations.filter(
      (file) => file !== autoMatchMigration
        && file !== contractRepairMigration
        && file !== globalAvailabilityMigration
        && file !== socialStudioThemeMigration
        && file !== torneosCoreContractMigration
        && file !== torneosCoreContractSessionMigration
        && !coreReviewMigrations.includes(file),
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
