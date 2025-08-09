import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toBigIntId } from '../utils';

/**
 * Hook para manejar redirecciones desde notificaciones push
 */
export const useNotificationRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Listener para mensajes del Service Worker
    const handleMessage = (event) => {
      if (event.data?.type === 'NAVIGATE_TO' && event.data?.url) {
        console.log('Redirecting from push notification to:', event.data.url);
        navigate(event.data.url);
      }
    };

    // Agregar listener
    navigator.serviceWorker?.addEventListener('message', handleMessage);

    // Cleanup
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, [navigate]);

  // Función para manejar notificaciones cuando la app está abierta
  const handleForegroundNotification = (notification) => {
    if (notification.data?.type === 'match_invite' && notification.data?.matchId) {
      // Redirigir inmediatamente al AdminPanel
      navigate(`/admin/${toBigIntId(notification.data.matchId)}`);
    } else if (notification.data?.type === 'survey_results_ready') {
      const id = toBigIntId(notification.data?.matchId);
      const url = notification.data?.resultsUrl || (id != null ? `/resultados/${id}` : null);
      if (url) navigate(url);
    }
  };

  return { handleForegroundNotification };
};