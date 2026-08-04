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

export const MODES = Object.freeze(['inspect', 'dry-run', 'apply', 'verify', 'receipt']);

/**
 * The mode is the first positional argument, wherever it sits. Taking it positionally rather than
 * as `argv[0]` is what lets the per-stage npm scripts pin `--stage=...` ahead of the operator's
 * arguments, so the stage is fixed by the reviewed command rather than typed at the terminal.
 */
export function splitMode(argv) {
  const index = argv.findIndex((value) => !value.startsWith('--'));
  if (index === -1 || !MODES.includes(argv[index])) {
    throw new Error(`Mode must be one of: ${MODES.join(', ')}.`);
  }
  return { mode: argv[index], rawOptions: [...argv.slice(0, index), ...argv.slice(index + 1)] };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { mode, rawOptions } = splitMode(argv);
  if (mode === 'inspect') return inspectMain(rawOptions, env);
  const executionDryRun = mode === 'dry-run'
    && rawOptions.some((option) => option.startsWith('--plan='));
  if (mode === 'dry-run' && !executionDryRun) return dryRunMain(rawOptions);

  const options = parseStrictArgs(rawOptions);
  // The operational target mode comes from the CLI mode, never from a flag: there is no argument
  // that selects a different connection profile, and none that reaches the test-only exception.
  const contract = prepareExecution({
    repoRoot: ROOT,
    options,
    env,
    requireApproval: !executionDryRun,
    requireDatabaseUrl: !executionDryRun,
    targetMode: mode,
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
      stage: contract.stage,
    });
    await runPsql({ connection: contract.connection, sql, psql: options.psql || 'psql' });
    const result = { status: 'applied', stage: contract.stage,
      migrationVersion: options['migration-version'],
      repositorySha: contract.expectedRepositorySha, planId: contract.plan.planId,
      // The remote state is only asserted once it has been read back: apply never reports success
      // on its own evidence.
      reinspectionRequired: true,
      postApplyPauseRequired: true };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (mode === 'verify') {
    const result = await runPsql({
      connection: contract.connection,
      sql: buildVerifySql(contract),
      psql: options.psql || 'psql',
    });
    const history = result.stdout.includes('HISTORY_OK') ? 'HISTORY_OK' : 'HISTORY_DRIFT';
    const output = { history, stage: contract.stage, repositorySha: contract.expectedRepositorySha,
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
    process.stderr.write(`[torneos-single-migration-executor] ${executorErrorCode(error)}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
