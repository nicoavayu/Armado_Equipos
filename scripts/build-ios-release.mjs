#!/usr/bin/env node
// iOS RELEASE web build with Torneos Production enabled: the same native profile as Android
// (scripts/native-release-profile.mjs), the same bundle verification and the same Core Production guard, then
// `npx cap sync ios` so the Xcode project carries the verified bundle.
//
//   node scripts/build-ios-release.mjs                     values from live Production, build, verify, cap sync ios
//   node scripts/build-ios-release.mjs --env-file <path>   values from an ignored file, build, verify, cap sync ios
//   node scripts/build-ios-release.mjs --skip-sync         build and verify only
//   node scripts/build-ios-release.mjs --verify-only       verify build/ against live Production
//
// This script never archives, signs or uploads. Archive, signing and Distribute (TestFlight / App Store Connect) are
// Nico's, in Xcode. Before an iOS binary with Torneos is useful, the Production gateway must also admit the WKWebView
// origin `capacitor://localhost` (a separate gateway change with its own GO): today it answers 403.
import { runNativeReleaseCli } from './native-release-profile.mjs';

export {
  FORBIDDEN_ENV,
  PRODUCTION_WEB_ORIGIN,
  TORNEOS_NATIVE_PRODUCTION_KEYS as TORNEOS_IOS_PRODUCTION_KEYS,
  diffProfile,
  pickTorneosProductionEnv,
  readCompiledEnv,
} from './native-release-profile.mjs';

// CocoaPods (run by `cap sync ios`) fails on a non-UTF-8 locale: the sync always runs with en_US.UTF-8.
export const IOS_SYNC_STEP = Object.freeze({
  command: 'npx',
  args: Object.freeze(['cap', 'sync', 'ios']),
  env: Object.freeze({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }),
});

export function iosPostBuildSteps(argv = []) {
  return argv.includes('--skip-sync') ? [] : [IOS_SYNC_STEP];
}

export const IOS_NEXT_STEPS = 'build-ios-release: next steps are Nico\'s, in Xcode (ios/App/App.xcworkspace): '
  + 'bump MARKETING_VERSION / CURRENT_PROJECT_VERSION, Product → Archive, sign, Distribute. This script never does them.';

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  runNativeReleaseCli({ label: 'build-ios-release', argv, postBuildSteps: iosPostBuildSteps(argv) })
    .then((result) => { if (result) console.log(IOS_NEXT_STEPS); });
}
