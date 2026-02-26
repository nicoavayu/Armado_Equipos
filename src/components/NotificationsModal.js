import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CheckCircle, ClipboardList, ShieldAlert, Trophy, User, UserPlus, Users, Vote, XCircle } from 'lucide-react';
import supabase from '../supabase';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { openNotification } from '../utils/notificationRouter';
import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';
import LoadingSpinner from './LoadingSpinner';
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
import { notifyBlockingError } from 'utils/notifyBlockingError';

const NotificationsModal = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { notifications, fetchNotifications: refreshNotifications, clearAllNotifications: clearNotificationsLocal } = useNotifications();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && user?.id && refreshNotifications) {
      refreshNotifications();
    }
  }, [isOpen, user?.id, refreshNotifications]);

  const markAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;

      if (refreshNotifications) {
        await refreshNotifications();
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleClearAllNotifications = async () => {
    if (!window.confirm('¿Marcar todas las notificaciones como leídas?')) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: markErr } = await supabase
        .from('notifications')
        .update({ read: true, read_at: nowIso, status: 'sent' })
        .eq('user_id', user.id)
        .eq('read', false);

      if (markErr) throw markErr;

      // Keep UX snappy while server refetches
      clearNotificationsLocal?.();

      if (refreshNotifications) {
        await refreshNotifications();
      }
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      alert('Error al marcar notificaciones como leídas.');
      await refreshNotifications?.();
    } finally {
      setLoading(false);
    }
  };

  const handleNotificationClick = async (notification) => {
    console.log('[NOTIFICATION_CLICK] START', { type: notification.type, data: notification.data });

    try {
      await markAsRead(notification.id);
    } catch (e) {
      console.error('[NOTIFICATION_CLICK] markAsRead error at start:', e);
    }

    try {
      onClose();
    } catch (e) {
      console.warn('[NOTIFICATION_CLICK] onClose threw:', e);
    }

    if (notification.type === 'survey_start') {
      const link = notification?.data?.link;
      const matchId = extractNotificationMatchId(notification);

      if (link) {
        safeNavigate(notification, link);
      } else if (matchId) {
        const url = `/encuesta/${matchId}`;
        safeNavigate(notification, url);
      } else {
        fallbackToNotificationRoute(notification, 'No encontramos la encuesta de esta notificación.');
      }
      return;
    }

    if (notification.type === 'call_to_vote') {
      const { matchCode, matchId } = notification.data || {};
      if (matchCode) {
        const url = `/votar-equipos?codigo=${matchCode}`;
        safeNavigate(notification, url);
        return;
      }
      if (matchId) {
        const url = `/votar-equipos?partidoId=${matchId}`;
        safeNavigate(notification, url);
        return;
      }
      fallbackToNotificationRoute(notification, 'No encontramos el partido para votar equipos.');
      return;
    }

    if (notification.type === 'match_invite') {
      const inviteRoute = resolveMatchInviteRoute(notification);
      if (inviteRoute) {
        safeNavigate(notification, inviteRoute);
      } else {
        fallbackToNotificationRoute(notification, 'No pudimos abrir la invitación.');
      }
      return;
    }

    if (notification.type === 'team_invite') {
      safeNavigate(notification, '/quiero-jugar');
      return;
    }

    if (notification.type === 'team_captain_transfer') {
      const teamId = notification?.data?.team_id || notification?.data?.teamId || null;
      safeNavigate(notification, teamId ? `/quiero-jugar/equipos/${teamId}` : '/quiero-jugar');
      return;
    }

    if (notification.type === 'match_join_request') {
      const matchId = notification?.partido_id ?? notification?.data?.match_id ?? notification?.data?.matchId;
      const link = notification?.data?.link || (matchId ? `/admin/${matchId}?tab=solicitudes` : null);
      safeNavigate(notification, link, {}, 'No encontramos la solicitud de ingreso de este partido.');
      return;
    }

    if (notification.type === 'match_join_approved') {
      const matchId = notification?.partido_id ?? notification?.data?.match_id ?? notification?.data?.matchId;
      const link = notification?.data?.link || (matchId ? `/partido-publico/${matchId}` : null);
      safeNavigate(notification, link, {}, 'No encontramos el partido de esta aprobación.');
      return;
    }

    if (notification.type === 'match_kicked') {
      console.info('Fuiste removido del partido');
      safeNavigate(notification, '/');
      return;
    }

    if (notification.type === 'survey_reminder') {
      try {
        await openNotification(notification, navigate);
      } catch (error) {
        console.error('[NOTIFICATION_CLICK] survey_reminder openNotification error', error);
      }
      const reminderMatchId = extractNotificationMatchId(notification);
      if (!reminderMatchId) {
        fallbackToNotificationRoute(notification, 'No encontramos la encuesta que te queríamos recordar.');
      }
      return;
    }

    if (notification.type === 'survey_results_ready' || notification.type === 'awards_ready' || notification.type === 'award_won') {
      try {
        const matchId = notification?.partido_id ?? notification?.data?.match_id ?? notification?.data?.matchId ?? null;
        if (!matchId) {
          fallbackToNotificationRoute(notification, 'No encontramos los resultados de esta notificación.');
          return;
        }
        const link = notification?.data?.resultsUrl || notification?.data?.link || `/resultados-encuesta/${matchId}?showAwards=1`;
        safeNavigate(notification, link, {
          state: {
            forceAwards: true,
            fromNotification: true,
            matchName: notification?.data?.match_name || notification?.data?.partido_nombre || null,
          },
        }, 'No encontramos la vista de resultados de este partido.');
      } catch (err) {
        console.error('[NOTIFICATION_CLICK] results/awards unexpected error:', err);
        fallbackToNotificationRoute(notification, 'No pudimos abrir los resultados de esta notificación.');
      }
      return;
    }

    if (notification.type === 'survey_finished') {
      const matchId = notification?.partido_id ?? notification?.data?.match_id ?? notification?.data?.matchId ?? notification?.match_ref ?? null;
      if (matchId) {
        const link = notification?.data?.resultsUrl || `/resultados-encuesta/${matchId}`;
        safeNavigate(notification, link);
      } else {
        fallbackToNotificationRoute(notification, 'No encontramos el resultado final de este partido.');
      }
      return;
    }

    fallbackToNotificationRoute(notification);
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'match_invite': return CalendarClock;
      case 'call_to_vote': return Vote;
      case 'survey_start': return ClipboardList;
      case 'survey_reminder': return ClipboardList;
      case 'survey_results_ready': return Trophy;
      case 'awards_ready': return Trophy;
      case 'survey_finished': return ClipboardList;
      case 'award_won': return Trophy;
      case 'friend_request': return UserPlus;
      case 'friend_accepted': return CheckCircle;
      case 'match_update': return Users;
      case 'team_invite': return Users;
      case 'team_captain_transfer': return Users;
      case 'match_cancelled': return XCircle;
      case 'match_join_request': return UserPlus;
      case 'match_join_approved': return CheckCircle;
      case 'match_kicked': return ShieldAlert;
      case 'no_show_penalty_applied': return ShieldAlert;
      case 'no_show_recovery_applied': return CheckCircle;
      default: return Bell;
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  };

  const fallbackToNotificationRoute = (notification, message = 'No encontramos ese destino. Te llevamos a tus partidos.') => {
    notifyBlockingError(message);
    const fallbackRoute = buildNotificationFallbackRoute(notification);
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
      console.error('[NOTIFICATIONS_MODAL] navigation error', { route, error });
      fallbackToNotificationRoute(notification, message);
      return false;
    }
  };

  const filteredNotifications = filterNotificationsByCategory(notifications, activeFilter);
  const hasAnyNotifications = notifications.length > 0;
  const hasVisibleNotifications = filteredNotifications.length > 0;

  if (!isOpen) {
    return null;
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/75 backdrop-blur-[2px] pt-[90px] px-4 pb-4 md:px-3 md:pt-[75px]"
      onClick={(e) => {
        if (loading) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1a1a1a] rounded-b-[20px] md:rounded-b-2xl w-full max-w-[500px] max-h-[calc(100vh-102px)] md:max-h-[calc(100vh-84px)] shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex flex-col relative overflow-hidden animate-[slideDownFromTop_0.3s_ease-out] mt-0">
        <style>
          {`
            @keyframes slideDownFromTop {
              0% { transform: translateY(-100%); opacity: 0; }
              100% { transform: translateY(0); opacity: 1; }
            }
          `}
        </style>

        <div className="w-10 h-1 bg-[#666] rounded-sm mx-auto mt-2 mb-3 shrink-0"></div>

        <div className="flex justify-between items-center px-5 pb-4 md:px-4 md:pb-3 border-b border-[#333] shrink-0">
          <h3 className="text-white text-xl md:text-lg font-semibold m-0">Notificaciones</h3>
          <div className="flex items-center gap-3">
            {notifications.length > 0 && (
              <button
                className={'bg-[#dc3545] border-none text-white text-sm font-medium cursor-pointer px-3 py-1.5 rounded-md transition-all flex items-center gap-2 hover:bg-[#c82333] disabled:opacity-60 disabled:cursor-not-allowed'}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleClearAllNotifications();
                }}
                disabled={loading || notifications.length === 0}
                title={loading ? 'Marcando notificaciones…' : 'Marcar todas como leídas'}
              >
                {loading ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent inline-block animate-spin"></span>
                    Marcando…
                  </>
                ) : (
                  'Marcar leídas'
                )}
              </button>
            )}
            <button
              className="bg-transparent border-none text-[#999] text-[28px] cursor-pointer p-0 w-8 h-8 flex items-center justify-center shrink-0 transition-colors rounded-full hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onClose}
              disabled={loading}
              title={loading ? 'Terminá de limpiar para cerrar' : 'Cerrar'}
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-0 overflow-y-auto flex-1 touch-pan-y">
          {!loading && hasAnyNotifications && (
            <div className="px-4 py-3 border-b border-[#2a2a2a] grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {NOTIFICATION_FILTER_OPTIONS.map((option) => {
                const isActive = activeFilter === option.key;
                const count = getCategoryCount(notifications, option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setActiveFilter(option.key)}
                    className={`w-full min-w-0 px-2.5 py-1.5 rounded-full border text-[11px] sm:w-auto sm:text-xs font-oswald transition-colors ${
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

          {loading ? (
            <div className="text-center text-[#999] py-[60px] px-5 text-base">
              <LoadingSpinner size="medium" />
            </div>
          ) : !hasAnyNotifications ? (
            <div className="px-4">
              <EmptyStateCard
                icon={Bell}
                title="SIN NOTIFICACIONES"
                titleClassName="font-oswald font-semibold text-[24px] leading-none tracking-[0.01em] text-white sm:text-[22px]"
                description="Te avisaremos cuando tengas novedades de partidos, encuestas o invitaciones."
                className="my-10"
              />
            </div>
          ) : !hasVisibleNotifications ? (
            <div className="px-4">
              <EmptyStateCard
                icon={Bell}
                title="SIN RESULTADOS EN ESTE FILTRO"
                titleClassName="font-oswald font-semibold text-[24px] leading-none tracking-[0.01em] text-white sm:text-[22px]"
                description="Probá con otro filtro para ver el resto de tus notificaciones."
                className="my-10"
              />
            </div>
          ) : (
            <div className="p-0">
              {filteredNotifications.map((notification) => {
                const clickable = ['match_invite', 'team_invite', 'team_captain_transfer', 'call_to_vote', 'survey_start', 'survey_reminder', 'survey_results_ready', 'awards_ready', 'survey_finished', 'award_won'].includes(notification.type);
                const Icon = getNotificationIcon(notification.type) || User;
                const isSurveyStartLike = notification.type === 'survey_start' || notification.type === 'post_match_survey';
                const isSurveyReminder = notification.type === 'survey_reminder';
                const isSurveyResults = notification.type === 'survey_results_ready';
                const isTeamInvite = notification.type === 'team_invite';
                const matchName = resolveNotificationMatchName(notification, 'este partido');
                const quotedMatchName = quoteMatchName(matchName, 'este partido');
                const displayTitle = isSurveyStartLike
                  ? '¡Encuesta lista!'
                  : isSurveyReminder
                    ? 'Recordatorio de encuesta'
                    : isSurveyResults
                      ? 'Resultados de encuesta listos'
                      : isTeamInvite
                        ? (notification.title || 'Invitacion de equipo')
                      : applyMatchNameQuotes(notification.title || 'Notificación', matchName);
                const displayMessage = isSurveyStartLike
                  ? getSurveyStartMessage({ source: notification, matchName: quotedMatchName })
                  : isSurveyReminder
                    ? getSurveyReminderMessage({ source: notification, matchName: quotedMatchName })
                    : isSurveyResults
                      ? getSurveyResultsReadyMessage({ matchName: quotedMatchName })
                      : isTeamInvite
                        ? formatTeamInviteMessage(notification)
                      : applyMatchNameQuotes(notification.message || '', matchName);

                const notificationContent = (
                  <>
                    <div className="text-xl w-8 h-8 bg-[#333] rounded-full flex items-center justify-center shrink-0 md:w-7 md:h-7 md:text-lg text-white/85">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-base font-semibold mb-1 leading-tight md:text-[15px]">{displayTitle}</div>
                      <div className="text-[#ccc] text-sm leading-snug mb-1.5 overflow-hidden line-clamp-2 md:text-[13px]">{displayMessage}</div>
                      <div className="text-[#666] text-xs font-medium">{formatDate(notification.created_at)}</div>
                    </div>
                    {!notification.read && <div className="w-2 h-2 bg-[#2196F3] rounded-full shrink-0 mt-1.5"></div>}
                  </>
                );

                return (
                  <div
                    key={`${notification.id}:${notification.created_at}`}
                    className={`block p-4 border-b border-[#2a2a2a] transition-all cursor-pointer md:py-[14px] md:px-4
                      ${!notification.read ? 'bg-[rgba(33,150,243,0.1)] border-l-[3px] border-l-[#2196F3]' : ''} 
                      ${clickable ? 'hover:bg-white/15 hover:scale-[1.01]' : 'active:bg-white/5'}
                    `}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNotificationClick(notification);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        handleNotificationClick(notification);
                      }
                    }}
                    style={{ cursor: clickable ? 'pointer' : 'default', display: 'flex', alignItems: 'flex-start', gap: '12px', width: '100%' }}
                  >
                    {notificationContent}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default NotificationsModal;
