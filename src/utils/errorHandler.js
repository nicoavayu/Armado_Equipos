// eslint-disable-next-line global-require
const { toast } = require('react-toastify');

const normalizeToError = (err, fallbackMessage = 'Ha ocurrido un error') => {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object') {
    const msg =
      err.message ||
      err.error_description ||
      err.details ||
      err.hint ||
      (err.code ? `Error ${err.code}` : null) ||
      (() => {
        try {
          return JSON.stringify(err, null, 2);
        } catch (_e) {
          if (err && typeof err === 'object') {
            try {
              return `Object with keys: ${Object.keys(err).join(', ')}`;
            } catch (__e) {
              return String(err);
            }
          }
          return fallbackMessage;
        }
      })();
    const e = new Error(msg);
    Object.assign(e, err);
    return e;
  }
  return new Error(typeof err === 'string' ? err : fallbackMessage);
};

export const handleError = (error, userMessage = 'Ha ocurrido un error') => {
  const normalized = normalizeToError(error, userMessage);
  console.error('Error:', normalized);
  const message = normalized?.message || userMessage;
  toast.error(message, {
    position: 'top-right',
    autoClose: 5000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
  });
  return normalized;
};

export const handleSuccess = (message) => {
  toast.success(message, {
    position: 'top-right',
    autoClose: 3000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
  });
};

export const handleWarning = (message) => {
  toast.warn(message, {
    position: 'top-right',
    autoClose: 4000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
  });
};

export const safeAsync = async (asyncFn, errorMessage) => {
  try {
    return await asyncFn();
  } catch (error) {
    throw normalizeToError(handleError(error, errorMessage), errorMessage);
  }
};

// Enhanced async wrapper with loading state
export const withLoading = async (asyncFn, loadingSetter, errorMessage) => {
  try {
    loadingSetter(true);
    return await asyncFn();
  } catch (error) {
    throw normalizeToError(handleError(error, errorMessage), errorMessage);
  } finally {
    loadingSetter(false);
  }
};

// Network error handler
export const handleNetworkError = (error) => {
  if (!navigator.onLine) {
    handleError(error, 'Sin conexión a internet. Verifica tu conexión.');
  } else if (error.code === 'NETWORK_ERROR') {
    handleError(error, 'Error de red. Inténtalo de nuevo.');
  } else {
    handleError(error);
  }
};