import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getAmigos as getAmigosFromSupabase } from '../supabase';
import { useNotifications } from '../context/NotificationContext';
import { requestImmediatePushDispatchSafe } from '../services/pushDispatchService';
import { track } from '../utils/monitoring/analytics';
import { isAbortLikeError } from '../utils/isAbortLikeError';

/**
 * Validate if a string is a valid UUID format
 * UUIDs have format: 8-4-4-4-12 hex characters
 */
const isValidUUID = (value) => {
  if (!value || typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
};

const normalizeMessage = (error) => String(error?.message || error?.details || '').toLowerCase();
const isMissingColumnError = (error) => {
  const message = normalizeMessage(error);
  return message.includes('column') && (message.includes('does not exist') || message.includes('schema cache'));
};

const pickBestAvatarUrl = (...candidates) => {
  const valid = candidates
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  if (valid.length === 0) return null;

  const scored = valid
    .map((url) => {
      const lower = url.toLowerCase();
      let score = 0;
      if (lower.includes('/storage/v1/object/public/')) score += 4;
      if (lower.includes('googleusercontent.com') || lower.includes('fbcdn.net')) score += 3;
      if (lower.includes('ui-avatars.com') || lower.endsWith('/profile.svg') || lower.includes('/profile.svg?')) score -= 2;
      return { url, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.url || null;
};

const FRIENDS_DEBUG_PREFIX = '[AMIGOS_DEBUG][useAmigos][friends]';
const FRIENDS_TIMEOUT_CODE = 'AMIGOS_FRIENDS_TIMEOUT';
const FRIENDS_TIMEOUT_MS = 7000;
export const FRIENDS_VIEW_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  EMPTY: 'empty',
  ERROR: 'error',
});

const createFriendsTimeoutError = (requestId) => {
  const error = new Error('La carga de amigos está tardando demasiado. Probá de nuevo en unos segundos.');
  error.code = FRIENDS_TIMEOUT_CODE;
  error.requestId = requestId;
  return error;
};

/**
 * Hook for managing friend relationships
 * @returns {Object} Friend management functions and state
 */
export const useAmigos = (currentUserId) => {
  const [amigos, setAmigos] = useState([]);
  const [friendsState, setFriendsState] = useState(FRIENDS_VIEW_STATES.IDLE);
  const [pendingRequestsLoading, setPendingRequestsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(null);
  const { createNotification: _createNotification } = useNotifications();
  const isMountedRef = useRef(true);
  const amigosRef = useRef([]);
  const getAmigosRequestSeqRef = useRef(0);
  const visibleFriendsRequestIdRef = useRef(0);
  const getPendingRequestsSeqRef = useRef(0);
  const pendingLoadingRequestIdRef = useRef(0);
  const friendsStateRef = useRef(FRIENDS_VIEW_STATES.IDLE);

  const updateFriendsState = useCallback((nextValue, reason, requestId = null, meta = {}) => {
    console.debug('[AMIGOS_DEBUG][useAmigos][friendsState]', {
      nextValue,
      reason,
      requestId,
      currentUserId,
      ...meta,
    });
    friendsStateRef.current = nextValue;
    setFriendsState(nextValue);
  }, [currentUserId]);

  const friendsLoading = friendsState === FRIENDS_VIEW_STATES.LOADING;

  const updatePendingRequestsLoading = useCallback((nextValue, reason) => {
    console.debug('[AMIGOS_DEBUG][useAmigos][pendingRequestsLoading]', {
      nextValue,
      reason,
      currentUserId,
    });
    setPendingRequestsLoading(nextValue);
  }, [currentUserId]);

  useEffect(() => {
    amigosRef.current = amigos;
  }, [amigos]);

  useEffect(() => {
    friendsStateRef.current = friendsState;
  }, [friendsState]);

  useEffect(() => {
    console.debug('[AMIGOS_DEBUG][useAmigos][state]', {
      currentUserId,
      amigosCount: amigos.length,
      friendsState,
      friendsLoading,
      pendingRequestsLoading,
      friendsError,
    });
  }, [amigos.length, currentUserId, friendsError, friendsLoading, friendsState, pendingRequestsLoading]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  // Get all friends with status 'accepted' usando la nueva función refactorizada
  const getAmigos = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    const requestId = ++getAmigosRequestSeqRef.current;
    let timeoutId = null;

    console.info(`${FRIENDS_DEBUG_PREFIX}[load][start]`, {
      requestId,
      silent,
      currentUserId,
    });

    if (!currentUserId) {
      console.info(`${FRIENDS_DEBUG_PREFIX}[load][missing-user]`, {
        requestId,
        silent,
      });
      if (isMountedRef.current) {
        amigosRef.current = [];
        setAmigos([]);
        setFriendsError(null);
        updateFriendsState(FRIENDS_VIEW_STATES.IDLE, 'missing-current-user', requestId, {
          silent,
        });
      }
      return [];
    }

    console.log('[HOOK_AMIGOS] Fetching friends for user:', currentUserId);
    if (!silent) {
      visibleFriendsRequestIdRef.current = requestId;
      if (isMountedRef.current && requestId === getAmigosRequestSeqRef.current) {
        setFriendsError(null);
        updateFriendsState(FRIENDS_VIEW_STATES.LOADING, 'getAmigos:start', requestId, {
          silent,
        });
      }
    }

    try {
      const friendUsers = await (
        silent
          ? getAmigosFromSupabase(currentUserId)
          : Promise.race([
            getAmigosFromSupabase(currentUserId),
            new Promise((_, reject) => {
              timeoutId = window.setTimeout(() => {
                reject(createFriendsTimeoutError(requestId));
              }, FRIENDS_TIMEOUT_MS);
            }),
          ])
      );

      console.log('[HOOK_AMIGOS] Friends received from supabase function:', {
        count: friendUsers?.length || 0,
        sample: friendUsers?.slice(0, 2).map((u) => ({ id: u.id, nombre: u.nombre })) || [],
      });

      // Convertir a formato esperado por la UI (con profile wrapper)
      const formattedAmigos = friendUsers.map((user) => ({
        id: user.relationshipId, // ID de la relación en tabla amigos (es lo que removeFriend necesita)
        status: 'accepted',
        created_at: new Date().toISOString(),
        profile: user, // El usuario completo va en profile
      }));

      console.log('[HOOK_AMIGOS] Formatted friends for UI:', {
        count: formattedAmigos.length,
        sample: formattedAmigos.slice(0, 2).map((a) => ({
          id: a.id,
          profileName: a.profile?.nombre,
          profileId: a.profile?.id,
        })) || [],
      });

      console.info(`${FRIENDS_DEBUG_PREFIX}[load][resolved]`, {
        requestId,
        silent,
        friendCount: formattedAmigos.length,
      });

      if (requestId !== getAmigosRequestSeqRef.current) {
        console.info(`${FRIENDS_DEBUG_PREFIX}[load][resolved-stale-ignored]`, {
          requestId,
          latestRequestId: getAmigosRequestSeqRef.current,
          silent,
        });
        return formattedAmigos;
      }

      if (isMountedRef.current && requestId === getAmigosRequestSeqRef.current) {
        amigosRef.current = formattedAmigos;
        setAmigos(formattedAmigos);
        setFriendsError(null);
        updateFriendsState(
          formattedAmigos.length > 0 ? FRIENDS_VIEW_STATES.SUCCESS : FRIENDS_VIEW_STATES.EMPTY,
          'getAmigos:resolved',
          requestId,
          {
            silent,
            friendCount: formattedAmigos.length,
          },
        );
      }
      return formattedAmigos;
    } catch (err) {
      if (requestId !== getAmigosRequestSeqRef.current) {
        console.info(`${FRIENDS_DEBUG_PREFIX}[load][catch-stale-ignored]`, {
          requestId,
          latestRequestId: getAmigosRequestSeqRef.current,
          silent,
          message: err?.message || String(err),
        });
        return amigosRef.current || [];
      }

      if (isAbortLikeError(err)) {
        console.info(`${FRIENDS_DEBUG_PREFIX}[load][abort]`, {
          requestId,
          silent,
        });
        if (!silent && isMountedRef.current && requestId === visibleFriendsRequestIdRef.current) {
          const fallbackCount = Array.isArray(amigosRef.current) ? amigosRef.current.length : 0;
          setFriendsError(null);
          updateFriendsState(
            fallbackCount > 0 ? FRIENDS_VIEW_STATES.SUCCESS : FRIENDS_VIEW_STATES.EMPTY,
            'getAmigos:abort',
            requestId,
            {
              silent,
              fallbackCount,
            },
          );
        }
        return amigosRef.current || [];
      }

      console.error(`${FRIENDS_DEBUG_PREFIX}[load][catch]`, {
        requestId,
        silent,
        code: err?.code || null,
        message: err?.message || String(err),
        error: err,
      });

      console.error('[HOOK_AMIGOS] Error fetching friends:', err);
      console.error('[HOOK_AMIGOS] Error context:', { userId: currentUserId });
      if (isMountedRef.current && requestId === getAmigosRequestSeqRef.current) {
        const fallbackFriends = Array.isArray(amigosRef.current) ? amigosRef.current : [];
        const hasRenderableFriends = fallbackFriends.length > 0;
        setFriendsError(hasRenderableFriends ? null : err.message);
        if (!silent && !hasRenderableFriends) {
          amigosRef.current = [];
          setAmigos([]);
        }
        updateFriendsState(
          hasRenderableFriends ? FRIENDS_VIEW_STATES.SUCCESS : FRIENDS_VIEW_STATES.ERROR,
          'getAmigos:catch',
          requestId,
          {
            silent,
            fallbackCount: fallbackFriends.length,
            code: err?.code || null,
          },
        );
      }
      return amigosRef.current || [];
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      console.info(`${FRIENDS_DEBUG_PREFIX}[load][finally]`, {
        requestId,
        silent,
        currentUserId,
        visibleOwnerRequestId: visibleFriendsRequestIdRef.current,
        latestRequestId: getAmigosRequestSeqRef.current,
        friendsState: friendsStateRef.current,
      });
    }
  }, [currentUserId, updateFriendsState]);

  // Get relationship status with a specific player
  const getRelationshipStatus = useCallback(async (playerId) => {
    if (!currentUserId || !playerId) {
      console.log('[AMIGOS] getRelationshipStatus: Missing parameters', { currentUserId, playerId });
      return null;
    }

    // Validate UUID formats
    if (!isValidUUID(currentUserId) || !isValidUUID(playerId)) {
      console.error('[AMIGOS] Invalid UUID format detected', {
        currentUserIdValid: isValidUUID(currentUserId),
        playerIdValid: isValidUUID(playerId),
        currentUserId,
        playerId,
      });
      return null;
    }

    console.log('[AMIGOS] Checking relationship status between users:', { currentUserId, playerId });
    try {
      // Check if there's a relationship where current user is user_id
      console.log('[AMIGOS] Checking if current user is the requester (user_id)');
      const { data, error } = await supabase
        .from('amigos')
        .select('id, status, user_id, friend_id')
        .eq('user_id', currentUserId)
        .eq('friend_id', playerId)
        .maybeSingle();

      if (error) {
        console.error('[AMIGOS] Error checking relationship as user_id:', error);
        return null;
      }

      if (data) {
        console.log('[AMIGOS] Relationship found as user_id:', data);
        return data;
      }

      // Check if there's a relationship where current user is friend_id
      console.log('[AMIGOS] Checking if current user is the receiver (friend_id)');
      const { data: reverseData, error: reverseError } = await supabase
        .from('amigos')
        .select('id, status, user_id, friend_id')
        .eq('user_id', playerId)
        .eq('friend_id', currentUserId)
        .maybeSingle();

      if (reverseError) {
        console.error('[AMIGOS] Error checking relationship as friend_id:', reverseError);
        return null;
      }

      console.log('[AMIGOS] Relationship check complete - no existing relationship found');
      return reverseData || null;
    } catch (err) {
      if (isAbortLikeError(err)) {
        console.info('[AMIGOS] Relationship status request aborted');
        return null;
      }
      console.error('[AMIGOS] Error getting relationship status:', err);
      console.error('[AMIGOS] Error context:', { currentUserId, playerId });
      return null;
    }
  }, [currentUserId]);

  // Send friend request
  const sendFriendRequest = useCallback(async (friendId) => {
    if (!currentUserId || !friendId) {
      console.error('[AMIGOS] sendFriendRequest: Missing parameters', { currentUserId, friendId });
      return { success: false, message: 'Faltan parámetros necesarios' };
    }

    if (currentUserId === friendId) {
      return { success: false, message: 'No podes enviarte una solicitud a vos mismo' };
    }

    // Validate UUID formats
    if (!isValidUUID(currentUserId) || !isValidUUID(friendId)) {
      console.error('[AMIGOS] Invalid UUID format in sendFriendRequest', {
        currentUserIdValid: isValidUUID(currentUserId),
        friendIdValid: isValidUUID(friendId),
        currentUserId,
        friendId,
      });
      return { success: false, message: 'Error: Identificadores inválidos' };
    }

    console.log('[AMIGOS] Sending friend request:', { from: currentUserId, to: friendId });
    try {
      const createPendingRequest = async () => {
        const { data: insertData, error: insertError } = await supabase
          .from('amigos')
          .insert([{
            user_id: currentUserId,
            friend_id: friendId,
            status: 'pending',
          }])
          .select('id, user_id, friend_id, status, created_at')
          .single();

        if (insertError) {
          throw insertError;
        }

        return insertData;
      };

      // Check if a relationship already exists
      console.log('[AMIGOS] Checking if relationship already exists');
      const existingRelation = await getRelationshipStatus(friendId);

      let data;
      if (existingRelation) {
        console.log('[AMIGOS] Relationship already exists:', existingRelation);

        if (existingRelation.status === 'rejected') {
          // Recreate request from current user so direction and RLS constraints stay consistent.
          console.log('[AMIGOS] Recreating rejected relationship as pending request');
          const { data: deletedRows, error: deleteError } = await supabase
            .from('amigos')
            .delete()
            .eq('id', existingRelation.id)
            .eq('status', 'rejected')
            .select('id');

          if (deleteError) {
            console.error('[AMIGOS] Error deleting rejected relationship:', deleteError);
            throw deleteError;
          }

          if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
            const latestRelation = await getRelationshipStatus(friendId);
            if (latestRelation?.status === 'accepted') {
              return { success: false, message: 'Ya son amigos' };
            }
            if (latestRelation?.status === 'pending') {
              return { success: false, message: 'Ya existe una solicitud pendiente con este jugador' };
            }
            return { success: false, message: 'No se pudo reenviar la solicitud. Intentá nuevamente.' };
          }

          data = await createPendingRequest();
        } else if (existingRelation.status === 'pending') {
          console.warn('[AMIGOS] Relationship exists with status pending');
          return { success: false, message: 'Ya existe una solicitud pendiente con este jugador' };
        } else if (existingRelation.status === 'accepted') {
          console.warn('[AMIGOS] Relationship exists with status accepted');
          return { success: false, message: 'Ya son amigos' };
        } else {
          // Other statuses (pending, accepted) should not allow new requests
          console.warn('[AMIGOS] Relationship exists with status:', existingRelation.status);
          return { success: false, message: 'Ya existe una relación con este jugador' };
        }
      } else {
        // Create new friend request
        console.log('[AMIGOS] Creating new friend request');
        data = await createPendingRequest();
      }


      console.log('[AMIGOS] Friend request created successfully:', data);
      track('friend_request_sent', {
        request_id: String(data?.id || '').trim() || undefined,
        recipient_user_id: String(friendId).trim(),
      });

      // Canonical friend_request notifications are created in DB trigger
      // (on public.amigos) to guarantee enqueue/push traceability.
      requestImmediatePushDispatchSafe({
        eventType: 'friend_request',
        requestId: data?.id,
        recipientUserId: friendId,
        limit: 20,
      });

      return { success: true, data };
    } catch (err) {
      if (isAbortLikeError(err)) {
        return { success: false, message: 'Solicitud abortada' };
      }
      console.error('[AMIGOS] Error sending friend request:', err);
      console.error('[AMIGOS] Error context:', { currentUserId, friendId });

      // Return friendly error message based on error type
      if (err.message && err.message.includes('UUID')) {
        return { success: false, message: 'Error: Identificadores inválidos' };
      }

      if (err.code === '23505') {
        return { success: false, message: 'Ya existe una solicitud pendiente con este jugador' };
      }

      return { success: false, message: 'Error al enviar solicitud de amistad' };
    }
  }, [currentUserId, getRelationshipStatus]);

  // Accept friend request
  const acceptFriendRequest = useCallback(async (requestId) => {
    if (!requestId) {
      console.log('[AMIGOS] acceptFriendRequest: No requestId provided');
      return { success: false, message: 'ID de solicitud no proporcionado' };
    }

    console.log('[AMIGOS] Accepting friend request:', requestId);
    try {
      // Ensure we're working with UUID for the request ID
      const requestIdUuid = typeof requestId === 'string' ? requestId : String(requestId);

      const { data, error } = await supabase
        .from('amigos')
        .update({ status: 'accepted' })
        .eq('id', requestIdUuid)
        .select()
        .single();

      if (error) {
        console.error('[AMIGOS] Error updating friend request status:', error);
        throw error;
      }

      console.log('[AMIGOS] Friend request accepted successfully:', data);

      // Create notification for the sender that their request was accepted
      try {
        // Get accepter's profile to include in notification
        const { data: accepterProfile } = await supabase
          .from('usuarios')
          .select('nombre')
          .eq('id', currentUserId)
          .single();

        // Create notification in the database for the sender
        await supabase
          .from('notifications')
          .insert([{
            user_id: data.user_id, // The original sender of the request
            type: 'friend_accepted',
            title: 'Solicitud de amistad aceptada',
            message: `${accepterProfile?.nombre || 'Alguien'} ha aceptado tu solicitud de amistad`,
            data: { friendshipId: data.id },
            read: false,
            created_at: new Date().toISOString(),
          }]);
      } catch (notifError) {
        console.error('[AMIGOS] Error creating notification:', notifError);
        // Continue even if notification creation fails
      }

      // Refresh friends list
      getAmigos();
      return { success: true, data };
    } catch (err) {
      if (isAbortLikeError(err)) {
        return { success: false, message: 'Solicitud abortada' };
      }
      console.error('[AMIGOS] Error accepting friend request:', err);
      console.error('[AMIGOS] Error context:', { requestId });
      return { success: false, message: err.message };
    }
  }, [getAmigos]);

  // Reject friend request
  const rejectFriendRequest = useCallback(async (requestId) => {
    if (!requestId) {
      console.log('[AMIGOS] rejectFriendRequest: No requestId provided');
      return { success: false, message: 'ID de solicitud no proporcionado' };
    }

    console.log('[AMIGOS] Rejecting friend request:', requestId);
    try {
      // Ensure we're working with UUID for the request ID
      const requestIdUuid = typeof requestId === 'string' ? requestId : String(requestId);

      const { data, error } = await supabase
        .from('amigos')
        .update({ status: 'rejected' })
        .eq('id', requestIdUuid)
        .select()
        .single();

      if (error) {
        console.error('[AMIGOS] Error updating friend request status:', error);
        throw error;
      }

      console.log('[AMIGOS] Friend request rejected successfully:', data);

      // Create notification for the sender that their request was rejected
      try {
        // Create notification in the database for the sender
        await supabase
          .from('notifications')
          .insert([{
            user_id: data.user_id, // The original sender of the request
            type: 'friend_rejected',
            title: 'Solicitud de amistad rechazada',
            message: 'Tu solicitud de amistad ha sido rechazada',
            data: { requestId: data.id },
            read: false,
            created_at: new Date().toISOString(),
          }]);
      } catch (notifError) {
        console.error('[AMIGOS] Error creating notification:', notifError);
        // Continue even if notification creation fails
      }

      return { success: true, data };
    } catch (err) {
      if (isAbortLikeError(err)) {
        return { success: false, message: 'Solicitud abortada' };
      }
      console.error('[AMIGOS] Error rejecting friend request:', err);
      console.error('[AMIGOS] Error context:', { requestId });
      return { success: false, message: err.message };
    }
  }, []);

  // Remove friend (by relationshipId)
  const removeFriend = useCallback(async (relationshipId) => {
    if (!relationshipId || !currentUserId) {
      console.log('[AMIGOS] removeFriend: Missing parameters', { relationshipId, currentUserId });
      return { success: false, message: 'Parámetros faltantes' };
    }

    console.log('[AMIGOS] Removing friendship relationshipId:', relationshipId);

    try {
      // Borrar por PK (id de la relación)
      const { data, error } = await supabase
        .from('amigos')
        .delete()
        .eq('id', relationshipId)
        .select('id'); // Clave para saber si borró algo

      if (error) {
        console.error('[AMIGOS] Error removing friendship:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        // Si no borró nada, es porque relationshipId no existe o RLS bloqueó el delete
        console.warn('[AMIGOS] Delete returned 0 rows. Relationship not deleted.', {
          relationshipId,
          currentUserId,
        });
        throw new Error('No se pudo borrar la amistad (0 filas afectadas). Revisar RLS o ID inválido.');
      }

      console.log('[AMIGOS] Friendship removed successfully:', data[0]?.id);

      // Refresh friends list
      await getAmigos();

      return { success: true };
    } catch (err) {
      if (isAbortLikeError(err)) {
        return { success: false, message: 'Solicitud abortada' };
      }
      console.error('[AMIGOS] Error removing friend:', err);
      return { success: false, message: err.message };
    }
  }, [currentUserId, getAmigos]);

  // Get pending friend requests (received)
  const getPendingRequests = useCallback(async () => {
    const requestId = ++getPendingRequestsSeqRef.current;

    if (!currentUserId) {
      console.log('[AMIGOS] getPendingRequests: No currentUserId provided');
      if (isMountedRef.current) {
        updatePendingRequestsLoading(false, 'missing-current-user');
      }
      return [];
    }

    console.log('[AMIGOS] Fetching pending friend requests for user:', currentUserId);

    pendingLoadingRequestIdRef.current = requestId;
    if (isMountedRef.current && requestId === getPendingRequestsSeqRef.current) {
      updatePendingRequestsLoading(true, `getPendingRequests:start:${requestId}`);
    }

    try {
      // Ensure we're working with UUID
      const userIdUuid = typeof currentUserId === 'string' ? currentUserId : String(currentUserId);

      const { data: requestsData, error: requestsError } = await supabase
        .from('amigos')
        .select('id, status, created_at, user_id')
        .eq('friend_id', userIdUuid)
        .eq('status', 'pending');

      if (requestsError) {
        console.error('[AMIGOS] Error fetching pending requests:', requestsError);
        throw requestsError;
      }

      console.log('[AMIGOS] Pending requests fetched:', requestsData?.length || 0, 'results');

      if (!requestsData || requestsData.length === 0) return [];

      const requesterIds = requestsData
        .map((item) => item.user_id)
        .filter((id) => isValidUUID(String(id || '')));

      if (requesterIds.length === 0) {
        return [];
      }

      const fetchUsuarios = async (selectClause) => supabase
        .from('usuarios')
        .select(selectClause)
        .in('id', requesterIds);

      let usuariosResponse = await fetchUsuarios(
        'id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero, pierna_habil, nivel',
      );
      if (usuariosResponse.error && isMissingColumnError(usuariosResponse.error)) {
        usuariosResponse = await fetchUsuarios('id, nombre, avatar_url, email, posicion, ranking, partidos_jugados');
      }

      const [
        { data: profilesData, error: profilesError },
        { data: jugadoresData, error: jugadoresError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, nombre, avatar_url')
          .in('id', requesterIds),
        supabase
          .from('jugadores')
          .select('id, usuario_id, avatar_url')
          .in('usuario_id', requesterIds)
          .not('avatar_url', 'is', null)
          .order('id', { ascending: false }),
      ]);

      const usuariosData = usuariosResponse.data;
      const usuariosError = usuariosResponse.error;

      if (profilesError) {
        console.warn('[AMIGOS] Error fetching profiles fallback for pending requests:', profilesError);
      }
      if (usuariosError) {
        console.error('[AMIGOS] Error fetching usuarios for pending requests:', usuariosError);
        throw usuariosError;
      }
      if (jugadoresError) {
        console.warn('[AMIGOS] Error fetching jugadores avatar fallback for pending requests:', jugadoresError);
      }

      const latestJugadorAvatarMap = new Map();
      (jugadoresData || []).forEach((row) => {
        if (!row?.usuario_id || latestJugadorAvatarMap.has(row.usuario_id)) return;
        if (typeof row.avatar_url === 'string' && row.avatar_url.trim()) {
          latestJugadorAvatarMap.set(row.usuario_id, row.avatar_url.trim());
        }
      });

      // Log the raw data for debugging
      if (requestsData && requestsData.length > 0) {
        console.log('[AMIGOS] Sample pending request data:', requestsData[0]);
      }

      const formattedRequests = requestsData.map((item) => {
        const profileRow = profilesData?.find((p) => p.id === item.user_id);
        const usuarioRow = usuariosData?.find((u) => u.id === item.user_id);
        const mergedProfile = {
          ...usuarioRow,
          ...profileRow,
          id: item.user_id,
          nombre: usuarioRow?.nombre || profileRow?.nombre || 'Usuario',
          avatar_url: pickBestAvatarUrl(
            usuarioRow?.avatar_url,
            profileRow?.avatar_url,
            latestJugadorAvatarMap.get(item.user_id),
          ),
        };

        return {
          id: item.id,
          status: item.status,
          created_at: item.created_at,
          user_id: item.user_id,
          profile: mergedProfile,
        };
      });

      const withAvatar = formattedRequests.filter((r) => Boolean(r.profile?.avatar_url)).length;
      console.log('[AMIGOS] Formatted pending requests:', formattedRequests.length, 'with avatar:', withAvatar);

      return formattedRequests;
    } catch (err) {
      if (isAbortLikeError(err)) {
        console.info('[AMIGOS] Pending requests request aborted');
        return null;
      }
      console.error('[AMIGOS] Error fetching pending requests:', err);
      console.error('[AMIGOS] Error context:', { userId: encodeURIComponent(currentUserId || '') });
      return [];
    } finally {
      if (isMountedRef.current && requestId === pendingLoadingRequestIdRef.current) {
        updatePendingRequestsLoading(false, `getPendingRequests:end:${requestId}`);
      }
    }
  }, [currentUserId, updatePendingRequestsLoading]);

  return {
    amigos,
    loading: friendsLoading,
    friendsLoading,
    friendsState,
    pendingRequestsLoading,
    error: friendsError,
    friendsError,
    getAmigos,
    getRelationshipStatus,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
    getPendingRequests,
  };
};
