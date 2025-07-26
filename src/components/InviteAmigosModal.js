import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { getAmigos } from '../supabase';
import { supabase } from '../supabase';
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
          avatar_url: f.avatar_url 
        })) || [],
      });
      
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
      console.log('[MODAL_AMIGOS] Inviting friend:', {
        friendId: amigo.id,
        friendName: amigo.nombre,
        matchId: partidoActual.id,
      });

      const { data: currentUser } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', currentUserId)
        .single();

      const notificationData = {
        user_id: amigo.id,
        type: 'match_invite',
        title: 'Invitación a partido',
        message: `${currentUser?.nombre || 'Alguien'} te invitó a jugar "${partidoActual.nombre || 'un partido'}"`,
        data: {
          matchId: partidoActual.id,
          matchName: partidoActual.nombre,
          matchDate: partidoActual.fecha,
          matchTime: partidoActual.hora,
          matchLocation: partidoActual.sede,
          inviterId: currentUserId,
          inviterName: currentUser?.nombre || 'Alguien',
        },
        read: false,
      };

      const { error } = await supabase
        .from('notifications')
        .insert([notificationData]);

      if (error) throw error;

      toast.success(`Invitación enviada a ${amigo.nombre}`);
      console.log('[MODAL_AMIGOS] Invitation sent successfully');
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