const FLOW_STORAGE_KEY = 'arma2:auth:pending-flow';
const RESULT_STORAGE_KEY = 'arma2:auth:last-result';
const AUTH_FLOW_EVENT = 'arma2:auth-flow-change';
const FLOW_TTL_MS = 2 * 60 * 1000;
const RESULT_TTL_MS = 30 * 1000;
const ACTIVE_FLOW_STATUSES = new Set([
  'started',
  'browser_opened',
  'callback_received',
  'session_restored',
]);

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const dispatchAuthFlowEvent = () => {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(AUTH_FLOW_EVENT));
};

const safeParse = (rawValue) => {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const isExpired = (timestamp, ttlMs) => {
  const numericTimestamp = Number(timestamp || 0);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return true;
  return Date.now() - numericTimestamp > ttlMs;
};

const createRandomId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint8Array(16);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return `auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const writeStorageValue = (key, value) => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors in private mode / restrictive environments.
  }
  dispatchAuthFlowEvent();
};

const removeStorageValue = (key) => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors in private mode / restrictive environments.
  }
  dispatchAuthFlowEvent();
};

export const readPendingAuthFlow = () => {
  if (!isBrowser()) return null;

  const parsed = safeParse(window.localStorage.getItem(FLOW_STORAGE_KEY));
  if (!parsed) return null;

  const updatedAt = parsed.updatedAt || parsed.startedAt;
  if (isExpired(updatedAt, FLOW_TTL_MS)) {
    removeStorageValue(FLOW_STORAGE_KEY);
    return null;
  }

  return parsed;
};

export const hasBlockingAuthFlow = (flow = readPendingAuthFlow()) => (
  Boolean(flow && ACTIVE_FLOW_STATUSES.has(flow.status))
);

export const startPendingAuthFlow = ({ provider, kind, source }) => {
  const existingFlow = readPendingAuthFlow();
  if (hasBlockingAuthFlow(existingFlow)) {
    return { started: false, flow: existingFlow };
  }

  const nextFlow = {
    id: createRandomId(),
    provider,
    kind,
    source: source || 'unknown',
    status: 'started',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };

  writeStorageValue(FLOW_STORAGE_KEY, nextFlow);
  return { started: true, flow: nextFlow };
};

export const updatePendingAuthFlow = (patch = {}) => {
  const currentFlow = readPendingAuthFlow();
  if (!currentFlow) return null;

  const nextFlow = {
    ...currentFlow,
    ...patch,
    updatedAt: Date.now(),
  };

  writeStorageValue(FLOW_STORAGE_KEY, nextFlow);
  return nextFlow;
};

export const markPendingAuthBrowserOpened = ({ browserUrl } = {}) => (
  updatePendingAuthFlow({
    status: 'browser_opened',
    browserUrl: browserUrl || null,
  })
);

export const markPendingAuthCallbackReceived = ({ callbackUrl } = {}) => (
  updatePendingAuthFlow({
    status: 'callback_received',
    callbackUrl: callbackUrl || null,
  })
);

export const markPendingAuthSessionRestored = ({ provider, userId } = {}) => (
  updatePendingAuthFlow({
    status: 'session_restored',
    provider: provider || undefined,
    userId: userId || null,
  })
);

export const clearPendingAuthFlow = () => {
  removeStorageValue(FLOW_STORAGE_KEY);
};

export const setAuthFlowResult = ({ type, provider, message }) => {
  const nextResult = {
    type: type || 'info',
    provider: provider || null,
    message: message || '',
    createdAt: Date.now(),
  };

  writeStorageValue(RESULT_STORAGE_KEY, nextResult);
  return nextResult;
};

export const readAuthFlowResult = () => {
  if (!isBrowser()) return null;

  const parsed = safeParse(window.localStorage.getItem(RESULT_STORAGE_KEY));
  if (!parsed) return null;

  if (isExpired(parsed.createdAt, RESULT_TTL_MS)) {
    removeStorageValue(RESULT_STORAGE_KEY);
    return null;
  }

  return parsed;
};

export const clearAuthFlowResult = () => {
  removeStorageValue(RESULT_STORAGE_KEY);
};

export const consumeAuthFlowResult = () => {
  const result = readAuthFlowResult();
  if (!result) return null;
  clearAuthFlowResult();
  return result;
};

export const subscribeAuthFlowState = (listener) => {
  if (!isBrowser() || typeof listener !== 'function') {
    return () => {};
  }

  const handleChange = () => {
    listener({
      flow: readPendingAuthFlow(),
      result: readAuthFlowResult(),
    });
  };

  window.addEventListener(AUTH_FLOW_EVENT, handleChange);
  window.addEventListener('storage', handleChange);

  return () => {
    window.removeEventListener(AUTH_FLOW_EVENT, handleChange);
    window.removeEventListener('storage', handleChange);
  };
};
