import logger from '../utils/logger';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAmigos } from '../hooks/useAmigos';
import { PlayerCardTrigger } from './ProfileComponents';
import MiniFriendCard from './MiniFriendCard';
import ConfirmModal from './ConfirmModal';
import { supabase } from '../supabase';
import LoadingSpinner from './LoadingSpinner';
import { useNotifications } from '../context/NotificationContext';
import { Check, Loader2, Users, X } from 'lucide-react';
import InlineNotice from './ui/InlineNotice';
import { useScrollResetOnChange } from '../hooks/useScrollReset';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import EmptyStateCard from './EmptyStateCard';
import PrivateGroupsTab from './friends/PrivateGroupsTab';
import { useAuth } from './AuthProvider';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { useSupabaseRealtime } from '../hooks/useSupabaseRealtime';

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

const PRIMARY_TOGGLE_CONTAINER_CLASS = 'flex h-[44px] w-full max-w-[500px] mx-auto gap-1 p-1 overflow-hidden rounded-full border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.85)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_16px_rgba(5,3,16,0.35)]';
const PRIMARY_TOGGLE_ACTIVE_CLASS = 'z-[2] rounded-full border-transparent bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]';
const PRIMARY_TOGGLE_INACTIVE_CLASS = 'z-[1] rounded-full border-transparent bg-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.06]';
const EMPTY_STATE_TITLE_CLASS = 'font-oswald text-[clamp(18px,5.6vw,22px)] font-semibold leading-tight text-white';
const normalizeAmigosTab = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'groups' || normalized === 'group' || normalized === 'grupos' || normalized === 'grupo') {
    return 'groups';
  }
  if (normalized === 'discover' || normalized === 'community' || normalized === 'comunidad' || normalized === 'requests') {
    return 'discover';
  }
  return 'friends';
};

const AmigosView = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(location.search);
    return normalizeAmigosTab(params.get('tab'));
  });
  useScrollResetOnChange(activeTab);

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
  const amigosRefreshTimeoutRef = useRef(null);
  const friendIdsRef = useRef(new Set());
  const incomingPendingIdsRef = useRef(new Set());

  const { markTypeAsRead } = useNotifications();
  const markTypeAsReadRef = useRef(markTypeAsRead);

  const [friendToDelete, setFriendToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    markTypeAsReadRef.current = markTypeAsRead;
  }, [markTypeAsRead]);

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
    if (amigosRefreshTimeoutRef.current) {
      clearTimeout(amigosRefreshTimeoutRef.current);
      amigosRefreshTimeoutRef.current = null;
    }
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextTab = normalizeAmigosTab(params.get('tab'));
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [location.search]);

  const handleTabChange = useCallback((nextTab) => {
    const normalizedTab = normalizeAmigosTab(nextTab);
    setActiveTab(normalizedTab);

    const params = new URLSearchParams(location.search);
    if (normalizedTab === 'discover') {
      params.set('tab', 'discover');
    } else if (normalizedTab === 'groups') {
      params.set('tab', 'groups');
    } else {
      params.delete('tab');
    }

    const nextSearch = params.toString();
    navigate({
      pathname: location.pathname,
      search: nextSearch ? `?${nextSearch}` : '',
    }, { replace: true });
  }, [location.pathname, location.search, navigate]);

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

  useEffect(() => {
    friendIdsRef.current = friendIds;
  }, [friendIds]);

  useEffect(() => {
    incomingPendingIdsRef.current = incomingPendingIds;
  }, [incomingPendingIds]);

  const refreshPendingRequests = useCallback(async () => {
    const requests = await getPendingRequests();
    setPendingRequests(requests || []);
  }, [getPendingRequests]);

  const refreshAmigosData = useCallback(async ({ silent = true } = {}) => {
    if (!currentUserId) return;

    await Promise.all([
      getAmigos({ silent }),
      refreshPendingRequests(),
    ]);
  }, [currentUserId, getAmigos, refreshPendingRequests]);

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
      logger.error('[AMIGOS] Error loading user location:', locationError);
      setUserLocation(null);
    }
  }, []);

  const loadFriendSuggestions = useCallback(async ({ silent = false } = {}) => {
    if (!currentUserId) {
      setSuggestions([]);
      return;
    }

    if (!silent) {
      setSuggestionsLoading(true);
    }
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

      const excludedIds = new Set([
        currentUserId,
        ...friendIdsRef.current,
        ...incomingPendingIdsRef.current,
      ]);
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
      logger.error('[AMIGOS] Error loading friend suggestions:', suggestionsError);
      setSuggestions([]);
    } finally {
      if (!silent) {
        setSuggestionsLoading(false);
      }
    }
  }, [currentUserId]);

  // Get current user ID on mount
  useEffect(() => {
    if (user?.id) {
      setCurrentUserId(user.id);
      return undefined;
    }

    const getCurrentUser = async () => {
      const getUser = supabase?.auth?.getUser;
      if (typeof getUser !== 'function') {
        return;
      }

      const { data: { user: authUser }, error: authError } = await getUser();

      if (authError) {
        logger.error('[AMIGOS] Error getting current user:', authError);
        return;
      }

      if (authUser?.id) {
        setCurrentUserId(authUser.id);
      }
    };

    getCurrentUser();
    return undefined;
  }, [user?.id]);

  // Load friends and pending requests when currentUserId changes
  useEffect(() => {
    if (!currentUserId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        await Promise.allSettled([
          refreshAmigosData({ silent: false }),
          Promise.resolve(markTypeAsReadRef.current?.('friend_request')),
          loadUserLocationFromProfile(currentUserId),
        ]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [currentUserId, loadUserLocationFromProfile, refreshAmigosData]);

  useEffect(() => {
    if (!currentUserId) {
      setSuggestions([]);
      return;
    }

    if (activeTab !== 'discover') return;

    loadFriendSuggestions({ silent: false });
  }, [activeTab, currentUserId, loadFriendSuggestions]);

  useEffect(() => {
    if (activeTab !== 'discover') {
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [activeTab]);

  const scheduleAmigosRefresh = useCallback(() => {
    if (amigosRefreshTimeoutRef.current) {
      clearTimeout(amigosRefreshTimeoutRef.current);
    }

    amigosRefreshTimeoutRef.current = window.setTimeout(() => {
      refreshAmigosData({ silent: true });
      if (activeTab === 'discover') {
        Promise.resolve(markTypeAsReadRef.current?.('friend_request')).catch(() => {});
        loadFriendSuggestions({ silent: true });
      }
    }, 180);
  }, [activeTab, loadFriendSuggestions, refreshAmigosData]);

  useRefreshOnVisibility(
    () => {
      refreshAmigosData({ silent: true });
      if (activeTab === 'discover') {
        Promise.resolve(markTypeAsReadRef.current?.('friend_request')).catch(() => {});
        loadFriendSuggestions({ silent: true });
      }
    },
    { enabled: Boolean(currentUserId) },
  );

  useSupabaseRealtime({
    enabled: Boolean(currentUserId),
    channelName: `amigos-view-${currentUserId}`,
    deps: [currentUserId, scheduleAmigosRefresh],
    events: [
      {
        event: '*',
        schema: 'public',
        table: 'amigos',
        filter: `user_id=eq.${currentUserId}`,
        handler: () => {
          scheduleAmigosRefresh();
        },
      },
      {
        event: '*',
        schema: 'public',
        table: 'amigos',
        filter: `friend_id=eq.${currentUserId}`,
        handler: () => {
          scheduleAmigosRefresh();
        },
      },
    ],
  });

  useEffect(() => {
    if (!currentUserId) return undefined;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshAmigosData({ silent: true });
      if (activeTab === 'discover') {
        loadFriendSuggestions({ silent: true });
      }
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTab, currentUserId, loadFriendSuggestions, refreshAmigosData]);

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
          getAmigos({ silent: true }),
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

        await getAmigos({ silent: true });
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
      logger.error('Error searching users:', searchError);
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
    return <div className="text-center p-5 bg-red-500/10 border border-red-400/30 rounded-card text-red-300 mt-5">Error: {error}</div>;
  }

  const searchInputClass = 'w-full h-12 px-5 text-[14px] border border-[rgba(148,134,255,0.25)] !rounded-full bg-[rgba(20,16,41,0.85)] text-white font-sans box-border placeholder-white/35 focus:outline-none focus:border-[#8b7cff] focus:ring-2 focus:ring-[#6a43ff]/30 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';

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

      <div className={`w-full ${activeTab === 'groups' ? 'mb-7' : 'mb-4'}`}>
        <div className={PRIMARY_TOGGLE_CONTAINER_CLASS}>
          <button
            type="button"
            onClick={() => handleTabChange('friends')}
            className={`relative flex-1 min-w-0 border px-0 py-0 font-sans font-semibold text-[12.5px] tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${
              activeTab === 'friends'
                ? PRIMARY_TOGGLE_ACTIVE_CLASS
                : PRIMARY_TOGGLE_INACTIVE_CLASS
            }`}
          >
            AMIGOS
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('groups')}
            className={`relative flex-1 min-w-0 border px-0 py-0 font-sans font-semibold text-[12.5px] tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${
              activeTab === 'groups'
                ? PRIMARY_TOGGLE_ACTIVE_CLASS
                : PRIMARY_TOGGLE_INACTIVE_CLASS
            }`}
          >
            GRUPOS
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('discover')}
            className={`relative flex-1 min-w-0 border px-0 py-0 font-sans font-semibold text-[12.5px] tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${
              activeTab === 'discover'
                ? PRIMARY_TOGGLE_ACTIVE_CLASS
                : PRIMARY_TOGGLE_INACTIVE_CLASS
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <span>COMUNIDAD</span>
              {pendingRequests.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#ec007d] text-white text-[10px] font-bold rounded-full shadow-[0_0_10px_rgba(236,0,125,0.45)]">
                  {pendingRequests.length}
                </span>
              )}
            </span>
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

            {searchQuery && (
              <div className="w-full max-w-[700px] mx-auto rounded-2xl absolute left-1/2 -translate-x-1/2 top-full bg-[#141029]/98 border border-[rgba(148,134,255,0.3)] max-h-[300px] overflow-y-auto z-[1000] mt-2 sm:max-w-[98vw] shadow-[0_24px_64px_rgba(5,3,16,0.65)] backdrop-blur-xl custom-scrollbar">
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
                        loadFriendSuggestions({ silent: true });
                      }}
                    />
                  ))
                ) : (
                  <div className="p-4 text-center text-white/68 text-sm">
                    No se encontraron usuarios
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pending requests */}
          {pendingRequests.length > 0 && (
            <div className="flex flex-col items-center mb-5 md:mb-8 w-full max-w-[500px] mx-auto">
              <div className="w-full mt-5 mb-3.5">
                <span className="section-eyebrow">Comunidad</span>
                <h3 className="section-title">Solicitudes pendientes</h3>
              </div>
              <div className="flex flex-col gap-2.5 w-full">
                {pendingRequests.map((request) => (
                  <div key={request.profile?.uuid || request.profile?.id || request.id} className="flex items-center gap-3 p-3.5 rounded-card bg-[linear-gradient(165deg,rgba(48,38,98,0.68),rgba(20,16,41,0.92))] border border-[rgba(148,134,255,0.25)] mb-3 w-full box-border min-h-[64px] transition-all duration-200 shadow-elev-1 hover:border-[rgba(148,134,255,0.5)] sm:p-3">
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
                        <span className="text-lg font-bold text-white font-oswald whitespace-nowrap overflow-hidden text-ellipsis mb-1 sm:text-base">
                          {request.profile?.nombre || 'Usuario'}
                        </span>
                      </div>
                    </PlayerCardTrigger>
                    <div className="flex gap-2 shrink-0">
                      <button
                        className="h-11 w-11 rounded-full border border-[#7d5aff] bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4)] transition-all hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
                        className="h-11 w-11 rounded-full border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/85 transition-all hover:bg-white/[0.1] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
            <div className="w-full mt-5 mb-3.5">
              <span className="section-eyebrow">Para vos</span>
              <h3 className="section-title">Sugerencias de amistad</h3>
            </div>

            {suggestionsLoading ? (
              <div className="w-full p-4 surface-card rounded-card flex items-center justify-center gap-2 text-white/70">
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
                      loadFriendSuggestions({ silent: true });
                    }}
                  />
                ))}
              </div>
            ) : (
              <EmptyStateCard
                title="Todavia no tenemos sugerencias."
                titleClassName={EMPTY_STATE_TITLE_CLASS}
                description="Cuando compartas mas partidos con jugadores nuevos, te los recomendamos aca."
                className="my-0 p-5"
              />
            )}
          </div>
        </>
      ) : activeTab === 'groups' ? (
        <PrivateGroupsTab
          currentUserId={currentUserId}
          friends={amigos}
          onInlineNotice={showInlineNotice}
        />
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
          </div>

          {Array.isArray(amigos) && amigos.length > 0 ? (
            sortedFriends.length > 0 ? (
              <div className="flex flex-col items-center w-full max-w-[500px] mx-auto relative z-0">
                <p className="w-full mb-2 px-1 text-[11px] uppercase tracking-wider text-white/55">
                  Ordenados por cercania
                </p>
                <div className="flex flex-col gap-2 w-full max-w-none overflow-visible pb-2 sm:gap-1.5 sm:pb-3">
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
              <EmptyStateCard
                icon={Users}
                title="No encontramos amigos"
                titleClassName={EMPTY_STATE_TITLE_CLASS}
                description="Probá con otro nombre o email."
                className="my-0 p-5"
              />
            )
          ) : (
            <EmptyStateCard
              icon={Users}
              title="No tenes amigos agregados"
              titleClassName={EMPTY_STATE_TITLE_CLASS}
              description="Usá la solapa Comunidad para enviar solicitudes."
              className="my-0 p-5"
            />
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
    <div className="flex items-center justify-between p-3 border border-[rgba(148,134,255,0.16)] rounded-card bg-[linear-gradient(165deg,rgba(48,38,98,0.55),rgba(20,16,41,0.88))] shadow-[0_4px_12px_rgba(5,3,16,0.3),inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:border-[rgba(148,134,255,0.42)] hover:brightness-[1.05]">
      <PlayerCardTrigger profile={user}>
        <div className="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
          <img
            src={user.avatar_url || '/profile.svg'}
            alt={user.nombre}
            className="w-10 h-10 rounded-full object-cover border-2 border-[rgba(148,134,255,0.35)]"
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
          px-4 h-9 bg-cta-gradient text-white border border-[#7d5aff] rounded-full text-xs font-sans font-semibold tracking-[0.01em] cursor-pointer transition-all hover:brightness-110 whitespace-nowrap shadow-[0_4px_14px_rgba(106,67,255,0.35)]
          ${isButtonDisabled() ? 'opacity-50 cursor-not-allowed hover:brightness-100 shadow-none' : ''}
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
