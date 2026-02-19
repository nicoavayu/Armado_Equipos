import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CheckCircle, ClipboardList, Trophy, UserPlus, Users, Vote, XCircle } from 'lucide-react';
import { toBigIntId } from '../utils';
import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';
import { useNotifications } from '../context/NotificationContext';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';
import EmptyStateCard from './EmptyStateCard';
import { getSurveyReminderMessage, getSurveyResultsReadyMessage, getSurveyStartMessage } from '../utils/surveyNotificationCopy';
import { applyMatchNameQuotes, quoteMatchName, resolveNotificationMatchName } from '../utils/notificationText';
import { filterNotificationsByCategory, getCategoryCount, NOTIFICATION_FILTER_OPTIONS } from '../utils/notificationFilters';
import { buildNotificationFallbackRoute, extractNotificationMatchId } from '../utils/notificationRoutes';
import { notifyBlockingError } from 'utils/notifyBlockingError';


const NotificationsView = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    notifications,
    markAsRead,
    fetchNotifications,
  } = useNotifications();


  const { acceptFriendRequest, rejectFriendRequest } = useAmigos(user?.id);

  const [processingRequests, setProcessingRequests] = useState(new Set());
  const [activeFilter, setActiveFilter] = useState('all');

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
  const hasAnyNotifications = notifications.length > 0;
  const hasVisibleNotifications = filteredNotifications.length > 0;

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
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {NOTIFICATION_FILTER_OPTIONS.map((option) => {
              const isActive = activeFilter === option.key;
              const count = getCategoryCount(notifications, option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveFilter(option.key)}
                  className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-oswald transition-colors ${
                    isActive
                      ? 'bg-primary/80 border-primary text-white'
                      : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10 hover:text-white'
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
            {filteredNotifications.map((notification) => {
              const Icon = getNotificationIcon(notification.type);
              const isSurveyStartLike = notification.type === 'survey_start' || notification.type === 'post_match_survey';
              const isSurveyReminder = notification.type === 'survey_reminder';
              const isSurveyResults = notification.type === 'survey_results_ready';
              const matchName = resolveNotificationMatchName(notification, 'este partido');
              const quotedMatchName = quoteMatchName(matchName, 'este partido');
              const displayTitle = isSurveyStartLike
                ? '¡Encuesta lista!'
                : isSurveyReminder
                  ? 'Recordatorio de encuesta'
                  : isSurveyResults
                    ? 'Resultados de encuesta listos'
                    : applyMatchNameQuotes(notification.title || 'Notificación', matchName);
              const displayMessage = isSurveyStartLike
                ? getSurveyStartMessage({ source: notification, matchName: quotedMatchName })
                : isSurveyReminder
                  ? getSurveyReminderMessage({ source: notification, matchName: quotedMatchName })
                  : isSurveyResults
                    ? getSurveyResultsReadyMessage({ matchName: quotedMatchName })
                    : applyMatchNameQuotes(notification.message || '', matchName);
              return (
                <div
                key={notification.id}
                role="button"
                tabIndex={0}
                className={`flex p-3 bg-white/10 rounded-lg cursor-pointer transition-all duration-200 relative border border-white/10 hover:bg-white/15 ${!notification.read ? 'bg-[#128BE9]/15 border-[#128BE9]/35' : ''
                  } ${notification.type === 'friend_request' ? 'cursor-default' : ''}`}
                onClick={(e) => {
                  console.log('[NOTIFICATION_CLICK] Notification clicked, type:', notification.type);
                  if (notification.type !== 'friend_request') {
                    handleNotificationClick(notification, e);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && notification.type !== 'friend_request') {
                    handleNotificationClick(notification, e);
                  }
                }}
              >
                <div className="text-2xl mr-3 flex items-center justify-center w-10 h-10 bg-white/10 rounded-full text-white/90">
                  <Icon size={18} />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-white mb-1">{displayTitle}</div>
                  <div className="text-white/80 text-sm mb-2">{displayMessage}</div>
                  <div className="text-xs text-white/60">{formatDate(notification.created_at)}</div>

                  {/* Friend request action buttons */}
                  {notification.type === 'friend_request' && !notification.read && (
                    <div className="flex gap-2 mt-2">
                      <button
                        className="px-3 py-1.5 rounded border-none cursor-pointer text-xs font-medium transition-all min-w-[70px] bg-[#2196F3] text-white hover:bg-[#1976D2] disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAcceptFriend(notification);
                        }}
                        disabled={processingRequests.has(notification.data?.requestId)}
                      >
                        {processingRequests.has(notification.data?.requestId) ? 'Aceptando...' : 'Aceptar'}
                      </button>
                      <button
                        className="px-3 py-1.5 rounded border-none cursor-pointer text-xs font-medium transition-all min-w-[70px] bg-[#f44336] text-white hover:bg-[#da190b] disabled:opacity-60 disabled:cursor-not-allowed"
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
                {!notification.read && (
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
