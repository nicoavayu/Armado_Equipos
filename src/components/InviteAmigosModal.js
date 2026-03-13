import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { getAmigos, supabase } from '../supabase';
import LoadingSpinner from './LoadingSpinner';
import { formatLocalDateShort } from '../utils/dateLocal';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { requestImmediatePushDispatchSafe } from '../services/pushDispatchService';

const normalizeInviteMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'request_join' ? 'request_join' : 'direct';
};

const INVITE_CACHE_PREFIX = 'match_pending_invites_v1';

const normalizeInviteStatus = (value) => String(value || 'pending').trim().toLowerCase();
const REINVITABLE_INVITE_STATUSES = new Set([
  'declined',
  'rejected',
  'kicked',
  'revoked',
  'expired',
  'cancelled',
  'canceled',
]);

const getInviteTimestampMs = (row) => {
  const raw = row?.send_at || row?.created_at || null;
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const shouldBlockInvitationForStatus = (statusValue) => {
  const status = normalizeInviteStatus(statusValue);
  return !REINVITABLE_INVITE_STATUSES.has(status);
};

const buildInviteCacheKey = (matchId) => `${INVITE_CACHE_PREFIX}:${String(matchId || '').trim()}`;

const readCachedInvitedFriendIds = (matchId) => {
  const matchIdText = String(matchId || '').trim();
  if (!matchIdText) return new Set();
  try {
    const raw = localStorage.getItem(buildInviteCacheKey(matchIdText));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );
  } catch (_error) {
    return new Set();
  }
};

const writeCachedInvitedFriendIds = (matchId, friendIds = []) => {
  const matchIdText = String(matchId || '').trim();
  if (!matchIdText) return;
  try {
    const normalized = Array.from(friendIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    localStorage.setItem(buildInviteCacheKey(matchIdText), JSON.stringify(normalized));
  } catch (_error) {
    // Ignore localStorage failures (private mode / quota).
  }
};

const collectBlockedInviteUserIds = (rows = []) => {
  const latestByUser = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const userId = String(row?.user_id || '').trim();
    if (!userId) return;
    const ts = getInviteTimestampMs(row);
    const current = latestByUser.get(userId);
    if (!current || ts >= current.ts) {
      latestByUser.set(userId, { row, ts });
    }
  });

  const blocked = new Set();
  latestByUser.forEach(({ row }, userId) => {
    if (shouldBlockInvitationForStatus(row?.data?.status)) {
      blocked.add(userId);
    }
  });
  return blocked;
};

const InviteAmigosModal = ({
  isOpen,
  onClose,
  currentUserId,
  partidoActual,
  jugadores = [],
  mode = 'direct',
  invitationsOpen = false,
}) => {
  const [amigos, setAmigos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invitedFriends, setInvitedFriends] = useState(new Set());
  const [selectedFriendIds, setSelectedFriendIds] = useState(new Set());
  const inviteMode = normalizeInviteMode(mode);
  const isRequestJoinMode = inviteMode === 'request_join';

  const visibleFriends = useMemo(
    () => amigos.filter((amigo) => !invitedFriends.has(String(amigo.id || '').trim())),
    [amigos, invitedFriends],
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      return;
    }
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
  }, [isOpen]);

  useEffect(() => () => {
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
  }, []);

  useEffect(() => {
    if (!isOpen || !currentUserId) return;
    fetchAmigos();
  }, [isOpen, currentUserId]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFriendIds(new Set());
    }
  }, [isOpen]);

  const fetchAmigos = async () => {
    setLoading(true);
    try {
      const friendsData = await getAmigos(currentUserId);

      const filteredFriends = (friendsData || []).filter((friend) => {
        if (friend.id === partidoActual?.creado_por) return false;
        const isAlreadyInMatch = jugadores.some((p) =>
          p.usuario_id === friend.id || p.uuid === friend.id,
        );
        return !isAlreadyInMatch;
      });

      setAmigos(filteredFriends);
      const friendIds = filteredFriends
        .map((friend) => String(friend.id || '').trim())
        .filter(Boolean);
      const friendIdSet = new Set(friendIds);
      const cachedBlockedIds = new Set(
        Array.from(readCachedInvitedFriendIds(partidoActual?.id)).filter((id) => friendIdSet.has(id)),
      );
      if (filteredFriends.length === 0) {
        writeCachedInvitedFriendIds(partidoActual?.id, []);
        setInvitedFriends(new Set());
        return;
      }

      if (partidoActual?.id) {
        if (partidoActual.id === 'undefined' || partidoActual.id === 'null') {
          console.warn('[MODAL_AMIGOS] Invalid partidoActual.id, skipping invitation check');
          setInvitedFriends(cachedBlockedIds);
          writeCachedInvitedFriendIds(partidoActual?.id, cachedBlockedIds);
        } else {
          let blockedFromDb = new Set();

          const { data: extData, error: extError } = await supabase
            .from('notifications_ext')
            .select('id, user_id, data, send_at, created_at')
            .eq('type', 'match_invite')
            .eq('match_id_text', partidoActual.id.toString())
            .in('user_id', friendIds);

          if (extError && extError.code !== '42P01') {
            throw extError;
          }

          if (!extError) {
            blockedFromDb = collectBlockedInviteUserIds(extData || []);
          } else {
            const { data: fallbackRows, error: fallbackError } = await supabase
              .from('notifications')
              .select('id, user_id, data, send_at, created_at, partido_id, match_ref')
              .eq('type', 'match_invite')
              .eq('partido_id', Number(partidoActual.id))
              .in('user_id', friendIds);
            if (fallbackError) throw fallbackError;
            blockedFromDb = collectBlockedInviteUserIds(fallbackRows || []);
          }

          const mergedBlocked = new Set([...cachedBlockedIds, ...blockedFromDb]);
          setInvitedFriends(mergedBlocked);
          writeCachedInvitedFriendIds(partidoActual?.id, mergedBlocked);
        }
      } else {
        setInvitedFriends(cachedBlockedIds);
        writeCachedInvitedFriendIds(partidoActual?.id, cachedBlockedIds);
      }
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error fetching friends:', error);
      setAmigos([]);
      const cachedBlockedIds = readCachedInvitedFriendIds(partidoActual?.id);
      setInvitedFriends(cachedBlockedIds);
    } finally {
      setLoading(false);
    }
  };

  const getInviteContext = async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Usuario no autenticado');
    }

    const senderLookupId = currentUserId || user.id;
    const { data: currentUser, error: userError } = await supabase
      .from('usuarios')
      .select('nombre')
      .eq('id', senderLookupId)
      .maybeSingle();

    if (userError) {
      throw new Error(`Error obteniendo datos del usuario: ${userError.message}`);
    }

    return {
      senderName: currentUser?.nombre || 'Alguien',
    };
  };

  const buildInviteMessage = (senderName) => {
    const dateLabel = partidoActual?.fecha ? formatLocalDateShort(partidoActual.fecha) : '';
    const timeLabel = partidoActual?.hora || '';

    if (isRequestJoinMode) {
      return {
        title: 'Partido sugerido',
        message: `${senderName} te sugirió un partido para que solicites unirte.`,
      };
    }

    return {
      title: 'Invitación a partido',
      message: `${senderName} te invitó a jugar el ${dateLabel} a las ${timeLabel}`,
    };
  };

  const sendInviteToFriend = async (amigo, inviteContext) => {
    if (!partidoActual?.id) {
      throw new Error('No hay partido seleccionado');
    }
    const friendIdText = String(amigo?.id || '').trim();
    if (friendIdText && invitedFriends.has(friendIdText)) {
      return { status: 'already_invited' };
    }

    const { data: existingRows, error: existingError } = await supabase
      .from('notifications_ext')
      .select('id, data, send_at, created_at')
      .eq('user_id', amigo.id)
      .eq('type', 'match_invite')
      .eq('match_id_text', partidoActual.id.toString())
      .order('send_at', { ascending: false })
      .limit(1);

    if (existingError && existingError.code !== '42P01') {
      throw new Error(existingError.message || 'No se pudo validar invitaciones existentes');
    }

    if (Array.isArray(existingRows) && existingRows.length > 0 && shouldBlockInvitationForStatus(existingRows[0]?.data?.status)) {
      return { status: 'already_invited' };
    }

    if (existingError && existingError.code === '42P01') {
      const { data: rawExistingRows, error: rawExistingError } = await supabase
        .from('notifications')
        .select('id, data, send_at, created_at')
        .eq('user_id', amigo.id)
        .eq('type', 'match_invite')
        .eq('partido_id', Number(partidoActual.id))
        .order('send_at', { ascending: false })
        .limit(1);

      if (rawExistingError) {
        throw new Error(rawExistingError.message || 'No se pudo validar invitaciones existentes');
      }

      if (Array.isArray(rawExistingRows) && rawExistingRows.length > 0 && shouldBlockInvitationForStatus(rawExistingRows[0]?.data?.status)) {
        return { status: 'already_invited' };
      }
    }

    const { data: recipientUser, error: recipientError } = await supabase
      .from('usuarios')
      .select('acepta_invitaciones')
      .eq('id', amigo.id)
      .maybeSingle();

    if (recipientError) {
      throw new Error(`Error validando disponibilidad del destinatario: ${recipientError.message}`);
    }

    if (recipientUser?.acepta_invitaciones === false) {
      return { status: 'recipient_unavailable' };
    }

    const copy = buildInviteMessage(inviteContext.senderName);

    const { error } = await supabase.rpc('send_match_invite', {
      p_user_id: amigo.id,
      p_partido_id: Number(partidoActual.id),
      p_title: copy.title,
      p_message: copy.message,
      p_invite_mode: inviteMode,
    });

    if (error) {
      throw error;
    }

    return { status: 'sent' };
  };

  const handleInviteError = (error) => {
    const rawMessage = String(error?.message || '').toLowerCase();
    if (rawMessage.includes('invitations_closed')) {
      notifyBlockingError('El partido no está abierto para sugerencias.');
      return;
    }
    if (rawMessage.includes('guest_direct_invite_forbidden')) {
      notifyBlockingError('Solo podés enviar sugerencias para solicitar unirme.');
      return;
    }
    if (rawMessage.includes('actor_not_in_match')) {
      notifyBlockingError('Debes formar parte del partido para sugerirlo.');
      return;
    }
    notifyBlockingError('Error al enviar la invitación');
  };

  const handleInvitar = async (amigo) => {
    if (!partidoActual?.id) {
      notifyBlockingError('No hay partido seleccionado.');
      return;
    }

    if (isRequestJoinMode && !invitationsOpen) {
      notifyBlockingError('El partido no está abierto para sugerencias.');
      return;
    }

    setInviting(true);
    try {
      const inviteContext = await getInviteContext();
      const result = await sendInviteToFriend(amigo, inviteContext);
      const friendIdText = String(amigo?.id || '').trim();

      if (result.status === 'already_invited') {
        setInvitedFriends((prev) => {
          const next = new Set(prev);
          if (friendIdText) next.add(friendIdText);
          writeCachedInvitedFriendIds(partidoActual?.id, next);
          return next;
        });
        return;
      }

      if (result.status === 'recipient_unavailable') {
        return;
      }

      if (result.status === 'sent') {
        requestImmediatePushDispatchSafe({
          eventType: 'match_invite',
          matchId: Number(partidoActual?.id),
          recipientUserId: amigo?.id,
          limit: 20,
        });
      }

      setInvitedFriends((prev) => {
        const next = new Set(prev);
        if (friendIdText) next.add(friendIdText);
        writeCachedInvitedFriendIds(partidoActual?.id, next);
        return next;
      });
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending invite:', error);
      handleInviteError(error);
    } finally {
      setInviting(false);
    }
  };

  const toggleFriendSelection = (friendId) => {
    if (inviting) return;
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) {
        next.delete(friendId);
      } else {
        next.add(friendId);
      }
      return next;
    });
  };

  const handleSendSelected = async () => {
    if (!isRequestJoinMode) return;
    if (!invitationsOpen) {
      notifyBlockingError('El partido no está abierto para sugerencias.');
      return;
    }

    const selectedFriends = visibleFriends.filter((friend) => selectedFriendIds.has(friend.id));
    if (selectedFriends.length === 0) {
      notifyBlockingError('Seleccioná al menos un amigo.');
      return;
    }

    setInviting(true);
    try {
      const inviteContext = await getInviteContext();
      const sentIds = [];
      const alreadyInvitedIds = [];

      for (const friend of selectedFriends) {
        const result = await sendInviteToFriend(friend, inviteContext);
        if (result.status === 'sent') {
          sentIds.push(friend.id);
        } else if (result.status === 'already_invited') {
          alreadyInvitedIds.push(friend.id);
        }
      }

      if (sentIds.length > 0 || alreadyInvitedIds.length > 0) {
        setInvitedFriends((prev) => {
          const next = new Set(prev);
          [...sentIds, ...alreadyInvitedIds]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .forEach((id) => next.add(id));
          writeCachedInvitedFriendIds(partidoActual?.id, next);
          return next;
        });
      }

      if (sentIds.length > 0) {
        requestImmediatePushDispatchSafe({
          eventType: 'match_invite',
          matchId: Number(partidoActual?.id),
          limit: Math.max(20, Math.min(60, sentIds.length * 10)),
        });
      }

      setSelectedFriendIds(new Set());
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending selected invites:', error);
      handleInviteError(error);
    } finally {
      setInviting(false);
    }
  };

  if (!isOpen) return null;

  const title = isRequestJoinMode ? 'Sugerir partido a un amigo' : 'Invitar amigos';
  const emptyLabel = isRequestJoinMode ? 'No tenés amigos para sugerir' : 'No tenés amigos para invitar';
  const noMoreLabel = isRequestJoinMode ? 'No tenés más amigos para sugerir' : 'No tenés más amigos para invitar';
  const selectedCount = selectedFriendIds.size;

  const modalContent = (
    <div data-modal-root="true" className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] p-5" onClick={onClose}>
      <div
        className="bg-[#1a1a1a] rounded-xl w-[calc(100vw-40px)] max-w-[360px] max-h-[80vh] overflow-hidden border-2 border-[#333] sm:w-[300px] sm:max-w-[calc(100vw-32px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-5 py-4 border-b border-[#333] bg-[#222]">
          <h3 className="text-white m-0 text-lg font-semibold">{title}</h3>
          <button
            className="bg-transparent border-none text-white text-2xl cursor-pointer p-0 w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/10"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {isRequestJoinMode && (
            <p className="m-0 mb-2 text-white/70 text-xs">
              Seleccioná uno o más amigos para enviarles una sugerencia.
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner size="medium" fullScreen />
            </div>
          ) : amigos.length === 0 ? (
            <div className="text-center text-white/70 py-10 px-5 text-base">
              {emptyLabel}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visibleFriends.length === 0 ? (
                <div className="text-center text-white/70 py-10 px-5 text-base">
                  {noMoreLabel}
                </div>
              ) : (
                visibleFriends.map((amigo) => {
                  const isSelected = selectedFriendIds.has(amigo.id);
                  return (
                    <div
                      key={amigo.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${isSelected ? 'bg-[#2a3b57] border-[#5d83c6]' : 'bg-white/5 border-white/10 hover:bg-white/[0.08] hover:border-white/20'} ${isRequestJoinMode ? 'cursor-pointer' : ''}`}
                      onClick={isRequestJoinMode ? () => toggleFriendSelection(amigo.id) : undefined}
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
                      {isRequestJoinMode ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleFriendSelection(amigo.id)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={inviting}
                          className="w-4 h-4 accent-[#644dff] cursor-pointer"
                        />
                      ) : (
                        <button
                          onClick={() => handleInvitar(amigo)}
                          className="border-none rounded-md px-4 py-2 text-sm font-semibold cursor-pointer transition-all duration-200 shrink-0 min-w-[80px] bg-[#007bff] text-white hover:bg-[#0056b3] hover:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
                          disabled={inviting}
                          type="button"
                        >
                          {inviting ? '...' : 'Invitar'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {isRequestJoinMode && visibleFriends.length > 0 ? (
          <div className="px-5 py-3 border-t border-[#333] bg-[#222]">
            <div className="text-[12px] text-white/70 mb-2">
              {selectedCount > 0
                ? `${selectedCount} seleccionado${selectedCount > 1 ? 's' : ''}`
                : 'Seleccioná amigos para enviar la sugerencia'}
            </div>
            <button
              type="button"
              onClick={handleSendSelected}
              disabled={inviting || selectedCount === 0 || !invitationsOpen}
              className="w-full h-10 rounded-md border border-[#7d5aff] bg-[#6a43ff] text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
            >
              {inviting ? 'Enviando...' : 'Enviar sugerencia'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default InviteAmigosModal;
