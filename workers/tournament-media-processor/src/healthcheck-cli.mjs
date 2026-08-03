#!/usr/bin/env node

// A strict container healthcheck: real sharp/libvips, clamd/freshclam and
// read/write/delete against the configured private bucket. It never attests.

import * as codec from './codec.mjs';
import { createAntivirus, defaultAntivirusConfig } from './antivirus.mjs';
import { runWorkerSelfTest } from './selfTest.mjs';
import { createStorageClient, readConfig } from './supabase.mjs';

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 22) {
  process.stderr.write('WORKER_HEALTH_FAILED node-major\n');
  process.exit(1);
}

try {
  const config = readConfig();
  const result = await runWorkerSelfTest({
    codec,
    antivirus: createAntivirus(defaultAntivirusConfig()),
    storage: createStorageClient(config),
  });
  process.stdout.write(`${JSON.stringify({
    healthy: result.passed,
    checks: result.checks,
    codec: result.evidence.codec?.name || null,
    antivirus: result.evidence.antivirus?.name || null,
  })}\n`);
  process.exit(result.passed ? 0 : 1);
} catch (error) {
  process.stderr.write(`WORKER_HEALTH_FAILED ${String(error?.message || error)}\n`);
  process.exit(1);
}
