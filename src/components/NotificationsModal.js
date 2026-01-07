import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, Link } from 'react-router-dom'; // [TEAM_BALANCER_INVITE_ACCESS_FIX] Para navegación
import { toast } from 'react-toastify';
import supabase, { deleteMyNotifications } from '../supabase';
import { toBigIntId } from '../utils';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { openNotification } from '../utils/notificationRouter';
import { useTimeout } from '../hooks/useTimeout';
import LoadingSpinner from './LoadingSpinner';
import './NotificationsModal.css';

const NotificationsModal = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { notifications, fetchNotifications: refreshNotifications, clearAllNotifications: clearNotificationsLocal } = useNotifications();
  const navigate = useNavigate(); // [TEAM_BALANCER_INVITE_ACCESS_FIX] Hook de navegación
  const { setTimeoutSafe } = useTimeout();
  const [loading, setLoading] = useState(false);



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
  }, [isOpen, user?.id]);

  const markAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;
      
      // Actualizar el contexto para refrescar el botón
      if (refreshNotifications) {
        await refreshNotifications();
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  // util local para esperar entre reintentos
  const sleep = (ms) => new Promise((resolve) => setTimeoutSafe(resolve, ms));

  const handleClearAllNotifications = async () => {
    if (!window.confirm('¿Eliminar todas las notificaciones?')) return;
    
    setLoading(true);
    try {
      // 1) Limpiar UI de forma optimista (vaciar modal sin cerrarlo)
      clearNotificationsLocal?.();

      // 2) Borrar en BD vía RPC (server-side, seguro) con 1 reintento
      let rpcError = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { error } = await deleteMyNotifications();
        if (!error) {
          rpcError = null;
          break;
        }
        rpcError = error;
        console.warn('[RPC delete_my_notifications] intento', attempt, 'error:', error);
        // Errores típicos de caché/404 → esperar y reintentar una vez
        const msg = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
        if (attempt === 1 && (msg.includes('schema cache') || msg.includes('pgrst202') || msg.includes('404'))) {
          await sleep(1200);
          continue;
        }
        // otros errores: salir del loop
        break;
      }

      // 2b) Fallback seguro: delete directo con RLS si el RPC siguió fallando
      if (rpcError) {
        console.warn('[RPC delete_my_notifications] fallback a delete directo por RLS');
        const { error: delErr } = await supabase
          .from('notifications')
          .delete()
          .eq('user_id', user.id);
        if (delErr) {
          console.error('[DELETE notifications fallback] Error:', delErr);
          throw delErr;
        }
      }

      // 3) Revalidar contra BD (por si entraron nuevas en el medio)
      if (refreshNotifications) {
        await refreshNotifications();
      }
    } catch (error) {
      console.error('Error clearing notifications:', error);
      alert('Error al eliminar las notificaciones.');
      // Si falló el delete, revalidar para mostrar lo real
      await refreshNotifications?.();
    } finally {
      setLoading(false);
    }
  };
  
  const handleNotificationClick = async (notification) => {
    console.log('[NOTIFICATION_CLICK] START', { type: notification.type, data: notification.data });
    
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    
    onClose();
    
    // Handle survey_start notifications
    if (notification.type === 'survey_start') {
      const link = notification?.data?.link;
      const matchId = notification?.data?.match_id;
      console.debug('[NOTIF] click', { id: notification?.id, type: notification?.type, link, matchId });
      
      if (link) {
        console.debug('[NOTIFICATION_NAVIGATE]', { to: link });
        navigate(link);
        setTimeout(() => {
          window.history.pushState({}, '', link);
        }, 0);
      } else if (matchId) {
        const url = `/encuesta/${matchId}`;
        console.debug('[NOTIFICATION_NAVIGATE]', { to: url });
        navigate(url);
        setTimeout(() => {
          window.history.pushState({}, '', url);
        }, 0);
      } else {
        console.error('survey_start sin link ni matchId', notification);
      }
      return;
    }
    
    // Si es llamada a votar, redirigir a la voting view
    if (notification.type === 'call_to_vote') {
      const { matchCode } = notification.data || {};
      console.log('[NOTIFICATION_CLICK] call_to_vote detected', { matchCode, fullData: notification.data });
      if (!matchCode) {
        console.error('[NOTIFICATION_CLICK] Missing matchCode!');
        toast.error('Falta matchCode');
        return;
      }
      const url = `/?codigo=${matchCode}`;
      console.log('[NOTIFICATION_CLICK] Navigating to:', url);
      window.location.assign(url);
      return;
    }
    
    // Si es invitación a partido, redirigir al AdminPanel
    if (notification.type === 'match_invite') {
      if (notification.data?.matchId) {
        navigate(`/admin/${notification.data.matchId}`);
      }
      return;
    }

    // Handle survey notifications
    if (notification.type === 'survey_reminder' || notification.type === 'survey_results_ready') {
      await openNotification(notification, navigate);
      return;
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'match_invite': return '⚽';
      case 'call_to_vote': return '⭐';
      case 'survey_start': return '📋';
      case 'survey_reminder': return '📋';
      case 'survey_results_ready': return '🏆';
      case 'friend_request': return '👤';
      case 'friend_accepted': return '✅';
      case 'match_update': return '📅';
      case 'match_cancelled': return '❌';
      default: return '🔔';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  };

  if (!isOpen) {
    return null;
  }

  const modalContent = (
    <div
      className="sheet-overlay"
      onClick={(e) => {
        if (loading) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-container">
        <div className="sheet-handle"></div>
        <div className="sheet-header">
          <h3>Notificaciones</h3>
          <div className="sheet-header-actions">
            {notifications.length > 0 && (
              <button 
                className={`clear-notifications-btn${loading ? ' is-loading' : ''}`} 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleClearAllNotifications();
                }}
                disabled={loading || notifications.length === 0}
                aria-busy={loading ? 'true' : 'false'}
                aria-disabled={(loading || notifications.length === 0) ? 'true' : 'false'}
                title={loading ? 'Limpiando tus notificaciones…' : 'Eliminar todas las notificaciones'}
              >
                {loading ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true"></span>
                    Limpiando…
                  </>
                ) : (
                  'Limpiar'
                )}
              </button>
            )}
            <button
              className="sheet-close"
              onClick={onClose}
              disabled={loading}
              aria-disabled={loading ? 'true' : 'false'}
              title={loading ? 'Terminá de limpiar para cerrar' : 'Cerrar'}
            >
              ×
            </button>
          </div>
        </div>
        <div className="sheet-body">
          {loading ? (
            <div className="loading-state">
              <LoadingSpinner size="medium" />

            </div>
          ) : notifications.length === 0 ? (
            <div className="sin-notificaciones">
              <div className="empty-icon">🔔</div>
              <p>No tienes notificaciones</p>
              <span>Te avisaremos cuando tengas algo nuevo</span>
            </div>
          ) : (
            <div className="notifications-list">
              {notifications.map((notification) => {
                const to = notification?.data?.link || (notification?.data?.match_id ? `/encuesta/${notification.data.match_id}` : null);
                const isSurveyStart = notification.type === 'survey_start' && to;
                
                const notificationContent = (
                  <>
                    <div className="notification-icon">{getNotificationIcon(notification.type)}</div>
                    <div className="notification-content">
                      <div className="notification-title">{notification.title}</div>
                      <div className="notification-message">{notification.message}</div>
                      <div className="notification-time">{formatDate(notification.created_at)}</div>
                    </div>
                    {!notification.read && <div className="notification-unread-dot"></div>}
                  </>
                );
                
                return (
                  <div
                    key={notification.id}
                    className={`notification-item${!notification.read ? ' unread' : ''} ${(notification.type === 'match_invite' || notification.type === 'call_to_vote' || notification.type === 'survey_start' || notification.type === 'survey_reminder' || notification.type === 'survey_results_ready') ? 'clickable' : ''}`}
                  >
                    {isSurveyStart ? (
                      <Link
                        to={to}
                        onClick={async (e) => {
                          e.stopPropagation();
                          
                          // Mark notification as read before navigating
                          const matchId = notification?.data?.match_id;
                          if (user?.id && matchId) {
                            try {
                              await supabase
                                .from('notifications')
                                .update({ read: true, read_at: new Date().toISOString() })
                                .eq('user_id', user.id)
                                .eq('type', 'survey_start')
                                .contains('data', { match_id: String(matchId) });
                            } catch (error) {
                              console.error('[MARK_NOTIF_READ] Error:', error);
                            }
                          }
                          
                          onClose();
                        }}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', textDecoration: 'none', color: 'inherit', width: '100%' }}
                      >
                        {notificationContent}
                      </Link>
                    ) : (
                      <div
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
                        style={{ cursor: (notification.type === 'match_invite' || notification.type === 'call_to_vote' || notification.type === 'survey_reminder' || notification.type === 'survey_results_ready') ? 'pointer' : 'default', display: 'flex', alignItems: 'flex-start', gap: '12px', width: '100%' }}
                      >
                        {notificationContent}
                      </div>
                    )}
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