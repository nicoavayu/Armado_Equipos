import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CheckCircle, ChevronDown, ChevronUp, ClipboardList, Trophy, UserPlus, Users, Vote, XCircle } from 'lucide-react';
import { toBigIntId } from '../utils';
import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';
import { resolveSurveyNotificationRoute } from '../utils/notificationRouter';
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
  formatMatchCancelledMessage,
  formatTeamInviteMessage,
  quoteMatchName,
  resolveNotificationMatchName,
} from '../utils/notificationText';
import { filterNotificationsByCategory, getCategoryCount, NOTIFICATION_FILTER_OPTIONS } from '../utils/notificationFilters';
import {
  buildNotificationFallbackRoute,
  buildTeamChallengeRoute,
  extractNotificationMatchId,
  isTeamChallengeNotification,
  resolveAdminAwareMatchRoute,
  resolveTeamChallengeRouteFromMatchId,
} from '../utils/notificationRoutes';
import { groupNotificationsByMatch } from '../utils/notificationGrouping';
import { filterNotificationsForInbox } from '../utils/notificationInviteState';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import supabase from '../supabase';
import { resolveSurveyAccess } from '../utils/surveyAccess';
import { track } from '../utils/monitoring/analytics';


const NotificationsView = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
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
    console.log('[NOTIFICATIONS_VIEW] Component mounted, fetching notifications');
    fetchNotifications();
  }, [fetchNotifications]);

  // Refetch notifications when returning to this view
  useEffect(() => {
    const handleFocus = () => {
      fetchNotifications();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchNotifications]);

  // Log notifications when they change
  useEffect(() => {
    console.log('[NOTIFICATIONS_VIEW] Notifications updated:', notifications.length, 'total');
    const friendRequests = notifications.filter((n) => n.type === 'friend_request');
    console.log('[NOTIFICATIONS_VIEW] Friend requests:', friendRequests.length, friendRequests);
  }, [notifications]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const fallbackToNotificationRoute = (notification, message = 'No encontramos ese destino. Te llevamos a tus partidos.') => {
    notifyBlockingError(message);
    const fallbackRoute = buildNotificationFallbackRoute(notification, toBigIntId);
    navigate(fallbackRoute);
  };

  const safeNavigate = (notification, route, options = {}, message) => {
    if (!route) {
      fallbackToNotificationRoute(notification, message);
      return false;
    }
    try {
      navigate(route, options);
      return true;
    } catch (error) {
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

  const handleNotificationClick = async (notification, e) => {
    if (e) { e.preventDefault?.(); e.stopPropagation?.(); }

    if (notification?.type === 'match_cancelled') {
      // Informative only.
      return;
    }

    const link = notification?.data?.link;
    const matchId = extractNotificationMatchId(notification);

    console.debug('[NOTIFICATION_CLICK]', { id: notification?.id, type: notification?.type, link, matchId });

    // Priority 1: Use link if available (for join requests and other notifications with direct links)
    if (link && notification?.type === 'match_join_request') {
      try { if (!notification.read) await markAsRead(notification.id); } catch (e) { /* Intentionally empty */ }
      safeNavigate(notification, link, { replace: false });
      return;
    }

    if (notification?.type === 'survey_start' || notification?.type === 'post_match_survey') {
      try { if (!notification.read) await markAsRead(notification.id); } catch (e) { /* Intentionally empty */ }

      if (matchId && isSurveyNotificationClosed(notification)) {
        return;
      }

      if (matchId && user?.id) {
        const access = await resolveSurveyAccess({
          supabaseClient: supabase,
          matchId,
          userId: user.id,
        });
        if (!access.allowed) {
          notifyBlockingError(access.message);
          return;
        }
      }
      const surveyRoute = resolveSurveyNotificationRoute(notification);
      if (surveyRoute) {
        safeNavigate(notification, surveyRoute, { replace: false });
      } else if (matchId) {
        safeNavigate(notification, `/encuesta/${toBigIntId(matchId)}`, { replace: false });
      } else {
        fallbackToNotificationRoute(notification, 'No encontramos la encuesta para esta notificación.');
      }
      return;
    }

    if (notification?.type !== 'match_invite' && !notification.read) {
      markAsRead(notification.id);
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
      const isAwardsNotif = ['survey_results', 'survey_results_ready', 'awards_ready', 'award_won'].includes(notification?.type);
      if (isAwardsNotif) {
        safeNavigate(notification, data.resultsUrl, {
          state: {
            forceAwards: true,
            fromNotification: true,
            matchName: data?.match_name || data?.partido_nombre || null,
          },
        });
      } else {
        safeNavigate(notification, data.resultsUrl);
      }
      return;
    }

    if (notification.type === 'call_to_vote') {
      const { matchCode, matchId } = data;
      if (matchCode) {
        const url = `/votar-equipos?codigo=${matchCode}`;
        console.log('[NOTIFICATION_CLICK] call_to_vote - navigating to:', url);
        safeNavigate(notification, url, { replace: true });
        return;
      }
      if (matchId) {
        const url = `/votar-equipos?partidoId=${matchId}`;
        console.log('[NOTIFICATION_CLICK] call_to_vote - navigating to:', url);
        safeNavigate(notification, url, { replace: true });
        return;
      }
    }

    if (isTeamChallengeNotification(notification)) {
      const challengeRoute = buildTeamChallengeRoute(notification);
      safeNavigate(notification, challengeRoute, {}, 'No encontramos el destino de este desafío.');
      return;
    }

    if (
      data.matchId
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
        safeNavigate(notification, '/desafios');
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
          console.info('Esta invitación ya no está activa');
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
          console.log('[NOTIFICATION_CLICK] About to navigate to:', url);
          safeNavigate(notification, url, { replace: true });
        } else if (matchId) {
          const url = `/votar-equipos?partidoId=${matchId}`;
          console.log('[NOTIFICATION_CLICK] About to navigate to:', url);
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
      case 'post_match_survey':
        if (matchId) {
          safeNavigate(notification, `/encuesta/${toBigIntId(matchId)}`);
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos la encuesta de este partido.');
        }
        break;
      case 'survey_reminder':
      case 'survey_reminder_12h':
        console.log('[NOTIFICATION_CLICK] Survey reminder - matchId:', matchId);
        if (matchId) {
          if (isSurveyNotificationClosed(notification)) {
            break;
          }

          if (user?.id) {
            const access = await resolveSurveyAccess({
              supabaseClient: supabase,
              matchId,
              userId: user.id,
            });
            if (!access.allowed) {
              notifyBlockingError(access.message);
              break;
            }
          }
          const url = `/encuesta/${toBigIntId(matchId)}`;
          console.log('[NOTIFICATION_CLICK] Navigating to:', url);
          safeNavigate(notification, url);
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos la encuesta que te queríamos recordar.');
        }
        break;
      case 'survey_results':
      case 'survey_results_ready':
      case 'awards_ready':
      case 'award_won':
        if (data.resultsUrl) {
          safeNavigate(notification, data.resultsUrl, {
            state: {
              forceAwards: true,
              fromNotification: true,
              matchName: data?.match_name || data?.partido_nombre || null,
            },
          });
        } else {
          const resultsMatchId = notification.partido_id || data.partido_id || data.match_id || data.matchId;
          if (resultsMatchId) {
            safeNavigate(notification, `/resultados-encuesta/${toBigIntId(resultsMatchId)}?showAwards=1`, {
              state: {
                forceAwards: true,
                fromNotification: true,
                matchName: data?.match_name || data?.partido_nombre || null,
              },
            });
          } else {
            fallbackToNotificationRoute(notification, 'No encontramos los resultados de esta notificación.');
          }
        }
        break;
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
          safeNavigate(notification, `/resultados-encuesta/${toBigIntId(finalMatchId)}`);
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos el resultado final de este partido.');
        }
        break;
      }
      default:
        console.log('[NOTIFICATION_CLICK] Unknown notification type:', notification.type);
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
        console.info('Solicitud de amistad aceptada');
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
        console.info('Solicitud de amistad rechazada');
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
      case 'team_invite':
        return Users;
      case 'team_captain_transfer':
        return Users;
      case 'challenge_accepted':
      case 'team_match_created':
      case 'challenge_squad_open':
        return CalendarClock;
      case 'post_match_survey':
      case 'survey_start':
        return ClipboardList;
      case 'survey_reminder':
      case 'survey_reminder_12h':
        return ClipboardList;
      case 'call_to_vote':
        return Vote;
      case 'survey_results_ready':
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
    await Promise.all(unreadItems.map((item) => markAsRead(item.id)));
  };

  const isClosedSurveyNotification = (notification) => {
    const type = notification?.type;
    const isSurveyStartLike = type === 'survey_start' || type === 'post_match_survey';
    const isSurveyReminder = type === 'survey_reminder' || type === 'survey_reminder_12h';
    if (!isSurveyStartLike && !isSurveyReminder) return false;
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
    const notification = group?.latest;
    if (!isNotificationInteractive(notification)) return;
    if (notification?.type !== 'match_invite') {
      await markGroupAsRead(group);
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
    const isSurveyStartLike = notification.type === 'survey_start' || notification.type === 'post_match_survey';
    const isSurveyReminder = notification.type === 'survey_reminder' || notification.type === 'survey_reminder_12h';
    const isSurveyResults = notification.type === 'survey_results_ready';
    const isTeamInvite = notification.type === 'team_invite';
    const isMatchCancelled = notification.type === 'match_cancelled';
    const isTeamChallengeAccepted = isTeamChallengeNotification(notification);
    const matchName = resolveNotificationMatchName(notification, 'este partido');
    const quotedMatchName = quoteMatchName(matchName, 'este partido');
    const matchFallbackLabel = (() => {
      const matchId = String(extractNotificationMatchId(notification) || '').trim();
      if (matchId) return `el partido #${matchId}`;
      return quotedMatchName;
    })();
    const title = isSurveyStartLike
      ? '¡Encuesta lista!'
      : isSurveyReminder
        ? 'Recordatorio de encuesta'
        : isSurveyResults
          ? 'Resultados de encuesta listos'
          : isMatchCancelled
            ? 'Partido cancelado'
          : isTeamChallengeAccepted
            ? 'Desafío aceptado!'
          : isTeamInvite
            ? (notification.title || 'Invitacion de equipo')
          : applyMatchNameQuotes(notification.title || 'Notificación', matchName);
    const message = isSurveyStartLike
      ? getSurveyStartMessage({ source: notification, matchName: quotedMatchName })
      : isSurveyReminder
        ? getSurveyReminderMessage({ source: notification, matchName: quotedMatchName })
        : isSurveyResults
          ? getSurveyResultsReadyMessage({ matchName: quotedMatchName })
          : isMatchCancelled
            ? formatMatchCancelledMessage(notification, { fallbackLabel: matchFallbackLabel })
          : isTeamInvite
            ? formatTeamInviteMessage(notification)
          : applyMatchNameQuotes(notification.message || '', matchName);

    return { title, message };
  };

  return (
    <div
      className="w-full h-full px-4"
      style={{
        paddingTop: '16px',
        paddingBottom: 'calc(72px + 16px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="w-full max-w-[600px] mx-auto">
        {hasAnyNotifications && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-none border border-[rgba(106,126,202,0.45)] bg-[rgba(17,26,59,0.96)] px-2.5 py-1.5">
              <span className="text-[10px] leading-none uppercase tracking-[0.08em] font-oswald text-white/60">
                No leídas
              </span>
              <span
                className={`inline-flex min-w-[22px] h-[22px] px-1.5 items-center justify-center rounded-none border text-[12px] font-oswald font-semibold leading-none ${
                  hasUnreadNotifications
                    ? 'border-[#644dff] bg-[#644dff] text-white'
                    : 'border-[rgba(106,126,202,0.4)] bg-[rgba(26,35,76,0.58)] text-white/70'
                }`}
              >
                {unreadCount?.total || 0}
              </span>
            </div>
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              disabled={!hasUnreadNotifications || markingAllAsRead}
              className="shrink-0 h-[34px] px-3 rounded-none border text-[11px] font-oswald font-medium transition-colors bg-[rgba(20,31,70,0.82)] border-[rgba(98,117,184,0.58)] text-white/80 hover:bg-[rgba(30,45,94,0.95)] hover:text-white disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {markingAllAsRead ? 'Marcando...' : 'Marcar todas como leídas'}
            </button>
          </div>
        )}

        {hasAnyNotifications && (
          <div className="mb-3 grid grid-cols-2 gap-2 pb-1 sm:flex sm:flex-wrap">
            {NOTIFICATION_FILTER_OPTIONS.map((option) => {
              const isActive = activeFilter === option.key;
              const count = getCategoryCount(visibleNotifications, option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveFilter(option.key)}
                  className={`w-full min-w-0 h-[38px] px-2.5 rounded-none border text-[11px] sm:w-auto sm:text-xs font-oswald transition-colors ${
                    isActive
                      ? 'bg-[#644dff] border-[#644dff] text-white'
                      : 'bg-[rgba(20,31,70,0.82)] border-[rgba(98,117,184,0.58)] text-white/72 hover:bg-[rgba(30,45,94,0.95)] hover:text-white'
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
                className={`flex p-3 bg-transparent rounded-none transition-all duration-200 relative border border-[rgba(88,107,170,0.46)] ${
                  isInteractive ? 'cursor-pointer hover:border-[#4a7ed6]' : 'cursor-default opacity-85'
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
                <div className="text-2xl mr-3 flex items-center justify-center w-8 h-8 bg-transparent border-0 text-white/90">
                  <Icon size={18} />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-white mb-1">{displayTitle}</div>
                  <div className="text-white/80 text-sm mb-2">{displayMessage}</div>
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
                    <div className="mb-2 rounded-none border border-[rgba(88,108,176,0.5)] bg-[rgba(10,21,52,0.85)] overflow-hidden">
                      {groupedItems.map((item, index) => {
                        const ItemIcon = getNotificationIcon(item.type);
                        const { title, message } = getDisplayCopy(item);
                        const itemInteractive = isNotificationInteractive(item);
                        return (
                          <button
                            key={`${group.key}-${item.id}-${index}`}
                            type="button"
                            disabled={!itemInteractive}
                            className={`w-full px-2.5 py-2 text-left transition-colors border-b last:border-b-0 border-[rgba(88,108,176,0.4)] ${
                              itemInteractive ? 'hover:bg-[rgba(30,45,94,0.9)]' : 'opacity-85 cursor-default'
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
                                <div className="text-[12px] font-semibold text-white/90 leading-tight truncate">{title}</div>
                                <div className="text-[11px] text-white/70 leading-snug line-clamp-2">{message}</div>
                                <div className="text-[10px] text-white/50 mt-0.5">{formatDate(item.created_at)}</div>
                              </div>
                              {!item.read && <div className="mt-1.5 w-1.5 h-1.5 bg-[#128BE9] rounded-full shrink-0"></div>}
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
                        className="px-3 h-8 rounded-none border border-[#7d5aff] cursor-pointer text-xs font-bebas tracking-[0.01em] transition-all min-w-[92px] bg-[#6a43ff] text-white hover:bg-[#7550ff] shadow-[0_0_12px_rgba(106,67,255,0.28)] disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcceptFriend(notification);
                        }}
                        disabled={processingRequests.has(notification.data?.requestId)}
                      >
                        {processingRequests.has(notification.data?.requestId) ? 'Aceptando...' : 'Aceptar'}
                      </button>
                      <button
                        className="px-3 h-8 rounded-none border border-[rgba(88,107,170,0.46)] cursor-pointer text-xs font-bebas tracking-[0.01em] transition-all min-w-[92px] bg-[rgba(23,35,74,0.72)] text-[rgba(242,246,255,0.9)] hover:bg-[rgba(31,45,91,0.82)] disabled:opacity-60 disabled:cursor-not-allowed"
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
                  <div className="absolute top-3 right-3 w-2 h-2 bg-[#128BE9] rounded-full"></div>
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
