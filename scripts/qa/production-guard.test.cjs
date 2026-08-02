const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ALLOWED_QA_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  ProductionGuardError,
  assertLocalDatabaseTarget,
  assertRemoteApplyDisabled,
  assertRemotePlanTarget,
  assertSafeQaEnvironment,
  assertSafeQaValue,
} = require('./production-guard');

test('allows loopback and only the exact authorized QA project', () => {
  assert.doesNotThrow(() => assertSafeQaValue('http://127.0.0.1:57321'));
  assert.doesNotThrow(() => assertSafeQaValue(
    `https://${ALLOWED_QA_PROJECT_REF}.supabase.co`,
  ));
  assert.throws(
    () => assertSafeQaValue('https://unknownprojectrefxxx.supabase.co'),
    /not the authorized QA ref/,
  );
});

test('rejects protected hosts, Production ref, and Production environments', () => {
  assert.throws(
    () => assertSafeQaValue('https://app.arma2.com.ar/torneos'),
    ProductionGuardError,
  );
  assert.throws(
    () => assertSafeQaValue(`https://${PRODUCTION_PROJECT_REF}.supabase.co`),
    /Production/,
  );
  assert.throws(
    () => assertSafeQaEnvironment({ VERCEL_ENV: 'production' }),
    /Production execution is forbidden/,
  );
});

test('local target rejects missing, remote, and ambiguous credentials', () => {
  assert.throws(() => assertLocalDatabaseTarget({}), /QA_SEED_ENV/);
  assert.throws(() => assertLocalDatabaseTarget({
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
  }), /required and has no fallback/);
  assert.throws(() => assertLocalDatabaseTarget({
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
    QA_SEED_DATABASE_URL: 'postgresql://postgres:test@example.com/postgres',
  }), /loopback/);
  assert.throws(() => assertLocalDatabaseTarget({
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
    QA_SEED_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:57322/postgres',
    DATABASE_URL: 'postgresql://postgres:other@127.0.0.1:57322/postgres',
  }), /ambiguous/);
});

test('remote plan requires exact non-ambiguous variables and never applies', () => {
  assert.throws(() => assertRemotePlanTarget({}), /required and has no fallback/);
  assert.deepEqual(assertRemotePlanTarget({
    QA_SEED_PROJECT_REF: ALLOWED_QA_PROJECT_REF,
    QA_SEED_SUPABASE_URL: `https://${ALLOWED_QA_PROJECT_REF}.supabase.co`,
    QA_SEED_ENV: 'staging',
  }), {
    mode: 'remote-plan-only',
    projectRef: ALLOWED_QA_PROJECT_REF,
    apiUrl: `https://${ALLOWED_QA_PROJECT_REF}.supabase.co`,
  });
  assert.throws(() => assertRemoteApplyDisabled(), /intentionally disabled/);
});
