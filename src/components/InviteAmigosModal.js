import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { getAmigos, supabase } from '../supabase';
import LoadingSpinner from './LoadingSpinner';
import { formatLocalDateShort } from '../utils/dateLocal';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { showGlobalNotice } from '../utils/globalNoticeModal';
import { requestImmediatePushDispatchSafe } from '../services/pushDispatchService';
import { track } from '../utils/monitoring/analytics';
import {
  buildInviteStateByUser,
  buildMatchNotificationOrFilter,
  normalizeSendMatchInviteResult,
} from '../utils/matchInviteState';

const isUuidLike = (value) => (
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
);

const resolveFriendUserId = (friend) => {
  const candidates = [
    friend?.id,
    friend?.user_id,
    friend?.usuario_id,
    friend?.friend_user_id,
    friend?.amigo_usuario_id,
    friend?.uuid,
    friend?.user?.id,
    friend?.usuario?.id,
    friend?.profile?.id,
    friend?.profile?.user_id,
    friend?.profile?.usuario_id,
    friend?.profile?.friend_user_id,
    friend?.profile?.amigo_usuario_id,
    friend?.profile?.uuid,
    friend?.profile?.user?.id,
    friend?.profile?.usuario?.id,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (isUuidLike(normalized)) {
      return normalized;
    }
  }

  return null;
};

const normalizeFriendEntry = (friend) => {
  const userId = resolveFriendUserId(friend);
  if (!userId) return null;

  const profile = friend?.profile || {};
  return {
    ...friend,
    id: userId,
    relationshipId: friend?.relationshipId || friend?.id || null,
    nombre: friend?.nombre || profile?.nombre || 'Usuario',
    avatar_url: friend?.avatar_url || profile?.avatar_url || null,
    profile: {
      ...profile,
      id: userId,
      nombre: profile?.nombre || friend?.nombre || 'Usuario',
      avatar_url: profile?.avatar_url || friend?.avatar_url || null,
    },
  };
};

const normalizeInviteMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'request_join' ? 'request_join' : 'direct';
};

const INVITE_CACHE_PREFIX = 'match_pending_invites_v1';

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

const showInviteNotice = (payload) => showGlobalNotice({
  confirmText: 'Entendido',
  ...payload,
});

const showDirectInviteResultNotice = ({ status, friendName, matchName }) => {
  const safeMatchName = matchName || 'este partido';

  if (status === 'reinvited') {
    showInviteNotice({
      title: 'Reinvitación enviada',
      message: `La reinvitación para ${friendName} a "${safeMatchName}" se envió correctamente.`,
    });
    return;
  }

  if (status === 'already_pending') {
    showInviteNotice({
      title: 'Invitación pendiente',
      message: `${friendName} ya tiene una invitación pendiente para "${safeMatchName}".`,
    });
    return;
  }

  if (status === 'already_in_match') {
    showInviteNotice({
      title: 'Jugador ya en el partido',
      message: `${friendName} ya forma parte de "${safeMatchName}".`,
    });
    return;
  }

  if (status === 'recipient_unavailable') {
    showInviteNotice({
      title: 'Invitaciones desactivadas',
      message: `${friendName} no está recibiendo invitaciones en este momento.`,
    });
    return;
  }

  showInviteNotice({
    title: 'Invitación enviada',
    message: `La invitación para ${friendName} a "${safeMatchName}" se envió correctamente.`,
  });
};

const showBulkInviteResultNotice = ({
  sentCount,
  reinvitedCount,
  pendingCount,
  unavailableCount,
  alreadyInMatchCount,
}) => {
  const lines = [];

  if (sentCount > 0) {
    lines.push(`${sentCount} invitación${sentCount === 1 ? '' : 'es'} enviada${sentCount === 1 ? '' : 's'} correctamente.`);
  }
  if (reinvitedCount > 0) {
    lines.push(`${reinvitedCount} reinvitación${reinvitedCount === 1 ? '' : 'es'} enviada${reinvitedCount === 1 ? '' : 's'} correctamente.`);
  }
  if (pendingCount > 0) {
    lines.push(`${pendingCount} amigo${pendingCount === 1 ? '' : 's'} ya tenía${pendingCount === 1 ? '' : 'n'} una invitación pendiente.`);
  }
  if (alreadyInMatchCount > 0) {
    lines.push(`${alreadyInMatchCount} amigo${alreadyInMatchCount === 1 ? '' : 's'} ya forma${alreadyInMatchCount === 1 ? '' : 'n'} parte del partido.`);
  }
  if (unavailableCount > 0) {
    lines.push(`${unavailableCount} amigo${unavailableCount === 1 ? '' : 's'} tiene${unavailableCount === 1 ? '' : 'n'} las invitaciones desactivadas.`);
  }

  if (lines.length === 0) {
    showInviteNotice({
      title: 'Sin cambios',
      message: 'No se pudo enviar ninguna invitación.',
    });
    return;
  }

  showInviteNotice({
    title: 'Resultado de invitaciones',
    message: lines.join(' '),
  });
};

const handleInviteRpcError = (error) => {
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
  if (rawMessage.includes('recipient_not_found')) {
    notifyBlockingError('No se encontró al jugador seleccionado.');
    return;
  }
  notifyBlockingError('Error al procesar la invitación');
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

      const unresolvedFriends = [];
      const normalizedFriends = (friendsData || [])
        .map((friend) => {
          const normalizedFriend = normalizeFriendEntry(friend);
          if (!normalizedFriend) {
            unresolvedFriends.push({
              rawFriendId: friend?.id,
              relationshipId: friend?.relationshipId,
              friendUserId: friend?.friend_user_id,
              amigoUsuarioId: friend?.amigo_usuario_id,
              userId: friend?.user_id,
              usuarioId: friend?.usuario_id,
              profileId: friend?.profile?.id,
            });
          }
          return normalizedFriend;
        })
        .filter(Boolean);

      if (unresolvedFriends.length > 0) {
        console.warn('[MODAL_AMIGOS] Friends dropped because no UUID recipient could be resolved', unresolvedFriends);
      }

      const filteredFriends = normalizedFriends.filter((friend) => {
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
            .select('id, user_id, type, data, send_at, created_at')
            .in('type', ['match_invite', 'match_kicked'])
            .eq('match_id_text', partidoActual.id.toString())
            .in('user_id', friendIds);

          if (extError && extError.code !== '42P01') {
            throw extError;
          }

          if (!extError) {
            blockedFromDb = new Set(
              Array.from(buildInviteStateByUser(extData || []).entries())
                .filter(([, inviteState]) => inviteState?.hasPendingInvite)
                .map(([userId]) => userId),
            );
          } else {
            let fallbackQuery = supabase
              .from('notifications')
              .select('id, user_id, type, data, send_at, created_at, partido_id, match_ref')
              .in('type', ['match_invite', 'match_kicked'])
              .in('user_id', friendIds);

            const matchFilter = buildMatchNotificationOrFilter(partidoActual.id);
            if (matchFilter) {
              fallbackQuery = fallbackQuery.or(matchFilter);
            }

            const { data: fallbackRows, error: fallbackError } = await fallbackQuery;
            if (fallbackError) throw fallbackError;
            blockedFromDb = new Set(
              Array.from(buildInviteStateByUser(fallbackRows || []).entries())
                .filter(([, inviteState]) => inviteState?.hasPendingInvite)
                .map(([userId]) => userId),
            );
          }

          setInvitedFriends(blockedFromDb);
          writeCachedInvitedFriendIds(partidoActual?.id, blockedFromDb);
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
    const recipientUserId = resolveFriendUserId(amigo);
    if (!recipientUserId) {
      console.error('[MODAL_AMIGOS] Could not resolve recipient UUID for invite', {
        rawFriendId: amigo?.id,
        relationshipId: amigo?.relationshipId,
        friendUserId: amigo?.friend_user_id,
        amigoUsuarioId: amigo?.amigo_usuario_id,
        userId: amigo?.user_id,
        usuarioId: amigo?.usuario_id,
        profileId: amigo?.profile?.id,
      });
      throw new Error('recipient_not_found');
    }
    const copy = buildInviteMessage(inviteContext.senderName);

    const { data, error } = await supabase.rpc('send_match_invite', {
      p_user_id: recipientUserId,
      p_partido_id: Number(partidoActual.id),
      p_title: copy.title,
      p_message: copy.message,
      p_invite_mode: inviteMode,
    });

    if (error) {
      throw error;
    }

    return { status: normalizeSendMatchInviteResult(data) };
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
      const recipientUserId = resolveFriendUserId(amigo);
      if (!recipientUserId) {
        notifyBlockingError('No se pudo identificar al amigo seleccionado para invitar.');
        return;
      }
      const result = await sendInviteToFriend(amigo, inviteContext);
      const friendIdText = recipientUserId;
      const resultStatus = String(result?.status || '').trim().toLowerCase() || 'sent';

      if (resultStatus === 'sent' || resultStatus === 'reinvited') {
        requestImmediatePushDispatchSafe({
          eventType: 'match_invite',
          matchId: Number(partidoActual?.id),
          recipientUserId,
          limit: 20,
        });
        track('match_invite_sent', {
          match_id: Number(partidoActual?.id),
          recipient_user_id: recipientUserId,
          source: 'invite_amigos_modal',
          invite_result: resultStatus,
        });
        setInvitedFriends((prev) => {
          const next = new Set(prev);
          if (friendIdText) next.add(friendIdText);
          writeCachedInvitedFriendIds(partidoActual?.id, next);
          return next;
        });
        showDirectInviteResultNotice({
          status: resultStatus,
          friendName: amigo?.nombre || 'este jugador',
          matchName: partidoActual?.nombre,
        });
        return;
      }

      if (resultStatus === 'already_pending') {
        setInvitedFriends((prev) => {
          const next = new Set(prev);
          if (friendIdText) next.add(friendIdText);
          writeCachedInvitedFriendIds(partidoActual?.id, next);
          return next;
        });
        showDirectInviteResultNotice({
          status: resultStatus,
          friendName: amigo?.nombre || 'este jugador',
          matchName: partidoActual?.nombre,
        });
        return;
      }

      if (resultStatus === 'already_in_match') {
        setAmigos((prev) => prev.filter((friend) => String(friend?.id || '').trim() !== friendIdText));
        setSelectedFriendIds((prev) => {
          const next = new Set(prev);
          next.delete(recipientUserId);
          return next;
        });
        showDirectInviteResultNotice({
          status: resultStatus,
          friendName: amigo?.nombre || 'este jugador',
          matchName: partidoActual?.nombre,
        });
        return;
      }

      if (resultStatus === 'recipient_unavailable') {
        showDirectInviteResultNotice({
          status: resultStatus,
          friendName: amigo?.nombre || 'este jugador',
          matchName: partidoActual?.nombre,
        });
        return;
      }

      notifyBlockingError('Error al procesar la invitación');
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending invite:', error);
      handleInviteRpcError(error);
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

    const invalidSelectedFriend = selectedFriends.find((friend) => !resolveFriendUserId(friend));
    if (invalidSelectedFriend) {
      console.error('[MODAL_AMIGOS] Could not resolve recipient UUID for selected invite', {
        rawFriendId: invalidSelectedFriend?.id,
        relationshipId: invalidSelectedFriend?.relationshipId,
        friendUserId: invalidSelectedFriend?.friend_user_id,
        amigoUsuarioId: invalidSelectedFriend?.amigo_usuario_id,
        userId: invalidSelectedFriend?.user_id,
        usuarioId: invalidSelectedFriend?.usuario_id,
        profileId: invalidSelectedFriend?.profile?.id,
      });
      notifyBlockingError('No se pudo identificar a uno de los amigos seleccionados para invitar.');
      return;
    }

    setInviting(true);
    try {
      const inviteContext = await getInviteContext();
      const sentIds = [];
      const reinvitedIds = [];
      const alreadyPendingIds = [];
      const unavailableIds = [];
      const alreadyInMatchIds = [];

      for (const friend of selectedFriends) {
        const result = await sendInviteToFriend(friend, inviteContext);
        const resultStatus = String(result?.status || '').trim().toLowerCase() || 'sent';
        if (resultStatus === 'sent') {
          sentIds.push(friend.id);
        } else if (resultStatus === 'reinvited') {
          reinvitedIds.push(friend.id);
        } else if (resultStatus === 'already_pending') {
          alreadyPendingIds.push(friend.id);
        } else if (resultStatus === 'recipient_unavailable') {
          unavailableIds.push(friend.id);
        } else if (resultStatus === 'already_in_match') {
          alreadyInMatchIds.push(friend.id);
        }
      }

      [...sentIds, ...reinvitedIds].forEach((friendId) => {
          const parsedFriendId = String(friendId || '').trim();
          if (!parsedFriendId) return;
          track('match_invite_sent', {
            match_id: Number(partidoActual?.id),
            recipient_user_id: parsedFriendId,
            source: 'invite_amigos_modal_bulk',
          });
      });

      if (sentIds.length > 0 || reinvitedIds.length > 0 || alreadyPendingIds.length > 0) {
        setInvitedFriends((prev) => {
          const next = new Set(prev);
          [...sentIds, ...reinvitedIds, ...alreadyPendingIds]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .forEach((id) => next.add(id));
          writeCachedInvitedFriendIds(partidoActual?.id, next);
          return next;
        });
      }

      if (alreadyInMatchIds.length > 0) {
        const alreadyInMatchSet = new Set(
          alreadyInMatchIds.map((value) => String(value || '').trim()).filter(Boolean),
        );
        setAmigos((prev) => prev.filter((friend) => !alreadyInMatchSet.has(String(friend?.id || '').trim())));
      }

      if (sentIds.length > 0 || reinvitedIds.length > 0) {
        requestImmediatePushDispatchSafe({
          eventType: 'match_invite',
          matchId: Number(partidoActual?.id),
          limit: Math.max(20, Math.min(60, (sentIds.length + reinvitedIds.length) * 10)),
        });
      }

      setSelectedFriendIds(new Set());
      showBulkInviteResultNotice({
        sentCount: sentIds.length,
        reinvitedCount: reinvitedIds.length,
        pendingCount: alreadyPendingIds.length,
        unavailableCount: unavailableIds.length,
        alreadyInMatchCount: alreadyInMatchIds.length,
      });
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending selected invites:', error);
      handleInviteRpcError(error);
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
