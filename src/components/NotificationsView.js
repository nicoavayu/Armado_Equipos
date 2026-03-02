import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CheckCircle, ChevronDown, ChevronUp, ClipboardList, Trophy, UserPlus, Users, Vote, XCircle } from 'lucide-react';
import { toBigIntId } from '../utils';
import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';
import { useNotifications } from '../context/NotificationContext';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';
import EmptyStateCard from './EmptyStateCard';
import { getSurveyReminderMessage, getSurveyResultsReadyMessage, getSurveyStartMessage } from '../utils/surveyNotificationCopy';
import {
  applyMatchNameQuotes,
  formatTeamInviteMessage,
  quoteMatchName,
  resolveNotificationMatchName,
} from '../utils/notificationText';
import { filterNotificationsByCategory, getCategoryCount, NOTIFICATION_FILTER_OPTIONS } from '../utils/notificationFilters';
import { buildNotificationFallbackRoute, extractNotificationMatchId } from '../utils/notificationRoutes';
import { groupNotificationsByMatch } from '../utils/notificationGrouping';
import { notifyBlockingError } from 'utils/notifyBlockingError';


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

  const handleNotificationClick = async (notification, e) => {
    if (e) { e.preventDefault?.(); e.stopPropagation?.(); }

    const link = notification?.data?.link;
    const matchId = extractNotificationMatchId(notification);

    console.debug('[NOTIFICATION_CLICK]', { id: notification?.id, type: notification?.type, link, matchId });

    // Priority 1: Use link if available (for join requests and other notifications with direct links)
    if (link && notification?.type === 'match_join_request') {
      try { if (!notification.read) await markAsRead(notification.id); } catch (e) { /* Intentionally empty */ }
      safeNavigate(notification, link, { replace: false });
      return;
    }

    if (notification?.type === 'survey_start') {
      try { if (!notification.read) await markAsRead(notification.id); } catch (e) { /* Intentionally empty */ }
      if (link) {
        safeNavigate(notification, link, { replace: false });
      } else if (matchId) {
        safeNavigate(notification, `/encuesta/${toBigIntId(matchId)}`, { replace: false });
      } else {
        fallbackToNotificationRoute(notification, 'No encontramos la encuesta para esta notificación.');
      }
      return;
    }

    if (!notification.read) {
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

    if (notification.type === 'challenge_accepted' || notification.type === 'team_match_created') {
      const teamMatchId = data.team_match_id || data.teamMatchId;
      if (teamMatchId) {
        safeNavigate(notification, `/quiero-jugar/equipos/partidos/${teamMatchId}`);
      } else {
        fallbackToNotificationRoute(notification, 'No encontramos el partido de equipos de esta notificacion.');
      }
      return;
    }

    if (data.matchId && notification?.type !== 'match_invite') {
      safeNavigate(notification, `/partido/${toBigIntId(data.matchId)}`);
      return;
    }

    switch (notification.type) {
      case 'friend_request':
        break;
      case 'friend_accepted':
        safeNavigate(notification, '/amigos');
        break;
      case 'team_invite':
        safeNavigate(notification, '/quiero-jugar');
        break;
      case 'team_captain_transfer': {
        const teamId = data.team_id || data.teamId || null;
        safeNavigate(notification, teamId ? `/quiero-jugar/equipos/${teamId}` : '/quiero-jugar');
        break;
      }
      case 'match_invite':
      {
        const inviteRoute = resolveMatchInviteRoute(notification);
        if (inviteRoute) {
          safeNavigate(notification, inviteRoute);
        } else {
          fallbackToNotificationRoute(notification, 'No pudimos abrir la invitación. Te mostramos tus partidos.');
        }
      }
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
        if (data.partido_id) {
          safeNavigate(notification, `/encuesta/${toBigIntId(data.partido_id)}`);
        } else {
          fallbackToNotificationRoute(notification, 'No encontramos la encuesta de este partido.');
        }
        break;
      case 'survey_reminder':
        console.log('[NOTIFICATION_CLICK] Survey reminder - matchId:', data.matchId);
        if (data.matchId) {
          const url = `/encuesta/${toBigIntId(data.matchId)}`;
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
        return CalendarClock;
      case 'post_match_survey':
        return ClipboardList;
      case 'survey_reminder':
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

  const filteredNotifications = filterNotificationsByCategory(notifications, activeFilter);
  const groupedNotifications = useMemo(
    () => groupNotificationsByMatch(filteredNotifications),
    [filteredNotifications],
  );
  const hasAnyNotifications = notifications.length > 0;
  const hasVisibleNotifications = groupedNotifications.length > 0;
  const hasUnreadNotifications = (unreadCount?.total || 0) > 0;

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

  const handleGroupedNotificationClick = async (group, e) => {
    const notification = group?.latest;
    if (!notification || notification.type === 'friend_request') return;
    await markGroupAsRead(group);
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
    const isSurveyReminder = notification.type === 'survey_reminder';
    const isSurveyResults = notification.type === 'survey_results_ready';
    const isTeamInvite = notification.type === 'team_invite';
    const matchName = resolveNotificationMatchName(notification, 'este partido');
    const quotedMatchName = quoteMatchName(matchName, 'este partido');
    const title = isSurveyStartLike
      ? '¡Encuesta lista!'
      : isSurveyReminder
        ? 'Recordatorio de encuesta'
        : isSurveyResults
          ? 'Resultados de encuesta listos'
          : isTeamInvite
            ? (notification.title || 'Invitacion de equipo')
          : applyMatchNameQuotes(notification.title || 'Notificación', matchName);
    const message = isSurveyStartLike
      ? getSurveyStartMessage({ source: notification, matchName: quotedMatchName })
      : isSurveyReminder
        ? getSurveyReminderMessage({ source: notification, matchName: quotedMatchName })
        : isSurveyResults
          ? getSurveyResultsReadyMessage({ matchName: quotedMatchName })
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
              const count = getCategoryCount(notifications, option.key);
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
              titleClassName="font-oswald font-semibold text-[24px] leading-none tracking-[0.01em] text-white sm:text-[22px]"
              description="Cuando pase algo importante en tus partidos, te lo mostramos acá."
              actionLabel="Ver partidos"
              onAction={() => navigate('/quiero-jugar')}
            />
          </div>
        ) : !hasVisibleNotifications ? (
          <div className="flex justify-center">
            <EmptyStateCard
              icon={Bell}
              title="SIN RESULTADOS EN ESTE FILTRO"
              titleClassName="font-oswald font-semibold text-[24px] leading-none tracking-[0.01em] text-white sm:text-[22px]"
              description="Probá con otro filtro para ver el resto de tus notificaciones."
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
              return (
                <div
                key={group.key}
                role="button"
                tabIndex={0}
                className={`flex p-3 bg-transparent rounded-none cursor-pointer transition-all duration-200 relative border border-[#6a43ff] hover:border-[#8262ff] ${group.unreadCount > 0 ? 'border-[#6a43ff]' : ''
                  } ${notification.type === 'friend_request' ? 'cursor-default' : ''}`}
                onClick={(e) => {
                  if (notification.type !== 'friend_request') handleGroupedNotificationClick(group, e);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && notification.type !== 'friend_request') {
                    handleGroupedNotificationClick(group, e);
                  }
                }}
              >
                <div className="text-2xl mr-3 flex items-center justify-center w-10 h-10 bg-[rgba(18,35,82,0.94)] border border-[rgba(88,108,176,0.5)] rounded-none text-white/90">
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
                        return (
                          <button
                            key={`${group.key}-${item.id}-${index}`}
                            type="button"
                            className="w-full px-2.5 py-2 text-left hover:bg-[rgba(30,45,94,0.9)] transition-colors border-b last:border-b-0 border-[rgba(88,108,176,0.4)]"
                            onClick={(e) => handleNotificationClick(item, e)}
                          >
                            <div className="flex items-start gap-2">
                              <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/80 shrink-0">
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
                        className="px-3 h-8 rounded-none border border-[rgba(136,120,255,0.75)] cursor-pointer text-xs font-medium transition-all min-w-[92px] bg-[linear-gradient(90deg,#4f8ef7_0%,#6f4dff_100%)] text-white hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcceptFriend(notification);
                        }}
                        disabled={processingRequests.has(notification.data?.requestId)}
                      >
                        {processingRequests.has(notification.data?.requestId) ? 'Aceptando...' : 'Aceptar'}
                      </button>
                      <button
                        className="px-3 h-8 rounded-none border border-[rgba(255,83,106,0.64)] cursor-pointer text-xs font-medium transition-all min-w-[92px] bg-[rgba(116,20,40,0.52)] text-[#ffb5bf] hover:bg-[rgba(132,25,46,0.64)] hover:text-[#ffd0d6] disabled:opacity-60 disabled:cursor-not-allowed"
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
