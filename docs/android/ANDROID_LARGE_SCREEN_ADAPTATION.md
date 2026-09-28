# ANDROID LARGE SCREEN ADAPTATION

Status: OPEN — prerequisite for the future target API 37 migration.

API 36 temporarily preserves MainActivity's existing portrait behavior with
`android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY=true`.
This is a temporary Android 16 compatibility exception, not a permanent tablet strategy.
Google removes this opt-out for target API 37; plan and validate adaptation before changing target again.

## Scope of the future work

- Remove the compatibility property and portrait restriction as part of a reviewed tablet UX change.
- Adapt layouts to available window dimensions, including tablets >=600dp, foldables and desktop windows.
- Support physical rotation, split-screen and continuous resizing while preserving navigation, forms and state.
- Validate system bars, cutouts, IME/insets and AndroidX back navigation in each window configuration.
- Test portrait/landscape, split ratios, small freeform windows and process/activity recreation on API 37.
- Include authenticated flows, dialogs, chat and input-heavy screens in the acceptance matrix.

Acceptance: no reliance on the API 36 exception; usable layouts and preserved state across the matrix,
with screenshots and device/configuration evidence. Product review required for the new tablet UX.
This follow-up does not authorize or implement that redesign in the API 36 upgrade.

## Current observed baseline

Android 16 Pixel Tablet emulator, sw800dp: portrait fullscreen; landscape pillarboxed portrait;
split-screen and divider resizing remain possible. The exception does not disable multiventana.
See [local upgrade report](API36_LOCAL_REPORT.md).

References:
- https://developer.android.com/about/versions/16/behavior-changes-16#adaptive-layouts
- https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability
- https://developer.android.com/about/versions/17/changes/ff-restrictions-ignored
