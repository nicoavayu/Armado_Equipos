import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useInterval } from '../hooks/useInterval';
import { supabase } from '../supabase';
import { clearMatchFromList } from '../services/matchFinishService';
import { cancelPartidoWithNotification } from '../services/db/matches';
import { cancelTeamMatch, getTeamMatchByChallengeId, listMyTeamMatches } from '../services/db/teamChallenges';
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

const normalizeTextToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const isChallengeLikeName = (matchName = '') => /^desafio\s*:/.test(normalizeTextToken(matchName));

const isTeamMatchNavigationTarget = (partido = {}) => {
  if (!partido || typeof partido !== 'object') return false;

  const sourceType = normalizeTextToken(partido?.source_type || partido?.sourceType);
  if (sourceType === 'team_match') return true;

  const originType = normalizeTextToken(partido?.origin_type || partido?.originType);
  if (originType === 'challenge') return true;

  const matchName = partido?.nombre || partido?.titulo || partido?.name || '';
  if (isChallengeLikeName(matchName)) return true;

  return Boolean(
    partido?.team_match_id
    || partido?.teamMatchId
    || partido?.challenge_id
    || partido?.challengeId
  );
};

const parseChallengeTeamsFromName = (matchName = '') => {
  const raw = String(matchName || '').trim();
  if (!raw) return null;
  const parsed = raw.match(/^desaf[ií]o\s*:\s*(.+?)\s+vs\.?\s+(.+)$/i);
  if (!parsed) return null;
  return {
    teamA: String(parsed[1] || '').trim(),
    teamB: String(parsed[2] || '').trim(),
  };
};

const buildTeamsKey = (teamA, teamB) => {
  const a = normalizeTextToken(teamA);
  const b = normalizeTextToken(teamB);
  if (!a || !b) return null;
  return [a, b].sort().join('::');
};

const buildDateHourKey = (fecha, hora) => {
  const f = String(fecha || '').trim();
  const h = String(hora || '').trim();
  if (!f) return null;
  return `${f}|${h}`;
};

const normalizeIdToken = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const isCancelledTeamMatchStatus = (statusValue) => {
  const normalized = normalizeTextToken(statusValue);
  return normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancelado';
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
        const matchKey = String(partido_id);
        const expectedVotanteId = userJugadorIdByMatch[partido_id] || userJugadorIdByMatch[matchKey];
        if (!expectedVotanteId) return;
        if (String(votante_id) !== String(expectedVotanteId)) return; // solo mi encuesta para ese partido
        setCompletedSurveys((prev) => { const s = new Set(prev); s.add(matchKey); return s; });
        setPartidos((prev) => prev.filter((p) => String(p.id) !== matchKey && String(p?.partido_id || '') !== matchKey)); // limpia inmediatamente
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, userJugadorIdByMatch]);

  // Refetch al volver con ?surveyDone=1
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('surveyDone') === '1') {
      fetchUserMatches();
      urlParams.delete('surveyDone');
      const nextSearch = urlParams.toString();
      navigate({
        pathname: window.location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      }, { replace: true });
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

      const partidosEnriquecidosBase = partidosFiltrados.map((partido) => ({
        ...partido,
        userRole: partidosAdminIds.includes(partido.id) ? 'admin' : 'player',
        userJoined: partidosComoJugador.includes(partido.id),
        hasCompletedSurvey: localCompletedSurveys.has(String(partido.id)),
      }));

      const teamMatches = await listMyTeamMatches(user.id, {
        statuses: ['pending', 'confirmed'],
      });

      const teamMatchesEnriquecidos = (teamMatches || []).map((match) => {
        if (isCancelledTeamMatchStatus(match?.status)) {
          return null;
        }

        const { fecha, hora } = toLocalDateParts(match?.scheduled_at);
        const formatNumber = Number(match?.format);
        const isChallengeOrigin = (
          normalizeTextToken(match?.origin_type || '') === 'challenge'
          || Boolean(match?.challenge_id)
        );
        const expectedPlayers = Number.isFinite(formatNumber) && formatNumber > 0
          ? formatNumber * 2
          : null;
        const linkedPartidoId = Number(match?.partido_id);
        const hasLinkedPartidoId = Number.isFinite(linkedPartidoId) && linkedPartidoId > 0;
        const linkedPartidoKey = hasLinkedPartidoId ? String(linkedPartidoId) : null;

        if (linkedPartidoKey && (clearedMatchIds.has(linkedPartidoKey) || localCompletedSurveys.has(linkedPartidoKey))) {
          return null;
        }

        return {
          id: match.id,
          team_match_id: match.id,
          partido_id: hasLinkedPartidoId ? linkedPartidoId : null,
          source_type: 'team_match',
          origin_type: isChallengeOrigin ? 'challenge' : (match.origin_type || 'individual'),
          challenge_id: match.challenge_id || null,
          modalidad: `F${match?.format || '-'}`,
          origin_badge: isChallengeOrigin ? 'Desafio' : 'Amistoso',
          genero_partido: String(match?.mode || '').trim() || 'Masculino',
          fecha,
          hora,
          scheduled_at: match?.scheduled_at || null,
          sede: match?.location || match?.location_name || '',
          precio_cancha_por_persona: match?.cancha_cost ?? null,
          cupo_jugadores: expectedPlayers,
          team_a: match?.team_a || null,
          team_b: match?.team_b || null,
          userRole: match?.canManage ? 'admin' : 'player',
          userJoined: true,
          hasCompletedSurvey: linkedPartidoKey ? localCompletedSurveys.has(linkedPartidoKey) : false,
          can_manage: Boolean(match?.canManage),
          team_match_status: match?.status || 'pending',
          is_format_combined: Boolean(match?.is_format_combined),
        };
      }).filter(Boolean);

      const partidoIdsForBridgeLookup = partidosEnriquecidosBase
        .map((partido) => Number(partido?.id || 0))
        .filter((partidoId, idx, arr) => Number.isFinite(partidoId) && partidoId > 0 && arr.indexOf(partidoId) === idx);

      let teamMatchBridgeRows = [];
      if (partidoIdsForBridgeLookup.length > 0) {
        const { data: bridgeData, error: bridgeError } = await supabase
          .from('team_matches')
          .select('id, partido_id, origin_type, challenge_id, status, scheduled_at, location, location_name, cancha_cost, format, mode')
          .in('partido_id', partidoIdsForBridgeLookup);

        if (bridgeError) {
          console.warn('[PROXIMOS] team_matches bridge lookup failed', {
            code: bridgeError?.code,
            message: bridgeError?.message,
          });
        } else {
          teamMatchBridgeRows = bridgeData || [];
        }
      }

      const teamMatchByPartidoId = new Map();

      teamMatchBridgeRows.forEach((row) => {
        if (isCancelledTeamMatchStatus(row?.status)) return;

        const partidoId = Number(row?.partido_id);
        if (!Number.isFinite(partidoId) || partidoId <= 0) return;

        const rowFormat = Number(row?.format);
        const expectedPlayers = Number.isFinite(rowFormat) && rowFormat > 0
          ? rowFormat * 2
          : null;
        const isChallengeOrigin = (
          normalizeTextToken(row?.origin_type || '') === 'challenge'
          || Boolean(row?.challenge_id)
        );

        teamMatchByPartidoId.set(String(partidoId), {
          id: row?.id || null,
          team_match_id: row?.id || null,
          partido_id: partidoId,
          source_type: 'team_match',
          origin_type: isChallengeOrigin ? 'challenge' : (row?.origin_type || 'individual'),
          challenge_id: row?.challenge_id || null,
          modalidad: `F${row?.format || '-'}`,
          origin_badge: isChallengeOrigin ? 'Desafio' : 'Amistoso',
          genero_partido: String(row?.mode || '').trim() || 'Masculino',
          scheduled_at: row?.scheduled_at || null,
          sede: row?.location || row?.location_name || '',
          precio_cancha_por_persona: row?.cancha_cost ?? null,
          cupo_jugadores: expectedPlayers,
          team_match_status: row?.status || 'pending',
        });
      });

      teamMatchesEnriquecidos
        .filter((match) => match?.partido_id)
        .forEach((match) => {
          teamMatchByPartidoId.set(String(match.partido_id), match);
        });

      const teamMatchBySignature = new Map();
      teamMatchesEnriquecidos.forEach((match) => {
        const teamsKey = buildTeamsKey(match?.team_a?.name, match?.team_b?.name);
        const dateHourKey = buildDateHourKey(match?.fecha, match?.hora);
        if (teamsKey && dateHourKey) {
          teamMatchBySignature.set(`${teamsKey}|${dateHourKey}`, match);
        }
        if (teamsKey) {
          const fallbackKey = `${teamsKey}|*`;
          if (!teamMatchBySignature.has(fallbackKey)) {
            teamMatchBySignature.set(fallbackKey, match);
          }
        }
      });

      const partidosEnriquecidos = partidosEnriquecidosBase.map((partido) => {
        const partidoIdKey = String(partido?.id || '');
        const linkedByPartidoId = teamMatchByPartidoId.get(partidoIdKey) || null;
        const matchName = partido?.nombre || partido?.titulo || partido?.name || '';
        const hasChallengeLikeName = isChallengeLikeName(matchName);

        const parsedTeams = parseChallengeTeamsFromName(matchName);
        const parsedTeamsKey = buildTeamsKey(parsedTeams?.teamA, parsedTeams?.teamB);
        const dateHourKey = buildDateHourKey(partido?.fecha, partido?.hora);
        const linkedBySignature = parsedTeamsKey
          ? (
            (dateHourKey ? teamMatchBySignature.get(`${parsedTeamsKey}|${dateHourKey}`) : null)
            || teamMatchBySignature.get(`${parsedTeamsKey}|*`)
            || null
          )
          : null;

        const linkedTeamMatch = linkedByPartidoId || linkedBySignature || null;
        if (isCancelledTeamMatchStatus(linkedTeamMatch?.team_match_status || linkedTeamMatch?.status)) {
          return null;
        }
        const shouldTreatAsChallenge = Boolean(
          linkedTeamMatch
          || partido?.team_match_id
          || partido?.teamMatchId
          || partido?.challenge_id
          || partido?.challengeId
          || hasChallengeLikeName
          || normalizeTextToken(partido?.origin_type || partido?.originType) === 'challenge'
          || normalizeTextToken(partido?.source_type || partido?.sourceType) === 'team_match'
        );
        if (!shouldTreatAsChallenge) return partido;

        const inferredCupo = Number(linkedTeamMatch?.cupo_jugadores || 0);
        const fallbackCupo = Number(partido?.cupo_jugadores || 0);
        const resolvedCupo = Number.isFinite(inferredCupo) && inferredCupo > 0
          ? inferredCupo
          : (Number.isFinite(fallbackCupo) && fallbackCupo > 0 ? fallbackCupo : null);

        const teamAName = linkedTeamMatch?.team_a?.name || parsedTeams?.teamA || '';
        const teamBName = linkedTeamMatch?.team_b?.name || parsedTeams?.teamB || '';
        const hasChallengeOrigin = (
          normalizeTextToken(linkedTeamMatch?.origin_type || linkedTeamMatch?.originType || partido?.origin_type || partido?.originType) === 'challenge'
          || Boolean(linkedTeamMatch?.challenge_id || partido?.challenge_id || partido?.challengeId)
          || hasChallengeLikeName
        );

        return {
          ...partido,
          source_type: 'team_match',
          origin_type: hasChallengeOrigin ? 'challenge' : 'individual',
          origin_badge: hasChallengeOrigin ? 'Desafio' : 'Amistoso',
          team_match_id: linkedTeamMatch?.team_match_id || linkedTeamMatch?.id || partido?.team_match_id || partido?.teamMatchId || null,
          challenge_id: linkedTeamMatch?.challenge_id || partido?.challenge_id || null,
          modalidad: linkedTeamMatch?.modalidad || partido?.modalidad || 'F5',
          genero_partido: linkedTeamMatch?.genero_partido || partido?.tipo_partido || 'Masculino',
          sede: linkedTeamMatch?.sede || partido?.sede || '',
          precio_cancha_por_persona: linkedTeamMatch?.precio_cancha_por_persona ?? partido?.precio_cancha_por_persona ?? null,
          cupo_jugadores: resolvedCupo,
          team_a: linkedTeamMatch?.team_a || (teamAName ? { name: teamAName } : null),
          team_b: linkedTeamMatch?.team_b || (teamBName ? { name: teamBName } : null),
          can_manage: Boolean(linkedTeamMatch?.can_manage),
          team_match_status: linkedTeamMatch?.team_match_status || linkedTeamMatch?.status || 'confirmed',
          userRole: linkedTeamMatch?.userRole || partido.userRole,
        };
      }).filter(Boolean);

      const linkedPartidoIds = new Set(
        teamMatchesEnriquecidos
          .map((match) => String(match?.partido_id || ''))
          .filter(Boolean),
      );

      const partidosEnriquecidosSinDuplicados = partidosEnriquecidos.filter(
        (partido) => !linkedPartidoIds.has(String(partido?.id || '')),
      );

      setPartidos([...partidosEnriquecidosSinDuplicados, ...teamMatchesEnriquecidos]);

    } catch (error) {
      console.error('Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const resolveTeamMatchId = async (partido) => {
    const directMatchId = normalizeIdToken(partido?.team_match_id || partido?.teamMatchId || null);
    if (directMatchId) {
      return directMatchId;
    }

    const challengeId = normalizeIdToken(partido?.challenge_id || partido?.challengeId || null);
    if (challengeId) {
      try {
        const challengeMatch = await getTeamMatchByChallengeId(challengeId);
        const challengeMatchId = normalizeIdToken(challengeMatch?.id || null);
        if (challengeMatchId) {
          return challengeMatchId;
        }
      } catch (error) {
        console.warn('[PROXIMOS] resolveTeamMatchId challenge lookup failed', {
          challengeId,
          message: error?.message || String(error),
        });
      }
    }

    const partidoIdCandidates = [partido?.partido_id, partido?.id]
      .map((value) => Number(value || 0))
      .filter((value, index, values) => (
        Number.isFinite(value)
        && value > 0
        && values.indexOf(value) === index
      ));

    for (const partidoId of partidoIdCandidates) {
      const lookupAttempts = [
        () => supabase
          .from('team_matches')
          .select('id')
          .eq('partido_id', partidoId)
          .in('status', ['pending', 'open', 'abierto', 'confirmed', 'confirmado', 'accepted', 'aceptado', 'matched', 'taken', 'ready', 'active'])
          .order('updated_at', { ascending: false })
          .limit(1),
        () => supabase
          .from('team_matches')
          .select('id')
          .eq('partido_id', partidoId)
          .order('updated_at', { ascending: false })
          .limit(1),
      ];

      for (const executeLookup of lookupAttempts) {
        const { data, error } = await executeLookup();
        if (error) {
          console.warn('[PROXIMOS] resolveTeamMatchId partido lookup failed', {
            partidoId,
            code: error?.code,
            message: error?.message,
          });
          continue;
        }

        const inferredMatchId = Number(data?.[0]?.id || 0);
        if (Number.isFinite(inferredMatchId) && inferredMatchId > 0) {
          return inferredMatchId;
        }
      }
    }

    return null;
  };

  const _handleMatchClick = async (partido) => {
    onClose();
    if (isTeamMatchNavigationTarget(partido)) {
      const teamMatchId = await resolveTeamMatchId(partido);
      if (teamMatchId) {
        navigate(`/desafios/equipos/partidos/${teamMatchId}`);
      } else {
        const matchName = partido?.nombre || partido?.titulo || partido?.name || '';
        const fallbackPartidoId = Number(partido?.partido_id || partido?.id || 0);
        if (isChallengeLikeName(matchName)) {
          notifyBlockingError('No se pudo resolver este desafío. Te llevamos a Desafíos.');
          navigate('/desafios');
          return;
        }
        if (Number.isFinite(fallbackPartidoId) && fallbackPartidoId > 0) {
          notifyBlockingError('No se pudo resolver el detalle de desafío. Abrimos el detalle del partido.');
          navigate(`/admin/${fallbackPartidoId}`);
        } else {
          notifyBlockingError('No se pudo abrir el detalle del partido.');
        }
      }
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
          const teamMatchId = partidoTarget?.team_match_id || null;
          if (!teamMatchId) {
            notifyBlockingError('No se pudo identificar el desafío para cancelarlo.');
            setProcessingDeleteId(null);
            return;
          }
          await cancelTeamMatch(teamMatchId);
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
      if (isCancelledTeamMatchStatus(status)) return true;
      if (status === 'played') return true;
      const scheduledAt = partido?.scheduled_at ? new Date(partido.scheduled_at) : null;
      if (scheduledAt && !Number.isNaN(scheduledAt.getTime())) {
        return new Date() >= scheduledAt;
      }
      if (!partido.fecha || !partido.hora) return false;
      const parsed = parseLocalDateTime(partido.fecha, partido.hora);
      if (!parsed) return false;
      return new Date() >= parsed;
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

    if (matchFinished) {
      return { label: 'Ver partido', kind: 'details', disabled: false, onClick: () => _handleMatchClick(partido) };
    }

    if (joined) return { label: 'Ver partido', kind: 'details', disabled: false, onClick: () => _handleMatchClick(partido) };
    return { label: 'Ingresar', kind: 'join', disabled: false, onClick: () => _handleMatchClick(partido) };
  };

  const getPrimaryCtaButtonClass = (primaryCtaKind) => {
    switch (primaryCtaKind) {
      default:
        return 'bg-[#6a43ff] border border-[#7d5aff] text-white hover:bg-[#7550ff] shadow-[0_0_14px_rgba(106,67,255,0.3)]';
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

  const visiblePartidos = getSortedPartidos().filter((partido) => !isMatchFinished(partido));


  return (
    <div className="fixed top-0 left-0 w-screen h-[100dvh] text-white flex flex-col overflow-hidden z-[1000]">
      <PageTitle onBack={onClose} title="MIS PARTIDOS">MIS PARTIDOS</PageTitle>

      <div className="flex-1 pt-[96px] px-4 pb-[100px] overflow-y-auto w-full box-border sm:pt-[96px] sm:px-4 sm:pb-[100px]">
        {loading ? (
          <div className="text-center py-[60px] px-5">
            <LoadingSpinner size="medium" fullScreen />
          </div>
        ) : visiblePartidos.length === 0 ? (
          <div className="text-center py-[60px] px-5 mt-[70px]">
            <p className="text-[22px] font-bold mb-2 text-white text-center font-oswald">No tienes partidos próximos</p>
            <span className="text-[15px] opacity-95 block text-center text-white/80">Crea un partido o únete a uno para verlo aquí</span>
          </div>
        ) : (
          <>
            {/* Sorting controls removed: always sorted by proximity */}
            <div className="flex flex-col gap-[1px] w-full box-border">
              {visiblePartidos.map((partido) => {
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
          actionType === 'cancel' ? 'Aceptar' :
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
