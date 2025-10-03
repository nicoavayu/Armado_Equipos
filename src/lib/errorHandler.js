/**
 * Sistema centralizado de manejo de errores
 * 
 * Proporciona clases de error personalizadas, códigos de error estandarizados
 * y una función unificada para manejar errores en toda la aplicación.
 */

/**
 * Clase de error personalizada con código y detalles adicionales
 */
export class AppError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

/**
 * Códigos de error estandarizados
 */
export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Mensajes de error por defecto para cada código
 */
export const ERROR_MESSAGES = {
  [ERROR_CODES.AUTH_REQUIRED]: 'Debes iniciar sesión',
  [ERROR_CODES.ACCESS_DENIED]: 'No tienes permiso para acceder',
  [ERROR_CODES.NOT_FOUND]: 'Recurso no encontrado',
  [ERROR_CODES.VALIDATION_ERROR]: 'Datos inválidos',
  [ERROR_CODES.NETWORK_ERROR]: 'Error de conexión',
  [ERROR_CODES.UNKNOWN]: 'Error inesperado',
};

/**
 * Maneja errores de forma centralizada
 * 
 * @param {Error|AppError} error - Error a manejar
 * @param {Object} options - Opciones de configuración
 * @param {boolean} options.showToast - Si debe mostrar toast (default: true)
 * @param {Function} options.onError - Callback adicional
 * @returns {string} Mensaje de error procesado
 * 
 * @example
 * try {
 *   await someAsyncOperation();
 * } catch (error) {
 *   handleError(error, {
 *     showToast: true,
 *     onError: () => setLoading(false)
 *   });
 * }
 */
export const handleError = (error, options = {}) => {
  console.error('[ERROR]', error);
  
  let message = ERROR_MESSAGES[ERROR_CODES.UNKNOWN];
  
  if (error instanceof AppError) {
    message = ERROR_MESSAGES[error.code] || error.message;
  } else if (error?.message) {
    message = error.message;
  }
  
  if (options.showToast !== false) {
    try {
      // Intentar usar react-toastify si está disponible
      const { toast } = require('react-toastify');
      if (toast?.error) {
        toast.error(message);
      }
    } catch (e) {
      // Si react-toastify no está disponible, solo loguear
      console.warn('[ERROR_HANDLER] Toast not available:', message);
    }
  }
  
  if (options.onError) {
    options.onError(error);
  }
  
  return message;
};
