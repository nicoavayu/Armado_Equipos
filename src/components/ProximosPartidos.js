import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useInterval } from '../hooks/useInterval';
import { supabase } from '../supabase';
import { clearMatchFromList } from '../services/matchFinishService';
import { cancelPartidoWithNotification } from '../services/db/matches';
import { cancelTeamMatch, listMyTeamMatches } from '../services/db/teamChallenges';
import { parseLocalDateTime, formatLocalDateShort } from '../utils/dateLocal';
import { canAbandonWithoutPenalty, incrementMatchesAbandoned } from '../utils/matchStatsManager';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import ConfirmModal from './ConfirmModal';
import { notifyBlockingError } from 'utils/notifyBlockingError';

import MatchCard from './MatchCard';

const toLocalDateParts = (isoValue) => {
  if (!isoValue) return { fecha: null, hora: null };
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return { fecha: null, hora: null };
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return {
    fecha: `${year}-${month}-${day}`,
    hora: `${hour}:${minute}`,
  };
};

const ProximosPartidos = ({ onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [partidos, setPartidos] = useState([]);
  const [loading, setLoading] = useState(true);
  // Always sort by temporal proximity (soonest first)
  const [_clearedMatches, setClearedMatches] = useState(new Set());
  const [_completedSurveys, setCompletedSurveys] = useState(new Set());
  const [_userJugadorIds, setUserJugadorIds] = useState([]);
  const [userJugadorIdByMatch, setUserJugadorIdByMatch] = useState({});

  const [menuOpenId, setMenuOpenId] = useState(null);

  // Per-match processing id flags so only the clicked button is disabled
  const [_processingDeleteId, setProcessingDeleteId] = useState(null);
  const [_processingClearId, setProcessingClearId] = useState(null);

  // Confirmation modal state (shared for clean / cancel / abandon)
  const [showConfirm, setShowConfirm] = useState(false);
  const [actionType, setActionType] = useState(null); // 'cancel' | 'clean' | 'abandon'
  const [partidoTarget, setPartidoTarget] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (user) {
      fetchUserMatches();
    }
  }, [user]);

  // Suscripción en tiempo real a inserts de encuestas
  useEffect(() => {
    if (!user || !Object.keys(userJugadorIdByMatch).length) return;
    const channel = supabase
      .channel('post_match_surveys_inserts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_match_surveys' }, (payload) => {
        const { partido_id, votante_id } = payload.new || {};
        if (!partido_id || !votante_id) return;
        const expectedVotanteId = userJugadorIdByMatch[partido_id];
        if (!expectedVotanteId) return;
        if (String(votante_id) !== String(expectedVotanteId)) return; // solo mi encuesta para ese partido
        setCompletedSurveys((prev) => { const s = new Set(prev); s.add(partido_id); return s; });
        setPartidos((prev) => prev.filter((p) => p.id !== partido_id)); // limpia inmediatamente
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, userJugadorIdByMatch]);

  // Refetch al volver con ?surveyDone=1
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('surveyDone') === '1') {
      fetchUserMatches();
      navigate('/proximos', { replace: true });
    }
  }, [navigate]);

  // Force re-render every minute to update match status
  const { setIntervalSafe, clearIntervalSafe } = useInterval();

  useEffect(() => {
    setIntervalSafe(() => {
      setPartidos((prev) => [...prev]); // Force re-render
    }, 60000);

    return () => clearIntervalSafe();
  }, [setIntervalSafe, clearIntervalSafe]);

  const fetchUserMatches = async () => {
    if (!user) return;

    try {
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

      // Get cleared matches for this user
      let clearedMatchIds = new Set();
      try {
        const { data: clearedData, error: clearedError } = await supabase
          .from('cleared_matches')
          .select('partido_id')
          .eq('user_id', user.id);

        if (!clearedError) {
          clearedMatchIds = new Set((clearedData?.map((c) => String(c.partido_id)) || []));
        } else {
          // Fallback to localStorage
          const key = `cleared_matches_${user.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          clearedMatchIds = new Set(existing.map((v) => String(v)));
        }
      } catch (error) {
        // Fallback to localStorage
        const key = `cleared_matches_${user.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        clearedMatchIds = new Set(existing.map((v) => String(v)));
      }
      setClearedMatches(clearedMatchIds);

      // Get completed surveys for this user
      let localCompletedSurveys = new Set();
      try {
        // First get the user's jugador IDs from all their matches (and map jugadorId by match)
        const { data: userJugadorIdsData, error: jugadorError } = await supabase
          .from('jugadores')
          .select('id, partido_id')
          .eq('usuario_id', user.id);

        if (!jugadorError && userJugadorIdsData && userJugadorIdsData.length > 0) {
          const jugadorIds = userJugadorIdsData.map((j) => j.id);
          setUserJugadorIds(jugadorIds);

          const byMatch = {};
          userJugadorIdsData.forEach((j) => {
            if (j.partido_id && j.id) byMatch[j.partido_id] = j.id;
          });
          setUserJugadorIdByMatch(byMatch);

          // IMPORTANT: completed survey must match the votante_id for THIS match
          const { data: surveysData, error: surveysError } = await supabase
            .from('post_match_surveys')
            .select('partido_id, votante_id');

          if (!surveysError && surveysData && surveysData.length > 0) {
            const completed = new Set();
            surveysData.forEach((row) => {
              const matchKey = String(row.partido_id);
              const expected = byMatch[row.partido_id] || byMatch[matchKey];
              if (expected && String(row.votante_id) === String(expected)) {
                completed.add(matchKey);
              }
            });
            localCompletedSurveys = completed;
            setCompletedSurveys(completed);
          }
        }
      } catch (error) {
        console.error('Error fetching completed surveys:', error);
      }

      let partidosData = [];
      if (todosLosPartidosIds.length > 0) {
        const legacyMatchesResponse = await supabase
          .from('partidos')
          .select(`
            *,
            jugadores(is_substitute)
          `)
          .in('id', todosLosPartidosIds)
          .order('fecha', { ascending: true })
          .order('hora', { ascending: true });

        if (legacyMatchesResponse.error) throw legacyMatchesResponse.error;
        partidosData = legacyMatchesResponse.data || [];
      }

      console.log('[PROXIMOS] Fetched matches IDs:', todosLosPartidosIds);
      console.log('[PROXIMOS] Returned matches from DB:', partidosData?.length);

      const now = new Date();
      const partidosFiltrados = partidosData.filter((partido) => {
        const estado = String(partido?.estado || '').toLowerCase();
        if (['cancelado', 'cancelled', 'deleted'].includes(estado) || partido?.deleted_at) {
          return false;
        }

        // Filter out cleared matches
        if (clearedMatchIds.has(String(partido.id))) {
          return false;
        }

        // Filter out matches with completed surveys (el partido desaparece cuando el usuario completa la encuesta)
        if (localCompletedSurveys.has(String(partido.id))) {
          return false;
        }

        if (!partido.fecha || !partido.hora) {
          return true;
        }

        try {
          const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
          if (!partidoDateTime) return true;
          // Show match until 1 hour after it started, then it becomes finished
          const partidoMasUnaHora = new Date(partidoDateTime.getTime() + 60 * 60 * 1000);
          return now <= partidoMasUnaHora;
        } catch (error) {
          return true;
        }
      });

      const partidosEnriquecidos = partidosFiltrados.map((partido) => ({
        ...partido,
        userRole: partidosAdminIds.includes(partido.id) ? 'admin' : 'player',
        userJoined: partidosComoJugador.includes(partido.id),
        hasCompletedSurvey: localCompletedSurveys.has(String(partido.id)),
      }));

      const teamMatches = await listMyTeamMatches(user.id, {
        statuses: ['pending', 'confirmed'],
      });

      const teamMatchesEnriquecidos = (teamMatches || []).map((match) => {
        const { fecha, hora } = toLocalDateParts(match?.scheduled_at);
        return {
          id: match.id,
          team_match_id: match.id,
          source_type: 'team_match',
          origin_type: match.origin_type || 'challenge',
          challenge_id: match.challenge_id || null,
          modalidad: `F${match?.format || '-'}`,
          tipo_partido: match?.origin_type === 'challenge' ? 'Desafio' : 'Amistoso',
          fecha,
          hora,
          scheduled_at: match?.scheduled_at || null,
          sede: match?.location || 'Cancha: a coordinar',
          precio_cancha_por_persona: match?.cancha_cost ?? null,
          team_a: match?.team_a || null,
          team_b: match?.team_b || null,
          userRole: match?.canManage ? 'admin' : 'player',
          userJoined: true,
          hasCompletedSurvey: false,
          can_manage: Boolean(match?.canManage),
          team_match_status: match?.status || 'pending',
          is_format_combined: Boolean(match?.is_format_combined),
        };
      });

      setPartidos([...partidosEnriquecidos, ...teamMatchesEnriquecidos]);

    } catch (error) {
      console.error('Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const _handleMatchClick = (partido) => {
    onClose();
    if (partido?.source_type === 'team_match') {
      navigate(`/quiero-jugar/equipos/partidos/${partido.team_match_id || partido.id}`);
      return;
    }
    navigate(`/admin/${partido.id}`);
  };

  const handleCancelMatch = (partido) => {
    setMenuOpenId(null);
    setPartidoTarget(partido);
    setActionType('cancel');
    setShowConfirm(true);
  };

  const handleAbandonMatch = (partido) => {
    if (partido?.source_type === 'team_match') return;
    if (partido?.userRole === 'admin') {
      console.info('Antes de abandonar, asigná el rol de admin a otro jugador.');
      return;
    }
    setMenuOpenId(null);
    setPartidoTarget(partido);
    setActionType('abandon');
    setShowConfirm(true);
  };

  const _handleSurveyClick = (e, partido) => {
    e.stopPropagation();
    navigate(`/encuesta/${partido.id}`);
  };

  const _handleClearMatch = (e, partido) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    console.log('[PROXIMOS] click LIMPIAR', partido?.id);
    setPartidoTarget(partido);
    setActionType('clean');
    setShowConfirm(true);
  };

  const handleConfirmAction = async () => {
    if (!partidoTarget || !actionType) {
      setShowConfirm(false);
      return;
    }

    setIsProcessing(true);
    try {
      if (actionType === 'cancel') {
        setProcessingDeleteId(partidoTarget.id);
        if (partidoTarget?.source_type === 'team_match') {
          await cancelTeamMatch(partidoTarget.team_match_id || partidoTarget.id);
        } else {
          await cancelPartidoWithNotification(partidoTarget.id, 'Partido cancelado por el administrador');
        }

        console.info('Partido cancelado');

        setPartidos((prev) => prev.filter((p) => p.id !== partidoTarget.id));
        setProcessingDeleteId(null);
      } else if (actionType === 'abandon') {
        console.log('[LEAVE_MATCH] Deleting player from match:', {
          matchId: partidoTarget.id,
          userId: user.id
        });

        setProcessingDeleteId(partidoTarget.id);
        const { error } = await supabase
          .from('jugadores')
          .delete()
          .eq('partido_id', partidoTarget.id)
          .eq('usuario_id', user.id);

        if (error) {
          console.error('[LEAVE_MATCH] Error:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
          });
          throw error;
        }

        console.log('[LEAVE_MATCH] Deleted successfully');

        try {
          const canAbandonSafely = canAbandonWithoutPenalty(
            partidoTarget?.fecha,
            partidoTarget?.hora,
          );
          if (!canAbandonSafely && user?.id) {
            await incrementMatchesAbandoned(user.id);
          }
        } catch (abandonError) {
          console.error('[LEAVE_MATCH] Error incrementing abandonment counter:', abandonError);
        }

        // Remove from local state
        setPartidos((prev) => prev.filter((p) => p.id !== partidoTarget.id));
        console.info('Abandonaste el partido');
        setProcessingDeleteId(null);
      } else if (actionType === 'clean') {
        setProcessingClearId(partidoTarget.id);
        const success = await clearMatchFromList(user.id, partidoTarget.id);
        if (success) {
          setPartidos((prev) => prev.filter((p) => p.id !== partidoTarget.id));
          setClearedMatches((prev) => { const s = new Set(prev); s.add(partidoTarget.id); return s; });
          console.info('Partido limpiado');
        } else {
          notifyBlockingError('No se pudo limpiar el partido');
        }
        setProcessingClearId(null);
      }
    } catch (error) {
      console.error('[PROXIMOS] confirm action error', error);
      notifyBlockingError('Ocurrió un error al procesar la acción');
    } finally {
      setIsProcessing(false);
      setShowConfirm(false);
      setActionType(null);
      setPartidoTarget(null);
    }
  };

  const isMatchFinished = (partido) => {
    if (partido?.source_type === 'team_match') {
      const status = String(partido?.team_match_status || '').toLowerCase();
      if (status === 'played') return true;
      return false;
    }

    if (!partido.fecha || !partido.hora) return false;

    try {
      const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
      if (!partidoDateTime) return false;
      const now = new Date();

      return now >= partidoDateTime;
    } catch (error) {
      console.error('Error checking match finish:', error);
      return false;
    }
  };

  const formatDate = (dateString) => formatLocalDateShort(dateString);

  const getPrimaryCta = (partido) => {
    if (partido?.source_type === 'team_match') {
      return { label: 'Ver partido', kind: 'details', disabled: false, onClick: () => _handleMatchClick(partido) };
    }

    const matchFinished = isMatchFinished(partido);
    const joined = !!partido.userJoined;
    const completed = !!partido.hasCompletedSurvey;

    if (matchFinished) {
      if (joined && !completed) {
        // Use a distinct visual treatment for post-match survey
        return { label: 'Completar encuesta', kind: 'survey', disabled: false, onClick: (e) => _handleSurveyClick(e, partido) };
      }
      if (joined && completed) return { label: 'Encuesta completada', kind: 'survey_done', disabled: true };
      return { label: 'Ver partido', kind: 'details', disabled: false, onClick: () => _handleMatchClick(partido) };
    }

    if (joined) return { label: 'Ver partido', kind: 'details', disabled: false, onClick: () => _handleMatchClick(partido) };
    return { label: 'Ingresar', kind: 'join', disabled: false, onClick: () => _handleMatchClick(partido) };
  };

  const getPrimaryCtaButtonClass = (primaryCtaKind) => {
    switch (primaryCtaKind) {
      case 'survey':
        // Orange/amber for "acción pendiente" (encuesta)
        return 'bg-gradient-to-r from-[#8178E5] to-[#6A5FE2] text-white hover:brightness-110 shadow-[0_0_15px_rgba(129,120,229,0.3)] animate-pulse border border-[#9b94f0]';
      case 'survey_done':
        return 'bg-slate-700 text-white/50 cursor-not-allowed border border-slate-600';
      default:
        return 'bg-[#128BE9] shadow-lg hover:brightness-110 hover:-translate-y-px';
    }
  };

  // Close menu on click-outside
  useEffect(() => {
    const onDocClick = () => setMenuOpenId(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const getSortedPartidos = () => {
    const partidosCopy = [...partidos];
    // Sort by temporal proximity (earliest upcoming first)
    return partidosCopy.sort((a, b) => {
      const dateA = a?.source_type === 'team_match'
        ? (a?.scheduled_at ? new Date(a.scheduled_at) : null)
        : parseLocalDateTime(a.fecha, a.hora);
      const dateB = b?.source_type === 'team_match'
        ? (b?.scheduled_at ? new Date(b.scheduled_at) : null)
        : parseLocalDateTime(b.fecha, b.hora);
      const ta = dateA && !Number.isNaN(dateA.getTime()) ? dateA.getTime() : Number.MAX_SAFE_INTEGER;
      const tb = dateB && !Number.isNaN(dateB.getTime()) ? dateB.getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  };


  return (
    <div className="fixed top-0 left-0 w-screen h-[100dvh] text-white flex flex-col overflow-hidden z-[1000]">
      <PageTitle onBack={onClose} title="MIS PARTIDOS">MIS PARTIDOS</PageTitle>

      <div className="flex-1 pt-[96px] px-4 pb-[100px] overflow-y-auto w-full box-border sm:pt-[96px] sm:px-4 sm:pb-[100px]">
        {loading ? (
          <div className="text-center py-[60px] px-5">
            <LoadingSpinner size="medium" />
          </div>
        ) : partidos.length === 0 ? (
          <div className="text-center py-[60px] px-5 mt-[70px]">
            <p className="text-[22px] font-bold mb-2 text-white text-center font-oswald">No tienes partidos próximos</p>
            <span className="text-[15px] opacity-95 block text-center text-white/80">Crea un partido o únete a uno para verlo aquí</span>
          </div>
        ) : (
          <>
            {/* Sorting controls removed: always sorted by proximity */}
            <div className="flex flex-col gap-[1px] w-full box-border">
              {getSortedPartidos().map((partido) => {
                const matchFinished = isMatchFinished(partido);
                const primaryCta = getPrimaryCta(partido);

                return (
                  <MatchCard
                    key={partido.id}
                    partido={{
                      ...partido,
                      fecha_display: partido?.fecha ? formatDate(partido.fecha) : 'A coordinar',
                    }}
                    isFinished={matchFinished}
                    userRole={partido.userRole}
                    userJoined={partido.userJoined}
                    onMenuToggle={(id) => setMenuOpenId((prev) => prev === id ? null : id)}
                    isMenuOpen={menuOpenId === partido.id}
                    onAbandon={partido?.source_type === 'team_match' ? null : handleAbandonMatch}
                    onCancel={partido?.source_type === 'team_match' ? (partido?.can_manage ? handleCancelMatch : null) : handleCancelMatch}
                    onClear={partido?.source_type === 'team_match' ? null : _handleClearMatch}
                    primaryAction={{
                      label: primaryCta.label,
                      disabled: primaryCta.disabled,
                      className: getPrimaryCtaButtonClass(primaryCta.kind),
                      onClick: (e) => {
                        if (typeof primaryCta.onClick === 'function') {
                          primaryCta.onClick(e);
                        }
                      }
                    }}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Confirmación de acción (cancelar / limpiar / abandonar) */}
      <ConfirmModal
        isOpen={showConfirm}
        title={
          actionType === 'cancel' ? 'Cancelar partido' :
            actionType === 'clean' ? 'Limpiar partido' :
              'Abandonar partido'
        }
        message={
          actionType === 'cancel'
            ? partidoTarget?.source_type === 'team_match'
              ? 'Este partido de equipos se cancelará y dejará de mostrarse en Mis partidos.'
              : <>
                Este partido se cancelará definitivamente.<br />
                Todos los jugadores serán notificados de que el administrador canceló el partido.<br />
                Esta acción no se puede deshacer.
              </>
            : actionType === 'clean'
              ? '¿Estás seguro de que deseas limpiar este partido de tu lista? Podrás volver a verlo en "Partidos finalizados".'
              : actionType === 'abandon'
                ? '¿Estás seguro de que deseas abandonar este partido?'
                : ''
        }
        onConfirm={handleConfirmAction}
        onCancel={() => setShowConfirm(false)}
        isDeleting={isProcessing}
        confirmText={
          actionType === 'cancel' ? 'Cancelar partido' :
            actionType === 'clean' ? 'Limpiar partido' :
              'Abandonar partido'
        }
        cancelText="Volver"
        danger={actionType === 'cancel'}
      />
    </div>
  );
};

export default ProximosPartidos;
