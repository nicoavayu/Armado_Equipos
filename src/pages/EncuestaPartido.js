import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
import { useAuth } from '../components/AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import PageLoadingState from '../components/PageLoadingState';
import PageTransition from '../components/PageTransition';
import InlineNotice from '../components/ui/InlineNotice';
import TeamsDnDEditor from '../components/TeamsDnDEditor';
import { finalizeIfComplete } from '../services/surveyCompletionService';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import { clearMatchFromList } from '../services/matchFinishService';
import useInlineNotice from '../hooks/useInlineNotice';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { SURVEY_WINDOW_HOURS } from '../utils/surveyNotificationCopy';
import {
  buildPlayerRefToKeyMap,
  buildSeededInitialTeams,
  lockSurveyTeamsOnce,
  resolvePersistRef,
  resolvePlayerKey,
  toPlayerKeysFromRefs,
} from '../services/surveyTeamsService';
import {
  buildSurveyFlowSteps,
  resolveNextResultGateStep,
  SURVEY_STEPS,
} from '../utils/surveyFlow';

// Styles are now directly in Tailwind
// import './LegacyVoting.css'; // Removed

const Utils_formatTime = (iso) => {
  if (!iso) return '??';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const DEFAULT_FORM_DATA = {
  se_jugo: true,
  partido_limpio: true,
  asistieron_todos: true,
  jugadores_ausentes: [],
  jugadores_violentos: [],
  mvp_id: '',
  arquero_id: '',
  sin_arquero_fijo: false,
  motivo_no_jugado: '',
  ganador: '',
  resultado: '',
};

const normalizeIdentityToken = (value) => String(value || '').trim().toLowerCase();

const ensureLinkedPlayerForSurvey = async ({ matchId, user }) => {
  const matchIdNum = Number(matchId);
  if (!Number.isFinite(matchIdNum) || matchIdNum <= 0 || !user?.id) {
    return null;
  }

  const playerFields = 'id, partido_id, usuario_id, uuid, nombre, avatar_url, score, is_goalkeeper';

  const fetchLinkedRows = async () => {
    const { data, error } = await supabase
      .from('jugadores')
      .select(playerFields)
      .eq('partido_id', matchIdNum)
      .eq('usuario_id', user.id)
      .order('id', { ascending: true });
    if (error) throw error;
    return data || [];
  };

  let linkedRows = await fetchLinkedRows();
  if (linkedRows.length > 1) {
    const canonical = linkedRows[0];
    const duplicateIds = linkedRows
      .slice(1)
      .map((row) => Number(row?.id))
      .filter((value) => Number.isFinite(value));
    if (duplicateIds.length > 0) {
      try {
        await supabase
          .from('jugadores')
          .update({ usuario_id: null })
          .in('id', duplicateIds)
          .eq('partido_id', matchIdNum)
          .eq('usuario_id', user.id);
      } catch (_dedupeError) {
        // Non-blocking fallback.
      }
    }
    return canonical;
  }

  if (linkedRows.length === 1) return linkedRows[0];

  // Deterministic manual->user linkage: only when uuid exactly matches auth user id.
  try {
    const { data: rosterRows, error: rosterError } = await supabase
      .from('jugadores')
      .select(playerFields)
      .eq('partido_id', matchIdNum)
      .order('id', { ascending: true });
    if (rosterError) throw rosterError;

    const normalizedUserId = normalizeIdentityToken(user.id);
    const deterministicManualCandidates = (rosterRows || []).filter((row) => (
      !row?.usuario_id && normalizeIdentityToken(row?.uuid) === normalizedUserId
    ));

    if (deterministicManualCandidates.length === 1) {
      const manualRow = deterministicManualCandidates[0];
      const { data: relinkedRow, error: relinkErr } = await supabase
        .from('jugadores')
        .update({ usuario_id: user.id })
        .eq('id', manualRow.id)
        .eq('partido_id', matchIdNum)
        .is('usuario_id', null)
        .select(playerFields)
        .maybeSingle();

      if (!relinkErr && relinkedRow?.id) {
        return relinkedRow;
      }

      linkedRows = await fetchLinkedRows();
      if (linkedRows.length > 0) return linkedRows[0];
    }
  } catch (_manualLinkError) {
    // Non-blocking fallback.
  }

  // Never auto-create jugadores rows from survey entry.
  // If there is no deterministic link, this user is not an eligible voter for this match.
  return null;
};

const EncuestaPartido = () => {
  const { partidoId, matchId } = useParams();
  const id = partidoId ?? matchId;
  const { user } = useAuth();
  const { fetchNotifications } = useNotifications();
  const navigate = useNavigate();
  const { navigateWithAnimation: _navigateWithAnimation } = useAnimatedNavigation();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partido, setPartido] = useState(null);
  const [teamsConfirmed, setTeamsConfirmed] = useState(false);
  const [confirmedTeams, setConfirmedTeams] = useState({ teamA: [], teamB: [] });
  const [finalTeams, setFinalTeams] = useState({ teamA: [], teamB: [] });
  const [teamsLocked, setTeamsLocked] = useState(false);
  const [teamsSource, setTeamsSource] = useState(null);
  const [teamsLockedByUserId, setTeamsLockedByUserId] = useState(null);
  const [teamsLockedAt, setTeamsLockedAt] = useState(null);
  const [currentStep, setCurrentStep] = useState(SURVEY_STEPS.PLAYED);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [linkedPlayerId, setLinkedPlayerId] = useState(null);
  const [loggedRosterCount, setLoggedRosterCount] = useState(0);

  const [formData, setFormData] = useState(DEFAULT_FORM_DATA);
  const [jugadores, setJugadores] = useState([]);
  const [yaCalificado, _setYaCalificado] = useState(false);
  const [encuestaFinalizada, setEncuestaFinalizada] = useState(false);
  const [viewportRatio, setViewportRatio] = useState(() => {
    if (typeof window === 'undefined') return 0.6;
    return window.innerWidth / Math.max(window.innerHeight, 1);
  });
  const { notice, showInlineNotice, clearInlineNotice } = useInlineNotice();

  useEffect(() => {
    const updateViewportRatio = () => {
      setViewportRatio(window.innerWidth / Math.max(window.innerHeight, 1));
    };

    updateViewportRatio();
    window.addEventListener('resize', updateViewportRatio);
    return () => window.removeEventListener('resize', updateViewportRatio);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resetSurveyState = () => {
      clearInlineNotice();
      setPartido(null);
      setJugadores([]);
      setAlreadySubmitted(false);
      setEncuestaFinalizada(false);
      setTeamsConfirmed(false);
      setConfirmedTeams({ teamA: [], teamB: [] });
      setFinalTeams({ teamA: [], teamB: [] });
      setTeamsLocked(false);
      setTeamsSource(null);
      setTeamsLockedByUserId(null);
      setTeamsLockedAt(null);
      setCurrentStep(SURVEY_STEPS.PLAYED);
      setFormData({ ...DEFAULT_FORM_DATA });
      setLinkedPlayerId(null);
      setLoggedRosterCount(0);
    };

    const fetchPartidoData = async () => {
      try {
        if (!id || !user) {
          if (!cancelled) navigate('/');
          return;
        }

        const matchIdNum = Number(id);
        if (!Number.isFinite(matchIdNum) || matchIdNum <= 0) {
          throw new AppError('Partido inválido', ERROR_CODES.VALIDATION_ERROR);
        }

        setLoading(true);

        // Ensure exactly one linked jugadores row for the authenticated user in this match.
        const currentUserPlayer = await ensureLinkedPlayerForSurvey({
          matchId: matchIdNum,
          user,
        });

        if (cancelled) return;

        const { data: partidoData, error: partidoError } = await supabase
          .from('partidos_view')
          .select('*')
          .eq('id', id)
          .single();

        if (partidoError) throw partidoError;
        if (!partidoData) {
          throw new AppError('Partido no encontrado', ERROR_CODES.NOT_FOUND);
        }

        // teams_* metadata may come from partidos_view or public.partidos depending on environment.
        let teamsConfirmedValue = Boolean(partidoData?.teams_confirmed);
        let teamsLockedValue = false;
        let teamsSourceValue = teamsConfirmedValue ? 'admin' : null;
        let teamsLockedByValue = null;
        let teamsLockedAtValue = null;
        let persistedSurveyTeamA = [];
        let persistedSurveyTeamB = [];
        try {
          const { data: pRow, error: pErr } = await supabase
            .from('partidos')
            .select(
              'teams_confirmed, teams_locked, teams_source, teams_locked_by_user_id, teams_locked_at, survey_team_a, survey_team_b, final_team_a, final_team_b',
            )
            .eq('id', matchIdNum)
            .maybeSingle();
          if (!pErr && pRow) {
            if (typeof pRow.teams_confirmed === 'boolean') {
              teamsConfirmedValue = pRow.teams_confirmed;
            }
            teamsLockedValue = Boolean(pRow.teams_locked);
            teamsSourceValue = pRow.teams_source || (teamsConfirmedValue ? 'admin' : null);
            teamsLockedByValue = pRow.teams_locked_by_user_id || null;
            teamsLockedAtValue = pRow.teams_locked_at || null;
            persistedSurveyTeamA = Array.isArray(pRow.survey_team_a)
              ? pRow.survey_team_a
              : (Array.isArray(pRow.final_team_a) ? pRow.final_team_a : []);
            persistedSurveyTeamB = Array.isArray(pRow.survey_team_b)
              ? pRow.survey_team_b
              : (Array.isArray(pRow.final_team_b) ? pRow.final_team_b : []);
          }
        } catch (_e) {
          // Non-blocking fallback.
        }

        let jugadoresPartido = [];
        try {
          const { data: rosterRows, error: rosterError } = await supabase
            .from('jugadores')
            .select('*')
            .eq('partido_id', matchIdNum)
            .order('id', { ascending: true });
          if (rosterError) throw rosterError;
          jugadoresPartido = Array.isArray(rosterRows) ? rosterRows : [];
        } catch (_rosterFetchError) {
          jugadoresPartido = partidoData.jugadores && Array.isArray(partidoData.jugadores)
            ? partidoData.jugadores
            : [];
        }

        const loggedRosterPlayers = (jugadoresPartido || []).filter((player) => Boolean(player?.usuario_id));
        const loggedCount = loggedRosterPlayers.length;
        const currentUserEligiblePlayer = currentUserPlayer?.id
          ? (jugadoresPartido || []).find((row) => Number(row?.id) === Number(currentUserPlayer.id)) || currentUserPlayer
          : loggedRosterPlayers.find((row) => normalizeIdentityToken(row?.usuario_id) === normalizeIdentityToken(user.id));

        if (cancelled) return;
        setLoggedRosterCount(loggedCount);

        if (loggedCount === 0) {
          notifyBlockingError('Este partido no tiene jugadores con cuenta registrada. No se puede abrir la encuesta.');
          navigate('/proximos');
          return;
        }

        if (!currentUserEligiblePlayer?.id) {
          notifyBlockingError('Solo jugadores con cuenta registrada en este partido pueden completar la encuesta.');
          navigate('/proximos');
          return;
        }

        setLinkedPlayerId(currentUserEligiblePlayer.id);

        let hasSubmitted = false;
        const { data: existingSurvey, error: existingSurveyErr } = await supabase
          .from('post_match_surveys')
          .select('id')
          .eq('partido_id', parseInt(id))
          .eq('votante_id', currentUserEligiblePlayer.id)
          .maybeSingle();

        if (existingSurveyErr && existingSurveyErr.code !== 'PGRST116') {
          throw existingSurveyErr;
        }

        hasSubmitted = Boolean(existingSurvey?.id);
        if (cancelled) return;
        setAlreadySubmitted(hasSubmitted);

        setJugadores(jugadoresPartido);

        const playerRefToKey = buildPlayerRefToKeyMap(jugadoresPartido);
        let resolvedTeamA = [];
        let resolvedTeamB = [];

        try {
          const { data: confirmationRow, error: confirmationError } = await supabase
            .from('partido_team_confirmations')
            .select('team_a, team_b')
            .eq('partido_id', matchIdNum)
            .maybeSingle();
          if (!confirmationError && confirmationRow) {
            resolvedTeamA = toPlayerKeysFromRefs({
              refs: Array.isArray(confirmationRow.team_a) ? confirmationRow.team_a : [],
              refToKeyMap: playerRefToKey,
            });
            resolvedTeamB = toPlayerKeysFromRefs({
              refs: Array.isArray(confirmationRow.team_b) ? confirmationRow.team_b : [],
              refToKeyMap: playerRefToKey,
            });
          }
        } catch (_confirmationFetchError) {
          // Non-blocking fallback.
        }

        if (cancelled) return;

        const resolvedConfirmedTeams = resolvedTeamA.length > 0 && resolvedTeamB.length > 0;
        if (resolvedConfirmedTeams) {
          teamsConfirmedValue = true;
        }

        const lockedTeamA = toPlayerKeysFromRefs({
          refs: persistedSurveyTeamA,
          refToKeyMap: playerRefToKey,
        });
        const lockedTeamB = toPlayerKeysFromRefs({
          refs: persistedSurveyTeamB,
          refToKeyMap: playerRefToKey,
        });
        const resolvedLockedTeams = lockedTeamA.length > 0 && lockedTeamB.length > 0;
        const initialTeams = buildSeededInitialTeams({
          playerKeys: jugadoresPartido.map((player) => resolvePlayerKey(player)).filter(Boolean),
          seed: matchIdNum,
        });

        if (resolvedConfirmedTeams) {
          setTeamsConfirmed(true);
          setPartido({ ...partidoData, teams_confirmed: true });
          setConfirmedTeams({ teamA: resolvedTeamA, teamB: resolvedTeamB });
          setFinalTeams({ teamA: resolvedTeamA, teamB: resolvedTeamB });
          setTeamsSource('admin');
          setTeamsLocked(true);
          setTeamsLockedByUserId(null);
          setTeamsLockedAt(null);
        } else {
          setConfirmedTeams({ teamA: [], teamB: [] });

          // Safety fallback: if confirmed/locked teams can't be reconstructed, allow re-selection.
          const shouldAllowManualRecovery = (teamsConfirmedValue || teamsLockedValue) && !resolvedLockedTeams;
          if (teamsLockedValue && resolvedLockedTeams) {
            setTeamsConfirmed(false);
            setPartido({ ...partidoData, teams_confirmed: false });
            setFinalTeams({ teamA: lockedTeamA, teamB: lockedTeamB });
            setTeamsLocked(true);
            setTeamsSource(teamsSourceValue || 'survey');
            setTeamsLockedByUserId(teamsLockedByValue);
            setTeamsLockedAt(teamsLockedAtValue);
          } else if (shouldAllowManualRecovery) {
            setTeamsConfirmed(false);
            setPartido({ ...partidoData, teams_confirmed: false });
            setFinalTeams(initialTeams);
            setTeamsLocked(false);
            setTeamsSource('survey');
            setTeamsLockedByUserId(null);
            setTeamsLockedAt(null);
          } else {
            setTeamsConfirmed(false);
            setPartido({ ...partidoData, teams_confirmed: false });
            setFinalTeams(initialTeams);
            setTeamsLocked(false);
            setTeamsSource('survey');
            setTeamsLockedByUserId(null);
            setTeamsLockedAt(null);
          }
        }

      } catch (error) {
        if (!cancelled) {
          handleError(error, { showToast: true, onError: () => { } });
          navigate('/');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    resetSurveyState();
    if (id && user) {
      fetchPartidoData();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [id, user, navigate, clearInlineNotice]);

  // Mark survey related notifications as read when entering survey page
  useEffect(() => {
    const markNotificationRead = async () => {
      if (!id || !user?.id) return;
      try {
        const nowIso = new Date().toISOString();
        const partidoIdNum = Number(id);

        await Promise.all([
          supabase.from('notifications')
            .update({ read: true, read_at: nowIso })
            .eq('user_id', user.id)
            .in('type', ['survey_start', 'post_match_survey'])
            .eq('partido_id', partidoIdNum),

          supabase.from('notifications')
            .update({ read: true, read_at: nowIso })
            .eq('user_id', user.id)
            .in('type', ['survey_start', 'post_match_survey'])
            .contains('data', { match_id: String(id) }),
        ]);

        try {
          await fetchNotifications?.();
        } catch (_e) {
          // Intentionally ignored: notification refresh failure shouldn't block survey.
        }
      } catch (error) {
        console.error('[MARK_NOTIF_READ] Error:', error);
      }
    };

    markNotificationRead();
  }, [id, user?.id, fetchNotifications]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleJugadorAusente = (jugadorId) => {
    setFormData((prev) => {
      const ausentes = [...prev.jugadores_ausentes];
      const index = ausentes.indexOf(jugadorId);

      if (index === -1) {
        ausentes.push(jugadorId);
      } else {
        ausentes.splice(index, 1);
      }

      return { ...prev, jugadores_ausentes: ausentes };
    });
  };

  const toggleJugadorViolento = (jugadorId) => {
    setFormData((prev) => {
      const violentos = [...prev.jugadores_violentos];
      const index = violentos.indexOf(jugadorId);

      if (index === -1) {
        violentos.push(jugadorId);
      } else {
        violentos.splice(index, 1);
      }

      return { ...prev, jugadores_violentos: violentos };
    });
  };

  const playersByKey = useMemo(() => {
    const map = {};
    (jugadores || []).forEach((player) => {
      const key = resolvePlayerKey(player);
      if (!key) return;
      map[key] = player;
    });
    return map;
  }, [jugadores]);

  const allPlayerKeys = useMemo(() => (
    Object.keys(playersByKey)
  ), [playersByKey]);
  const playerRefToKeyMap = useMemo(() => buildPlayerRefToKeyMap(jugadores), [jugadores]);
  const compactFlowMode = loggedRosterCount > 0 && loggedRosterCount < 3;

  const hasConfirmedTeams = teamsConfirmed && confirmedTeams.teamA.length > 0 && confirmedTeams.teamB.length > 0;
  const teamsContextLabel = useMemo(() => {
    if (hasConfirmedTeams || teamsSource === 'admin') {
      return 'Equipos confirmados';
    }
    if (teamsLockedByUserId || teamsLockedAt || teamsLocked || teamsSource === 'survey') {
      return 'Equipos definidos por el primer votante';
    }
    return 'Equipos a definir en encuesta';
  }, [hasConfirmedTeams, teamsLocked, teamsLockedAt, teamsLockedByUserId, teamsSource]);

  const organizeTeamsHelperText = useMemo(() => {
    if (hasConfirmedTeams || teamsLocked || teamsSource === 'admin') {
      return 'Estos son los equipos registrados. Podés reordenarlos antes de confirmar el resultado.';
    }
    return 'Si los equipos no están correctos, reorganizalos con drag and drop antes de continuar.';
  }, [hasConfirmedTeams, teamsLocked, teamsSource]);

  const finalTeamsValidation = useMemo(() => {
    const teamA = Array.isArray(finalTeams?.teamA) ? finalTeams.teamA : [];
    const teamB = Array.isArray(finalTeams?.teamB) ? finalTeams.teamB : [];
    const expectedKeys = hasConfirmedTeams
      ? new Set([...(confirmedTeams.teamA || []), ...(confirmedTeams.teamB || [])])
      : new Set(allPlayerKeys);

    if (teamA.length === 0 || teamB.length === 0) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    const uniqueFinal = new Set([...teamA, ...teamB]);
    if (uniqueFinal.size !== teamA.length + teamB.length) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    if (expectedKeys.size > 0 && uniqueFinal.size !== expectedKeys.size) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    for (const key of uniqueFinal) {
      if (expectedKeys.size > 0 && !expectedKeys.has(key)) {
        return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
      }
    }

    return { ok: true, message: '' };
  }, [allPlayerKeys, confirmedTeams, finalTeams, hasConfirmedTeams]);

  const hydrateTeamsFromRefs = ({ teamARefs = [], teamBRefs = [] }) => {
    const teamA = toPlayerKeysFromRefs({ refs: teamARefs, refToKeyMap: playerRefToKeyMap });
    const teamB = toPlayerKeysFromRefs({ refs: teamBRefs, refToKeyMap: playerRefToKeyMap });
    if (teamA.length > 0 && teamB.length > 0) {
      setFinalTeams({ teamA, teamB });
      return true;
    }
    return false;
  };

  const persistSurveyTeamsDefinition = async () => {
    if (hasConfirmedTeams || teamsLocked) {
      return { ok: true, message: '' };
    }

    if (!finalTeamsValidation.ok) {
      return { ok: false, message: finalTeamsValidation.message };
    }

    const teamARefs = (finalTeams.teamA || [])
      .map((key) => resolvePersistRef(playersByKey[key]))
      .filter(Boolean);
    const teamBRefs = (finalTeams.teamB || [])
      .map((key) => resolvePersistRef(playersByKey[key]))
      .filter(Boolean);

    if (teamARefs.length === 0 || teamBRefs.length === 0) {
      return { ok: false, message: 'No se pudieron guardar los equipos finales. Intentá nuevamente.' };
    }

    let lockResult;
    try {
      lockResult = await lockSurveyTeamsOnce({
        matchId: Number(id),
        teamARefs,
        teamBRefs,
      });
    } catch (_rpcError) {
      return { ok: false, message: 'No se pudieron guardar los equipos finales. Intentá nuevamente.' };
    }

    if (!lockResult.ok) {
      return { ok: false, message: 'No se pudieron guardar los equipos finales. Intentá nuevamente.' };
    }

    setTeamsLocked(lockResult.teamsLocked || lockResult.alreadyLocked || lockResult.success);
    setTeamsSource(lockResult.teamsSource || 'survey');
    setTeamsLockedByUserId(lockResult.teamsLockedByUserId || null);
    setTeamsLockedAt(lockResult.teamsLockedAt || null);

    if (lockResult.teamARefs.length > 0 && lockResult.teamBRefs.length > 0) {
      hydrateTeamsFromRefs({
        teamARefs: lockResult.teamARefs,
        teamBRefs: lockResult.teamBRefs,
      });
    }

    return {
      ok: true,
      message: '',
      alreadyLocked: lockResult.alreadyLocked,
      lockedByOther: lockResult.lockedByOther,
    };
  };

  const resolveSurveyOutcome = () => {
    const winner = String(formData.ganador || '').trim();
    if (winner === 'equipo_a') {
      return { seJugo: true, ganador: 'A', resultado: 'finished' };
    }
    if (winner === 'equipo_b') {
      return { seJugo: true, ganador: 'B', resultado: 'finished' };
    }
    if (winner === 'empate') {
      return { seJugo: true, ganador: 'DRAW', resultado: 'draw' };
    }
    if (winner === 'no_jugado') {
      return { seJugo: false, ganador: 'NOT_PLAYED', resultado: 'not_played' };
    }
    if (formData.se_jugo === false) {
      return { seJugo: false, ganador: 'NOT_PLAYED', resultado: 'not_played' };
    }
    return { seJugo: true, ganador: null, resultado: 'pending' };
  };

  const continueSubmitFlow = async () => {
    try {
      if (alreadySubmitted) {
        console.info('Ya completaste esta encuesta');
        return;
      }

      const outcome = resolveSurveyOutcome();
      if (outcome.seJugo && !teamsConfirmed && !teamsLocked) {
        const persistResult = await persistSurveyTeamsDefinition();
        if (!persistResult.ok) {
          showInlineNotice({
            key: 'survey_final_teams_save_error',
            type: 'warning',
            message: persistResult.message,
          });
          return;
        }
        if (persistResult.alreadyLocked) {
          showInlineNotice({
            key: 'survey_teams_already_locked',
            type: 'success',
            message: 'Los equipos ya habían sido definidos por otro votante. Vamos a usar esa versión.',
          });
        }
      }

      const mvpPlayer = outcome.seJugo && formData.mvp_id
        ? jugadores.find((j) => j.uuid === formData.mvp_id)
        : null;
      const arqueroPlayer = outcome.seJugo && formData.arquero_id
        ? jugadores.find((j) => j.uuid === formData.arquero_id)
        : null;
      const linkedPlayerIdNum = Number(linkedPlayerId);
      const currentUserPlayer = (Number.isFinite(linkedPlayerIdNum)
        ? jugadores.find((j) => Number(j?.id) === linkedPlayerIdNum)
        : null) || jugadores.find((j) => j.usuario_id === user.id);
      const currentUserPlayerId = Number(currentUserPlayer?.id || linkedPlayerId);
      if (!Number.isFinite(currentUserPlayerId) || currentUserPlayerId <= 0) {
        showInlineNotice({
          key: 'survey_user_not_eligible',
          type: 'warning',
          message: 'Solo jugadores con cuenta registrada pueden completar esta encuesta.',
        });
        return;
      }

      const uuidToId = new Map(jugadores.map((j) => [j.uuid, j.id]));
      const violentosIds = (outcome.seJugo ? formData.jugadores_violentos : [])
        .map((u) => uuidToId.get(u))
        .filter(Boolean);
      const ausentesIds = (formData.jugadores_ausentes || [])
        .map((u) => uuidToId.get(u))
        .filter(Boolean);

      const surveyData = {
        partido_id: parseInt(id),
        votante_id: currentUserPlayerId,
        se_jugo: outcome.seJugo,
        motivo_no_jugado: outcome.seJugo ? null : (formData.motivo_no_jugado || null),
        asistieron_todos: formData.asistieron_todos,
        jugadores_ausentes: ausentesIds,
        partido_limpio: outcome.seJugo ? formData.partido_limpio : true,
        jugadores_violentos: violentosIds,
        mejor_jugador_eq_a: mvpPlayer?.id || null,
        mejor_jugador_eq_b: arqueroPlayer?.id || null, // Usamos este campo para el arquero
        ganador: outcome.ganador,
        resultado: outcome.resultado || null,
        created_at: new Date().toISOString(),
      };

      let { error: insertError } = await supabase
        .from('post_match_surveys')
        .insert([surveyData]);

      // Backward-compatible fallback if DB doesn't have the new columns yet.
      if (insertError && /ganador|resultado/i.test(insertError.message || '')) {
        const legacySurveyData = { ...surveyData };
        delete legacySurveyData.ganador;
        delete legacySurveyData.resultado;
        const legacyRes = await supabase.from('post_match_surveys').insert([legacySurveyData]);
        insertError = legacyRes.error || null;
      }

      if (insertError) {
        console.error('[ENCUESTA] post_match_surveys insert error full:', insertError);
        throw insertError;
      }

      try {
        await finalizeIfComplete(parseInt(id));
      } catch (e) {
        console.warn('[finalizeIfComplete] non-blocking error:', e);
      }

      // NEW: ensure match disappears from Próximos Partidos for this user
      try {
        await clearMatchFromList(user.id, parseInt(id));
      } catch (_e) {
        // non-blocking
      }

      setAlreadySubmitted(true);
      setEncuestaFinalizada(true);
      setCurrentStep(SURVEY_STEPS.DONE);

    } catch (error) {
      handleError(error, { showToast: true, onError: () => { } });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!user || !id) {
      notifyBlockingError('Debes iniciar sesión para calificar un partido');
      return;
    }

    if (alreadySubmitted) {
      console.info('Ya completaste esta encuesta');
      return;
    }

    if (currentStep === SURVEY_STEPS.RESULT && !formData.ganador) {
      showInlineNotice({
        key: 'survey_missing_winner',
        type: 'warning',
        message: 'Elegí el resultado: Equipo A, Equipo B, Empate o No jugado.',
      });
      return;
    }

    const needsValidTeamsForResult = currentStep === SURVEY_STEPS.RESULT
      && (formData.ganador === 'equipo_a' || formData.ganador === 'equipo_b');
    if (needsValidTeamsForResult && !finalTeamsValidation.ok) {
      showInlineNotice({
        key: 'survey_invalid_final_teams',
        type: 'warning',
        message: finalTeamsValidation.message,
      });
      return;
    }

    if (submitting || encuestaFinalizada) {
      return;
    }

    setSubmitting(true);
    await continueSubmitFlow();
  };

  const handleLockTeamsAndContinue = async () => {
    if (submitting || encuestaFinalizada || alreadySubmitted) return;

    if (teamsConfirmed || teamsLocked) {
      setCurrentStep(SURVEY_STEPS.RESULT);
      return;
    }

    setSubmitting(true);
    try {
      const persistResult = await persistSurveyTeamsDefinition();
      if (!persistResult.ok) {
        showInlineNotice({
          key: 'survey_final_teams_save_error',
          type: 'warning',
          message: persistResult.message,
        });
        return;
      }

      if (persistResult.alreadyLocked) {
        showInlineNotice({
          key: 'survey_teams_already_locked',
          type: 'success',
          message: 'Los equipos ya habían sido definidos por otro votante. Vamos a usar esa versión.',
        });
      } else {
        showInlineNotice({
          key: 'survey_teams_locked',
          type: 'success',
          message: 'Equipos guardados. Continuemos con el resultado final.',
        });
      }

      setCurrentStep(SURVEY_STEPS.RESULT);
    } finally {
      setSubmitting(false);
    }
  };

  const formatFecha = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      return fecha.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
  };

  // Helper classes for consistency
  const screenBackgroundStyle = {
    background:
      'radial-gradient(circle at 50% -12%, rgba(94,128,255,0.34) 0%, rgba(36,30,128,0) 46%), radial-gradient(circle at 50% 50%, rgba(60,112,255,0.2) 0%, rgba(11,14,54,0) 60%), linear-gradient(160deg, #1f1c77 0%, #241466 38%, #19134f 100%)',
  };
  const safeAreaStyle = {
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',
  };
  const cardClass = 'w-full max-w-[1180px] mx-auto h-[100dvh] px-2.5 sm:px-4 pb-5 sm:pb-6 flex flex-col overflow-visible';
  const stepClass = 'w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-2 sm:gap-3 pb-1.5 sm:pb-2';
  const playerStepClass = 'w-full flex-1 min-h-0 flex flex-col items-center justify-between gap-0 pb-1 sm:pb-1.5';
  const questionRowClass = 'w-full shrink-0 flex items-center justify-center pt-0';
  const progressRowClass = 'sticky top-0 z-40 w-full shrink-0 pt-1.5 sm:pt-2';
  const progressGapClass = 'w-full shrink-0 h-7 sm:h-8';
  const contentRowClass = 'w-full flex-1 min-h-0 flex items-center justify-center overflow-visible';
  const playerContentRowClass = 'w-full flex-1 min-h-0 flex items-center justify-center overflow-visible pt-5 sm:pt-6 pb-3 sm:pb-4';
  const actionRowClass = 'w-full shrink-0 flex items-center justify-center pt-3 sm:pt-4';
  const playerActionRowClass = 'w-full shrink-0 flex items-center justify-center pt-2.5 sm:pt-3.5';
  const logoRowClass = 'hidden';
  const titleClass = 'font-bebas text-[clamp(30px,6.2vw,74px)] text-white tracking-[0.055em] font-bold text-center leading-[0.92] uppercase drop-shadow-[0_8px_18px_rgba(6,9,36,0.42)] break-words w-full px-1';
  const surveyBtnBaseClass = 'w-full border border-white/35 bg-white/[0.10] text-white font-bebas text-[20px] sm:text-[24px] py-2.5 text-center cursor-pointer transition-[opacity,background-color,border-color] duration-220 ease-out hover:bg-white/[0.16] flex items-center justify-center min-h-[52px] rounded-[5px] tracking-[0.08em] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_12px_30px_rgba(10,10,45,0.28)] disabled:opacity-55 disabled:cursor-not-allowed';
  const btnClass = `${surveyBtnBaseClass} font-bold uppercase`;
  const optionBtnClass = `${surveyBtnBaseClass} uppercase`;
  const optionBtnSelectedClass = 'bg-white/[0.26] border-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_16px_30px_rgba(22,29,98,0.42)]';
  const compactPrimaryBtnClass = `${btnClass} !w-auto !min-w-[146px] sm:!min-w-[176px] !px-5 sm:!px-6`;
  const compactSecondaryBtnClass = `${optionBtnClass} !w-full !min-h-[50px] !py-2 !px-4 bg-white/[0.07] border-white/24 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_16px_rgba(7,10,35,0.22)]`;
  const compactButtonRowClass = 'w-full max-w-[760px] mx-auto flex items-center justify-center';
  const compactDualButtonRowClass = 'w-full max-w-[760px] mx-auto flex items-center justify-center gap-2.5 sm:gap-3';
  const gridClass = 'grid grid-cols-2 gap-3 w-full max-w-[920px] mx-auto';
  const textClass = 'text-white text-[18px] md:text-[20px] font-oswald text-center font-normal tracking-wide';
  const actionDockClass = 'w-full max-w-[980px] mx-auto flex flex-col gap-1';
  const centeredSummaryStackClass = 'w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-5 sm:gap-6';
  const centeredSummaryButtonWrapClass = 'w-full max-w-[460px] sm:max-w-[500px] mx-auto';
  const miniCardsStageClass = 'w-full h-full min-h-0 overflow-visible px-2 sm:px-3 pb-2 sm:pb-3 flex items-center justify-center';

  const SurveyFooterLogo = () => null;

  const flowSteps = useMemo(() => buildSurveyFlowSteps({
    currentStep,
    seJugo: formData.se_jugo,
    asistieronTodos: formData.asistieron_todos,
    partidoLimpio: formData.partido_limpio,
    teamsConfirmed,
    teamsLocked,
    compactFlowMode,
    forceOrganizeTeamsStep: compactFlowMode,
  }), [
    currentStep,
    formData.se_jugo,
    formData.asistieron_todos,
    formData.partido_limpio,
    teamsConfirmed,
    teamsLocked,
    compactFlowMode,
  ]);

  const progressTotalSteps = Math.max(flowSteps.length, 1);
  const currentFlowIndex = flowSteps.indexOf(currentStep);
  const progressCurrentStep = currentStep === SURVEY_STEPS.DONE
    ? progressTotalSteps
    : Math.max(currentFlowIndex + 1, 1);
  const progressFillScale = Math.min(Math.max(progressCurrentStep / progressTotalSteps, 0), 1);
  const progressFillPercent = Math.round(progressFillScale * 100);
  const [animatedProgressPercent, setAnimatedProgressPercent] = useState(progressFillPercent);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setAnimatedProgressPercent(progressFillPercent);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [progressFillPercent]);

  const renderStepProgress = () => (
    <div className={progressRowClass}>
      <div className="w-full">
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/18 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]">
          <div
            className="h-full origin-left rounded-full transition-[width] duration-[280ms] ease-out"
            style={{
              width: `${animatedProgressPercent}%`,
              background:
                'linear-gradient(90deg, rgba(93,236,255,0.82) 0%, rgba(123,180,255,0.82) 55%, rgba(132,242,255,0.84) 100%)',
              boxShadow: '0 0 6px rgba(111,227,255,0.22)',
            }}
          />
        </div>
      </div>
    </div>
  );

  const resolveAdaptiveGridConfig = (playerCount, ratio) => {
    const safeCount = Math.max(playerCount || 1, 1);
    const isWideViewport = ratio >= 0.95;
    let columns;
    let rows;

    if (safeCount <= 10) {
      columns = isWideViewport ? 4 : 3;
      rows = Math.ceil(safeCount / columns);
    } else if (safeCount <= 14) {
      columns = isWideViewport ? 5 : 4;
      rows = Math.max(3, Math.ceil(safeCount / columns));
    } else if (safeCount <= 22) {
      columns = isWideViewport ? 6 : 5;
      rows = Math.max(4, Math.ceil(safeCount / columns));
    } else {
      columns = isWideViewport ? 7 : 6;
      rows = Math.ceil(safeCount / columns);
    }

    while (rows * columns < safeCount) {
      rows += 1;
    }

    const gap = safeCount >= 22 ? 6 : safeCount >= 14 ? 8 : 9;
    const nameSizeClass = safeCount >= 22
      ? 'text-[9px] sm:text-[10px]'
      : safeCount >= 14
        ? 'text-[10px] sm:text-[11px]'
        : 'text-[11px] sm:text-[12px]';
    const silhouetteSizeClass = safeCount >= 22
      ? 'h-[42%] w-[42%]'
      : safeCount >= 14
        ? 'h-[48%] w-[48%]'
        : 'h-[54%] w-[54%]';
    const gridMaxWidth = safeCount <= 10
      ? (isWideViewport ? 980 : 760)
      : safeCount <= 14
        ? (isWideViewport ? 1060 : 840)
        : (isWideViewport ? 1160 : 920);

    return {
      rows,
      columns,
      gap,
      nameSizeClass,
      silhouetteSizeClass,
      gridMaxWidth,
    };
  };

  const PlayerPhotoFallback = ({ silhouetteSizeClass }) => (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#2f3978_0%,#253066_45%,#1a2148_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(196,209,247,0.24)_0%,rgba(37,44,90,0)_66%)]" />
      <svg
        viewBox="0 0 160 160"
        aria-hidden="true"
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[46%] text-white/34 ${silhouetteSizeClass}`}
      >
        <path
          fill="currentColor"
          d="M80 68c14 0 25-11 25-25S94 18 80 18 55 29 55 43s11 25 25 25Zm0 10c-24 0-44 14-50 36a8 8 0 0 0 8 10h84a8 8 0 0 0 8-10c-6-22-26-36-50-36Z"
        />
      </svg>
    </div>
  );

  const renderMiniPlayerCards = ({
    isSelected,
    onSelect,
  }) => {
    const playerCount = jugadores.length;
    const adaptiveGrid = resolveAdaptiveGridConfig(playerCount, viewportRatio);
    const hasSelection = jugadores.some((candidate) => isSelected(candidate.uuid));

    return (
      <div className={miniCardsStageClass}>
        <div
          className="mx-auto grid h-full w-full place-content-center overflow-visible"
          style={{
            gridTemplateColumns: `repeat(${adaptiveGrid.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${adaptiveGrid.rows}, minmax(0, 1fr))`,
            gap: `${adaptiveGrid.gap}px`,
            maxWidth: `${adaptiveGrid.gridMaxWidth}px`,
            maxHeight: '95%',
            minHeight: '64%',
            padding: '4px 3px',
          }}
        >
          {jugadores.map((jugador, index) => {
            const selected = isSelected(jugador.uuid);
            const hasPhoto = Boolean(jugador.avatar_url || jugador.foto_url);
            return (
              <button
                key={jugador.uuid}
                type="button"
                onClick={() => onSelect(jugador.uuid)}
                className={`group relative h-full min-h-0 min-w-0 transform-gpu overflow-visible rounded-[8px] border bg-[linear-gradient(168deg,rgba(58,84,196,0.28),rgba(16,20,73,0.9))] transition-[transform,opacity,filter] duration-[260ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 will-change-transform ${
                  selected
                    ? 'z-20 -translate-y-[2px] scale-[1.035]'
                    : 'z-10 translate-y-0 scale-100'
                } ${
                  hasSelection && !selected ? 'saturate-[0.74]' : ''
                }`}
                style={{
                  borderColor: selected ? 'rgba(229,243,255,0.82)' : 'rgba(255,255,255,0.24)',
                  opacity: hasSelection && !selected ? 0.45 : 1,
                  boxShadow: selected
                    ? '0 0 0 1px rgba(191,239,255,0.82), 0 0 20px rgba(92,236,255,0.28), 0 16px 26px rgba(7,10,35,0.48)'
                    : '0 10px 18px rgba(8,12,44,0.36)',
                }}
              >
                {selected ? (
                  <div className="pointer-events-none absolute -inset-1 rounded-[10px] bg-[radial-gradient(circle,rgba(121,241,255,0.48)_0%,rgba(121,241,255,0.16)_46%,rgba(121,241,255,0)_78%)] blur-[8px]" />
                ) : null}
                <div
                  className="relative flex h-full w-full flex-col overflow-hidden rounded-[8px]"
                  style={{
                    animation: 'cardIn 420ms cubic-bezier(0.22,1,0.36,1) both',
                    animationDelay: `${Math.min(index * 16, 160)}ms`,
                  }}
                >
                  <div className="relative h-[75%] w-full overflow-hidden bg-[#101544]">
                    {hasPhoto ? (
                      <img
                        src={jugador.avatar_url || jugador.foto_url}
                        alt={jugador.nombre}
                        className="h-full w-full object-contain object-center bg-[#0f1544]"
                        loading="lazy"
                      />
                    ) : (
                      <PlayerPhotoFallback
                        silhouetteSizeClass={adaptiveGrid.silhouetteSizeClass}
                      />
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-[#060a2d]/94 via-[#09113d]/55 to-transparent" />
                  </div>
                  <div className="relative flex h-[25%] w-full items-center justify-center px-1.5 bg-[linear-gradient(180deg,rgba(16,24,86,0.96)_0%,rgba(12,17,66,0.98)_100%)]">
                    <span
                      className={`w-full truncate text-center font-oswald font-semibold tracking-[0.035em] text-white ${adaptiveGrid.nameSizeClass}`}
                    >
                      {jugador.nombre}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Animation style
  const animationStyle = `
    @keyframes slideIn {
      from { transform: translateY(14px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes cardIn {
      from { transform: translateY(12px) scale(0.96); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
  `;

  if (loading) {
    return (
      <PageTransition>
        <div className="relative h-[100dvh] w-full overflow-visible">
          <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
          <div className="relative z-[1] h-full w-full overflow-visible" style={safeAreaStyle}>
            <div className={cardClass}>
              <div className="flex h-full flex-col items-center justify-center gap-5">
                <PageLoadingState
                  title="CARGANDO ENCUESTA"
                  description="Estamos preparando los datos del partido."
                />
                <SurveyFooterLogo />
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (yaCalificado || alreadySubmitted) {
    return (
      <PageTransition>
        <div className="relative h-[100dvh] w-full overflow-visible">
          <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
          <div className="relative z-[1] h-full w-full overflow-visible" style={safeAreaStyle}>
            <div className={cardClass}>
              <div className={`${centeredSummaryStackClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
                <div className="w-full">
                  <div className="font-bebas text-[30px] md:text-[44px] text-white tracking-[0.04em] font-bold text-center leading-[1.05] uppercase drop-shadow-md break-words w-full">
                    YA COMPLETASTE<br />LA ENCUESTA
                  </div>
                </div>
                <div className="text-white text-[18px] md:text-[22px] font-oswald text-center font-normal tracking-wide leading-[1.25]">
                  ¡Gracias por tu participación!
                </div>
                <div className={centeredSummaryButtonWrapClass}>
                  <button className={btnClass} onClick={() => navigate('/')}>
                    VOLVER AL INICIO
                  </button>
                </div>
                <div className={logoRowClass}>
                  <SurveyFooterLogo />
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="relative h-[100dvh] w-full overflow-visible">
        <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
        <div className="relative z-[1] h-full w-full overflow-visible" style={safeAreaStyle}>
          <style>{animationStyle}</style>
          <div className={cardClass}>
            {renderStepProgress()}
            <div className={progressGapClass} />
            <div className="w-full shrink-0 pt-0.5">
              <InlineNotice
                type={notice?.type}
                message={notice?.message}
                autoHideMs={notice?.type === 'warning' ? null : 3000}
                onClose={clearInlineNotice}
              />
            </div>
          {/* STEP 0: ¿SE JUGÓ? */}
          {currentStep === SURVEY_STEPS.PLAYED && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ¿SE JUGÓ EL PARTIDO?
                  </div>
                  <div className="text-white text-[17px] md:text-[20px] font-oswald text-center font-normal tracking-wide mt-2">
                    {formatFecha(partido.fecha)}<br />
                    {partido.hora && `${partido.hora} - `}{partido.sede ? partido.sede.split(/[,(]/)[0].trim() : 'Sin ubicación'}
                  </div>
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={`${optionBtnClass} ${formData.se_jugo ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('se_jugo', true);
                      if (formData.ganador === 'no_jugado') {
                        handleInputChange('ganador', '');
                      }
                      setCurrentStep(
                        compactFlowMode
                          ? resolveNextResultGateStep({
                            teamsConfirmed,
                            teamsLocked,
                            forceOrganizeTeamsStep: true,
                          })
                          : SURVEY_STEPS.ATTENDANCE,
                      );
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={`${optionBtnClass} ${!formData.se_jugo ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('se_jugo', false);
                      handleInputChange('ganador', 'no_jugado');
                      setCurrentStep(SURVEY_STEPS.NOT_PLAYED_REASON);
                    }}
                    type="button"
                  >
                    NO
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 1: ¿ASISTIERON TODOS? */}
          {currentStep === SURVEY_STEPS.ATTENDANCE && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿ASISTIERON TODOS?
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={optionBtnClass}
                    onClick={() => {
                      handleInputChange('asistieron_todos', true);
                      setCurrentStep(SURVEY_STEPS.MVP);
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={optionBtnClass}
                    onClick={() => {
                      handleInputChange('asistieron_todos', false);
                      setCurrentStep(SURVEY_STEPS.ABSENTS);
                    }}
                    type="button"
                  >
                    NO
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 2: MVP */}
          {currentStep === SURVEY_STEPS.MVP && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN FUE EL MEJOR JUGADOR?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.mvp_id === uuid,
                  onSelect: (uuid) => handleInputChange('mvp_id', uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactButtonRowClass}>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => setCurrentStep(SURVEY_STEPS.GOALKEEPER)}
                    disabled={!formData.mvp_id}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 3: ARQUERO */}
          {currentStep === SURVEY_STEPS.GOALKEEPER && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN FUE EL MEJOR ARQUERO?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.arquero_id === uuid,
                  onSelect: (uuid) => {
                    handleInputChange('arquero_id', uuid);
                    handleInputChange('sin_arquero_fijo', false);
                  },
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactDualButtonRowClass}>
                  <button
                    type="button"
                    className={`${compactPrimaryBtnClass} ${formData.sin_arquero_fijo && !formData.arquero_id ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('arquero_id', '');
                      handleInputChange('sin_arquero_fijo', true);
                      setCurrentStep(SURVEY_STEPS.CLEAN_MATCH);
                    }}
                  >
                    NO HUBO
                  </button>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => setCurrentStep(SURVEY_STEPS.CLEAN_MATCH)}
                    disabled={!formData.arquero_id && !formData.sin_arquero_fijo}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 4: ¿PARTIDO LIMPIO? */}
          {currentStep === SURVEY_STEPS.CLEAN_MATCH && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿FUE UN PARTIDO LIMPIO?
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={`${optionBtnClass} ${formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('partido_limpio', true);
                      setCurrentStep(resolveNextResultGateStep({
                        teamsConfirmed,
                        teamsLocked,
                        forceOrganizeTeamsStep: compactFlowMode,
                      }));
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={`${optionBtnClass} ${!formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('partido_limpio', false);
                      setCurrentStep(SURVEY_STEPS.DIRTY_PLAYERS);
                    }}
                    type="button"
                  >
                    NO
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 5: ¿QUIÉN GANÓ? */}
          {currentStep === SURVEY_STEPS.RESULT && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ¿QUIÉN GANÓ?
                  </div>
                  <div className="mt-2 text-center font-oswald text-[13px] leading-snug text-white/75 md:text-[14px]">
                    {teamsContextLabel}
                    {teamsSource === 'survey' ? ' · Primera respuesta define equipos.' : ''}
                  </div>
                </div>
              </div>
              <div className={`${contentRowClass} items-start`}>
                <div className="w-full max-w-[760px] mx-auto">
                  {finalTeams.teamA.length > 0 && finalTeams.teamB.length > 0 ? (
                    <div className="w-full space-y-3">
                      <TeamsDnDEditor
                        teamA={finalTeams.teamA}
                        teamB={finalTeams.teamB}
                        playersByKey={playersByKey}
                        disabled={true}
                        selectedWinner=""
                        onWinnerChange={() => {}}
                        onChange={() => {}}
                      />

                      {!finalTeamsValidation.ok ? (
                        <div className="rounded-[5px] border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-sm font-oswald text-rose-100">
                          Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[5px] border border-amber-300/35 bg-amber-400/10 p-4 text-center text-white/90">
                      <div className="font-oswald text-[16px] leading-snug">
                        No pudimos resolver los equipos para cerrar el partido.
                      </div>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-2.5">
                    <button
                      type="button"
                      className={`${optionBtnClass} ${formData.ganador === 'equipo_a' ? optionBtnSelectedClass : ''}`}
                      onClick={() => {
                        handleInputChange('ganador', 'equipo_a');
                        handleInputChange('se_jugo', true);
                        clearInlineNotice();
                      }}
                      disabled={!finalTeamsValidation.ok}
                    >
                      GANÓ EQUIPO A
                    </button>
                    <button
                      type="button"
                      className={`${optionBtnClass} ${formData.ganador === 'equipo_b' ? optionBtnSelectedClass : ''}`}
                      onClick={() => {
                        handleInputChange('ganador', 'equipo_b');
                        handleInputChange('se_jugo', true);
                        clearInlineNotice();
                      }}
                      disabled={!finalTeamsValidation.ok}
                    >
                      GANÓ EQUIPO B
                    </button>
                    <button
                      type="button"
                      className={`${optionBtnClass} ${formData.ganador === 'empate' ? optionBtnSelectedClass : ''}`}
                      onClick={() => {
                        handleInputChange('ganador', 'empate');
                        handleInputChange('se_jugo', true);
                        clearInlineNotice();
                      }}
                    >
                      EMPATE
                    </button>
                    <button
                      type="button"
                      className={`${optionBtnClass} ${formData.ganador === 'no_jugado' ? optionBtnSelectedClass : ''}`}
                      onClick={() => {
                        handleInputChange('ganador', 'no_jugado');
                        handleInputChange('se_jugo', false);
                        clearInlineNotice();
                      }}
                    >
                      NO JUGADO / CANCELADO
                    </button>
                  </div>
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={handleSubmit}
                    disabled={submitting || encuestaFinalizada || !formData.ganador}
                  >
                    FINALIZAR ENCUESTA
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 6: JUGADORES VIOLENTOS */}
          {currentStep === SURVEY_STEPS.DIRTY_PLAYERS && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN JUGÓ SUCIO?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_violentos.includes(uuid),
                  onSelect: (uuid) => toggleJugadorViolento(uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactButtonRowClass}>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => {
                      setCurrentStep(resolveNextResultGateStep({
                        teamsConfirmed,
                        teamsLocked,
                        forceOrganizeTeamsStep: compactFlowMode,
                      }));
                    }}
                    disabled={formData.jugadores_violentos.length === 0}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 7: ORGANIZAR EQUIPOS (solo si no estaban confirmados) */}
          {currentStep === SURVEY_STEPS.ORGANIZE_TEAMS && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ORGANIZÁ LOS EQUIPOS COMO SE JUGÓ
                  </div>
                  <div className="mt-2 text-center font-oswald text-[13px] leading-snug text-white/75 md:text-[14px]">
                    {organizeTeamsHelperText}
                  </div>
                </div>
              </div>
              <div className={`${contentRowClass} items-start`}>
                <div className="w-full max-w-[760px] mx-auto space-y-3">
                  <TeamsDnDEditor
                    teamA={finalTeams.teamA}
                    teamB={finalTeams.teamB}
                    playersByKey={playersByKey}
                    selectedWinner=""
                    onWinnerChange={() => {}}
                    onChange={(next) => {
                      setFinalTeams(next);
                      clearInlineNotice();
                    }}
                    disabled={teamsLocked && !compactFlowMode}
                  />

                  {!finalTeamsValidation.ok ? (
                    <div className="rounded-[5px] border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-sm font-oswald text-rose-100">
                      Los equipos deben quedar consistentes antes de continuar.
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="w-full shrink-0 flex items-center justify-center pt-1.5 sm:pt-2.5">
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={handleLockTeamsAndContinue}
                    disabled={submitting || encuestaFinalizada}
                  >
                    CONTINUAR
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 10: MOTIVO NO JUGADO */}
          {currentStep === SURVEY_STEPS.NOT_PLAYED_REASON && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿POR QUÉ NO SE JUGÓ?
                </div>
              </div>
              <div className={contentRowClass}>
                <div className="w-full max-w-[560px] mx-auto">
                  <textarea
                    className="w-full h-24 sm:h-28 p-4 text-left font-oswald text-[18px] sm:text-[20px] bg-white/90 border-[1.5px] border-[#eceaf1] rounded-xl text-[#333] outline-none transition-all placeholder:text-gray-500 focus:bg-white focus:border-[#0EA9C6] resize-none"
                    value={formData.motivo_no_jugado || ''}
                    onChange={(e) => handleInputChange('motivo_no_jugado', e.target.value)}
                    placeholder="Explica por qué no se pudo jugar..."
                  />
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={() => setCurrentStep(SURVEY_STEPS.NOT_PLAYED_ABSENTS)}
                  >
                    AUSENCIA SIN AVISO
                  </button>
                  <button
                    className={btnClass}
                    onClick={() => {
                      if (submitting || encuestaFinalizada) return;
                      setSubmitting(true);
                      continueSubmitFlow();
                    }}
                  >
                    FINALIZAR
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 11: AUSENTES SIN AVISO (PARTIDO NO JUGADO) */}
          {currentStep === SURVEY_STEPS.NOT_PLAYED_ABSENTS && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉNES FALTARON?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={handleSubmit}
                    disabled={formData.jugadores_ausentes.length === 0}
                  >
                    FINALIZAR
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 12: AUSENTES (PARTIDO JUGADO) */}
          {currentStep === SURVEY_STEPS.ABSENTS && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉNES FALTARON?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactButtonRowClass}>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => setCurrentStep(SURVEY_STEPS.MVP)}
                    disabled={formData.jugadores_ausentes.length === 0}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 99: FINAL */}
          {currentStep === SURVEY_STEPS.DONE && (
            <div className={`${centeredSummaryStackClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className="w-full">
                <div className={titleClass}>
                  ¡GRACIAS POR CALIFICAR!
                </div>
              </div>
              <div className={`${textClass} text-[26px] !mb-0`}>
                Los resultados se publicarán en ~{SURVEY_WINDOW_HOURS} horas.
              </div>
              <div className={centeredSummaryButtonWrapClass}>
                <button
                  className={btnClass}
                  onClick={() => navigate('/proximos?surveyDone=1')}
                >
                  VOLVER AL INICIO
                </button>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </PageTransition>
  );
};

export default EncuestaPartido;
