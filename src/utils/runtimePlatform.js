import { Capacitor } from '@capacitor/core';

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

export function getAuthenticatedProductHome() {
  return isArma2NativeRuntime() ? '/' : '/torneos';
}
