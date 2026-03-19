import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toBigIntId } from '../utils';
import {
  consumePendingNativePushRedirect,
  getNativePushRedirectEventName,
} from './useNativeFeatures';
import supabase from '../supabase';
import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';
import { isPendingMatchInviteNotification } from '../utils/notificationInviteState';
import { track } from '../utils/monitoring/analytics';
import {
  resolveNotificationActionability,
  resolveSurveyNotificationNavigation,
  shouldTreatNotificationAsSurveyForm,
  stripShowAwardsParam,
} from '../utils/notificationRouter';
import { notifyBlockingError } from '../utils/notifyBlockingError';

const extractMatchIdFromRoute = (route) => {
  const raw = String(route || '').trim();
  if (!raw) return null;
  const match = raw.match(/\/(?:admin|partido-publico|partido|encuesta|resultados-encuesta)\/(\d+)/i);
  return match?.[1] || null;
};

const resolveNotificationTypeToken = (payload = {}) => String(
  payload?.notificationType
  || payload?.notification_type
  || payload?.type
  || payload?.data?.type
  || payload?.data?.notification_type
  || '',
).trim();

const buildNotificationEnvelopeFromPayload = ({ payload = {}, route = '' } = {}) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const type = resolveNotificationTypeToken(payload);
  const matchId = (
    payload?.matchId
    || payload?.match_id
    || payload?.partido_id
    || data?.matchId
    || data?.match_id
    || data?.partido_id
    || extractMatchIdFromRoute(route)
    || null
  );

  return {
    type,
    partido_id: matchId || undefined,
    data: {
      ...data,
      link: route || data?.link || null,
      match_id: matchId || data?.match_id || undefined,
      matchId: matchId || data?.matchId || undefined,
      partido_id: matchId || data?.partido_id || undefined,
    },
  };
};

const resolveSurveyNavigationForEnvelope = async ({ envelope = {}, fallbackRoute = '' } = {}) => {
  if (!shouldTreatNotificationAsSurveyForm(envelope)) {
    return {
      handled: false,
      blocked: false,
      route: String(fallbackRoute || '').trim() || null,
      message: '',
    };
  }

  let userId = '';
  try {
    const { data: authData } = await supabase.auth.getUser();
    userId = String(authData?.user?.id || '').trim();
  } catch (_authError) {
    userId = '';
  }

  const surveyNavigation = await resolveSurveyNotificationNavigation({
    notification: envelope,
    supabaseClient: supabase,
    userId,
  });

  if (!surveyNavigation.canNavigate) {
    return {
      handled: true,
      blocked: true,
      route: null,
      message: surveyNavigation.message || '',
    };
  }

  return {
    handled: true,
    blocked: false,
    route: surveyNavigation.route || String(fallbackRoute || '').trim() || null,
    message: '',
  };
};

/**
 * Hook para manejar redirecciones desde notificaciones push
 */
export const useNotificationRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const nativePushRedirectEventName = getNativePushRedirectEventName();

    const handleNativePushRedirect = async (payload) => {
      const route = String(payload?.route || '').trim();
      if (!route) return;

      const envelope = buildNotificationEnvelopeFromPayload({ payload, route });
      const surveyNavigation = await resolveSurveyNavigationForEnvelope({ envelope, fallbackRoute: route });
      if (surveyNavigation.blocked) {
        if (surveyNavigation.message) notifyBlockingError(surveyNavigation.message);
        return;
      }

      const actionability = await resolveNotificationActionability({
        notification: envelope,
        supabaseClient: supabase,
      });
      if (!actionability.isActionable) {
        if (actionability.message) notifyBlockingError(actionability.message);
        return;
      }

      const notificationType = resolveNotificationTypeToken(payload);
      track('push_opened', {
        notification_type: notificationType || undefined,
        route,
        opened_from_push: true,
        source: 'native_push_redirect',
      });
      navigate(surveyNavigation.route || route);
    };

    // Listener para mensajes del Service Worker
    const handleMessage = async (event) => {
      if (event.data?.type === 'NAVIGATE_TO' && event.data?.url) {
        const envelope = buildNotificationEnvelopeFromPayload({
          payload: event.data || {},
          route: event.data?.url,
        });
        const surveyNavigation = await resolveSurveyNavigationForEnvelope({
          envelope,
          fallbackRoute: event.data?.url,
        });
        if (surveyNavigation.blocked) {
          if (surveyNavigation.message) notifyBlockingError(surveyNavigation.message);
          return;
        }

        const actionability = await resolveNotificationActionability({
          notification: envelope,
          supabaseClient: supabase,
        });
        if (!actionability.isActionable) {
          if (actionability.message) notifyBlockingError(actionability.message);
          return;
        }

        const notificationType = resolveNotificationTypeToken(event.data || {});
        track('push_opened', {
          notification_type: notificationType || undefined,
          route: event.data?.url,
          opened_from_push: true,
          source: 'service_worker',
        });
        const targetRoute = surveyNavigation.route || event.data?.url;
        console.log('Redirecting from push notification to:', targetRoute);
        if (targetRoute) navigate(targetRoute);
      }
    };

    const handleWindowNativePushRedirect = (event) => {
      void handleNativePushRedirect(event?.detail || {});
    };

    const pendingNativePushRedirect = consumePendingNativePushRedirect();
    if (pendingNativePushRedirect?.route) {
      void handleNativePushRedirect(pendingNativePushRedirect);
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
  const handleForegroundNotification = async (notification) => {
    const notificationType = String(notification?.type || notification?.data?.type || '').trim();
    const envelope = {
      ...notification,
      type: notificationType || notification?.type || '',
      data: notification?.data && typeof notification.data === 'object'
        ? notification.data
        : {},
    };

    const fallbackRoute = envelope?.data?.link || envelope?.data?.resultsUrl || '';
    const surveyNavigation = await resolveSurveyNavigationForEnvelope({
      envelope,
      fallbackRoute,
    });
    if (surveyNavigation.blocked) {
      if (surveyNavigation.message) notifyBlockingError(surveyNavigation.message);
      return;
    }

    if (surveyNavigation.handled && surveyNavigation.route) {
      if (notificationType) {
        track('push_opened', {
          notification_type: notificationType || undefined,
          opened_from_push: true,
          source: 'in_app_push',
        });
      }
      navigate(surveyNavigation.route);
      return;
    }

    const actionability = await resolveNotificationActionability({
      notification: envelope,
      supabaseClient: supabase,
    });
    if (!actionability.isActionable) {
      if (actionability.message) notifyBlockingError(actionability.message);
      return;
    }

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
      const matchId = notification.data?.matchId ?? notification.data?.match_id ?? notification.data?.partido_id;
      const id = toBigIntId(matchId);
      const url = notification.data?.resultsUrl || (id != null ? `/resultados-encuesta/${id}` : null);
      if (url) navigate(stripShowAwardsParam(url));
    }
  };

  return { handleForegroundNotification };
};
