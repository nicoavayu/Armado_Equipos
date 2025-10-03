import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom'; // [TEAM_BALANCER_INVITE_ACCESS_FIX] Para navegación
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
  
  // [TEAM_BALANCER_INVITE_ACCESS_FIX] Manejar click en notificaciones de invitación
  const handleNotificationClick = async (notification) => {
    console.log('[NOTIFICATION_CLICK] Clicked notification:', notification);
    console.log('[NOTIFICATION_CLICK] Notification data:', notification.data);
    
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    
    // Si es invitación a partido, redirigir al AdminPanel
    if (notification.type === 'match_invite' && notification.data?.matchId) {
      console.log('[NOTIFICATION_CLICK] Match invite clicked, matchId:', notification.data.matchId);
      onClose(); // Cerrar modal
      
      // Redirigir usando el código del partido
      try {
        const { data: partido, error } = await supabase
          .from('partidos')
          .select('codigo')
          .eq('id', toBigIntId(notification.data.matchId))
          .single();
          
        console.log('[NOTIFICATION_CLICK] Match query result:', { partido, error });
          
        if (error) throw error;
        
        if (partido?.codigo) {
          console.log('[NOTIFICATION_CLICK] Navigating to admin panel for match:', notification.data.matchId);
          // Navegar directamente al AdminPanel usando el ID del partido
          navigate(`/admin/${notification.data.matchId}`);
        }
      } catch (error) {
        console.error('[NOTIFICATION_CLICK] Error redirecting to match:', error);
      }
    }
    
    // Si es llamada a votar, redirigir a la voting view
    if (notification.type === 'call_to_vote') {
      console.log('[NOTIFICATION_CLICK] Call to vote clicked');
      onClose(); // Cerrar modal
      
      if (notification.data?.matchCode) {
        console.log('[NOTIFICATION_CLICK] Navigating to voting view with code:', notification.data.matchCode);
        navigate(`/?codigo=${notification.data.matchCode}`);
      } else {
        console.log('[NOTIFICATION_CLICK] No matchCode found in call_to_vote notification');
        console.log('[NOTIFICATION_CLICK] Available data keys:', Object.keys(notification.data || {}));
      }
    }

    // Handle survey_reminder and survey_results_ready with router
    if (notification.type === 'survey_reminder' || notification.type === 'survey_results_ready') {
      console.log('[NOTIFICATION_CLICK] Survey notification clicked:', notification.type);
      onClose(); // Close modal before navigation
      await openNotification(notification, navigate);
      return;
    }
    
    // Resultados de encuesta listos → navegar a resultados/premios (fallback)
    if (notification.type === 'survey_results_ready') {
      console.log('[NOTIFICATION_CLICK] Survey results ready clicked');
      console.log('[NOTIFICATION_CLICK] Full notification object:', notification);
      console.log('[NOTIFICATION_CLICK] Notification data:', notification.data);
      onClose(); // cerrar modal para navegar

      const data = notification.data || {};
      // 1) resultsUrl directo
      if (data.resultsUrl) {
        console.log('[NOTIFICATION_CLICK] Navigating to resultsUrl:', data.resultsUrl);
        navigate(data.resultsUrl);
        return;
      }
      // 2) matchId numérico → /resultados/:id
      if (data.matchId != null) {
        const id = toBigIntId(data.matchId);
        if (id != null) {
          console.log('[NOTIFICATION_CLICK] Navigating to resultados by matchId:', id);
          navigate(`/resultados/${id}?showAwards=1`);
          return;
        }
      }
      // 3) Fallback por código
      if (data.matchCode) {
        console.log('[NOTIFICATION_CLICK] Navigating to resultados by matchCode:', data.matchCode);
        navigate(`/?codigo=${data.matchCode}&view=resultados&showAwards=1`);
        return;
      }
      console.warn('[NOTIFICATION_CLICK] Missing resultsUrl/matchId/matchCode for survey_results_ready');
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'match_invite': return '⚽';
      case 'call_to_vote': return '⭐';
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
        // Evitar cerrar mientras está limpiando
        if (loading) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClose();
      }}
    >
      <div className="sheet-container" onClick={(e) => e.stopPropagation()}>
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
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-item${!notification.read ? ' unread' : ''} ${(notification.type === 'match_invite' || notification.type === 'call_to_vote' || notification.type === 'survey_reminder' || notification.type === 'survey_results_ready') ? 'clickable' : ''}`}
                  onClick={() => handleNotificationClick(notification)}
                  style={{ cursor: (notification.type === 'match_invite' || notification.type === 'call_to_vote' || notification.type === 'survey_reminder' || notification.type === 'survey_results_ready') ? 'pointer' : 'default' }}
                >
                  <div className="notification-icon">{getNotificationIcon(notification.type)}</div>
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-time">{formatDate(notification.created_at)}</div>
                  </div>
                  {!notification.read && <div className="notification-unread-dot"></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default NotificationsModal;