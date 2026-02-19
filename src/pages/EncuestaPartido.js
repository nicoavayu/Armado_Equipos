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
  const _wrapperClass = 'min-h-[100dvh] bg-fifa-gradient w-full p-0 flex flex-col overflow-x-hidden';
  const cardClass = 'w-[92%] max-w-[720px] mx-auto min-h-[100dvh] px-3 md:px-4 flex flex-col';
  const stepClass = 'w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-5 md:gap-6 py-5 md:py-6';
  const questionRowClass = 'w-full flex items-center justify-center';
  const contentRowClass = 'w-full min-h-[170px] flex items-center justify-center overflow-hidden';
  const actionRowClass = 'w-full flex items-center justify-center';
  const logoRowClass = 'w-full flex justify-center pt-5 md:pt-6';
  const titleClass = 'font-bebas text-[30px] md:text-[56px] text-white tracking-[0.08em] font-bold text-center leading-[1.06] uppercase drop-shadow-md break-words w-full px-1';
  const surveyBtnBaseClass = 'w-full border border-white/40 bg-white/[0.12] text-white font-bebas text-[22px] md:text-[24px] py-3 text-center cursor-pointer transition-all hover:bg-white/[0.17] active:scale-[0.98] flex items-center justify-center min-h-[64px] rounded-[22px] tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_24px_rgba(17,14,72,0.32)] disabled:opacity-60 disabled:cursor-not-allowed';
  const btnClass = `${surveyBtnBaseClass} font-bold uppercase`;
  const optionBtnClass = `${surveyBtnBaseClass} uppercase`;
  const optionBtnSelectedClass = 'bg-white/[0.24] border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_12px_26px_rgba(17,14,72,0.38)]';
  const gridClass = 'grid grid-cols-2 gap-4 w-full max-w-[520px] mx-auto';
  const textClass = 'text-white text-[18px] md:text-[20px] font-oswald text-center font-normal tracking-wide';
  const actionDockClass = 'w-full max-w-[520px] mx-auto flex flex-col gap-3';
  const miniCardsStageClass = 'w-full h-full max-h-[250px] overflow-y-auto py-1';
  const miniCardBaseClass = 'flex flex-col items-center justify-start px-1.5 py-2 rounded-[16px] cursor-pointer transition-all border backdrop-blur-sm shadow-[0_8px_20px_rgba(9,12,55,0.28)] hover:-translate-y-[2px]';

  const SurveyFooterLogo = () => (
    <div className="opacity-55 pointer-events-none">
      <img
        src={Logo}
        alt="Logo Arma2"
        className="w-[68px] h-auto drop-shadow-[0_0_8px_rgba(0,0,0,0.45)]"
      />
    </div>
  );

  const getSelectedMiniCardClass = (variant) => {
    switch (variant) {
      case 'mvp':
        return 'bg-[#18d8ab] border-[#18d8ab] ring-2 ring-[#76f7da]/70 shadow-[0_12px_26px_rgba(24,216,171,0.45)]';
      case 'gk':
        return 'bg-[#ffd36b] border-[#ffd36b] ring-2 ring-[#ffe5a0]/75 shadow-[0_12px_26px_rgba(255,211,107,0.45)]';
      case 'danger':
        return 'bg-[#de1c49] border-[#de1c49] ring-2 ring-[#ff8ea8]/70 shadow-[0_12px_26px_rgba(222,28,73,0.48)]';
      default:
        return optionBtnSelectedClass;
    }
  };

  const renderMiniPlayerCards = ({
    isSelected,
    onSelect,
    variant = 'mvp',
  }) => {
    const playerCount = jugadores.length;
    const isDense = playerCount > 12;
    const isUltraDense = playerCount > 18;

    const gridClass = isUltraDense
      ? 'grid grid-cols-4 sm:grid-cols-6 gap-1.5 md:gap-2 w-full max-w-[620px] mx-auto place-items-center min-h-full content-center'
      : isDense
        ? 'grid grid-cols-4 sm:grid-cols-5 gap-1.5 md:gap-2 w-full max-w-[600px] mx-auto place-items-center min-h-full content-center'
        : 'grid grid-cols-3 sm:grid-cols-4 gap-2 md:gap-2.5 w-full max-w-[560px] mx-auto place-items-center min-h-full content-center';

    const cardSizeClass = isUltraDense
      ? 'w-[78px] sm:w-[86px] min-h-[92px]'
      : isDense
        ? 'w-[86px] sm:w-[94px] min-h-[98px]'
        : 'w-[96px] sm:w-[108px] min-h-[104px]';

    const imageSizeClass = isUltraDense
      ? 'w-[50px] h-[50px]'
      : isDense
        ? 'w-[54px] h-[54px]'
        : 'w-[60px] h-[60px]';

    return (
      <div className={gridClass}>
        {jugadores.map((jugador, index) => {
          const selected = isSelected(jugador.uuid);
          return (
            <button
              key={jugador.uuid}
              type="button"
              onClick={() => onSelect(jugador.uuid)}
              className={`${miniCardBaseClass} ${cardSizeClass} ${selected
                ? getSelectedMiniCardClass(variant)
                : 'bg-white/[0.08] border-white/20 hover:bg-white/[0.14] hover:border-white/30'
                }`}
              style={{
                animation: 'cardIn 460ms cubic-bezier(0.22,1,0.36,1) both',
                animationDelay: `${index * 24}ms`,
              }}
            >
              <div className={`${imageSizeClass} rounded-lg border overflow-hidden mb-1.5 bg-black/20 shrink-0 ${selected ? 'border-black/10' : 'border-black/20'}`}>
                {jugador.avatar_url || jugador.foto_url ? (
                  <img
                    src={jugador.avatar_url || jugador.foto_url}
                    alt={jugador.nombre}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center text-base font-semibold ${selected ? 'text-black/70' : 'text-white/60'}`}>
                    {jugador.nombre.charAt(0)}
                  </div>
                )}
              </div>
              <span
                className={`text-[11px] sm:text-[12px] font-semibold text-center leading-tight w-full px-0.5 ${selected ? 'text-slate-900' : 'text-white'}`}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {jugador.nombre}
              </span>
            </button>
          );
        })}
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
        <div className="min-h-[100dvh] w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className={cardClass}>
            <PageLoadingState
              title="CARGANDO ENCUESTA"
              description="Estamos preparando los datos del partido."
            />
            <div className="mt-6 flex justify-center">
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
        <div className="min-h-[100dvh] w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
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
      <div className="min-h-[100dvh] w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <style>{animationStyle}</style>
        <div className={cardClass}>
          <div className="w-full min-h-[52px] pt-2">
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
              <div className={contentRowClass}>
                <div className={miniCardsStageClass}>
                  {renderMiniPlayerCards({
                    isSelected: (uuid) => formData.mvp_id === uuid,
                    onSelect: (uuid) => handleInputChange('mvp_id', uuid),
                    variant: 'mvp',
                  })}
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
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
              <div className={contentRowClass}>
                <div className={miniCardsStageClass}>
                  {renderMiniPlayerCards({
                    isSelected: (uuid) => formData.arquero_id === uuid,
                    onSelect: (uuid) => {
                      handleInputChange('arquero_id', uuid);
                      handleInputChange('sin_arquero_fijo', false);
                    },
                    variant: 'gk',
                  })}
                </div>
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
                    className={btnClass}
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
              <div className="w-full flex items-start justify-center">
                <div className="w-full max-w-[560px] mx-auto">
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
              <div className={contentRowClass}>
                <div className={miniCardsStageClass}>
                  {renderMiniPlayerCards({
                    isSelected: (uuid) => formData.jugadores_violentos.includes(uuid),
                    onSelect: (uuid) => toggleJugadorViolento(uuid),
                    variant: 'danger',
                  })}
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
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
              <div className={contentRowClass}>
                <div className="w-full max-w-[560px] mx-auto">
                  <textarea
                    className="w-full h-32 md:h-36 p-5 text-left font-oswald text-[20px] md:text-[22px] bg-white/90 border-[1.5px] border-[#eceaf1] rounded-xl text-[#333] outline-none transition-all placeholder:text-gray-500 focus:bg-white focus:border-[#0EA9C6] resize-none"
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
              <div className={contentRowClass}>
                <div className={miniCardsStageClass}>
                  {renderMiniPlayerCards({
                    isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                    onSelect: (uuid) => toggleJugadorAusente(uuid),
                    variant: 'danger',
                  })}
                </div>
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
              <div className={contentRowClass}>
                <div className={miniCardsStageClass}>
                  {renderMiniPlayerCards({
                    isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                    onSelect: (uuid) => toggleJugadorAusente(uuid),
                    variant: 'danger',
                  })}
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
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
