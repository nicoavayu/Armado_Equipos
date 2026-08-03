#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { main as inspectMain } from './inspect-remote-readonly.mjs';
import { main as dryRunMain } from './dry-run-readonly.mjs';
import {
  buildExecutionDryRun,
  buildReceipt,
  buildTransactionalSql,
  buildVerifySql,
  executorErrorCode,
  parseStrictArgs,
  prepareExecution,
  runPsql,
} from './single-migration-executor-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [mode, ...rawOptions] = argv;
  if (!['inspect', 'dry-run', 'apply', 'verify', 'receipt'].includes(mode)) {
    throw new Error('Mode must be one of: inspect, dry-run, apply, verify, receipt.');
  }
  if (mode === 'inspect') return inspectMain(rawOptions, env);
  const executionDryRun = mode === 'dry-run'
    && rawOptions.some((option) => option.startsWith('--plan='));
  if (mode === 'dry-run' && !executionDryRun) return dryRunMain(rawOptions);

  const options = parseStrictArgs(rawOptions);
  const contract = prepareExecution({
    repoRoot: ROOT,
    options,
    env,
    requireApproval: !executionDryRun,
    requireDatabaseUrl: !executionDryRun,
  });
  if (executionDryRun) {
    const result = buildExecutionDryRun(contract);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (mode === 'apply') {
    const migrationSql = fs.readFileSync(contract.migrationFile, 'utf8');
    const sql = buildTransactionalSql({
      migrationSql,
      execution: contract.execution,
      historyBefore: contract.historyBefore,
      historyAfter: contract.historyAfter,
    });
    await runPsql({ databaseUrl: contract.databaseUrl, sql, psql: options.psql || 'psql' });
    const result = { status: 'applied', migrationVersion: options['migration-version'],
      repositorySha: contract.expectedRepositorySha, planId: contract.plan.planId,
      postApplyPauseRequired: true };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (mode === 'verify') {
    const result = await runPsql({
      databaseUrl: contract.databaseUrl,
      sql: buildVerifySql(contract),
      psql: options.psql || 'psql',
    });
    const history = result.stdout.includes('HISTORY_OK') ? 'HISTORY_OK' : 'HISTORY_DRIFT';
    const output = { history, repositorySha: contract.expectedRepositorySha,
      planId: contract.plan.planId, remoteMutation: false };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return output;
  }
  const verification = JSON.parse(fs.readFileSync(path.resolve(String(options.verification || '')), 'utf8'));
  const receipt = buildReceipt({ contract, verification });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[torneos-a1-executor] ${executorErrorCode(error)}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
