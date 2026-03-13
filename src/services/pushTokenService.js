import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { supabase } from './api/supabase';

const PUSH_DEVICE_ID_KEY = 'push_device_id';
const PUSH_LAST_KNOWN_TOKEN_KEY = 'push_last_known_token';
const PUSH_LAST_SYNCED_TOKEN_KEY = 'push_last_synced_token';
const PUSH_PENDING_TOKEN_KEY = 'push_pending_token';

let authSyncStarted = false;
let pendingSyncPromise = Promise.resolve();

const isNative = () => Capacitor.isNativePlatform();

const normalizeToken = (value) => {
  const token = String(value || '').trim();
  return token.length >= 20 ? token : '';
};

const normalizePlatform = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'android') return 'android';
  if (raw === 'ios') return 'ios';
  if (raw === 'web') return 'web';
  return 'unknown';
};

const resolveProvider = (platform) => {
  if (platform === 'android') return 'fcm';
  if (platform === 'ios') return 'apns';
  return 'unknown';
};

const getStorageValue = async (key) => {
  if (isNative()) {
    const { value } = await Preferences.get({ key });
    return value || null;
  }
  return localStorage.getItem(key);
};

const setStorageValue = async (key, value) => {
  if (isNative()) {
    await Preferences.set({ key, value: String(value) });
    return;
  }
  localStorage.setItem(key, String(value));
};

const removeStorageValue = async (key) => {
  if (isNative()) {
    await Preferences.remove({ key });
    return;
  }
  localStorage.removeItem(key);
};

const ensureDeviceId = async () => {
  let deviceId = await getStorageValue(PUSH_DEVICE_ID_KEY);
  if (deviceId) return deviceId;

  deviceId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `push_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  await setStorageValue(PUSH_DEVICE_ID_KEY, deviceId);
  return deviceId;
};

const getCurrentUserId = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user?.id || null;
};

const getPushContext = async () => {
  const platform = normalizePlatform(Capacitor.getPlatform());
  const deviceId = await ensureDeviceId();

  return {
    platform,
    provider: resolveProvider(platform),
    deviceId,
    appVersion: process.env.REACT_APP_VERSION || null,
  };
};

const isAuthRpcError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  return code.includes('401')
    || code.includes('403')
    || code.includes('42501')
    || message.includes('jwt')
    || message.includes('not_authenticated')
    || message.includes('permission denied');
};

const enqueueSync = (task) => {
  pendingSyncPromise = pendingSyncPromise
    .catch(() => null)
    .then(task)
    .catch((error) => {
      console.warn('[PUSH] token sync failed', error);
      return null;
    });

  return pendingSyncPromise;
};

const rpcRegisterToken = async ({ token, previousToken = null }) => {
  const cleanToken = normalizeToken(token);
  if (!cleanToken) {
    return { success: false, reason: 'invalid_token' };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    await setStorageValue(PUSH_PENDING_TOKEN_KEY, cleanToken);
    return { success: false, reason: 'no_authenticated_user' };
  }

  const context = await getPushContext();
  const lastSyncedToken = normalizeToken(await getStorageValue(PUSH_LAST_SYNCED_TOKEN_KEY));
  const oldToken = normalizeToken(previousToken) || (lastSyncedToken && lastSyncedToken !== cleanToken ? lastSyncedToken : '');

  const rpcName = oldToken && oldToken !== cleanToken
    ? 'refresh_device_token'
    : 'register_device_token';

  const params = oldToken && oldToken !== cleanToken
    ? {
      p_old_token: oldToken,
      p_new_token: cleanToken,
      p_platform: context.platform,
      p_provider: context.provider,
      p_app_version: context.appVersion,
      p_device_id: context.deviceId,
    }
    : {
      p_token: cleanToken,
      p_platform: context.platform,
      p_provider: context.provider,
      p_app_version: context.appVersion,
      p_device_id: context.deviceId,
    };

  const { data, error } = await supabase.rpc(rpcName, params);

  if (error) {
    if (isAuthRpcError(error)) {
      await setStorageValue(PUSH_PENDING_TOKEN_KEY, cleanToken);
      return { success: false, reason: 'not_authenticated' };
    }
    throw error;
  }

  if (data?.success === false) {
    await setStorageValue(PUSH_PENDING_TOKEN_KEY, cleanToken);
    return data;
  }

  await setStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY, cleanToken);
  await setStorageValue(PUSH_LAST_SYNCED_TOKEN_KEY, cleanToken);
  await setStorageValue(PUSH_PENDING_TOKEN_KEY, cleanToken);

  return data || { success: true };
};

export const syncNativePushToken = async (token, options = {}) => {
  return enqueueSync(() => rpcRegisterToken({ token, previousToken: options.previousToken || null }));
};

export const flushPendingPushToken = async () => {
  if (!isNative()) return null;

  const pending = normalizeToken(await getStorageValue(PUSH_PENDING_TOKEN_KEY));
  const known = normalizeToken(await getStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY));
  const token = pending || known;

  if (!token) return null;

  return enqueueSync(() => rpcRegisterToken({ token }));
};

export const ensurePushTokenAuthSync = () => {
  if (!isNative() || authSyncStarted) return;
  authSyncStarted = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) return;
    flushPendingPushToken().catch((error) => {
      console.warn('[PUSH] flushPendingPushToken failed on auth state change', error);
    });
  });
};

export const deactivateCurrentDevicePushToken = async (reason = 'user_logout') => {
  if (!isNative()) return { success: true, skipped: 'not_native' };

  const userId = await getCurrentUserId();
  if (!userId) {
    return { success: true, skipped: 'no_authenticated_user' };
  }

  const platform = normalizePlatform(Capacitor.getPlatform());
  const deviceId = await ensureDeviceId();

  const { data, error } = await supabase.rpc('deactivate_device_token', {
    p_device_id: deviceId,
    p_platform: platform,
    p_reason: reason,
  });

  if (error) {
    console.warn('[PUSH] deactivate_device_token failed', error);
    return { success: false, error };
  }

  const lastKnown = normalizeToken(await getStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY));
  if (lastKnown) {
    await setStorageValue(PUSH_PENDING_TOKEN_KEY, lastKnown);
  }
  await removeStorageValue(PUSH_LAST_SYNCED_TOKEN_KEY);

  return data || { success: true };
};

export const getLastKnownNativePushToken = async () => {
  return normalizeToken(await getStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY));
};
