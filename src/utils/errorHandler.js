import { toast } from 'react-toastify';

export const handleError = (error, userMessage = 'Ha ocurrido un error') => {
  console.error('Error:', error);
  const message = error?.message || userMessage;
  toast.error(message, {
    position: 'top-right',
    autoClose: 5000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
  });
  return error;
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
    throw handleError(error, errorMessage);
  }
};

// Enhanced async wrapper with loading state
export const withLoading = async (asyncFn, loadingSetter, errorMessage) => {
  try {
    loadingSetter(true);
    return await asyncFn();
  } catch (error) {
    throw handleError(error, errorMessage);
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