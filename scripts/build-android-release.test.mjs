import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_POST_BUILD_STEPS,
  FORBIDDEN_ENV,
  TORNEOS_ANDROID_PRODUCTION_KEYS,
  pickTorneosProductionEnv,
} from './build-android-release.mjs';
import { TORNEOS_NATIVE_PRODUCTION_KEYS } from './native-release-profile.mjs';
import { productionWebEnv, validProfile } from './native-release-fixtures.mjs';

// The profile itself (keys, refusals, verification, build flow) is covered by native-release-profile.test.mjs.

test('Android compiles the shared native profile: the 8 Production keys plus CONNECTED and BRANDING', () => {
  assert.equal(TORNEOS_ANDROID_PRODUCTION_KEYS, TORNEOS_NATIVE_PRODUCTION_KEYS);
  assert.equal(TORNEOS_ANDROID_PRODUCTION_KEYS.length, 10);
  assert.ok(TORNEOS_ANDROID_PRODUCTION_KEYS.includes('REACT_APP_TORNEOS_CONNECTED_MODE'));
  assert.ok(TORNEOS_ANDROID_PRODUCTION_KEYS.includes('REACT_APP_TORNEOS_BRANDING_MODE'));
  assert.deepEqual(pickTorneosProductionEnv(productionWebEnv), validProfile);
});

test('Android refuses billing, plan read, social and media keys', () => {
  assert.match('REACT_APP_TORNEOS_BILLING_MODE', FORBIDDEN_ENV);
  assert.match('REACT_APP_TORNEOS_PLAN_READ_MODE', FORBIDDEN_ENV);
  assert.match('REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED', FORBIDDEN_ENV);
  assert.match('REACT_APP_TORNEOS_MEDIA_ENABLED', FORBIDDEN_ENV);
});

test('the Android script stops at the verified web build: no sync, Gradle, signing or upload step', () => {
  assert.deepEqual(ANDROID_POST_BUILD_STEPS, []);
});
