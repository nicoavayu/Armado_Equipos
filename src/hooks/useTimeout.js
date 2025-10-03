import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook para manejar timeouts de forma segura con cleanup automático
 * 
 * Previene memory leaks al limpiar timeouts cuando el componente se desmonta
 * o cuando se establece un nuevo timeout.
 * 
 * @example
 * const { setTimeoutSafe, clearTimeoutSafe } = useTimeout();
 * 
 * setTimeoutSafe(() => {
 *   console.log('Ejecutado después de 1 segundo');
 * }, 1000);
 */
export const useTimeout = () => {
  const timeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const setTimeoutSafe = useCallback((callback, delay) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback();
      timeoutRef.current = null;
    }, delay);
  }, []);

  const clearTimeoutSafe = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return { setTimeoutSafe, clearTimeoutSafe };
};
