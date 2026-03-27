import React, { useState, useEffect, useMemo } from 'react';
import {
  getAmigos,
  getPrivateGroupsByOwner,
  resolveInviteRecipientsFromGroups,
  supabase,
} from '../supabase';
import Modal from './Modal';
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
import {
  readCachedInvitedGroupIds,
  rememberCachedInvitedGroupIds,
} from '../utils/groupInviteCache';

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

const PRIMARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[#7d5aff] bg-[#6a43ff] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white shadow-[0_0_14px_rgba(106,67,255,0.3)] transition-all hover:bg-[#7550ff] active:opacity-95 disabled:cursor-not-allowed disabled:border-[rgba(125,90,255,0.45)] disabled:bg-[rgba(106,67,255,0.55)] disabled:text-white/45 disabled:shadow-none';
const SECONDARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[rgba(98,117,184,0.58)] bg-[rgba(20,31,70,0.82)] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white/92 transition-all hover:bg-[rgba(30,45,94,0.95)] active:opacity-95 disabled:cursor-not-allowed disabled:opacity-50';
const INPUT_CLASS = 'h-[52px] w-full appearance-none rounded-none border border-[rgba(98,117,184,0.58)] bg-[rgba(20,31,70,0.82)] px-4 text-white font-oswald text-lg outline-none transition-all duration-300 focus:border-[#7f8dff] focus:bg-[rgba(30,45,94,0.95)] focus:ring-2 focus:ring-[#6f7dff]/30 placeholder:text-white/45 backdrop-blur-md';
const SECTION_CARD_CLASS = 'rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(18,28,62,0.78)] p-4';
const SECTION_TITLE_CLASS = 'font-oswald text-[clamp(16px,4.4vw,20px)] font-semibold leading-tight tracking-[0.01em] text-white';
const SELECTABLE_CARD_CLASS = 'w-full rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(18,28,62,0.78)] p-3 text-left transition-all duration-200 hover:border-[#4a7ed6]';

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

const showFriendInviteSummaryNotice = ({
  sentCount = 0,
  reinvitedCount = 0,
  pendingCount = 0,
  unavailableCount = 0,
  alreadyInMatchCount = 0,
  isRequestJoinMode = false,
}) => {
  const lines = [];
  const deliveredCount = sentCount + reinvitedCount;
  const singularLabel = isRequestJoinMode ? 'sugerencia' : 'invitación';
  const pluralLabel = isRequestJoinMode ? 'sugerencias' : 'invitaciones';

  if (deliveredCount > 0) {
    lines.push(
      deliveredCount === 1
        ? `Se envió 1 ${singularLabel}.`
        : `Se enviaron ${deliveredCount} ${pluralLabel}.`,
    );
  }

  if (pendingCount > 0) {
    lines.push(
      isRequestJoinMode
        ? `${pendingCount} amigo${pendingCount === 1 ? '' : 's'} ya tenía${pendingCount === 1 ? '' : 'n'} una sugerencia pendiente.`
        : `${pendingCount} amigo${pendingCount === 1 ? '' : 's'} ya tenía${pendingCount === 1 ? '' : 'n'} una invitación pendiente.`,
    );
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
  const [blockedGroupIds, setBlockedGroupIds] = useState(new Set());
  const [inviteTab, setInviteTab] = useState('friends');
  const inviteMode = normalizeInviteMode(mode);
  const isRequestJoinMode = inviteMode === 'request_join';
  const canUseGroups = !isRequestJoinMode;

  const visibleFriends = useMemo(
    () => amigos.filter((amigo) => !invitedFriends.has(String(amigo.id || '').trim())),
    [amigos, invitedFriends],
  );
  const visibleGroups = useMemo(
    () => groups.filter((group) => !blockedGroupIds.has(String(group?.id || '').trim())),
    [groups, blockedGroupIds],
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
      setBlockedGroupIds(new Set());
      setInviteTab('friends');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !canUseGroups) return;
    setBlockedGroupIds(readCachedInvitedGroupIds(partidoActual?.id));
  }, [canUseGroups, isOpen, partidoActual?.id]);

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

  const rememberBlockedGroupIds = (groupIds = []) => {
    setBlockedGroupIds((prev) => {
      const next = new Set(prev);
      groupIds
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .forEach((groupId) => next.add(groupId));
      rememberCachedInvitedGroupIds(partidoActual?.id, next);
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

  const handleSendSelectedFriends = async () => {
    if (!partidoActual?.id) {
      notifyBlockingError('No hay partido seleccionado.');
      return;
    }

    if (isRequestJoinMode && !invitationsOpen) {
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

      const deliveredFriendIds = [...sentIds, ...reinvitedIds]
        .map((friendId) => String(friendId || '').trim())
        .filter(Boolean);

      deliveredFriendIds.forEach((friendId) => {
        track('match_invite_sent', {
          match_id: Number(partidoActual?.id),
          recipient_user_id: friendId,
          source: deliveredFriendIds.length === 1 && !isRequestJoinMode
            ? 'invite_amigos_modal'
            : 'invite_amigos_modal_bulk',
          invite_result: sentIds.includes(friendId) ? 'sent' : 'reinvited',
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
          ...(deliveredFriendIds.length === 1 ? { recipientUserId: deliveredFriendIds[0] } : {}),
          limit: Math.max(20, Math.min(60, (sentIds.length + reinvitedIds.length) * 10)),
        });
      }

      setSelectedFriendIds(new Set());
      showFriendInviteSummaryNotice({
        sentCount: sentIds.length,
        reinvitedCount: reinvitedIds.length,
        pendingCount: alreadyPendingIds.length,
        unavailableCount: unavailableIds.length,
        alreadyInMatchCount: alreadyInMatchIds.length,
        isRequestJoinMode,
      });
    } catch (error) {
      console.error('[MODAL_AMIGOS] Error sending selected invites:', error);
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
      const shouldBlockSelectedGroups = (
        recipients.length > 0
        || alreadyPendingIds.length > 0
        || unavailableIds.length > 0
        || alreadyInMatchIds.length > 0
        || ineligibleIds.length > 0
        || duplicateCount > 0
      );

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

      if (shouldBlockSelectedGroups) {
        rememberBlockedGroupIds(groupIds);
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
  const footer = inviteTab === 'friends' && visibleFriends.length > 0 ? (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-white/55">
        {selectedCount > 0
          ? `${selectedCount} seleccionado${selectedCount > 1 ? 's' : ''}`
          : isRequestJoinMode
            ? 'Seleccioná amigos para enviar la sugerencia'
            : 'Seleccioná amigos para invitar'}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={inviting}
          className={`${SECONDARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
          data-preserve-button-case="true"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSendSelectedFriends}
          disabled={inviting || selectedCount === 0 || (isRequestJoinMode && !invitationsOpen)}
          className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
          data-preserve-button-case="true"
        >
          {inviting
            ? 'Enviando...'
            : isRequestJoinMode
              ? 'Enviar sugerencia'
              : selectedCount === 1
                ? 'Invitar amigo'
                : 'Invitar amigos'}
        </button>
      </div>
    </div>
  ) : canUseGroups && inviteTab === 'groups' && visibleGroups.length > 0 ? (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-white/55">
        {selectedGroupCount > 0
          ? `${selectedGroupCount} grupo${selectedGroupCount === 1 ? '' : 's'} seleccionado${selectedGroupCount === 1 ? '' : 's'}`
          : 'Seleccioná uno o más grupos para invitar'}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={inviting}
          className={`${SECONDARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
          data-preserve-button-case="true"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSendSelectedGroups}
          disabled={inviting || selectedGroupCount === 0}
          className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
          data-preserve-button-case="true"
        >
          {inviting ? 'Enviando...' : (selectedGroupCount === 1 ? 'Invitar grupo' : 'Invitar grupos')}
        </button>
      </div>
    </div>
  ) : null;

  const sectionTitle = inviteTab === 'groups' && canUseGroups
    ? 'Grupos disponibles'
    : 'Amigos disponibles';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      className="w-full max-w-[620px] !bg-[#101a35] border border-[rgba(98,117,184,0.58)]"
      classNameContent="p-5"
    >
      <div className="flex flex-col gap-5">
        {canUseGroups ? (
          <div className="flex h-[44px] overflow-hidden rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(15,24,56,0.72)]">
            <button
              type="button"
              onClick={() => setInviteTab('friends')}
              data-preserve-button-case="true"
              className={`flex-1 font-bebas text-base tracking-[0.08em] transition-all ${
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
              data-preserve-button-case="true"
              className={`flex-1 border-l border-[rgba(88,107,170,0.46)] font-bebas text-base tracking-[0.08em] transition-all ${
                inviteTab === 'groups'
                  ? 'bg-[#31239f] text-white'
                  : 'text-white/65 hover:bg-[rgba(26,37,83,0.98)] hover:text-white/88'
              }`}
              disabled={inviting}
            >
              GRUPOS
            </button>
          </div>
        ) : null}

        <div className={SECTION_CARD_CLASS}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className={SECTION_TITLE_CLASS}>{sectionTitle}</div>
            <div className="text-xs text-white/55">
              {inviteTab === 'groups' && canUseGroups
                ? `${visibleGroups.length} grupo${visibleGroups.length === 1 ? '' : 's'}`
                : `${visibleFriends.length} amigo${visibleFriends.length === 1 ? '' : 's'}`}
            </div>
          </div>

          {inviteTab === 'friends' ? (
            <p className="mb-3 text-sm text-white/60">
              {isRequestJoinMode
                ? 'Seleccioná uno o más amigos para enviarles una sugerencia.'
                : 'Seleccioná uno o más amigos para invitarlos juntos a este partido.'}
            </p>
          ) : inviteTab === 'groups' ? (
            <p className="mb-3 text-sm text-white/60">
              Seleccioná uno o más grupos. Si un mismo amigo aparece en varios grupos, solo recibe una invitación.
            </p>
          ) : null}

          {inviteTab === 'groups' && canUseGroups ? (
            groupsLoading ? (
              <div className="flex min-h-[220px] items-center justify-center">
                <LoadingSpinner size="medium" />
              </div>
            ) : groupsError ? (
              <div className="rounded-none border border-[rgba(177,72,72,0.45)] bg-[rgba(73,20,20,0.4)] px-4 py-5 text-sm text-red-200">
                {groupsError}
              </div>
            ) : groups.length === 0 ? (
              <div className="rounded-none border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/55">
                {emptyLabel}
              </div>
            ) : visibleGroups.length === 0 ? (
              <div className="rounded-none border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/55">
                Ya invitaste a todos tus grupos a este partido.
              </div>
            ) : (
              <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
                {visibleGroups.map((group) => {
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
                      data-preserve-button-case="true"
                      className={`${SELECTABLE_CARD_CLASS} flex items-center gap-3 ${isSelected ? 'border-[#7d5aff] bg-[rgba(66,40,168,0.36)]' : ''}`}
                      onClick={() => toggleGroupSelection(group.id)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[rgba(20,31,70,0.82)] text-white font-oswald">
                        G
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-oswald text-sm text-white">
                          {group?.name || 'Grupo'}
                        </div>
                        <div className="truncate text-xs text-white/55">
                          {group?.member_count || 0} integrante{group?.member_count === 1 ? '' : 's'}
                          {memberPreview ? ` · ${memberPreview}` : ''}
                        </div>
                      </div>
                      <div className={`h-4 w-4 shrink-0 rounded-none border ${isSelected ? 'border-[#7d5aff] bg-[#6a43ff]' : 'border-white/35 bg-transparent'}`} />
                    </button>
                  );
                })}
              </div>
            )
          ) : loading ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <LoadingSpinner size="medium" />
            </div>
          ) : friendsError ? (
            <div className="rounded-none border border-[rgba(177,72,72,0.45)] bg-[rgba(73,20,20,0.4)] px-4 py-5 text-sm text-red-200">
              {friendsError}
            </div>
          ) : amigos.length === 0 ? (
            <div className="rounded-none border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/55">
              {emptyLabel}
            </div>
          ) : visibleFriends.length === 0 ? (
            <div className="rounded-none border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/55">
              {noMoreLabel}
            </div>
          ) : (
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
              {visibleFriends.map((amigo) => {
                const isSelected = selectedFriendIds.has(amigo.id);
                const isAvailable = amigo?.acepta_invitaciones !== false;
                return (
                  <button
                    key={amigo.id}
                    type="button"
                    data-preserve-button-case="true"
                    className={`${SELECTABLE_CARD_CLASS} flex items-center gap-3 ${isSelected ? 'border-[#7d5aff] bg-[rgba(66,40,168,0.36)]' : ''}`}
                    onClick={() => toggleFriendSelection(amigo.id)}
                    disabled={inviting}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-[rgba(20,31,70,0.82)]">
                      <img
                        src={amigo.avatar_url || '/profile.svg'}
                        alt={amigo.nombre || 'Usuario'}
                        className="h-full w-full object-cover"
                        onError={(event) => { event.currentTarget.src = '/profile.svg'; }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-oswald text-sm text-white">
                        {amigo.nombre || 'Usuario'}
                      </div>
                      <div className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${isAvailable ? 'text-white/55' : 'text-red-200/75'}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isAvailable ? 'bg-[#5ed372]' : 'bg-[#d76a6a]'}`} />
                        <span className="truncate leading-none">
                          {isAvailable ? 'Disponible' : 'No disponible'}
                        </span>
                      </div>
                    </div>
                    <div className={`h-4 w-4 shrink-0 rounded-none border ${isSelected ? 'border-[#7d5aff] bg-[#6a43ff]' : 'border-white/35 bg-transparent'}`} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default InviteAmigosModal;
