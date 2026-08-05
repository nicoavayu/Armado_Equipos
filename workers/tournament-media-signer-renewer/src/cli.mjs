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
 * Both shapes take the same exclusive lock and, when a state file is
 * configured, share the same persisted failure counter — so alternating
 * between them, or accidentally running both, cannot produce two independent
 * views of how the renewal is going.
 *
 * ---------------------------------------------------------------------------
 * Alerting in `--once`
 * ---------------------------------------------------------------------------
 * `--once` has no memory of its own, so there are exactly two supported ways to
 * make its alert real, and one unsupported one:
 *
 *   1. Set TOURNAMENT_MEDIA_RENEW_STATE_FILE. The counter, the last success and
 *      the alerting flag survive between runs, `renewal_alert` fires on the
 *      configured consecutive-failure threshold, and a later success emits
 *      `renewal_recovered` and clears the state. This is the recommended shape.
 *
 *   2. Let the orchestrator do it. Exit 1 is a failed renewal; configure the
 *      timer/CronJob to alert on N consecutive non-zero exits (systemd
 *      OnFailure=, Kubernetes CronJob failure history plus an alert rule on
 *      kube_job_status_failed, or whatever the scheduler offers). The renewer
 *      then emits no consecutive-failure metric at all, and the runbook must
 *      say so, because the observability catalog lists that metric as required.
 *
 *   3. NOT supported: `--once` with no state file and no orchestrator rule. The
 *      counter restarts at zero on every run, the threshold is never reached,
 *      and the pipeline looks quiet while the attestation expires. The process
 *      warns about exactly this at start-up.
 *
 * NOTHING here is wired to a real scheduler in this change. See
 * docs/operations/tournament-media-signer-attestation-renewal.md.
 */

import process from 'node:process';

import { RenewerConfigError, readRenewerConfig } from './config.mjs';
import {
  OUTCOME, createInterruptibleSleep, createLogger, createRenewerState, installShutdownHandlers,
  persistableState, runRenewalCycle, runRenewalLoop, secretValues,
} from './renewer.mjs';
import {
  RenewerStateError, acquireLock, emptyState, lockPathFor, readState, writeState,
} from './state-store.mjs';

const refuse = (code, message) => {
  process.stderr.write(`${JSON.stringify({
    at: new Date().toISOString(),
    component: 'signer-attestation-renewer',
    event: 'startup_refused',
    code,
    message: String(message || ''),
  })}\n`);
  return 1;
};

async function main(argv = process.argv.slice(2)) {
  let config;
  try {
    config = readRenewerConfig(process.env);
  } catch (error) {
    // The config error never carries a value, only a variable name and a rule.
    return refuse(error instanceof RenewerConfigError ? error.code : 'RENEWER_MISCONFIGURED',
      error?.message);
  }

  const once = argv.includes('--once');
  const statePath = config.statePath;

  // Corruption, a widened mode and a held lock are all start-up refusals: none
  // of them may be papered over by starting with a fresh counter.
  let lock = null;
  let persisted = emptyState();
  try {
    if (statePath) {
      lock = acquireLock(lockPathFor(statePath));
      persisted = readState(statePath).state;
    }
  } catch (error) {
    lock?.release();
    return refuse(error instanceof RenewerStateError ? error.code : 'RENEWER_STATE_FAILURE',
      error?.message);
  }

  const log = createLogger({ secrets: secretValues(config) });
  const state = createRenewerState(persisted);

  if (once && !statePath) {
    // Not fatal — option 2 above is legitimate — but it may never be silent.
    log('once_without_state', {
      severity: 'warning',
      message: 'Consecutive-failure alerting is delegated to the orchestrator exit code; '
        + 'this process cannot count failures across runs without TOURNAMENT_MEDIA_RENEW_STATE_FILE.',
      runbook: 'docs/operations/tournament-media-signer-attestation-renewal.md#modo---once',
    });
  }

  const persist = () => {
    if (!statePath) return;
    try {
      writeState(statePath, persistableState(state));
    } catch (error) {
      log('state_write_failed', {
        severity: 'critical',
        code: error instanceof RenewerStateError ? error.code : 'RENEWER_STATE_WRITE_FAILED',
      });
    }
  };

  try {
    if (once) {
      const { outcome } = await runRenewalCycle({ state, config, deps: { log } });
      persist();
      return outcome === OUTCOME.RENEWED ? 0 : 1;
    }

    let stopping = false;
    const napper = createInterruptibleSleep();
    const removeHandlers = installShutdownHandlers({
      onSignal: (signal) => {
        stopping = true;
        log('shutdown_requested', { signal });
        // Cut the current interval short instead of waiting it out.
        napper.cancel();
      },
    });
    // No revocation on shutdown: this process is not the signer and must never
    // speak for it. The attestation expires by itself, which is the fail-closed
    // path the pipeline already relies on.
    try {
      await runRenewalLoop({
        config,
        state,
        deps: { log, sleep: napper.sleep },
        shouldContinue: () => !stopping,
      });
    } finally {
      removeHandlers();
      napper.cancel();
      persist();
    }
    return 0;
  } finally {
    lock?.release();
  }
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
