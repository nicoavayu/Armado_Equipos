import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { getAmigos, supabase } from '../supabase';
import LoadingSpinner from './LoadingSpinner';
import { formatLocalDateShort } from '../utils/dateLocal';
import InlineNotice from './ui/InlineNotice';
import useInlineNotice from '../hooks/useInlineNotice';
import { notifyBlockingError } from 'utils/notifyBlockingError';


const InviteAmigosModal = ({ isOpen, onClose, currentUserId, partidoActual, jugadores = [] }) => {
  // ESTADO LOCAL INDEPENDIENTE - Solo para amigos
  const [amigos, setAmigos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invitedFriends, setInvitedFriends] = useState(new Set());
  const { notice, showInlineNotice, clearInlineNotice } = useInlineNotice();

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
      // SOLO AMIGOS - getAmigos devuelve array de usuarios directos
      const friendsData = await getAmigos(currentUserId);

      // FILTRAR AMIGOS:
      // 1. No mostrar al organizador
      // 2. No mostrar jugadores que YA están en el partido
      const filteredFriends = (friendsData || []).filter((friend) => {
        // Excluir organizador
        if (friend.id === partidoActual?.creado_por) return false;

        // Excluir jugadores ya unidos (comparar IDs)
        const isAlreadyInMatch = jugadores.some((p) =>
          p.usuario_id === friend.id || p.uuid === friend.id,
        );
        if (isAlreadyInMatch) return false;

        return true;
      });

      setAmigos(filteredFriends);

      // Verificar qué amigos ya fueron invitados a este partido
      if (partidoActual?.id && filteredFriends.length > 0) {
        // Validate partidoActual.id to prevent 400 errors
        if (partidoActual.id === 'undefined' || partidoActual.id === 'null') {
          console.warn('[MODAL_AMIGOS] Invalid partidoActual.id, skipping invitation check');
        } else {
          console.log('[MODAL_AMIGOS] Checking existing invitations for match:', partidoActual.id);
          const friendIds = filteredFriends.map((f) => f.id);
          let existingInvitations = null;

          const { data: extData, error: extError } = await supabase
            .from('notifications_ext')
            .select('user_id')
            .eq('type', 'match_invite')
            .eq('match_id_text', partidoActual.id.toString())
            .eq('read', false) // Only count UNREAD (pending) invitations
            .in('user_id', friendIds);

          if (extError && extError.code === '42P01') {
            console.warn('[MODAL_AMIGOS] notifications_ext not available for initial check, skipping');
            existingInvitations = [];
          } else {
            existingInvitations = extData;
          }

          if (existingInvitations) {
            const invitedIds = new Set(existingInvitations.map((inv) => inv.user_id));
            setInvitedFriends(invitedIds);
          }
        }
      }
      // Verify existing invitations via supabase directly if needed or rely on notifications_ext

    } catch (error) {
      console.error('[MODAL_AMIGOS] Error fetching friends:', error);
      setAmigos([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInvitar = async (amigo) => {
    if (!partidoActual?.id) {
      showInlineNotice({
        key: 'invite_friends_missing_match',
        type: 'warning',
        message: 'No hay partido seleccionado.',
      });
      return;
    }

    // Validar cupo lleno antes de enviar
    const starterCapacity = Number(partidoActual?.cupo_jugadores || 0);
    const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 2 : 0;
    if (maxRosterSlots > 0 && jugadores.length >= maxRosterSlots) {
      showInlineNotice({
        key: 'invite_friends_match_full',
        type: 'warning',
        message: 'El partido ya está completo. No se pueden enviar más invitaciones.',
      });
      return;
    }

    setInviting(true);
    try {
      console.log('[MODAL_AMIGOS] === STARTING INVITATION PROCESS ===');

      // Verificar autenticación
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      console.log('[MODAL_AMIGOS] Auth check:', { user: user?.id, authError });

      if (authError || !user) {
        throw new Error('Usuario no autenticado');
      }

      console.log('[MODAL_AMIGOS] Sender (currentUserId):', currentUserId);
      console.log('[MODAL_AMIGOS] Authenticated user:', user.id);
      console.log('[MODAL_AMIGOS] Recipient (amigo):', {
        id: amigo.id,
        nombre: amigo.nombre,
      });
      console.log('[MODAL_AMIGOS] Match:', {
        id: partidoActual.id,
        nombre: partidoActual.nombre,
      });

      // Verificar si ya existe una invitación para este amigo en este partido
      let existingInvitation = null;
      let checkError = null;

      // Validate partidoActual.id before query
      if (!partidoActual.id || partidoActual.id === 'undefined' || partidoActual.id === 'null') {
        console.warn('[MODAL_AMIGOS] Invalid partidoActual.id, skipping duplicate check');
        existingInvitation = null;
        checkError = null;
      } else {
        console.log('[MODAL_AMIGOS] Checking existing invitation for:', { amigoId: amigo.id, matchId: partidoActual.id });

        // Try notifications_ext first
        const { data: extData, error: extError } = await supabase
          .from('notifications_ext')
          .select('id')
          .eq('user_id', amigo.id)
          .eq('type', 'match_invite')
          .eq('match_id_text', partidoActual.id.toString())
          .eq('read', false) // Only block if UNREAD
          .single();

        if (extError && extError.code === '42P01') {
          // View doesn't exist, skip duplicate check and allow invitation
          console.warn('[MODAL_AMIGOS] notifications_ext not available, skipping duplicate check');
          existingInvitation = null;
          checkError = null;
        } else {
          existingInvitation = extData;
          checkError = extError;
        }
      }

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('[MODAL_AMIGOS] Error checking existing invitation:', checkError);
        throw new Error('Error verificando invitaciones existentes');
      }

      if (existingInvitation) {
        console.info(`${amigo.nombre} ya fue invitado a este partido`);
        return;
      }

      const { data: recipientUser, error: recipientError } = await supabase
        .from('usuarios')
        .select('acepta_invitaciones')
        .eq('id', amigo.id)
        .maybeSingle();

      if (recipientError) {
        console.error('[MODAL_AMIGOS] Error fetching recipient availability:', recipientError);
        throw new Error(`Error validando disponibilidad del destinatario: ${recipientError.message}`);
      }

      if (recipientUser?.acepta_invitaciones === false) {
        console.info(`${amigo.nombre} está en no disponible y no recibe invitaciones.`);
        return;
      }

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
      // Validar que user.id sea un UUID válido (usamos user.id autenticado en lugar de currentUserId prop)
      const senderId = user.id;

      if (!senderId || typeof senderId !== 'string' || senderId.length !== 36) {
        throw new Error(`ID de usuario inválido: ${senderId}`);
      }

      const notificationData = {
        user_id: amigo.id,
        type: 'match_invite',
        title: 'Invitación a partido',
        message: `${currentUser?.nombre || 'Alguien'} te invitó a jugar el ${partidoActual.fecha ? formatLocalDateShort(partidoActual.fecha) : ''} a las ${partidoActual.hora || ''}`,
        partido_id: Number(partidoActual.id), // Required for match_ref generation
        data: {
          matchId: partidoActual.id,
          matchName: partidoActual.nombre || null,
          matchDate: partidoActual.fecha || null,
          matchTime: partidoActual.hora || null,
          matchLocation: partidoActual.sede || null,
          inviterId: senderId,
          inviterName: currentUser?.nombre || 'Alguien',
          status: 'pending',
        },
        read: false,
        send_at: new Date().toISOString(),
      };

      console.log('[MODAL_AMIGOS] === INSERTING NOTIFICATION ===');
      console.log('[MODAL_AMIGOS] Notification data to insert:', {
        user_id: notificationData.user_id,
        type: notificationData.type,
        partido_id: notificationData.partido_id,
        title: notificationData.title,
        message: notificationData.message,
        read: notificationData.read,
      });

      console.log('[MODAL_AMIGOS] === ATTEMPTING INSERT VIA RPC ===');

      // Use RPC "Superuser" function to bypass RLS issues
      const { error } = await supabase.rpc('send_match_invite', {
        p_user_id: notificationData.user_id,
        p_partido_id: notificationData.partido_id,
        p_title: notificationData.title,
        p_message: notificationData.message,
      });

      // Mock response for compatibility
      const insertedNotification = { id: 'rpc-success' };

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
        title: insertedNotification.title,
        message: insertedNotification.message,
      });
      console.log('[MODAL_AMIGOS] Recipient should receive realtime notification for user_id:', insertedNotification.user_id);
      console.log('[MODAL_AMIGOS] 🔔 NOTIFICATION SENT - Check if recipient is logged in and has app open');
      console.log('[MODAL_AMIGOS] 📱 Recipient can check notifications in their notifications panel');

      // Agregar al set de amigos invitados
      setInvitedFriends((prev) => new Set(Array.from(prev).concat(amigo.id)));

      console.info(`Invitación enviada a ${amigo.nombre}`);
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending invitation:', error);
      if (error.message.includes('ya fue invitado')) {
        // No mostrar error si ya fue invitado
        return;
      }
      if (error.message.includes('no recibe invitaciones')) {
        console.info('Este jugador está en no disponible y no recibe invitaciones.');
        return;
      }
      notifyBlockingError('Error al enviar la invitación');
    } finally {
      setInviting(false);
    }
  };

  // NO RENDERIZAR SI NO ESTÁ ABIERTO
  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] p-5" onClick={onClose}>
      <div
        className="bg-[#1a1a1a] rounded-xl w-[calc(100vw-40px)] max-w-[360px] max-h-[80vh] overflow-hidden border-2 border-[#333] sm:w-[300px] sm:max-w-[calc(100vw-32px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-5 py-4 border-b border-[#333] bg-[#222]">
          <h3 className="text-white m-0 text-lg font-semibold">Invitar amigos</h3>
          <button
            className="bg-transparent border-none text-white text-2xl cursor-pointer p-0 w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/10"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          <div className="min-h-[52px] mb-2">
            <InlineNotice
              type={notice?.type}
              message={notice?.message}
              autoHideMs={notice?.type === 'warning' ? null : 3000}
              onClose={clearInlineNotice}
            />
          </div>
          {loading ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner size="medium" />
            </div>
          ) : amigos.length === 0 ? (
            <div className="text-center text-white/70 py-10 px-5 text-base">
              No tenés amigos para invitar
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {amigos.filter((amigo) => !invitedFriends.has(amigo.id)).length === 0 ? (
                <div className="text-center text-white/70 py-10 px-5 text-base">
                  No tenés más amigos para invitar
                </div>
              ) : (
                amigos.filter((amigo) => !invitedFriends.has(amigo.id)).map((amigo) => (
                  <div
                    key={amigo.id}
                    className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10 transition-all duration-200 hover:bg-white/[0.08] hover:border-white/20"
                  >
                    <img
                      src={amigo.avatar_url || '/profile.svg'}
                      alt={amigo.nombre || 'Usuario'}
                      className="w-10 h-10 rounded-full object-cover shrink-0 border-2 border-white/20"
                      onError={(e) => { e.currentTarget.src = '/profile.svg'; }}
                    />
                    <span className="flex-1 text-white text-base font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {amigo.nombre || 'Usuario'}
                    </span>
                    <button
                      onClick={() => handleInvitar(amigo)}
                      className={`
                      border-none rounded-md px-4 py-2 text-sm font-semibold cursor-pointer transition-all duration-200 shrink-0 min-w-[80px]
                      ${invitedFriends.has(amigo.id)
                          ? 'bg-[#28a745] text-white cursor-default hover:bg-[#28a745] hover:transform-none'
                          : 'bg-[#007bff] text-white hover:bg-[#0056b3] hover:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none'
                        }
                    `}
                      disabled={inviting || invitedFriends.has(amigo.id)}
                    >
                      {inviting ? '...' : invitedFriends.has(amigo.id) ? 'Invitado' : 'Invitar'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default InviteAmigosModal;
