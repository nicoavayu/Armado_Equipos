import * as Sentry from '@sentry/react';

const isBrowser = typeof window !== 'undefined';
const isDebug =
  process.env.NODE_ENV !== 'production' &&
  String(process.env.REACT_APP_ANALYTICS_DEBUG || '').toLowerCase() === 'true';

let sentryClient = null;
let initState = 'idle';

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

const cleanUserContext = (userContext = {}) => {
  if (!userContext || typeof userContext !== 'object') return null;

  const normalizedUser = cleanContext({
    id: userContext.id ? String(userContext.id).trim() : '',
    segment: userContext.segment ? String(userContext.segment).trim() : '',
  });

  if (!normalizedUser.id) return null;
  return normalizedUser;
};

const getSentryConfig = () => {
  if (!isBrowser) {
    return { enabled: false, reason: 'non-browser' };
  }

  const dsn = String(process.env.REACT_APP_SENTRY_DSN || '').trim();
  if (!dsn) {
    return { enabled: false, reason: 'missing REACT_APP_SENTRY_DSN' };
  }

  const environment = String(process.env.REACT_APP_SENTRY_ENVIRONMENT || '').trim();
  if (!environment) {
    return { enabled: false, reason: 'missing REACT_APP_SENTRY_ENVIRONMENT' };
  }

  const release = String(process.env.REACT_APP_SENTRY_RELEASE || '').trim();
  if (!release) {
    return { enabled: false, reason: 'missing REACT_APP_SENTRY_RELEASE' };
  }

  return {
    enabled: true,
    dsn,
    environment,
    release,
  };
};

export const initSentry = () => {
  if (initState === 'ready') return true;
  if (initState === 'disabled' || initState === 'failed') return false;

  const config = getSentryConfig();
  if (!config.enabled) {
    sentryClient = null;
    initState = 'disabled';
    debugLog('disabled', config.reason);
    return false;
  }

  try {
    if (!Sentry || typeof Sentry.init !== 'function') {
      debugLog('module loaded without init function');
      sentryClient = null;
      initState = 'failed';
      return false;
    }

    if (typeof Sentry.getClient === 'function' && Sentry.getClient()) {
      sentryClient = Sentry;
      initState = 'ready';
      debugLog('initialized with existing client', {
        environment: config.environment,
        release: config.release,
      });
      return true;
    }

    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
    });

    sentryClient = Sentry;
    initState = 'ready';
    debugLog('initialized', {
      environment: config.environment,
      release: config.release,
    });
    return true;
  } catch (error) {
    sentryClient = null;
    initState = 'failed';
    debugLog('failed to initialize', error);
    return false;
  }
};

export const captureException = (error, context = {}) => {
  if (initState !== 'ready' || !sentryClient?.captureException) return;
  const normalizedError = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
  sentryClient.captureException(normalizedError, {
    extra: cleanContext(context),
  });
};

export const captureMessage = (message, level = 'error', context = {}) => {
  if (initState !== 'ready' || !sentryClient?.captureMessage) return;
  sentryClient.captureMessage(String(message || 'Unknown message'), {
    level,
    extra: cleanContext(context),
  });
};

export const setSentryUser = (userContext = {}) => {
  if (initState !== 'ready' || typeof Sentry.setUser !== 'function') return;

  const normalizedUser = cleanUserContext(userContext);
  if (!normalizedUser) {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser(normalizedUser);
};

export const clearSentryUser = () => {
  if (initState !== 'ready' || typeof Sentry.setUser !== 'function') return;
  Sentry.setUser(null);
};
