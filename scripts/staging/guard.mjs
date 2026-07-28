#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_REF_PATTERN = /^[a-z0-9]{8,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ALLOWED_PREVIEW_ENVIRONMENTS = new Set(['preview', 'staging']);
const FALSE_OR_EMPTY = new Set(['', 'false']);
const AUTHORIZED_CREATION = Object.freeze({
  projectName: 'arma2-torneos-staging',
  organization: "nicoavayu's Org",
  region: 'us-east-1',
  plan: 'free',
});

export class StagingGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StagingGuardError';
  }
}

const fail = (message) => {
  throw new StagingGuardError(message);
};

const required = (env, key) => {
  const value = String(env[key] || '').trim();
  if (!value) fail(`Missing required environment variable ${key}.`);
  return value;
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const parseSupabaseUrl = (rawUrl, key) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail(`${key} is not a valid URL.`);
  }

  const hasUnexpectedParts = (
    parsed.protocol !== 'https:'
    || parsed.port !== ''
    || Boolean(parsed.username)
    || Boolean(parsed.password)
    || !['', '/'].includes(parsed.pathname)
    || Boolean(parsed.search)
    || Boolean(parsed.hash)
  );
  if (hasUnexpectedParts) {
    fail(`${key} must be a root HTTPS Supabase URL without credentials, port, path, query, or fragment.`);
  }
  return parsed;
};

const readLinkedProjectRef = (repoRoot) => {
  const projectRefPath = path.join(repoRoot, 'supabase', '.temp', 'project-ref');
  if (!fs.existsSync(projectRefPath)) return null;
  const linkedRef = fs.readFileSync(projectRefPath, 'utf8').trim().toLowerCase();
  if (!PROJECT_REF_PATTERN.test(linkedRef)) {
    fail('supabase/.temp/project-ref contains an invalid project ref.');
  }
  return linkedRef;
};

const validateDisabledFlag = (env, key, label) => {
  const value = String(env[key] || '').trim().toLowerCase();
  if (!FALSE_OR_EMPTY.has(value)) {
    fail(`${label} must be disabled; ${key} may only be unset or "false".`);
  }
};

export function loadLocalStagingEnvironment(repoRoot = process.cwd()) {
  const envPath = path.join(repoRoot, '.env.staging.local');
  if (!fs.existsSync(envPath)) return;
  if (typeof process.loadEnvFile !== 'function') {
    fail('This staging wrapper requires Node.js with process.loadEnvFile support.');
  }
  process.loadEnvFile(envPath);
}

export function validateStagingTarget({
  env = process.env,
  repoRoot = process.cwd(),
  requireLinked = false,
} = {}) {
  const deployEnvironment = required(env, 'ARMA2_DEPLOY_ENV').toLowerCase();
  if (deployEnvironment !== 'staging') {
    fail('ARMA2_DEPLOY_ENV must be exactly "staging"; production and unknown environments are rejected.');
  }

  const targetProjectRef = required(env, 'ARMA2_TARGET_PROJECT_REF').toLowerCase();
  if (!PROJECT_REF_PATTERN.test(targetProjectRef)) {
    fail('ARMA2_TARGET_PROJECT_REF has an invalid format.');
  }

  const productionProjectRef = required(env, 'ARMA2_PRODUCTION_PROJECT_REF').toLowerCase();
  if (!PROJECT_REF_PATTERN.test(productionProjectRef)) {
    fail('ARMA2_PRODUCTION_PROJECT_REF has an invalid format.');
  }

  const productionFingerprint = required(
    env,
    'ARMA2_PRODUCTION_PROJECT_REF_SHA256',
  ).toLowerCase();
  if (!SHA256_PATTERN.test(productionFingerprint)) {
    fail('ARMA2_PRODUCTION_PROJECT_REF_SHA256 must be a lowercase SHA-256 value.');
  }
  if (sha256(productionProjectRef) !== productionFingerprint) {
    fail('Production project ref fingerprint is inconsistent.');
  }
  if (
    targetProjectRef === productionProjectRef
    || sha256(targetProjectRef) === productionFingerprint
  ) {
    fail('The target project ref resolves to the protected production project.');
  }

  const targetUrlRaw = required(env, 'ARMA2_TARGET_SUPABASE_URL');
  const targetUrl = parseSupabaseUrl(targetUrlRaw, 'ARMA2_TARGET_SUPABASE_URL');
  const expectedTargetHost = `${targetProjectRef}.supabase.co`;
  if (targetUrl.hostname.toLowerCase() !== expectedTargetHost) {
    fail('ARMA2_TARGET_SUPABASE_URL is inconsistent with ARMA2_TARGET_PROJECT_REF.');
  }
  if (targetUrl.hostname.toLowerCase() === `${productionProjectRef}.supabase.co`) {
    fail('The target URL resolves to the protected production project.');
  }

  const linkedProjectRef = readLinkedProjectRef(repoRoot);
  if (linkedProjectRef && linkedProjectRef !== targetProjectRef) {
    fail('The local Supabase link is inconsistent with ARMA2_TARGET_PROJECT_REF.');
  }
  if (requireLinked && !linkedProjectRef) {
    fail('No local Supabase project link exists for this staging operation.');
  }

  for (const bypassKey of [
    'ARMA2_FORCE_STAGING',
    'ARMA2_SKIP_STAGING_GUARD',
    'ARMA2_STAGING_GUARD_BYPASS',
  ]) {
    if (String(env[bypassKey] || '').trim()) {
      fail(`${bypassKey} is forbidden; the staging guard cannot be bypassed.`);
    }
  }

  if (String(env.VERCEL_ENV || '').trim().toLowerCase() === 'production') {
    fail('VERCEL_ENV=production is contradictory with a staging cloud operation.');
  }

  validateDisabledFlag(
    env,
    'REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED',
    'Torneos Multimedia Upload',
  );
  validateDisabledFlag(
    env,
    'REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED',
    'Torneos Estudio Social',
  );

  const torneosEnabled = String(env.REACT_APP_TORNEOS_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
  if (torneosEnabled) {
    const previewEnvironment = required(env, 'REACT_APP_DEPLOY_ENV').toLowerCase();
    if (!ALLOWED_PREVIEW_ENVIRONMENTS.has(previewEnvironment)) {
      fail('Torneos may only be enabled for Preview or staging.');
    }
    if (required(env, 'REACT_APP_TORNEOS_DATA_ENV').toLowerCase() !== 'staging') {
      fail('Enabled Torneos must use REACT_APP_TORNEOS_DATA_ENV=staging.');
    }
    if (
      required(env, 'REACT_APP_TORNEOS_STAGING_PROJECT_REF').toLowerCase()
      !== targetProjectRef
    ) {
      fail('The Torneos staging project ref is inconsistent with the guarded target.');
    }
    const frontendUrl = parseSupabaseUrl(
      required(env, 'REACT_APP_SUPABASE_URL'),
      'REACT_APP_SUPABASE_URL',
    );
    if (frontendUrl.hostname.toLowerCase() !== expectedTargetHost) {
      fail('The Torneos frontend URL is inconsistent with the guarded target.');
    }
  }

  return {
    targetProjectRef,
    targetSupabaseUrl: targetUrl.toString().replace(/\/$/, ''),
    linkedProjectRef,
    torneosEnabled,
  };
}

export function validateStagingCreation({ env = process.env } = {}) {
  const deployEnvironment = required(env, 'ARMA2_DEPLOY_ENV').toLowerCase();
  if (deployEnvironment !== 'staging') {
    fail('ARMA2_DEPLOY_ENV must be exactly "staging" before project creation.');
  }

  const productionProjectRef = required(env, 'ARMA2_PRODUCTION_PROJECT_REF').toLowerCase();
  const productionFingerprint = required(
    env,
    'ARMA2_PRODUCTION_PROJECT_REF_SHA256',
  ).toLowerCase();
  if (
    !PROJECT_REF_PATTERN.test(productionProjectRef)
    || !SHA256_PATTERN.test(productionFingerprint)
    || sha256(productionProjectRef) !== productionFingerprint
  ) {
    fail('Protected production identity or fingerprint is inconsistent.');
  }

  const actual = {
    projectName: required(env, 'ARMA2_STAGING_PROJECT_NAME'),
    organization: required(env, 'ARMA2_STAGING_ORGANIZATION'),
    region: required(env, 'ARMA2_STAGING_REGION').toLowerCase(),
    plan: required(env, 'ARMA2_STAGING_PLAN').toLowerCase(),
  };
  for (const [key, expected] of Object.entries(AUTHORIZED_CREATION)) {
    if (actual[key] !== expected) {
      fail(`Unauthorized staging creation ${key}; expected ${expected}.`);
    }
  }

  const initialCost = Number(required(env, 'ARMA2_STAGING_INITIAL_COST_USD'));
  if (!Number.isFinite(initialCost) || initialCost !== 0) {
    fail('Staging project creation is allowed only when initial cost is exactly USD 0.');
  }
  if (String(env.VERCEL_ENV || '').trim().toLowerCase() === 'production') {
    fail('VERCEL_ENV=production is contradictory with staging project creation.');
  }

  return { ...actual, initialCost };
}

const redactProjectRef = (projectRef) => (
  projectRef.length <= 8
    ? `${projectRef.slice(0, 2)}…${projectRef.slice(-2)}`
    : `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`
);

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const repoRoot = process.cwd();
    loadLocalStagingEnvironment(repoRoot);
    const result = validateStagingTarget({ repoRoot });
    console.log(
      `[staging:guard] OK. Protected staging target ${redactProjectRef(result.targetProjectRef)}.`,
    );
  } catch (error) {
    console.error(`[staging:guard] ${error.message}`);
    process.exit(1);
  }
}
