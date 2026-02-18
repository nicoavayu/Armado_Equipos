import * as Sentry from '@sentry/react';

const isBrowser = typeof window !== 'undefined';
const isDebug =
  process.env.NODE_ENV !== 'production' &&
  String(process.env.REACT_APP_ANALYTICS_DEBUG || '').toLowerCase() === 'true';

let sentryClient = null;
let initialized = false;
let enabled = false;

const debugLog = (...args) => {
  if (!isDebug) return;
  // eslint-disable-next-line no-console
  console.info('[monitoring:sentry]', ...args);
};

const cleanContext = (context = {}) => {
  if (!context || typeof context !== 'object') return {};
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
};

export const initSentry = async () => {
  if (initialized) return enabled;
  initialized = true;

  const dsn = String(process.env.REACT_APP_SENTRY_DSN || '').trim();
  if (!dsn || !isBrowser) {
    debugLog('disabled (missing DSN or non-browser)');
    enabled = false;
    return false;
  }

  try {
    if (!Sentry || typeof Sentry.init !== 'function') {
      debugLog('module loaded without init function');
      enabled = false;
      return false;
    }

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
    });

    sentryClient = Sentry;
    enabled = true;
    debugLog('initialized');
    return true;
  } catch (error) {
    enabled = false;
    debugLog('failed to initialize', error);
    return false;
  }
};

export const captureException = (error, context = {}) => {
  if (!enabled || !sentryClient?.captureException) return;
  const normalizedError = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
  sentryClient.captureException(normalizedError, {
    extra: cleanContext(context),
  });
};

export const captureMessage = (message, level = 'error', context = {}) => {
  if (!enabled || !sentryClient?.captureMessage) return;
  sentryClient.captureMessage(String(message || 'Unknown message'), {
    level,
    extra: cleanContext(context),
  });
};
