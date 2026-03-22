import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useLocation, useParams } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import supabase from '../supabase';
import { useAuth } from '../components/AuthProvider';
import {
  canAccessTeamChat,
  listAccessibleTeams,
  listTeamChatMessages,
  sendTeamChatMessage,
} from '../services/db/teamChallenges';
import { useKeyboard } from '../hooks/useKeyboard';
import { notifyBlockingError } from '../utils/notifyBlockingError';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';
import { useSupabaseRealtime } from '../hooks/useSupabaseRealtime';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';

const AUTHOR_COLORS = [
  '#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#14b8a6',
  '#f97316', '#60a5fa', '#84cc16', '#e879f9', '#f43f5e', '#10b981',
  '#facc15', '#c084fc', '#06b6d4', '#fb7185', '#34d399', '#818cf8',
  '#2dd4bf', '#4ade80', '#fda4af', '#93c5fd',
];
const logTeamChat = () => {};

const normalizeTeamChatMessage = (row = {}) => ({
  ...row,
  id: row?.id ?? null,
  team_id: row?.team_id ?? null,
  user_id: row?.user_id ?? null,
  autor: String(row?.autor || '').trim() || 'Usuario',
  mensaje: String(row?.mensaje || '').trim(),
  timestamp: row?.timestamp || row?.created_at || null,
  created_at: row?.created_at || row?.timestamp || null,
});

const compareMessageOrder = (left, right) => {
  const leftTime = new Date(left?.timestamp || left?.created_at || 0).getTime();
  const rightTime = new Date(right?.timestamp || right?.created_at || 0).getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return Number(left?.id || 0) - Number(right?.id || 0);
};

const mergeTeamChatMessages = (...groups) => {
  const dedup = new Map();
  groups.flat().forEach((row) => {
    const normalized = normalizeTeamChatMessage(row);
    const key = String(normalized?.id ?? '').trim();
    if (!key) return;
    dedup.set(key, normalized);
  });
  return Array.from(dedup.values()).sort(compareMessageOrder);
};

const TeamChatPage = () => {
  const location = useLocation();
  const { teamId } = useParams();
  const { user, profile } = useAuth();
  const { keyboardHeight, isKeyboardOpen } = useKeyboard();
  const goBackSmart = useSmartBackNavigation();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [canAccess, setCanAccess] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [viewportStyle, setViewportStyle] = useState({});
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const scrollLockRef = useRef({ scrollY: 0, locked: false });
  const canAccessRef = useRef(false);
  const chatStateRefreshTimeoutRef = useRef(null);
  const messagesRefreshTimeoutRef = useRef(null);
  const messagesRefreshPromiseRef = useRef(null);
  const loadMessagesRequestSeqRef = useRef(0);
  const realtimeStatusRef = useRef('CLOSED');
  const broadcastChannelRef = useRef(null);
  const broadcastStatusRef = useRef('CLOSED');

  const handleBack = useCallback(() => {
    inputRef.current?.blur();
    goBackSmart({
      fallback: `/desafios/equipos/${teamId}`,
      backTo: location.state?.backTo || `/desafios/equipos/${teamId}`,
      preferHistoryBack: true,
    });
  }, [goBackSmart, location.state, teamId]);

  const currentAuthorName = useMemo(
    () => profile?.nombre || user?.email?.split('@')[0] || 'Usuario',
    [profile?.nombre, user?.email],
  );

  const loadMessages = useCallback(async ({ silent = false } = {}) => {
    if (!teamId) return;
    if (messagesRefreshPromiseRef.current) {
      logTeamChat('loadMessages:reuse-inflight', { teamId });
      return messagesRefreshPromiseRef.current;
    }

    const requestId = loadMessagesRequestSeqRef.current + 1;
    loadMessagesRequestSeqRef.current = requestId;

    logTeamChat('loadMessages:start', {
      requestId,
      teamId,
      silent,
      existingIds: messages.map((row) => String(row?.id ?? '')),
    });

    const request = listTeamChatMessages(teamId)
      .then((rows) => {
        const normalizedRows = mergeTeamChatMessages(rows || []);
        logTeamChat('loadMessages:result', {
          requestId,
          teamId,
          count: normalizedRows.length,
          ids: normalizedRows.map((row) => String(row?.id ?? '')),
        });
        setMessages((prev) => {
          const prevIdsArray = prev.map((row) => String(row?.id ?? ''));
          const fetchedIdsArray = normalizedRows.map((row) => String(row?.id ?? ''));
          const mergedRows = mergeTeamChatMessages(prev, normalizedRows);
          const nextIdsArray = mergedRows.map((row) => String(row?.id ?? ''));
          const prevIds = prevIdsArray.join('|');
          const nextIds = nextIdsArray.join('|');
          logTeamChat('setMessages:load', {
            requestId,
            teamId,
            prevIds: prevIdsArray,
            fetchedIds: fetchedIdsArray,
            nextIds: nextIdsArray,
          });
          if (prevIds === nextIds) return prev;
          return mergedRows;
        });
        localStorage.setItem(`team_chat_read_${teamId}`, Date.now().toString());
        return normalizedRows;
      })
      .catch((error) => {
        if (!silent) {
          notifyBlockingError(error.message || 'No se pudo cargar el chat del equipo');
        } else {
          console.warn('Team chat message refresh failed', error);
        }
        throw error;
      })
      .finally(() => {
        messagesRefreshPromiseRef.current = null;
      });

    messagesRefreshPromiseRef.current = request;
    return request;
  }, [teamId]);

  const loadChatState = useCallback(async ({
    withLoading = false,
    silent = false,
  } = {}) => {
    if (!teamId || !user?.id) return;

    try {
      if (withLoading) setLoading(true);

      const [teams, chatAccess] = await Promise.all([
        listAccessibleTeams(user.id),
        canAccessTeamChat({ teamId, userId: user.id }),
      ]);

      const selectedTeam = (teams || []).find((item) => String(item?.id) === String(teamId)) || null;
      const nextCanAccess = Boolean(selectedTeam && chatAccess);

      setCanAccess(nextCanAccess);

      if (nextCanAccess) {
        try {
          await loadMessages({ silent });
        } catch (_error) {
          // loadMessages already handled user-facing error and we keep current access state.
        }
      } else {
        setMessages([]);
      }
    } catch (error) {
      if (!silent) {
        notifyBlockingError(error.message || 'No se pudo validar acceso al chat');
        setCanAccess(false);
        setMessages([]);
      } else {
        console.warn('Team chat refresh failed', error);
      }
    } finally {
      if (withLoading) setLoading(false);
    }
  }, [loadMessages, teamId, user?.id]);

  useEffect(() => {
    canAccessRef.current = canAccess;
  }, [canAccess]);

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
    if (!teamId || !user?.id) return;

    logTeamChat('PAGE_MOUNT', { teamId, userId: user.id, pathname: location.pathname });
    loadChatState({ withLoading: true });
    return () => {
      logTeamChat('PAGE_UNMOUNT', { teamId, userId: user.id, pathname: location.pathname });
    };
  }, [loadChatState, location.pathname, teamId, user?.id]);

  const scheduleChatStateRefresh = useCallback(() => {
    window.clearTimeout(chatStateRefreshTimeoutRef.current);
    chatStateRefreshTimeoutRef.current = window.setTimeout(() => {
      loadChatState({ silent: true });
    }, 140);
  }, [loadChatState]);

  const scheduleMessagesRefresh = useCallback(() => {
    window.clearTimeout(messagesRefreshTimeoutRef.current);
    messagesRefreshTimeoutRef.current = window.setTimeout(() => {
      if (!canAccessRef.current) return;
      loadMessages({ silent: true }).catch(() => {});
    }, 120);
  }, [loadMessages]);

  useEffect(() => (
    () => {
      window.clearTimeout(chatStateRefreshTimeoutRef.current);
      window.clearTimeout(messagesRefreshTimeoutRef.current);
    }
  ), []);

  useRefreshOnVisibility(
    () => {
      loadChatState({ silent: true });
    },
    {
      enabled: Boolean(teamId && user?.id),
    },
  );

  useSupabaseRealtime({
    enabled: Boolean(teamId && user?.id),
    channelName: `team-chat-page-${teamId}`,
    deps: [teamId, user?.id, scheduleChatStateRefresh, scheduleMessagesRefresh],
    onStatusChange: (status) => {
      realtimeStatusRef.current = status;
      logTeamChat('postgres:status', {
        teamId,
        channel: `team-chat-page-${teamId}`,
        status,
      });
    },
    events: [
      {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
        filter: `team_id=eq.${teamId}`,
        handler: (payload) => {
          if (!canAccessRef.current || !payload?.new) return;
          logTeamChat('postgres:insert', {
            teamId,
            payload: payload.new,
            canAccess: canAccessRef.current,
          });
          setMessages((prev) => {
            const nextMessage = normalizeTeamChatMessage(payload.new);
            const exists = prev.some((row) => String(row?.id) === String(nextMessage?.id));
            logTeamChat('setMessages:postgres', {
              teamId,
              nextId: String(nextMessage?.id ?? ''),
              prevIds: prev.map((row) => String(row?.id ?? '')),
              exists,
            });
            if (exists) return prev;
            localStorage.setItem(`team_chat_read_${teamId}`, Date.now().toString());
            return mergeTeamChatMessages(prev, [nextMessage]);
          });
          scheduleMessagesRefresh();
        },
      },
      {
        event: '*',
        schema: 'public',
        table: 'team_members',
        filter: `team_id=eq.${teamId}`,
        handler: () => {
          scheduleChatStateRefresh();
        },
      },
      {
        event: '*',
        schema: 'public',
        table: 'teams',
        filter: `id=eq.${teamId}`,
        handler: () => {
          scheduleChatStateRefresh();
        },
      },
    ],
  });

  useEffect(() => {
    if (!teamId || !user?.id) return undefined;

    const channelName = `team-chat-sync-${teamId}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: {
          self: false,
          ack: true,
        },
      },
    });

    broadcastChannelRef.current = channel;
    logTeamChat('broadcast:mount', {
      teamId,
      channel: channelName,
      userId: user.id,
    });

    channel
      .on('broadcast', { event: 'message-created' }, (payload) => {
        const broadcastPayload = payload?.payload || {};
        const sameTeam = String(broadcastPayload?.teamId || '') === String(teamId);
        logTeamChat('broadcast:received', {
          teamId,
          channel: channelName,
          payload: broadcastPayload,
          sameTeam,
          canAccess: canAccessRef.current,
          timestamp: new Date().toISOString(),
        });
        if (!canAccessRef.current || !sameTeam) return;

        const messageRow = broadcastPayload?.message ? normalizeTeamChatMessage(broadcastPayload.message) : null;
        if (messageRow?.id) {
          setMessages((prev) => {
            const exists = prev.some((row) => String(row?.id) === String(messageRow?.id));
            logTeamChat('setMessages:broadcast', {
              teamId,
              nextId: String(messageRow?.id ?? ''),
              prevIds: prev.map((row) => String(row?.id ?? '')),
              exists,
            });
            if (exists) return prev;
            localStorage.setItem(`team_chat_read_${teamId}`, Date.now().toString());
            return mergeTeamChatMessages(prev, [messageRow]);
          });
        }

        logTeamChat('broadcast:loadMessages', { teamId, channel: channelName });
        loadMessages({ silent: true }).catch(() => {});
      })
      .subscribe((status) => {
        broadcastStatusRef.current = status;
        logTeamChat('broadcast:status', {
          teamId,
          channel: channelName,
          status,
        });
      });

    return () => {
      logTeamChat('broadcast:cleanup', {
        teamId,
        channel: channelName,
        userId: user.id,
      });
      if (broadcastChannelRef.current === channel) {
        broadcastChannelRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [loadMessages, teamId, user?.id]);

  useEffect(() => {
    if (!teamId || !user?.id || typeof document === 'undefined') return undefined;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;

      if (canAccessRef.current) {
        loadMessages({ silent: true }).catch(() => {});
        return;
      }

      loadChatState({ silent: true }).catch(() => {});
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadChatState, loadMessages, teamId, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!canAccess || isCompactLayout) return undefined;
    const timeout = setTimeout(() => {
      try {
        inputRef.current?.focus({ preventScroll: true });
      } catch (_) {
        inputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timeout);
  }, [canAccess, isCompactLayout]);

  useEffect(() => {
    const isOpen = true;
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
  }, [isCompactLayout]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncViewport = () => {
      const fallbackHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const vv = window.visualViewport;
      const viewportTop = Math.max(0, vv?.offsetTop || 0);
      const viewportHeight = Math.max(280, vv?.height || fallbackHeight);
      const keyboardAdjustedHeight = isCompactLayout && isKeyboardOpen && keyboardHeight > 0
        ? Math.max(280, fallbackHeight - keyboardHeight)
        : viewportHeight;
      const resolvedHeight = Math.min(viewportHeight, keyboardAdjustedHeight);

      if (!vv) {
        setViewportStyle({
          top: '0px',
          height: `${keyboardAdjustedHeight}px`,
        });
        return;
      }

      setViewportStyle({
        top: `${viewportTop}px`,
        height: `${resolvedHeight}px`,
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
  }, [isCompactLayout, isKeyboardOpen, keyboardHeight]);

  useEffect(() => {
    if (!isCompactLayout || !isKeyboardOpen) return undefined;

    const timeoutId = window.setTimeout(() => {
      try {
        inputRef.current?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      } catch (_) {
        inputRef.current?.scrollIntoView();
      }
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [isCompactLayout, isKeyboardOpen, keyboardHeight]);

  const getAuthorColor = (author) => {
    const key = String(author || '').trim().toLowerCase();
    if (!key) return AUTHOR_COLORS[0];
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = ((hash << 5) - hash) + key.charCodeAt(index);
      hash |= 0;
    }
    return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
  };

  const formatTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSend = async () => {
    if (!teamId) return;
    const trimmed = newMessage.trim();
    if (!trimmed || sending) return;

    try {
      logTeamChat('SEND_CLICK', {
        teamId,
        userId: user?.id || null,
        messagePreview: trimmed.slice(0, 80),
      });
      setSending(true);
      await sendTeamChatMessage({
        teamId,
        author: currentAuthorName,
        message: trimmed,
      });
      const rows = await loadMessages();
      const latestMessage = Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : null;

      const broadcastChannel = broadcastChannelRef.current;
      if (broadcastChannel) {
        try {
          const payload = {
            teamId,
            senderUserId: user?.id || null,
            sentAt: new Date().toISOString(),
            message: latestMessage ? normalizeTeamChatMessage(latestMessage) : null,
          };
          logTeamChat('broadcast:send', {
            teamId,
            channel: `team-chat-sync-${teamId}`,
            status: broadcastStatusRef.current,
            payload,
          });
          const result = await broadcastChannel.send({
            type: 'broadcast',
            event: 'message-created',
            payload,
          });
          logTeamChat('broadcast:send-result', {
            teamId,
            channel: `team-chat-sync-${teamId}`,
            result,
          });
        } catch (broadcastError) {
          console.warn('Team chat broadcast send failed', broadcastError);
        }
      }

      setNewMessage('');
      inputRef.current?.focus();
    } catch (error) {
      const message = String(error?.message || '');
      if (message.toLowerCase().includes('permiso')) {
        notifyBlockingError('Solo los miembros confirmados del equipo pueden usar este chat.');
      } else {
        notifyBlockingError(error.message || 'No se pudo enviar el mensaje');
      }
    } finally {
      setSending(false);
    }
  };

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
      className="fixed inset-x-0 top-0 h-[100dvh] bg-black/70 flex items-end sm:items-center justify-center z-[10000] p-0 sm:p-[15px]"
      style={viewportStyle}
      onClick={handleBack}
    >
      <div
        className="bg-slate-900 border-x border-t border-white/20 w-full h-full min-h-0 max-h-none rounded-none flex flex-col shadow-[0_30px_120px_rgba(0,0,0,0.55)] overflow-hidden sm:border-2 sm:max-w-[500px] sm:h-[75vh] sm:max-h-[600px] sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex flex-col px-5 py-3 border-b border-white/10 bg-slate-800 sm:px-4 sm:py-2.5 sm:shrink-0"
          style={mobileHeaderStyle}
        >
          <div className="flex justify-between items-center gap-3">
            <h3 className="m-0 font-oswald text-xl font-semibold text-white tracking-[0.01em]">Chat del equipo</h3>
            <button
              className="bg-transparent border-none text-white/70 text-2xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
              onClick={handleBack}
              aria-label="Cerrar chat"
              type="button"
              data-preserve-button-case="true"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0 touch-pan-y sm:p-3 bg-slate-900">
          {loading ? (
            <div className="flex flex-1 min-h-[180px] items-center justify-center text-white/50 text-sm font-oswald">
              Cargando chat...
            </div>
          ) : null}

          {!loading && !canAccess ? (
            <div className="flex flex-1 min-h-[180px] items-center justify-center text-center text-white/60 text-sm font-oswald px-6">
              Solo los miembros confirmados del equipo pueden acceder al chat.
            </div>
          ) : null}

          {!loading && canAccess && messages.length === 0 ? (
            <div className="flex flex-1 min-h-[180px] items-center justify-center text-white/50 text-sm font-oswald">
              Todavía no hay mensajes.
            </div>
          ) : null}

          {!loading && canAccess ? messages.map((message) => {
            const authorColor = getAuthorColor(message?.autor);
            return (
              <div
                key={message.id}
                className="bg-slate-800 rounded-lg p-3 border-l-[3px]"
                style={{ borderLeftColor: authorColor }}
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-semibold font-oswald text-sm" style={{ color: authorColor }}>
                    {message?.autor || 'Usuario'}
                  </span>
                  <span className="text-xs text-white/50">
                    {formatTime(message?.timestamp || message?.created_at)}
                  </span>
                </div>
                <div className="text-white/90 leading-[1.4] break-words text-sm">{message?.mensaje || ''}</div>
              </div>
            );
          }) : null}

          <div ref={messagesEndRef} />
        </div>

        {canAccess ? (
          <div className="flex pt-3 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] border-t border-white/10 gap-2 bg-slate-800 min-h-[64px] items-center sm:p-3 sm:relative sm:z-10 sm:shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              placeholder="Escribí un mensaje…"
              className="flex-1 py-3 px-4 border border-slate-700 rounded-xl outline-none font-oswald text-base transition-all focus:border-[#0EA9C6] focus:ring-2 focus:ring-[#0EA9C6]/20 sm:text-base sm:relative sm:z-20 bg-slate-900 text-white placeholder:text-white/40"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !sending && newMessage.trim()) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              onFocus={() => {
                window.setTimeout(() => {
                  messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
                }, 120);
              }}
              disabled={sending}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !newMessage.trim()}
              className="bg-[#0EA9C6] border-none rounded-xl w-11 h-11 text-white text-lg cursor-pointer flex items-center justify-center transition-all hover:bg-[#0c94a8] active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed"
              aria-label="Enviar mensaje"
              data-preserve-button-case="true"
            >
              {sending ? '...' : '➤'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <PageTransition>
      {typeof document !== 'undefined' ? ReactDOM.createPortal(chatModal, document.body) : null}
    </PageTransition>
  );
};

export default TeamChatPage;
