import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import './InviteFriendModal.css';

const InviteFriendModal = ({ isOpen, onClose, friend, currentUserId }) => {
  const [matches, setMatches] = useState([]);
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
      fetchUserMatches();
    }
    // eslint-disable-next-line
  }, [isOpen, currentUserId]);

  const fetchUserMatches = async () => {
    setLoading(true);
    try {
      console.log('[INVITE_MODAL] Fetching matches for user:', currentUserId);
      
      // 1. SELECT partidos futuros con campos requeridos
      const { data: partidosData, error: partidosError } = await supabase
        .from('partidos')
        .select('id, nombre, fecha, hora, sede, modalidad, cupo_jugadores, tipo_partido, creado_por')
        .gte('fecha', new Date().toISOString().split('T')[0]) // 4. Filtrar por fecha >= hoy
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true });

      if (partidosError) throw partidosError;
      console.log('[INVITE_MODAL] Partidos fetched:', partidosData.length);

      if (partidosData.length === 0) {
        setMatches([]);
        return;
      }

      // 2. SELECT jugadores para esos partidos usando partido_id
      const partidoIds = partidosData.map((p) => p.id);
      console.log('[INVITE_MODAL] Fetching jugadores for partido IDs:', {
        count: partidoIds.length,
        sampleIds: partidoIds.slice(0, 3),
      });
      
      const { data: jugadoresData, error: jugadoresError } = await supabase
        .from('jugadores')
        .select('id, partido_id, usuario_id, nombre, avatar_url')
        .in('partido_id', partidoIds);

      if (jugadoresError) {
        console.error('[INVITE_MODAL] Error fetching jugadores:', jugadoresError);
        throw jugadoresError;
      }
      
      console.log('[INVITE_MODAL] Jugadores fetched:', {
        total: jugadoresData.length,
        byPartido: jugadoresData.reduce((acc, j) => {
          acc[j.partido_id] = (acc[j.partido_id] || 0) + 1;
          return acc;
        }, {}),
        sampleData: jugadoresData.slice(0, 3).map((j) => ({
          id: j.id,
          partido_id: j.partido_id,
          usuario_id: j.usuario_id,
          nombre: j.nombre,
        })),
      });

      // 3. Combinar datos usando partido_id
      const partidosConJugadores = partidosData.map((partido) => {
        const jugadoresDelPartido = jugadoresData.filter((j) => j.partido_id === partido.id);
        
        console.log(`[INVITE_MODAL] Partido ${partido.id} has ${jugadoresDelPartido.length} jugadores`);
        
        return {
          ...partido,
          // Asegurar que nombre del partido esté presente
          nombre: partido.nombre || `Partido ${new Date(partido.fecha).toLocaleDateString()}`,
          jugadores: jugadoresDelPartido,
        };
      });

      // 4. Incluir partido si usuario está en jugadores O es creador
      const userMatches = partidosConJugadores.filter((match) => {
        const isCreator = match.creado_por === currentUserId;
        const isPlayer = match.jugadores.some((jugador) => jugador.usuario_id === currentUserId);
        const result = isCreator || isPlayer;
        
        console.log(`[INVITE_MODAL] Match ${match.id} (${match.nombre}):`, {
          isCreator,
          isPlayer,
          included: result,
          jugadoresCount: match.jugadores.length,
          jugadoresIds: match.jugadores.map((j) => j.usuario_id),
        });
        
        return result;
      });
      
      console.log('[INVITE_MODAL] User matches found:', {
        total: userMatches.length,
        matches: userMatches.map((m) => ({ id: m.id, nombre: m.nombre, jugadores: m.jugadores.length })),
      });

      // Verificar si el amigo ya está invitado o participa en cada partido
      const matchesWithStatus = await Promise.all(
        userMatches.map(async (match) => {
          // Verificar si ya está en el partido
          const isParticipating = match.jugadores.some(
            (jugador) => jugador.usuario_id === friend.profile?.id,
          );

          // Verificar si ya tiene una invitación pendiente
          const { data: notifications } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', friend.profile?.id)
            .eq('type', 'match_invite')
            .eq('read', false)
            .contains('data', { matchId: match.id });

          const hasInvitation = notifications && notifications.length > 0;

          return {
            ...match,
            isParticipating,
            hasInvitation,
            canInvite: !isParticipating && !hasInvitation,
          };
        }),
      );

      setMatches(matchesWithStatus);
      console.log('[INVITE_MODAL] Final matches with status:', {
        total: matchesWithStatus.length,
        matches: matchesWithStatus.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          canInvite: m.canInvite,
          isParticipating: m.isParticipating,
          hasInvitation: m.hasInvitation,
        })),
      });
    } catch (error) {
      console.error('[INVITE_MODAL] Error fetching matches:', error);
      toast.error('Error al cargar los partidos');
    } finally {
      setLoading(false);
    }
  };

  const sendInvitation = async (match) => {
    setInviting(true);
    try {
      console.log('[SEND_INVITATION] Starting invitation process:', {
        matchId: match.id,
        matchName: match.nombre,
        friendId: friend.profile?.id,
        friendName: friend.profile?.nombre,
        currentUserId,
      });
      
      // Obtener información del usuario actual
      const { data: currentUser, error: userError } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', currentUserId)
        .single();
        
      if (userError) {
        console.error('[SEND_INVITATION] Error fetching current user:', userError);
        throw new Error('No se pudo obtener información del usuario');
      }
      
      console.log('[SEND_INVITATION] Current user fetched:', {
        userId: currentUserId,
        userName: currentUser?.nombre,
      });
      
      // Preparar datos de la notificación
      const notificationData = {
        user_id: friend.profile.id, // DESTINATARIO: ID del amigo (NO el tuyo)
        type: 'match_invite',
        title: 'Invitación a partido',
        message: `${currentUser?.nombre || 'Alguien'} te invitó a jugar "${match.nombre || 'un partido'}" el ${new Date(match.fecha).toLocaleDateString()} a las ${match.hora}`,
        data: {
          matchId: match.id,
          matchName: match.nombre,
          matchDate: match.fecha,
          matchTime: match.hora,
          matchLocation: match.sede,
          inviterId: currentUserId,
          inviterName: currentUser?.nombre || 'Alguien',
        },
        read: false,
      };
      
      console.log('[SEND_INVITATION] Creating notification with data:', notificationData);

      // Crear notificación de invitación
      const { data: insertedNotification, error } = await supabase
        .from('notifications')
        .insert([notificationData])
        .select()
        .single();

      if (error) {
        console.error('[SEND_INVITATION] Error creating notification:', {
          error,
          code: error.code,
          message: error.message,
          details: error.details,
          notificationData,
        });
        throw error;
      }
      
      console.log('[SEND_INVITATION] Notification created successfully:', {
        notificationId: insertedNotification?.id,
        recipientId: insertedNotification?.user_id,
        type: insertedNotification?.type,
      });

      toast.success(`Invitación enviada a ${friend.profile?.nombre}`);
      onClose();

      // Actualizar el estado local para reflejar la invitación enviada
      setMatches((prev) =>
        prev.map((m) =>
          m.id === match.id
            ? { ...m, hasInvitation: true, canInvite: false }
            : m,
        ),
      );
    } catch (error) {
      console.error('[SEND_INVITATION] Error sending invitation:', {
        error,
        message: error.message,
        stack: error.stack,
      });
      toast.error('Error al enviar la invitación');
    } finally {
      setInviting(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  const getMatchStatus = (match) => {
    if (match.isParticipating) return { text: 'Ya participa', color: '#4CAF50' };
    if (match.hasInvitation) return { text: 'Ya invitado', color: '#FF9800' };
    return { text: 'Disponible', color: '#2196F3' };
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-container" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle"></div>
        
        <div className="sheet-header">
          <h3>Invitar a {friend.profile?.nombre}</h3>
          <button className="sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="sheet-body">
          {loading ? (
            <div className="loading-state">
              <LoadingSpinner size="medium" />
              <p>Cargando partidos...</p>
            </div>
          ) : matches.length === 0 ? (
            <div className="sin-partidos">
              <p>No tienes partidos próximos donde puedas invitar amigos.</p>
              <p>Crea un partido o únete a uno para poder invitar amigos.</p>
            </div>
          ) : (
            <div className="matches-list">
              {matches.map((match) => {
                const status = getMatchStatus(match);
                return (
                  <div key={match.id} className="match-item">
                    <div className="match-info">
                      <div className="match-name">{match.nombre || `Partido ${formatDate(match.fecha)}`}</div>
                      <div className="match-details">
                        <span className="match-date">{formatDate(match.fecha)}</span>
                        <span className="match-time">{match.hora}</span>
                        <span className="match-location">{match.sede}</span>
                      </div>
                      <div className="match-meta">
                        <span className="match-mode">{match.modalidad}</span>
                        <span className="match-players">
                          {match.jugadores.length}/{match.cupo_jugadores} jugadores
                        </span>
                      </div>
                    </div>

                    <div className="match-actions">
                      <div
                        className="match-status"
                        style={{ color: status.color }}
                      >
                        {status.text}
                      </div>

                      {match.canInvite && (
                        <button
                          className="invite-btn"
                          onClick={() => sendInvitation(match)}
                          disabled={inviting}
                        >
                          {inviting ? 'Enviando...' : 'Invitar'}
                        </button>
                      )}
                    </div>
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

export default InviteFriendModal;
