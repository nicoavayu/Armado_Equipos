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
 * @param {unknown} error - Error a manejar
 * @param {{ showToast?: boolean, onError?: (err: Error) => void }} [options] - Opciones de configuración
 * @returns {string} Mensaje de error procesado
 */
export const handleError = (error, options = {}) => {
  // Normalize non-Error values (Supabase sometimes returns plain objects)
  /** @type {any} */
  const raw = error;

  const safeStringify = (value) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_e) {
      if (value && typeof value === 'object') {
        try {
          return `Object with keys: ${Object.keys(value).join(', ')}`;
        } catch (__e) {
          return String(value);
        }
      }
      return String(value);
    }
  };

  const normalizedError = (() => {
    if (raw instanceof Error) return raw;
    if (raw && typeof raw === 'object') {
      const msg =
        raw.message ||
        raw.error_description ||
        raw.details ||
        raw.hint ||
        (raw.code ? `Error ${raw.code}` : null) ||
        safeStringify(raw);
      const e = new Error(msg);
      // Preserve useful fields for debugging
      Object.assign(e, raw);
      return e;
    }
    return new Error(String(raw));
  })();

  // Dev-only marker so we can identify which handler is being called
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.warn('[handleError:lib] called', { message: normalizedError?.message });
    // eslint-disable-next-line no-console
    console.warn('[handleError:lib] stack', new Error('handleError:lib').stack);
  }

  console.error('[ERROR]', normalizedError);

  let message = ERROR_MESSAGES[ERROR_CODES.UNKNOWN];

  if (normalizedError instanceof AppError) {
    message = ERROR_MESSAGES[normalizedError.code] || normalizedError.message;
  } else if (normalizedError?.message) {
    message = normalizedError.message;
  }

  if (options?.onError) {
    options.onError(normalizedError);
  }

  return message;
};
