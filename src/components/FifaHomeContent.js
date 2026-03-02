import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Bell, CalendarClock, CheckCircle, ChevronRight, ClipboardList, Trophy, UserPlus, Users, Vote } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { useInterval } from '../hooks/useInterval';
import { supabase, updateProfile, addFreePlayer, removeFreePlayer } from '../supabase';
import { listMyTeamMatches } from '../services/db/teamChallenges';
import { parseLocalDateTime } from '../utils/dateLocal';
import { buildActivityFeed } from '../utils/activityFeed';
import ProximosPartidos from './ProximosPartidos';
import NotificationsBell from './NotificationsBell';

const activityIconMap = {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle,
  ClipboardList,
  Trophy,
  UserPlus,
  Users,
  Vote,
};

const severityIconClass = {
  urgent: 'text-[#ff5a5f]',
  warning: 'text-[#f5c451]',
  success: 'text-[#5ad17b]',
  neutral: 'text-white/80',
};

const AWARDS_RING_WINDOW_MS = 24 * 60 * 60 * 1000;
const AWARDS_RING_NOTIFICATION_TYPES = new Set(['survey_results_ready', 'awards_ready']);

const resolveNotificationMatchId = (notification) => (
  notification?.partido_id
  ?? notification?.data?.match_id
  ?? notification?.data?.matchId
  ?? notification?.match_ref
  ?? null
);

const hasAnyAwardsWinner = (row) => Boolean(
  row?.mvp
  || row?.golden_glove
  || row?.dirty_player
  || (Array.isArray(row?.red_cards) && row.red_cards.length > 0)
  || row?.awards?.mvp?.player_id
  || row?.awards?.best_gk?.player_id
  || row?.awards?.red_card?.player_id
);

const isAwardsInsufficientOrSkipped = (row) => {
  const awardsStatus = String(row?.awards_status || '').toLowerCase();
  return awardsStatus.includes('insufficient') || awardsStatus.includes('skip');
};

const isAwardsReadyAndVisible = (row) => (
  Boolean(row?.results_ready)
  && !isAwardsInsufficientOrSkipped(row)
  && hasAnyAwardsWinner(row)
);

const extractWinnerIds = (row) => {
  const awards = row?.awards || {};
  const mvpWinnerId = row?.mvp ?? awards?.mvp?.player_id ?? null;
  const gloveWinnerId = row?.golden_glove ?? awards?.best_gk?.player_id ?? null;
  const dirtyWinnerId = row?.dirty_player
    ?? (Array.isArray(row?.red_cards) ? row.red_cards[0] : null)
    ?? awards?.red_card?.player_id
    ?? null;

  return [mvpWinnerId, gloveWinnerId, dirtyWinnerId]
    .filter((id) => id !== null && id !== undefined && String(id).trim() !== '');
};

const hasRenderableWinnerInRoster = (row, roster = []) => {
  const winnerIds = extractWinnerIds(row);
  if (winnerIds.length === 0 || !Array.isArray(roster) || roster.length === 0) return false;

  return winnerIds.some((winnerId) => {
    const winnerStr = String(winnerId);
    const winnerStrLower = winnerStr.toLowerCase();

    return roster.some((player) => {
      const uuid = player?.uuid != null ? String(player.uuid) : '';
      const usuarioId = player?.usuario_id != null ? String(player.usuario_id) : '';
      const numericId = player?.id != null ? String(player.id) : '';

      return (
        uuid === winnerStr
        || usuarioId === winnerStr
        || numericId === winnerStr
        || (uuid && winnerStr && uuid.toLowerCase() === winnerStrLower)
      );
    });
  });
};

const FifaHomeContent = ({ _onCreateMatch, _onViewHistory, _onViewInvitations, _onViewActivePlayers }) => {
  const { user, profile, refreshProfile } = useAuth();
  const notificationsCtx = useNotifications() || {};
  const unreadCount = notificationsCtx.unreadCount || { friends: 0, matches: 0, total: 0 };
  const notifications = notificationsCtx.notifications || [];
  const markAsRead = notificationsCtx.markAsRead || (async () => {});
  const navigate = useNavigate();
  const location = useLocation();
  const { setIntervalSafe } = useInterval();
  const [activeMatches, setActiveMatches] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityItems, setActivityItems] = useState([]);
  const [showProximosPartidos, setShowProximosPartidos] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [awardsReadyVisibleMatchIds, setAwardsReadyVisibleMatchIds] = useState([]);
  const [awardsRingLoading, setAwardsRingLoading] = useState(false);
  const statusDropdownRef = useRef(null);
  const activityLoadedRef = useRef(false);

  const nowTs = Date.now();
  const awardsCandidateNotifs = (notifications || [])
    .filter((n) => AWARDS_RING_NOTIFICATION_TYPES.has(n.type))
    .filter((n) => {
      const createdTs = n?.created_at ? new Date(n.created_at).getTime() : 0;
      return createdTs > 0 && (nowTs - createdTs) <= AWARDS_RING_WINDOW_MS;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const awardsCandidateMatchIds = Array.from(new Set(
    awardsCandidateNotifs
      .map((notif) => resolveNotificationMatchId(notif))
      .filter((id) => id !== null && id !== undefined)
      .map((id) => String(id).trim())
      .filter(Boolean),
  ));
  const awardsCandidateMatchIdsKey = awardsCandidateMatchIds.join(',');
  const awardsReadyVisibleMatchIdSet = new Set((awardsReadyVisibleMatchIds || []).map((id) => String(id)));
  const awardsStoryNotifs = awardsCandidateNotifs.filter((notif) => {
    const matchId = resolveNotificationMatchId(notif);
    if (!matchId) return false;
    return awardsReadyVisibleMatchIdSet.has(String(matchId));
  });
  const hasAwardsStoryPending = awardsStoryNotifs.some((n) => !n.read);
  const hasAwardsStoryViewed = !hasAwardsStoryPending && awardsStoryNotifs.some((n) => n.read);
  const awardsReadyAndVisible = awardsStoryNotifs.length > 0;
  const shouldShowAwardsRing = !awardsRingLoading && awardsReadyAndVisible;

  const openAwardsStoryFromNotification = async (notif) => {
    const matchId = resolveNotificationMatchId(notif);
    if (!matchId) return false;
    if (!notif?.read && notif?.id) {
      try { await markAsRead(notif.id); } catch (_) { /* non-blocking */ }
    }
    const resultsUrl = notif?.data?.resultsUrl || `/resultados-encuesta/${matchId}?showAwards=1`;
    navigate(resultsUrl, {
      state: {
        forceAwards: true,
        fromNotification: true,
        matchName: notif?.data?.match_name || notif?.data?.partido_nombre || null,
      },
    });
    return true;
  };

  const handleAvatarClick = async (e) => {
    e.stopPropagation();
    if (shouldShowAwardsRing) {
      const latestPending = awardsStoryNotifs.find((n) => !n.read);
      const latestViewed = awardsStoryNotifs.find((n) => n.read);
      if (latestPending && await openAwardsStoryFromNotification(latestPending)) return;
      if (latestViewed && await openAwardsStoryFromNotification(latestViewed)) return;
    }
    toggleStatusDropdown(e);
  };

  const cardClass = 'bg-white/10 border border-white/20 rounded-none p-4 cursor-pointer transition-[transform,background-color,border-color,box-shadow] duration-300 aspect-square relative overflow-hidden flex flex-col justify-start no-underline text-white backdrop-blur-[15px] z-[1] hover:-translate-y-1.5 hover:scale-[1.02] hover:bg-white/20 hover:border-white/40 active:translate-y-0 active:scale-100 sm:p-3.5 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]';

  useEffect(() => {
    if (user) {
      fetchActiveMatches();

      // Actualizar cada 10 segundos para tiempo real
      setIntervalSafe(() => {
        fetchActiveMatches();
      }, 10000);
    }
  }, [user, setIntervalSafe]);

  useEffect(() => {
    if (!location?.state?.openProximosPartidos) return;
    setShowProximosPartidos(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    let cancelled = false;

    const validateAwardsRing = async () => {
      if (!user?.id) {
        setAwardsReadyVisibleMatchIds([]);
        setAwardsRingLoading(false);
        return;
      }

      const candidateMatchIds = awardsCandidateMatchIds;

      if (candidateMatchIds.length === 0) {
        setAwardsReadyVisibleMatchIds([]);
        setAwardsRingLoading(false);
        return;
      }

      const normalizedNumericIds = candidateMatchIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));

      if (normalizedNumericIds.length === 0) {
        setAwardsReadyVisibleMatchIds([]);
        setAwardsRingLoading(false);
        return;
      }

      setAwardsRingLoading(true);
      setAwardsReadyVisibleMatchIds([]);

      try {
        const { data: surveyResultsRows, error: surveyResultsError } = await supabase
          .from('survey_results')
          .select('*')
          .in('partido_id', normalizedNumericIds);

        if (surveyResultsError) throw surveyResultsError;

        const { data: rosterRows, error: rosterError } = await supabase
          .from('jugadores')
          .select('partido_id, id, uuid, usuario_id')
          .in('partido_id', normalizedNumericIds);

        if (rosterError) throw rosterError;

        const rosterByMatchId = new Map();
        (rosterRows || []).forEach((player) => {
          const key = String(player?.partido_id ?? '');
          if (!key) return;
          const list = rosterByMatchId.get(key) || [];
          list.push(player);
          rosterByMatchId.set(key, list);
        });

        const readyMatchIds = (surveyResultsRows || [])
          .filter((row) => isAwardsReadyAndVisible(row))
          .filter((row) => hasRenderableWinnerInRoster(row, rosterByMatchId.get(String(row.partido_id)) || []))
          .map((row) => String(row.partido_id));

        if (!cancelled) {
          setAwardsReadyVisibleMatchIds(readyMatchIds);
        }
      } catch (error) {
        console.warn('[AWARDS_RING] Could not validate awards visibility:', error);
        if (!cancelled) {
          setAwardsReadyVisibleMatchIds([]);
        }
      } finally {
        if (!cancelled) {
          setAwardsRingLoading(false);
        }
      }
    };

    validateAwardsRing();

    return () => {
      cancelled = true;
    };
  }, [user?.id, awardsCandidateMatchIdsKey]);

  const fetchActiveMatches = async () => {
    if (!user) {
      return;
    }

    try {
      // Usar la misma lógica que ProximosPartidos.js
      const { data: jugadoresData, error: jugadoresError } = await supabase
        .from('jugadores')
        .select('partido_id')
        .eq('usuario_id', user.id);

      if (jugadoresError) throw jugadoresError;

      const partidosComoJugador = jugadoresData?.map((j) => j.partido_id) || [];

      const { data: partidosComoAdmin, error: adminError } = await supabase
        .from('partidos')
        .select('id')
        .eq('creado_por', user.id);

      if (adminError) throw adminError;

      const partidosAdminIds = partidosComoAdmin?.map((p) => p.id) || [];
      const todosLosPartidosIds = Array.from(new Set([...partidosComoJugador, ...partidosAdminIds]))
        .filter((id) => id != null);

      // Obtener cleared matches
      let clearedMatchIds = new Set();
      try {
        const { data: clearedData, error: clearedError } = await supabase
          .from('cleared_matches')
          .select('partido_id')
          .eq('user_id', user.id);

        if (clearedError) {
          const key = `cleared_matches_${user.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          clearedMatchIds = new Set(existing.map((v) => String(v)));
        } else {
          clearedMatchIds = new Set((clearedData?.map((c) => String(c.partido_id)) || []));
        }
      } catch (error) {
        const key = `cleared_matches_${user.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        clearedMatchIds = new Set(existing.map((v) => String(v)));
      }

      // Obtener completed surveys
      let completedSurveys = new Set();
      try {
        const { data: userJugadorIdsData } = await supabase
          .from('jugadores')
          .select('id, partido_id')
          .eq('usuario_id', user.id);

        if (userJugadorIdsData?.length > 0) {
          const jugadorIds = userJugadorIdsData.map((j) => j.id);
          const { data: surveysData } = await supabase
            .from('post_match_surveys')
            .select('partido_id')
            .in('votante_id', jugadorIds);
          completedSurveys = new Set((surveysData?.map((s) => String(s.partido_id)) || []));
        }
      } catch (error) {
        console.error('Error fetching completed surveys:', error);
      }

      let partidosData = [];
      if (todosLosPartidosIds.length > 0) {
        const legacyMatchesResponse = await supabase
          .from('partidos')
          .select('*, jugadores(count)')
          .in('id', todosLosPartidosIds)
          .order('fecha', { ascending: true })
          .order('hora', { ascending: true });

        if (legacyMatchesResponse.error) throw legacyMatchesResponse.error;
        partidosData = legacyMatchesResponse.data || [];
      }

      const now = new Date();
      const partidosFiltrados = partidosData?.filter((partido) => {
        const estado = String(partido?.estado || '').toLowerCase();
        if (['cancelado', 'cancelled', 'deleted'].includes(estado) || partido?.deleted_at) {
          return false;
        }

        const partidoIdStr = String(partido.id);
        if (clearedMatchIds.has(partidoIdStr) || completedSurveys.has(partidoIdStr)) {
          return false;
        }

        if (!partido.fecha || !partido.hora) return true;

        try {
          const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
          if (!partidoDateTime) return true;
          const partidoMasUnaHora = new Date(partidoDateTime.getTime() + 60 * 60 * 1000);
          return now <= partidoMasUnaHora;
        } catch {
          return true;
        }
      }) || [];


      const teamMatches = await listMyTeamMatches(user.id, {
        statuses: ['pending', 'confirmed'],
      });

      const teamMatchesEnriquecidos = (teamMatches || []).map((match) => {
        const scheduledDate = match?.scheduled_at ? new Date(match.scheduled_at) : null;
        const year = scheduledDate ? scheduledDate.getFullYear() : null;
        const month = scheduledDate ? String(scheduledDate.getMonth() + 1).padStart(2, '0') : null;
        const day = scheduledDate ? String(scheduledDate.getDate()).padStart(2, '0') : null;
        const hour = scheduledDate ? String(scheduledDate.getHours()).padStart(2, '0') : null;
        const minute = scheduledDate ? String(scheduledDate.getMinutes()).padStart(2, '0') : null;

        return {
          id: match?.id,
          source_type: 'team_match',
          fecha: year ? `${year}-${month}-${day}` : null,
          hora: hour ? `${hour}:${minute}` : null,
          scheduled_at: match?.scheduled_at || null,
        };
      });

      setActiveMatches([...partidosFiltrados, ...teamMatchesEnriquecidos]);
    } catch (error) {
      console.error('Error fetching active matches:', error);
    } finally {
      // Activity loading is managed by the feed builder effect.
    }
  };

  const getInitial = () => {
    if (profile?.avatar_url) return null;
    return profile?.nombre?.charAt(0) || user?.email?.charAt(0) || '?';
  };

  const userName = profile?.nombre || user?.email?.split('@')[0] || 'Usuario';
  const truncatedName = userName.length > 15 ? `${userName.substring(0, 15)}...` : userName;
  const isAvailable = profile?.acepta_invitaciones !== false;
  const statusText = isAvailable ? 'Disponible' : 'Ocupado';

  const toggleStatusDropdown = (e) => {
    e.stopPropagation();
    setShowStatusDropdown(!showStatusDropdown);
  };

  const handleNotificationsClick = () => {
    navigate('/notifications');
    setShowStatusDropdown(false);
  };

  const updateAvailabilityStatus = async (status) => {
    if (!user) return;

    try {
      if ((profile?.acepta_invitaciones !== false) === status) {
        setShowStatusDropdown(false);
        return;
      }

      await updateProfile(user.id, { acepta_invitaciones: status });

      if (status) {
        try {
          await addFreePlayer();
        } catch (syncError) {
          const message = String(syncError?.message || '');
          if (!/ya est[aá]s anotado como disponible/i.test(message)) {
            throw syncError;
          }
        }
      } else {
        await removeFreePlayer();
      }

      await refreshProfile();
      setShowStatusDropdown(false);
    } catch (error) {
      console.error('Error updating availability status:', error);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadActivity = async () => {
      if (!user?.id) {
        if (!cancelled) {
          setActivityItems([]);
          setActivityLoading(false);
        }
        return;
      }

      if (!activityLoadedRef.current) {
        setActivityLoading(true);
      }
      const items = await buildActivityFeed(notifications || [], {
        activeMatches,
        currentUserId: user.id,
        supabaseClient: supabase,
      });

      if (!cancelled) {
        setActivityItems(items);
        activityLoadedRef.current = true;
        setActivityLoading(false);
      }
    };

    loadActivity();

    return () => {
      cancelled = true;
    };
  }, [activeMatches, notifications, user?.id]);

  // Mostrar ProximosPartidos si está activo
  if (showProximosPartidos) {
    return (
      <ProximosPartidos
        onClose={() => setShowProximosPartidos(false)}
      />
    );
  }

  return (
    <div className="w-full bg-transparent shadow-none">
      {/* Header elements - Avatar and Notifications */}
      {user && (
        <div className="relative left-1/2 right-1/2 ml-[-50vw] mr-[-50vw] w-screen mb-5 px-4 py-3 bg-white/5 border-y border-white/10 rounded-none backdrop-blur-[20px] shadow-lg">
          <div className="w-full max-w-[920px] mx-auto flex items-center justify-between">
            <div className="flex flex-row items-center justify-center cursor-pointer relative z-[10000]" ref={statusDropdownRef}>
            <div className="relative mr-4" onClick={handleAvatarClick}>
              {/* "Historias" ring: pending = violet->blue gradient, viewed = muted gray. */}
              <div
                className={[
                  'rounded-full',
                  shouldShowAwardsRing ? 'p-[2px]' : 'p-0',
                  hasAwardsStoryPending
                    ? 'bg-gradient-to-r from-[#ff2f5b] via-[#ff5f3a] to-[#ff9800] shadow-[0_0_0_2px_rgba(255,255,255,0.10),0_0_16px_rgba(255,111,53,0.30)]'
                    : shouldShowAwardsRing && hasAwardsStoryViewed
                      ? 'bg-white/25'
                      : 'bg-transparent',
                ].join(' ')}
              >
                <div className="w-10 h-10 rounded-full overflow-hidden bg-white/20 flex items-center justify-center text-white font-bold text-base">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div>
                      {getInitial()}
                    </div>
                  )}
                </div>
              </div>
              <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white/80 ${isAvailable ? 'bg-[#4CAF50]' : 'bg-[#F44336]'}`}></div>
            </div>

            <div className="flex flex-col" onClick={toggleStatusDropdown}>
              <div className="flex items-baseline">
                <div className="text-white font-oswald text-sm mr-[5px] opacity-90 drop-shadow-[0_1px_2px_rgba(255,255,255,0.2)]">Hola,</div>
                <div className="text-white font-oswald text-lg font-semibold drop-shadow-[0_1px_2px_rgba(255,255,255,0.2)]">{truncatedName}</div>
              </div>
              <div className={`font-oswald text-xs mt-[2px] ${isAvailable ? 'text-[#4CAF50]' : 'text-[#F44336]'}`}>{statusText}</div>
            </div>

            {showStatusDropdown && createPortal(
              <div className="fixed top-20 left-4 bg-[#1f2252]/95 rounded-2xl w-[290px] z-[2147483647] overflow-hidden shadow-[0_12px_36px_rgba(8,12,38,0.55)] border border-white/15 backdrop-blur-xl origin-top-left transition-all duration-200 animate-[dropdownSlideIn_0.2s_ease-out]">
                <div className="px-4 py-3 font-semibold text-white/90 border-b border-white/10 font-oswald tracking-wide text-xs">
                  Estado de disponibilidad
                </div>
                <div className="p-2.5 space-y-2">
                  <button
                    className={`w-full text-left flex items-start gap-3 px-3.5 py-3 rounded-xl cursor-pointer transition-colors duration-200 text-white/95 border ${isAvailable ? 'bg-primary/25 border-primary/45' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                    onClick={() => updateAvailabilityStatus(true)}
                    type="button"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-[#4CAF50] mt-1.5 shrink-0"></div>
                    <div className="min-w-0">
                      <div className="font-oswald text-base leading-none">Disponible</div>
                      <div className="font-oswald text-[13px] leading-[1.25] text-white/70 mt-1">
                        Te mostramos como jugador activo y te avisamos de partidos cerca.
                      </div>
                    </div>
                  </button>
                  <button
                    className={`w-full text-left flex items-start gap-3 px-3.5 py-3 rounded-xl cursor-pointer transition-colors duration-200 text-white/95 border ${!isAvailable ? 'bg-primary/25 border-primary/45' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                    onClick={() => updateAvailabilityStatus(false)}
                    type="button"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-[#F44336] mt-1.5 shrink-0"></div>
                    <div className="min-w-0">
                      <div className="font-oswald text-base leading-none">No disponible</div>
                      <div className="font-oswald text-[13px] leading-[1.25] text-white/70 mt-1">
                        Pausamos tu visibilidad y dejamos de enviarte avisos de partidos cercanos.
                      </div>
                    </div>
                  </button>
                </div>
              </div>,
              document.body,
            )}
            <style>{`
              @keyframes dropdownSlideIn {
                from { opacity: 0; transform: translateY(-10px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
            </div>

            <div className="flex items-center justify-end">
              <NotificationsBell
                unreadCount={unreadCount}
                onClick={handleNotificationsClick}
              />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-5 bg-transparent shadow-none">
        {/* Create New Match */}
        <Link to="/nuevo-partido" className={cardClass}>
          <div className="text-white font-oswald text-[18px] md:text-[20px] font-semibold leading-none drop-shadow-[0_2px_10px_rgba(129,120,229,0.5)] sm:text-[16px]">Partido<br />nuevo</div>
          <div className="absolute bottom-5 right-5 text-white/95 text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={60} height={60}>
              <path d="M320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576zM296 408L296 344L232 344C218.7 344 208 333.3 208 320C208 306.7 218.7 296 232 296L296 296L296 232C296 218.7 306.7 208 320 208C333.3 208 344 218.7 344 232L344 296L408 296C421.3 296 432 306.7 432 320C432 333.3 421.3 344 408 344L344 344L344 408C344 421.3 333.3 432 320 432C306.7 432 296 421.3 296 408z" />
            </svg>
          </div>
        </Link>

        {/* Próximos Partidos */}
        <div
          className={cardClass}
          onClick={() => user && setShowProximosPartidos(true)}
        >
          <div className="text-white font-oswald text-[18px] md:text-[20px] font-semibold leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.11)] sm:text-[16px]">Mis<br />partidos</div>
          <div className="absolute bottom-5 right-5 text-white/95 text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M64 320C64 461.4 178.6 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320zM305 441C295.6 450.4 280.4 450.4 271.1 441C261.8 431.6 261.7 416.4 271.1 407.1L358.1 320.1L271.1 233.1C261.7 223.7 261.7 208.5 271.1 199.2C280.5 189.9 295.7 189.8 305 199.2L409 303C418.4 312.4 418.4 327.6 409 336.9L305 441z" />
            </svg>
          </div>
          {activeMatches && activeMatches.length > 0 && (
            <div className="absolute top-3 right-3 bg-[#128BE9] text-white rounded-full w-5 h-5 flex items-center justify-center font-bold text-[11px] shadow-[0_2px_6px_rgba(0,0,0,0.18)] sm:w-[18px] sm:h-[18px] sm:text-[10px] sm:top-2.5 sm:right-2.5">{activeMatches.length}</div>
          )}
        </div>

        {/* Frecuentes */}
        <Link to="/frecuentes" className={cardClass}>
          <div className="text-white font-oswald text-[18px] md:text-[20px] font-semibold leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.11)] sm:text-[16px]">Frecuentes</div>
          <div className="absolute bottom-5 right-5 text-white/95 text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M320 128C426 128 512 214 512 320C512 426 426 512 320 512C254.8 512 197.1 479.5 162.4 429.7C152.3 415.2 132.3 411.7 117.8 421.8C103.3 431.9 99.8 451.9 109.9 466.4C156.1 532.6 233 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C234.3 64 158.5 106.1 112 170.7L112 144C112 126.3 97.7 112 80 112C62.3 112 48 126.3 48 144L48 256C48 273.7 62.3 288 80 288L104.6 288C105.1 288 105.6 288 106.1 288L192.1 288C209.8 288 224.1 273.7 224.1 256C224.1 238.3 209.8 224 192.1 224L153.8 224C186.9 166.6 249 128 320 128zM344 216C344 202.7 333.3 192 320 192C306.7 192 296 202.7 296 216L296 320C296 326.4 298.5 332.5 303 337L375 409C384.4 418.4 399.6 418.4 408.9 409C418.2 399.6 418.3 384.4 408.9 375.1L343.9 310.1L343.9 216z" />
            </svg>
          </div>
        </Link>

        {/* Estadísticas */}
        <Link to="/stats" className={cardClass}>
          <div className="text-white font-oswald text-[18px] md:text-[20px] font-semibold leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.11)] sm:text-[16px]">Estadísticas</div>
          <div className="absolute bottom-5 right-5 text-white/95 text-[28px] w-[52px] h-[52px] flex items-center justify-center sm:w-11 sm:h-11 sm:bottom-4 sm:right-4 sm:text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M256 144C256 117.5 277.5 96 304 96L336 96C362.5 96 384 117.5 384 144L384 496C384 522.5 362.5 544 336 544L304 544C277.5 544 256 522.5 256 496L256 144zM64 336C64 309.5 85.5 288 112 288L144 288C170.5 288 192 309.5 192 336L192 496C192 522.5 170.5 544 144 544L112 544C85.5 544 64 522.5 64 496L64 336zM496 160L528 160C554.5 160 576 181.5 576 208L576 496C576 522.5 554.5 544 528 544L496 544C469.5 544 448 522.5 448 496L448 208C448 181.5 469.5 160 496 160z" />
            </svg>
          </div>
        </Link>


      </div>

      {/* Recent Activity */}
      <section className="mt-5 mb-10">
        <h3 className="font-oswald text-[28px] m-0 mb-4 text-white/90 font-semibold tracking-[0.01em]">Actividad reciente</h3>

        <div className="relative left-1/2 right-1/2 ml-[-50vw] mr-[-50vw] w-screen">
          <div className="px-4">
            <div className="min-h-[340px]">
              {activityLoading ? (
                <div className="h-[340px] overflow-hidden">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={`activity-skeleton-${index}`} className="py-3">
                      <div className="flex items-start gap-3 px-2.5">
                        <div className="w-5 h-5 rounded-full bg-white/[0.14] animate-pulse mt-1" />
                        <div className="min-w-0 flex-1">
                          <div className="h-3.5 w-[82%] rounded bg-white/[0.13] animate-pulse" />
                          <div className="h-3 mt-2 w-[52%] rounded bg-white/[0.08] animate-pulse" />
                        </div>
                      </div>
                      {index < 3 && <div className="mt-3 h-px bg-white/[0.06]" />}
                    </div>
                  ))}
                </div>
              ) : activityItems.length > 0 ? (
                <div className="h-[340px] overflow-y-auto pr-0.5 custom-scrollbar">
                  {activityItems.map((item, index) => {
                    const Icon = activityIconMap[item.icon] || Bell;
                    const iconColorClass = severityIconClass[item.severity] || severityIconClass.neutral;
                    const subtitleParts = [item.subtitle];
                    if (item.count > 1) subtitleParts.push(`x${item.count}`);
                    const subtitleText = subtitleParts.filter(Boolean).join(' · ');

                    return (
                      <div key={item.id}>
                        <button
                          onClick={() => navigate(item.route)}
                          className="w-full flex items-start gap-3 px-3.5 py-3 rounded-none border border-white/20 text-left bg-white/[0.025] hover:bg-white/[0.045] active:bg-white/[0.06] transition-colors"
                        >
                          <div className={`mt-1 shrink-0 ${iconColorClass}`}>
                            <Icon size={17} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div
                              className="text-white/92 text-[14px] leading-[1.25rem] font-medium"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {item.title}
                            </div>
                            <div className="text-white/58 text-[12px] leading-4 mt-1 truncate">
                              {subtitleText}
                            </div>
                          </div>

                          <div className="pt-1.5 shrink-0 text-white/30">
                            <ChevronRight size={14} />
                          </div>
                        </button>

                        {index < activityItems.length - 1 && (
                          <div className="h-px bg-white/[0.06] my-0.5" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-[340px] flex flex-col items-center justify-center text-center px-5">
                  <Bell size={22} className="text-white/45 mb-3" />
                  <div className="font-oswald text-[23px] sm:text-[22px] leading-tight tracking-[0.01em] text-white/90 font-semibold">
                    Sin notificaciones
                  </div>
                  <div className="font-oswald text-[15px] text-white/60 mt-1.5 max-w-[360px]">
                    Cuando haya actividad nueva en tus partidos, te va a aparecer acá.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>


    </div>
  );
};

export default FifaHomeContent;
