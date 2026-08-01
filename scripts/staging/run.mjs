#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import {
  loadLocalStagingEnvironment,
  validateStagingCreation,
  validateStagingTarget,
} from './guard.mjs';

const EXPECTED_MIGRATIONS = [
  '20260727090000_arma2_canonical_baseline.sql',
  '20260727215106_canonical_core_rls_contracts.sql',
  '20260801090000_tournament_context_reads_are_pure.sql',
];
const FORBIDDEN_ARGUMENTS = new Set([
  '--db-url',
  '--force',
  '--include-all',
  '--include-seed',
  '--no-verify-jwt',
  '--password',
  '--project-ref',
  '--prune',
]);
const ALLOWED_FUNCTIONS = new Set([
  'accept-invite',
  'approve-join-request',
  'delete-account',
  'issue-voting-photo-token',
  'join-match-guest',
  'push-auto-match-now',
  'push-dispatch-now',
  'push-sender',
  'upload-voting-photo',
]);

const fail = (message) => {
  console.error(`[staging] ${message}`);
  process.exit(1);
};

const run = (command, args, { capture = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? `${result.stdout || ''}\n${result.stderr || ''}` : '';
};

const assertSafeArguments = (args) => {
  for (const argument of args) {
    const option = argument.split('=', 1)[0];
    if (FORBIDDEN_ARGUMENTS.has(option) || option.includes('bypass')) {
      fail(`Forbidden wrapper argument: ${option}.`);
    }
  }
};

const assertCanonicalMigrationSet = () => {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const actual = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_MIGRATIONS)) {
    fail(
      `Canonical migration set mismatch. Expected exactly: ${EXPECTED_MIGRATIONS.join(', ')}.`,
    );
  }
};

const assertDryRunOutput = (output) => {
  const mentioned = EXPECTED_MIGRATIONS.filter((migration) => output.includes(migration));
  if (mentioned.length !== EXPECTED_MIGRATIONS.length) {
    fail('Dry-run did not include every canonical migration.');
  }
  const unexpected = [
    ...output.matchAll(/\b\d{14}_[A-Za-z0-9_-]+\.sql\b/g),
  ].map((match) => match[0]).filter((name) => !EXPECTED_MIGRATIONS.includes(name));
  if (unexpected.length > 0) {
    fail(`Dry-run included unexpected migrations: ${[...new Set(unexpected)].join(', ')}.`);
  }
};

const operation = process.argv[2];
const forwardedArgs = process.argv.slice(3);
if (!operation) fail('Missing staging operation.');
assertSafeArguments(forwardedArgs);

try {
  loadLocalStagingEnvironment(process.cwd());
  const target = operation === 'create-guard'
    ? null
    : validateStagingTarget({
      repoRoot: process.cwd(),
      requireLinked: !['guard', 'link'].includes(operation),
    });

  switch (operation) {
    case 'create-guard':
      validateStagingCreation();
      console.log('[staging:create:guard] Free project creation metadata passed.');
      break;
    case 'guard':
      console.log(
        `[staging:guard] OK. Torneos ${target.torneosEnabled ? 'enabled' : 'disabled'}; `
        + `QA password login ${target.qaPasswordLoginEnabled ? 'enabled' : 'disabled'}; `
        + 'Multimedia Upload disabled; Estudio Social disabled.',
      );
      break;
    case 'link':
      run('npx', [
        '--no-install',
        'supabase',
        'link',
        '--project-ref',
        target.targetProjectRef,
      ]);
      validateStagingTarget({ repoRoot: process.cwd(), requireLinked: true });
      console.log('[staging:link] Linked target passed the post-link guard.');
      break;
    case 'db-dry-run': {
      assertCanonicalMigrationSet();
      run('npm', ['run', 'migrations:guard']);
      const output = run(
        'npx',
        ['--no-install', 'supabase', 'db', 'push', '--dry-run', '--linked'],
        { capture: true },
      );
      assertDryRunOutput(output);
      console.log('[staging:db:dry-run] Exactly the approved canonical migrations are pending.');
      break;
    }
    case 'db-push':
      assertCanonicalMigrationSet();
      run('npm', ['run', 'migrations:guard']);
      run('npx', ['--no-install', 'supabase', 'db', 'push', '--linked', '--yes']);
      break;
    case 'functions-deploy': {
      if (forwardedArgs.length === 0) {
        fail('List each Edge Function explicitly; deploying all functions implicitly is forbidden.');
      }
      for (const functionName of forwardedArgs) {
        if (!ALLOWED_FUNCTIONS.has(functionName)) {
          fail(`Edge Function is not in the staging allowlist: ${functionName}.`);
        }
        run('npx', [
          '--no-install',
          'supabase',
          'functions',
          'deploy',
          functionName,
          '--project-ref',
          target.targetProjectRef,
          '--use-api',
        ]);
      }
      break;
    }
    case 'verify': {
      const output = run(
        'npx',
        ['--no-install', 'supabase', 'migration', 'list', '--linked'],
        { capture: true },
      );
      for (const migration of EXPECTED_MIGRATIONS) {
        if (!output.includes(migration.slice(0, 14))) {
          fail(`Remote migration history is missing ${migration}.`);
        }
      }
      console.log('[staging:verify] Canonical migration history is present on the guarded target.');
      break;
    }
    case 'unlink':
      run('npx', ['--no-install', 'supabase', 'unlink']);
      if (fs.existsSync(path.join(process.cwd(), 'supabase', '.temp', 'project-ref'))) {
        fail('Supabase project-ref still exists after unlink.');
      }
      console.log('[staging:unlink] Local Supabase link removed.');
      break;
    default:
      fail(`Unknown staging operation: ${operation}.`);
  }
} catch (error) {
  fail(error.message);
}
