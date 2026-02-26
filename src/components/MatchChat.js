import { notifyBlockingError } from 'utils/notifyBlockingError';
// src/components/MatchChat.js
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import { subscribeToMatchChat } from '../services/realtimeService';
// import './MatchChat.css'; // REMOVED

const AUTHOR_COLORS = [
  '#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#14b8a6',
  '#f97316', '#60a5fa', '#84cc16', '#e879f9', '#f43f5e', '#10b981',
  '#facc15', '#c084fc', '#06b6d4', '#fb7185', '#34d399', '#818cf8',
  '#2dd4bf', '#4ade80', '#fda4af', '#93c5fd',
];
const TEAM_CHAT_SIDE_COLORS = ['#A78BFA', '#22D3EE'];
const normalizeAuthorKey = (value) => String(value || '').trim().toLowerCase();

export default function MatchChat({ partidoId, isOpen, onClose }) {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [teamColorByUserId, setTeamColorByUserId] = useState({});
  const [teamColorByAuthorName, setTeamColorByAuthorName] = useState({});
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const scrollLockRef = useRef({ scrollY: 0, locked: false });
  const normalizedMatchId = String(partidoId || '').trim();
  const isTeamMatchChat = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedMatchId);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const syncLayout = () => setIsCompactLayout(mediaQuery.matches);
    syncLayout();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncLayout);
      return () => mediaQuery.removeEventListener('change', syncLayout);
    }

    mediaQuery.addListener(syncLayout);
    return () => mediaQuery.removeListener(syncLayout);
  }, []);

  useEffect(() => {
    if (isOpen && partidoId) {
      fetchMessages();
      markAsRead();

      const unsubscribe = subscribeToMatchChat(partidoId, (payload) => {
        console.debug(`[RT] Chat msg received for ${partidoId}:`, payload.new?.id);
        if (payload.new) {
          setMessages((prev) => {
            if (prev.find((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      });

      return () => {
        unsubscribe();
      };
    }
  }, [isOpen, partidoId]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    scrollLockRef.current = { scrollY, locked: true };

    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevHtmlOverflow = html.style.overflow;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.classList.add('chat-open');

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;
      body.classList.remove('chat-open');

      if (scrollLockRef.current.locked) {
        window.scrollTo(0, scrollLockRef.current.scrollY);
        scrollLockRef.current.locked = false;
      }
    };
  }, [isOpen, isCompactLayout]);

  useEffect(() => {
    if (!isOpen || isCompactLayout) return undefined;
    const t = setTimeout(() => {
      try {
        inputRef.current?.focus({ preventScroll: true });
      } catch (_) {
        inputRef.current?.focus();
      }
    }, 40);
    return () => clearTimeout(t);
  }, [isOpen, isCompactLayout]);

  useEffect(() => {
    let active = true;

    const loadTeamAuthorPalette = async () => {
      if (!isOpen || !isTeamMatchChat || !normalizedMatchId) {
        if (!active) return;
        setTeamColorByUserId({});
        setTeamColorByAuthorName({});
        return;
      }

      try {
        const [{ data: matchRow, error: matchError }, { data: memberRows, error: membersError }] = await Promise.all([
          supabase
            .from('team_matches')
            .select('team_a_id, team_b_id')
            .eq('id', normalizedMatchId)
            .maybeSingle(),
          supabase.rpc('rpc_list_team_match_members', { p_match_id: normalizedMatchId }),
        ]);

        if (matchError) throw matchError;
        if (membersError) throw membersError;

        const rows = Array.isArray(memberRows) ? memberRows : [];
        const sideTeamIds = [];
        const teamAId = String(matchRow?.team_a_id || '').trim();
        const teamBId = String(matchRow?.team_b_id || '').trim();

        if (teamAId) sideTeamIds.push(teamAId);
        if (teamBId && teamBId !== teamAId) sideTeamIds.push(teamBId);

        rows.forEach((row) => {
          const teamId = String(row?.team_id || '').trim();
          if (!teamId || sideTeamIds.includes(teamId) || sideTeamIds.length >= 2) return;
          sideTeamIds.push(teamId);
        });

        const colorByTeamId = {};
        if (sideTeamIds[0]) colorByTeamId[sideTeamIds[0]] = TEAM_CHAT_SIDE_COLORS[0];
        if (sideTeamIds[1]) colorByTeamId[sideTeamIds[1]] = TEAM_CHAT_SIDE_COLORS[1];

        const userColorMap = {};
        const nameColorMap = {};

        rows.forEach((row) => {
          const teamId = String(row?.team_id || '').trim();
          const teamColor = colorByTeamId[teamId];
          if (!teamColor) return;

          const memberUserId = String(row?.user_id || row?.jugador_usuario_id || '').trim();
          if (memberUserId) userColorMap[memberUserId] = teamColor;

          const authorKey = normalizeAuthorKey(row?.jugador_nombre);
          if (authorKey) nameColorMap[authorKey] = teamColor;
        });

        if (!active) return;
        setTeamColorByUserId(userColorMap);
        setTeamColorByAuthorName(nameColorMap);
      } catch (error) {
        if (!active) return;
        console.warn('[MATCH_CHAT] No se pudieron resolver colores por equipo. Fallback por jugador.', error);
        setTeamColorByUserId({});
        setTeamColorByAuthorName({});
      }
    };

    loadTeamAuthorPalette();

    return () => {
      active = false;
    };
  }, [isOpen, isTeamMatchChat, normalizedMatchId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    try {
      let query = supabase
        .from('mensajes_partido')
        .select('*')
        .order('timestamp', { ascending: true });

      if (isTeamMatchChat) {
        query = query.eq('team_match_id', normalizedMatchId);
      } else {
        const numericMatchId = Number(normalizedMatchId);
        if (!Number.isFinite(numericMatchId)) {
          setMessages([]);
          return;
        }
        query = query.eq('partido_id', numericMatchId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const markAsRead = () => {
    localStorage.setItem(`chat_read_${partidoId}`, Date.now().toString());
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getUserInfo = () => {
    // Siempre usar datos del usuario logueado
    if (user && profile) {
      return {
        name: profile.nombre || user.email?.split('@')[0] || 'Usuario',
        userId: user.id,
      };
    }
    return null;
  };

  const handleClose = () => {
    inputRef.current?.blur();
    onClose();
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    const userInfo = getUserInfo();
    if (!userInfo) {
      notifyBlockingError('Error: Usuario no identificado');
      return;
    }

    setLoading(true);
    try {
      const trimmedMessage = newMessage.trim();
      const { error: rpcError } = isTeamMatchChat
        ? await supabase.rpc('send_team_match_chat_message', {
          p_team_match_id: normalizedMatchId,
          p_autor: userInfo.name,
          p_mensaje: trimmedMessage,
        })
        : await supabase.rpc('send_match_chat_message', {
          p_partido_id: Number(normalizedMatchId),
          p_autor: userInfo.name,
          p_mensaje: trimmedMessage,
        });

      if (rpcError) {
        const missingFn = rpcError.code === '42883'
          || String(rpcError.message || '').toLowerCase().includes(isTeamMatchChat ? 'send_team_match_chat_message' : 'send_match_chat_message');
        if (!missingFn) throw rpcError;

        if (isTeamMatchChat) throw rpcError;

        // Backward compatibility while the RPC migration is being applied.
        const insertPayload = {
          partido_id: Number(normalizedMatchId),
          autor: userInfo.name,
          mensaje: trimmedMessage,
          user_id: user?.id || null,
        };

        const { error: insertWithUserIdError } = await supabase
          .from('mensajes_partido')
          .insert([insertPayload]);

        if (insertWithUserIdError) {
          const missingUserIdColumn = insertWithUserIdError.code === '42703'
            || String(insertWithUserIdError.message || '').toLowerCase().includes('user_id');

          if (!missingUserIdColumn) throw insertWithUserIdError;

          const { error: insertFallbackError } = await supabase
            .from('mensajes_partido')
            .insert([{
              partido_id: Number(normalizedMatchId),
              autor: userInfo.name,
              mensaje: trimmedMessage,
            }]);

          if (insertFallbackError) throw insertFallbackError;
        }
      }

      setNewMessage('');
      fetchMessages();

      // Devolver el foco al campo de texto
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    } catch (error) {
      const msg = String(error?.message || '');
      if (msg.toLowerCase().includes('row-level security')) {
        notifyBlockingError('No tenés permiso para escribir en este chat todavía.');
      } else {
        notifyBlockingError('Error enviando mensaje: ' + msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getAuthorColor = (author) => {
    const key = normalizeAuthorKey(author);
    if (!key) return AUTHOR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
  };

  const getMessageAuthorColor = (message) => {
    if (!isTeamMatchChat) return getAuthorColor(message?.autor);

    const userIdKey = String(message?.user_id || '').trim();
    if (userIdKey && teamColorByUserId[userIdKey]) {
      return teamColorByUserId[userIdKey];
    }

    const authorKey = normalizeAuthorKey(message?.autor);
    if (authorKey && teamColorByAuthorName[authorKey]) {
      return teamColorByAuthorName[authorKey];
    }

    return getAuthorColor(message?.autor);
  };

  if (!isOpen) return null;

  return (
    <div
      data-modal-root="true"
      className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-[10000] p-0 sm:p-[15px]"
      onClick={handleClose}
    >
      <div
      className="bg-slate-900 border-x border-t border-white/20 w-full h-full min-h-0 max-h-none rounded-none flex flex-col shadow-[0_30px_120px_rgba(0,0,0,0.55)] overflow-hidden sm:border-2 sm:max-w-[500px] sm:h-[75vh] sm:max-h-[600px] sm:rounded-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col px-5 py-3 border-b border-white/10 bg-slate-800 sm:px-4 sm:py-2.5 sm:shrink-0">
          <div className="flex justify-between items-center">
            <h3 className="m-0 font-oswald text-xl font-semibold text-white tracking-[0.01em]">Chat del partido</h3>
            <button
              className="bg-transparent border-none text-white/70 text-2xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
              onClick={handleClose}
              aria-label="Cerrar chat"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0 touch-pan-y sm:p-3 bg-slate-900">
          {messages.length === 0 ? (
            <div className="h-full min-h-[180px] flex items-center justify-center text-white/50 text-sm font-oswald">
              Todavía no hay mensajes.
            </div>
          ) : null}
          {messages.map((msg) => {
            const authorColor = getMessageAuthorColor(msg);
            return (
              <div key={msg.id} className="bg-slate-800 rounded-lg p-3 border-l-[3px]" style={{ borderLeftColor: authorColor }}>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-semibold font-oswald text-sm" style={{ color: authorColor }}>{msg.autor}</span>
                  <span className="text-xs text-white/50">{formatTime(msg.timestamp)}</span>
                </div>
                <div className="text-white/90 leading-[1.4] break-words text-sm">{msg.mensaje}</div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="flex pt-3 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] border-t border-white/10 gap-2 bg-slate-800 min-h-[64px] items-center sm:p-3 sm:relative sm:z-10 sm:shrink-0">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Escribí un mensaje…"
            className="flex-1 py-3 px-4 border border-slate-700 rounded-xl outline-none font-oswald text-base transition-all focus:border-[#0EA9C6] focus:ring-2 focus:ring-[#0EA9C6]/20 sm:text-base sm:relative sm:z-20 bg-slate-900 text-white placeholder:text-white/40"
            onKeyPress={(e) => e.key === 'Enter' && !loading && newMessage.trim() && handleSendMessage()}
            disabled={loading}
            ref={inputRef}
          />
          <button
            onClick={handleSendMessage}
            className="bg-[#0EA9C6] border-none rounded-xl w-11 h-11 text-white text-lg cursor-pointer flex items-center justify-center transition-all hover:bg-[#0c94a8] active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed"
            disabled={loading || !newMessage.trim()}
            aria-label="Enviar mensaje"
          >
            {loading ? '...' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}
