import logger from '../utils/logger';
import { notifyBlockingError } from 'utils/notifyBlockingError';
// src/components/MatchChat.js
import React, { useCallback, useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import { useKeyboard } from '../hooks/useKeyboard';
// import './MatchChat.css'; // REMOVED

const MIN_CHAT_VIEWPORT_HEIGHT = 280;
const AUTHOR_COLORS = [
  '#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#14b8a6',
  '#f97316', '#60a5fa', '#84cc16', '#e879f9', '#f43f5e', '#10b981',
  '#facc15', '#c084fc', '#06b6d4', '#fb7185', '#34d399', '#818cf8',
  '#2dd4bf', '#4ade80', '#fda4af', '#93c5fd',
];
const TEAM_CHAT_SIDE_COLORS = ['#A78BFA', '#22D3EE'];
const normalizeAuthorKey = (value) => String(value || '').trim().toLowerCase();
const logMatchChat = () => {};

export const resolveMatchChatViewportMetrics = ({
  fallbackHeight = 0,
  visualViewportHeight = null,
  visualViewportOffsetTop = 0,
  isCompactLayout = false,
  isKeyboardOpen = false,
  keyboardHeight = 0,
  platform = 'web',
} = {}) => {
  const normalizedFallbackHeight = Math.max(0, Number(fallbackHeight) || 0);
  const normalizedKeyboardHeight = Math.max(0, Number(keyboardHeight) || 0);
  const viewportHeightSource = Number(visualViewportHeight) || normalizedFallbackHeight;
  const viewportHeight = Math.max(MIN_CHAT_VIEWPORT_HEIGHT, viewportHeightSource);
  const viewportTop = Math.max(0, Number(visualViewportOffsetTop) || 0);
  const reducedViewportGap = Math.max(0, normalizedFallbackHeight - viewportHeight);
  const reducedViewportThreshold = Math.min(120, Math.max(48, normalizedKeyboardHeight * 0.35));
  const isViewportReducedByKeyboard = Boolean(
    isKeyboardOpen
    && normalizedKeyboardHeight > 0
    && reducedViewportGap > reducedViewportThreshold
  );
  const shouldSubtractKeyboard = Boolean(
    isCompactLayout
    && isKeyboardOpen
    && normalizedKeyboardHeight > 0
    && platform !== 'android'
    && !isViewportReducedByKeyboard
  );
  const resolvedHeight = shouldSubtractKeyboard
    ? Math.max(MIN_CHAT_VIEWPORT_HEIGHT, normalizedFallbackHeight - normalizedKeyboardHeight)
    : viewportHeight;

  return {
    top: `${viewportTop}px`,
    height: `${Math.max(MIN_CHAT_VIEWPORT_HEIGHT, resolvedHeight)}px`,
    isViewportReducedByKeyboard,
    shouldSubtractKeyboard,
  };
};

const normalizeChatMessage = (row = {}) => ({
  ...row,
  id: row?.id ?? null,
  partido_id: row?.partido_id ?? null,
  team_match_id: row?.team_match_id ?? null,
  user_id: row?.user_id ?? null,
  autor: String(row?.autor || '').trim() || 'Usuario',
  mensaje: String(row?.mensaje || '').trim(),
  timestamp: row?.timestamp || row?.created_at || null,
  created_at: row?.created_at || row?.timestamp || null,
});

const compareChatMessageOrder = (left, right) => {
  const leftTime = new Date(left?.timestamp || left?.created_at || 0).getTime();
  const rightTime = new Date(right?.timestamp || right?.created_at || 0).getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return Number(left?.id || 0) - Number(right?.id || 0);
};

const mergeChatMessages = (...groups) => {
  const dedup = new Map();
  groups.flat().forEach((row) => {
    const normalized = normalizeChatMessage(row);
    const key = String(normalized?.id ?? '').trim();
    if (!key) return;
    dedup.set(key, normalized);
  });
  return Array.from(dedup.values()).sort(compareChatMessageOrder);
};

export default function MatchChat({ partidoId, proposalId = null, title = 'Chat del partido', canSend = true, isOpen, onClose }) {
  const { user, profile } = useAuth();
  const { keyboardHeight, isKeyboardOpen } = useKeyboard();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [viewportStyle, setViewportStyle] = useState({});
  const [teamColorByUserId, setTeamColorByUserId] = useState({});
  const [teamColorByAuthorName, setTeamColorByAuthorName] = useState({});
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const scrollLockRef = useRef({ scrollY: 0, locked: false });
  const messagesRef = useRef([]);
  const postgresChannelRef = useRef(null);
  const broadcastChannelRef = useRef(null);
  const loadRequestSeqRef = useRef(0);
  const loadPromiseRef = useRef(null);
  // El chat tiene tres scopes que comparten tabla (mensajes_partido):
  // partido regular (partido_id numérico), partido de equipos (team_match_id
  // uuid) y partido en gestación (proposal_id). El scope de gestación se pide
  // explícito con la prop proposalId para no chocar con los ids numéricos.
  const normalizedProposalId = String(proposalId || '').trim();
  const isProposalChat = normalizedProposalId !== '';
  const normalizedMatchId = String(partidoId || '').trim();
  const isTeamMatchChat = !isProposalChat
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedMatchId);
  // Clave de scope para canales realtime y localStorage de "leído". El prefijo
  // evita colisiones entre una propuesta y un partido con el mismo número.
  const scopeKey = isProposalChat ? `proposal:${normalizedProposalId}` : normalizedMatchId;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    if (!isOpen || (!partidoId && !isProposalChat)) return undefined;
    logMatchChat('PAGE_MOUNT', {
      pathname: window.location.pathname,
      partidoId,
      normalizedMatchId,
      isTeamMatchChat,
      userId: user?.id || null,
    });

    fetchMessages({ silent: true }).catch(() => {});
    markAsRead();

    const postgresChannelName = `match-chat-postgres:${scopeKey}`;
    const postgresFilter = isProposalChat
      ? `proposal_id=eq.${Number(normalizedProposalId)}`
      : isTeamMatchChat
        ? `team_match_id=eq.${normalizedMatchId}`
        : `partido_id=eq.${Number(normalizedMatchId)}`;

    const postgresChannel = supabase
      .channel(postgresChannelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mensajes_partido',
        filter: postgresFilter,
      }, (payload) => {
        logMatchChat('postgres:insert', {
          channel: postgresChannelName,
          partidoId,
          payload: payload?.new || null,
          timestamp: new Date().toISOString(),
        });

        if (!payload?.new) return;

        setMessages((prev) => {
          const nextMessage = normalizeChatMessage(payload.new);
          const exists = prev.some((row) => String(row?.id) === String(nextMessage?.id));
          const merged = exists ? prev : mergeChatMessages(prev, [nextMessage]);
          logMatchChat('setMessages:postgres', {
            prevIds: prev.map((row) => String(row?.id ?? '')),
            nextId: String(nextMessage?.id ?? ''),
            exists,
            finalIds: merged.map((row) => String(row?.id ?? '')),
          });
          return merged;
        });
      })
      .subscribe((status) => {
        logMatchChat('postgres:status', {
          channel: postgresChannelName,
          partidoId,
          status,
        });
      });

    postgresChannelRef.current = postgresChannel;

    const broadcastChannelName = `match-chat-sync:${scopeKey}`;
    const broadcastChannel = supabase.channel(broadcastChannelName, {
      config: {
        broadcast: {
          self: false,
          ack: true,
        },
      },
    });

    broadcastChannel
      .on('broadcast', { event: 'message-created' }, (payload) => {
        const broadcastPayload = payload?.payload || {};
        logMatchChat('broadcast:received', {
          channel: broadcastChannelName,
          partidoId,
          payload: broadcastPayload,
          timestamp: new Date().toISOString(),
        });

        const messageRow = broadcastPayload?.message ? normalizeChatMessage(broadcastPayload.message) : null;
        if (messageRow?.id) {
          setMessages((prev) => {
            const exists = prev.some((row) => String(row?.id) === String(messageRow?.id));
            const merged = exists ? prev : mergeChatMessages(prev, [messageRow]);
            logMatchChat('setMessages:broadcast', {
              prevIds: prev.map((row) => String(row?.id ?? '')),
              nextId: String(messageRow?.id ?? ''),
              exists,
              finalIds: merged.map((row) => String(row?.id ?? '')),
            });
            return merged;
          });
        }

        logMatchChat('broadcast:loadMessages', { partidoId });
        fetchMessages({ silent: true }).catch(() => {});
      })
      .subscribe((status) => {
        logMatchChat('broadcast:status', {
          channel: broadcastChannelName,
          partidoId,
          status,
        });
      });

    broadcastChannelRef.current = broadcastChannel;

    return () => {
      logMatchChat('PAGE_UNMOUNT', {
        pathname: window.location.pathname,
        partidoId,
        normalizedMatchId,
      });
      if (postgresChannelRef.current === postgresChannel) {
        postgresChannelRef.current = null;
      }
      if (broadcastChannelRef.current === broadcastChannel) {
        broadcastChannelRef.current = null;
      }
      supabase.removeChannel(postgresChannel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [isOpen, isProposalChat, isTeamMatchChat, normalizedMatchId, normalizedProposalId, scopeKey, partidoId, user?.id]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const isMobile = isCompactLayout;
    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    scrollLockRef.current = { scrollY, locked: !isMobile };

    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevHtmlOverflow = html.style.overflow;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    if (!isMobile) {
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.width = '100%';
    }
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
    if (!isOpen || typeof window === 'undefined') return undefined;

    const syncViewport = () => {
      const fallbackHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const vv = window.visualViewport;
      const viewportMetrics = resolveMatchChatViewportMetrics({
        fallbackHeight,
        visualViewportHeight: vv?.height,
        visualViewportOffsetTop: vv?.offsetTop,
        isCompactLayout,
        isKeyboardOpen,
        keyboardHeight,
        platform: Capacitor.getPlatform(),
      });

      setViewportStyle({
        top: viewportMetrics.top,
        height: viewportMetrics.height,
      });
    };

    syncViewport();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewport);
    vv?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);

    return () => {
      vv?.removeEventListener('resize', syncViewport);
      vv?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    };
  }, [isCompactLayout, isKeyboardOpen, isOpen, keyboardHeight]);

  useEffect(() => {
    if (!isOpen || !isCompactLayout || !isKeyboardOpen) return undefined;

    const timeoutId = window.setTimeout(() => {
      try {
        inputRef.current?.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'smooth' });
      } catch (_) {
        inputRef.current?.scrollIntoView();
      }
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [isCompactLayout, isKeyboardOpen, isOpen, keyboardHeight]);

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
        logger.warn('[MATCH_CHAT] No se pudieron resolver colores por equipo. Fallback por jugador.', error);
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

  const fetchMessages = useCallback(async ({ silent = false } = {}) => {
    if (!isProposalChat && !normalizedMatchId) return [];
    if (loadPromiseRef.current) {
      logMatchChat('loadMessages:reuse-inflight', { partidoId, normalizedMatchId });
      return loadPromiseRef.current;
    }

    const requestId = loadRequestSeqRef.current + 1;
    loadRequestSeqRef.current = requestId;
    logMatchChat('loadMessages:start', {
      requestId,
      partidoId,
      normalizedMatchId,
      isTeamMatchChat,
      existingIds: messagesRef.current.map((row) => String(row?.id ?? '')),
    });

    try {
      let query = supabase
        .from('mensajes_partido')
        .select('*')
        .order('timestamp', { ascending: true });

      if (isProposalChat) {
        const numericProposalId = Number(normalizedProposalId);
        if (!Number.isFinite(numericProposalId)) {
          setMessages([]);
          return;
        }
        query = query.eq('proposal_id', numericProposalId);
      } else if (isTeamMatchChat) {
        query = query.eq('team_match_id', normalizedMatchId);
      } else {
        const numericMatchId = Number(normalizedMatchId);
        if (!Number.isFinite(numericMatchId)) {
          setMessages([]);
          return;
        }
        query = query.eq('partido_id', numericMatchId);
      }

      loadPromiseRef.current = query.then(({ data, error }) => {
        if (error) throw error;

        const normalizedRows = mergeChatMessages(data || []);
        logMatchChat('loadMessages:result', {
          requestId,
          count: normalizedRows.length,
          ids: normalizedRows.map((row) => String(row?.id ?? '')),
        });

        setMessages((prev) => {
          const merged = mergeChatMessages(prev, normalizedRows);
          logMatchChat('setMessages:load', {
            requestId,
            prevIds: prev.map((row) => String(row?.id ?? '')),
            fetchedIds: normalizedRows.map((row) => String(row?.id ?? '')),
            finalIds: merged.map((row) => String(row?.id ?? '')),
          });
          return merged;
        });

        return normalizedRows;
      });

      return await loadPromiseRef.current;
    } catch (error) {
      logger.error('Error fetching messages:', error);
      if (!silent) {
        notifyBlockingError('No se pudieron cargar los mensajes del chat.');
      }
      return [];
    } finally {
      loadPromiseRef.current = null;
    }
  }, [isProposalChat, isTeamMatchChat, normalizedMatchId, normalizedProposalId, partidoId]);

  const markAsRead = () => {
    localStorage.setItem(`chat_read_${scopeKey}`, Date.now().toString());
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
    // Historial de solo lectura: gestación cerrada (cancelada/vencida/creada).
    // El backend igual rechaza el INSERT; acá evitamos el intento y el error.
    if (!canSend) return;

    const userInfo = getUserInfo();
    if (!userInfo) {
      notifyBlockingError('Error: Usuario no identificado');
      return;
    }

    setLoading(true);
    try {
      const trimmedMessage = newMessage.trim();
      logMatchChat('SEND_CLICK', {
        partidoId,
        normalizedMatchId,
        isTeamMatchChat,
        userId: user?.id || null,
        messagePreview: trimmedMessage.slice(0, 80),
      });
      const { error: rpcError } = isProposalChat
        ? await supabase.rpc('send_auto_match_proposal_chat_message', {
          p_proposal_id: Number(normalizedProposalId),
          p_autor: userInfo.name,
          p_mensaje: trimmedMessage,
        })
        : isTeamMatchChat
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
        // El scope de gestación no tiene ruta de compatibilidad: la RPC es la
        // única vía (INSERT directo bloqueado por RLS), así que se propaga.
        if (isProposalChat) throw rpcError;

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

      const rows = await fetchMessages({ silent: true });
      const latestMessage = Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : null;
      const broadcastChannel = broadcastChannelRef.current;
      if (broadcastChannel) {
        const payload = {
          partidoId,
          normalizedMatchId,
          isTeamMatchChat,
          senderUserId: user?.id || null,
          sentAt: new Date().toISOString(),
          message: latestMessage ? normalizeChatMessage(latestMessage) : null,
        };
        logMatchChat('broadcast:send', {
          channel: `match-chat-sync:${normalizedMatchId}`,
          payload,
        });
        try {
          const result = await broadcastChannel.send({
            type: 'broadcast',
            event: 'message-created',
            payload,
          });
          logMatchChat('broadcast:send-result', {
            channel: `match-chat-sync:${normalizedMatchId}`,
            result,
          });
        } catch (broadcastError) {
          logger.warn('Match chat broadcast send failed', broadcastError);
        }
      }

      setNewMessage('');

      // Devolver el foco al campo de texto
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    } catch (error) {
      const msg = String(error?.message || '');
      // Condición de carrera: la gestación se materializó (o cerró) justo cuando
      // se enviaba. En vez de un error técnico, se avisa de forma controlada y se
      // cierra el chat; las comunicaciones siguen en el partido real.
      if (isProposalChat && /no admite mensajes nuevos|sin permiso para enviar/i.test(msg)) {
        notifyBlockingError('Este partido ya fue creado. Las comunicaciones siguen en el partido.');
        onClose?.();
      } else if (msg.toLowerCase().includes('row-level security')) {
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

  const mobileHeaderStyle = isCompactLayout
    ? {
      paddingTop: 'max(10px, calc(var(--safe-top, 0px) + 10px))',
      paddingRight: 'max(20px, calc(var(--safe-right, 0px) + 16px))',
      paddingBottom: '12px',
      paddingLeft: 'max(20px, calc(var(--safe-left, 0px) + 16px))',
      minHeight: 'calc(54px + var(--safe-top, 0px))',
    }
    : undefined;

  const chatModal = (
    <div
      data-modal-root="true"
      data-match-chat-root="true"
      className="fixed inset-x-0 top-0 h-[100dvh] bg-black/70 flex items-end sm:items-center justify-center z-[10000] p-0 sm:p-[15px]"
      style={viewportStyle}
      onClick={handleClose}
    >
      <div
      data-testid="match-chat-panel"
      className="bg-slate-900 border-x border-t border-white/20 w-full h-full min-h-0 max-h-none rounded-none flex flex-col shadow-[0_30px_120px_rgba(0,0,0,0.55)] overflow-hidden sm:border-2 sm:max-w-[500px] sm:h-[75vh] sm:max-h-[600px] sm:rounded-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex flex-col px-5 py-3 border-b border-white/10 bg-slate-800 sm:px-4 sm:py-2.5 sm:shrink-0"
        style={mobileHeaderStyle}
      >
          <div className="flex justify-between items-center gap-3">
            <h3 className="m-0 font-oswald text-xl font-semibold text-white tracking-[0.01em]">{title}</h3>
            <button
              className="bg-transparent border-none text-white/70 text-2xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
              onClick={handleClose}
              aria-label="Cerrar chat"
            >
              ×
            </button>
          </div>
        </div>

        <div data-testid="match-chat-messages" className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0 touch-pan-y sm:p-3 bg-slate-900">
          {messages.length === 0 ? (
            <div className="flex flex-1 min-h-[180px] items-center justify-center text-white/50 text-sm font-oswald">
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

        {canSend ? (
          <div data-testid="match-chat-composer" className="flex shrink-0 pt-3 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] border-t border-white/10 gap-2 bg-slate-800 min-h-[64px] items-center sm:p-3 sm:relative sm:z-10">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Escribí un mensaje…"
              className="flex-1 py-3 px-4 border border-slate-700 rounded-xl outline-none font-oswald text-base transition-all focus:border-[#0EA9C6] focus:ring-2 focus:ring-[#0EA9C6]/20 sm:text-base sm:relative sm:z-20 bg-slate-900 text-white placeholder:text-white/40"
              onKeyPress={(e) => e.key === 'Enter' && !loading && newMessage.trim() && handleSendMessage()}
              onFocus={() => {
                window.setTimeout(() => {
                  messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
                }, 120);
              }}
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
        ) : (
          <div
            data-testid="match-chat-readonly"
            className="flex shrink-0 items-center justify-center pt-3 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] border-t border-white/10 bg-slate-800 min-h-[64px] text-center font-oswald text-sm text-white/55 sm:p-3"
          >
            Esta gestación se cerró. Podés leer el historial, pero ya no se pueden enviar mensajes.
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(chatModal, document.body);
}
