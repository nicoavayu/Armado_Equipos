export const logger = {
  log: (...a) => { if (process.env.NODE_ENV !== 'production') console.log(...a); },
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};