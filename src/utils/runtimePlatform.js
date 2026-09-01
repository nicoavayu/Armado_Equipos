import { Capacitor } from '@capacitor/core';
import { torneosFeatureFlags } from '../features/torneos/config/featureFlags';

export const ARMA2_RUNTIME = Object.freeze({
  WEB: 'web',
  IOS: 'ios',
  ANDROID: 'android',
});

export function getArma2Runtime() {
  try {
    if (!Capacitor.isNativePlatform()) return ARMA2_RUNTIME.WEB;
    const platform = Capacitor.getPlatform();
    if (platform === ARMA2_RUNTIME.IOS || platform === ARMA2_RUNTIME.ANDROID) {
      return platform;
    }
  } catch {
    // A browser without a fully initialized Capacitor bridge is always web.
  }
  return ARMA2_RUNTIME.WEB;
}

export function isArma2NativeRuntime() {
  return getArma2Runtime() !== ARMA2_RUNTIME.WEB;
}

export function resolvePersonalSpaceAvailability({
  runtime = getArma2Runtime(),
  featureFlags = torneosFeatureFlags,
} = {}) {
  if (runtime !== ARMA2_RUNTIME.WEB) return true;
  return Boolean(
    featureFlags?.isNonProduction
    && featureFlags?.isIsolatedBackend
    && featureFlags?.torneosEnabled
    && featureFlags?.workspacesEnabled,
  );
}

export function isPersonalSpaceAvailable() {
  return resolvePersonalSpaceAvailability();
}

export function getAuthenticatedProductHome() {
  return isPersonalSpaceAvailable() ? '/' : '/torneos';
}
