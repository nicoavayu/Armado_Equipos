/**
 * Centralized logging utility
 * Replaces console.log for better control and debugging
 */

const logger = {
  log: (...args) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(...args);
    }
  },
  error: (...args) => {
    console.error(...args);
  },
  warn: (...args) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn(...args);
    }
  },
  info: (...args) => {
    if (process.env.NODE_ENV === 'development') {
      console.info(...args);
    }
  },
};

export default logger;
