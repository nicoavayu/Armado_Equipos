import { toast } from 'react-toastify';

let installed = false;

const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
const DEDUPE_WINDOW_MS = 3500;
const recentToasts = new Map();

const normalizeMessage = (message) => String(message || '')
  .replace(EMOJI_REGEX, '')
  .replace(/\s+/g, ' ')
  .trim();

const shouldSuppress = (type, normalizedMessage) => {
  const key = `${type}:${normalizedMessage.toLowerCase()}`;
  const now = Date.now();
  const lastShown = recentToasts.get(key) || 0;

  if ((now - lastShown) < DEDUPE_WINDOW_MS) {
    return true;
  }

  recentToasts.set(key, now);

  // Opportunistic cleanup to keep map small.
  if (recentToasts.size > 200) {
    for (const [entryKey, ts] of recentToasts.entries()) {
      if ((now - ts) > (DEDUPE_WINDOW_MS * 4)) {
        recentToasts.delete(entryKey);
      }
    }
  }

  return false;
};

const wrapToastMethod = (type) => {
  const original = toast[type];
  if (typeof original !== 'function') return;

  toast[type] = (message, options) => {
    const normalizedMessage = normalizeMessage(message);
    if (!normalizedMessage) return null;
    if (shouldSuppress(type, normalizedMessage)) return null;
    return original(normalizedMessage, options);
  };
};

export const installGlobalToastPolicy = () => {
  if (installed) return;
  installed = true;

  wrapToastMethod('success');
  wrapToastMethod('error');
  wrapToastMethod('info');
  wrapToastMethod('warn');
  wrapToastMethod('warning');
};

