/**
 * The Production block, tested as a property of the code rather than of a
 * deployment.
 *
 * Every case below deliberately withholds the two environment variables that
 * used to be the only thing standing between this process and Production. If
 * any of these tests can be made to pass by exporting a variable, the guarantee
 * has been lost and the test is wrong.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { RenewerConfigError, readRenewerConfig, secretValues } from '../src/config.mjs';
import {
  COMPILED_FORBIDDEN_API_HOSTS,
  COMPILED_FORBIDDEN_PROJECT_REFS,
  PRODUCTION_API_HOST,
  PRODUCTION_PROJECT_REF,
  isCompiledForbiddenHost,
  isCompiledForbiddenProjectRef,
  parseForbiddenList,
  projectRefFromHost,
  resolveForbiddenApiHosts,
  resolveForbiddenProjectRefs,
} from '../src/forbidden-targets.mjs';
import { TargetError, assertAuthorizedUrl, createTarget } from '../src/target.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
const STAGING_HOST = 'hhyvmhgpapyuzjgxfnqv.supabase.co';
const SECRET = 'a'.repeat(48);

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const makeJwt = ({ role = 'anon', ref = STAGING_REF, expSeconds = 3600 } = {}) => [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    iss: 'supabase',
    // A custom-domain credential legitimately carries no ref at all, which is a
    // different thing from carrying an empty one.
    ...(ref === null ? {} : { ref }),
    role,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
  }),
  'fixture-signature-not-verified-here',
].join('.');

/**
 * An environment that names Production twice and agrees with itself — the exact
 * shape the old code accepted. Nothing here is malformed; it is simply the
 * wrong project, stated consistently.
 */
const productionEnv = (overrides = {}) => ({
  SUPABASE_URL: `https://${PRODUCTION_API_HOST}`,
  TOURNAMENT_MEDIA_EXPECTED_API_HOST: PRODUCTION_API_HOST,
  TOURNAMENT_MEDIA_ATTESTATION_SECRET: SECRET,
  SUPABASE_ANON_KEY: makeJwt({ ref: PRODUCTION_PROJECT_REF }),
  ...overrides,
});

const stagingEnv = (overrides = {}) => ({
  SUPABASE_URL: `https://${STAGING_HOST}`,
  TOURNAMENT_MEDIA_EXPECTED_API_HOST: STAGING_HOST,
  TOURNAMENT_MEDIA_ATTESTATION_SECRET: SECRET,
  SUPABASE_ANON_KEY: makeJwt(),
  ...overrides,
});

const expectConfigCode = (code, run) => assert.throws(run, (error) => (
  error instanceof RenewerConfigError && error.code === code
));

// --- the compiled policy itself --------------------------------------------

test('the compiled policy names Production and is frozen', () => {
  assert.equal(PRODUCTION_PROJECT_REF, 'rcyuuoaqfwcembdajcss');
  assert.equal(PRODUCTION_API_HOST, 'rcyuuoaqfwcembdajcss.supabase.co');
  assert.ok(COMPILED_FORBIDDEN_PROJECT_REFS.includes(PRODUCTION_PROJECT_REF));
  assert.ok(COMPILED_FORBIDDEN_API_HOSTS.includes(PRODUCTION_API_HOST));
  assert.ok(Object.isFrozen(COMPILED_FORBIDDEN_PROJECT_REFS));
  assert.ok(Object.isFrozen(COMPILED_FORBIDDEN_API_HOSTS));
  // The host and the ref are not two independent facts that could drift apart.
  assert.equal(projectRefFromHost(PRODUCTION_API_HOST), PRODUCTION_PROJECT_REF);
});

test('no environment value can shrink the resolved lists', () => {
  // Absent, empty, whitespace, separators only, an explicit list of other
  // things, and a list that pointedly omits Production. None of them subtract.
  const inputs = [
    undefined, null, '', '   ', ',', ',,,', ' , , ', 'somethingelse',
    'not-production,also-not-production', [], [''], ['  '], ['other'],
  ];
  for (const input of inputs) {
    assert.ok(resolveForbiddenApiHosts(input).includes(PRODUCTION_API_HOST),
      `hosts lost the compiled entry for input ${JSON.stringify(input)}`);
    assert.ok(resolveForbiddenProjectRefs(input).includes(PRODUCTION_PROJECT_REF),
      `refs lost the compiled entry for input ${JSON.stringify(input)}`);
  }
});

test('the environment may add, and additions survive alongside the compiled entries', () => {
  const hosts = resolveForbiddenApiHosts(' Extra.Example.COM , other.example.com ');
  assert.ok(hosts.includes(PRODUCTION_API_HOST));
  assert.ok(hosts.includes('extra.example.com'));
  assert.ok(hosts.includes('other.example.com'));
  const refs = resolveForbiddenProjectRefs('AAAA,bbbb,aaaa');
  assert.ok(refs.includes(PRODUCTION_PROJECT_REF));
  assert.deepEqual(refs.filter((entry) => entry === 'aaaa'), ['aaaa'], 'duplicates are collapsed');
  assert.ok(Object.isFrozen(hosts) && Object.isFrozen(refs));
});

test('parseForbiddenList and the membership helpers normalise the way callers expect', () => {
  assert.deepEqual(parseForbiddenList(' A , b ,, C '), ['a', 'b', 'c']);
  assert.deepEqual(parseForbiddenList(undefined), []);
  assert.ok(isCompiledForbiddenHost(` ${PRODUCTION_API_HOST.toUpperCase()} `));
  assert.ok(isCompiledForbiddenProjectRef(PRODUCTION_PROJECT_REF.toUpperCase()));
  assert.equal(isCompiledForbiddenHost(STAGING_HOST), false);
  assert.equal(isCompiledForbiddenProjectRef(STAGING_REF), false);
  assert.equal(isCompiledForbiddenProjectRef(null), false);
  assert.equal(isCompiledForbiddenProjectRef(''), false);
});

// --- the renewer refuses Production without any help from the environment ---

test('Production is rejected with no forbidden-list variables at all', () => {
  const env = productionEnv();
  assert.equal(env.TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS, undefined);
  assert.equal(env.TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS, undefined);
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(env));
});

test('Production is rejected with empty and whitespace-only variables', () => {
  for (const value of ['', '   ', ',', ' , ,, ']) {
    expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(productionEnv({
      TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: value,
      TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: value,
    })));
  }
});

test('Production is rejected even though EXPECTED_API_HOST agrees with the URL', () => {
  const env = productionEnv();
  // The two statements about the target are identical — this is not a typo
  // being caught, it is the agreed-upon target being refused.
  assert.equal(new URL(env.SUPABASE_URL).hostname, env.TOURNAMENT_MEDIA_EXPECTED_API_HOST);
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(env));
});

test('an EXPECTED_API_HOST naming Production is refused on its own terms', () => {
  // Even reached from the other direction — the URL is a custom domain and only
  // the expected host names Production — the answer is a refusal. It cannot be
  // an acceptance, so the only question is which rule fires first.
  assert.throws(() => readRenewerConfig(productionEnv({
    SUPABASE_URL: 'https://api.arma2.example',
  })), (error) => error instanceof RenewerConfigError
    && ['RENEWER_HOST_FORBIDDEN', 'RENEWER_HOST_MISMATCH'].includes(error.code));
});

test('variables that try to omit Production cannot re-authorize it', () => {
  // The operator lists other things as forbidden, implying Production is fine.
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(productionEnv({
    TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: 'somewhere.else.example',
    TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: 'someotherprojectref',
  })));
  // And the same target named by ref only, with the host list pointed elsewhere.
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(productionEnv({
    TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: STAGING_HOST,
  })));
});

test('Staging is still accepted, with and without the optional variables', () => {
  const bare = readRenewerConfig(stagingEnv());
  assert.equal(bare.projectRef, STAGING_REF);
  assert.equal(bare.host, STAGING_HOST);
  assert.equal(bare.healthUrl, `https://${STAGING_HOST}/functions/v1/tournament-media-signer`);
  // The compiled policy travels with the descriptor into the transport layer.
  assert.ok(bare.target.forbiddenProjectRefs.includes(PRODUCTION_PROJECT_REF));
  assert.ok(bare.target.forbiddenHosts.includes(PRODUCTION_API_HOST));

  const withExtras = readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: 'extra.example.com',
    TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: 'extraref',
  }));
  assert.equal(withExtras.projectRef, STAGING_REF);
  assert.ok(withExtras.target.forbiddenHosts.includes('extra.example.com'));
  assert.ok(withExtras.target.forbiddenProjectRefs.includes('extraref'));
  assert.ok(withExtras.target.forbiddenHosts.includes(PRODUCTION_API_HOST));
});

test('an environment-added forbidden target is refused just like a compiled one', () => {
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: STAGING_HOST,
  })));
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: STAGING_REF,
  })));
});

// --- custom domains --------------------------------------------------------

test('a custom domain is accepted only under the existing contract', () => {
  // No ref in the host, so the JWT may legitimately carry none.
  const resolved = readRenewerConfig(stagingEnv({
    SUPABASE_URL: 'https://api.arma2.example',
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'api.arma2.example',
    SUPABASE_ANON_KEY: makeJwt({ ref: null }),
  }));
  assert.equal(resolved.host, 'api.arma2.example');
  assert.equal(resolved.gatewayJwtProjectRef, null);
  // Accepted, but never without the block travelling along with it.
  assert.ok(resolved.target.forbiddenProjectRefs.includes(PRODUCTION_PROJECT_REF));
  assert.ok(resolved.target.forbiddenHosts.includes(PRODUCTION_API_HOST));
});

test('a custom domain may never carry or belong to the forbidden project', () => {
  // The forbidden ref smuggled in as the first label of a domain that is not
  // supabase.co at all.
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(stagingEnv({
    SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.arma2.example`,
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: `${PRODUCTION_PROJECT_REF}.arma2.example`,
  })));
  // An innocent-looking custom domain whose credential says which project it
  // really fronts.
  expectConfigCode('RENEWER_GATEWAY_JWT_PROJECT_FORBIDDEN', () => readRenewerConfig(stagingEnv({
    SUPABASE_URL: 'https://media.arma2.example',
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'media.arma2.example',
    SUPABASE_ANON_KEY: makeJwt({ ref: PRODUCTION_PROJECT_REF }),
  })));
});

// --- one source, shared by both callers ------------------------------------

test('createTarget carries the compiled policy even when the caller passes nothing', () => {
  // This is the property the probe relies on: it builds its own descriptor, and
  // it inherits the block without having to remember to ask for it.
  const target = createTarget({ origin: `https://${STAGING_HOST}`, functionName: 'tournament-media-signer' });
  assert.ok(target.forbiddenHosts.includes(PRODUCTION_API_HOST));
  assert.ok(target.forbiddenProjectRefs.includes(PRODUCTION_PROJECT_REF));

  for (const lists of [
    {},
    { forbiddenHosts: [], forbiddenProjectRefs: [] },
    { forbiddenHosts: ['other.example'], forbiddenProjectRefs: ['otherref'] },
  ]) {
    assert.throws(() => createTarget({
      origin: `https://${PRODUCTION_API_HOST}`,
      functionName: 'tournament-media-signer',
      projectRef: PRODUCTION_PROJECT_REF,
      ...lists,
    }), (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_FORBIDDEN');
  }
});

test('the request-time re-check refuses a forbidden host against any descriptor', () => {
  const target = createTarget({
    origin: `https://${STAGING_HOST}`,
    functionName: 'tournament-media-signer',
    projectRef: STAGING_REF,
  });
  // A URL that drifted to Production is stopped by the host check, and the
  // forbidden lists are re-applied at request time regardless.
  assert.throws(
    () => assertAuthorizedUrl(`https://${PRODUCTION_API_HOST}/functions/v1/tournament-media-signer`, target),
    (error) => error instanceof TargetError,
  );
  // A descriptor built without any `projectRef` is not a way around the ref
  // block: the host's own first label is checked.
  assert.throws(() => createTarget({
    origin: `https://${PRODUCTION_PROJECT_REF}.example.invalid`,
    functionName: 'tournament-media-signer',
  }), (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_FORBIDDEN');

  // And at request time, against a refless descriptor for a benign host.
  const loopback = createTarget({ origin: 'http://127.0.0.1:0', functionName: 'tournament-media-signer' });
  assert.ok(loopback.forbiddenProjectRefs.includes(PRODUCTION_PROJECT_REF));
});

test('the renewer and the probe resolve the same canonical policy module', async () => {
  const probeSource = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts/torneos-staging/signer-gateway-probe.mjs'), 'utf8',
  );
  // The probe must reach the policy through the renewer package, not through a
  // second copy of the literals.
  assert.match(probeSource, /from '\.\.\/\.\.\/workers\/tournament-media-signer-renewer\/src\/forbidden-targets\.mjs'/);
  const probeModule = await import('../../../scripts/torneos-staging/signer-gateway-probe.mjs');
  assert.equal(typeof probeModule.preflight, 'function');
});

// --- the contract with the manifest ----------------------------------------

test('the compiled policy and the staging manifest agree exactly', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'ops/torneos-staging/manifest.json'), 'utf8'),
  );
  const declaredRefs = manifest.environment.forbiddenProjectRefs
    .map((entry) => String(entry).trim().toLowerCase()).sort();
  assert.deepEqual([...COMPILED_FORBIDDEN_PROJECT_REFS].sort(), declaredRefs,
    'ops/torneos-staging/manifest.json and forbidden-targets.mjs disagree about which project refs are forbidden');

  const productionHost = String(manifest.environment.productionApiHost).trim().toLowerCase();
  assert.ok(COMPILED_FORBIDDEN_API_HOSTS.includes(productionHost),
    'the manifest production API host is not in the compiled forbidden host list');
  assert.ok(declaredRefs.includes(projectRefFromHost(productionHost)),
    'the manifest production host and its declared forbidden refs disagree');

  // The authorized staging target must never be caught by the block, or the
  // whole pipeline is bricked by its own guard.
  const authorizedRef = String(manifest.environment.authorizedProjectRef).trim().toLowerCase();
  const authorizedHost = String(manifest.environment.authorizedApiHost).trim().toLowerCase();
  assert.equal(isCompiledForbiddenProjectRef(authorizedRef), false);
  assert.equal(isCompiledForbiddenHost(authorizedHost), false);
});

// --- sanitisation ----------------------------------------------------------

test('no secret, credential or header value appears in a forbidden-target error', () => {
  const jwt = makeJwt({ ref: PRODUCTION_PROJECT_REF });
  const sensitive = [SECRET, jwt, 'sb_publishable_fixture_key_value'];
  const envs = [
    productionEnv(),
    productionEnv({ TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: '', TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: '' }),
    productionEnv({ SUPABASE_ANON_KEY: jwt }),
    stagingEnv({
      SUPABASE_URL: 'https://media.arma2.example',
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'media.arma2.example',
      SUPABASE_ANON_KEY: jwt,
    }),
  ];
  for (const env of envs) {
    assert.throws(() => readRenewerConfig(env), (error) => {
      for (const value of sensitive) {
        assert.equal(error.message.includes(value), false, 'a credential leaked into the error message');
        assert.equal(String(error.stack || '').includes(value), false, 'a credential leaked into the stack');
      }
      // Nor does the message carry a full URL that could itself be sensitive.
      assert.equal(/https?:\/\/\S+/.test(error.message), false, 'an error message carried a full URL');
      return error instanceof RenewerConfigError;
    });
  }
});

test('secretValues still covers every credential the config holds', () => {
  const resolved = readRenewerConfig(stagingEnv());
  const values = secretValues(resolved);
  assert.ok(values.includes(resolved.attestationSecret));
  assert.ok(values.includes(resolved.apikey));
  assert.ok(values.includes(resolved.authorizationJwt));
});
