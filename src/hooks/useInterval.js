import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook para manejar intervals de forma segura con cleanup automático
 * 
 * Previene memory leaks al limpiar intervals cuando el componente se desmonta
 * o cuando se establece un nuevo interval. Usa ref para mantener el callback
 * actualizado sin reiniciar el interval.
 * 
 * @example
 * const { setIntervalSafe, clearIntervalSafe } = useInterval();
 * 
 * setIntervalSafe(() => {
 *   console.log('Ejecutado cada segundo');
 * }, 1000);
 */
export const useInterval = () => {
  const intervalRef = useRef(null);
  const callbackRef = useRef(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const setIntervalSafe = useCallback((callback, delay) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    callbackRef.current = callback;
    
    intervalRef.current = setInterval(() => {
      if (callbackRef.current) {
        callbackRef.current();
      }
    }, delay);
  }, []);

  const clearIntervalSafe = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  return { setIntervalSafe, clearIntervalSafe };
};
