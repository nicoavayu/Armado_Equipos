#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCanonicalCatalog,
  hashCanonicalCatalog,
  resolveLocalDatabase,
} from './canonical-catalog-fingerprint.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselineVersion = '20260727090000';
const contractsVersion = '20260727215106';
const baselineName = `${baselineVersion}_arma2_canonical_baseline.sql`;
const contractsName = `${contractsVersion}_canonical_core_rls_contracts.sql`;
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const contractsPath = path.join(migrationsDir, contractsName);
const expectedFinalFingerprint = 'ff1cdbf9cdca35dd95bf67ab7652d9ebcd362e6bcadf0dabad13dcc21f495cf0';

const run = (command, args, { allowFailure = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with ${result.status}`);
  }
  return result;
};

const queryJson = (container, query) => {
  const result = run('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ]);
  return JSON.parse(result.stdout.trim());
};

const splitTopLevelStatements = (sql) => {
  const statements = [];
  let current = '';
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        current += '\n';
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 1;
      } else if (char === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }
    if (singleQuoted) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
    } else if (char === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 1;
    } else if (char === "'") {
      singleQuoted = true;
      current += char;
    } else if (char === '"') {
      doubleQuoted = true;
      current += char;
    } else if (char === '$') {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        current += tag;
        index += tag.length - 1;
      } else {
        current += char;
      }
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
};

test('canonical contracts migration has no transaction breakers', () => {
  const sql = fs.readFileSync(contractsPath, 'utf8');
  const statements = splitTopLevelStatements(sql);
  const forbidden = statements.filter((statement) => (
    /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|SAVEPOINT|SET\s+TRANSACTION)\b/i.test(statement)
    || /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(statement)
    || /^REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY\b/i.test(statement)
    || /^VACUUM\b/i.test(statement)
  ));
  const metaCommands = sql
    .split('\n')
    .filter((line) => /^\s*\\/.test(line));

  assert.deepEqual(forbidden, []);
  assert.deepEqual(metaCommands, []);
});

test('failed canonical contracts migration rolls back schema and ledger atomically', {
  timeout: 180_000,
}, () => {
  run('npx', [
    '--no-install',
    'supabase',
    'db',
    'reset',
    '--local',
    '--no-seed',
    '--version',
    baselineVersion,
  ]);

  const database = resolveLocalDatabase(repoRoot);
  const baselineCatalog = buildCanonicalCatalog(database);
  const baselineFingerprint = hashCanonicalCatalog(baselineCatalog).sha256;
  const beforeLedger = queryJson(database.container, `
    select coalesce(jsonb_agg(version order by version), '[]'::jsonb)
    from supabase_migrations.schema_migrations;
  `);
  assert.deepEqual(beforeLedger, [baselineVersion]);

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-migration-atomicity-'));
  try {
    const sandboxSupabase = path.join(sandbox, 'supabase');
    const sandboxMigrations = path.join(sandboxSupabase, 'migrations');
    fs.mkdirSync(sandboxMigrations, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, 'supabase', 'config.toml'), path.join(sandboxSupabase, 'config.toml'));
    fs.copyFileSync(path.join(migrationsDir, baselineName), path.join(sandboxMigrations, baselineName));

    const contractsSql = fs.readFileSync(contractsPath, 'utf8');
    const injectionMarker = '-- Canonical anon-write closure.';
    assert.equal(contractsSql.includes(injectionMarker), true);
    const failingSql = contractsSql.replace(
      injectionMarker,
      [
        '-- Invalid statement injected only into this temporary test copy.',
        'select arma2_atomicity_test_invalid_statement();',
        '',
        injectionMarker,
      ].join('\n'),
    );
    fs.writeFileSync(path.join(sandboxMigrations, contractsName), failingSql);

    const failed = run('npx', [
      '--no-install',
      'supabase',
      '--workdir',
      sandbox,
      'migration',
      'up',
      '--db-url',
      database.dbUrl,
      '--include-all',
    ], { allowFailure: true });
    assert.notEqual(failed.status, 0, 'the injected invalid statement must fail');

    const afterFailureLedger = queryJson(database.container, `
      select coalesce(jsonb_agg(version order by version), '[]'::jsonb)
      from supabase_migrations.schema_migrations;
    `);
    assert.deepEqual(afterFailureLedger, [baselineVersion]);

    const afterFailureCatalog = buildCanonicalCatalog(database);
    assert.deepEqual(afterFailureCatalog, baselineCatalog);
    assert.equal(hashCanonicalCatalog(afterFailureCatalog).sha256, baselineFingerprint);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  run('npx', ['--no-install', 'supabase', 'migration', 'up', '--local']);

  const finalLedger = queryJson(database.container, `
    select coalesce(jsonb_agg(version order by version), '[]'::jsonb)
    from supabase_migrations.schema_migrations;
  `);
  assert.deepEqual(finalLedger, [baselineVersion, contractsVersion]);

  const finalCatalog = buildCanonicalCatalog(database);
  assert.equal(hashCanonicalCatalog(finalCatalog).sha256, expectedFinalFingerprint);
  assert.equal(finalCatalog.declarative_rows.modalities.length, 6);
  assert.equal(finalCatalog.declarative_rows.competition_formats.length, 5);
  assert.equal(finalCatalog.cron_jobs.length, 8);

  console.log([
    'segunda migración fallida:',
    'objetos persistidos: 0',
    'ledger registrado: no',
    'baseline inicial intacta: sí',
    'migraciones finales: 2',
    'catálogo final correcto: sí',
  ].join('\n'));
});
