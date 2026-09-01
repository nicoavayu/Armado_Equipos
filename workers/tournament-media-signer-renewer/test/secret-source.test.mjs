/**
 * File-based secret injection for the renewer.
 *
 * The renewer holds two credentials that must not be printed and one ordering
 * that must not be weakened: `resolveHealthUrl` proves the target before any
 * credential is touched, so a host that names Production costs no read of the
 * attestation secret and — now — opens no secret file either.
 *
 * The reader itself is exercised exhaustively in the processor's
 * `test/secret-source.test.mjs`; the module is byte-identical in both packages
 * and that suite asserts it. What is proved here is the wiring: which variables
 * accept a file, that the existing precedence and the existing refusals survive
 * the file source, and that a service credential is still refused when it
 * arrives from a file rather than from the environment.
 *
 * Every credential in this file is fictional.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  ATTESTATION_SECRET_SOURCE, GATEWAY_JWT_SOURCE, GATEWAY_KEY_SOURCES,
  RenewerConfigError, readRenewerConfig, secretValues,
} from '../src/config.mjs';
import { PRODUCTION_API_HOST } from '../src/forbidden-targets.mjs';
import { SecretSourceError } from '../src/secret-source.mjs';

const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
const STAGING_HOST = `${STAGING_REF}.supabase.co`;

/** Fictional. Distinctive, so a leak into any string is unmistakable. */
const FAKE_ATTESTATION_SECRET = `fake-attestation-secret-${'z'.repeat(30)}`;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const makeJwt = ({ role = 'anon', ref = STAGING_REF, expSeconds = 3600 } = {}) => [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    iss: 'supabase', ...(ref === null ? {} : { ref }), role,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
  }),
  'fixture-signature-not-verified-here',
].join('.');

// --- temporary files -------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-renewer-secret-'));
let seq = 0;

const secretFile = (contents) => {
  const target = path.join(root, `secret-${seq += 1}`);
  fs.writeFileSync(target, contents, { mode: 0o600 });
  return target;
};

after(() => fs.rmSync(root, { recursive: true, force: true }));

// --- environments ----------------------------------------------------------

/** The direct-environment form that has always worked, and must keep working. */
const stagingEnv = (overrides = {}) => ({
  SUPABASE_URL: `https://${STAGING_HOST}`,
  TOURNAMENT_MEDIA_EXPECTED_API_HOST: STAGING_HOST,
  TOURNAMENT_MEDIA_ATTESTATION_SECRET: FAKE_ATTESTATION_SECRET,
  SUPABASE_ANON_KEY: makeJwt(),
  ...overrides,
});

const codeOf = (run) => {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof RenewerConfigError || error instanceof SecretSourceError,
      `unexpected error type: ${error}`);
    return error.code;
  }
  return null;
};

const textOf = (run) => {
  try {
    run();
  } catch (error) {
    return `${error.code} ${error.message} ${error.stack}`;
  }
  return '';
};

// ---------------------------------------------------------------------------
// The variable names the manifest has to agree with
// ---------------------------------------------------------------------------

test('the file variables this worker reads are exactly the documented set', () => {
  // Pinned as literals: a deployment manifest names these strings, and a rename
  // here without a rename there is a stack that fails to start.
  assert.deepEqual(ATTESTATION_SECRET_SOURCE, {
    variable: 'TOURNAMENT_MEDIA_ATTESTATION_SECRET',
    fileVariable: 'TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE',
  });
  assert.deepEqual(GATEWAY_JWT_SOURCE, {
    variable: 'TOURNAMENT_MEDIA_GATEWAY_JWT',
    fileVariable: 'TOURNAMENT_MEDIA_GATEWAY_JWT_FILE',
  });
  assert.deepEqual(GATEWAY_KEY_SOURCES.map((s) => s.variable),
    ['TOURNAMENT_MEDIA_GATEWAY_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY']);
  assert.deepEqual(GATEWAY_KEY_SOURCES.map((s) => s.fileVariable),
    ['TOURNAMENT_MEDIA_GATEWAY_KEY_FILE', 'SUPABASE_PUBLISHABLE_KEY_FILE', 'SUPABASE_ANON_KEY_FILE']);
  assert.ok(Object.isFrozen(GATEWAY_KEY_SOURCES));
});

// ---------------------------------------------------------------------------
// Each credential, from a file
// ---------------------------------------------------------------------------

test('the direct environment form still produces a working config', () => {
  const config = readRenewerConfig(stagingEnv());
  assert.equal(config.attestationSecret, FAKE_ATTESTATION_SECRET);
  assert.equal(config.host, STAGING_HOST);
});

test('TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE supplies the attestation secret', () => {
  const config = readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_ATTESTATION_SECRET: undefined,
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: secretFile(`${FAKE_ATTESTATION_SECRET}\n`),
  }));
  assert.equal(config.attestationSecret, FAKE_ATTESTATION_SECRET);
});

test('TOURNAMENT_MEDIA_GATEWAY_JWT_FILE supplies the bearer', () => {
  const jwt = makeJwt();
  const config = readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: undefined,
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(`${jwt}\n`),
  }));
  assert.equal(config.authorizationJwt, jwt);
  assert.equal(config.gatewayCredentialKind, 'dedicated-identity-jwt');
});

test('TOURNAMENT_MEDIA_GATEWAY_KEY_FILE and SUPABASE_ANON_KEY_FILE both supply the apikey', () => {
  for (const fileVariable of ['TOURNAMENT_MEDIA_GATEWAY_KEY_FILE', 'SUPABASE_ANON_KEY_FILE']) {
    const jwt = makeJwt();
    const config = readRenewerConfig(stagingEnv({
      SUPABASE_ANON_KEY: undefined,
      [fileVariable]: secretFile(jwt),
    }));
    assert.equal(config.apikey, jwt, `${fileVariable} did not become the apikey`);
    assert.equal(config.authorizationJwt, jwt);
    assert.equal(config.gatewayCredentialKind, 'legacy-anon-jwt');
  }
});

test('SUPABASE_PUBLISHABLE_KEY_FILE still requires a separate bearer JWT', () => {
  // A publishable key is not a JWT and cannot satisfy verify_jwt = true. The
  // file source changes nothing about that rule.
  const publishable = 'sb_publishable_fake000000000000000000';
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: undefined,
    SUPABASE_PUBLISHABLE_KEY_FILE: secretFile(publishable),
  }))), 'RENEWER_GATEWAY_JWT_REQUIRED');

  const jwt = makeJwt();
  const config = readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: undefined,
    SUPABASE_PUBLISHABLE_KEY_FILE: secretFile(publishable),
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(jwt),
  }));
  assert.equal(config.apikey, publishable);
  assert.equal(config.authorizationJwt, jwt);
  assert.equal(config.gatewayCredentialKind, 'publishable-plus-jwt');
});

test('every credential may come from a file at once, with none in the environment', () => {
  // The shape a container manifest would actually use: paths only.
  const jwt = makeJwt();
  const config = readRenewerConfig({
    SUPABASE_URL: `https://${STAGING_HOST}`,
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: STAGING_HOST,
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: secretFile(FAKE_ATTESTATION_SECRET),
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(jwt),
  });
  assert.equal(config.attestationSecret, FAKE_ATTESTATION_SECRET);
  assert.equal(config.authorizationJwt, jwt);
});

// ---------------------------------------------------------------------------
// One source, or none
// ---------------------------------------------------------------------------

test('a credential given both directly and as a file refuses the configuration', () => {
  const pairs = [
    ['TOURNAMENT_MEDIA_ATTESTATION_SECRET', 'TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE',
      FAKE_ATTESTATION_SECRET],
    ['TOURNAMENT_MEDIA_GATEWAY_JWT', 'TOURNAMENT_MEDIA_GATEWAY_JWT_FILE', makeJwt()],
    ['TOURNAMENT_MEDIA_GATEWAY_KEY', 'TOURNAMENT_MEDIA_GATEWAY_KEY_FILE', makeJwt()],
    ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY_FILE', 'sb_publishable_fake0000000000'],
    ['SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY_FILE', makeJwt()],
  ];
  for (const [variable, fileVariable, value] of pairs) {
    assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
      [variable]: value,
      [fileVariable]: secretFile(value),
    }))), 'SECRET_SOURCE_AMBIGUOUS', `${variable} + ${fileVariable} was resolved silently`);
  }
});

test('the ambiguity refusal names both variables and neither value', () => {
  const text = textOf(() => readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: secretFile(FAKE_ATTESTATION_SECRET),
  })));
  assert.ok(text.includes('TOURNAMENT_MEDIA_ATTESTATION_SECRET'));
  assert.ok(text.includes('TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE'));
  assert.equal(text.includes(FAKE_ATTESTATION_SECRET), false);
});

test('an unusable secret file fails closed and says nothing about its contents', () => {
  const cases = [
    ['', 'SECRET_FILE_EMPTY'],
    ['\n', 'SECRET_FILE_EMPTY'],
    [Buffer.from(`${FAKE_ATTESTATION_SECRET}\0`, 'utf8'), 'SECRET_FILE_BINARY'],
  ];
  for (const [contents, code] of cases) {
    const file = secretFile(contents);
    const env = stagingEnv({
      TOURNAMENT_MEDIA_ATTESTATION_SECRET: undefined,
      TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: file,
    });
    assert.equal(codeOf(() => readRenewerConfig(env)), code);
    const text = textOf(() => readRenewerConfig(env));
    assert.equal(text.includes(FAKE_ATTESTATION_SECRET), false, 'an error carried the credential');
    assert.equal(text.includes(file), false, 'an error carried the file path');
    assert.equal(text.includes(root), false, 'an error carried the secret directory');
  }
  // A missing file is a refusal, never a fallback to the environment.
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: path.join(root, 'absent'),
  }))), 'SECRET_SOURCE_AMBIGUOUS');
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_ATTESTATION_SECRET: undefined,
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: path.join(root, 'absent'),
  }))), 'SECRET_FILE_UNREADABLE');
});

test('a too-short secret from a file is still RENEWER_SECRET_MISSING', () => {
  // The length rule is about the credential, not about where it came from.
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_ATTESTATION_SECRET: undefined,
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: secretFile('too-short'),
  }))), 'RENEWER_SECRET_MISSING');
});

// ---------------------------------------------------------------------------
// The refusals that must survive the new source
// ---------------------------------------------------------------------------

test('a service credential is refused when it arrives from a file', () => {
  // The renewer deliberately holds no service credential. Reading it from a
  // mount instead of the environment does not make it acceptable — this is the
  // check that a new input path is most likely to have bypassed.
  for (const fileVariable of [
    'TOURNAMENT_MEDIA_GATEWAY_KEY_FILE', 'SUPABASE_ANON_KEY_FILE',
    'TOURNAMENT_MEDIA_GATEWAY_JWT_FILE',
  ]) {
    assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
      SUPABASE_ANON_KEY: undefined,
      [fileVariable]: secretFile('sb_secret_fake000000000000000000'),
    }))), 'RENEWER_GATEWAY_KEY_PRIVILEGED', `${fileVariable} accepted a service credential`);
  }
  // The JWT-clothed form too.
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: undefined,
    SUPABASE_ANON_KEY_FILE: secretFile(makeJwt({ role: 'service_role' })),
  }))), 'RENEWER_GATEWAY_KEY_PRIVILEGED');
});

test('a file-sourced gateway JWT is still checked against the authorized project', () => {
  const other = 'aaaabbbbccccddddeeee';
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: undefined,
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(makeJwt({ ref: other })),
  }))), 'RENEWER_GATEWAY_JWT_PROJECT_MISMATCH');
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: undefined,
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(makeJwt({ ref: null })),
  }))), 'RENEWER_GATEWAY_JWT_REF_MISSING');
  assert.equal(codeOf(() => readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: undefined,
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(makeJwt({ expSeconds: -7200 })),
  }))), 'RENEWER_GATEWAY_JWT_EXPIRED');
});

test('the existing precedence among the apikey alternatives is unchanged', () => {
  // GATEWAY_KEY before PUBLISHABLE before ANON, whichever source each is given.
  const winner = makeJwt({ role: 'authenticated' });
  const loser = makeJwt({ role: 'anon' });
  assert.equal(readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY: loser,
    TOURNAMENT_MEDIA_GATEWAY_KEY_FILE: secretFile(winner),
  })).apikey, winner);
  assert.equal(readRenewerConfig(stagingEnv({
    SUPABASE_ANON_KEY_FILE: secretFile(loser),
    SUPABASE_ANON_KEY: undefined,
    TOURNAMENT_MEDIA_GATEWAY_KEY: winner,
  })).apikey, winner);
  // And the explicit JWT still outranks the apikey as the bearer.
  const bearer = makeJwt({ role: 'authenticated' });
  const config = readRenewerConfig(stagingEnv({
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(bearer),
  }));
  assert.equal(config.authorizationJwt, bearer);
  assert.notEqual(config.apikey, bearer);
});

// ---------------------------------------------------------------------------
// Target first
// ---------------------------------------------------------------------------

/** An `fs` that fails the test if anything at all touches it. */
const forbiddenFs = (why) => new Proxy({}, {
  get: (_target, property) => () => assert.fail(`fs.${String(property)} was called ${why}`),
});

test('a forbidden target opens no secret file and reads no credential variable', () => {
  // The renewer's own F-1 equivalent: `resolveHealthUrl` runs first, so a host
  // that names Production costs nothing. The getters count every touch.
  let read = 0;
  const file = secretFile(FAKE_ATTESTATION_SECRET);
  const jwtFile = secretFile(makeJwt());
  const env = {
    SUPABASE_URL: `https://${PRODUCTION_API_HOST}`,
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: PRODUCTION_API_HOST,
    get TOURNAMENT_MEDIA_ATTESTATION_SECRET() { read += 1; return FAKE_ATTESTATION_SECRET; },
    get TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE() { read += 1; return file; },
    get TOURNAMENT_MEDIA_GATEWAY_JWT() { read += 1; return makeJwt(); },
    get TOURNAMENT_MEDIA_GATEWAY_JWT_FILE() { read += 1; return jwtFile; },
    get TOURNAMENT_MEDIA_GATEWAY_KEY() { read += 1; return makeJwt(); },
    get TOURNAMENT_MEDIA_GATEWAY_KEY_FILE() { read += 1; return jwtFile; },
    get SUPABASE_PUBLISHABLE_KEY() { read += 1; return ''; },
    get SUPABASE_PUBLISHABLE_KEY_FILE() { read += 1; return jwtFile; },
    get SUPABASE_ANON_KEY() { read += 1; return makeJwt(); },
    get SUPABASE_ANON_KEY_FILE() { read += 1; return jwtFile; },
  };
  let thrown = null;
  try {
    readRenewerConfig(env, { fs: forbiddenFs('for a forbidden target') });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, 'RENEWER_HOST_FORBIDDEN');
  assert.equal(read, 0, 'a credential variable was read for a forbidden target');
  assert.equal(String(thrown?.message).includes(FAKE_ATTESTATION_SECRET), false);
  assert.equal(String(thrown?.message).includes(file), false);
});

test('an unusable target opens no secret file either', () => {
  const file = secretFile(FAKE_ATTESTATION_SECRET);
  for (const [overrides, code] of [
    [{ SUPABASE_URL: '' }, 'RENEWER_URL_MISSING'],
    [{ TOURNAMENT_MEDIA_EXPECTED_API_HOST: '' }, 'RENEWER_EXPECTED_HOST_MISSING'],
    [{ SUPABASE_URL: 'not-a-url' }, 'RENEWER_URL_INVALID'],
    [{ SUPABASE_URL: `http://${STAGING_HOST}` }, 'RENEWER_URL_INVALID'],
    [{ SUPABASE_URL: 'https://elsewhere.example.test' }, 'RENEWER_HOST_MISMATCH'],
  ]) {
    let read = 0;
    const env = {
      SUPABASE_URL: `https://${STAGING_HOST}`,
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: STAGING_HOST,
      get TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE() { read += 1; return file; },
      ...overrides,
    };
    let thrown = null;
    try {
      readRenewerConfig(env, { fs: forbiddenFs(`for ${code}`) });
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown?.code, code);
    assert.equal(read, 0, `${code} read the credential variable`);
  }
});

// ---------------------------------------------------------------------------
// The redactor
// ---------------------------------------------------------------------------

test('secretValues still covers a credential that came from a file', () => {
  // Everything downstream — alerts, exit messages, the state file — redacts
  // through this list. A file-sourced secret that were missing from it would be
  // a credential nothing knows to hide.
  const jwt = makeJwt();
  const config = readRenewerConfig({
    SUPABASE_URL: `https://${STAGING_HOST}`,
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: STAGING_HOST,
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: secretFile(FAKE_ATTESTATION_SECRET),
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(jwt),
  });
  const values = secretValues(config);
  assert.ok(values.includes(FAKE_ATTESTATION_SECRET));
  assert.ok(values.includes(jwt));
});

test('a file-sourced secret is never copied into process.env', () => {
  const before = JSON.stringify(process.env);
  readRenewerConfig({
    SUPABASE_URL: `https://${STAGING_HOST}`,
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: STAGING_HOST,
    TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: secretFile(FAKE_ATTESTATION_SECRET),
    TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: secretFile(makeJwt()),
  });
  assert.equal(JSON.stringify(process.env), before, 'process.env was mutated');
  for (const value of Object.values(process.env)) {
    assert.equal(String(value).includes(FAKE_ATTESTATION_SECRET), false,
      'the secret reached the environment');
  }
});
