#!/usr/bin/env node
// Android RELEASE web build with Torneos Production enabled.
//
// REACT_APP_* values are compile-time: the bundle `npx cap sync android` copies
// into the AAB only carries what `npm run build` saw. A local Android build
// never sees the Production-only Torneos env, so 1.1.22 (42) shipped Torneos as
// "No disponible en este entorno".
//
// The keys, their source (the live certified Production web bundle, or an
// ignored `--env-file`) and every refusal live in the shared native profile
// (scripts/native-release-profile.mjs): Android and iOS compile the same set.
//
//   node scripts/build-android-release.mjs                     values from live Production, build, verify
//   node scripts/build-android-release.mjs --env-file <path>   values from an ignored file, build, verify
//   node scripts/build-android-release.mjs --verify-only       verify build/ against live Production
//
// Then, by hand: `npx cap sync android` and the Gradle release build. Signing and
// the Play Console upload are Nico's. Debug/local builds keep using plain
// `npm run build` and their own .env files: without this script Torneos stays closed.
import { runNativeReleaseCli } from './native-release-profile.mjs';

export {
  FORBIDDEN_ENV,
  PRODUCTION_WEB_ORIGIN,
  TORNEOS_NATIVE_PRODUCTION_KEYS as TORNEOS_ANDROID_PRODUCTION_KEYS,
  diffProfile,
  pickTorneosProductionEnv,
  readCompiledEnv,
} from './native-release-profile.mjs';

export const ANDROID_POST_BUILD_STEPS = Object.freeze([]);

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url;
if (isMain) {
  runNativeReleaseCli({ label: 'build-android-release', postBuildSteps: ANDROID_POST_BUILD_STEPS });
}
