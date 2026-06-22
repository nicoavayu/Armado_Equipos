import logger from '../utils/logger';
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
import { isTeamChallengeNotification, resolveAdminAwareNotificationRoute } from '../utils/notificationRoutes';
import {
  debugNotificationEvent,
  openNotification,
  resolveNotificationActionability,
  resolveSurveyNotificationNavigation,
  shouldTreatNotificationAsSurveyForm,
} from '../utils/notificationRouter';
import { notifyBlockingError } from '../utils/notifyBlockingError';

const extractMatchIdFromRoute = (route) => {
  const raw = String(route || '').trim();
  if (!raw) return null;
  const match = raw.match(/\/(?:admin|partido-publico|partido|encuesta|resultados-encuesta|pagos)\/(\d+)/i);
  return match?.[1] || null;
};

const PUSH_RESULTS_NOTIFICATION_TYPES = new Set([
  'survey_results_ready',
  'survey_finished',
  'survey_results',
  'awards_ready',
  'award_won',
]);

const resolveNotificationTypeToken = (payload = {}) => String(
  payload?.notificationType
  || payload?.notification_type
  || payload?.type
  || payload?.data?.type
  || payload?.data?.notification_type
  || '',
).trim();

const isPushResultsNotificationType = (notificationType) => (
  PUSH_RESULTS_NOTIFICATION_TYPES.has(String(notificationType || '').trim().toLowerCase())
);

const getRedirectDebugPayload = ({ payload = {}, route = '', source = '' } = {}) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    source,
    raw_notification: payload || null,
    notification_id: payload?.id || data?.id || null,
    type: resolveNotificationTypeToken(payload),
    match_id: data?.match_id || data?.matchId || null,
    partido_id: payload?.partido_id || data?.partido_id || data?.partidoId || null,
    team_match_id: data?.team_match_id || data?.teamMatchId || null,
    survey_id: payload?.survey_id || data?.survey_id || data?.surveyId || null,
    action_url: payload?.action_url || payload?.actionUrl || data?.action_url || data?.actionUrl || null,
    actionUrl: payload?.actionUrl || data?.actionUrl || null,
    resultsUrl: data?.resultsUrl || null,
    results_url: data?.results_url || null,
    route: data?.route || route || null,
    url: data?.url || payload?.url || null,
    link: data?.link || null,
    final_route: route || null,
  };
};

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

const resolveNavigationRouteForEnvelope = async ({ envelope = {}, fallbackRoute = '' } = {}) => {
  const safeFallbackRoute = String(fallbackRoute || '').trim() || null;
  let userId = '';
  try {
    const { data: authData } = await supabase.auth.getUser();
    userId = String(authData?.user?.id || '').trim();
  } catch (_authError) {
    userId = '';
  }

  const adminAwareRoute = await resolveAdminAwareNotificationRoute({
    notification: envelope,
    fallbackRoute: safeFallbackRoute,
    supabaseClient: supabase,
    userId,
  });

  return adminAwareRoute || safeFallbackRoute;
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
      debugNotificationEvent('NOTIFICATION_TAP', getRedirectDebugPayload({
        payload,
        route,
        source: 'native_push_redirect',
      }));

      const envelope = buildNotificationEnvelopeFromPayload({ payload, route });
      debugNotificationEvent('NOTIFICATION_SELECTED', {
        ...getRedirectDebugPayload({ payload: envelope, route, source: 'native_push_redirect' }),
        selected_notification: envelope,
      });
      if (isTeamChallengeNotification(envelope)) {
        await openNotification(envelope, navigate, {
          supabaseClient: supabase,
          onActionBlocked: (actionability) => {
            if (actionability?.message) {
              notifyBlockingError(actionability.message);
            }
          },
        });
        return;
      }

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
      if (isPushResultsNotificationType(notificationType)) {
        track('push_opened', {
          notification_type: notificationType || undefined,
          route,
          opened_from_push: true,
          source: 'native_push_redirect',
        });
        await openNotification(envelope, navigate, {
          supabaseClient: supabase,
          onResultsUnavailable: (notice) => {
            if (notice?.message) {
              notifyBlockingError(notice.message, { title: notice.title });
            }
          },
        });
        return;
      }

      const targetRoute = await resolveNavigationRouteForEnvelope({
        envelope,
        fallbackRoute: surveyNavigation.route || route,
      });
      debugNotificationEvent('NOTIFICATION_ROUTE_RESOLVED', {
        ...getRedirectDebugPayload({ payload: envelope, route, source: 'native_push_redirect' }),
        final_route: targetRoute || null,
      });
      track('push_opened', {
        notification_type: notificationType || undefined,
        route,
        opened_from_push: true,
        source: 'native_push_redirect',
      });
      if (targetRoute) {
        debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
          ...getRedirectDebugPayload({ payload: envelope, route, source: 'native_push_redirect' }),
          final_route: targetRoute,
        });
        try {
          navigate(targetRoute);
          debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
            ...getRedirectDebugPayload({ payload: envelope, route, source: 'native_push_redirect' }),
            final_route: targetRoute,
          });
        } catch (error) {
          debugNotificationEvent('NOTIFICATION_NAVIGATE_ERROR', {
            ...getRedirectDebugPayload({ payload: envelope, route, source: 'native_push_redirect' }),
            final_route: targetRoute,
            error: error?.message || String(error || ''),
          });
          throw error;
        }
      }
    };

    // Listener para mensajes del Service Worker
    const handleMessage = async (event) => {
      if (event.data?.type === 'NAVIGATE_TO' && event.data?.url) {
        debugNotificationEvent('NOTIFICATION_TAP', getRedirectDebugPayload({
          payload: event.data || {},
          route: event.data?.url,
          source: 'service_worker',
        }));
        const envelope = buildNotificationEnvelopeFromPayload({
          payload: event.data || {},
          route: event.data?.url,
        });
        debugNotificationEvent('NOTIFICATION_SELECTED', {
          ...getRedirectDebugPayload({ payload: envelope, route: event.data?.url, source: 'service_worker' }),
          selected_notification: envelope,
        });
        if (isTeamChallengeNotification(envelope)) {
          await openNotification(envelope, navigate, {
            supabaseClient: supabase,
            onActionBlocked: (actionability) => {
              if (actionability?.message) {
                notifyBlockingError(actionability.message);
              }
            },
          });
          return;
        }

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
        if (isPushResultsNotificationType(notificationType)) {
          track('push_opened', {
            notification_type: notificationType || undefined,
            route: event.data?.url,
            opened_from_push: true,
            source: 'service_worker',
          });
          await openNotification(envelope, navigate, {
            supabaseClient: supabase,
            onResultsUnavailable: (notice) => {
              if (notice?.message) {
                notifyBlockingError(notice.message, { title: notice.title });
              }
            },
          });
          return;
        }

        const targetRoute = await resolveNavigationRouteForEnvelope({
          envelope,
          fallbackRoute: surveyNavigation.route || event.data?.url,
        });
        debugNotificationEvent('NOTIFICATION_ROUTE_RESOLVED', {
          ...getRedirectDebugPayload({ payload: envelope, route: event.data?.url, source: 'service_worker' }),
          final_route: targetRoute || null,
        });
        track('push_opened', {
          notification_type: notificationType || undefined,
          route: event.data?.url,
          opened_from_push: true,
          source: 'service_worker',
        });
        logger.log('Redirecting from push notification to:', targetRoute);
        if (targetRoute) {
          debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
            ...getRedirectDebugPayload({ payload: envelope, route: event.data?.url, source: 'service_worker' }),
            final_route: targetRoute,
          });
          try {
            navigate(targetRoute);
            debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
              ...getRedirectDebugPayload({ payload: envelope, route: event.data?.url, source: 'service_worker' }),
              final_route: targetRoute,
            });
          } catch (error) {
            debugNotificationEvent('NOTIFICATION_NAVIGATE_ERROR', {
              ...getRedirectDebugPayload({ payload: envelope, route: event.data?.url, source: 'service_worker' }),
              final_route: targetRoute,
              error: error?.message || String(error || ''),
            });
            throw error;
          }
        }
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
    debugNotificationEvent('NOTIFICATION_TAP', getRedirectDebugPayload({
      payload: notification || {},
      route: notification?.data?.url || notification?.data?.route || notification?.data?.link || '',
      source: 'in_app_push',
    }));
    const envelope = {
      ...notification,
      type: notificationType || notification?.type || '',
      data: notification?.data && typeof notification.data === 'object'
        ? notification.data
        : {},
    };
    debugNotificationEvent('NOTIFICATION_SELECTED', {
      ...getRedirectDebugPayload({ payload: envelope, route: '', source: 'in_app_push' }),
      selected_notification: envelope,
    });

    const fallbackRoute = envelope?.data?.link
      || envelope?.data?.resultsUrl
      || envelope?.data?.action_url
      || envelope?.data?.actionUrl
      || '';
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
      debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
        ...getRedirectDebugPayload({ payload: envelope, route: surveyNavigation.route, source: 'in_app_push' }),
        final_route: surveyNavigation.route,
      });
      navigate(surveyNavigation.route);
      debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
        ...getRedirectDebugPayload({ payload: envelope, route: surveyNavigation.route, source: 'in_app_push' }),
        final_route: surveyNavigation.route,
      });
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
        debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
          ...getRedirectDebugPayload({ payload: invitePayload, route: inviteRoute, source: 'in_app_push' }),
          final_route: inviteRoute,
        });
        navigate(inviteRoute);
        debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
          ...getRedirectDebugPayload({ payload: invitePayload, route: inviteRoute, source: 'in_app_push' }),
          final_route: inviteRoute,
        });
      } else if (notification?.data?.matchId || notification?.data?.partido_id) {
        const fallbackMatchId = notification?.data?.matchId || notification?.data?.partido_id;
        const fallbackRoute = `/partido-publico/${fallbackMatchId}`;
        debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
          ...getRedirectDebugPayload({ payload: invitePayload, route: fallbackRoute, source: 'in_app_push' }),
          final_route: fallbackRoute,
        });
        navigate(fallbackRoute);
        debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
          ...getRedirectDebugPayload({ payload: invitePayload, route: fallbackRoute, source: 'in_app_push' }),
          final_route: fallbackRoute,
        });
      }
    } else if (isPushResultsNotificationType(notificationType)) {
      const matchId = notification.data?.matchId ?? notification.data?.match_id ?? notification.data?.partido_id;
      const id = toBigIntId(matchId);
      const envelope = {
        type: String(notification.data?.type || notificationType || '').trim() || 'survey_results_ready',
        partido_id: id || undefined,
        data: {
          ...notification.data,
          resultsUrl: notification.data?.resultsUrl
            || notification.data?.action_url
            || notification.data?.actionUrl
            || notification.data?.link
            || (id != null ? `/resultados-encuesta/${id}` : null),
          match_id: id || notification.data?.match_id || undefined,
          matchId: id || notification.data?.matchId || undefined,
          partido_id: id || notification.data?.partido_id || undefined,
        },
      };
      await openNotification(envelope, navigate, {
        supabaseClient: supabase,
        onResultsUnavailable: (notice) => {
          if (notice?.message) {
            notifyBlockingError(notice.message, { title: notice.title });
          }
        },
      });
    }
  };

  return { handleForegroundNotification };
};
