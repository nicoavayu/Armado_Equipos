/**
 * The probe's refusals, and the proof that its default path contacts nothing.
 *
 * Every test here injects a fetch that throws if it is ever called. A probe
 * that writes an attestation into Staging as a side effect of being imported,
 * planned or misconfigured would be exactly the accident the authorization gate
 * exists to prevent, so "was fetch called?" is the assertion that matters most.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadManifest } from './readiness-lib.mjs';
import {
  AUTHORIZATION_PHRASE, ProbeError, ROLLBACK_PLAN, assertAuthorized, main, preflight,
} from './signer-gateway-probe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = loadManifest(ROOT);
const REF = manifest.environment.authorizedProjectRef;

const neverCalled = () => { throw new Error('the probe contacted the network'); };

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (overrides = {}) => [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    iss: 'supabase', ref: REF, role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600, ...overrides,
  }),
  'fixture-signature',
].join('.');

const env = (overrides = {}) => ({
  SUPABASE_URL: `https://${REF}.supabase.co`,
  TOURNAMENT_MEDIA_EXPECTED_API_HOST: `${REF}.supabase.co`,
  TOURNAMENT_MEDIA_ATTESTATION_SECRET: 'x'.repeat(48),
  SUPABASE_ANON_KEY: jwt(),
  ...overrides,
});

const capture = () => {
  const chunks = [];
  return { write: (line) => chunks.push(line), text: () => chunks.join('') };
};

const expectProbeCode = async (code, run) => assert.rejects(run, (error) => (
  error instanceof ProbeError && error.code === code
));

test('the default command contacts nothing and prints the plan', async () => {
  const out = capture();
  const code = await main([], { env: env(), fetchImpl: neverCalled, repoRoot: ROOT, write: out.write });
  assert.equal(code, 0);
  const printed = JSON.parse(out.text());
  assert.equal(printed.status, 'plan-only');
  assert.equal(printed.remoteCalls, 0);
  assert.equal(printed.executed, false);
  assert.equal(printed.request.writes, 'one signer attestation row, TTL 3600s');
  // Header names, never header values.
  assert.deepEqual(printed.request.headerNames.sort(),
    ['apikey', 'authorization', 'content-type', 'x-media-attestation-secret']);
  assert.doesNotMatch(out.text(), /x{48}/, 'the attestation secret must not be printed');
  assert.doesNotMatch(out.text(), new RegExp(jwt().slice(0, 20)));
  // The rollback travels with the plan, so nobody has to find it afterwards.
  assert.ok(printed.rollback.revocation.some((step) => /revoke_tournament_media_service_attestation/.test(step)));
  assert.ok(printed.rollback.revocation.some((step) => /expires 3600s/.test(step)));
});

test('run is refused without all three authorizations, and never reaches the network', async () => {
  const cases = [
    [{}, env()],
    [{ 'i-authorize-attestation-write': true }, env()],
    [{ 'i-authorize-attestation-write': true, 'project-ref': REF },
      env({ TORNEOS_PROBE_AUTHORIZATION: 'nearly-the-phrase' })],
    [{ 'i-authorize-attestation-write': true },
      env({ TORNEOS_PROBE_AUTHORIZATION: AUTHORIZATION_PHRASE })],
  ];
  for (const [options, environment] of cases) {
    assert.throws(() => assertAuthorized({ options, env: environment, expectedRef: REF }),
      (error) => error instanceof ProbeError);
  }
  // Through the entrypoint, with a fetch that would blow up if it were reached.
  await expectProbeCode('PROBE_NOT_AUTHORIZED', () => main(['run'], {
    env: env(), fetchImpl: neverCalled, repoRoot: ROOT, write: () => {},
  }));
});

test('all three authorizations together are accepted', () => {
  assert.equal(assertAuthorized({
    options: { 'i-authorize-attestation-write': true, 'project-ref': REF },
    env: env({ TORNEOS_PROBE_AUTHORIZATION: AUTHORIZATION_PHRASE }),
    expectedRef: REF,
  }), true);
});

test('a probe aimed anywhere but authorized staging is refused before running', async () => {
  const production = manifest.environment.forbiddenProjectRefs[0];
  const authorized = {
    TORNEOS_PROBE_AUTHORIZATION: AUTHORIZATION_PHRASE,
  };
  // A production URL fails the renewer config first, and the preflight second.
  const result = preflight({
    env: env({
      ...authorized,
      SUPABASE_URL: `https://${production}.supabase.co`,
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: `${production}.supabase.co`,
    }),
    repoRoot: ROOT,
  });
  assert.equal(result.ok, false);
  await expectProbeCode('PROBE_TARGET_UNCONFIRMED', () => main(
    ['run', '--i-authorize-attestation-write', `--project-ref=${production}`],
    { env: env(authorized), fetchImpl: neverCalled, repoRoot: ROOT, write: () => {} },
  ));
});

test('a credential that verify_jwt would reject fails the preflight, so the probe is not run', async () => {
  const { ok, checks } = preflight({
    env: { ...env(), SUPABASE_ANON_KEY: undefined, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_not_a_jwt' },
    repoRoot: ROOT,
  });
  assert.equal(ok, false);
  const shape = checks.find(({ check }) => check === 'credential-shape');
  assert.equal(shape.ok, false);
  assert.equal(shape.code, 'RENEWER_GATEWAY_JWT_REQUIRED');

  await expectProbeCode('PROBE_PREFLIGHT_FAILED', () => main(
    ['run', '--i-authorize-attestation-write', `--project-ref=${REF}`],
    {
      env: {
        ...env({ TORNEOS_PROBE_AUTHORIZATION: AUTHORIZATION_PHRASE }),
        SUPABASE_ANON_KEY: undefined,
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_not_a_jwt',
      },
      fetchImpl: neverCalled,
      repoRoot: ROOT,
      write: () => {},
    },
  ));
});

test('an authorized run makes exactly one request and reports the layer, not the body', async () => {
  const calls = [];
  const out = capture();
  const code = await main(['run', '--i-authorize-attestation-write', `--project-ref=${REF}`], {
    env: env({ TORNEOS_PROBE_AUTHORIZATION: AUTHORIZATION_PHRASE }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 401, json: async () => ({ secretEvidence: 'must not be printed' }) };
    },
    repoRoot: ROOT,
    write: out.write,
  });
  assert.equal(calls.length, 1, 'a one-shot probe makes one call');
  assert.equal(code, 1);
  const printed = JSON.parse(out.text());
  assert.equal(printed.outcome.layer, 'gateway-rejected-bearer');
  assert.equal(printed.outcome.attestationWritten, false);
  assert.doesNotMatch(out.text(), /secretEvidence/);
  // The secret travelled in a header, never in the URL or the body.
  assert.doesNotMatch(calls[0].url, /x{10}/);
  assert.equal(calls[0].init.body, JSON.stringify({ action: 'health' }));
  assert.equal(calls[0].init.headers['x-media-attestation-secret'], 'x'.repeat(48));
});

test('a 200 is reported as a state change with a rollback attached', async () => {
  const out = capture();
  const code = await main(['run', '--i-authorize-attestation-write', `--project-ref=${REF}`], {
    env: env({ TORNEOS_PROBE_AUTHORIZATION: AUTHORIZATION_PHRASE }),
    fetchImpl: async () => ({ status: 200, json: async () => ({ service: 'signer' }) }),
    repoRoot: ROOT,
    write: out.write,
  });
  assert.equal(code, 0);
  const printed = JSON.parse(out.text());
  assert.equal(printed.outcome.attestationWritten, true);
  assert.ok(printed.rollback.ifTheProbeSucceedsUnexpectedly.includes('not a green light'));
});

test('the repository records the probe as prepared and never executed', () => {
  const declared = manifest.signerAttestationRenewal.gatewayProbe;
  assert.equal(declared.executedInThisChange, false);
  assert.equal(declared.requiresExplicitAuthorization, true);
  assert.equal(declared.entrypoint, 'scripts/torneos-staging/signer-gateway-probe.mjs');
  assert.ok(fs.existsSync(path.join(ROOT, declared.runbook)));
  assert.match(ROLLBACK_PLAN.whatTheProbeChanges.join(' '), /tournament_media_service_attestations/);
  assert.match(ROLLBACK_PLAN.whatItDoesNotChange.join(' '), /No feature flag/);
});
