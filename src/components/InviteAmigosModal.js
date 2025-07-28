import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { getAmigos, supabase } from '../supabase';
import { toast } from 'react-toastify';
import './InviteAmigosModal.css';

const InviteAmigosModal = ({ isOpen, onClose, currentUserId, partidoActual }) => {
  // ESTADO LOCAL INDEPENDIENTE - Solo para amigos
  const [amigos, setAmigos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);

  // Bloquear scroll del body cuando el modal está abierto
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
    if (isOpen && currentUserId) {
      fetchAmigos();
    }
  }, [isOpen, currentUserId]);

  const fetchAmigos = async () => {
    setLoading(true);
    try {
      console.log('[MODAL_AMIGOS] === FETCHING ONLY FRIENDS ===');
      console.log('[MODAL_AMIGOS] User ID:', currentUserId);
      
      // SOLO AMIGOS - getAmigos devuelve array de usuarios directos
      const friendsData = await getAmigos(currentUserId);
      
      console.log('[MODAL_AMIGOS] Friends data received:', {
        isArray: Array.isArray(friendsData),
        count: friendsData?.length || 0,
        sample: friendsData?.slice(0, 2).map((f) => ({ 
          id: f.id, 
          nombre: f.nombre,
          avatar_url: f.avatar_url, 
        })) || [],
      });
      console.log('[MODAL_AMIGOS] Current user (sender):', currentUserId);
      
      setAmigos(friendsData || []);
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error fetching friends:', error);
      setAmigos([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInvitar = async (amigo) => {
    if (!partidoActual?.id) {
      toast.error('No hay partido seleccionado');
      return;
    }

    setInviting(true);
    try {
      console.log('[MODAL_AMIGOS] === STARTING INVITATION PROCESS ===');
      console.log('[MODAL_AMIGOS] Sender (currentUserId):', currentUserId);
      console.log('[MODAL_AMIGOS] Recipient (amigo):', {
        id: amigo.id,
        nombre: amigo.nombre,
      });
      console.log('[MODAL_AMIGOS] Match:', {
        id: partidoActual.id,
        nombre: partidoActual.nombre,
      });

      const { data: currentUser, error: userError } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', currentUserId)
        .single();

      if (userError) {
        console.error('[MODAL_AMIGOS] Error fetching current user:', userError);
        throw new Error(`Error obteniendo datos del usuario: ${userError.message}`);
      }

      console.log('[MODAL_AMIGOS] Current user data:', currentUser);

      // VALIDACIÓN DE DATOS ANTES DEL INSERT
      console.log('[MODAL_AMIGOS] === VALIDATING DATA ===');
      console.log('[MODAL_AMIGOS] amigo.id (user_id):', amigo.id, 'type:', typeof amigo.id);
      console.log('[MODAL_AMIGOS] currentUserId:', currentUserId, 'type:', typeof currentUserId);
      console.log('[MODAL_AMIGOS] partidoActual.id:', partidoActual.id, 'type:', typeof partidoActual.id);
      
      // Validar que user_id sea un UUID válido
      if (!amigo.id || typeof amigo.id !== 'string' || amigo.id.length !== 36) {
        throw new Error(`user_id inválido: ${amigo.id}`);
      }
      
      // Validar que currentUserId sea un UUID válido
      if (!currentUserId || typeof currentUserId !== 'string' || currentUserId.length !== 36) {
        throw new Error(`currentUserId inválido: ${currentUserId}`);
      }

      const notificationData = {
        user_id: amigo.id, // DESTINATARIO - UUID string
        type: 'match_invite',
        title: 'Invitación a partido',
        message: `${currentUser?.nombre || 'Alguien'} te invitó a jugar "${partidoActual.nombre || 'un partido'}"`,
        data: {
          matchId: partidoActual.id,
          matchName: partidoActual.nombre || null,
          matchDate: partidoActual.fecha || null,
          matchTime: partidoActual.hora || null,
          matchLocation: partidoActual.sede || null,
          inviterId: currentUserId,
          inviterName: currentUser?.nombre || 'Alguien',
        },
        read: false,
      };

      console.log('[MODAL_AMIGOS] === INSERTING NOTIFICATION ===');
      console.log('[MODAL_AMIGOS] Notification data to insert:', {
        user_id: notificationData.user_id,
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        read: notificationData.read,
      });

      const { data: insertedNotification, error } = await supabase
        .from('notifications')
        .insert([notificationData])
        .select()
        .single();

      if (error) {
        console.error('[MODAL_AMIGOS] === INSERT ERROR ===');
        console.error('[MODAL_AMIGOS] Error code:', error.code);
        console.error('[MODAL_AMIGOS] Error message:', error.message);
        console.error('[MODAL_AMIGOS] Error details:', error.details);
        console.error('[MODAL_AMIGOS] Error hint:', error.hint);
        console.error('[MODAL_AMIGOS] Full error object:', error);
        console.error('[MODAL_AMIGOS] Data that failed to insert:', notificationData);
        
        // Análisis específico de errores comunes
        if (error.code === '42501') {
          console.error('[MODAL_AMIGOS] 🚨 RLS POLICY ERROR - No tienes permisos para insertar');
          throw new Error('Error de permisos: No se puede crear la notificación. Revisar políticas RLS.');
        } else if (error.code === '23502') {
          console.error('[MODAL_AMIGOS] 🚨 NULL CONSTRAINT ERROR - Campo requerido es null');
          throw new Error('Error de datos: Campo requerido faltante en la notificación.');
        } else if (error.code === '23503') {
          console.error('[MODAL_AMIGOS] 🚨 FOREIGN KEY ERROR - user_id no existe');
          throw new Error('Error de referencia: El usuario destinatario no existe.');
        } else if (error.code === '22P02') {
          console.error('[MODAL_AMIGOS] 🚨 INVALID UUID ERROR - user_id no es un UUID válido');
          throw new Error('Error de formato: ID de usuario inválido.');
        } else {
          console.error('[MODAL_AMIGOS] 🚨 UNKNOWN ERROR');
          throw new Error(`Error desconocido al crear notificación: ${error.message}`);
        }
      }

      console.log('[MODAL_AMIGOS] === NOTIFICATION INSERTED SUCCESSFULLY ===');
      console.log('[MODAL_AMIGOS] Inserted notification:', {
        id: insertedNotification.id,
        user_id: insertedNotification.user_id,
        type: insertedNotification.type,
        created_at: insertedNotification.created_at,
      });
      console.log('[MODAL_AMIGOS] Recipient should receive realtime notification for user_id:', insertedNotification.user_id);

      toast.success(`Invitación enviada a ${amigo.nombre}`);
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending invitation:', error);
      toast.error('Error al enviar la invitación');
    } finally {
      setInviting(false);
    }
  };

  // NO RENDERIZAR SI NO ESTÁ ABIERTO
  if (!isOpen) return null;

  const modalContent = (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-container" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle"></div>
        
        <div className="sheet-header">
          <h3>Invitar amigos</h3>
          <button className="sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="sheet-body">
          {loading ? (
            <div className="loading-state">Cargando amigos...</div>
          ) : amigos.length > 0 ? (
            <ul className="amigos-list">
              {amigos.map((amigo) => (
                <li key={amigo.id} className="amigo-item">
                  <img 
                    src={amigo.avatar_url || '/profile.svg'} 
                    alt={amigo.nombre || 'Usuario'} 
                    className="amigo-avatar"
                    onError={(e) => { e.target.src = '/profile.svg'; }}
                  />
                  <span className="amigo-nombre">
                    {amigo.nombre || 'Usuario'}
                  </span>
                  <button 
                    onClick={() => handleInvitar(amigo)}
                    className="invitar-btn"
                    disabled={inviting}
                  >
                    {inviting ? '...' : 'Invitar'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sin-amigos">
              No tenés amigos para invitar
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default InviteAmigosModal;