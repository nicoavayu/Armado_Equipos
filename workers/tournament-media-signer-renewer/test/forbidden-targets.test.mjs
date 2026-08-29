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
  hostCarriesForbiddenRef,
  hostLabels,
  isCompiledForbiddenHost,
  isCompiledForbiddenProjectRef,
  normalizeHost,
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
  // second copy of the literals — and must reach the label-wise test through it
  // too, rather than deciding for itself what part of a hostname to read.
  assert.match(probeSource, /from '\.\.\/\.\.\/workers\/tournament-media-signer-renewer\/src\/forbidden-targets\.mjs'/);
  assert.match(probeSource, /hostCarriesForbiddenRef/,
    'the probe must use the canonical label-wise host test, not its own');
  const probeModule = await import('../../../scripts/torneos-staging/signer-gateway-probe.mjs');
  assert.equal(typeof probeModule.preflight, 'function');
});

// --- a forbidden ref in ANY label ------------------------------------------
//
// The residual hole this section closes. `projectRefFromHost` reads the FIRST
// DNS label, and every forbidden-target check used to be written against it. So
// `<prod-ref>.supabase.co` was refused and `db.<prod-ref>.supabase.co` — the
// same project, one ordinary prefix away — was not.

/** Prefixed and suffixed shapes that all name Production somewhere in the host. */
const FORBIDDEN_HOST_SHAPES = [
  PRODUCTION_API_HOST,
  `db.${PRODUCTION_PROJECT_REF}.supabase.co`,
  `api.${PRODUCTION_PROJECT_REF}.supabase.co`,
  `gateway.${PRODUCTION_PROJECT_REF}.example.com`,
  // Fourth label deep, to show the rule is "any label", not "one of the first few".
  `a.b.${PRODUCTION_PROJECT_REF}.example.com`,
  // The same names an operator could plausibly type differently.
  PRODUCTION_API_HOST.toUpperCase(),
  `DB.${PRODUCTION_PROJECT_REF.toUpperCase()}.SUPABASE.CO`,
  `Gateway.${PRODUCTION_PROJECT_REF}.Example.COM`,
  `${PRODUCTION_API_HOST}.`,
  `db.${PRODUCTION_PROJECT_REF}.supabase.co.`,
  `API.${PRODUCTION_PROJECT_REF.toUpperCase()}.SUPABASE.CO.`,
];

/**
 * Hosts that merely resemble Production. Every one of these would be refused by
 * a substring test, and every one of them is a legitimately different host.
 */
const ALLOWED_HOST_SHAPES = [
  STAGING_HOST,
  'api.arma2.example',
  'media.arma2.example',
  `${PRODUCTION_PROJECT_REF}2.supabase.co`,
  `x${PRODUCTION_PROJECT_REF}.supabase.co`,
  `${PRODUCTION_PROJECT_REF}extra.example.com`,
  `prefix${PRODUCTION_PROJECT_REF}suffix.example.com`,
  // A genuine prefix of the forbidden ref, which is not the forbidden ref.
  `${PRODUCTION_PROJECT_REF.slice(0, 12)}.example.com`,
  // The ref's own characters, in order, split across two labels — so no single
  // label is it.
  `${PRODUCTION_PROJECT_REF.slice(0, 10)}.${PRODUCTION_PROJECT_REF.slice(10)}.example.com`,
];

test('normalizeHost and hostLabels agree on what a hostname is made of', () => {
  assert.equal(normalizeHost('  Example.COM.  '), 'example.com');
  assert.equal(normalizeHost(undefined), '');
  assert.equal(normalizeHost(null), '');
  assert.deepEqual(hostLabels('DB.Example.COM.'), ['db', 'example', 'com']);
  // Empty labels carry no name, so they cannot shift what a position means.
  assert.deepEqual(hostLabels('a..b'), ['a', 'b']);
  assert.deepEqual(hostLabels('.a.b.'), ['a', 'b']);
  assert.deepEqual(hostLabels(''), []);
  // Only ONE trailing root dot is meaningful; the rest are empty labels.
  assert.deepEqual(hostLabels(`${PRODUCTION_API_HOST}..`), ['rcyuuoaqfwcembdajcss', 'supabase', 'co']);
});

test('hostCarriesForbiddenRef matches a forbidden ref in any label, in any casing', () => {
  for (const host of FORBIDDEN_HOST_SHAPES) {
    assert.equal(hostCarriesForbiddenRef(host, []), true, `${host} was not recognised as Production`);
  }
  // First, second and third label, stated one at a time so a regression names
  // the position it lost.
  assert.equal(hostCarriesForbiddenRef(`${PRODUCTION_PROJECT_REF}.example.com`, []), true);
  assert.equal(hostCarriesForbiddenRef(`one.${PRODUCTION_PROJECT_REF}.example.com`, []), true);
  assert.equal(hostCarriesForbiddenRef(`one.two.${PRODUCTION_PROJECT_REF}.example.com`, []), true);
});

test('hostCarriesForbiddenRef does not substring-match, so near misses stay usable', () => {
  for (const host of ALLOWED_HOST_SHAPES) {
    assert.equal(hostCarriesForbiddenRef(host, []), false, `${host} was refused as a false positive`);
    // Still false with the ref named explicitly, so the answer comes from the
    // matching rule and not from the ref happening to be absent from the list.
    assert.equal(hostCarriesForbiddenRef(host, [PRODUCTION_PROJECT_REF]), false);
  }
  assert.equal(hostCarriesForbiddenRef('', []), false);
  assert.equal(hostCarriesForbiddenRef(null, []), false);
  assert.equal(hostCarriesForbiddenRef(undefined, []), false);
});

test('hostCarriesForbiddenRef obeys the one-way rule: callers may add, never subtract', () => {
  for (const refs of [undefined, null, [], [''], '', '   ', ',,,', ['other'], 'notproduction,alsonot']) {
    assert.equal(hostCarriesForbiddenRef(`db.${PRODUCTION_PROJECT_REF}.supabase.co`, refs), true,
      `an argument of ${JSON.stringify(refs)} weakened the compiled policy`);
  }
  // A caller's own additions are honoured in every label too.
  assert.equal(hostCarriesForbiddenRef('db.extraref.example.com', ['extraref']), true);
  assert.equal(hostCarriesForbiddenRef('db.extraref.example.com', 'EXTRAREF'), true);
  assert.equal(hostCarriesForbiddenRef('db.extraref2.example.com', ['extraref']), false);
});

test('the config refuses every labelled form of Production, from the URL and the expected host', () => {
  for (const host of FORBIDDEN_HOST_SHAPES) {
    // Both statements name the same host and agree with each other, which is the
    // shape that used to be accepted for the prefixed variants.
    expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(stagingEnv({
      SUPABASE_URL: `https://${host}`,
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: host,
      SUPABASE_ANON_KEY: makeJwt({ ref: null }),
    })));
    // With the forbidden-list variables absent, empty, and pointed elsewhere.
    for (const value of [undefined, '', '   ', 'somewhere.else.example']) {
      expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(stagingEnv({
        SUPABASE_URL: `https://${host}`,
        TOURNAMENT_MEDIA_EXPECTED_API_HOST: host,
        SUPABASE_ANON_KEY: makeJwt({ ref: null }),
        TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: value,
        TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: value,
      })));
    }
  }
});

test('an EXPECTED_API_HOST naming a labelled Production host is refused', () => {
  for (const host of FORBIDDEN_HOST_SHAPES) {
    // Reached from the other side: the URL is the authorized Staging host and
    // only the expected host names Production. Whether the mismatch or the block
    // is reported first, the one thing it can never be is an acceptance.
    assert.throws(() => readRenewerConfig(stagingEnv({
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: host,
    })), (error) => error instanceof RenewerConfigError
      && ['RENEWER_HOST_FORBIDDEN', 'RENEWER_HOST_MISMATCH'].includes(error.code),
    `an expected host of ${host} was not refused`);
  }
});

test('a JWT whose ref claim names Production is refused behind an innocent host', () => {
  expectConfigCode('RENEWER_GATEWAY_JWT_PROJECT_FORBIDDEN', () => readRenewerConfig(stagingEnv({
    SUPABASE_URL: 'https://gateway.arma2.example',
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'gateway.arma2.example',
    SUPABASE_ANON_KEY: makeJwt({ ref: PRODUCTION_PROJECT_REF }),
  })));
  // Including the casing the claim might arrive in.
  expectConfigCode('RENEWER_GATEWAY_JWT_PROJECT_FORBIDDEN', () => readRenewerConfig(stagingEnv({
    SUPABASE_URL: 'https://gateway.arma2.example',
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'gateway.arma2.example',
    SUPABASE_ANON_KEY: makeJwt({ ref: PRODUCTION_PROJECT_REF.toUpperCase() }),
  })));
});

test('createTarget refuses every labelled form of Production with no lists supplied', () => {
  for (const host of FORBIDDEN_HOST_SHAPES) {
    for (const lists of [
      {},
      { forbiddenHosts: [], forbiddenProjectRefs: [] },
      { forbiddenHosts: ['other.example'], forbiddenProjectRefs: ['otherref'] },
    ]) {
      assert.throws(() => createTarget({
        origin: `https://${host}`,
        functionName: 'tournament-media-signer',
        ...lists,
      }), (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_FORBIDDEN',
      `createTarget accepted ${host} with lists ${JSON.stringify(lists)}`);
    }
  }
});

test('createTarget still accepts Staging and every near miss', () => {
  for (const host of ALLOWED_HOST_SHAPES) {
    const target = createTarget({ origin: `https://${host}`, functionName: 'tournament-media-signer' });
    assert.equal(target.hostname, host.toLowerCase());
    // Accepted, and still carrying the block for the request-time re-check.
    assert.ok(target.forbiddenProjectRefs.includes(PRODUCTION_PROJECT_REF));
  }
});

/**
 * A descriptor that could not be built today — `createTarget` refuses this host
 * — standing in for one built before the lists were tightened, or by a caller
 * that assembled the object itself. It is the only way to reach the
 * request-time branch with a forbidden host, and reaching it is the point: the
 * block must not depend on the descriptor having remembered to carry it.
 */
const staleDescriptor = (hostname) => Object.freeze({
  origin: `https://${hostname}`,
  hostname,
  protocol: 'https:',
  functionName: 'tournament-media-signer',
  projectRef: null,
  path: '/functions/v1/tournament-media-signer',
  url: `https://${hostname}/functions/v1/tournament-media-signer`,
  forbiddenHosts: [],
  forbiddenProjectRefs: [],
});

test('request-time validation refuses a labelled Production host against an empty descriptor', () => {
  for (const host of FORBIDDEN_HOST_SHAPES) {
    const hostname = host.toLowerCase();
    const target = staleDescriptor(hostname);
    // The descriptor forbids nothing and agrees with the URL on host, origin and
    // path, so every other rule in assertAuthorizedUrl passes. Only the compiled
    // policy is left to refuse it.
    assert.throws(
      () => assertAuthorizedUrl(target.url, target),
      (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_FORBIDDEN',
      `request-time validation accepted ${hostname}`,
    );
  }
});

test('request-time validation still accepts the authorized Staging URL', () => {
  const target = createTarget({
    origin: `https://${STAGING_HOST}`,
    functionName: 'tournament-media-signer',
    projectRef: STAGING_REF,
  });
  const url = assertAuthorizedUrl(target.url, target);
  assert.equal(url.hostname, STAGING_HOST);
  // And a loopback descriptor, which has no ref to read, is unaffected.
  const loopback = createTarget({ origin: 'http://127.0.0.1:8080', functionName: 'tournament-media-signer' });
  assert.equal(assertAuthorizedUrl(loopback.url, loopback).hostname, '127.0.0.1');
});

test('no call site tests a forbidden ref against the first label alone', () => {
  // The regression lock. `projectRefFromHost` answers "which project does this
  // address name", and remains correct for that; using it AS the block is what
  // left the prefixed hosts open, so the shape is banned outright rather than
  // left to review.
  for (const file of ['src/config.mjs', 'src/target.mjs']) {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'workers/tournament-media-signer-renewer', file), 'utf8');
    assert.doesNotMatch(source, /includes\(\s*projectRefFromHost\(/,
      `${file} still tests a forbidden ref against the first DNS label only`);
    assert.match(source, /hostCarriesForbiddenRef\(/,
      `${file} does not use the canonical label-wise host test`);
  }
});

test('the labelled refusals name no host and carry no credential', () => {
  const jwt = makeJwt({ ref: PRODUCTION_PROJECT_REF });
  for (const host of FORBIDDEN_HOST_SHAPES) {
    assert.throws(() => readRenewerConfig(stagingEnv({
      SUPABASE_URL: `https://${host}`,
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: host,
      SUPABASE_ANON_KEY: jwt,
    })), (error) => {
      const text = `${error.message}\n${error.stack || ''}`;
      assert.equal(text.includes(host), false, 'an error carried the rejected hostname');
      assert.equal(text.includes(host.toLowerCase()), false, 'an error carried the rejected hostname');
      assert.equal(error.message.includes(PRODUCTION_PROJECT_REF), false,
        'an error message named the forbidden project ref');
      assert.equal(error.message.includes(jwt), false, 'a credential leaked into the error message');
      assert.equal(error.message.includes(SECRET), false, 'the attestation secret leaked into the error message');
      assert.equal(/https?:\/\/\S+/.test(error.message), false, 'an error message carried a full URL');
      return error instanceof RenewerConfigError;
    });
    assert.throws(() => createTarget({ origin: `https://${host}`, functionName: 'tournament-media-signer' }),
      (error) => {
        assert.equal(error.message.includes(host.toLowerCase()), false,
          'a target error carried the rejected hostname');
        assert.equal(error.message.includes(PRODUCTION_PROJECT_REF), false,
          'a target error named the forbidden project ref');
        return error instanceof TargetError;
      });
  }
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
  // Under the label-wise rule as well — the guard has to be strong enough to
  // stop Production and narrow enough to leave the authorized target reachable,
  // and both halves of that are the manifest's business.
  assert.equal(hostCarriesForbiddenRef(authorizedHost, declaredRefs), false,
    'the label-wise guard would refuse the authorized staging host');
  assert.equal(hostCarriesForbiddenRef(productionHost, declaredRefs), true);
  assert.equal(hostCarriesForbiddenRef(`db.${productionHost}`, declaredRefs), true);
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
