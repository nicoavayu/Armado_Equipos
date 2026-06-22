import logger from '../logger';

const isBrowser = typeof window !== 'undefined';
const isDebug =
  process.env.NODE_ENV !== 'production' &&
  String(process.env.REACT_APP_ANALYTICS_DEBUG || '').toLowerCase() === 'true';

let sentryClient = null;
let initState = 'idle'; // idle | loading | ready | disabled | failed

// Until the SDK finishes loading (it's now lazy-loaded off the cold-start path),
// buffer captures and the latest user intent so early errors are not lost.
const MAX_PENDING_CAPTURES = 20;
const pendingCaptures = [];
let pendingUser; // undefined = no pending intent; null = clear; object = set

const debugLog = (...args) => {
  if (!isDebug) return;
  // eslint-disable-next-line no-console
  logger.info('[monitoring:sentry]', ...args);
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

const doCaptureException = (error, context) => {
  if (!sentryClient?.captureException) return;
  const normalizedError = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
  sentryClient.captureException(normalizedError, {
    extra: cleanContext(context),
  });
};

const doCaptureMessage = (message, level, context) => {
  if (!sentryClient?.captureMessage) return;
  sentryClient.captureMessage(String(message || 'Unknown message'), {
    level,
    extra: cleanContext(context),
  });
};

const applyUser = (userContext) => {
  if (typeof sentryClient?.setUser !== 'function') return;
  if (userContext === null) {
    sentryClient.setUser(null);
    return;
  }
  const normalizedUser = cleanUserContext(userContext);
  sentryClient.setUser(normalizedUser || null);
};

const flushPending = () => {
  if (initState !== 'ready' || !sentryClient) return;

  if (pendingUser !== undefined) {
    applyUser(pendingUser);
    pendingUser = undefined;
  }

  while (pendingCaptures.length) {
    const item = pendingCaptures.shift();
    if (item.type === 'message') {
      doCaptureMessage(item.message, item.level, item.context);
    } else {
      doCaptureException(item.error, item.context);
    }
  }
};

const dropPending = () => {
  pendingCaptures.length = 0;
  pendingUser = undefined;
};

export const initSentry = async () => {
  if (initState === 'ready') return true;
  if (initState === 'disabled' || initState === 'failed') return false;
  if (initState === 'loading') return false;

  const config = getSentryConfig();
  if (!config.enabled) {
    sentryClient = null;
    initState = 'disabled';
    dropPending();
    debugLog('disabled', config.reason);
    return false;
  }

  initState = 'loading';

  try {
    // Lazy-load the SDK so @sentry/react stays out of the initial bundle parse.
    const Sentry = await import('@sentry/react');

    if (!Sentry || typeof Sentry.init !== 'function') {
      debugLog('module loaded without init function');
      sentryClient = null;
      initState = 'failed';
      dropPending();
      return false;
    }

    if (typeof Sentry.getClient === 'function' && Sentry.getClient()) {
      sentryClient = Sentry;
      initState = 'ready';
      debugLog('initialized with existing client', {
        environment: config.environment,
        release: config.release,
      });
      flushPending();
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
    flushPending();
    return true;
  } catch (error) {
    sentryClient = null;
    initState = 'failed';
    dropPending();
    debugLog('failed to initialize', error);
    return false;
  }
};

export const captureException = (error, context = {}) => {
  if (initState === 'disabled' || initState === 'failed') return;
  if (initState !== 'ready') {
    if (pendingCaptures.length < MAX_PENDING_CAPTURES) {
      pendingCaptures.push({ type: 'exception', error, context });
    }
    return;
  }
  doCaptureException(error, context);
};

export const captureMessage = (message, level = 'error', context = {}) => {
  if (initState === 'disabled' || initState === 'failed') return;
  if (initState !== 'ready') {
    if (pendingCaptures.length < MAX_PENDING_CAPTURES) {
      pendingCaptures.push({ type: 'message', message, level, context });
    }
    return;
  }
  doCaptureMessage(message, level, context);
};

export const setSentryUser = (userContext = {}) => {
  if (initState === 'disabled' || initState === 'failed') return;
  if (initState !== 'ready') {
    pendingUser = userContext;
    return;
  }
  applyUser(userContext);
};

export const clearSentryUser = () => {
  if (initState === 'disabled' || initState === 'failed') return;
  if (initState !== 'ready') {
    pendingUser = null;
    return;
  }
  applyUser(null);
};
