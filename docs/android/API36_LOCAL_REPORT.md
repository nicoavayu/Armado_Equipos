# ARMA2 Android API 36 — local upgrade

Date: 2026-09-28. Local-only result; no push, Play Console access or publication.

## Base and scope

- `main` and freshly fetched `origin/main`: `13db349584d5bea6abbc158abfd0d41636947f3c`.
- Isolated branch: `codex/android-api36-local`.
- Worktree: `/Users/nicoavayu/.codex/worktrees/android-api36-local/arma2`.
- Version remains **1.1.21 / 41**. No release version guessed or incremented.
- minSdk **23**, compileSdk **36**, targetSdk **36**.
- AGP **8.10.0**, Gradle **8.11.1** unchanged, build JDK **21**.
- Signing configuration and existing keystore unchanged. Local ignored copies of existing build configuration used.
- No changes to iOS, backend, Torneos, Vercel, Supabase, Deno or frontend UX.

## Implementation

Only `android/variables.gradle`, `android/build.gradle` and
`android/app/src/main/AndroidManifest.xml` change executable configuration.
Documentation is this report and `ANDROID_LARGE_SCREEN_ADAPTATION.md`.

MainActivity retains `android:screenOrientation="portrait"` and `adjustResize`.
The official property is a direct child of MainActivity, with `android:value="true"`:
`android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`.
No new resize restrictions, orientation code, responsive layouts or compatibility hacks.

AGP 8.9.1 is the official minimum for API 36, but the existing Firebase BoM 34.11.0
resolves measurement-api 23.2.0 containing Kotlin metadata `mv=[2,2,0]`.
An actual build with 8.9.1 emitted D8 Kotlin metadata rewriting errors as warnings.
AGP 8.10.0 is the minimum for Kotlin 2.2 support; rebuilding removed those warnings.
There is no dependency or Gradle-wrapper update.

## Build and checks

Local evidence directory: `artifacts/api36/` (ignored, not committed).

| Check | Result |
| --- | --- |
| npm ci from lockfile | Passed; lockfile unchanged |
| npm run build; npx cap sync android | Passed |
| assembleDebug | Passed |
| assembleRelease | Passed, signed APK |
| bundleRelease | Passed, signed AAB |
| lintDebug | Passed: 0 errors, 20 warnings |
| testDebugUnitTest | Passed: 1 existing scaffold test; limited behavioral coverage |
| npm run test:ci | Passed: 335 suites, 3254 tests |
| npm run lint | Passed |
| git diff --check | Passed |
| merged debug/release manifests | Parsed and checked |
| packaged APK and AAB manifests | Decoded with apkanalyzer/bundletool and checked |
| APK signing / AAB signing | apksigner verifies; jarsigner reports jar verified |
| 16KB packaging | zipalign -c -P 16 passes; all four bundled ELF libraries have >=16384 PT_LOAD alignment |
| emulator crash buffer | Empty at collection |

Final manifests confirm version 1.1.21 / 41, min 23, target 36, compile 36,
MainActivity portrait (numeric enum 1 in packaged manifests), and property=true
under that activity. The source, merged output, APK and AAB agree.

Artifacts retained in `artifacts/api36/final/`:
`app-debug.apk`, `app-release.apk`, `app-release.aab`, decoded and merged manifests,
lint report, signature reports, ELF alignment report, zipalign report and SHA256SUMS.
Standard Gradle output paths also contain the final target-36 builds.
`gradle-build.log` is the complete AGP 8.10 build; `final-rebuild.log` verifies restoration
after generating the comparison APK. `gradle-agp891.log` preserves the initial warning evidence.

## Android 16 tablet runtime test

Dedicated AVD `Arma2_API36_Tablet`, Pixel Tablet profile, arm64 Google Play image:
`google/sdk_gphone64_arm64/emu64a:16/BE4B.251210.005/14574095:user/release-keys`.
Runtime reports Android 16 / SDK 36. Installed system-image package is android-36.1.
Physical display 2560x1600, density 320: **1280x800dp, sw800dp**.
Rotation was simulated with the emulator's physical rotate command (`adb emu rotate`),
with auto-rotate enabled, not with application orientation overrides.
Split-screen was entered through Overview > Arma2 > Split screen > Settings;
resize was exercised by dragging the system divider.

Comparison APK uses the same web assets, dependencies, compile SDK and toolchain,
with target restored to 35 and the property removed. This isolates target/opt-out behavior;
it is not claimed to be a byte-for-byte reproduction of the old production APK.
After comparison the source was restored and all final native tasks rerun successfully.

| Scenario | Target 36 + opt-out | Target 35 comparison |
| --- | --- | --- |
| Device portrait | Fullscreen portrait, 800x1280dp | Same |
| Device landscape | Portrait content 600x800dp, pillarboxing; bounds (680,0)-(1880,1600) | Same |
| Physical rotate | Device rotates; app remains portrait, switches between fullscreen and pillarboxing | Same |
| Split 50/50 in portrait | Multi-window portrait, app bounds (324,0)-(1277,1270), 477x635dp, pillarboxing | Same |
| Drag divider to larger top pane | Stable bounds (0,0)-(1600,1684), 800x842dp, portrait | Same |

No stable orientation/window-size difference observed in those scenarios. An initial dump
during resize reported transitional 640x800dp; a settled repeat with the final APK reported
800x842dp, matching the target-35 comparison. Both captures are retained.
The opt-out **does not disable split-screen or resize**: these were already possible with
the existing manifest (resizeableActivity is unspecified). Do not add false restrictions
based on an assumption that portrait means non-resizable.

Screenshots and dumps: `tablet-initial`, `tablet-rotated`, `tablet-split`, `tablet-resize`,
`final-resize`, and `baseline-{portrait,landscape,split,resize}` in the evidence directory.
The final AGP 8.10 APK was reinstalled and the settled resize comparison repeated.

## Edge-to-edge, keyboard and Back

No edge-to-edge opt-out exists in the app theme; no new one was added.
Inspected login/email surfaces show no obstructed actionable controls at the system bars.
Email input and submit button remain accessible with Gboard visible, without the gray band.
The emulator initially used stylus handwriting; disabling handwriting and enabling soft IME
for its hardware keyboard allowed a real docked-keyboard test. These are emulator-only settings.
Evidence: `tablet-email.png`, `tablet-keyboard.png`, `tablet-after-back.png`.
An edge swipe hides the keyboard (`mInputShown=false`).

Capacitor App already registers AndroidX OnBackPressedCallback with the dispatcher;
no deprecated onBackPressed override or additional back opt-out was introduced.
At a root WebView without history/listeners, its existing handler does not explicitly exit.
A later root Back probe did not establish a conclusive back-to-home result; it is not reported
as passing navigation coverage. Authenticated navigation, onboarding dismissal, chat input,
OAuth completion and OEM-specific behavior were not exercised end-to-end in this session.
This is a local build/compatibility smoke test, not comprehensive release certification.

## Remaining warnings

- Android lint: manifest permission order, redundant label, newer Gradle/dependency suggestions,
  fixed portrait orientation (intentional temporary decision), unused resources and splash density/duplicates.
- D8 warning in existing play-services-location 21.3.0: companion object missing for internal zze.
- Existing Capacitor filesystem Kotlin deprecation/nullability warnings, camera unchecked operations,
  flatDir repositories and multiple Kotlin daemon sessions.
- JS: old Browserslist dataset; test output includes existing React act warnings.
- Signing verification: self-signed certificate/no timestamp and ZIP metadata warnings from jarsigner;
  APK verifier warns about META-INF metadata outside signature protection. Signing config was not changed.
- No suppression flags or broad library updates added to conceal warnings.

## Secret scan and local commit

Completed before committing: exact five-file staged allowlist checked; staged contents scanned for
private-key/token patterns and literal values from local signing/environment configuration.
Result: PASS, no matches. Evidence: `artifacts/api36/secret-scan.txt`.
Only the three Android files and two Markdown documents belong in the local commit.
Build artifacts, environment files, Firebase configuration and keystore remain ignored.
The scan is scoped to this change, not a certification of repository history or dependencies.

## Follow-up

[ANDROID LARGE SCREEN ADAPTATION](ANDROID_LARGE_SCREEN_ADAPTATION.md) is OPEN and required
before API 37. The opt-out is temporary and cannot be relied upon after that target migration.

Official references:
- https://developer.android.com/about/versions/16/behavior-changes-16#adaptive-layouts
- https://developer.android.com/build/releases/about-agp
- https://developer.android.com/build/kotlin-support
- https://developer.android.com/about/versions/17/changes/ff-restrictions-ignored
