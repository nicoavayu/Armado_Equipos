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
import Logo from '../Logo.png';
import { notifyBlockingError } from 'utils/notifyBlockingError';

// Styles are now directly in Tailwind
// import './LegacyVoting.css'; // Removed

const Utils_formatTime = (iso) => {
  if (!iso) return '??';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  const [currentStep, setCurrentStep] = useState(0);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  const [formData, setFormData] = useState({
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
  });
  const [jugadores, setJugadores] = useState([]);
  const [yaCalificado, _setYaCalificado] = useState(false);
  const [encuestaFinalizada, setEncuestaFinalizada] = useState(false);
  const { notice, showInlineNotice, clearInlineNotice } = useInlineNotice();

  useEffect(() => {
    const fetchPartidoData = async () => {
      try {
        if (!id || !user) {
          navigate('/');
          return;
        }

        setLoading(true);

        // Check if user already submitted survey
        const currentUserPlayer = await supabase
          .from('jugadores')
          .select('id')
          .eq('partido_id', id)
          .eq('usuario_id', user.id)
          .single();

        if (currentUserPlayer.data?.id) {
          const { data: existingSurvey } = await supabase
            .from('post_match_surveys')
            .select('id')
            .eq('partido_id', parseInt(id))
            .eq('votante_id', currentUserPlayer.data.id)
            .single();

          if (existingSurvey) {
            setAlreadySubmitted(true);
          }
        }

        const { data: partidoData, error: partidoError } = await supabase
          .from('partidos_view')
          .select('*')
          .eq('id', id)
          .single();

        if (partidoError) throw partidoError;
        if (!partidoData) {
          throw new AppError('Partido no encontrado', ERROR_CODES.NOT_FOUND);
        }

        // teams_confirmed may come from partidos_view or public.partidos depending on environment
        let teamsConfirmedValue = Boolean(partidoData?.teams_confirmed);
        try {
          const { data: pRow, error: pErr } = await supabase
            .from('partidos')
            .select('teams_confirmed')
            .eq('id', Number(id))
            .maybeSingle();
          if (!pErr && pRow && typeof pRow.teams_confirmed === 'boolean') {
            teamsConfirmedValue = pRow.teams_confirmed;
          }
        } catch (_e) {
          // non-blocking
        }

        setTeamsConfirmed(teamsConfirmedValue);
        setPartido({ ...partidoData, teams_confirmed: teamsConfirmedValue });

        const jugadoresPartido = partidoData.jugadores && Array.isArray(partidoData.jugadores)
          ? partidoData.jugadores
          : [];
        setJugadores(jugadoresPartido);

        let resolvedTeamA = [];
        let resolvedTeamB = [];

        if (teamsConfirmedValue) {
          try {
            const normalizeRef = (value) => String(value || '').trim().toLowerCase();
            const { data: confirmationRow, error: confirmationError } = await supabase
              .from('partido_team_confirmations')
              .select('team_a, team_b')
              .eq('partido_id', Number(id))
              .maybeSingle();
            if (!confirmationError && confirmationRow) {
              const toKeyMap = new Map();
              jugadoresPartido.forEach((player) => {
                const key = String(player.uuid || player.usuario_id || player.id || '').trim();
                if (!key) return;
                [player.uuid, player.usuario_id, player.id, key]
                  .map((ref) => normalizeRef(ref))
                  .filter(Boolean)
                  .forEach((ref) => toKeyMap.set(ref, key));
              });

              resolvedTeamA = (Array.isArray(confirmationRow.team_a) ? confirmationRow.team_a : [])
                .map((ref) => toKeyMap.get(normalizeRef(ref)))
                .filter(Boolean);
              resolvedTeamB = (Array.isArray(confirmationRow.team_b) ? confirmationRow.team_b : [])
                .map((ref) => toKeyMap.get(normalizeRef(ref)))
                .filter(Boolean);
            }
          } catch (_confirmationFetchError) {
            // Non-blocking fallback.
          }
        }

        if (resolvedTeamA.length > 0 && resolvedTeamB.length > 0) {
          setConfirmedTeams({ teamA: resolvedTeamA, teamB: resolvedTeamB });
          setFinalTeams({ teamA: resolvedTeamA, teamB: resolvedTeamB });
        } else {
          setConfirmedTeams({ teamA: [], teamB: [] });
          setFinalTeams({ teamA: [], teamB: [] });
        }

      } catch (error) {
        handleError(error, { showToast: true, onError: () => { } });
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    if (id && user) {
      fetchPartidoData();
    }
  }, [id, user, navigate]);

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

  const resolvePlayerKey = (player) => {
    if (!player) return null;
    return String(player.uuid || player.usuario_id || player.id || '').trim() || null;
  };
  const resolvePersistRef = (player) => (
    String(player?.uuid || player?.usuario_id || player?.id || '').trim() || null
  );

  const playersByKey = useMemo(() => {
    const map = {};
    (jugadores || []).forEach((player) => {
      const key = resolvePlayerKey(player);
      if (!key) return;
      map[key] = player;
    });
    return map;
  }, [jugadores]);

  const hasConfirmedTeams = teamsConfirmed && confirmedTeams.teamA.length > 0 && confirmedTeams.teamB.length > 0;

  const finalTeamsValidation = useMemo(() => {
    if (!hasConfirmedTeams) return { ok: false, message: 'Para registrar resultado, primero deben estar confirmados los equipos.' };

    const teamA = Array.isArray(finalTeams?.teamA) ? finalTeams.teamA : [];
    const teamB = Array.isArray(finalTeams?.teamB) ? finalTeams.teamB : [];

    if (teamA.length === 0 || teamB.length === 0) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    const uniqueFinal = new Set([...teamA, ...teamB]);
    if (uniqueFinal.size !== teamA.length + teamB.length) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    const confirmedSet = new Set([...(confirmedTeams.teamA || []), ...(confirmedTeams.teamB || [])]);
    if (uniqueFinal.size !== confirmedSet.size) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    for (const key of uniqueFinal) {
      if (!confirmedSet.has(key)) {
        return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
      }
    }

    return { ok: true, message: '' };
  }, [finalTeams, confirmedTeams, hasConfirmedTeams]);

  const persistFinalTeams = async () => {
    if (!hasConfirmedTeams) {
      return { ok: false, message: 'Para registrar resultado, primero deben estar confirmados los equipos.' };
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

    const { data: rpcData, error: rpcError } = await supabase.rpc('save_match_final_teams', {
      p_partido_id: Number(id),
      p_final_team_a: teamARefs,
      p_final_team_b: teamBRefs,
    });

    if (rpcError) {
      return { ok: false, message: 'No se pudieron guardar los equipos finales. Intentá nuevamente.' };
    }
    if (rpcData?.success === false) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    return { ok: true, message: '' };
  };

  const continueSubmitFlow = async () => {
    try {
      if (alreadySubmitted) {
        console.info('Ya completaste esta encuesta');
        return;
      }

      if (formData.se_jugo) {
        const persistResult = await persistFinalTeams();
        if (!persistResult.ok) {
          showInlineNotice({
            key: 'survey_final_teams_save_error',
            type: 'warning',
            message: `${persistResult.message} Vamos a guardar la encuesta igual.`,
          });
        }
      }

      const mvpPlayer = formData.mvp_id ? jugadores.find((j) => j.uuid === formData.mvp_id) : null;
      const arqueroPlayer = formData.arquero_id ? jugadores.find((j) => j.uuid === formData.arquero_id) : null;
      const currentUserPlayer = jugadores.find((j) => j.usuario_id === user.id);

      const uuidToId = new Map(jugadores.map((j) => [j.uuid, j.id]));
      const violentosIds = (formData.jugadores_violentos || [])
        .map((u) => uuidToId.get(u))
        .filter(Boolean);
      const ausentesIds = (formData.jugadores_ausentes || [])
        .map((u) => uuidToId.get(u))
        .filter(Boolean);

      const surveyData = {
        partido_id: parseInt(id),
        votante_id: currentUserPlayer?.id || null,
        se_jugo: formData.se_jugo,
        motivo_no_jugado: formData.motivo_no_jugado || null,
        asistieron_todos: formData.asistieron_todos,
        jugadores_ausentes: ausentesIds,
        partido_limpio: formData.partido_limpio,
        jugadores_violentos: violentosIds,
        mejor_jugador_eq_a: mvpPlayer?.id || null,
        mejor_jugador_eq_b: arqueroPlayer?.id || null, // Usamos este campo para el arquero
        ganador: formData.ganador || null,
        resultado: formData.resultado || null,
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
      setCurrentStep(99);

    } catch (error) {
      handleError(error, { showToast: true, onError: () => { } });
    } finally {
      setSubmitting(false);
    }
  };

  const submitSurveyFromCurrentStep = async () => {
    if (submitting || encuestaFinalizada || alreadySubmitted) return;
    setSubmitting(true);
    await continueSubmitFlow();
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

    if (currentStep === 5 && !formData.ganador) {
      showInlineNotice({
        key: 'survey_missing_winner',
        type: 'warning',
        message: 'Elegí el resultado: Equipo A, Equipo B o Empate.',
      });
      return;
    }

    if (currentStep === 5 && !hasConfirmedTeams) {
      showInlineNotice({
        key: 'survey_missing_confirmed_teams',
        type: 'warning',
        message: 'Para registrar resultado, primero deben estar confirmados los equipos',
      });
      return;
    }

    if (currentStep === 5 && !finalTeamsValidation.ok) {
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
  const screenStyle = {
    background:
      'radial-gradient(circle at 50% -12%, rgba(94,128,255,0.34) 0%, rgba(36,30,128,0) 46%), radial-gradient(circle at 50% 50%, rgba(60,112,255,0.2) 0%, rgba(11,14,54,0) 60%), linear-gradient(160deg, #1f1c77 0%, #241466 38%, #19134f 100%)',
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',
  };
  const cardClass = 'w-full max-w-[1100px] mx-auto h-[100dvh] px-3 sm:px-4 flex flex-col overflow-hidden';
  const stepClass = 'w-full flex-1 min-h-0 flex flex-col items-center justify-between gap-2 sm:gap-3 pb-2';
  const questionRowClass = 'w-full shrink-0 flex items-center justify-center';
  const progressRowClass = 'w-full shrink-0 flex items-center justify-center';
  const contentRowClass = 'w-full flex-1 min-h-0 flex items-center justify-center overflow-hidden';
  const actionRowClass = 'w-full shrink-0 flex items-center justify-center';
  const logoRowClass = 'w-full shrink-0 flex justify-center pt-2 pb-1';
  const titleClass = 'font-bebas text-[clamp(34px,6.8vw,84px)] text-white tracking-[0.06em] font-bold text-center leading-[0.96] uppercase drop-shadow-[0_8px_20px_rgba(6,9,36,0.46)] break-words w-full px-1';
  const surveyBtnBaseClass = 'w-full border border-white/35 bg-white/[0.10] text-white font-bebas text-[22px] sm:text-[28px] py-3 text-center cursor-pointer transition-[transform,opacity,background-color] duration-300 hover:bg-white/[0.16] active:scale-[0.985] flex items-center justify-center min-h-[62px] rounded-[21px] tracking-[0.08em] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_12px_30px_rgba(10,10,45,0.28)] disabled:opacity-55 disabled:cursor-not-allowed';
  const btnClass = `${surveyBtnBaseClass} font-bold uppercase`;
  const optionBtnClass = `${surveyBtnBaseClass} uppercase`;
  const optionBtnSelectedClass = 'bg-white/[0.26] border-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_16px_30px_rgba(22,29,98,0.42)]';
  const gridClass = 'grid grid-cols-2 gap-3 w-full max-w-[920px] mx-auto';
  const textClass = 'text-white text-[18px] md:text-[20px] font-oswald text-center font-normal tracking-wide';
  const actionDockClass = 'w-full max-w-[920px] mx-auto flex flex-col gap-2';
  const miniCardsStageClass = 'w-full h-full min-h-0 overflow-hidden px-0.5';

  const SurveyFooterLogo = () => (
    <div className="opacity-65 pointer-events-none">
      <img
        src={Logo}
        alt="Logo Arma2"
        className="w-[72px] h-auto drop-shadow-[0_0_10px_rgba(22,19,84,0.6)]"
      />
    </div>
  );

  const resolveVariantAccent = (variant) => {
    switch (variant) {
      case 'mvp':
        return '#47f8b5';
      case 'gk':
        return '#ffe07a';
      case 'danger':
        return '#ff86a1';
      default:
        return '#66e7ff';
    }
  };

  const flowSteps = useMemo(() => {
    const resolvedSteps = [0];

    if (currentStep === 10 || currentStep === 11 || formData.se_jugo === false) {
      resolvedSteps.push(10);
      if (currentStep === 11) {
        resolvedSteps.push(11);
      }
      return resolvedSteps;
    }

    resolvedSteps.push(1);

    if (currentStep === 12 || formData.asistieron_todos === false) {
      resolvedSteps.push(12);
    }

    resolvedSteps.push(2, 3, 4);

    if (currentStep === 6 || formData.partido_limpio === false) {
      resolvedSteps.push(6);
    }

    if (hasConfirmedTeams) {
      resolvedSteps.push(5);
    }

    return resolvedSteps;
  }, [
    currentStep,
    formData.se_jugo,
    formData.asistieron_todos,
    formData.partido_limpio,
    hasConfirmedTeams,
  ]);

  const progressTotalSteps = Math.max(flowSteps.length, 1);
  const currentFlowIndex = flowSteps.indexOf(currentStep);
  const progressCurrentStep = currentStep === 99
    ? progressTotalSteps
    : Math.max(currentFlowIndex + 1, 1);
  const progressRatio = Math.min(progressCurrentStep / progressTotalSteps, 1);

  const renderStepProgress = () => (
    <div className={progressRowClass}>
      <div className="w-full max-w-[920px] px-0.5">
        <div className="text-center font-oswald text-[clamp(22px,4.6vw,38px)] leading-none tracking-wide text-white/95">
          Paso {progressCurrentStep} de {progressTotalSteps}
        </div>
        <div className="mt-2 h-[10px] w-full rounded-full border border-[#7d7df3]/55 bg-[#2a2778]/75 p-[2px] shadow-[inset_0_2px_5px_rgba(8,8,30,0.45)]">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#53f3cb_0%,#b8ffb6_65%,#cbffec_100%)] transition-[width,opacity,transform] duration-500 ease-out shadow-[0_0_14px_rgba(92,246,212,0.68)]"
            style={{ width: `${Math.max(progressRatio * 100, 10)}%` }}
          />
        </div>
      </div>
    </div>
  );

  const resolveAdaptiveGridConfig = (playerCount) => {
    const safeCount = Math.max(playerCount || 1, 1);
    const rows = safeCount <= 14 ? 2 : safeCount <= 18 ? 3 : 4;
    const columns = Math.max(Math.ceil(safeCount / rows), 2);
    const gap = safeCount >= 22 ? 4 : safeCount >= 14 ? 6 : 8;
    const nameSizeClass = safeCount >= 22
      ? 'text-[9px] sm:text-[10px]'
      : safeCount >= 14
        ? 'text-[10px] sm:text-[11px]'
        : 'text-[12px] sm:text-[14px]';
    const initialSizeClass = safeCount >= 22
      ? 'text-[18px] sm:text-[22px]'
      : safeCount >= 14
        ? 'text-[21px] sm:text-[25px]'
        : 'text-[28px] sm:text-[34px]';

    return {
      rows,
      columns,
      gap,
      nameSizeClass,
      initialSizeClass,
    };
  };

  const PlayerPhotoFallback = ({ name, initialSizeClass }) => (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_45%_15%,rgba(166,198,255,0.38)_0%,rgba(64,82,185,0.34)_42%,rgba(20,24,74,0.95)_100%)]">
      <div className="absolute inset-0 bg-[linear-gradient(150deg,rgba(74,113,221,0.26),rgba(14,19,58,0.68))]" />
      <svg
        viewBox="0 0 160 160"
        aria-hidden="true"
        className="absolute left-1/2 top-[51%] h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 text-white/34"
      >
        <path
          fill="currentColor"
          d="M80 68c14 0 25-11 25-25S94 18 80 18 55 29 55 43s11 25 25 25Zm0 10c-24 0-44 14-50 36a8 8 0 0 0 8 10h84a8 8 0 0 0 8-10c-6-22-26-36-50-36Z"
        />
      </svg>
      <span className={`absolute left-1/2 top-[53%] -translate-x-1/2 -translate-y-1/2 font-bebas tracking-[0.08em] text-white/46 ${initialSizeClass}`}>
        {(name || '?').charAt(0).toUpperCase()}
      </span>
    </div>
  );

  const renderMiniPlayerCards = ({
    isSelected,
    onSelect,
    variant = 'mvp',
  }) => {
    const playerCount = jugadores.length;
    const adaptiveGrid = resolveAdaptiveGridConfig(playerCount);
    const hasSelection = jugadores.some((candidate) => isSelected(candidate.uuid));
    const accentColor = resolveVariantAccent(variant);

    return (
      <div className={miniCardsStageClass}>
        <div
          className="mx-auto grid h-full w-full max-w-[980px] content-center"
          style={{
            gridTemplateColumns: `repeat(${adaptiveGrid.columns}, minmax(0, 1fr))`,
            gap: `${adaptiveGrid.gap}px`,
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
                className={`group relative min-w-0 overflow-hidden rounded-[14px] border border-white/35 bg-[linear-gradient(170deg,rgba(58,87,215,0.24),rgba(18,19,70,0.74))] shadow-[0_10px_22px_rgba(11,13,50,0.42)] transition-[transform,opacity] duration-220 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                  selected ? 'z-20 scale-[1.055] opacity-100' : 'z-10 scale-100'
                } ${
                  hasSelection && !selected ? 'opacity-[0.7]' : 'opacity-100'
                }`}
                style={{
                  animation: 'cardIn 420ms cubic-bezier(0.22,1,0.36,1) both',
                  animationDelay: `${index * 18}ms`,
                }}
              >
                <div
                  className={`pointer-events-none absolute inset-0 rounded-[14px] transition-opacity duration-220 ${
                    selected ? 'opacity-95' : hasSelection ? 'opacity-30' : 'opacity-55'
                  }`}
                  style={{
                    background:
                      'radial-gradient(130% 90% at 50% 0%, rgba(108,245,255,0.64) 0%, rgba(90,130,255,0.18) 45%, rgba(6,9,42,0) 72%)',
                  }}
                />
                <div className="relative flex aspect-[1.12/1] w-full flex-col overflow-hidden rounded-[14px]">
                  <div className="relative h-[72%] w-full overflow-hidden bg-[#101544]">
                    {hasPhoto ? (
                      <img
                        src={jugador.avatar_url || jugador.foto_url}
                        alt={jugador.nombre}
                        className="h-full w-full object-cover object-center"
                        loading="lazy"
                      />
                    ) : (
                      <PlayerPhotoFallback
                        name={jugador.nombre}
                        initialSizeClass={adaptiveGrid.initialSizeClass}
                      />
                    )}
                  </div>
                  <div className="relative flex h-[28%] w-full items-center justify-center px-1.5 bg-[linear-gradient(180deg,rgba(23,29,95,0.86)_0%,rgba(18,19,74,0.96)_100%)]">
                    <span
                      className={`w-full truncate text-center font-oswald font-semibold tracking-[0.03em] text-white ${adaptiveGrid.nameSizeClass}`}
                    >
                      {jugador.nombre}
                    </span>
                  </div>
                </div>
                <div
                  className={`pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/85 bg-black/25 text-[12px] text-white transition-[transform,opacity] duration-220 ${
                    selected ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
                  }`}
                  style={{ boxShadow: `0 0 0 1px ${accentColor} inset, 0 0 10px ${accentColor}` }}
                >
                  ✓
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
    @keyframes ctaReady {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.012); opacity: 0.96; }
    }
  `;

  if (loading) {
    return (
      <PageTransition>
        <div className="h-[100dvh] w-full overflow-hidden" style={screenStyle}>
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
      </PageTransition>
    );
  }

  if (yaCalificado || alreadySubmitted) {
    return (
      <PageTransition>
        <div className="h-[100dvh] w-full overflow-hidden" style={screenStyle}>
          <div className={cardClass}>
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="font-bebas text-[30px] md:text-[44px] text-white tracking-[0.04em] font-bold text-center leading-[1.05] uppercase drop-shadow-md break-words w-full">
                  YA COMPLETASTE<br />LA ENCUESTA
                </div>
              </div>
              <div className={contentRowClass}>
                <div className="text-white text-[18px] md:text-[22px] font-oswald text-center font-normal tracking-wide leading-[1.25]">
                  ¡Gracias por tu participación!
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button className={btnClass} onClick={() => navigate('/')}>
                    VOLVER AL INICIO
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="h-[100dvh] w-full overflow-hidden" style={screenStyle}>
        <style>{animationStyle}</style>
        <div className={cardClass}>
          <div className="w-full min-h-[42px] shrink-0 pt-1.5">
            <InlineNotice
              type={notice?.type}
              message={notice?.message}
              autoHideMs={notice?.type === 'warning' ? null : 3000}
              onClose={clearInlineNotice}
            />
          </div>
          {/* STEP 0: ¿SE JUGÓ? */}
          {currentStep === 0 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ¿SE JUGÓ EL PARTIDO?
                  </div>
                  <div className="text-white text-[17px] md:text-[20px] font-oswald text-center font-normal tracking-wide mt-3">
                    {formatFecha(partido.fecha)}<br />
                    {partido.hora && `${partido.hora} - `}{partido.sede ? partido.sede.split(/[,(]/)[0].trim() : 'Sin ubicación'}
                  </div>
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass} />
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={`${optionBtnClass} ${formData.se_jugo ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('se_jugo', true);
                      setCurrentStep(1);
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={`${optionBtnClass} ${!formData.se_jugo ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('se_jugo', false);
                      setCurrentStep(10);
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
          {currentStep === 1 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿ASISTIERON TODOS?
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass} />
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={optionBtnClass}
                    onClick={() => {
                      handleInputChange('asistieron_todos', true);
                      setCurrentStep(2);
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={optionBtnClass}
                    onClick={() => {
                      handleInputChange('asistieron_todos', false);
                      setCurrentStep(12);
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
          {currentStep === 2 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN FUE EL MEJOR JUGADOR?
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.mvp_id === uuid,
                  onSelect: (uuid) => handleInputChange('mvp_id', uuid),
                  variant: 'mvp',
                })}
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={`${btnClass} ${formData.mvp_id ? 'animate-[ctaReady_2.2s_ease-in-out_infinite]' : ''}`}
                    onClick={() => setCurrentStep(3)}
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
          {currentStep === 3 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN FUE EL MEJOR ARQUERO?
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.arquero_id === uuid,
                  onSelect: (uuid) => {
                    handleInputChange('arquero_id', uuid);
                    handleInputChange('sin_arquero_fijo', false);
                  },
                  variant: 'gk',
                })}
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    type="button"
                    className={`${optionBtnClass} ${formData.sin_arquero_fijo && !formData.arquero_id ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('arquero_id', '');
                      handleInputChange('sin_arquero_fijo', true);
                      setCurrentStep(4);
                    }}
                  >
                    NO HUBO ARQUEROS FIJOS
                  </button>
                  <button
                    className={`${btnClass} ${formData.arquero_id || formData.sin_arquero_fijo ? 'animate-[ctaReady_2.2s_ease-in-out_infinite]' : ''}`}
                    onClick={() => setCurrentStep(4)}
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
          {currentStep === 4 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿FUE UN PARTIDO LIMPIO?
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass} />
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={`${optionBtnClass} ${formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                    onClick={async () => {
                      handleInputChange('partido_limpio', true);
                      if (!hasConfirmedTeams) {
                        await submitSurveyFromCurrentStep();
                        return;
                      }
                      setCurrentStep(5);
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={`${optionBtnClass} ${!formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('partido_limpio', false);
                      setCurrentStep(6);
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
          {currentStep === 5 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ¿QUIÉN GANÓ?
                  </div>
                  <div className="mt-2 text-center font-oswald text-[13px] leading-snug text-white/75 md:text-[14px]">
                    Si hubo algún cambio de último momento en la cancha, podés ajustar los equipos acá.
                  </div>
                </div>
              </div>
              {renderStepProgress()}
              <div className={`${contentRowClass} items-start`}>
                <div className="w-full max-w-[760px] mx-auto">
                  {hasConfirmedTeams ? (
                    <div className="w-full space-y-3">
                      <TeamsDnDEditor
                        teamA={finalTeams.teamA}
                        teamB={finalTeams.teamB}
                        playersByKey={playersByKey}
                        selectedWinner={formData.ganador}
                        onWinnerChange={(winner) => {
                          handleInputChange('ganador', winner);
                          clearInlineNotice();
                        }}
                        onChange={(next) => {
                          setFinalTeams(next);
                          clearInlineNotice();
                        }}
                      />

                      {!finalTeamsValidation.ok ? (
                        <div className="rounded-xl border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-sm font-oswald text-rose-100">
                          Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.
                        </div>
                      ) : null}

                      <button
                        type="button"
                        className={`${optionBtnClass} normal-case ${formData.ganador === 'empate' ? optionBtnSelectedClass : ''}`}
                        onClick={() => {
                          handleInputChange('ganador', 'empate');
                          clearInlineNotice();
                        }}
                      >
                        Empate
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-amber-300/35 bg-amber-400/10 p-4 text-center text-white/90">
                      <div className="font-oswald text-[16px] leading-snug">
                        Para registrar resultado, primero deben estar confirmados los equipos
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={handleSubmit}
                    disabled={submitting || encuestaFinalizada}
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
          {currentStep === 6 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN JUGÓ SUCIO?
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_violentos.includes(uuid),
                  onSelect: (uuid) => toggleJugadorViolento(uuid),
                  variant: 'danger',
                })}
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={`${btnClass} ${formData.jugadores_violentos.length > 0 ? 'animate-[ctaReady_2.2s_ease-in-out_infinite]' : ''}`}
                    onClick={async () => {
                      if (!hasConfirmedTeams) {
                        await submitSurveyFromCurrentStep();
                        return;
                      }
                      setCurrentStep(5);
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

          {/* STEP 10: MOTIVO NO JUGADO */}
          {currentStep === 10 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿POR QUÉ NO SE JUGÓ?
                </div>
              </div>
              {renderStepProgress()}
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
                    onClick={() => setCurrentStep(11)}
                  >
                    AUSENCIA SIN AVISO
                  </button>
                  <button
                    className={btnClass}
                    onClick={continueSubmitFlow}
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
          {currentStep === 11 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉNES FALTARON?
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                  variant: 'danger',
                })}
              </div>
              <div className={actionRowClass}>
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
          {currentStep === 12 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉNES FALTARON?
                </div>
              </div>
              {renderStepProgress()}
              <div className={contentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                  variant: 'danger',
                })}
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={`${btnClass} ${formData.jugadores_ausentes.length > 0 ? 'animate-[ctaReady_2.2s_ease-in-out_infinite]' : ''}`}
                    onClick={() => setCurrentStep(2)}
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
          {currentStep === 99 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¡GRACIAS POR CALIFICAR!
                </div>
              </div>
              <div className={contentRowClass}>
                <div className={`${textClass} text-[26px] !mb-0`}>
                  Los resultados se publicarán en ~6 horas.
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={() => navigate('/proximos?surveyDone=1')}
                  >
                    VOLVER AL INICIO
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
};

export default EncuestaPartido;
