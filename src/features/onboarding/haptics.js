// Safe, dependency-light haptics wrapper for onboarding. Uses the existing
// @capacitor/haptics abstraction on native and falls back to the Web Vibration
// API elsewhere. Every call is guarded so a missing plugin or a browser without
// vibration never throws.

import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

const WEB_PATTERNS = { light: 12, medium: 22, heavy: 34 };

export async function onboardingHaptic(type = 'light') {
  try {
    if (Capacitor?.isNativePlatform?.()) {
      const style = type === 'heavy'
        ? ImpactStyle.Heavy
        : type === 'medium'
          ? ImpactStyle.Medium
          : ImpactStyle.Light;
      await Haptics.impact({ style });
      return;
    }
  } catch (_error) {
    // fall through to web vibration
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(WEB_PATTERNS[type] || WEB_PATTERNS.light);
    }
  } catch (_error) {
    // no-op
  }
}
