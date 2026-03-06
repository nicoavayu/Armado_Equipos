const listeners = new Set();

const MAX_QUEUE_LENGTH = 20;
let currentNotice = null;
let queue = [];

const cloneSnapshot = () => ({
  isOpen: Boolean(currentNotice),
  current: currentNotice,
  queueSize: queue.length,
});

const emit = () => {
  const snapshot = cloneSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (_error) {
      // no-op: a listener failed; keep notifying others
    }
  });
};

const createNotice = (payload = {}) => {
  const message = String(payload.message || '').trim();
  if (!message) return null;

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(payload.title || '').trim() || 'Aviso',
    message,
    confirmText: String(payload.confirmText || '').trim() || 'Entendido',
    danger: Boolean(payload.danger),
  };
};

export const getGlobalNoticeSnapshot = () => cloneSnapshot();

export const subscribeGlobalNotice = (listener) => {
  if (typeof listener !== 'function') {
    return () => {};
  }

  listeners.add(listener);
  listener(cloneSnapshot());

  return () => {
    listeners.delete(listener);
  };
};

export const showGlobalNotice = (payload = {}) => {
  const notice = createNotice(payload);
  if (!notice) return null;

  if (currentNotice) {
    queue = [...queue.slice(-(MAX_QUEUE_LENGTH - 1)), notice];
  } else {
    currentNotice = notice;
  }

  emit();
  return notice.id;
};

export const closeGlobalNotice = () => {
  if (queue.length > 0) {
    const [next, ...rest] = queue;
    currentNotice = next || null;
    queue = rest;
  } else {
    currentNotice = null;
  }
  emit();
};

