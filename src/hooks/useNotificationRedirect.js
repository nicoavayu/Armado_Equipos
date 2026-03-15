import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toBigIntId } from '../utils';
import {
  consumePendingNativePushRedirect,
  getNativePushRedirectEventName,
} from './useNativeFeatures';
import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';
import { isPendingMatchInviteNotification } from '../utils/notificationInviteState';
import { track } from '../utils/monitoring/analytics';

/**
 * Hook para manejar redirecciones desde notificaciones push
 */
export const useNotificationRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const nativePushRedirectEventName = getNativePushRedirectEventName();

    const handleNativePushRedirect = (payload) => {
      const route = String(payload?.route || '').trim();
      if (!route) return;

      const notificationType = String(payload?.notificationType || '').trim();
      track('push_opened', {
        notification_type: notificationType || undefined,
        route,
        opened_from_push: true,
        source: 'native_push_redirect',
      });
      navigate(route);
    };

    // Listener para mensajes del Service Worker
    const handleMessage = (event) => {
      if (event.data?.type === 'NAVIGATE_TO' && event.data?.url) {
        const notificationType = String(
          event.data?.notificationType
          || event.data?.notification_type
          || event.data?.data?.type
          || event.data?.data?.notification_type
          || '',
        ).trim();
        track('push_opened', {
          notification_type: notificationType || undefined,
          route: event.data?.url,
          opened_from_push: true,
          source: 'service_worker',
        });
        console.log('Redirecting from push notification to:', event.data.url);
        navigate(event.data.url);
      }
    };

    const handleWindowNativePushRedirect = (event) => {
      handleNativePushRedirect(event?.detail || {});
    };

    const pendingNativePushRedirect = consumePendingNativePushRedirect();
    if (pendingNativePushRedirect?.route) {
      handleNativePushRedirect(pendingNativePushRedirect);
    }

    // Agregar listener
    navigator.serviceWorker?.addEventListener('message', handleMessage);
    window.addEventListener(nativePushRedirectEventName, handleWindowNativePushRedirect);

    // Cleanup
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
      window.removeEventListener(nativePushRedirectEventName, handleWindowNativePushRedirect);
    };
  }, [navigate]);

  // Función para manejar notificaciones cuando la app está abierta
  const handleForegroundNotification = (notification) => {
    const notificationType = String(notification?.type || notification?.data?.type || '').trim();

    if (notificationType) {
      track('push_opened', {
        notification_type: notificationType || undefined,
        opened_from_push: true,
        source: 'in_app_push',
      });
    }

    if (notification.data?.type === 'match_invite') {
      const invitePayload = {
        ...notification,
        type: 'match_invite',
      };
      if (!isPendingMatchInviteNotification(invitePayload)) {
        return;
      }
      const inviteRoute = resolveMatchInviteRoute(invitePayload);
      if (inviteRoute) {
        navigate(inviteRoute);
      } else if (notification?.data?.matchId || notification?.data?.partido_id) {
        const fallbackMatchId = notification?.data?.matchId || notification?.data?.partido_id;
        navigate(`/partido-publico/${fallbackMatchId}`);
      }
    } else if (notification.data?.type === 'survey_results_ready') {
      const id = toBigIntId(notification.data?.matchId);
      const url = notification.data?.resultsUrl || (id != null ? `/resultados/${id}` : null);
      if (url) navigate(url);
    }
  };

  return { handleForegroundNotification };
};
