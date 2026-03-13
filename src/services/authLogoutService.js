import { supabase } from './api/supabase';
import { deactivateCurrentDevicePushToken } from './pushTokenService';

const DEFAULT_MAX_DEACTIVATE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 350, 900];

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isDeactivationSuccess = (result) => {
  if (!result || typeof result !== 'object') return false;
  if (result.success === true) return true;
  return Boolean(result.skipped);
};

export const deactivatePushTokenWithRetry = async ({
  reason = 'user_logout',
  maxAttempts = DEFAULT_MAX_DEACTIVATE_ATTEMPTS,
} = {}) => {
  const attempts = Math.max(1, Number(maxAttempts) || DEFAULT_MAX_DEACTIVATE_ATTEMPTS);
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastResult = await deactivateCurrentDevicePushToken(reason);
    } catch (error) {
      lastResult = { success: false, error };
    }

    if (isDeactivationSuccess(lastResult)) {
      return {
        success: true,
        attempts: attempt,
        result: lastResult,
      };
    }

    if (attempt < attempts) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  return {
    success: false,
    attempts,
    result: lastResult,
  };
};

export const signOutWithPushDeactivation = async ({
  reason = 'user_logout',
  force = false,
  maxDeactivateAttempts = DEFAULT_MAX_DEACTIVATE_ATTEMPTS,
} = {}) => {
  const cleanup = await deactivatePushTokenWithRetry({
    reason,
    maxAttempts: maxDeactivateAttempts,
  });

  if (!cleanup.success && !force) {
    return {
      success: false,
      reason: 'push_cleanup_failed',
      cleanup,
    };
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return {
      success: false,
      reason: 'signout_failed',
      error,
      cleanup,
    };
  }

  return {
    success: true,
    cleanup,
    forced: force && !cleanup.success,
  };
};

export const getLogoutErrorMessage = (result) => {
  if (!result || result.success) return '';

  if (result.reason === 'push_cleanup_failed') {
    const rpcErrorMessage = result?.cleanup?.result?.error?.message;
    return rpcErrorMessage
      ? `No se pudo desactivar el token push (${rpcErrorMessage}).`
      : 'No se pudo desactivar el token push en este dispositivo.';
  }

  if (result.reason === 'signout_failed') {
    return result?.error?.message
      ? `No se pudo cerrar sesión (${result.error.message}).`
      : 'No se pudo cerrar sesión.';
  }

  return 'No se pudo cerrar sesión.';
};
