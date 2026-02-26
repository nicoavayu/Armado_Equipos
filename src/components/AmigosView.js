import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAmigos } from '../hooks/useAmigos';
import { PlayerCardTrigger } from './ProfileComponents';
import MiniFriendCard from './MiniFriendCard';
import ConfirmModal from './ConfirmModal';
import { supabase } from '../supabase';
import LoadingSpinner from './LoadingSpinner';
import { useNotifications } from '../context/NotificationContext';
import { Check, Loader2, X } from 'lucide-react';
import InlineNotice from './ui/InlineNotice';
import { notifyBlockingError } from 'utils/notifyBlockingError';

const toCoordinateNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const hasValidCoordinates = (lat, lng) => {
  const parsedLat = toCoordinateNumber(lat);
  const parsedLng = toCoordinateNumber(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return false;
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return false;
  if (Math.abs(parsedLat) < 0.0001 && Math.abs(parsedLng) < 0.0001) return false;

  return true;
};

const calculateDistanceKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const sortByDistanceThenName = (items = []) => {
  return [...items].sort((a, b) => {
    const da = a.distanceKm;
    const db = b.distanceKm;

    if (Number.isFinite(da) && Number.isFinite(db)) {
      return da - db;
    }
    if (Number.isFinite(da)) return -1;
    if (Number.isFinite(db)) return 1;

    return String(a.profile?.nombre || '')
      .localeCompare(String(b.profile?.nombre || ''), 'es', { sensitivity: 'base' });
  });
};

const sortFriendsByDistance = (friends = [], userLocation = null) => {
  const hasReferenceLocation = hasValidCoordinates(userLocation?.lat, userLocation?.lng);

  const friendsWithDistance = friends.map((friend) => {
    const lat = toCoordinateNumber(friend?.profile?.latitud);
    const lng = toCoordinateNumber(friend?.profile?.longitud);

    let distanceKm = null;
    if (hasReferenceLocation && hasValidCoordinates(lat, lng)) {
      distanceKm = calculateDistanceKm(userLocation.lat, userLocation.lng, lat, lng);
    }

    return {
      ...friend,
      distanceKm,
    };
  });

  return sortByDistanceThenName(friendsWithDistance);
};

const AmigosView = () => {
  const [currentUserId, setCurrentUserId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('friends');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState(null);

  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const [processingRequests, setProcessingRequests] = useState(new Set());
  const [processingRequestAction, setProcessingRequestAction] = useState({});

  const [notice, setNotice] = useState(null);
  const noticeMetaRef = useRef({ key: null, ts: 0 });
  const noticeTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  const { markTypeAsRead } = useNotifications();

  const [friendToDelete, setFriendToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const clearInlineNotice = useCallback(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    if (isMountedRef.current) {
      setNotice(null);
    }
  }, []);

  const showInlineNotice = useCallback(({ key, type, message, autoHideMs } = {}) => {
    const stableKey = String(key || message || '').trim();
    if (!stableKey || !message) return;

    const now = Date.now();
    const { key: lastKey, ts: lastTs } = noticeMetaRef.current;
    if (lastKey === stableKey && now - lastTs < 2000) return;
    noticeMetaRef.current = { key: stableKey, ts: now };

    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }

    if (!isMountedRef.current) return;
    setNotice({ type, message, key: stableKey });

    const resolvedAutoHide = Number.isFinite(autoHideMs)
      ? autoHideMs
      : ((type === 'success' || type === 'info') ? 3000 : null);

    if (resolvedAutoHide && resolvedAutoHide > 0) {
      noticeTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setNotice(null);
        noticeTimerRef.current = null;
      }, resolvedAutoHide);
    }
  }, []);

  useEffect(() => () => {
    isMountedRef.current = false;
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const {
    amigos,
    loading: loadingAmigos,
    error,
    getAmigos,
    getRelationshipStatus,
    sendFriendRequest,
    getPendingRequests,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
  } = useAmigos(currentUserId);

  const friendIds = useMemo(
    () => new Set((amigos || []).map((friend) => friend?.profile?.id).filter(Boolean)),
    [amigos],
  );

  const incomingPendingIds = useMemo(
    () => new Set((pendingRequests || []).map((request) => request?.user_id || request?.profile?.id).filter(Boolean)),
    [pendingRequests],
  );

  const refreshPendingRequests = useCallback(async () => {
    const requests = await getPendingRequests();
    setPendingRequests(requests || []);
  }, [getPendingRequests]);

  const loadUserLocationFromProfile = useCallback(async (userId) => {
    if (!userId) {
      setUserLocation(null);
      return;
    }

    try {
      const { data, error: profileError } = await supabase
        .from('usuarios')
        .select('latitud, longitud')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) throw profileError;

      const lat = toCoordinateNumber(data?.latitud);
      const lng = toCoordinateNumber(data?.longitud);

      if (hasValidCoordinates(lat, lng)) {
        setUserLocation({ lat, lng });
      } else {
        setUserLocation(null);
      }
    } catch (locationError) {
      console.error('[AMIGOS] Error loading user location:', locationError);
      setUserLocation(null);
    }
  }, []);

  const loadFriendSuggestions = useCallback(async () => {
    if (!currentUserId) {
      setSuggestions([]);
      return;
    }

    setSuggestionsLoading(true);
    try {
      const { data: myRows, error: myRowsError } = await supabase
        .from('jugadores')
        .select('partido_id')
        .eq('usuario_id', currentUserId)
        .not('partido_id', 'is', null);

      if (myRowsError) throw myRowsError;

      const myMatchIds = [...new Set((myRows || []).map((row) => row.partido_id).filter(Boolean))];
      if (myMatchIds.length === 0) {
        setSuggestions([]);
        return;
      }

      const { data: sharedRows, error: sharedRowsError } = await supabase
        .from('jugadores')
        .select('usuario_id, partido_id')
        .in('partido_id', myMatchIds)
        .neq('usuario_id', currentUserId)
        .not('usuario_id', 'is', null);

      if (sharedRowsError) throw sharedRowsError;

      const sharedCounts = new Map();
      (sharedRows || []).forEach((row) => {
        const candidateId = row?.usuario_id;
        if (!candidateId) return;
        sharedCounts.set(candidateId, (sharedCounts.get(candidateId) || 0) + 1);
      });

      let candidateIds = Array.from(sharedCounts.keys());
      if (candidateIds.length === 0) {
        setSuggestions([]);
        return;
      }

      const excludedIds = new Set([currentUserId, ...friendIds, ...incomingPendingIds]);
      candidateIds = candidateIds.filter((candidateId) => !excludedIds.has(candidateId));

      if (candidateIds.length === 0) {
        setSuggestions([]);
        return;
      }

      const [{ data: outgoingRelations, error: outgoingError }, { data: incomingRelations, error: incomingError }] = await Promise.all([
        supabase
          .from('amigos')
          .select('friend_id, status')
          .eq('user_id', currentUserId)
          .in('friend_id', candidateIds),
        supabase
          .from('amigos')
          .select('user_id, status')
          .eq('friend_id', currentUserId)
          .in('user_id', candidateIds),
      ]);

      if (outgoingError) throw outgoingError;
      if (incomingError) throw incomingError;

      const blockedIds = new Set();
      (outgoingRelations || []).forEach((relation) => {
        if (relation?.status === 'accepted' || relation?.status === 'pending') {
          blockedIds.add(relation.friend_id);
        }
      });
      (incomingRelations || []).forEach((relation) => {
        if (relation?.status === 'accepted' || relation?.status === 'pending') {
          blockedIds.add(relation.user_id);
        }
      });

      const suggestionIds = candidateIds.filter((candidateId) => !blockedIds.has(candidateId));
      if (suggestionIds.length === 0) {
        setSuggestions([]);
        return;
      }

      const { data: users, error: usersError } = await supabase
        .from('usuarios')
        .select('id, nombre, email, avatar_url, localidad, ranking, partidos_jugados, posicion, latitud, longitud')
        .in('id', suggestionIds)
        .limit(30);

      if (usersError) throw usersError;

      const mappedSuggestions = (users || [])
        .map((user) => ({
          ...user,
          sharedMatches: sharedCounts.get(user.id) || 0,
        }))
        .sort((a, b) => {
          const byShared = Number(b.sharedMatches || 0) - Number(a.sharedMatches || 0);
          if (byShared !== 0) return byShared;

          const byRanking = Number(b.ranking || 0) - Number(a.ranking || 0);
          if (byRanking !== 0) return byRanking;

          return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
        })
        .slice(0, 12);

      setSuggestions(mappedSuggestions);
    } catch (suggestionsError) {
      console.error('[AMIGOS] Error loading friend suggestions:', suggestionsError);
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [currentUserId, friendIds, incomingPendingIds]);

  // Get current user ID on mount
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError) {
        console.error('[AMIGOS] Error getting current user:', authError);
        return;
      }

      if (user?.id) {
        setCurrentUserId(user.id);
      }
    };

    getCurrentUser();
  }, []);

  // Load friends and pending requests when currentUserId changes
  useEffect(() => {
    if (!currentUserId) return;

    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        getAmigos(),
        refreshPendingRequests(),
        markTypeAsRead('friend_request'),
        loadUserLocationFromProfile(currentUserId),
      ]);
      setLoading(false);
    };

    loadData();
  }, [currentUserId]);

  // Load suggestions whenever friendship graph changes
  useEffect(() => {
    if (!currentUserId) {
      setSuggestions([]);
      return;
    }

    loadFriendSuggestions();
  }, [currentUserId, loadFriendSuggestions]);

  useEffect(() => {
    if (activeTab !== 'discover') {
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [activeTab]);

  // Handle accepting a friend request
  const handleAcceptRequest = async (requestId) => {
    if (processingRequests.has(requestId)) return;

    setProcessingRequests((prev) => new Set(prev).add(requestId));
    setProcessingRequestAction((prev) => ({ ...prev, [requestId]: 'accept' }));

    try {
      const result = await acceptFriendRequest(requestId);

      if (result.success) {
        showInlineNotice({
          key: `friend_accept_success_${requestId}`,
          type: 'success',
          message: 'Solicitud de amistad aceptada.',
        });

        await Promise.all([
          refreshPendingRequests(),
          getAmigos(),
        ]);
      } else {
        notifyBlockingError(result.message || 'Error al aceptar solicitud');
      }
    } finally {
      setProcessingRequests((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
      setProcessingRequestAction((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  };

  // Handle rejecting a friend request
  const handleRejectRequest = async (requestId) => {
    if (processingRequests.has(requestId)) return;

    setProcessingRequests((prev) => new Set(prev).add(requestId));
    setProcessingRequestAction((prev) => ({ ...prev, [requestId]: 'reject' }));

    try {
      const result = await rejectFriendRequest(requestId);

      if (result.success) {
        showInlineNotice({
          key: `friend_reject_success_${requestId}`,
          type: 'info',
          message: 'Solicitud de amistad rechazada.',
        });

        await refreshPendingRequests();
      } else {
        notifyBlockingError(result.message || 'Error al rechazar solicitud');
      }
    } finally {
      setProcessingRequests((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
      setProcessingRequestAction((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  };

  // Handle removing a friend
  const handleRemoveFriend = async (friend) => {
    if (!friend?.id) {
      showInlineNotice({
        key: 'friend_remove_missing_relationship',
        type: 'warning',
        message: 'No se pudo identificar la relación para eliminar.',
      });
      setFriendToDelete(null);
      return;
    }

    try {
      setIsDeleting(true);
      const result = await removeFriend(friend.id);

      if (result.success) {
        showInlineNotice({
          key: `friend_remove_success_${friend.id}`,
          type: 'success',
          message: 'Amigo eliminado.',
        });

        await getAmigos();
      } else {
        notifyBlockingError(result.message || 'Error al eliminar amigo');
      }
    } catch (_error) {
      notifyBlockingError('Error al eliminar amigo');
    } finally {
      setFriendToDelete(null);
      setIsDeleting(false);
    }
  };

  const searchUsers = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const { data, error: searchError } = await supabase
        .from('usuarios')
        .select('id, nombre, email, avatar_url, localidad, ranking, posicion, partidos_jugados, latitud, longitud')
        .or(`nombre.ilike.%${query}%,email.ilike.%${query}%`)
        .neq('id', currentUserId)
        .limit(10);

      if (searchError) throw searchError;
      setSearchResults(data || []);
    } catch (searchError) {
      console.error('Error searching users:', searchError);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const filteredFriends = useMemo(() => {
    const term = String(friendSearchQuery || '').trim().toLowerCase();
    if (!term) return amigos || [];

    return (amigos || []).filter((friend) => {
      const profile = friend?.profile || {};
      const haystack = [
        profile?.nombre,
        profile?.email,
        profile?.localidad,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [amigos, friendSearchQuery]);

  const sortedFriends = useMemo(
    () => sortFriendsByDistance(filteredFriends, userLocation),
    [filteredFriends, userLocation],
  );

  if (loading || loadingAmigos) {
    return <LoadingSpinner size="large" fullScreen />;
  }

  if (error) {
    return <div className="text-center p-5 bg-red-500/10 rounded-lg text-red-600 mt-5">Error: {error}</div>;
  }

  const searchInputClass = 'w-full h-14 px-5 text-[15px] border border-white/20 rounded-2xl bg-white/5 text-white font-oswald box-border placeholder-white/35 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 backdrop-blur-md';

  return (
    <div className="w-full m-0 pt-0 box-border">
      {notice && (
        <div className="w-full max-w-[700px] mx-auto mb-2">
          <InlineNotice
            type={notice?.type}
            message={notice?.message}
            autoHideMs={notice?.type === 'warning' ? null : 3000}
            onClose={clearInlineNotice}
          />
        </div>
      )}

      <div className="w-full max-w-[500px] mx-auto mb-4 rounded-[18px] border border-white/15 bg-[linear-gradient(140deg,rgba(34,46,98,0.8),rgba(28,37,84,0.74))] p-1.5 shadow-[0_8px_22px_rgba(5,12,34,0.34)]">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('friends')}
            className={`flex-1 h-12 rounded-[13px] font-oswald text-[20px] font-semibold tracking-[0.01em] !normal-case transition-all duration-200 ${
              activeTab === 'friends'
                ? 'bg-[#7e76de] text-white shadow-[0_6px_16px_rgba(126,118,222,0.42)]'
                : 'bg-transparent text-white/58 hover:text-white/90 hover:bg-white/[0.08]'
            }`}
          >
            Mis amigos
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className={`flex-1 h-12 rounded-[13px] font-oswald text-[20px] font-semibold tracking-[0.01em] !normal-case transition-all duration-200 ${
              activeTab === 'discover'
                ? 'bg-[#7e76de] text-white shadow-[0_6px_16px_rgba(126,118,222,0.42)]'
                : 'bg-transparent text-white/58 hover:text-white/90 hover:bg-white/[0.08]'
            }`}
          >
            Comunidad
          </button>
        </div>
      </div>

      {activeTab === 'discover' ? (
        <>
          {/* Search users */}
          <div className="w-full max-w-[500px] mx-auto my-[10px] mb-[12px] relative box-border z-10">
            <input
              type="text"
              placeholder="Buscar jugador por nombre o email..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim()) {
                  searchUsers(e.target.value.trim());
                } else {
                  setSearchResults([]);
                }
              }}
              className={searchInputClass}
            />
            <p className="mt-2 px-1 text-xs text-white/55">
              Esta busqueda incluye a todos los usuarios registrados.
            </p>

            {searchQuery && (
              <div className="w-full max-w-[700px] mx-auto rounded-xl absolute left-1/2 -translate-x-1/2 top-full bg-black/90 border border-white/20 max-h-[300px] overflow-y-auto z-[1000] mt-1 sm:max-w-[98vw]">
                {searchLoading ? (
                  <div className="flex items-center gap-2 p-4 text-white/70 text-sm">
                    <LoadingSpinner size="small" />
                    <span>Buscando...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((user) => (
                    <SearchUserItem
                      key={user.id}
                      user={user}
                      currentUserId={currentUserId}
                      getRelationshipStatus={getRelationshipStatus}
                      sendFriendRequest={sendFriendRequest}
                      onInlineNotice={showInlineNotice}
                      onRequestSent={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                        loadFriendSuggestions();
                      }}
                    />
                  ))
                ) : (
                  <div className="p-4 text-center text-white/60 text-sm">
                    No se encontraron usuarios
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pending requests */}
          {pendingRequests.length > 0 && (
            <div className="flex flex-col items-center mb-5 md:mb-8 w-full max-w-[500px] mx-auto">
              <h3 className="text-xl font-semibold my-[20px] mb-[15px] text-white">Solicitudes pendientes</h3>
              <div className="flex flex-col gap-2.5 w-full">
                {pendingRequests.map((request) => (
                  <div key={request.profile?.uuid || request.profile?.id || request.id} className="flex items-center gap-3 p-4 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 mb-3 w-full box-border min-h-[64px] transition-all duration-300 shadow-xl hover:shadow-2xl hover:border-white/20 hover:bg-white/15 sm:p-3">
                    <PlayerCardTrigger profile={request.profile}>
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <img
                          src={request.profile?.avatar_url || '/profile.svg'}
                          alt={request.profile?.nombre || 'Usuario'}
                          className="w-11 h-11 rounded-full object-cover bg-white/20 border-2 border-white/30 shrink-0 sm:w-10 sm:h-10"
                          onError={(e) => {
                            e.target.src = '/profile.svg';
                          }}
                        />
                        <span className="text-lg font-bold text-white font-oswald uppercase whitespace-nowrap overflow-hidden text-ellipsis mb-1 sm:text-base">
                          {request.profile?.nombre || 'Usuario'}
                        </span>
                      </div>
                    </PlayerCardTrigger>
                    <div className="flex gap-2 shrink-0">
                      <button
                        className="h-11 w-11 rounded-xl border border-white/20 bg-[var(--btn-success)] text-white shadow-[0_8px_20px_rgba(39,174,96,0.35)] transition-all hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        onClick={() => handleAcceptRequest(request.id)}
                        disabled={processingRequests.has(request.id)}
                        aria-label={processingRequests.has(request.id) && processingRequestAction[request.id] === 'accept' ? 'Aceptando solicitud' : 'Aceptar solicitud'}
                        title={processingRequests.has(request.id) && processingRequestAction[request.id] === 'accept' ? 'Aceptando solicitud...' : 'Aceptar solicitud'}
                      >
                        {processingRequests.has(request.id) && processingRequestAction[request.id] === 'accept' ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <Check size={19} strokeWidth={3} />
                        )}
                      </button>
                      <button
                        className="h-11 w-11 rounded-xl border border-white/20 bg-[var(--btn-danger)] text-white shadow-[0_8px_20px_rgba(231,76,60,0.3)] transition-all hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        onClick={() => handleRejectRequest(request.id)}
                        disabled={processingRequests.has(request.id)}
                        aria-label={processingRequests.has(request.id) && processingRequestAction[request.id] === 'reject' ? 'Rechazando solicitud' : 'Rechazar solicitud'}
                        title={processingRequests.has(request.id) && processingRequestAction[request.id] === 'reject' ? 'Rechazando solicitud...' : 'Rechazar solicitud'}
                      >
                        {processingRequests.has(request.id) && processingRequestAction[request.id] === 'reject' ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <X size={19} strokeWidth={3} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          <div className="flex flex-col items-center mb-10 w-full max-w-[500px] mx-auto">
            <h3 className="text-xl font-semibold my-[20px] mb-[15px] text-white">Sugerencias de amistad</h3>

            {suggestionsLoading ? (
              <div className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center gap-2 text-white/70">
                <LoadingSpinner size="small" />
                <span className="text-sm">Buscando jugadores con los que compartiste partidos...</span>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="w-full flex flex-col gap-2">
                {suggestions.map((suggestedUser) => (
                  <SearchUserItem
                    key={`suggested-${suggestedUser.id}`}
                    user={suggestedUser}
                    currentUserId={currentUserId}
                    getRelationshipStatus={getRelationshipStatus}
                    sendFriendRequest={sendFriendRequest}
                    subtitle={`${suggestedUser.sharedMatches} partido${suggestedUser.sharedMatches === 1 ? '' : 's'} juntos`}
                    onInlineNotice={showInlineNotice}
                    onRequestSent={() => {
                      setSuggestions((prev) => prev.filter((item) => item.id !== suggestedUser.id));
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="w-full text-center p-6 bg-white/5 border border-white/10 rounded-2xl">
                <p className="text-white/85 font-oswald text-base">Todavia no tenemos sugerencias.</p>
                <p className="text-white/55 font-oswald text-sm mt-1">
                  Cuando compartas mas partidos con jugadores nuevos, te los recomendamos aca.
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Search friends */}
          <div className="w-full max-w-[500px] mx-auto mb-4">
            <input
              type="text"
              placeholder="Buscar en mis amigos..."
              value={friendSearchQuery}
              onChange={(e) => setFriendSearchQuery(e.target.value)}
              className={searchInputClass}
            />
            <p className="mt-2 px-1 text-xs text-white/55">
              Este campo filtra solo tu lista actual.
            </p>
          </div>

          {Array.isArray(amigos) && amigos.length > 0 ? (
            sortedFriends.length > 0 ? (
              <div className="flex flex-col items-center mb-[350px] w-full max-w-[500px] mx-auto relative z-0">
                <p className="w-full mb-2 px-1 text-[11px] uppercase tracking-wider text-white/55">
                  Ordenados por cercania
                </p>
                <div className="flex flex-col gap-2 w-full max-w-none overflow-visible sm:gap-1.5">
                  {sortedFriends.map((amigo) => (
                    <MiniFriendCard
                      key={amigo.profile?.uuid || amigo.profile?.id || amigo.id}
                      friend={amigo}
                      onRequestRemoveClick={(friend) => setFriendToDelete(friend)}
                      currentUserId={currentUserId}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center p-10 bg-black/5 rounded-lg mt-5">
                <p className="m-2.5 text-base text-white">No encontramos amigos para ese criterio.</p>
                <p className="m-2.5 text-base text-white/65">Proba con otro nombre o email.</p>
              </div>
            )
          ) : (
            <div className="text-center p-10 bg-black/5 rounded-lg mt-5">
              <p className="m-2.5 text-base text-white">No tenes amigos agregados todavia.</p>
              <p className="m-2.5 text-base text-white">Usa la solapa Comunidad para enviar solicitudes.</p>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={!!friendToDelete}
        onCancel={() => setFriendToDelete(null)}
        onConfirm={async () => {
          if (friendToDelete) {
            await handleRemoveFriend(friendToDelete);
          }
        }}
        title="Eliminar amigo"
        message={`¿Estas seguro que deseas eliminar a ${friendToDelete?.profile?.nombre || 'este jugador'} de tu lista de amigos?`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        isDeleting={isDeleting}
      />
    </div>
  );
};

const SearchUserItem = ({
  user,
  currentUserId,
  getRelationshipStatus,
  sendFriendRequest,
  subtitle = null,
  onRequestSent,
  onInlineNotice,
}) => {
  const [loading, setLoading] = useState(false);
  const [relationshipStatus, setRelationshipStatus] = useState(null);

  useEffect(() => {
    const checkRelationship = async () => {
      const status = await getRelationshipStatus(user.id);
      setRelationshipStatus(status);
    };

    if (user.id && currentUserId && typeof getRelationshipStatus === 'function') {
      checkRelationship();
    }
  }, [user.id, currentUserId, getRelationshipStatus]);

  const handleSendRequest = async () => {
    if (typeof sendFriendRequest !== 'function') return;
    setLoading(true);
    try {
      const result = await sendFriendRequest(user.id);
      if (result.success) {
        setRelationshipStatus({
          id: result?.data?.id || relationshipStatus?.id || null,
          status: 'pending',
          user_id: currentUserId,
          friend_id: user.id,
        });
        if (typeof onInlineNotice === 'function') {
          onInlineNotice({
            key: `friend_request_sent_${user.id}`,
            type: 'success',
            message: 'Solicitud enviada.',
          });
        }
        if (typeof onRequestSent === 'function') {
          onRequestSent();
        }
      } else {
        notifyBlockingError(result.message || 'Error al enviar solicitud');
      }
    } catch (_error) {
      notifyBlockingError('Error al enviar solicitud');
    } finally {
      setLoading(false);
    }
  };

  const getButtonText = () => {
    if (loading) return 'Enviando...';
    if (!relationshipStatus) return 'Solicitar';
    if (relationshipStatus.status === 'pending') return 'Solicitud enviada';
    if (relationshipStatus.status === 'accepted') return 'Ya son amigos';
    if (relationshipStatus.status === 'rejected') return 'Reenviar';
    return 'Solicitar';
  };

  const isButtonDisabled = () => {
    return loading || (relationshipStatus && ['pending', 'accepted'].includes(relationshipStatus.status));
  };

  return (
    <div className="flex items-center justify-between p-3 border border-white/10 rounded-xl bg-white/5 transition-colors hover:bg-white/10">
      <PlayerCardTrigger profile={user}>
        <div className="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
          <img
            src={user.avatar_url || '/profile.svg'}
            alt={user.nombre}
            className="w-10 h-10 rounded-full object-cover"
            onError={(e) => { e.target.src = '/profile.svg'; }}
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white text-sm truncate">{user.nombre}</div>
            <div className="text-xs text-white/60 mt-0.5 truncate">{subtitle || user.email || 'Usuario'}</div>
          </div>
        </div>
      </PlayerCardTrigger>

      <button
        className={`
          px-4 py-1.5 bg-[#2196F3] text-white border-none rounded text-xs font-medium cursor-pointer transition-all hover:bg-[#1976D2] whitespace-nowrap
          ${isButtonDisabled() ? 'bg-white/20 text-white/50 cursor-not-allowed hover:bg-white/20' : ''}
        `}
        onClick={handleSendRequest}
        disabled={isButtonDisabled()}
      >
        {getButtonText()}
      </button>
    </div>
  );
};

export default AmigosView;
