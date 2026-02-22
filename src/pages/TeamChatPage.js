import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import Modal from '../components/Modal';
import { useAuth } from '../components/AuthProvider';
import {
  canAccessTeamChat,
  listAccessibleTeams,
  listTeamChatMessages,
  sendTeamChatMessage,
} from '../services/db/teamChallenges';
import { subscribeToTeamChat } from '../services/realtimeService';
import { notifyBlockingError } from '../utils/notifyBlockingError';

const AUTHOR_COLORS = [
  '#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#14b8a6',
  '#f97316', '#60a5fa', '#84cc16', '#e879f9', '#f43f5e', '#10b981',
  '#facc15', '#c084fc', '#06b6d4', '#fb7185', '#34d399', '#818cf8',
  '#2dd4bf', '#4ade80', '#fda4af', '#93c5fd',
];

const TeamChatPage = () => {
  const navigate = useNavigate();
  const { teamId } = useParams();
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [canAccess, setCanAccess] = useState(false);
  const [team, setTeam] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const handleBack = useCallback(() => {
    navigate(`/quiero-jugar/equipos/${teamId}`);
  }, [navigate, teamId]);

  const currentAuthorName = useMemo(
    () => profile?.nombre || user?.email?.split('@')[0] || 'Usuario',
    [profile?.nombre, user?.email],
  );

  const loadMessages = useCallback(async () => {
    if (!teamId) return;
    try {
      const rows = await listTeamChatMessages(teamId);
      setMessages(rows || []);
      localStorage.setItem(`team_chat_read_${teamId}`, Date.now().toString());
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el chat del equipo');
    }
  }, [teamId]);

  useEffect(() => {
    if (!teamId || !user?.id) return;

    let isMounted = true;

    const bootstrap = async () => {
      try {
        setLoading(true);

        const [teams, chatAccess] = await Promise.all([
          listAccessibleTeams(user.id),
          canAccessTeamChat({ teamId, userId: user.id }),
        ]);

        if (!isMounted) return;

        const selectedTeam = (teams || []).find((item) => String(item?.id) === String(teamId)) || null;
        setTeam(selectedTeam);
        setCanAccess(Boolean(selectedTeam && chatAccess));

        if (selectedTeam && chatAccess) {
          await loadMessages();
        } else {
          setMessages([]);
        }
      } catch (error) {
        if (!isMounted) return;
        notifyBlockingError(error.message || 'No se pudo validar acceso al chat');
        setCanAccess(false);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, [loadMessages, teamId, user?.id]);

  useEffect(() => {
    if (!canAccess || !teamId) return undefined;

    const unsubscribe = subscribeToTeamChat(teamId, (payload) => {
      if (!payload?.new) return;
      setMessages((prev) => {
        if (prev.some((row) => row.id === payload.new.id)) return prev;
        return [...prev, payload.new];
      });
    });

    return () => {
      unsubscribe();
    };
  }, [canAccess, teamId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!canAccess) return;
    const timeout = setTimeout(() => {
      try {
        inputRef.current?.focus({ preventScroll: true });
      } catch (_) {
        inputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timeout);
  }, [canAccess]);

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
      setSending(true);
      await sendTeamChatMessage({
        teamId,
        author: currentAuthorName,
        message: trimmed,
      });
      setNewMessage('');
      await loadMessages();
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

  return (
    <PageTransition>
      <Modal
        isOpen={true}
        onClose={handleBack}
        title="Chat del equipo"
        className="w-full max-w-[560px] border-white/15 bg-[#0f172acc]"
        classNameContent="!p-0"
      >
        <div className="rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.35)] overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3 bg-slate-800/70">
            <p className="text-white font-oswald text-lg leading-tight">
              {team?.name ? `Chat de ${team.name}` : 'Chat del equipo'}
            </p>
          </div>

          {loading ? (
            <div className="p-4 text-sm text-white/70">Cargando chat...</div>
          ) : null}

          {!loading && !canAccess ? (
            <div className="p-4 text-sm text-white/75">
              Solo los miembros confirmados del equipo pueden acceder al chat.
            </div>
          ) : null}

          {!loading && canAccess ? (
            <>
              <div className="h-[52dvh] min-h-[320px] max-h-[62dvh] overflow-y-auto p-3 bg-slate-900/80 space-y-2.5">
                {messages.length === 0 ? (
                  <p className="text-sm text-white/65">Aun no hay mensajes. Inicien la conversacion.</p>
                ) : null}

                {messages.map((message) => {
                  const authorColor = getAuthorColor(message?.autor);
                  return (
                    <div
                      key={message.id}
                      className="rounded-lg border-l-[3px] border-white/10 bg-slate-800 p-3"
                      style={{ borderLeftColor: authorColor }}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="font-oswald text-sm font-semibold" style={{ color: authorColor }}>
                          {message?.autor || 'Usuario'}
                        </span>
                        <span className="text-[11px] text-white/50">
                          {formatTime(message?.timestamp || message?.created_at)}
                        </span>
                      </div>
                      <p className="text-sm leading-[1.4] text-white/90 break-words">{message?.mensaje || ''}</p>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-white/10 bg-slate-800/75 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  placeholder="Escribi un mensaje..."
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-oswald text-white outline-none transition-all focus:border-[#0EA9C6] focus:ring-2 focus:ring-[#0EA9C6]/20"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !sending && newMessage.trim()) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={sending}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !newMessage.trim()}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#0EA9C6] text-white transition-all hover:bg-[#0c94a8] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Enviar mensaje"
                >
                  {sending ? '...' : '➤'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    </PageTransition>
  );
};

export default TeamChatPage;
