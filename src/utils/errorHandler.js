import { toast } from 'react-toastify';

export const handleError = (error, userMessage = 'Ha ocurrido un error') => {
  console.error('Error:', error);
  const message = error?.message || userMessage;
  toast.error(message);
  return error;
};

export const handleSuccess = (message) => {
  toast.success(message);
};

export const safeAsync = async (asyncFn, errorMessage) => {
  try {
    return await asyncFn();
  } catch (error) {
    throw handleError(error, errorMessage);
  }
};