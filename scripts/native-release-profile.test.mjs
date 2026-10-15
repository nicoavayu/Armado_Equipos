import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_ENV,
  NATIVE_FIXED_VALUES,
  TORNEOS_NATIVE_PRODUCTION_KEYS,
  assertNoForbiddenEnv,
  diffProfile,
  pickTorneosProductionEnv,
  readCompiledEnv,
  readLiveProductionEnv,
  runNativeRelease,
  verifyBuild,
} from './native-release-profile.mjs';
import {
  REF,
  bundleWith,
  fakeProductionFetch,
  makeBuildDir,
  productionWebEnv,
  silent,
  validProfile,
  writeBundle,
} from './native-release-fixtures.mjs';

test('the native profile is exactly the 8 Production keys plus CONNECTED and BRANDING, none commercial', () => {
  assert.equal(TORNEOS_NATIVE_PRODUCTION_KEYS.length, 10);
  assert.deepEqual([...TORNEOS_NATIVE_PRODUCTION_KEYS].sort(), Object.keys(validProfile).sort());
  for (const key of TORNEOS_NATIVE_PRODUCTION_KEYS) assert.doesNotMatch(key, FORBIDDEN_ENV);
  assert.equal(NATIVE_FIXED_VALUES.REACT_APP_TORNEOS_CONNECTED_MODE, 'on');
  assert.equal(NATIVE_FIXED_VALUES.REACT_APP_TORNEOS_BRANDING_MODE, 'on');
});

test('FORBIDDEN_ENV refuses billing, plan read, social, media, Mercado Pago, commerce and payments', () => {
  for (const key of [
    'REACT_APP_TORNEOS_BILLING_MODE',
    'REACT_APP_TORNEOS_PLAN_READ_MODE',
    'REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED',
    'REACT_APP_TORNEOS_MEDIA_MODE',
    'REACT_APP_TORNEOS_MEDIA_ENABLED',
    'REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED',
    'REACT_APP_MERCADOPAGO_PUBLIC_KEY',
    'REACT_APP_TORNEOS_COMMERCE_ENABLED',
    'REACT_APP_PAYMENTS_ENABLED',
  ]) assert.match(key, FORBIDDEN_ENV, key);
  assert.doesNotMatch('REACT_APP_SUPABASE_URL', FORBIDDEN_ENV);
  assert.throws(() => assertNoForbiddenEnv({ REACT_APP_TORNEOS_PLAN_READ_MODE: 'off' }, 'x'), /x sets REACT_APP_TORNEOS_PLAN_READ_MODE/);
  assert.doesNotThrow(() => assertNoForbiddenEnv(validProfile));
});

test('pickTorneosProductionEnv keeps only the profile from the full Production web env', () => {
  const picked = pickTorneosProductionEnv({ ...productionWebEnv, REACT_APP_SUPABASE_ANON_KEY: 'anon' });
  assert.deepEqual(picked, validProfile);
  assert.ok(Object.isFrozen(picked));
});

test('pickTorneosProductionEnv refuses a missing key or a closed flag', () => {
  const missing = { ...validProfile };
  delete missing.REACT_APP_TORNEOS_GATEWAY_URL;
  assert.throws(() => pickTorneosProductionEnv(missing), /GATEWAY_URL is missing/);
  const noConnected = { ...validProfile };
  delete noConnected.REACT_APP_TORNEOS_CONNECTED_MODE;
  assert.throws(() => pickTorneosProductionEnv(noConnected), /CONNECTED_MODE is missing/);
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_TORNEOS_ENABLED: 'false' }), /must be true/);
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_TORNEOS_DATA_ENV: 'staging' }), /must be production/);
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_TORNEOS_CONNECTED_MODE: 'true' }), /CONNECTED_MODE must be on/);
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_TORNEOS_BRANDING_MODE: 'off' }), /BRANDING_MODE must be on/);
});

test('pickTorneosProductionEnv refuses an unsafe gateway', () => {
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_TORNEOS_GATEWAY_URL: 'http://gateway.example.test' }), /plain https/);
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test/?k=1' }), /plain https/);
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_TORNEOS_GATEWAY_URL: `https://${REF}.supabase.co/functions/v1/x` }), /names the Core/);
  assert.throws(() => pickTorneosProductionEnv({ ...validProfile, REACT_APP_PRODUCTION_PROJECT_REF: 'nope' }), /not a project ref/);
});

test('readCompiledEnv parses the CRA env literal as data', () => {
  const env = readCompiledEnv(bundleWith({ ...validProfile, REACT_APP_SUPABASE_URL: 'https://x.example.test' }));
  assert.deepEqual(diffProfile(env, validProfile), []);
  assert.equal(env.REACT_APP_SUPABASE_URL, 'https://x.example.test');
  assert.equal(readCompiledEnv('no env here'), null);
});

test('diffProfile reports a missing or different value', () => {
  const env = readCompiledEnv(bundleWith({ ...validProfile, REACT_APP_TORNEOS_ENABLED: 'false' }));
  delete env.REACT_APP_TORNEOS_GATEWAY_URL;
  const drift = diffProfile(env, validProfile);
  assert.equal(drift.length, 2);
  assert.match(drift.join('\n'), /REACT_APP_TORNEOS_ENABLED/);
  assert.match(drift.join('\n'), /REACT_APP_TORNEOS_GATEWAY_URL/);
});

test('readLiveProductionEnv reads the profile through the injected fetch only', async () => {
  const { fetchImpl, calls } = fakeProductionFetch();
  const env = await readLiveProductionEnv({ fetchImpl, log: silent });
  assert.deepEqual(env, validProfile);
  assert.deepEqual(calls, ['https://app.arma2.com.ar/torneos', 'https://app.arma2.com.ar/static/js/main.0123abcd.js']);
  const closed = fakeProductionFetch({ ...productionWebEnv, REACT_APP_TORNEOS_BRANDING_MODE: 'off' });
  await assert.rejects(readLiveProductionEnv({ fetchImpl: closed.fetchImpl, log: silent }), /BRANDING_MODE must be on/);
});

test('verifyBuild accepts the profile and refuses drift, a forbidden key or a Mercado Pago marker', () => {
  const buildDir = makeBuildDir(validProfile);
  try {
    assert.equal(verifyBuild(validProfile, { buildDir, log: silent }), 'main.abc123.js');
    writeBundle(buildDir, { ...validProfile, REACT_APP_TORNEOS_PLAN_READ_MODE: 'on' });
    assert.throws(() => verifyBuild(validProfile, { buildDir, log: silent }), /carries REACT_APP_TORNEOS_PLAN_READ_MODE/);
    writeBundle(buildDir, { ...validProfile, REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'false' });
    assert.throws(() => verifyBuild(validProfile, { buildDir, log: silent }), /carries REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED/);
    writeBundle(buildDir, { ...validProfile, REACT_APP_TORNEOS_BRANDING_MODE: 'off' });
    assert.throws(() => verifyBuild(validProfile, { buildDir, log: silent }), /does not carry the profile/);
    writeBundle(buildDir, validProfile, { '12.chunk.js': 'fetch("https://api.mercadopago.com/x")' });
    assert.throws(() => verifyBuild(validProfile, { buildDir, log: silent }), /bundle contains api\.mercadopago\.com/);
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
});

function fakeRun({ env = {}, argv = [], postBuildSteps = [], buildEnv = validProfile } = {}) {
  const buildDir = makeBuildDir({});
  const spawned = [];
  const spawn = (command, args, options) => {
    spawned.push({ command, args: [...args], env: options.env });
    if (command === 'npm') writeBundle(buildDir, buildEnv);
    return { status: 0 };
  };
  const { fetchImpl, calls } = fakeProductionFetch();
  const promise = runNativeRelease({
    label: 'test',
    argv,
    env: { REACT_APP_SUPABASE_URL: `https://${REF}.supabase.co`, ...env },
    postBuildSteps,
    fetchImpl,
    spawn,
    loadEnvironment: () => [],
    buildDir,
    log: silent,
  });
  const cleanup = () => fs.rmSync(buildDir, { recursive: true, force: true });
  return { promise: promise.finally(cleanup), spawned, calls };
}

test('runNativeRelease builds with exactly the profile injected, verifies, then runs the platform steps', async () => {
  const step = { command: 'npx', args: ['cap', 'sync', 'ios'], env: { LANG: 'en_US.UTF-8' } };
  const { promise, spawned, calls } = fakeRun({ postBuildSteps: [step] });
  const result = await promise;
  assert.deepEqual(result.steps, ['npm run build', 'npx cap sync ios']);
  assert.equal(calls.length, 2);
  assert.deepEqual(spawned.map(({ command, args }) => [command, ...args].join(' ')), ['npm run build', 'npx cap sync ios']);
  for (const [key, value] of Object.entries(validProfile)) assert.equal(spawned[0].env[key], value, key);
  assert.equal(spawned[1].env.LANG, 'en_US.UTF-8');
  for (const { env } of spawned) assert.deepEqual(Object.keys(env).filter((key) => FORBIDDEN_ENV.test(key)), []);
});

test('runNativeRelease refuses a forbidden key, a conflicting value or a non-Production Core before building', async () => {
  const forbidden = fakeRun({ env: { REACT_APP_TORNEOS_BILLING_MODE: 'off' } });
  await assert.rejects(forbidden.promise, /sets REACT_APP_TORNEOS_BILLING_MODE/);
  assert.equal(forbidden.spawned.length, 0);

  const conflict = fakeRun({ env: { REACT_APP_TORNEOS_CONNECTED_MODE: 'off' } });
  await assert.rejects(conflict.promise, /already sets REACT_APP_TORNEOS_CONNECTED_MODE/);
  assert.equal(conflict.spawned.length, 0);

  const mixed = fakeRun({ env: { REACT_APP_SUPABASE_URL: 'https://other.example.test' } });
  await assert.rejects(mixed.promise, /not the Core Production project/);
  assert.equal(mixed.spawned.length, 0);
});

test('runNativeRelease never runs the platform steps after a bundle that fails verification', async () => {
  const step = { command: 'npx', args: ['cap', 'sync', 'ios'] };
  const { promise, spawned } = fakeRun({ postBuildSteps: [step], buildEnv: { ...validProfile, REACT_APP_TORNEOS_MEDIA_MODE: 'on' } });
  await assert.rejects(promise, /carries REACT_APP_TORNEOS_MEDIA_MODE/);
  assert.deepEqual(spawned.map(({ command }) => command), ['npm']);
});

test('runNativeRelease --verify-only only reads and verifies', async () => {
  const buildDir = makeBuildDir(validProfile);
  try {
    const { fetchImpl } = fakeProductionFetch();
    const spawn = () => assert.fail('no process may run in --verify-only');
    const result = await runNativeRelease({
      label: 'test', argv: ['--verify-only'], env: {}, fetchImpl, spawn, loadEnvironment: () => assert.fail('no env load'), buildDir, log: silent,
    });
    assert.deepEqual(result.steps, []);
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
});

test('the profile module never writes or embeds a target', () => {
  const source = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'native-release-profile.mjs'), 'utf8');
  assert.doesNotMatch(source, /[a-z]{20}\.supabase\.co/);
  assert.doesNotMatch(source, /writeFileSync/);
});
