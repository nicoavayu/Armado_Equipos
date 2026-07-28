import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  StagingGuardError,
  validateStagingCreation,
  validateStagingTarget,
} from './guard.mjs';

const productionRef = 'productionfixture123';
const stagingRef = 'stagingfixture456';
const fingerprint = createHash('sha256').update(productionRef).digest('hex');

const validEnv = {
  ARMA2_DEPLOY_ENV: 'staging',
  ARMA2_TARGET_PROJECT_REF: stagingRef,
  ARMA2_TARGET_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  ARMA2_PRODUCTION_PROJECT_REF: productionRef,
  ARMA2_PRODUCTION_PROJECT_REF_SHA256: fingerprint,
  REACT_APP_DEPLOY_ENV: 'preview',
  REACT_APP_TORNEOS_DATA_ENV: 'staging',
  REACT_APP_TORNEOS_STAGING_PROJECT_REF: stagingRef,
  REACT_APP_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'false',
  REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'false',
};

const temporaryRepo = (linkedRef = null) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-staging-guard-'));
  if (linkedRef) {
    const tempDir = path.join(repoRoot, 'supabase', '.temp');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'project-ref'), `${linkedRef}\n`);
  }
  return repoRoot;
};

const rejects = (overrides, pattern, options = {}) => {
  const repoRoot = options.repoRoot || temporaryRepo();
  assert.throws(
    () => validateStagingTarget({
      env: { ...validEnv, ...overrides },
      repoRoot,
      requireLinked: options.requireLinked || false,
    }),
    (error) => error instanceof StagingGuardError && pattern.test(error.message),
  );
};

test('allows an explicit, internally consistent staging target', () => {
  const result = validateStagingTarget({
    env: validEnv,
    repoRoot: temporaryRepo(stagingRef),
    requireLinked: true,
  });
  assert.equal(result.targetProjectRef, stagingRef);
  assert.equal(result.torneosEnabled, true);
});

test('rejects a production deployment environment', () => {
  rejects({ ARMA2_DEPLOY_ENV: 'production' }, /must be exactly "staging"/);
});

test('rejects an unknown deployment environment', () => {
  rejects({ ARMA2_DEPLOY_ENV: 'qa-copy' }, /must be exactly "staging"/);
});

test('rejects a missing target project ref', () => {
  rejects({ ARMA2_TARGET_PROJECT_REF: '' }, /ARMA2_TARGET_PROJECT_REF/);
});

test('rejects a missing target URL', () => {
  rejects({ ARMA2_TARGET_SUPABASE_URL: '' }, /ARMA2_TARGET_SUPABASE_URL/);
});

test('rejects the production project ref', () => {
  rejects({
    ARMA2_TARGET_PROJECT_REF: productionRef,
    ARMA2_TARGET_SUPABASE_URL: `https://${productionRef}.supabase.co`,
  }, /protected production project/);
});

test('rejects the production URL', () => {
  rejects({
    ARMA2_TARGET_SUPABASE_URL: `https://${productionRef}.supabase.co`,
  }, /inconsistent with ARMA2_TARGET_PROJECT_REF/);
});

test('rejects an incorrect production fingerprint', () => {
  rejects({
    ARMA2_PRODUCTION_PROJECT_REF_SHA256: '0'.repeat(64),
  }, /fingerprint is inconsistent/);
});

test('rejects an inconsistent local project link', () => {
  rejects({}, /local Supabase link is inconsistent/, {
    repoRoot: temporaryRepo('differentfixture789'),
  });
});

test('rejects Multimedia Upload activation', () => {
  rejects({
    REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'true',
  }, /Multimedia Upload must be disabled/);
});

test('rejects Estudio Social activation', () => {
  rejects({
    REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'true',
  }, /Estudio Social must be disabled/);
});

test('rejects Torneos in a production preview environment', () => {
  rejects({
    REACT_APP_DEPLOY_ENV: 'production',
  }, /only be enabled for Preview or staging/);
});

test('allows only the authorized zero-cost Free staging creation metadata', () => {
  const result = validateStagingCreation({
    env: {
      ARMA2_DEPLOY_ENV: 'staging',
      ARMA2_PRODUCTION_PROJECT_REF: productionRef,
      ARMA2_PRODUCTION_PROJECT_REF_SHA256: fingerprint,
      ARMA2_STAGING_PROJECT_NAME: 'arma2-torneos-staging',
      ARMA2_STAGING_ORGANIZATION: "nicoavayu's Org",
      ARMA2_STAGING_REGION: 'us-east-1',
      ARMA2_STAGING_PLAN: 'Free',
      ARMA2_STAGING_INITIAL_COST_USD: '0',
    },
  });
  assert.equal(result.plan, 'free');
  assert.equal(result.initialCost, 0);
});

test('rejects any non-zero staging creation cost', () => {
  assert.throws(
    () => validateStagingCreation({
      env: {
        ARMA2_DEPLOY_ENV: 'staging',
        ARMA2_PRODUCTION_PROJECT_REF: productionRef,
        ARMA2_PRODUCTION_PROJECT_REF_SHA256: fingerprint,
        ARMA2_STAGING_PROJECT_NAME: 'arma2-torneos-staging',
        ARMA2_STAGING_ORGANIZATION: "nicoavayu's Org",
        ARMA2_STAGING_REGION: 'us-east-1',
        ARMA2_STAGING_PLAN: 'Free',
        ARMA2_STAGING_INITIAL_COST_USD: '0.01',
      },
    }),
    /only when initial cost is exactly USD 0/,
  );
});
