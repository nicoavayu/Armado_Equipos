#!/usr/bin/env node
/**
 * Runs the worker self-test and prints the result, without attesting anything.
 *
 * This is the command that answers "would this host be allowed to certify the
 * pipeline?" — useful before wiring a backend, and used by
 * `test:worker:media:selftest` to report the real codec and antivirus verdict
 * on whatever machine the suite runs on.
 */

import * as codec from './codec.mjs';
import { createAntivirus, defaultAntivirusConfig } from './antivirus.mjs';
import { runWorkerSelfTest } from './selfTest.mjs';

const storage = process.env.SUPABASE_URL
  ? (await import('./supabase.mjs')).createStorageClient(
    (await import('./supabase.mjs')).readConfig(),
  )
  : {
    // No backend configured: the two Storage checks legitimately fail, which
    // is reported as such rather than skipped.
    async upload() { throw new Error('STORAGE_NOT_CONFIGURED'); },
    async download() { throw new Error('STORAGE_NOT_CONFIGURED'); },
    async remove() { throw new Error('STORAGE_NOT_CONFIGURED'); },
  };

const result = await runWorkerSelfTest({
  codec, antivirus: createAntivirus(defaultAntivirusConfig()), storage,
});

const wouldAttest = Object.entries(result.checks)
  .filter(([, passed]) => passed === true)
  .map(([name]) => name);

process.stdout.write(`${JSON.stringify({
  passed: result.passed,
  checks: result.checks,
  codec: result.evidence.codec || null,
  antivirus: result.evidence.antivirus || null,
  wouldAttest,
}, null, 2)}\n`);

// A failed self-test is not a broken worker: it is a worker that must not
// certify. Exit 0 so the report is the deliverable, and let the caller read
// `passed`.
process.exit(0);
