import posthog from 'posthog-js';

const isBrowser = typeof window !== 'undefined';
const isDev = process.env.NODE_ENV !== 'production';
const isDebug = isDev && String(process.env.REACT_APP_ANALYTICS_DEBUG || '').toLowerCase() === 'true';
const ALLOWED_EVENTS = new Set(['app_open', 'view_match', 'blocking_error']);

let posthogClient = null;
let initialized = false;
let enabled = false;

const debugLog = (...args) => {
  if (!isDebug) return;
  // eslint-disable-next-line no-console
  console.info('[monitoring:analytics]', ...args);
};

const cleanProps = (props = {}) => {
  if (!props || typeof props !== 'object') return {};
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
};

const getPlatform = () => {
  const maybeCapacitor = window?.Capacitor;
  if (maybeCapacitor?.isNativePlatform?.()) return 'capacitor';
  return 'web';
};

export const initAnalytics = async () => {
  if (initialized) return enabled;
  initialized = true;

  const key = String(process.env.REACT_APP_POSTHOG_KEY || '').trim();
  if (!isBrowser || !key) {
    debugLog('disabled (missing key or non-browser)');
    enabled = false;
    return false;
  }

  const host = String(process.env.REACT_APP_POSTHOG_HOST || '').trim() || 'https://app.posthog.com';

  try {
    if (!posthog || typeof posthog.init !== 'function') {
      debugLog('module loaded without init function');
      enabled = false;
      return false;
    }

    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
    });

    posthogClient = posthog;
    enabled = true;
    debugLog('initialized');
    track('app_open', { platform: getPlatform() });
    return true;
  } catch (error) {
    enabled = false;
    debugLog('failed to initialize', error);
    return false;
  }
};

export const identifyUser = (userId, props = {}) => {
  if (!enabled || !posthogClient?.identify || !userId) return;
  posthogClient.identify(String(userId), cleanProps(props));
};

export const track = (event, props = {}) => {
  if (!enabled || !posthogClient?.capture) return;
  if (!ALLOWED_EVENTS.has(event)) {
    debugLog('ignored non-allowlisted event', event);
    return;
  }
  const payload = cleanProps(props);
  if (isDebug) {
    // eslint-disable-next-line no-console
    console.info('[monitoring:analytics:track]', event, payload);
  }
  posthogClient.capture(event, payload);
};

export const resetAnalytics = () => {
  if (!enabled || !posthogClient?.reset) return;
  posthogClient.reset();
};
