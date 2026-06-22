/**
 * Centralized logging utility — the single logger for the app.
 *
 * Debug-level output (log/info/debug/warn/table) is emitted in development and
 * test, but silenced in production builds so the console stays clean and no
 * debug data leaks on device. Errors always surface (visible in device logs)
 * and are the single place to route into Sentry if we want to later.
 *
 * Do not call `console.*` directly in app code — eslint's `no-console` enforces
 * going through this logger.
 */
const debugEnabled = process.env.NODE_ENV !== 'production';

const logger = {
  log: (...args) => { if (debugEnabled) console.log(...args); },
  info: (...args) => { if (debugEnabled) console.info(...args); },
  debug: (...args) => { if (debugEnabled) console.debug(...args); },
  warn: (...args) => { if (debugEnabled) console.warn(...args); },
  table: (...args) => { if (debugEnabled) console.table(...args); },
  error: (...args) => { console.error(...args); },
};

export default logger;
