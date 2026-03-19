import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import {
  getAmigos,
  getPrivateGroupsByOwner,
  resolveInviteRecipientsFromGroups,
  supabase,
} from '../supabase';
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

const normalizeUniqueCount = (values = []) => new Set(
  (Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean),
).size;

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

const showDirectInviteBlockerNotice = ({ status, friendName, matchName }) => {
  const safeMatchName = matchName || 'este partido';

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
};

const showBulkInviteBlockerNotice = ({ pendingCount, unavailableCount, alreadyInMatchCount }) => {
  const lines = [];

  if (pendingCount > 0) {
    lines.push(`${pendingCount} amigo${pendingCount === 1 ? '' : 's'} ya tenía${pendingCount === 1 ? '' : 'n'} una invitación pendiente.`);
  }
  if (alreadyInMatchCount > 0) {
    lines.push(`${alreadyInMatchCount} amigo${alreadyInMatchCount === 1 ? '' : 's'} ya forma${alreadyInMatchCount === 1 ? '' : 'n'} parte del partido.`);
  }
  if (unavailableCount > 0) {
    lines.push(`${unavailableCount} amigo${unavailableCount === 1 ? '' : 's'} tiene${unavailableCount === 1 ? '' : 'n'} las invitaciones desactivadas.`);
  }

  if (lines.length === 0) return;

  showInviteNotice({
    title: 'Resultado de invitaciones',
    message: lines.join(' '),
  });
};

const showGroupInviteSummaryNotice = ({
  sentCount = 0,
  reinvitedCount = 0,
  alreadyInvitedCount = 0,
  unavailableCount = 0,
  alreadyInMatchCount = 0,
  duplicateCount = 0,
  ineligibleCount = 0,
}) => {
  const lines = [];
  const deliveredCount = sentCount + reinvitedCount;

  if (deliveredCount > 0) {
    lines.push(
      deliveredCount === 1
        ? 'Se envió 1 invitación.'
        : `Se enviaron ${deliveredCount} invitaciones.`,
    );
  }
  if (duplicateCount > 0) {
    lines.push(
      duplicateCount === 1
        ? 'Se unificó 1 contacto repetido entre los grupos seleccionados.'
        : `Se unificaron ${duplicateCount} contactos repetidos entre los grupos seleccionados.`,
    );
  }
  if (alreadyInvitedCount > 0) {
    lines.push(`${alreadyInvitedCount} jugador${alreadyInvitedCount === 1 ? '' : 'es'} ya tenía${alreadyInvitedCount === 1 ? '' : 'n'} una invitación pendiente.`);
  }
  if (alreadyInMatchCount > 0) {
    lines.push(`${alreadyInMatchCount} jugador${alreadyInMatchCount === 1 ? '' : 'es'} ya forma${alreadyInMatchCount === 1 ? '' : 'n'} parte del partido.`);
  }
  if (unavailableCount > 0) {
    lines.push(`${unavailableCount} jugador${unavailableCount === 1 ? '' : 'es'} tiene${unavailableCount === 1 ? '' : 'n'} las invitaciones desactivadas.`);
  }
  if (ineligibleCount > 0) {
    lines.push(`${ineligibleCount} contacto${ineligibleCount === 1 ? '' : 's'} no pudo${ineligibleCount === 1 ? '' : 'ieron'} invitarse desde esos grupos.`);
  }

  if (lines.length === 0) return;

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
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [invitedFriends, setInvitedFriends] = useState(new Set());
  const [selectedFriendIds, setSelectedFriendIds] = useState(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState(new Set());
  const [inviteTab, setInviteTab] = useState('friends');
  const inviteMode = normalizeInviteMode(mode);
  const isRequestJoinMode = inviteMode === 'request_join';
  const canUseGroups = !isRequestJoinMode;

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
    if (!isOpen || !currentUserId || isRequestJoinMode) return;
    fetchGroups();
  }, [isOpen, currentUserId, isRequestJoinMode]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFriendIds(new Set());
      setSelectedGroupIds(new Set());
      setInviteTab('friends');
    }
  }, [isOpen]);

  const fetchAmigos = async () => {
    setLoading(true);
    try {
      const friendsData = await getAmigos(currentUserId);
      setFriendsError(null);

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
      setFriendsError(error?.message || 'No se pudieron cargar tus amigos.');
      setAmigos([]);
      const cachedBlockedIds = readCachedInvitedFriendIds(partidoActual?.id);
      setInvitedFriends(cachedBlockedIds);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    setGroupsLoading(true);
    try {
      const groupRows = await getPrivateGroupsByOwner(currentUserId);
      setGroupsError(null);
      setGroups(groupRows || []);
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error fetching groups:', error);
      setGroupsError(error?.message || 'No se pudieron cargar tus grupos.');
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  };

  const rememberBlockedInviteIds = (ids = []) => {
    setInvitedFriends((prev) => {
      const next = new Set(prev);
      ids
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .forEach((id) => next.add(id));
      writeCachedInvitedFriendIds(partidoActual?.id, next);
      return next;
    });
  };

  const removeFriendsAlreadyInMatch = (friendIds = []) => {
    const blockedIds = new Set(
      friendIds
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );

    if (blockedIds.size === 0) return;

    setAmigos((prev) => prev.filter((friend) => !blockedIds.has(String(friend?.id || '').trim())));
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      blockedIds.forEach((id) => next.delete(id));
      return next;
    });
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

  const sendInviteToUserId = async (recipientUserId, inviteContext) => {
    if (!partidoActual?.id) {
      throw new Error('No hay partido seleccionado');
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

  const sendInviteToFriend = async (amigo, inviteContext) => {
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

    return sendInviteToUserId(recipientUserId, inviteContext);
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
        rememberBlockedInviteIds([friendIdText]);
        return;
      }

      if (resultStatus === 'already_pending') {
        rememberBlockedInviteIds([friendIdText]);
        showDirectInviteBlockerNotice({
          status: resultStatus,
          friendName: amigo?.nombre || 'este jugador',
          matchName: partidoActual?.nombre,
        });
        return;
      }

      if (resultStatus === 'already_in_match') {
        removeFriendsAlreadyInMatch([friendIdText]);
        showDirectInviteBlockerNotice({
          status: resultStatus,
          friendName: amigo?.nombre || 'este jugador',
          matchName: partidoActual?.nombre,
        });
        return;
      }

      if (resultStatus === 'recipient_unavailable') {
        showDirectInviteBlockerNotice({
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

  const toggleGroupSelection = (groupId) => {
    if (inviting) return;
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
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
        rememberBlockedInviteIds([...sentIds, ...reinvitedIds, ...alreadyPendingIds]);
      }

      if (alreadyInMatchIds.length > 0) {
        removeFriendsAlreadyInMatch(alreadyInMatchIds);
      }

      if (sentIds.length > 0 || reinvitedIds.length > 0) {
        requestImmediatePushDispatchSafe({
          eventType: 'match_invite',
          matchId: Number(partidoActual?.id),
          limit: Math.max(20, Math.min(60, (sentIds.length + reinvitedIds.length) * 10)),
        });
      }

      setSelectedFriendIds(new Set());
      showBulkInviteBlockerNotice({
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

  const handleSendSelectedGroups = async () => {
    if (isRequestJoinMode) return;
    if (!partidoActual?.id) {
      notifyBlockingError('No hay partido seleccionado.');
      return;
    }

    const groupIds = Array.from(selectedGroupIds);
    if (groupIds.length === 0) {
      notifyBlockingError('Seleccioná al menos un grupo.');
      return;
    }

    setInviting(true);
    try {
      const resolution = await resolveInviteRecipientsFromGroups({
        matchId: partidoActual.id,
        ownerUserId: currentUserId,
        selectedGroupIds: groupIds,
      });

      const recipients = resolution?.recipients || [];
      const skipped = resolution?.skipped || {};
      const sentIds = [];
      const reinvitedIds = [];
      const alreadyPendingIds = (skipped?.already_invited || []).map((entry) => entry?.user_id || entry?.id);
      const ineligibleIds = (skipped?.ineligible || []).map((entry) => entry?.user_id || entry?.id);
      const unavailableIds = [];
      const alreadyInMatchIds = (skipped?.already_in_match || []).map((entry) => entry?.user_id || entry?.id);
      const duplicateCount = Array.isArray(skipped?.duplicate) ? skipped.duplicate.length : 0;

      if (recipients.length > 0) {
        const inviteContext = await getInviteContext();

        for (const recipient of recipients) {
          const recipientUserId = String(recipient?.user_id || recipient?.id || '').trim();
          if (!recipientUserId) continue;

          const result = await sendInviteToUserId(recipientUserId, inviteContext);
          const resultStatus = String(result?.status || '').trim().toLowerCase() || 'sent';

          if (resultStatus === 'sent') {
            sentIds.push(recipientUserId);
          } else if (resultStatus === 'reinvited') {
            reinvitedIds.push(recipientUserId);
          } else if (resultStatus === 'already_pending') {
            alreadyPendingIds.push(recipientUserId);
          } else if (resultStatus === 'recipient_unavailable') {
            unavailableIds.push(recipientUserId);
          } else if (resultStatus === 'already_in_match') {
            alreadyInMatchIds.push(recipientUserId);
          }
        }
      }

      [...sentIds, ...reinvitedIds].forEach((recipientUserId) => {
        track('match_invite_sent', {
          match_id: Number(partidoActual?.id),
          recipient_user_id: recipientUserId,
          source: 'invite_amigos_modal_groups',
        });
      });

      if (sentIds.length > 0 || reinvitedIds.length > 0 || alreadyPendingIds.length > 0) {
        rememberBlockedInviteIds([...sentIds, ...reinvitedIds, ...alreadyPendingIds]);
      }

      if (alreadyInMatchIds.length > 0) {
        removeFriendsAlreadyInMatch(alreadyInMatchIds);
      }

      if (sentIds.length > 0 || reinvitedIds.length > 0) {
        requestImmediatePushDispatchSafe({
          eventType: 'match_invite',
          matchId: Number(partidoActual?.id),
          limit: Math.max(20, Math.min(80, (sentIds.length + reinvitedIds.length) * 10)),
        });
      }

      setSelectedGroupIds(new Set());
      if (
        sentIds.length === 0
        && reinvitedIds.length === 0
        && normalizeUniqueCount(alreadyPendingIds) === 0
        && normalizeUniqueCount(unavailableIds) === 0
        && normalizeUniqueCount(alreadyInMatchIds) === 0
        && normalizeUniqueCount(ineligibleIds) === 0
        && duplicateCount === 0
      ) {
        showInviteNotice({
          title: 'Sin destinatarios',
          message: 'Los grupos seleccionados no tienen amigos disponibles para invitar.',
        });
        return;
      }

      showGroupInviteSummaryNotice({
        sentCount: sentIds.length,
        reinvitedCount: reinvitedIds.length,
        alreadyInvitedCount: normalizeUniqueCount(alreadyPendingIds),
        unavailableCount: normalizeUniqueCount(unavailableIds),
        alreadyInMatchCount: normalizeUniqueCount(alreadyInMatchIds),
        duplicateCount,
        ineligibleCount: normalizeUniqueCount(ineligibleIds),
      });
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending group invites:', error);
      handleInviteRpcError(error);
    } finally {
      setInviting(false);
    }
  };

  if (!isOpen) return null;

  const title = isRequestJoinMode ? 'Sugerir partido a un amigo' : 'Invitar';
  const emptyLabel = isRequestJoinMode
    ? 'No tenés amigos para sugerir'
    : inviteTab === 'groups'
      ? 'Todavía no creaste grupos.'
      : 'No tenés amigos para invitar';
  const noMoreLabel = isRequestJoinMode ? 'No tenés más amigos para sugerir' : 'No tenés más amigos para invitar';
  const selectedCount = selectedFriendIds.size;
  const selectedGroupCount = selectedGroupIds.size;

  const modalContent = (
    <div data-modal-root="true" className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] p-5" onClick={onClose}>
      <div
        className="bg-[#1a1a1a] rounded-xl w-[calc(100vw-40px)] max-w-[420px] max-h-[80vh] overflow-hidden border-2 border-[#333] sm:max-w-[calc(100vw-32px)]"
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

        {canUseGroups ? (
          <div className="px-5 pt-4">
            <div className="flex h-[40px] overflow-hidden rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(15,24,56,0.72)]">
              <button
                type="button"
                onClick={() => setInviteTab('friends')}
                className={`flex-1 font-bebas text-sm tracking-[0.08em] transition-all ${
                  inviteTab === 'friends'
                    ? 'bg-[#31239f] text-white'
                    : 'text-white/65 hover:bg-[rgba(26,37,83,0.98)] hover:text-white/88'
                }`}
                disabled={inviting}
              >
                AMIGOS
              </button>
              <button
                type="button"
                onClick={() => setInviteTab('groups')}
                className={`flex-1 border-l border-[rgba(88,107,170,0.46)] font-bebas text-sm tracking-[0.08em] transition-all ${
                  inviteTab === 'groups'
                    ? 'bg-[#31239f] text-white'
                    : 'text-white/65 hover:bg-[rgba(26,37,83,0.98)] hover:text-white/88'
                }`}
                disabled={inviting}
              >
                GRUPOS
              </button>
            </div>
          </div>
        ) : null}

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {isRequestJoinMode ? (
            <p className="m-0 mb-2 text-white/70 text-xs">
              Seleccioná uno o más amigos para enviarles una sugerencia.
            </p>
          ) : (
            inviteTab === 'groups' ? (
              <p className="m-0 mb-2 text-white/70 text-xs">
                Seleccioná uno o más grupos. Si un mismo amigo aparece en varios grupos, solo recibe una invitación.
              </p>
            ) : null
          )}

          {inviteTab === 'groups' && canUseGroups ? (
            groupsLoading ? (
              <div className="flex justify-center py-10">
                <LoadingSpinner size="medium" fullScreen />
              </div>
            ) : groupsError ? (
              <div className="text-center text-white/70 py-10 px-5 text-base">
                {groupsError}
              </div>
            ) : groups.length === 0 ? (
              <div className="text-center text-white/70 py-10 px-5 text-base">
                {emptyLabel}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {groups.map((group) => {
                  const isSelected = selectedGroupIds.has(group.id);
                  const memberPreview = (group?.members || [])
                    .slice(0, 2)
                    .map((member) => member?.profile?.nombre)
                    .filter(Boolean)
                    .join(', ');

                  return (
                    <button
                      key={group.id}
                      type="button"
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200 ${
                        isSelected
                          ? 'bg-[#2a3b57] border-[#5d83c6]'
                          : 'bg-white/5 border-white/10 hover:bg-white/[0.08] hover:border-white/20'
                      }`}
                      onClick={() => toggleGroupSelection(group.id)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white/20 bg-[rgba(42,59,87,0.92)] text-white">
                        G
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-medium text-white">
                          {group?.name || 'Grupo'}
                        </div>
                        <div className="truncate text-xs text-white/60">
                          {group?.member_count || 0} integrante{group?.member_count === 1 ? '' : 's'}
                          {memberPreview ? ` · ${memberPreview}` : ''}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleGroupSelection(group.id)}
                        onClick={(event) => event.stopPropagation()}
                        disabled={inviting}
                        className="w-4 h-4 accent-[#644dff] cursor-pointer"
                      />
                    </button>
                  );
                })}
              </div>
            )
          ) : loading ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner size="medium" fullScreen />
            </div>
          ) : friendsError ? (
            <div className="text-center text-white/70 py-10 px-5 text-base">
              {friendsError}
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
        ) : canUseGroups && inviteTab === 'groups' && groups.length > 0 ? (
          <div className="px-5 py-3 border-t border-[#333] bg-[#222]">
            <div className="text-[12px] text-white/70 mb-2">
              {selectedGroupCount > 0
                ? `${selectedGroupCount} grupo${selectedGroupCount === 1 ? '' : 's'} seleccionado${selectedGroupCount === 1 ? '' : 's'}`
                : 'Seleccioná uno o más grupos para invitar'}
            </div>
            <button
              type="button"
              onClick={handleSendSelectedGroups}
              disabled={inviting || selectedGroupCount === 0}
              className="w-full h-10 rounded-md border border-[#7d5aff] bg-[#6a43ff] text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
            >
              {inviting ? 'Enviando...' : 'Invitar grupos'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default InviteAmigosModal;
