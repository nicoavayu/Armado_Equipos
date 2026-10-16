import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_ENV,
  IOS_NEXT_STEPS,
  IOS_SYNC_STEP,
  TORNEOS_IOS_PRODUCTION_KEYS,
  iosPostBuildSteps,
  pickTorneosProductionEnv,
} from './build-ios-release.mjs';
import {
  TORNEOS_ANDROID_PRODUCTION_KEYS,
  FORBIDDEN_ENV as ANDROID_FORBIDDEN_ENV,
} from './build-android-release.mjs';
import { productionWebEnv, validProfile } from './native-release-fixtures.mjs';

test('the iOS profile is identical to the Android one', () => {
  assert.equal(TORNEOS_IOS_PRODUCTION_KEYS, TORNEOS_ANDROID_PRODUCTION_KEYS);
  assert.equal(FORBIDDEN_ENV, ANDROID_FORBIDDEN_ENV);
  assert.deepEqual(pickTorneosProductionEnv(productionWebEnv), validProfile);
});

test('after the verified build iOS only syncs the Xcode project, in a UTF-8 locale', () => {
  assert.deepEqual(iosPostBuildSteps([]), [IOS_SYNC_STEP]);
  assert.deepEqual(iosPostBuildSteps(['--skip-sync']), []);
  assert.deepEqual([IOS_SYNC_STEP.command, ...IOS_SYNC_STEP.args], ['npx', 'cap', 'sync', 'ios']);
  assert.equal(IOS_SYNC_STEP.env.LANG, 'en_US.UTF-8');
  assert.equal(IOS_SYNC_STEP.env.LC_ALL, 'en_US.UTF-8');
  for (const key of Object.keys(IOS_SYNC_STEP.env)) assert.doesNotMatch(key, FORBIDDEN_ENV);
});

test('the iOS script never archives, signs or uploads', () => {
  const source = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'build-ios-release.mjs'), 'utf8');
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  for (const tool of ['xcodebuild', 'xcrun', 'altool', 'notarytool', 'fastlane', 'exportArchive', 'codesign', 'transporter']) {
    assert.doesNotMatch(code, new RegExp(tool, 'i'), tool);
  }
  assert.match(IOS_NEXT_STEPS, /Nico/);
  assert.match(IOS_NEXT_STEPS, /never does them/);
});
