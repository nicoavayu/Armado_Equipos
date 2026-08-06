#!/usr/bin/env node
/**
 * One-shot probe of the signer gateway credential against Staging.
 *
 * PREPARED, NOT EXECUTED. Nothing in this change has run it, and its default
 * command contacts nothing at all.
 *
 * ---------------------------------------------------------------------------
 * Why it needs explicit authorization
 * ---------------------------------------------------------------------------
 * There is no read-only way to ask the signer whether a gateway credential
 * works. The only endpoint that answers is `health`, and `health` is not a
 * query: it uploads a probe object, signs it, reads it back, deletes it, and
 * then WRITES an attestation row with a 3600s TTL via
 * `attest_tournament_media_service('signer', ...)`.
 *
 * So a "just checking the credential" run mutates Staging in a way that feeds
 * `tournament_media_pipeline_readiness()`. That is a state change with a
 * blast radius, and it may not happen as a side effect of debugging. Hence:
 *
 *   - the default command is `plan`, which prints the exact request and
 *     contacts nothing;
 *   - `run` requires three independent authorizations that cannot be supplied
 *     by accident (a flag, an env phrase, and the project ref spelled out);
 *   - every refusal is exit 1 with a code, never a silent no-op;
 *   - the rollback is printed by `plan`, so nobody has to look it up after the
 *     fact.
 *
 * Usage:
 *   node scripts/torneos-staging/signer-gateway-probe.mjs plan
 *   node scripts/torneos-staging/signer-gateway-probe.mjs run \
 *     --i-authorize-attestation-write --project-ref=<staging ref>
 *   (with TORNEOS_PROBE_AUTHORIZATION set to the exact phrase below)
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { assertSanitizedOutput, loadManifest } from './readiness-lib.mjs';
import { readRenewerConfig } from '../../workers/tournament-media-signer-renewer/src/config.mjs';
import { GATEWAY_CREDENTIAL_OPTIONS, REJECTED_GATEWAY_CREDENTIALS } from '../../workers/tournament-media-signer-renewer/src/gateway.mjs';
import { TargetError, createTarget, fetchAuthorized } from '../../workers/tournament-media-signer-renewer/src/target.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Typed to the letter, so it cannot be produced by a stray `export`. */
export const AUTHORIZATION_PHRASE = 'yes-write-a-signer-attestation-in-staging';

export class ProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
  }
}

/**
 * The exact rollback for the one row this probe can create. It is part of the
 * printed plan, not an appendix: an attestation written by a probe is
 * indistinguishable from one written by the renewer, and `uploadReady` reads
 * both the same way.
 */
export const ROLLBACK_PLAN = Object.freeze({
  whatTheProbeChanges: [
    'One row in public.tournament_media_service_attestations for service = \'signer\', '
      + 'inserted or refreshed with a 3600s TTL by the signer itself.',
    'One transient object under the _probe/ prefix of the tournament-media bucket, which the '
      + 'signer deletes in a finally block during the same request.',
  ],
  whatItDoesNotChange: [
    'No feature flag. REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED and '
      + 'REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY are untouched and stay false.',
    'No migration, no Secret, no Edge Function deployment, no worker.',
    'No user data of any kind.',
  ],
  revocation: [
    '1. Decide within the TTL. Doing nothing is already a valid rollback: the attestation '
      + 'expires 3600s after the probe and uploadReady closes on its own.',
    '2. To close it immediately, revoke through the approved flow: '
      + 'select public.revoke_tournament_media_service_attestation(p_service := \'signer\'); '
      + 'run with the service credential from the authorized operator host, never from CI '
      + 'and never from a browser.',
    '3. Verify closure by re-reading the verdict, not by assuming it: '
      + 'select public.tournament_media_pipeline_readiness(); expect uploadReady false and a '
      + 'signer attestation blocker.',
    '4. Confirm no residue: no object older than the grace period under the _probe/ prefix. '
      + 'If one is left, the signer\'s delete path failed and that is an incident of its own '
      + '(docs/operations/tournament-media-observability.md#residual-objects).',
    '5. Record the run: timestamp, operator, project ref, resulting status code and whether '
      + 'the attestation was revoked or left to expire.',
  ],
  ifTheProbeSucceedsUnexpectedly: 'A 200 means the gateway credential works AND a fresh signer '
    + 'attestation now exists. That is a state change to disclose in the PR, not a green light: '
    + 'Multimedia enablement still requires every other gate, including observability, which is '
    + 'closed.',
  ifTheProbeFails: 'A 401 is the gateway refusing the bearer, which is the exact failure this '
    + 'probe exists to distinguish from a 403. Nothing was written, so there is nothing to roll '
    + 'back. A 403 means the gateway accepted the credential and the signer refused the '
    + 'attestation secret; also nothing written.',
});

const parse = (argv) => {
  const positional = [];
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      const [key, ...rest] = arg.slice(2).split('=');
      options[key] = rest.length ? rest.join('=') : true;
    }
  }
  return { command: positional[0] || 'plan', options };
};

/**
 * Local preflight. Everything that can be decided without a network call is
 * decided without a network call: the credential shape, the target host, the
 * project ref. A probe that would obviously 401 should never be run at all.
 */
export function preflight({ env = process.env, repoRoot = ROOT } = {}) {
  const manifest = loadManifest(repoRoot);
  const checks = [];
  let config = null;
  try {
    config = readRenewerConfig(env);
    checks.push({ check: 'credential-shape', ok: true, detail: config.gatewayCredentialKind });
  } catch (error) {
    checks.push({ check: 'credential-shape', ok: false, code: error.code, detail: error.message });
  }
  const expectedRef = manifest.environment.authorizedProjectRef;
  const targetRef = config ? config.projectRef : null;
  checks.push({
    check: 'target-is-authorized-staging',
    ok: targetRef === expectedRef,
    detail: targetRef === expectedRef ? 'authorized staging ref' : 'target is not the authorized staging ref',
  });
  checks.push({
    check: 'target-is-not-production',
    ok: targetRef === null || !manifest.environment.forbiddenProjectRefs.includes(targetRef),
    detail: 'production project refs are refused unconditionally',
  });

  // The descriptor the request will actually be validated against, rebuilt here
  // with the MANIFEST's forbidden refs rather than only the environment's. The
  // renewer's own descriptor knows about `TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS`
  // and nothing else, so an operator who simply forgot to export that variable
  // would have lost the production block for this probe. The manifest is the
  // repository's own statement about which refs are Production, and it is not
  // optional.
  let target = null;
  if (config) {
    try {
      target = createTarget({
        origin: config.origin,
        functionName: config.functionName,
        projectRef: config.projectRef,
        forbiddenHosts: config.target.forbiddenHosts,
        forbiddenProjectRefs: [
          ...config.target.forbiddenProjectRefs,
          ...manifest.environment.forbiddenProjectRefs,
        ],
      });
      checks.push({ check: 'target-descriptor', ok: true, detail: 'redirects refused, path pinned' });
    } catch (error) {
      checks.push({ check: 'target-descriptor', ok: false, code: error.code, detail: error.message });
    }
  }
  return { ok: checks.every(({ ok }) => ok), checks, config, target };
}

/**
 * Three independent authorizations. Any one of them missing is a refusal, and
 * each one is something a person has to mean: a flag they typed, a phrase they
 * exported, and the project ref they wrote out.
 */
export function assertAuthorized({ options, env = process.env, expectedRef }) {
  if (options['i-authorize-attestation-write'] !== true) {
    throw new ProbeError('PROBE_NOT_AUTHORIZED',
      'Refusing: the signer health probe WRITES an attestation. Pass --i-authorize-attestation-write.');
  }
  if (String(env.TORNEOS_PROBE_AUTHORIZATION || '') !== AUTHORIZATION_PHRASE) {
    throw new ProbeError('PROBE_NOT_AUTHORIZED',
      `Refusing: TORNEOS_PROBE_AUTHORIZATION must be set to the exact phrase "${AUTHORIZATION_PHRASE}".`);
  }
  if (String(options['project-ref'] || '') !== expectedRef) {
    throw new ProbeError('PROBE_TARGET_UNCONFIRMED',
      'Refusing: --project-ref must spell out the authorized staging project ref.');
  }
  return true;
}

/** The request, described rather than made. Header values are never included. */
export const describeRequest = (config, target = null) => ({
  method: 'POST',
  url: config ? config.healthUrl : '<resolved from SUPABASE_URL at run time>',
  headerNames: ['content-type', 'apikey', 'authorization', 'x-media-attestation-secret'],
  body: { action: 'health' },
  timeoutMs: config ? config.timeoutMs : null,
  writes: 'one signer attestation row, TTL 3600s',
  // Stated in the plan because it is the property that decides where the
  // attestation secret can end up, and a reviewer should not have to read the
  // transport to find out.
  redirectPolicy: 'refused (redirect: error); no credential is ever re-sent to a Location host',
  authorizedOrigin: target ? target.origin : null,
  authorizedPath: target ? target.path : null,
  forbiddenProjectRefs: target ? target.forbiddenProjectRefs : [],
});

export async function main(argv = process.argv.slice(2), {
  env = process.env, fetchImpl = null, repoRoot = ROOT, write = (line) => process.stdout.write(line),
} = {}) {
  const { command, options } = parse(argv);
  const manifest = loadManifest(repoRoot);
  const expectedRef = manifest.environment.authorizedProjectRef;

  if (command === 'plan') {
    const { ok, checks, config, target } = preflight({ env, repoRoot });
    const output = `${JSON.stringify({
      status: 'plan-only',
      remoteCalls: 0,
      executed: false,
      preflightOk: ok,
      preflight: checks,
      request: describeRequest(config, target),
      acceptedCredentials: GATEWAY_CREDENTIAL_OPTIONS,
      rejectedCredentials: REJECTED_GATEWAY_CREDENTIALS,
      authorizationRequired: {
        flag: '--i-authorize-attestation-write',
        env: 'TORNEOS_PROBE_AUTHORIZATION',
        phrase: AUTHORIZATION_PHRASE,
        projectRef: '--project-ref=<authorized staging ref>',
      },
      rollback: ROLLBACK_PLAN,
    }, null, 2)}\n`;
    assertSanitizedOutput(output);
    write(output);
    return 0;
  }

  if (command !== 'run') {
    throw new ProbeError('COMMAND_UNKNOWN', `Unknown command ${command}.`);
  }

  assertAuthorized({ options, env, expectedRef });
  const { ok, checks, config, target } = preflight({ env, repoRoot });
  if (!ok) {
    throw new ProbeError('PROBE_PREFLIGHT_FAILED',
      `Refusing: ${checks.filter((check) => !check.ok).map(({ check }) => check).join(', ')}.`);
  }

  let outcome;
  try {
    // Same guarded transport as the renewer: the URL is re-validated against
    // the descriptor immediately before the call, and a redirect is refused
    // before any credential can be serialised toward the host it names.
    const response = await fetchAuthorized(config.healthUrl, {
      target,
      fetchImpl: fetchImpl || fetch,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apikey,
        Authorization: `Bearer ${config.authorizationJwt}`,
        'x-media-attestation-secret': config.attestationSecret,
      },
      body: JSON.stringify({ action: 'health' }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    // Only the status and the shape are reported. The body may carry evidence
    // fields, and none of them belong in a terminal transcript.
    outcome = {
      status: response.status,
      // 401 is the gateway; 403 is the signer. Telling them apart is the whole
      // reason this probe exists.
      layer: response.status === 401 ? 'gateway-rejected-bearer'
        : response.status === 403 ? 'signer-rejected-attestation-secret'
          : response.status === 200 ? 'signer-attested' : 'other',
      attestationWritten: response.status === 200,
    };
  } catch (error) {
    if (error instanceof TargetError) {
      // Nothing was written and nothing was sent onward, so this is a refusal
      // to report rather than a state change to roll back.
      throw new ProbeError(error.code, error.message);
    }
    throw error;
  }
  const output = `${JSON.stringify({
    status: 'executed',
    remoteCalls: 1,
    outcome,
    rollback: ROLLBACK_PLAN,
  }, null, 2)}\n`;
  assertSanitizedOutput(output);
  write(output);
  return outcome.status === 200 ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[torneos-signer-gateway-probe] ${error.code || 'PROBE_FAILURE'}: ${error.message}`);
    process.exitCode = 1;
  });
}
