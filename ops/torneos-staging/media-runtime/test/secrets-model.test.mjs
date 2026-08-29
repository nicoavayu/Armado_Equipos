/**
 * The secret model: who gets which credential, by which mechanism, and what a
 * reader of the running host would be able to see.
 *
 * Three separate claims are checked here, and they are separate on purpose:
 *
 *   1. ISOLATION — each secret reaches exactly one service. This is a property
 *      of the manifest and is fully decidable from it.
 *   2. MECHANISM — no credential is passed by VALUE. Also decidable here.
 *   3. THE CODE GAP — whether the file mechanism the manifest wires is actually
 *      honoured by the workers. This is a property of the WORKER SOURCE, so it
 *      is read from the worker source rather than asserted in prose.
 *
 * Claim 3 is written as an invariant that holds in BOTH states: either the code
 * supports `*_FILE`, or the manifest is wired fail-closed and the gap is
 * documented. PR #139 added `*_FILE` support to both workers, so the gap is now
 * CLOSED and this test takes its first branch — which is exactly what writing it
 * as a two-state invariant was for: it kept passing across the change instead of
 * turning into an obstacle. The second branch is kept, not deleted, because it is
 * what would catch the support being reverted or an image being built from a
 * revision that predates it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { flatten, parseYamlSubset } from '../lib/compose-subset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const RUNTIME = path.join(HERE, '..');

const source = fs.readFileSync(path.join(RUNTIME, 'docker-compose.staging.yml'), 'utf8');
const compose = parseYamlSubset(source);
const services = compose.services;

const PROCESSOR_SRC = path.join(REPO, 'workers/tournament-media-processor/src');
const RENEWER_SRC = path.join(REPO, 'workers/tournament-media-signer-renewer/src');

const readSrc = (dir) => fs.readdirSync(dir)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n');

// ---------------------------------------------------------------------------
// 1. Isolation
// ---------------------------------------------------------------------------

test('each secret is declared once and mounted into exactly one service', () => {
  assert.deepEqual(Object.keys(compose.secrets).sort(),
    ['attestation_secret', 'gateway_jwt', 'supabase_service_role_key']);

  const holders = {};
  for (const [name, service] of Object.entries(services)) {
    for (const secret of service.secrets || []) {
      (holders[secret] ||= []).push(name);
    }
  }
  assert.deepEqual(holders, {
    supabase_service_role_key: ['processor'],
    attestation_secret: ['renewer'],
    gateway_jwt: ['renewer'],
  });
});

test('the processor never receives the attestation secret or the gateway JWT', () => {
  // The processor attests through a service-role RPC. The attestation SECRET is
  // what authorises the signer's own health action, and the processor has no
  // use for it — holding it would put the signer's authority inside the one
  // container that also decodes attacker-supplied pixels.
  const p = services.processor;
  assert.ok(!(p.secrets || []).includes('attestation_secret'));
  assert.ok(!(p.secrets || []).includes('gateway_jwt'));
  for (const key of Object.keys(p.environment)) {
    assert.ok(!/ATTESTATION_SECRET|GATEWAY_JWT|GATEWAY_KEY|ANON_KEY|PUBLISHABLE/.test(key),
      `the processor is given ${key}`);
  }
  // And the source agrees: it never reads them.
  const src = readSrc(PROCESSOR_SRC);
  assert.ok(!src.includes('TOURNAMENT_MEDIA_ATTESTATION_SECRET'),
    'the processor source reads the attestation secret');
});

test('the renewer never receives a service credential', () => {
  const r = services.renewer;
  assert.ok(!(r.secrets || []).includes('supabase_service_role_key'));
  for (const key of Object.keys(r.environment)) {
    assert.ok(!/SERVICE_ROLE|SECRET_KEY/.test(key), `the renewer is given ${key}`);
  }
  // Enforced at run time too, not only by omission here.
  const src = readSrc(RENEWER_SRC);
  assert.ok(src.includes('RENEWER_GATEWAY_KEY_PRIVILEGED'),
    'the renewer no longer refuses a privileged gateway credential at start-up');
});

test('clamav receives no Supabase configuration of any kind', () => {
  // The antivirus container is the one that parses hostile bytes. It has no
  // reason to know that Supabase exists, and every reason not to.
  for (const [key, value] of Object.entries(services.clamd.environment)) {
    assert.ok(!/SUPABASE|TOURNAMENT_MEDIA/.test(key), `clamd is given ${key}`);
    assert.ok(!/supabase/i.test(String(value)), `clamd's ${key} names Supabase`);
  }
  assert.equal(services.clamd.secrets, undefined, 'clamd is given a secret');
});

// ---------------------------------------------------------------------------
// 2. Mechanism
// ---------------------------------------------------------------------------

test('no credential is passed by value anywhere in the manifest', () => {
  const CREDENTIAL_KEY = /(SERVICE_ROLE|SECRET|_KEY|JWT|TOKEN|PASSWORD)/;
  for (const [where, value] of flatten(compose)) {
    const key = where.split('.').pop();
    if (!CREDENTIAL_KEY.test(key)) continue;
    // A credential-shaped key may only ever carry a PATH into /run/secrets.
    assert.match(String(value), /^\/run\/secrets\/[a-z_]+$/,
      `${where} carries something other than a secrets path`);
  }
});

test('every secret is a host file, and the host directory has no default', () => {
  for (const [name, spec] of Object.entries(compose.secrets)) {
    assert.ok(spec.file, `${name} is not file-based`);
    assert.ok(spec.file.startsWith('${ARMA2_MEDIA_SECRET_DIR:?'),
      `${name} resolves from something other than a required host variable`);
    assert.ok(!spec.environment, `${name} is sourced from an environment variable`);
  }
});

test('the manifest names secret PATHS, and the paths match the mounts', () => {
  assert.equal(services.processor.environment.SUPABASE_SERVICE_ROLE_KEY_FILE,
    '/run/secrets/supabase_service_role_key');
  assert.equal(services.renewer.environment.TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE,
    '/run/secrets/attestation_secret');
  assert.equal(services.renewer.environment.TOURNAMENT_MEDIA_GATEWAY_JWT_FILE,
    '/run/secrets/gateway_jwt');
  // The plain-value forms must be absent: their presence is what would put the
  // credential into Config.Env, where `docker inspect` prints it.
  assert.equal(services.processor.environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(services.processor.environment.SUPABASE_SECRET_KEY, undefined);
  assert.equal(services.renewer.environment.TOURNAMENT_MEDIA_ATTESTATION_SECRET, undefined);
  assert.equal(services.renewer.environment.TOURNAMENT_MEDIA_GATEWAY_JWT, undefined);
});

// ---------------------------------------------------------------------------
// 3. The code gap
// ---------------------------------------------------------------------------

/** Whether a worker's source honours a `*_FILE` form of the given variable. */
const supportsFile = (src, variable) => src.includes(`${variable}_FILE`);

test('SECRET_INJECTION_CODE_GAP: file injection is wired, and either honoured or documented', () => {
  const cases = [
    ['processor', readSrc(PROCESSOR_SRC), 'SUPABASE_SERVICE_ROLE_KEY'],
    ['renewer', readSrc(RENEWER_SRC), 'TOURNAMENT_MEDIA_ATTESTATION_SECRET'],
    ['renewer', readSrc(RENEWER_SRC), 'TOURNAMENT_MEDIA_GATEWAY_JWT'],
  ];
  const gaps = [];
  for (const [service, src, variable] of cases) {
    // The variable must be read from the environment at all — otherwise this
    // test is checking a name nothing uses.
    assert.ok(src.includes(variable), `${service} does not read ${variable}`);
    if (!supportsFile(src, variable)) gaps.push(`${service}:${variable}`);
    // Either way, the manifest passes the PATH form and never the value form.
    const env = services[service].environment;
    assert.equal(env[`${variable}_FILE`] !== undefined, true,
      `the manifest does not give ${service} ${variable}_FILE`);
    assert.equal(env[variable], undefined,
      `the manifest gives ${service} ${variable} by value`);
  }

  if (gaps.length === 0) return; // the follow-up PR landed; nothing left to gate

  // The gap is open. Two things must then be true, or the manifest is a trap:
  // the failure has to be a refusal to start rather than a silent fallback,
  // and it has to be written down where an operator will meet it.
  const doc = path.join(REPO, 'docs/operations/tournament-media-staging-secret-injection.md');
  assert.ok(fs.existsSync(doc), 'the code gap is open and undocumented');
  const text = fs.readFileSync(doc, 'utf8');
  assert.match(text, /SECRET_INJECTION_CODE_GAP/);
  for (const gap of gaps) {
    assert.ok(text.includes(gap.split(':')[1]), `${gap} is not named in the gap document`);
  }
  // Fail closed: with no value in the environment, the processor throws
  // WORKER_MISCONFIGURED and the renewer fails RENEWER_SECRET_MISSING. Neither
  // has a default, an empty-string acceptance or an unauthenticated path.
  assert.ok(readSrc(PROCESSOR_SRC).includes('WORKER_MISCONFIGURED'));
  assert.ok(readSrc(RENEWER_SRC).includes('RENEWER_SECRET_MISSING'));
  assert.match(source, /fails? CLOSED/i,
    'the manifest does not warn that the wired file injection is not yet honoured');
});

test('the entrypoint-wrapper workaround is not silently in use', () => {
  // Reading the file in a shell wrapper and exporting it before `exec node`
  // would make the stack start today. It also puts the credential back into
  // /proc/<pid>/environ, which is most of what the file mechanism was for, and
  // it does it invisibly. If it is ever adopted it must be a reviewed decision,
  // not something that appears in a manifest.
  for (const service of Object.values(services)) {
    assert.equal(service.entrypoint, undefined, 'a service overrides its entrypoint');
    assert.equal(service.command, undefined, 'a service overrides its command');
  }
  for (const [where, value] of flatten(compose)) {
    assert.ok(!/\bcat\b.*\/run\/secrets|\$\(cat/.test(String(value)),
      `${where} reads a secret file in a shell`);
  }
});
