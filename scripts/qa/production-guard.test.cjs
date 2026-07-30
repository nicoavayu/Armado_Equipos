const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ProductionGuardError,
  assertSafeQaEnvironment,
  assertSafeQaValue,
  assertSafeSeedTarget,
} = require('./production-guard');

const productionRef = 'productionfixture123';
const stagingRef = 'stagingfixture456';
const safeEnv = {
  QA_PRODUCTION_PROJECT_REF: productionRef,
  QA_ALLOWED_SUPABASE_PROJECT_REF: stagingRef,
  REACT_APP_DEPLOY_ENV: 'test',
};

test('allows localhost and an explicitly allowlisted QA project', () => {
  assert.doesNotThrow(() => {
    assertSafeQaValue('http://127.0.0.1:54321/rest/v1/example', 'local', safeEnv);
    assertSafeQaValue(`https://${stagingRef}.supabase.co`, 'staging', safeEnv);
  });
});

test('rejects the protected application host', () => {
  assert.throws(
    () => assertSafeQaValue('https://app.arma2.com.ar/torneos', 'navigation', safeEnv),
    ProductionGuardError,
  );
});

test('rejects the Production project ref in arbitrary text', () => {
  assert.throws(
    () => assertSafeQaValue(`request:${productionRef}:failed`, 'console', safeEnv),
    /Production project ref/,
  );
});

test('rejects Production and unknown remote Supabase projects', () => {
  assert.throws(
    () => assertSafeQaValue(
      `https://${productionRef}.supabase.co`,
      'request',
      safeEnv,
    ),
    /Production/,
  );
  assert.throws(
    () => assertSafeQaValue(
      'https://unknownfixture999.supabase.co',
      'request',
      safeEnv,
    ),
    /not explicitly allowlisted/,
  );
});

test('rejects a Production execution environment', () => {
  assert.throws(
    () => assertSafeQaEnvironment({
      ...safeEnv,
      VERCEL_ENV: 'production',
    }),
    /Production execution is forbidden/,
  );
});

test('seed is dry-run by default and local execution is double opted-in', () => {
  assert.deepEqual(
    assertSafeSeedTarget({ env: safeEnv }),
    { dryRun: true, targetUrl: null },
  );
  assert.throws(
    () => assertSafeSeedTarget({
      dryRun: false,
      env: {
        ...safeEnv,
        QA_SEED_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
        QA_ALLOW_LOCAL_SEED: 'true',
      },
    }),
    /only permits local seed execution/,
  );
  assert.doesNotThrow(() => assertSafeSeedTarget({
    dryRun: false,
    env: {
      ...safeEnv,
      QA_SEED_SUPABASE_URL: 'http://127.0.0.1:54321',
      QA_ALLOW_LOCAL_SEED: 'true',
    },
  }));
  assert.throws(
    () => assertSafeSeedTarget({
      env: {
        ...safeEnv,
        ARMA2_DEPLOY_ENV: 'production',
      },
    }),
    /Production execution is forbidden/,
  );
});
