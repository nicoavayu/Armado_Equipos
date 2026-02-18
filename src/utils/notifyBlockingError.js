
import { toast } from 'react-toastify';
import { captureException, captureMessage } from './monitoring/sentry';

const DEDUPE_WINDOW_MS = 2000;
const recentByKey = new Map();
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
const isDevOrTest =
  typeof process !== 'undefined' &&
  process?.env &&
  (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test');

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const shouldSkip = (dedupeKey) => {
  const key = normalize(dedupeKey);
  if (!key) return false;

  const now = Date.now();
  const last = recentByKey.get(key) || 0;
  if (now - last < DEDUPE_WINDOW_MS) return true;
  recentByKey.set(key, now);

  if (recentByKey.size > 250) {
    for (const [entry, ts] of recentByKey.entries()) {
      if ((now - ts) > (DEDUPE_WINDOW_MS * 5)) {
        recentByKey.delete(entry);
      }
    }
  }

  return false;
};

export const notifyBlockingError = (message, options = {}) => {
  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return null;
  if (!isBrowser) return null;

  const {
    key,
    dedupeKey,
    screen,
    action,
    match_id,
    user_id,
    error,
    ...toastOptions
  } = options || {};
  const composedKey = screen && action ? `${screen}:${action}:${normalizedMessage}` : null;
  const resolvedKey = dedupeKey || key || composedKey || normalizedMessage;
  if (shouldSkip(resolvedKey)) return null;

  const context = Object.fromEntries(
    Object.entries({ screen, action, match_id, user_id }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  if (error) {
    captureException(error, context);
  } else {
    captureMessage(normalizedMessage, 'error', context);
  }

  if (toast?.error && typeof toast.error === 'function') {
    return toast.error(normalizedMessage, toastOptions);
  }

  if (isDevOrTest) {
    // eslint-disable-next-line no-console
    console.error('[notifyBlockingError:fallback]', normalizedMessage);
  }
  return null;
};

export default notifyBlockingError;
