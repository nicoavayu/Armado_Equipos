#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  AUTHORIZED_STAGING_REF,
  EXPECTED_REPOSITORY_SHA,
  InspectorError,
  assertSnapshotSanitized,
  buildSnapshot,
  defaultArtifactDirectory,
  inspectDatabase,
  inspectSupabaseMetadata,
  loadInspectorSql,
  validateTarget,
} from './inspect-remote-readonly-lib.mjs';
import { canonicalJson, sha256 } from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SQL_FILE = path.join(ROOT, 'scripts', 'torneos-staging', 'inspect-remote-readonly.sql');

const parse = (argv) => Object.fromEntries(argv.map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const validateRepository = ({ allowDirty = false } = {}) => {
  const head = git(['rev-parse', 'HEAD']);
  let expectedBaseIsAncestor = false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', EXPECTED_REPOSITORY_SHA, 'HEAD'], {
      cwd: ROOT, stdio: 'ignore',
    });
    expectedBaseIsAncestor = true;
  } catch { expectedBaseIsAncestor = false; }
  if (head !== EXPECTED_REPOSITORY_SHA && !expectedBaseIsAncestor) {
    throw new InspectorError('REPOSITORY_DRIFT', 'Expected epic SHA is not an ancestor of inspector HEAD.');
  }
  const branch = git(['branch', '--show-current']);
  if (branch !== 'feature/torneos-staging-readonly-inspector') {
    throw new InspectorError('REPOSITORY_BRANCH', 'Inspector must run from its isolated feature branch.');
  }
  if (!allowDirty && git(['status', '--porcelain'])) {
    throw new InspectorError('REPOSITORY_DIRTY', 'Inspector requires a clean worktree.');
  }
  return { head, branch };
};

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parse(argv);
  const repository = validateRepository({ allowDirty: options['allow-dirty'] === true });
  const timestamp = options.timestamp || new Date().toISOString();
  let database;
  let metadata;

  if (options.fixture) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(ROOT, String(options.fixture)), 'utf8'));
    database = fixture.database;
    metadata = fixture.metadata;
  } else {
    const required = ['STAGING_READONLY_DATABASE_URL', 'AUTHORIZED_STAGING_PROJECT_REF'];
    const missing = required.filter((name) => !String(env[name] || '').trim());
    if (missing.length) {
      throw new InspectorError('CREDENTIAL_MISSING', `Missing required environment variable(s): ${missing.join(', ')}.`);
    }
    const projectRef = String(env.AUTHORIZED_STAGING_PROJECT_REF).trim().toLowerCase();
    validateTarget({ projectRef, databaseUrl: env.STAGING_READONLY_DATABASE_URL });
    const statements = loadInspectorSql(SQL_FILE);
    const { Client } = await import('pg');
    database = await inspectDatabase({ databaseUrl: env.STAGING_READONLY_DATABASE_URL, statements, Client });
    metadata = inspectSupabaseMetadata({ accessToken: env.SUPABASE_ACCESS_TOKEN, projectRef,
      cli: String(options['supabase-cli'] || 'supabase') });
  }

  const snapshot = buildSnapshot({
    repoRoot: ROOT, repositorySha: EXPECTED_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp, database, metadata,
  });
  const outputDirectory = options['output-dir']
    ? path.resolve(String(options['output-dir'])) : defaultArtifactDirectory();
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, 'staging-readonly-snapshot.json');
  const serialized = `${JSON.stringify(JSON.parse(canonicalJson(snapshot)), null, 2)}\n`;
  assertSnapshotSanitized(serialized);
  fs.writeFileSync(output, serialized, { mode: 0o600 });
  const result = { status: 'ok', snapshot: output, sha256: sha256(serialized),
    remoteCalls: snapshot.remoteCalls, mutationsPerformed: 0, repository: repository.head };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    const code = error instanceof InspectorError ? error.code : 'INSPECTOR_FAILURE';
    process.stderr.write(`[torneos-readonly-inspector] ${code}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
