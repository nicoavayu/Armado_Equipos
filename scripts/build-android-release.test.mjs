import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORBIDDEN_ENV,
  TORNEOS_ANDROID_PRODUCTION_KEYS,
  diffProfile,
  pickTorneosProductionEnv,
  readCompiledEnv,
} from './build-android-release.mjs';

// Placeholder targets only: real ones are read from Production at build time.
const REF = 'abcdefghijklmnopqrst';
const valid = Object.freeze({
  REACT_APP_PRODUCTION_PROJECT_REF: REF,
  REACT_APP_TORNEOS_DATA_ENV: 'production',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test/functions/v1/torneos-gateway',
  REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
  REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
});

const bundleWith = (env) => {
  const entries = Object.entries(env).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(',');
  return `var a=1;const e={NODE_ENV:"production",PUBLIC_URL:"",${entries},REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG:{"viewEndpoint":"x"}};`;
};

test('the Android profile is exactly the 8 Production Torneos keys, none commercial', () => {
  assert.equal(TORNEOS_ANDROID_PRODUCTION_KEYS.length, 8);
  for (const key of TORNEOS_ANDROID_PRODUCTION_KEYS) assert.doesNotMatch(key, FORBIDDEN_ENV);
  assert.match('REACT_APP_TORNEOS_BILLING_MODE', FORBIDDEN_ENV);
  assert.match('REACT_APP_TORNEOS_MEDIA_ENABLED', FORBIDDEN_ENV);
});

test('pickTorneosProductionEnv keeps only the 8 keys from a full compiled env', () => {
  const picked = pickTorneosProductionEnv({ ...valid, REACT_APP_SUPABASE_ANON_KEY: 'anon', REACT_APP_OTHER: 'x' });
  assert.deepEqual(Object.keys(picked).sort(), [...TORNEOS_ANDROID_PRODUCTION_KEYS].sort());
  assert.deepEqual(picked, valid);
});

test('pickTorneosProductionEnv refuses a missing key or a closed flag', () => {
  const missing = { ...valid };
  delete missing.REACT_APP_TORNEOS_GATEWAY_URL;
  assert.throws(() => pickTorneosProductionEnv(missing), /GATEWAY_URL is missing/);
  assert.throws(() => pickTorneosProductionEnv({ ...valid, REACT_APP_TORNEOS_ENABLED: 'false' }), /must be true/);
  assert.throws(() => pickTorneosProductionEnv({ ...valid, REACT_APP_TORNEOS_DATA_ENV: 'staging' }), /must be production/);
});

test('pickTorneosProductionEnv refuses an unsafe gateway', () => {
  assert.throws(() => pickTorneosProductionEnv({ ...valid, REACT_APP_TORNEOS_GATEWAY_URL: 'http://gateway.example.test' }), /plain https/);
  assert.throws(() => pickTorneosProductionEnv({ ...valid, REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test/?k=1' }), /plain https/);
  assert.throws(() => pickTorneosProductionEnv({ ...valid, REACT_APP_TORNEOS_GATEWAY_URL: `https://${REF}.supabase.co/functions/v1/x` }), /names the Core/);
  assert.throws(() => pickTorneosProductionEnv({ ...valid, REACT_APP_PRODUCTION_PROJECT_REF: 'nope' }), /not a project ref/);
});

test('readCompiledEnv parses the CRA env literal as data', () => {
  const env = readCompiledEnv(bundleWith({ ...valid, REACT_APP_SUPABASE_URL: 'https://x.example.test' }));
  assert.deepEqual(diffProfile(env, valid), []);
  assert.equal(env.REACT_APP_SUPABASE_URL, 'https://x.example.test');
  assert.equal(readCompiledEnv('no env here'), null);
});

test('diffProfile reports a missing or different value', () => {
  const env = readCompiledEnv(bundleWith({ ...valid, REACT_APP_TORNEOS_ENABLED: 'false' }));
  delete env.REACT_APP_TORNEOS_GATEWAY_URL;
  const drift = diffProfile(env, valid);
  assert.equal(drift.length, 2);
  assert.match(drift.join('\n'), /REACT_APP_TORNEOS_ENABLED/);
  assert.match(drift.join('\n'), /REACT_APP_TORNEOS_GATEWAY_URL/);
});
