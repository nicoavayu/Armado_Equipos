import { supabase } from './api/supabase';
import { deactivateCurrentDevicePushToken } from './pushTokenService';
import { clearSentryUser } from '../utils/monitoring/sentry';

const DEFAULT_MAX_DEACTIVATE_ATTEMPTS = 3;

// Torneos state that belongs to the account that is signing out and outlives the React tree (browser storage).
// Exactly these keys and nothing else: no storage.clear(), no device preferences (home view, app callout), no
// Supabase/Core keys (supabase.auth.signOut owns those). Keep in sync with
// src/features/torneos/context/TorneosWorkspaceContext.jsx (TORNEOS_WORKSPACE_STORAGE_KEY) and
// src/features/torneos/domain/premiumIntent.js (PREMIUM_INTENT_STORAGE_KEY); a test pins both.
// The Torneos gateway bridge bearer lives in memory only and is already dropped by the transport on SIGNED_OUT.
export const TORNEOS_ACCOUNT_STORAGE_KEYS = Object.freeze([
  Object.freeze({ storage: 'localStorage', key: 'arma2:torneos:last-workspace:v2' }),
  Object.freeze({ storage: 'sessionStorage', key: 'arma2:torneos:premium-intent:v1' }),
]);
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

// Never throws and never blocks the sign-out: a storage that is missing or refuses (private mode) is reported only.
export const clearAccountScopedLocalState = () => {
  const failedKeys = [];
  TORNEOS_ACCOUNT_STORAGE_KEYS.forEach(({ storage, key }) => {
    try {
      const target = typeof window !== 'undefined' ? window[storage] : null;
      if (target && typeof target.removeItem === 'function') target.removeItem(key);
    } catch (_error) {
      failedKeys.push(key);
    }
  });
  return failedKeys.length === 0
    ? { success: true }
    : {
      success: false,
      failedKeys,
      message: 'Cerraste sesión, pero no pudimos limpiar algunos datos locales de Torneos en este dispositivo.',
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

  clearSentryUser();
  const localCleanup = clearAccountScopedLocalState();

  return {
    success: true,
    cleanup,
    localCleanup,
    forced: force && !cleanup.success,
  };
};

export const clearLocalAuthSession = async () => {
  try {
    if (typeof supabase.auth._removeSession === 'function') {
      await supabase.auth._removeSession();
    } else {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }

    clearSentryUser();
    const localCleanup = clearAccountScopedLocalState();

    return {
      success: true,
      localCleanup,
    };
  } catch (error) {
    return {
      success: false,
      reason: 'signout_failed',
      error,
    };
  }
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
