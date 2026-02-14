import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import MatchChat from './MatchChat';
import { useAuth } from './AuthProvider';
import { MessageCircle } from 'lucide-react';

export default function ChatButton({ partidoId, isOpen: externalIsOpen, onOpenChange, onUnreadCountChange, hideTrigger = false }) {
  const { user } = useAuth(); // [TEAM_BALANCER_EDIT] Para verificar permisos
  const [unreadCount, setUnreadCount] = useState(0);
  const [internalIsChatOpen, setInternalIsChatOpen] = useState(false);

  // Usar control externo si está disponible, sino usar interno
  const isChatOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsChatOpen;
  const setIsChatOpen = onOpenChange || setInternalIsChatOpen;
  const [canAccessChat, setCanAccessChat] = useState(false); // [TEAM_BALANCER_EDIT] Control de acceso

  // [TEAM_BALANCER_EDIT] Verificar acceso al chat
  useEffect(() => {
    async function checkChatAccess() {
      if (!partidoId) {
        setCanAccessChat(false);
        return;
      }

      // Si no hay usuario (invitado), permitir acceso al chat
      if (!user?.id) {
        setCanAccessChat(true);
        return;
      }

      try {
        // Validate partidoId before query
        if (!partidoId || partidoId === 'undefined' || partidoId === 'null') {
          console.warn('[CHAT_BUTTON] Invalid partidoId, cannot check invitation');
          setCanAccessChat(false);
          return;
        }

        console.log('[CHAT_BUTTON] Checking chat access for match:', partidoId);

        // Verificar si el usuario está en la nómina del partido
        const { data: jugadoresPartido } = await supabase
          .from('jugadores')
          .select('usuario_id')
          .eq('partido_id', partidoId);

        const jugadorEnPartido = jugadoresPartido?.some((j) => j.usuario_id === user.id);

        // Verificar si es admin del partido
        const { data: partidoData } = await supabase
          .from('partidos')
          .select('creado_por')
          .eq('id', partidoId)
          .single();

        const esAdmin = partidoData?.creado_por === user.id;

        // Si ya es jugador o admin, siempre habilitar chat
        if (jugadorEnPartido || esAdmin) {
          setCanAccessChat(true);
          return;
        }

        // Invitación pendiente sin aceptar: aún no habilitar chat
        const { data: invitation, error: invitationError } = await supabase
          .from('notifications_ext')
          .select('id,data')
          .eq('user_id', user.id)
          .eq('type', 'match_invite')
          .eq('read', false)
          .eq('match_id_text', String(partidoId))
          .maybeSingle();

        if (invitationError) {
          console.warn('[CHAT_BUTTON] invitation lookup failed, denying chat', invitationError);
          setCanAccessChat(false);
          return;
        }

        if (invitation) {
          const inviteStatus = invitation?.data?.status || 'pending';
          if (inviteStatus === 'pending') {
            setCanAccessChat(false);
            return;
          }
        }

        setCanAccessChat(false);
      } catch (error) {
        console.error('Error checking chat access:', error);
        setCanAccessChat(false);
      }
    }

    checkChatAccess();

    // Suscripción en tiempo real para detectar cambios en jugadores
    const subscription = supabase
      .channel(`chat_access_${partidoId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jugadores',
        filter: `partido_id=eq.${partidoId}`,
      }, () => {
        checkChatAccess();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [partidoId, user?.id]);

  useEffect(() => {
    if (partidoId && canAccessChat) {
      checkUnreadMessages();
    }
  }, [partidoId, canAccessChat]);

  const checkUnreadMessages = async () => {
    try {
      const lastRead = localStorage.getItem(`chat_read_${partidoId}`);
      const lastReadTime = lastRead ? new Date(parseInt(lastRead)) : new Date(0);

      const { data, error } = await supabase
        .from('mensajes_partido')
        .select('id')
        .eq('partido_id', partidoId)
        .gt('timestamp', lastReadTime.toISOString());

      if (error) throw error;
      const count = data?.length || 0;
      setUnreadCount(count);
      if (onUnreadCountChange) {
        onUnreadCountChange(count);
      }
    } catch (error) {
      console.error('Error checking unread messages:', error);
    }
  };

  const handleOpenChat = () => {
    setIsChatOpen(true);
    setUnreadCount(0);
    if (onUnreadCountChange) {
      onUnreadCountChange(0);
    }
  };

  const handleCloseChat = () => {
    setIsChatOpen(false);
    checkUnreadMessages();
  };

  // [TEAM_BALANCER_EDIT] Solo mostrar chat si hay partidoId y el usuario tiene acceso
  if (!partidoId || !canAccessChat) return null;

  return (
    <>
      {!isChatOpen && externalIsOpen === undefined && !hideTrigger && (
        <button
          className="fixed bottom-[120px] right-5 w-12 h-12 bg-slate-700 border border-slate-600 rounded-full text-white/80 cursor-pointer flex items-center justify-center shadow-lg transition-all duration-200 z-[99999] hover:bg-slate-600 hover:text-white active:scale-95 max-[600px]:bottom-[120px] max-[600px]:right-4 max-[600px]:w-11 max-[600px]:h-11"
          onClick={handleOpenChat}
          aria-label="Abrir chat del partido"
        >
          <MessageCircle size={20} strokeWidth={2} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-[#128BE9] text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold font-oswald box-border max-[600px]:min-w-[16px] max-[600px]:h-[16px] max-[600px]:text-[9px]">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      <MatchChat
        partidoId={partidoId}
        isOpen={isChatOpen}
        onClose={handleCloseChat}
      />
    </>
  );
}
