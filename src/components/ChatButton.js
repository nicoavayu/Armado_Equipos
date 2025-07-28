import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import MatchChat from './MatchChat';
import { useAuth } from './AuthProvider';
import './ChatButton.css';

export default function ChatButton({ partidoId }) {
  const { user } = useAuth(); // [TEAM_BALANCER_EDIT] Para verificar permisos
  const [unreadCount, setUnreadCount] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [canAccessChat, setCanAccessChat] = useState(false); // [TEAM_BALANCER_EDIT] Control de acceso

  // [TEAM_BALANCER_EDIT] Verificar acceso al chat
  useEffect(() => {
    async function checkChatAccess() {
      if (!partidoId || !user?.id) {
        setCanAccessChat(false);
        return;
      }
      
      try {
        // [TEAM_BALANCER_INVITE_EDIT] Verificar si hay invitación pendiente
        const { data: invitation } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', user.id)
          .eq('type', 'match_invite')
          .eq('read', false)
          .contains('data', { matchId: partidoId })
          .single();
          
        // Si hay invitación pendiente, no permitir acceso al chat
        if (invitation) {
          setCanAccessChat(false);
          return;
        }
        
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
        
        setCanAccessChat(jugadorEnPartido || esAdmin);
      } catch (error) {
        console.error('Error checking chat access:', error);
        setCanAccessChat(false);
      }
    }
    
    checkChatAccess();
  }, [partidoId, user?.id]);
  
  useEffect(() => {
    if (partidoId && canAccessChat) {
      checkUnreadMessages();
      const interval = setInterval(checkUnreadMessages, 10000);
      return () => clearInterval(interval);
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
      setUnreadCount(data?.length || 0);
    } catch (error) {
      console.error('Error checking unread messages:', error);
    }
  };

  const handleOpenChat = () => {
    setIsChatOpen(true);
    setUnreadCount(0);
  };

  const handleCloseChat = () => {
    setIsChatOpen(false);
    checkUnreadMessages();
  };

  // [TEAM_BALANCER_EDIT] Solo mostrar chat si el usuario tiene acceso
  if (!partidoId || !canAccessChat) return null;

  return (
    <>
      <button className="chat-float-btn" onClick={handleOpenChat}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
        </svg>
        {unreadCount > 0 && (
          <span className="chat-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      <MatchChat
        partidoId={partidoId}
        isOpen={isChatOpen}
        onClose={handleCloseChat}
      />
    </>
  );
}