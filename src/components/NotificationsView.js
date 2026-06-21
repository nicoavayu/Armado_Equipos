import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CheckCircle, ChevronDown, ChevronUp, ClipboardList, Trophy, UserPlus, Users, Vote, XCircle } from 'lucide-react';
import { toBigIntId } from '../utils';
import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';
import {
  buildAwardsResultsNavigationTarget,
  buildResultsNavigationTarget,
  debugNotificationEvent,
  debugNotificationRoute,
  openNotification,
  resolveNotificationActionability,
  resolveSurveyNotificationNavigation,
  shouldTreatNotificationAsSurveyForm,
  stripShowAwardsParam,
} from '../utils/notificationRouter';
import { useNotifications } from '../context/NotificationContext';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';
import EmptyStateCard from './EmptyStateCard';
import {
  getSurveyReminderMessage,
  getSurveyResultsReadyMessage,
  getSurveyStartMessage,
  isSurveyNotificationClosed,
} from '../utils/surveyNotificationCopy';
import {
  applyMatchNameQuotes,
  formatMatchReminderMessage,
  formatMatchReminderTitle,
  formatMatchCancelledMessage,
  formatTeamInviteMessage,
  quoteMatchName,
  resolveNotificationMatchName,
} from '../utils/notificationText';
import { filterNotificationsByCategory, getCategoryCount, NOTIFICATION_FILTER_OPTIONS } from '../utils/notificationFilters';
import {
  buildNotificationFallbackRoute,
  buildTeamInviteRoute,
  extractNotificationMatchId,
  isTeamChallengeNotification,
  resolveAdminAwareMatchRoute,
  resolveTeamChallengeRouteFromMatchId,
} from '../utils/notificationRoutes';
import { groupNotificationsByMatch } from '../utils/notificationGrouping';
import { filterNotificationsForInbox } from '../utils/notificationInviteState';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import supabase from '../supabase';
import { track } from '../utils/monitoring/analytics';


const RESULTS_OR_AWARDS_NOTIFICATION_TYPES = new Set([
  'survey_results',
  'survey_results_ready',
  'survey_finished',
  'awards_ready',
  'award_won',
]);

const normalizeNotificationId = (notificationOrId) => {
  const value = typeof notificationOrId === 'object'
    ? notificationOrId?.id
    : notificationOrId;
  const id = String(value ?? '').trim();
  return id || null;
};

const isResultsOrAwardsNotification = (notification = {}) => (
  RESULTS_OR_AWARDS_NOTIFICATION_TYPES.has(String(notification?.type || '').trim().toLowerCase())
);

const shouldOpenAsTeamChallenge = (notification = {}) => (
  isTeamChallengeNotification(notification)
  && !isResultsOrAwardsNotification(notification)
  && !shouldTreatNotificationAsSurveyForm(notification)
);

const getNotificationRouteDebugPayload = (notification = {}) => ({
  notification_id: normalizeNotificationId(notification),
  type: notification?.type,
  match_id: extractNotificationMatchId(notification) || null,
  partido_id: notification?.partido_id || notification?.data?.partido_id || notification?.data?.partidoId || null,
  team_match_id: notification?.data?.team_match_id || notification?.data?.teamMatchId || null,
  survey_id: notification?.survey_id || notification?.data?.survey_id || notification?.data?.surveyId || null,
  action_url: notification?.action_url || notification?.actionUrl || notification?.data?.action_url || notification?.data?.actionUrl || null,
  actionUrl: notification?.actionUrl || notification?.data?.actionUrl || null,
  resultsUrl: notification?.data?.resultsUrl || null,
  results_url: notification?.data?.resultsUrl || notification?.data?.results_url || null,
  link: notification?.data?.link || null,
  route: notification?.data?.route || null,
  url: notification?.data?.url || null,
});

const resolveGroupedClickNotification = (group = {}) => {
  const latest = group?.latest || null;
  if (!latest || normalizeNotificationId(latest)) return latest;

  const items = Array.isArray(group?.items) ? group.items : [];
  const fallbackWithId = items.find((item) => (
    normalizeNotificationId(item)
    && String(item?.type || '') === String(latest?.type || '')
  )) || items.find((item) => normalizeNotificationId(item));

  if (!fallbackWithId) return latest;
  return {
    ...latest,
    id: fallbackWithId.id,
  };
};

const NotificationsView = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    notifications,
    markAsRead,
    markAllAsRead,
    fetchNotifications,
    unreadCount,
  } = useNotifications();


  const { acceptFriendRequest, rejectFriendRequest } = useAmigos(user?.id);

  const [processingRequests, setProcessingRequests] = useState(new Set());
  const [activeFilter, setActiveFilter] = useState('all');
  const [markingAllAsRead, setMarkingAllAsRead] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const fallbackToNotificationRoute = (notification, message = 'No encontramos ese destino. Te llevamos a tus partidos.') => {
    notifyBlockingError(message);
    const fallbackRoute = buildNotificationFallbackRoute(notification, toBigIntId);
    debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
      ...getNotificationRouteDebugPayload(notification),
      source: 'notifications_view_fallback',
      final_route: fallbackRoute,
      message,
      current_route_before: `${location.pathname}${location.search}`,
    });
    navigate(fallbackRoute);
    debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
      ...getNotificationRouteDebugPayload(notification),
      source: 'notifications_view_fallback',
      final_route: fallbackRoute,
    });
  };

  const safeNavigate = (notification, route, options = {}, message) => {
    if (!route) {
      fallbackToNotificationRoute(notification, message);
      return false;
    }
    try {
      debugNotificationEvent('NOTIFICATION_ROUTE_RESOLVED', {
        ...getNotificationRouteDebugPayload(notification),
        source: 'notifications_view_safe_navigate',
        final_route: route,
        navigate_options: options,
        current_route_before: `${location.pathname}${location.search}`,
      });
      debugNotificationRoute('view_navigate', {
        ...getNotificationRouteDebugPayload(notification),
        route,
      });
      debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
        ...getNotificationRouteDebugPayload(notification),
        source: 'notifications_view_safe_navigate',
        final_route: route,
        navigate_options: options,
        current_route_before: `${location.pathname}${location.search}`,
      });
      navigate(route, {
        ...options,
        state: {
          ...(options.state || {}),
          backTo: `${location.pathname}${location.search}`,
        },
      });
      debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
        ...getNotificationRouteDebugPayload(notification),
        source: 'notifications_view_safe_navigate',
        final_route: route,
      });
      return true;
    } catch (error) {
      debugNotificationEvent('NOTIFICATION_NAVIGATE_ERROR', {
        ...getNotificationRouteDebugPayload(notification),
        source: 'notifications_view_safe_navigate',
        final_route: route,
        error: error?.message || String(error || ''),
      });
      console.error('[NOTIFICATION_CLICK] navigation error', { route, error });
      fallbackToNotificationRoute(notification, message);
      return false;
    }
  };

  const trackNotificationOpened = (notification) => {
    const type = String(notification?.type || '').trim();
    if (!type) return;

    if (type === 'friend_request') {
      track('friend_request_opened', {
        request_id: String(notification?.data?.requestId || '').trim() || undefined,
        sender_user_id: String(notification?.data?.senderId || '').trim() || undefined,
        source: 'notifications_view',
        notification_id: String(notification?.id || '').trim() || undefined,
      });
      return;
    }

    if (type === 'match_invite') {
      const resolvedMatchId = extractNotificationMatchId(notification);
      track('match_invite_opened', {
        notification_id: String(notification?.id || '').trim() || undefined,
        match_id: String(resolvedMatchId || '').trim() || undefined,
        source: 'notifications_view',
      });
    }
  };

  const markNotificationAsReadBestEffort = async (notification, source = 'unknown') => {
    const notificationId = normalizeNotificationId(notification);
    debugNotificationEvent('NOTIFICATION_MARK_READ_START', {
      ...getNotificationRouteDebugPayload(notification),
      source: `notifications_view:${source}`,
      raw_notification: notification || null,
    });
    debugNotificationRoute('mark_read_attempt', {
      ...getNotificationRouteDebugPayload(notification),
      source,
    });

    if (!notificationId) {
      debugNotificationEvent('NOTIFICATION_MARK_READ_SKIP', {
        ...getNotificationRouteDebugPayload(notification),
        source: `notifications_view:${source}`,
        reason: 'missing_notification_id',
        raw_notification: notification || null,
      });
      debugNotificationRoute('mark_read_skipped_missing_id', {
        ...getNotificationRouteDebugPayload(notification),
        source,
        raw_notification: notification || null,
      });
      return;
    }

    try {
      await markAsRead(notificationId);
      debugNotificationEvent('NOTIFICATION_MARK_READ_DONE', {
        ...getNotificationRouteDebugPayload(notification),
        notification_id: notificationId,
        source: `notifications_view:${source}`,
      });
      debugNotificationRoute('mark_read_done', {
        ...getNotificationRouteDebugPayload(notification),
        notification_id: notificationId,
        source,
      });
    } catch (error) {
      debugNotificationEvent('NOTIFICATION_MARK_READ_ERROR', {
        ...getNotificationRouteDebugPayload(notification),
        notification_id: notificationId,
        source: `notifications_view:${source}`,
        error: error?.message || String(error || ''),
      });
      debugNotificationRoute('mark_read_failed', {
        ...getNotificationRouteDebugPayload(notification),
        notification_id: notificationId,
        source,
        error: error?.message || String(error || ''),
      });
    }
  };

  const handleNotificationClick = async (notification, e) => {
    if (e) { e.preventDefault?.(); e.stopPropagation?.(); }

    debugNotificationEvent('NOTIFICATION_TAP', {
      ...getNotificationRouteDebugPayload(notification),
      source: 'notifications_view',
      raw_notification: notification || null,
      current_route_before: `${location.pathname}${location.search}`,
    });
    debugNotificationRoute('click', {
      ...getNotificationRouteDebugPayload(notification),
      raw_notification: notification || null,
    });

    if (notification?.type === 'match_cancelled') {
      // Informative only.
      return;
    }

    if (shouldOpenAsTeamChallenge(notification)) {
      await openNotification(notification, navigate, {
        supabaseClient: supabase,
        userId: user?.id || '',
        onActionBlocked: (actionability) => {
          if (actionability?.message) {
            notifyBlockingError(actionability.message);
          }
        },
      });
      return;
    }

    const link = notification?.data?.link;
    const matchId = extractNotificationMatchId(notification);

    if (shouldTreatNotificationAsSurveyForm(notification)) {
      try {
        if (!notification.read) await markNotificationAsReadBestEffort(notification, 'survey_form_click');
      } catch (e) { /* Intentionally empty */ }

      const surveyNavigation = await resolveSurveyNotificationNavigation({
        notification,
        supabaseClient: supabase,
        userId: user?.id || '',
      });

      if (!surveyNavigation.canNavigate) {
        if (surveyNavigation.message) {
          notifyBlockingError(surveyNavigation.message);
        }
        return;
      }

      safeNavigate(notification, surveyNavigation.route, { replace: false });
      return;
    }

    const actionability = await resolveNotificationActionability({
      notification,
      supabaseClient: supabase,
    });
    if (!actionability.isActionable) {
      if (actionability.message) {
        notifyBlockingError(actionability.message);
      }
      return;
    }

    if ([
      'survey_results',
      'survey_results_ready',
      'survey_finished',
      'awards_ready',
      'award_won',
    ].includes(notification?.type)) {
      await openNotification(notification, navigate, {
        supabaseClient: supabase,
        userId: user?.id || '',
        onActionBlocked: (blocked) => {
          if (blocked?.message) {
            notifyBlockingError(blocked.message);
          }
        },
        onResultsUnavailable: (notice) => {
          if (notice?.message) {
            notifyBlockingError(notice.message, { title: notice.title });
          }
        },
      });
      return;
    }

    // Priority 1: Use link if available (for join requests and other notifications with direct links)
    if (link && notification?.type === 'match_join_request') {
      try {
        if (!notification.read) await markNotificationAsReadBestEffort(notification, 'match_join_request_click');
      } catch (e) { /* Intentionally empty */ }
      safeNavigate(notification, link, { replace: false });
      return;
    }

    // Pagos post partido: abrir la vista de pagos del partido.
    if (link && (notification?.type === 'payment_reminder' || notification?.type === 'payment_reported')) {
      try {
        if (!notification.read) await markNotificationAsReadBestEffort(notification, 'payment_click');
      } catch (e) { /* Intentionally empty */ }
      safeNavigate(notification, link, { replace: false });
      return;
    }

    if (notification?.type !== 'match_invite' && !notification.read) {
      markNotificationAsReadBestEffort(notification, 'generic_click');
    }

    const data = notification.data || {};
    const route = data.target_route || data.action?.route;
    const id = data.target_params?.partido_id;

    if (route === 'voting_view' && id && data.matchCode) {
      safeNavigate(notification, `/?codigo=${data.matchCode}`);
      return;
    }

    if (data.matchUrl) {
      safeNavigate(notification, data.matchUrl);
      return;
    }

    if (data.resultsUrl) {
      const isForcedAwardsNotif = [
        'awards_ready',
        'award_won',
      ].includes(notification?.type);
      if (isForcedAwardsNotif) {
        const target = buildAwardsResultsNavigationTarget(notification);
        safeNavigate(notification, target.route, {
          state: target.state,
        });
      } else if ([
        'survey_results',
        'survey_results_ready',
        'survey_finished',
      ].includes(notification?.type)) {
        const target = buildResultsNavigationTarget(notification);
        safeNavigate(notification, target.route, {
          state: target.state,
        });
      } else {
        safeNavigate(notification, stripShowAwardsParam(data.resultsUrl));
      }
      return;
    }

    if (notification.type === 'call_to_vote') {
      const { matchCode, matchId } = data;
      if (matchCode) {
        const url = `/votar-equipos?codigo=${matchCode}`;
        safeNavigate(notification, url, { replace: true });
        return;
      }
      if (matchId) {
        const url = `/votar-equipos?partidoId=${matchId}`;
        safeNavigate(notification, url, { replace: true });
        return;
      }
    }

    if (
      data.matchId
      && !shouldTreatNotificationAsSurveyForm(notification)
      && notification?.type !== 'match_invite'
      && notification?.type !== 'match_kicked'
      && notification?.type !== 'match_update'
    ) {
      safeNavigate(notification, `/partido/${toBigIntId(data.matchId)}`);
      return;
    }

    switch (notification.type) {
      case 'friend_accepted':
        safeNavigate(notification, '/amigos');
        break;
      case 'team_invite':
        safeNavigate(notification, buildTeamInviteRoute());
        break;
      case 'team_captain_transfer': {
        const teamId = data.team_id || data.teamId || null;
        safeNavigate(notification, teamId ? `/desafios/equipos/${teamId}` : '/desafios');
        break;
      }
      case 'match_invite':
      {
        const inviteStatus = String(data?.status || 'pending').trim().toLowerCase();
        if (inviteStatus !== 'pending') {
          notifyBlockingError('Esta invitación ya no está activa');
          break;
        }
        trackNotificationOpened(notification);

        const challengeRoute = await resolveTeamChallengeRouteFromMatchId({
          supabaseClient: supabase,
          matchId,
        });
        if (challengeRoute) {
          safeNavigate(notification, challengeRoute);
          break;
        }

        const inviteRoute = resolveMatchInviteRoute(notification);
        if (inviteRoute) {
          safeNavigate(notification, inviteRoute);
        } else {
          fallbackToNotificationRoute(notification, 'No pudimos abrir la invitación. Te mostramos tus partidos.');
        }
      }
        break;
      case 'match_kicked':
        // Informativa: no navega.
        break;
      case 'call_to_vote': {
        const { matchCode, matchId } = data;
        if (matchCode) {
          const url = `/votar-equipos?codigo=${matchCode}`;
          safeNavigate(notification, url, { replace: true });
        } else if (matchId) {
          const url = `/votar-equipos?partidoId=${matchId}`;
          safeNavigate(notification, url, { replace: true });
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos el partido para votar equipos.');
        }
        break;
      }
      case 'pre_match_vote': {
        const preMatchId = notification?.target_params?.partido_id;
        if (preMatchId) {
          safeNavigate(notification, `/voting/${toBigIntId(preMatchId)}`);
        } else if (data.matchCode) {
          safeNavigate(notification, `/?codigo=${data.matchCode}`);
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos la votación previa de este partido.');
        }
        break;
      }
      case 'survey_results':
      case 'survey_results_ready': {
        const resultsMatchId = notification.partido_id || data.partido_id || data.match_id || data.matchId;
        if (!resultsMatchId) {
          fallbackToNotificationRoute(notification, 'No encontramos los resultados de esta notificación.');
          break;
        }
        const target = buildResultsNavigationTarget(notification, toBigIntId(resultsMatchId));
        safeNavigate(notification, target.route, {
          state: target.state,
        });
        break;
      }
      case 'awards_ready':
      case 'award_won':
      {
        const resultsMatchId = notification.partido_id || data.partido_id || data.match_id || data.matchId;
        if (resultsMatchId || data.resultsUrl || data.link) {
          const target = buildAwardsResultsNavigationTarget(notification, resultsMatchId ? toBigIntId(resultsMatchId) : null);
          safeNavigate(notification, target.route, {
            state: target.state,
          });
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos los resultados de esta notificación.');
        }
        break;
      }
      case 'match_join_request':
        // Fallback if link is not available
        if (data.matchId) {
          safeNavigate(notification, `/admin/${toBigIntId(data.matchId)}?tab=solicitudes`);
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos la solicitud de ingreso de este partido.');
        }
        break;
      case 'match_update': {
        const matchRoute = await resolveAdminAwareMatchRoute({
          notification,
          matchId,
          supabaseClient: supabase,
          userId: user?.id,
        });
        safeNavigate(notification, matchRoute, {}, 'No encontramos el partido de esta notificación.');
        break;
      }
      case 'survey_finished': {
        // Robust matchId resolution
        const finalMatchId = notification.match_ref || notification.partido_id || data.match_id || data.matchId || data.partidoId;
        if (finalMatchId) {
          const target = buildResultsNavigationTarget(notification, toBigIntId(finalMatchId));
          safeNavigate(notification, target.route, {
            state: target.state,
          });
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos el resultado final de este partido.');
        }
        break;
      }
      default:
        fallbackToNotificationRoute(notification);
        break;
    }
  };

  const handleAcceptFriend = async (notification) => {
    const requestId = notification.data?.requestId;
    if (!requestId) return;
    trackNotificationOpened(notification);

    setProcessingRequests((prev) => {
      const newSet = new Set(prev);
      newSet.add(requestId);
      return newSet;
    });

    try {
      const result = await acceptFriendRequest(requestId);
      if (result.success) {
        markAsRead(notification.id);
        fetchNotifications();
      } else {
        notifyBlockingError(result.message || 'Error al aceptar solicitud');
      }
    } catch (error) {
      notifyBlockingError('Error al aceptar solicitud');
    } finally {
      setProcessingRequests((prev) => {
        const newSet = new Set(prev);
        newSet.delete(requestId);
        return newSet;
      });
    }
  };

  const handleRejectFriend = async (notification) => {
    const requestId = notification.data?.requestId;
    if (!requestId) return;
    trackNotificationOpened(notification);

    setProcessingRequests((prev) => {
      const newSet = new Set(prev);
      newSet.add(requestId);
      return newSet;
    });

    try {
      const result = await rejectFriendRequest(requestId);
      if (result.success) {
        markAsRead(notification.id);
        fetchNotifications();
      } else {
        notifyBlockingError(result.message || 'Error al rechazar solicitud');
      }
    } catch (error) {
      notifyBlockingError('Error al rechazar solicitud');
    } finally {
      setProcessingRequests((prev) => {
        const newSet = new Set(prev);
        newSet.delete(requestId);
        return newSet;
      });
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'friend_request':
        return UserPlus;
      case 'friend_accepted':
        return CheckCircle;
      case 'friend_rejected':
        return XCircle;
      case 'match_invite':
        return CalendarClock;
      case 'match_update':
        return Users;
      case 'substitute_promoted':
        return CheckCircle;
      case 'team_invite':
        return Users;
      case 'team_captain_transfer':
        return Users;
      case 'challenge_accepted':
      case 'team_match_created':
      case 'challenge_squad_open':
      case 'challenge_result_survey':
      case 'challenge_result_pending':
        return CalendarClock;
      case 'survey':
      case 'post_match_survey':
      case 'survey_start':
        return ClipboardList;
      case 'survey_reminder':
      case 'survey_reminder_12h':
        return ClipboardList;
      case 'call_to_vote':
        return Vote;
      case 'survey_results_ready':
      case 'survey_finished':
      case 'awards_ready':
        return Trophy;
      case 'award_won':
        return Trophy;
      case 'no_show_penalty_applied':
        return XCircle;
      case 'no_show_recovery_applied':
        return CheckCircle;
      default:
        return Bell;
    }
  };

  const visibleNotifications = useMemo(
    () => filterNotificationsForInbox(notifications),
    [notifications],
  );
  const filteredNotifications = filterNotificationsByCategory(visibleNotifications, activeFilter);
  const groupedNotifications = useMemo(
    () => groupNotificationsByMatch(filteredNotifications),
    [filteredNotifications],
  );
  const hasAnyNotifications = visibleNotifications.length > 0;
  const hasVisibleNotifications = groupedNotifications.length > 0;
  const hasUnreadNotifications = visibleNotifications.some((item) => !item.read);
  const EMPTY_STATE_TITLE_CLASS = 'font-oswald text-[clamp(18px,5.6vw,22px)] font-semibold leading-tight text-white';
  const EMPTY_STATE_CARD_CLASS = 'my-0 p-5';

  const handleMarkAllAsRead = async () => {
    if (markingAllAsRead || !hasUnreadNotifications) return;
    setMarkingAllAsRead(true);
    try {
      await markAllAsRead();
    } finally {
      setMarkingAllAsRead(false);
    }
  };

  const markGroupAsRead = async (group) => {
    const unreadItems = (group?.items || []).filter((item) => !item.read);
    if (unreadItems.length === 0) return;
    await Promise.all(unreadItems.map((item) => markNotificationAsReadBestEffort(item, 'group_click')));
  };

  const isClosedSurveyNotification = (notification) => {
    if (!shouldTreatNotificationAsSurveyForm(notification)) return false;
    return isSurveyNotificationClosed(notification);
  };

  const isNotificationInteractive = (notification) => {
    if (!notification) return false;
    if (notification.type === 'friend_request' || notification.type === 'match_kicked') return false;
    if (isClosedSurveyNotification(notification)) return false;
    const clickableTypes = new Set([
      'match_invite',
      'team_invite',
      'team_captain_transfer',
      'call_to_vote',
      'survey',
      'survey_start',
      'post_match_survey',
      'survey_reminder',
      'survey_reminder_12h',
      'survey_results_ready',
      'awards_ready',
      'survey_finished',
      'award_won',
      'match_update',
    ]);
    return clickableTypes.has(notification.type) || isTeamChallengeNotification(notification);
  };

  const handleGroupedNotificationClick = async (group, e) => {
    const notification = resolveGroupedClickNotification(group);
    if (!isNotificationInteractive(notification)) return;
    debugNotificationEvent('NOTIFICATION_TAP', {
      ...getNotificationRouteDebugPayload(group?.latest),
      source: 'notifications_view_group',
      group_key: group?.key,
      group_match_id: group?.matchId,
      group_count: group?.count,
      grouped_notification_ids: (group?.items || []).map((item) => item?.id).filter(Boolean),
      grouped_notification_types: (group?.items || []).map((item) => item?.type).filter(Boolean),
      raw_notification: group?.latest || null,
      raw_group: group || null,
      current_route_before: `${location.pathname}${location.search}`,
    });
    debugNotificationEvent('NOTIFICATION_SELECTED', {
      ...getNotificationRouteDebugPayload(notification),
      source: 'notifications_view_group',
      selected_notification_id: normalizeNotificationId(notification),
      latest_notification_id: normalizeNotificationId(group?.latest),
      group_key: group?.key,
      group_match_id: group?.matchId,
      group_count: group?.count,
      selected_notification: notification || null,
      raw_group: group || null,
    });
    debugNotificationRoute('group_click', {
      notification_id: notification?.id,
      selected_notification_id: normalizeNotificationId(notification),
      latest_notification_id: normalizeNotificationId(group?.latest),
      type: notification?.type,
      group_key: group?.key,
      group_match_id: group?.matchId,
      group_count: group?.count,
      match_id: extractNotificationMatchId(notification) || null,
      survey_id: notification?.survey_id || notification?.data?.survey_id || notification?.data?.surveyId || null,
      action_url: notification?.action_url || notification?.actionUrl || notification?.data?.action_url || notification?.data?.actionUrl || null,
      results_url: notification?.data?.resultsUrl || notification?.data?.results_url || null,
      link: notification?.data?.link || null,
      grouped_notification_ids: (group?.items || []).map((item) => item?.id).filter(Boolean),
      grouped_notification_types: (group?.items || []).map((item) => item?.type).filter(Boolean),
      selected_notification: notification || null,
    });
    if (notification?.type !== 'match_invite') {
      markGroupAsRead(group);
    }
    await handleNotificationClick(notification, e);
  };

  const toggleGroupExpanded = (groupKey, e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const getDisplayCopy = (notification) => {
    const isSurveyStartLike = notification.type === 'survey' || notification.type === 'survey_start' || notification.type === 'post_match_survey';
    const isSurveyReminder = notification.type === 'survey_reminder' || notification.type === 'survey_reminder_12h';
    const isSurveyResults = notification.type === 'survey_results_ready' || notification.type === 'survey_finished';
    const isChallengeResultPending = notification.type === 'challenge_result_survey' || notification.type === 'challenge_result_pending';
    const isMatchReminder = notification.type === 'match_reminder_1h';
    const isTeamInvite = notification.type === 'team_invite';
    const isMatchCancelled = notification.type === 'match_cancelled';
    const isTeamChallengeAccepted = isTeamChallengeNotification(notification);
    const matchName = resolveNotificationMatchName(notification, 'este partido');
    const quotedMatchName = quoteMatchName(matchName, 'este partido');
    const hasConcreteMatchName = matchName && matchName !== 'este partido';
    const matchFallbackLabel = hasConcreteMatchName ? quotedMatchName : 'el partido';
    const title = isChallengeResultPending
      ? 'Resultado pendiente'
      : isSurveyStartLike
      ? '¡Encuesta lista!'
      : isSurveyReminder
        ? 'Recordatorio de encuesta'
        : isSurveyResults
          ? getSurveyResultsReadyMessage({ matchName: quotedMatchName })
          : isMatchReminder
            ? formatMatchReminderTitle(notification)
          : isMatchCancelled
            ? 'Partido cancelado'
          : isTeamChallengeAccepted
            ? 'Desafío aceptado!'
          : isTeamInvite
            ? (notification.title || 'Invitacion de equipo')
          : applyMatchNameQuotes(notification.title || 'Notificación', matchName);
    const message = isChallengeResultPending
      ? (notification.message || `¿Cómo salió el desafío vs ${notification?.data?.rival_name || 'el rival'}?`)
      : isSurveyStartLike
      ? getSurveyStartMessage({ source: notification, matchName: quotedMatchName })
      : isSurveyReminder
        ? getSurveyReminderMessage({ source: notification, matchName: quotedMatchName })
        : isSurveyResults
          ? ''
          : isMatchReminder
            ? formatMatchReminderMessage(notification)
          : isMatchCancelled
            ? formatMatchCancelledMessage(notification, { fallbackLabel: matchFallbackLabel })
          : isTeamInvite
            ? formatTeamInviteMessage(notification)
          : applyMatchNameQuotes(notification.message || '', matchName);

    return { title, message };
  };

  return (
    <div
      data-notifications-root="true"
      className="w-full h-full px-4"
      style={{
        paddingTop: '6px',
        paddingBottom: 'calc(72px + 16px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="w-full max-w-[600px] mx-auto">
        {hasAnyNotifications && (
          <div data-notifications-first-block="true" className="mt-1 mb-3.5 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(148,134,255,0.25)] bg-[rgba(20,16,41,0.85)] px-3 py-1.5">
              <span className="text-[10px] leading-none uppercase tracking-[0.12em] font-sans font-bold text-[#b0a0ff]/80">
                No leídas
              </span>
              <span
                className={`inline-flex min-w-[22px] h-[22px] px-1.5 items-center justify-center rounded-full border text-[12px] font-sans font-bold leading-none ${
                  hasUnreadNotifications
                    ? 'border-[#ec007d] bg-[#ec007d] text-white shadow-[0_0_10px_rgba(236,0,125,0.4)]'
                    : 'border-[rgba(148,134,255,0.25)] bg-[rgba(39,32,80,0.6)] text-white/70'
                }`}
              >
                {unreadCount?.total || 0}
              </span>
            </div>
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              disabled={!hasUnreadNotifications || markingAllAsRead}
              className="shrink-0 h-[34px] px-3.5 rounded-full border text-[11px] font-sans font-semibold transition-colors bg-white/[0.05] border-[rgba(148,134,255,0.28)] text-white/80 hover:bg-white/[0.09] hover:text-white disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {markingAllAsRead ? 'Marcando...' : 'Marcar todas como leídas'}
            </button>
          </div>
        )}

        {hasAnyNotifications && (
          <div className="mb-4 grid grid-cols-2 gap-2 pb-1 sm:flex sm:flex-wrap">
            {NOTIFICATION_FILTER_OPTIONS.map((option) => {
              const isActive = activeFilter === option.key;
              const count = getCategoryCount(visibleNotifications, option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveFilter(option.key)}
                  className={`w-full min-w-0 h-[36px] px-3.5 rounded-full border text-[11px] sm:w-auto sm:text-xs font-sans font-semibold transition-colors ${
                    isActive
                      ? 'bg-cta-gradient border-[#7d5aff] text-white shadow-[0_4px_14px_rgba(106,67,255,0.35)]'
                      : 'bg-white/[0.04] border-[rgba(148,134,255,0.22)] text-white/65 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {option.label} {count > 0 ? `(${count})` : ''}
                </button>
              );
            })}
          </div>
        )}

        {!hasAnyNotifications ? (
          <div className="flex justify-center">
            <EmptyStateCard
              icon={Bell}
              title="SIN NOTIFICACIONES"
              titleClassName={EMPTY_STATE_TITLE_CLASS}
              description="Cuando pase algo importante en tus partidos, te lo mostramos acá."
              className={EMPTY_STATE_CARD_CLASS}
            />
          </div>
        ) : !hasVisibleNotifications ? (
          <div className="flex justify-center">
            <EmptyStateCard
              icon={Bell}
              title="SIN RESULTADOS EN ESTE FILTRO"
              titleClassName={EMPTY_STATE_TITLE_CLASS}
              description="Probá con otro filtro para ver el resto de tus notificaciones."
              className={EMPTY_STATE_CARD_CLASS}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {groupedNotifications.map((group) => {
              const notification = group.latest;
              const Icon = getNotificationIcon(notification.type);
              const { title: displayTitle, message: displayMessage } = getDisplayCopy(notification);
              const groupedMatchInfo = group.matchId && group.count > 1
                ? `+${group.count - 1} más de este partido`
                : null;
              const groupedItems = group.items.slice(1);
              const isExpanded = expandedGroups.has(group.key);
              const isInteractive = isNotificationInteractive(notification);
              return (
                <div
                key={group.key}
                role={isInteractive ? 'button' : undefined}
                tabIndex={isInteractive ? 0 : -1}
                className={`flex p-3.5 rounded-card transition-all duration-200 relative border border-[rgba(148,134,255,0.16)] bg-[linear-gradient(165deg,rgba(48,38,98,0.55),rgba(20,16,41,0.88))] shadow-[0_6px_16px_rgba(5,3,16,0.3),inset_0_1px_0_rgba(255,255,255,0.04)] ${
                  isInteractive ? 'cursor-pointer hover:border-[rgba(148,134,255,0.45)] hover:brightness-[1.06]' : 'cursor-default opacity-85'
                }`}
                onClick={(e) => {
                  if (!isInteractive) return;
                  handleGroupedNotificationClick(group, e);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isInteractive) {
                    handleGroupedNotificationClick(group, e);
                  }
                }}
              >
                <div className="mr-3 mt-0.5 flex items-center justify-center w-9 h-9 shrink-0 rounded-xl border border-[rgba(148,134,255,0.3)] bg-[linear-gradient(140deg,rgba(139,92,255,0.28),rgba(106,67,255,0.08))] text-[#cfc4ff]">
                  <Icon size={17} />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-white text-[14px] leading-snug mb-1">{displayTitle}</div>
                  <div className="text-white/65 text-[13px] leading-snug mb-2">{displayMessage}</div>
                  {groupedMatchInfo && (
                    <button
                      type="button"
                      className="mb-1 inline-flex items-center gap-1 text-[11px] text-white/65 hover:text-white transition-colors"
                      onClick={(e) => toggleGroupExpanded(group.key, e)}
                    >
                      {groupedMatchInfo}
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}
                  {isExpanded && groupedItems.length > 0 && (
                    <div className="mb-2 rounded-xl border border-[rgba(148,134,255,0.2)] bg-[rgba(12,10,29,0.7)] overflow-hidden">
                      {groupedItems.map((item, index) => {
                        const ItemIcon = getNotificationIcon(item.type);
                        const { title, message } = getDisplayCopy(item);
                        const itemInteractive = isNotificationInteractive(item);
                        return (
                          <button
                            key={`${group.key}-${item.id}-${index}`}
                            type="button"
                            disabled={!itemInteractive}
                            className={`w-full px-2.5 py-2 text-left transition-colors border-b last:border-b-0 border-white/[0.06] ${
                              itemInteractive ? 'hover:bg-white/[0.06]' : 'opacity-85 cursor-default'
                            }`}
                            onClick={(e) => {
                              if (!itemInteractive) return;
                              handleNotificationClick(item, e);
                            }}
                          >
                            <div className="flex items-start gap-2">
                              <div className="mt-0.5 flex h-5 w-5 items-center justify-center text-white/80 shrink-0">
                                <ItemIcon size={11} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-semibold text-white/90 leading-snug break-words">{title}</div>
                                <div className="text-[11px] text-white/70 leading-snug line-clamp-2">{message}</div>
                                <div className="text-[10px] text-white/50 mt-0.5">{formatDate(item.created_at)}</div>
                              </div>
                              {!item.read && <div className="mt-1.5 w-1.5 h-1.5 bg-[#ec007d] rounded-full shrink-0"></div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-xs text-white/60">{formatDate(notification.created_at)}</div>

                  {/* Friend request action buttons */}
                  {notification.type === 'friend_request' && !notification.read && (
                    <div className="flex gap-2 mt-2">
                      <button
                        className="px-3 h-8 rounded-full border border-[#7d5aff] cursor-pointer text-xs font-sans font-semibold tracking-[0.01em] transition-all min-w-[92px] bg-cta-gradient text-white hover:brightness-110 shadow-[0_4px_14px_rgba(106,67,255,0.35)] disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcceptFriend(notification);
                        }}
                        disabled={processingRequests.has(notification.data?.requestId)}
                      >
                        {processingRequests.has(notification.data?.requestId) ? 'Aceptando...' : 'Aceptar'}
                      </button>
                      <button
                        className="px-3 h-8 rounded-full border border-[rgba(148,134,255,0.28)] cursor-pointer text-xs font-sans font-semibold tracking-[0.01em] transition-all min-w-[92px] bg-white/[0.05] text-white/85 hover:bg-white/[0.1] disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRejectFriend(notification);
                        }}
                        disabled={processingRequests.has(notification.data?.requestId)}
                      >
                        {processingRequests.has(notification.data?.requestId) ? 'Rechazando...' : 'Rechazar'}
                      </button>
                    </div>
                  )}
                </div>
                {group.unreadCount > 0 && (
                  <div className="absolute top-3 right-3 w-2 h-2 bg-[#ec007d] rounded-full shadow-[0_0_8px_rgba(236,0,125,0.6)]"></div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsView;
