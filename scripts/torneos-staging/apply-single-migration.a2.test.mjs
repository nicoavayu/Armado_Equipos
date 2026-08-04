// A2 execution contract.
//
// Nothing in this file may reach Staging, Production, Supabase or any network: every case is built
// from committed fixtures, and the only process ever spawned is a stub supplied by the test itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORIZED_STAGING_REF,
  FORBIDDEN_PRODUCTION_REF,
  SUPERSEDED_PLAN_IDS,
  buildDryRun,
  buildSnapshot,
} from './inspect-remote-readonly-lib.mjs';
import {
  A1_CHECKSUM,
  A1_CONFIRMATION,
  A1_FILE,
  A1_VERSION,
  A2_CHECKSUM,
  A2_CONFIRMATION_PREFIX,
  A2_FILE,
  A2_ROLLBACK,
  A2_ROLLBACK_CHECKSUM,
  A2_VERSION,
  AUTHORIZED_STAGES,
  PRODUCTION_GUARD_CONFIRMATION,
  SOCIAL_FILE,
  SOCIAL_VERSION,
  STAGE_CONTRACTS,
  STAGING_CA_CERT_ENV,
  SingleMigrationError,
  VERIFIED_TLS_SSLMODE,
  a2ConfirmationForPlan,
  approvalTokenForPlan,
  buildExecutionDryRun,
  buildOperationalConnection,
  buildTransactionalSql,
  prepareExecution,
  resolveStageContract,
  runPsql,
} from './single-migration-executor-lib.mjs';
import { splitMode } from './apply-single-migration.mjs';
import { canonicalJson, loadManifest, sha256 } from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'ops', 'torneos-staging', 'fixtures');
// The A2 precondition: A1 applied exactly once, A2 and Social still pending.
const A1_APPLIED_FIXTURE = path.join(FIXTURES, 'remote-readonly-equivalent-a1-applied.json');
// The pre-A1 state, where A2 must refuse to run.
const PRE_A1_FIXTURE = path.join(FIXTURES, 'remote-readonly-equivalent.json');
const DATABASE_URL = `postgresql://readonly.${AUTHORIZED_STAGING_REF}:fixture-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=${VERIFIED_TLS_SSLMODE}`;

const CA_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-a2-executor-ca-'));
const CA_PATH = path.join(CA_DIRECTORY, 'staging-ca.crt');
fs.writeFileSync(
  CA_PATH,
  `-----BEGIN CERTIFICATE-----\n${'QXJtYTIgVG9ybmVvcyBBMiB0ZXN0IENBIC0gbm90IGEgcmVhbCBjZXJ0aWZpY2F0ZQ=='.repeat(3)}\n-----END CERTIFICATE-----\n`,
  { mode: 0o600 },
);
test.after(() => fs.rmSync(CA_DIRECTORY, { recursive: true, force: true }));

const operationalEnv = () => ({
  STAGING_MIGRATION_DATABASE_URL: DATABASE_URL,
  [STAGING_CA_CERT_ENV]: CA_PATH,
});

// The contract is enforced across three cooperating modules, so a rejection may legitimately surface
// as a SingleMigrationError, an InspectorError or a ReadinessError. What must hold is the exact
// failure code and the fact that it is a typed, fail-closed rejection rather than a stray throw.
const expectCode = (code, run) => assert.throws(run, (error) => {
  assert.ok(['SingleMigrationError', 'InspectorError', 'ReadinessError'].includes(error?.name),
    `expected a typed contract error, got ${error?.name}: ${error?.message}`);
  assert.equal(error.code, code, `expected ${code}, got ${error.code}`);
  return true;
});

/**
 * Builds a complete, valid execution contract for `stage` from a committed fixture.
 * Every case below starts from this and breaks exactly one thing.
 */
const makeContractFiles = ({ stage = 'A2', fixtureFile = A1_APPLIED_FIXTURE } = {}) => {
  const contract = resolveStageContract(stage);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  const snapshot = buildSnapshot({
    repoRoot: ROOT,
    repositorySha: head,
    projectRef: AUTHORIZED_STAGING_REF,
    timestamp: new Date().toISOString(),
    database: fixture.database,
    metadata: fixture.metadata,
  });
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha: head });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-a2-executor-test-'));
  const snapshotFile = path.join(directory, 'snapshot.json');
  const planFile = path.join(directory, 'plan.json');
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  fs.writeFileSync(planFile, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const options = {
    _: [],
    stage,
    'project-ref': AUTHORIZED_STAGING_REF,
    'production-guard': PRODUCTION_GUARD_CONFIRMATION,
    'expected-repository-sha': head,
    snapshot: snapshotFile,
    plan: planFile,
    'snapshot-sha': sha256(canonicalJson(snapshot)),
    'plan-id': plan.planId,
    migration: contract.file,
    'migration-version': contract.version,
    'migration-checksum': contract.checksum,
    confirmation: contract.confirmation(plan),
    'approval-token': approvalTokenForPlan(plan, stage),
  };
  return { directory, head, snapshot, plan, options, contract };
};

// Rewrites the snapshot/plan pair after a test has mutated the snapshot, keeping every derived
// checksum, plan ID and approval token internally consistent so the case under test is the only
// thing that is wrong.
const resign = (input, stage = 'A2') => {
  input.plan = buildDryRun({ repoRoot: ROOT, snapshot: input.snapshot, repositorySha: input.head });
  fs.writeFileSync(input.options.snapshot, `${JSON.stringify(input.snapshot)}\n`, { mode: 0o600 });
  fs.writeFileSync(input.options.plan, `${JSON.stringify(input.plan)}\n`, { mode: 0o600 });
  input.options['snapshot-sha'] = sha256(canonicalJson(input.snapshot));
  input.options['plan-id'] = input.plan.planId;
  input.options.confirmation = resolveStageContract(stage).confirmation(input.plan);
  input.options['approval-token'] = approvalTokenForPlan(input.plan, stage);
  return input;
};

const prepare = (input, overrides = {}) => prepareExecution({
  repoRoot: ROOT,
  options: input.options,
  env: operationalEnv(),
  requireClean: false,
  ...overrides,
});

const withContract = (options, run) => {
  const input = makeContractFiles(options);
  try { return run(input); } finally {
    fs.rmSync(input.directory, { recursive: true, force: true });
  }
};

test('the stage allowlist is closed: only A1 and A2 resolve, Social never does', () => {
  assert.deepEqual([...AUTHORIZED_STAGES], ['A1', 'A2']);
  assert.equal(resolveStageContract('A1').version, A1_VERSION);
  assert.equal(resolveStageContract('A2').version, A2_VERSION);
  // Omitting the stage keeps the historical A1 behaviour.
  assert.equal(resolveStageContract(undefined).stage, 'A1');
  for (const rejected of [
    'Social', 'SOCIAL', SOCIAL_VERSION, 'A3', 'a2', 'A2 ', '__proto__', 'constructor', 'toString',
  ]) expectCode('STAGE_NOT_AUTHORIZED', () => resolveStageContract(rejected));
});

test('A2 identity is pinned to the certified version, file, checksum and rollback', () => {
  const contract = STAGE_CONTRACTS.A2;
  assert.equal(contract.version, '20260802120000');
  assert.equal(contract.file, 'supabase/migrations/20260802120000_tournament_media_trusted_processing.sql');
  assert.equal(contract.checksum, '5b678c593f685feb66ee34fd694403bac2cae828321eae65ee044287a51eba73');
  assert.equal(contract.rollback, 'supabase/rollbacks/20260802120000_tournament_media_trusted_processing.safe.sql');
  assert.equal(contract.rollbackChecksum, '9d7236bc51af0c321cff8ac772869b57959e718a7d6d2a6c06a60d255f62fc49');
  // The pinned values are the bytes actually committed, not merely a self-consistent constant.
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, contract.file))), contract.checksum);
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, contract.rollback))), contract.rollbackChecksum);
  assert.deepEqual([...contract.requiresAppliedBefore], [A1_VERSION]);
});

test('a valid A2 contract is prepared completely, leaving Social pending and unselected', () => {
  withContract({}, (input) => {
    const contract = prepare(input);
    assert.equal(contract.stage, 'A2');
    assert.equal(contract.expectedRepositorySha, input.head);
    assert.ok(contract.historyBefore.includes(A1_VERSION), 'A1 must be in the pre-history');
    assert.ok(!contract.historyBefore.includes(A2_VERSION));
    assert.ok(!contract.historyBefore.includes(SOCIAL_VERSION));
    assert.deepEqual(contract.historyAfter, [...contract.historyBefore, A2_VERSION].sort());
    assert.equal(contract.execution.applicationName, 'arma2-torneos-a2-migrate');
    assert.equal(contract.execution.timeouts.statementTimeoutMs, 180000);
    const preview = buildExecutionDryRun(contract);
    assert.equal(preview.stage, 'A2');
    assert.equal(preview.migration.version, A2_VERSION);
    assert.equal(preview.migration.selectionCount, 1);
    assert.deepEqual(preview.notSelected, [SOCIAL_VERSION], 'Social stays pending and unselected');
    assert.equal(preview.mutationsPerformed, 0);
    assert.equal(preview.shell, false);
    assert.equal(preview.sqlTransport, 'stdin');
    assert.equal(preview.databaseUrlInArguments, false);
    assert.equal(preview.approval.persisted, false);
  });
});

test('A1 still prepares under its historical contract, with its historical token and phrase', () => {
  withContract({ stage: 'A1', fixtureFile: PRE_A1_FIXTURE }, (input) => {
    // The A1 phrase is the static historical string, not a plan-derived one.
    assert.equal(input.options.confirmation, A1_CONFIRMATION);
    // The A1 token preimage is byte-identical to the pre-A2 implementation.
    assert.equal(
      input.options['approval-token'],
      sha256(`arma2-a1-apply:${input.plan.planId}:${input.plan.repositorySha}:${A1_VERSION}`),
    );
    const contract = prepare(input);
    assert.equal(contract.stage, 'A1');
    assert.equal(contract.execution.applicationName, 'arma2-torneos-a1-migrate');
    assert.equal(contract.execution.timeouts.statementTimeoutMs, 120000);
    assert.deepEqual(contract.historyAfter.slice(-1), [A1_VERSION]);
  });
});

test('Social is rejected as a stage, as a selection, and as a manifest authorization', () => {
  expectCode('STAGE_NOT_AUTHORIZED', () => resolveStageContract('Social'));
  for (const stage of ['A1', 'A2']) {
    const fixtureFile = stage === 'A1' ? PRE_A1_FIXTURE : A1_APPLIED_FIXTURE;
    withContract({ stage, fixtureFile }, (input) => {
      input.options.migration = SOCIAL_FILE;
      expectCode('SOCIAL_FORBIDDEN', () => prepare(input));
    });
  }
  // The manifest itself must still declare Social blocked.
  const social = loadManifest(ROOT).migrationPolicy.migrations
    .find((item) => item.version === SOCIAL_VERSION);
  assert.equal(social.execution.blocked, true);
  assert.equal(social.execution.authorizedStage, null);
});

test('A2 + Social cannot be selected together, in any selector form', () => {
  for (const value of [
    `${A2_FILE},${SOCIAL_FILE}`,
    `${A2_VERSION}:${SOCIAL_VERSION}`,
    'supabase/migrations/*.sql',
    'supabase/migrations',
    'all',
    `${A2_FILE} ${SOCIAL_FILE}`,
  ]) {
    withContract({}, (input) => {
      input.options.migration = value;
      assert.throws(() => prepare(input), (error) => error instanceof SingleMigrationError
        && ['MIGRATION_SELECTION', 'MIGRATION_NOT_AUTHORIZED', 'SOCIAL_FORBIDDEN'].includes(error.code),
      `expected ${value} to be refused`);
    });
  }
  // A positional second selector is refused too.
  withContract({}, (input) => {
    input.options._ = [SOCIAL_FILE];
    expectCode('MIGRATION_SELECTION', () => prepare(input));
  });
});

test('cross-stage authorization is refused in both directions', () => {
  // An A1 phrase and A1 token presented for A2.
  withContract({}, (input) => {
    const a1Token = approvalTokenForPlan(input.plan, 'A1');
    input.options.confirmation = A1_CONFIRMATION;
    input.options['approval-token'] = a1Token;
    expectCode('A2_CONFIRMATION', () => prepare(input));
  });
  withContract({}, (input) => {
    // Correct A2 phrase, but the token was minted for A1 against the very same plan.
    input.options['approval-token'] = approvalTokenForPlan(input.plan, 'A1');
    expectCode('APPROVAL_TOKEN', () => prepare(input));
  });
  // An A2 phrase and A2 token presented for A1.
  withContract({ stage: 'A1', fixtureFile: PRE_A1_FIXTURE }, (input) => {
    input.options.confirmation = a2ConfirmationForPlan(input.plan);
    input.options['approval-token'] = approvalTokenForPlan(input.plan, 'A2');
    expectCode('A1_CONFIRMATION', () => prepare(input));
  });
  withContract({ stage: 'A1', fixtureFile: PRE_A1_FIXTURE }, (input) => {
    input.options['approval-token'] = approvalTokenForPlan(input.plan, 'A2');
    expectCode('APPROVAL_TOKEN', () => prepare(input));
  });
});

test('the A2 authorization phrase is bound to its plan and cannot be replayed', () => {
  withContract({}, (input) => {
    const phrase = a2ConfirmationForPlan(input.plan);
    assert.ok(phrase.startsWith(A2_CONFIRMATION_PREFIX));
    assert.ok(phrase.includes(input.plan.planId.slice(0, 16)));
    assert.notEqual(phrase, A1_CONFIRMATION);
    // The same phrase presented against a different plan is refused.
    const other = { ...input.plan, planId: sha256('a-different-plan') };
    assert.notEqual(a2ConfirmationForPlan(other), phrase);
    input.options.confirmation = a2ConfirmationForPlan(other);
    expectCode('A2_CONFIRMATION', () => prepare(input));
  });
  // A phrase cannot be derived without a real plan ID.
  for (const bogus of [{}, { planId: '' }, { planId: 'short' }, { planId: 'Z'.repeat(64) }]) {
    expectCode('PLAN_ID_INVALID', () => a2ConfirmationForPlan(bogus));
  }
});

test('an expired plan is refused for A2', () => {
  withContract({}, (input) => {
    const expired = new Date(new Date(input.plan.expiresAt).valueOf() + 1000);
    expectCode('PLAN_EXPIRED', () => prepare(input, { now: expired }));
  });
});

test('a superseded (already consumed) plan is refused for A2', () => {
  withContract({}, (input) => {
    const plan = { ...input.plan, planId: SUPERSEDED_PLAN_IDS[0] };
    fs.writeFileSync(input.options.plan, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
    input.options['plan-id'] = plan.planId;
    expectCode('PLAN_SUPERSEDED', () => prepare(input));
  });
});

test('a plan whose ID does not match its own content is refused for A2', () => {
  withContract({}, (input) => {
    const tampered = { ...input.plan, remoteCalls: input.plan.remoteCalls + 1 };
    fs.writeFileSync(input.options.plan, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
    expectCode('PLAN_ID_DRIFT', () => prepare(input));
  });
});

test('a wrong A2 checksum, version or rollback is refused', () => {
  for (const [field, value, code] of [
    ['migration-checksum', '0'.repeat(64), 'MIGRATION_CHECKSUM'],
    ['migration-checksum', A1_CHECKSUM, 'MIGRATION_CHECKSUM'],
    ['migration-version', A1_VERSION, 'MIGRATION_VERSION'],
    ['migration-version', SOCIAL_VERSION, 'MIGRATION_VERSION'],
    ['migration', A1_FILE, 'MIGRATION_NOT_AUTHORIZED'],
    ['rollback', 'supabase/rollbacks/20260802090000_tournament_media_upload_pipeline.safe.sql', 'ROLLBACK_NOT_AUTHORIZED'],
    ['rollback', 'supabase/rollbacks/20260803090000_tournament_social_studio.safe.sql', 'ROLLBACK_NOT_AUTHORIZED'],
  ]) {
    withContract({}, (input) => {
      input.options[field] = value;
      expectCode(code, () => prepare(input));
    });
  }
  // The correct rollback is accepted when supplied explicitly.
  withContract({}, (input) => {
    input.options.rollback = A2_ROLLBACK;
    assert.equal(prepare(input).stage, 'A2');
  });
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, A2_ROLLBACK))), A2_ROLLBACK_CHECKSUM);
});

test('A2 refuses to run when A1 is absent from remote history', () => {
  withContract({ fixtureFile: PRE_A1_FIXTURE }, (input) => {
    assert.ok(!input.snapshot.migrationState.remoteHistory
      .some((item) => item.version === A1_VERSION));
    expectCode('MIGRATION_PREDECESSOR_MISSING', () => prepare(input));
  });
});

test('A2 refuses to run when it is already applied', () => {
  withContract({}, (input) => {
    input.snapshot.migrationState.remoteHistory.push({
      version: A2_VERSION, name: 'tournament_media_trusted_processing', checksum: null,
    });
    resign(input);
    expectCode('MIGRATION_ALREADY_APPLIED', () => prepare(input));
  });
});

test('A2 refuses to run when Social is already applied', () => {
  withContract({}, (input) => {
    input.snapshot.migrationState.remoteHistory.push({
      version: SOCIAL_VERSION, name: 'tournament_social_studio', checksum: null,
    });
    resign(input);
    expectCode('MIGRATION_HISTORY_UNEXPECTED', () => prepare(input));
  });
});

test('unexpected or duplicated remote history aborts A2 before any connection', () => {
  withContract({}, (input) => {
    input.snapshot.migrationState.remoteHistory.push({
      version: '20990101000000', name: 'unexpected', checksum: null,
    });
    input.snapshot.migrationState.remoteVersionsMissingLocally = ['20990101000000'];
    resign(input);
    expectCode('MIGRATION_HISTORY_UNEXPECTED', () => prepare(input));
  });
  withContract({}, (input) => {
    input.snapshot.migrationState.remoteHistory.push(
      structuredClone(input.snapshot.migrationState.remoteHistory[0]),
    );
    input.snapshot.migrationState.duplicates = [input.snapshot.migrationState.remoteHistory[0].version];
    resign(input);
    expectCode('MIGRATION_HISTORY_DUPLICATE', () => prepare(input));
  });
});

test('a wrong repository SHA or a Production target aborts A2 before any connection', () => {
  for (const [field, value, code] of [
    ['expected-repository-sha', '0'.repeat(40), 'REPOSITORY_DRIFT'],
    ['expected-repository-sha', '', 'REPOSITORY_SHA'],
    ['project-ref', FORBIDDEN_PRODUCTION_REF, 'PRODUCTION_FORBIDDEN'],
    ['project-ref', 'aaaaaaaaaaaaaaaaaaaa', 'PROJECT_REF_UNKNOWN'],
    ['production-guard', 'no', 'PRODUCTION_GUARD'],
  ]) {
    withContract({}, (input) => {
      input.options[field] = value;
      expectCode(code, () => prepare(input));
    });
  }
});

test('a Production database URL is refused for A2 even with the Staging ref supplied', () => {
  withContract({}, (input) => {
    expectCode('PRODUCTION_FORBIDDEN', () => prepare(input, {
      env: {
        STAGING_MIGRATION_DATABASE_URL:
          `postgresql://postgres.${FORBIDDEN_PRODUCTION_REF}:pw@db.${FORBIDDEN_PRODUCTION_REF}.supabase.co:5432/postgres?sslmode=${VERIFIED_TLS_SSLMODE}`,
        [STAGING_CA_CERT_ENV]: CA_PATH,
      },
    }));
  });
});

test('A2 apply and verify refuse to connect without a CA bundle or without verify-full', () => {
  withContract({}, (input) => {
    expectCode('CA_CERT_REQUIRED', () => prepare(input, {
      env: { STAGING_MIGRATION_DATABASE_URL: DATABASE_URL },
    }));
  });
  withContract({}, (input) => {
    expectCode('CA_CERT_INHERITED', () => prepare(input, {
      env: { ...operationalEnv(), PGSSLROOTCERT: '/etc/ssl/other-ca.pem' },
    }));
  });
  for (const sslmode of ['require', 'verify-ca']) {
    withContract({}, (input) => {
      expectCode('TLS_VERIFICATION_REQUIRED', () => prepare(input, {
        env: {
          ...operationalEnv(),
          STAGING_MIGRATION_DATABASE_URL: DATABASE_URL.replace(VERIFIED_TLS_SSLMODE, sslmode),
        },
      }));
    });
  }
  for (const sslmode of ['disable', 'allow', 'prefer']) {
    withContract({}, (input) => {
      expectCode('DATABASE_URL_PARAMETER', () => prepare(input, {
        env: {
          ...operationalEnv(),
          STAGING_MIGRATION_DATABASE_URL: DATABASE_URL.replace(VERIFIED_TLS_SSLMODE, sslmode),
        },
      }));
    });
  }
});

test('generated A2 SQL is singular, transactional, and registers only A2 before COMMIT', () => {
  const manifest = loadManifest(ROOT);
  const migrationSql = fs.readFileSync(path.join(ROOT, A2_FILE), 'utf8');
  const sql = buildTransactionalSql({
    migrationSql,
    execution: manifest.migrationPolicy.migrations[1].execution,
    historyBefore: ['20260801090000', A1_VERSION],
    historyAfter: ['20260801090000', A1_VERSION, A2_VERSION],
    stage: 'A2',
  });
  const executable = sql.replace(/\$arma2_a2_canonical_sql\$[\s\S]*?\$arma2_a2_canonical_sql\$/g, "''");
  assert.equal((executable.match(/^\s*BEGIN\s*;/gim) || []).length, 1);
  assert.equal((executable.match(/^\s*COMMIT\s*;/gim) || []).length, 1);
  assert.match(sql, /SET LOCAL lock_timeout = '5000ms'/);
  assert.match(sql, /SET LOCAL statement_timeout = '180000ms'/);
  assert.match(sql, /SET LOCAL idle_in_transaction_session_timeout = '60000ms'/);
  assert.match(sql, /SET LOCAL application_name = 'arma2-torneos-a2-migrate'/);
  assert.match(sql, /LOCK TABLE supabase_migrations\.schema_migrations IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(sql, /VALUES \('20260802120000', 'tournament_media_trusted_processing'/);
  assert.match(sql, /A2 already applied/);
  assert.ok(sql.indexOf("VALUES ('20260802120000'") < sql.lastIndexOf('COMMIT;'));
  // A2's own SQL must never register Social, nor re-register A1.
  assert.doesNotMatch(sql, /VALUES \('20260803090000'/);
  assert.doesNotMatch(sql, /VALUES \('20260802090000'/);
  // The canonical A2 body travels through untouched.
  const canonicalBody = migrationSql.slice(
    migrationSql.match(/^\s*BEGIN\s*;\s*$/im).index
      + migrationSql.match(/^\s*BEGIN\s*;\s*$/im)[0].length,
    migrationSql.match(/^\s*COMMIT\s*;\s*$/im).index,
  );
  assert.equal(sql.split(canonicalBody).length, 2);
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, A2_FILE))), A2_CHECKSUM);
});

test('A2 SQL construction refuses a pre-history without A1 and refuses A1 timeouts', () => {
  const manifest = loadManifest(ROOT);
  const migrationSql = fs.readFileSync(path.join(ROOT, A2_FILE), 'utf8');
  const execution = manifest.migrationPolicy.migrations[1].execution;
  expectCode('MIGRATION_PREDECESSOR_MISSING', () => buildTransactionalSql({
    migrationSql,
    execution,
    historyBefore: ['20260801090000'],
    historyAfter: ['20260801090000', A2_VERSION],
    stage: 'A2',
  }));
  // A1's timeouts are not A2's: presenting them aborts construction.
  const wrongTimeouts = structuredClone(execution);
  wrongTimeouts.timeouts.statementTimeoutMs = 120000;
  expectCode('MIGRATION_TIMEOUT', () => buildTransactionalSql({
    migrationSql,
    execution: wrongTimeouts,
    historyBefore: [A1_VERSION],
    historyAfter: [A1_VERSION, A2_VERSION],
    stage: 'A2',
  }));
  // A1's execution block cannot be used to build A2.
  expectCode('MIGRATION_TIMEOUT', () => buildTransactionalSql({
    migrationSql,
    execution: manifest.migrationPolicy.migrations[0].execution,
    historyBefore: [A1_VERSION],
    historyAfter: [A1_VERSION, A2_VERSION],
    stage: 'A2',
  }));
});

test('the A2 npm command pins the stage ahead of the operator-supplied mode', () => {
  // `npm run torneos:staging:a2 -- apply --project-ref=...` produces this argv shape.
  const { mode, rawOptions } = splitMode(['--stage=A2', 'apply', '--project-ref=x']);
  assert.equal(mode, 'apply');
  assert.deepEqual(rawOptions, ['--stage=A2', '--project-ref=x']);
  // The historical A1 shape still works unchanged.
  assert.deepEqual(splitMode(['apply', '--project-ref=x']), {
    mode: 'apply', rawOptions: ['--project-ref=x'],
  });
  assert.throws(() => splitMode(['--stage=A2']), /Mode must be one of/);
  assert.throws(() => splitMode(['migrate']), /Mode must be one of/);
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts['torneos:staging:a1'],
    'node scripts/torneos-staging/apply-single-migration.mjs');
  assert.equal(scripts['torneos:staging:a2'],
    'node scripts/torneos-staging/apply-single-migration.mjs --stage=A2');
});

test('a stdin EPIPE is reported as an undetermined outcome, with no retry and no second spawn', async () => {
  let spawns = 0;
  const spawnFn = () => {
    spawns += 1;
    const listeners = { stdout: {}, stderr: {}, stdin: {}, child: {} };
    const on = (bag) => (event, handler) => { bag[event] = handler; };
    const child = {
      stdout: { setEncoding() {}, on: on(listeners.stdout) },
      stderr: { setEncoding() {}, on: on(listeners.stderr) },
      stdin: {
        on: on(listeners.stdin),
        end() {
          const error = new Error('write EPIPE');
          error.code = 'EPIPE';
          listeners.stdin.error?.(error);
          // psql exits 0 after refusing the rest of the payload.
          setImmediate(() => listeners.child.close?.(0, null));
        },
      },
      on: on(listeners.child),
    };
    return child;
  };
  const connection = buildOperationalConnection({
    projectRef: AUTHORIZED_STAGING_REF,
    databaseUrl: DATABASE_URL,
    targetMode: 'apply',
    inheritedEnv: { PATH: '/usr/bin' },
    caCertPath: CA_PATH,
  });
  await assert.rejects(
    runPsql({ connection, sql: 'SELECT 1;', psql: 'psql', spawnFn }),
    (error) => error instanceof SingleMigrationError
      && error.code === 'PSQL_STDIN_TRANSPORT'
      && error.details.stdinErrorCode === 'EPIPE'
      // Exit code 0 does not clear it: psql cannot have run SQL it never received.
      && error.details.psqlExitCode === 0
      && error.details.requiresReadOnlyReinspection === true,
  );
  assert.equal(spawns, 1, 'a transport failure must never be retried');
});

test('the executor never spawns psql while preparing an A2 contract', () => {
  // `prepareExecution` builds a descriptor but must not reach a process. Any spawn attempt during
  // preparation would have to go through runPsql, which is not called on this path at all.
  withContract({}, (input) => {
    const contract = prepare(input);
    assert.ok(contract.connection, 'a validated descriptor is minted');
    assert.equal(contract.connection.targetMode, 'apply');
    assert.equal(contract.connection.projectRef, AUTHORIZED_STAGING_REF);
    // The descriptor serialises to its identity only: no credential can leak into a plan or receipt.
    assert.deepEqual(JSON.parse(JSON.stringify(contract.connection)), {
      profile: 'remote',
      projectRef: AUTHORIZED_STAGING_REF,
      targetMode: 'apply',
      databaseHostKind: contract.connection.databaseHostKind,
    });
    assert.equal(buildExecutionDryRun(contract).mutationsPerformed, 0);
  });
});

test('the two inspector REVISAR objects belong to the canonical baseline, not to A2', () => {
  // `tournaments_org_season_status_idx` and `tournaments.tournaments_select_capability` were
  // flagged for review by the read-only inspector. They are created solely by the canonical
  // baseline migration and are untouched by A1, A2, Social and the A2 rollback, so they are not
  // part of the A2 execution surface and cannot cause a future false block.
  const baseline = path.join(ROOT, 'supabase', 'migrations', '20260727090000_arma2_canonical_baseline.sql');
  const baselineSql = fs.readFileSync(baseline, 'utf8');
  for (const object of ['tournaments_org_season_status_idx', 'tournaments_select_capability']) {
    assert.ok(baselineSql.includes(object), `${object} must originate in the canonical baseline`);
    for (const file of [A1_FILE, A2_FILE, SOCIAL_FILE, A2_ROLLBACK]) {
      assert.ok(!fs.readFileSync(path.join(ROOT, file), 'utf8').includes(object),
        `${object} must not appear in ${file}`);
    }
  }
});
