#!/usr/bin/env node
/**
 * The worker loop.
 *
 * Attest → lease → process → re-attest. The attestation is short-lived on
 * purpose: if this process dies, hangs, loses libvips or loses clamd, it stops
 * renewing, the row expires inside fifteen minutes and `uploadReady` closes on
 * its own. No deploy, no toggle, no human.
 *
 * This file is never imported by the app, by the Edge functions or by any test
 * that runs in CI. It is the container entrypoint.
 */

import * as codec from './codec.mjs';
import { createAntivirus, defaultAntivirusConfig } from './antivirus.mjs';
import { processMediaJob } from './pipeline.mjs';
import { buildAttestation, runWorkerSelfTest } from './selfTest.mjs';
import { createDbClient, createStorageClient, readConfig } from './supabase.mjs';

function log(event, detail = {}) {
  // Structured, and deliberately free of object names, tokens and identities.
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...detail })}\n`);
}

async function attestOnce(config, db, storage, antivirus) {
  const selfTest = await runWorkerSelfTest({ codec, antivirus, storage });
  if (!selfTest.passed) {
    log('self_test_failed', { checks: selfTest.checks });
    try {
      await db.revoke();
    } catch {
      // It expires by itself; revoking is only faster.
    }
    return { attested: false, selfTest };
  }
  const fingerprint = await db.backendFingerprint();
  const attestation = buildAttestation(selfTest, { backendFingerprint: fingerprint });
  await db.attest(config.release, attestation, config.attestTtlSeconds);
  log('attested', { release: config.release, ttlSeconds: config.attestTtlSeconds });
  return { attested: true, selfTest };
}

async function main() {
  const config = readConfig();
  const db = createDbClient(config);
  const storage = createStorageClient(config);
  const antivirus = createAntivirus(defaultAntivirusConfig());

  let attestedAt = 0;
  for (;;) {
    try {
      // Re-attest at a third of the TTL so a transient failure never leaves a
      // stale claim standing.
      if (Date.now() - attestedAt > (config.attestTtlSeconds * 1000) / 3) {
        const result = await attestOnce(config, db, storage, antivirus);
        attestedAt = result.attested ? Date.now() : 0;
      }
      await db.sweep(200);
      const leased = await db.lease(config.workerId, config.leaseSeconds, config.batchSize);
      const jobs = leased?.jobs || [];
      if (jobs.length === 0) {
        await new Promise((resolve) => { setTimeout(resolve, config.pollMs); });
        continue;
      }
      for (const job of jobs) {
        const outcome = await processMediaJob(job, {
          storage, codec, antivirus, db, logger: log,
        });
        log('job_finished', {
          jobId: outcome.jobId, status: outcome.status, code: outcome.code || null,
        });
      }
    } catch (error) {
      log('loop_error', { error: String(error?.message || error) });
      await new Promise((resolve) => { setTimeout(resolve, config.pollMs); });
    }
  }
}

main().catch((error) => {
  log('fatal', { error: String(error?.message || error) });
  process.exit(1);
});
