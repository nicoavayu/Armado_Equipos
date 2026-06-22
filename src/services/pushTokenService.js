import logger from '../utils/logger';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { supabase } from './api/supabase';

const PUSH_DEVICE_ID_KEY = 'push_device_id';
const PUSH_LAST_KNOWN_TOKEN_KEY = 'push_last_known_token';
const PUSH_LAST_SYNCED_TOKEN_KEY = 'push_last_synced_token';
const PUSH_LAST_SYNCED_USER_ID_KEY = 'push_last_synced_user_id';
const PUSH_PENDING_TOKEN_KEY = 'push_pending_token';

let pendingSyncPromise = Promise.resolve();

const isNative = () => Capacitor.isNativePlatform();

const normalizeToken = (value) => {
  const token = String(value || '').trim();
  return token.length >= 20 ? token : '';
};

const getTokenSuffix = (value) => {
  const token = normalizeToken(value);
  return token ? token.slice(-8) : '';
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
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data?.session?.user?.id || null;
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
      logger.warn('[PUSH] token sync failed', error);
      return null;
    });

  return pendingSyncPromise;
};

const savePendingToken = async (token, source, reason) => {
  const cleanToken = normalizeToken(token);
  if (!cleanToken) return;

  await setStorageValue(PUSH_PENDING_TOKEN_KEY, cleanToken);
  logger.info('[PUSH] pending_saved', {
    source,
    reason,
    tokenSuffix: getTokenSuffix(cleanToken),
  });
};

const logSyncStart = ({ source, userId, token, deviceId, platform, provider, rpcName }) => {
  logger.info('[PUSH] sync_start', {
    source,
    userId,
    tokenSuffix: getTokenSuffix(token),
    deviceId,
    platform,
    provider,
    rpcName,
  });
};

const logSyncResult = ({ source, ok, userId, token, tokenId = null, reason = null }) => {
  logger.info('[PUSH] sync_result', {
    source,
    ok,
    userId,
    tokenSuffix: getTokenSuffix(token),
    tokenId,
    reason,
  });
};

const logSyncError = ({ source, userId, token, error }) => {
  logger.warn('[PUSH] sync_error', {
    source,
    userId,
    tokenSuffix: getTokenSuffix(token),
    code: error?.code || null,
    message: error?.message || String(error || 'unknown_error'),
  });
};

const rpcRegisterToken = async ({ token, previousToken = null, source = 'unknown' }) => {
  const cleanToken = normalizeToken(token);
  if (!cleanToken) {
    return { success: false, reason: 'invalid_token' };
  }

  await setStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY, cleanToken);

  const userId = await getCurrentUserId();
  if (!userId) {
    await savePendingToken(cleanToken, source, 'no_session');
    logSyncResult({
      source,
      ok: false,
      userId: null,
      token: cleanToken,
      reason: 'no_authenticated_user',
    });
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

  logSyncStart({
    source,
    userId,
    token: cleanToken,
    deviceId: context.deviceId,
    platform: context.platform,
    provider: context.provider,
    rpcName,
  });

  const { data, error } = await supabase.rpc(rpcName, params);

  if (error) {
    if (isAuthRpcError(error)) {
      await savePendingToken(cleanToken, source, 'auth_rpc_error');
      logSyncResult({
        source,
        ok: false,
        userId,
        token: cleanToken,
        reason: 'not_authenticated',
      });
      return { success: false, reason: 'not_authenticated' };
    }
    logSyncError({ source, userId, token: cleanToken, error });
    throw error;
  }

  if (data?.success === false) {
    await savePendingToken(cleanToken, source, data?.reason || 'backend_rejected');
    logSyncResult({
      source,
      ok: false,
      userId,
      token: cleanToken,
      reason: data?.reason || 'backend_rejected',
    });
    return data;
  }

  await setStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY, cleanToken);
  await setStorageValue(PUSH_LAST_SYNCED_TOKEN_KEY, cleanToken);
  await setStorageValue(PUSH_LAST_SYNCED_USER_ID_KEY, userId);
  await removeStorageValue(PUSH_PENDING_TOKEN_KEY);

  logSyncResult({
    source,
    ok: true,
    userId,
    token: cleanToken,
    tokenId: data?.token_id || null,
  });

  return data || { success: true };
};

export const syncNativePushToken = async (token, options = {}) => {
  return enqueueSync(() => rpcRegisterToken({
    token,
    previousToken: options.previousToken || null,
    source: options.source || 'manual',
  }));
};

export const flushPendingPushToken = async (options = {}) => {
  if (!isNative()) return null;

  const pending = normalizeToken(await getStorageValue(PUSH_PENDING_TOKEN_KEY));
  const known = normalizeToken(await getStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY));
  const token = pending || known;

  if (!token) return null;

  return enqueueSync(() => rpcRegisterToken({
    token,
    source: options.source || 'flush_pending',
  }));
};

export const getPushTokenSyncState = async () => {
  const pending = normalizeToken(await getStorageValue(PUSH_PENDING_TOKEN_KEY));
  const known = normalizeToken(await getStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY));
  const lastSyncedToken = normalizeToken(await getStorageValue(PUSH_LAST_SYNCED_TOKEN_KEY));
  const lastSyncedUserId = await getStorageValue(PUSH_LAST_SYNCED_USER_ID_KEY);

  return {
    hasPending: Boolean(pending),
    hasKnown: Boolean(known),
    pendingTokenSuffix: getTokenSuffix(pending),
    knownTokenSuffix: getTokenSuffix(known),
    lastSyncedTokenSuffix: getTokenSuffix(lastSyncedToken),
    lastSyncedUserId: lastSyncedUserId || null,
  };
};

export const deactivateCurrentDevicePushToken = async (reason = 'user_logout') => {
  if (!isNative()) return { success: true, skipped: 'not_native' };

  const userId = await getCurrentUserId();
  if (!userId) {
    await removeStorageValue(PUSH_LAST_SYNCED_TOKEN_KEY);
    await removeStorageValue(PUSH_LAST_SYNCED_USER_ID_KEY);
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
    logger.warn('[PUSH] deactivate_device_token failed', error);
    return { success: false, error };
  }

  const lastKnown = normalizeToken(await getStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY));
  if (lastKnown) {
    await setStorageValue(PUSH_PENDING_TOKEN_KEY, lastKnown);
  }
  await removeStorageValue(PUSH_LAST_SYNCED_TOKEN_KEY);
  await removeStorageValue(PUSH_LAST_SYNCED_USER_ID_KEY);

  return data || { success: true };
};

export const getLastKnownNativePushToken = async () => {
  return normalizeToken(await getStorageValue(PUSH_LAST_KNOWN_TOKEN_KEY));
};
