#!/usr/bin/env node
/**
 * Container/timer entrypoint for the signer attestation renewer.
 *
 * Two shapes, one behaviour:
 *   --once   a single renewal cycle, for an external scheduler (systemd timer,
 *            Kubernetes CronJob, the orchestrator that already runs the media
 *            worker). Exit 0 renewed, exit 1 not renewed.
 *   default  a long-lived loop that paces itself, for a plain container
 *            alongside `workers/tournament-media-processor`.
 *
 * NOTHING here is wired to a real scheduler in this change. See
 * docs/operations/tournament-media-signer-attestation-renewal.md.
 */

import process from 'node:process';

import { RenewerConfigError, readRenewerConfig } from './config.mjs';
import {
  OUTCOME, createLogger, createRenewerState, runRenewalCycle, runRenewalLoop, secretValues,
} from './renewer.mjs';

async function main(argv = process.argv.slice(2)) {
  let config;
  try {
    config = readRenewerConfig(process.env);
  } catch (error) {
    // The config error never carries a value, only a variable name and a rule.
    const code = error instanceof RenewerConfigError ? error.code : 'RENEWER_MISCONFIGURED';
    process.stderr.write(`${JSON.stringify({
      at: new Date().toISOString(),
      component: 'signer-attestation-renewer',
      event: 'startup_refused',
      code,
      message: String(error?.message || ''),
    })}\n`);
    return 1;
  }
  const log = createLogger({ secrets: secretValues(config) });
  const state = createRenewerState();

  if (argv.includes('--once')) {
    const { outcome } = await runRenewalCycle({ state, config, deps: { log } });
    return outcome === OUTCOME.RENEWED ? 0 : 1;
  }

  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      stopping = true;
      log('shutdown_requested', { signal });
    });
  }
  // No revocation on shutdown: this process is not the signer and must never
  // speak for it. The attestation expires by itself, which is the fail-closed
  // path the pipeline already relies on.
  await runRenewalLoop({ config, state, deps: { log }, shouldContinue: () => !stopping });
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('cli.mjs');
if (isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      at: new Date().toISOString(),
      component: 'signer-attestation-renewer',
      event: 'fatal',
      message: String(error?.message || error),
    })}\n`);
    process.exitCode = 1;
  });
}

export { main };
