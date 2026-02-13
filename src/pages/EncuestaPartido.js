import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
import { useAuth } from '../components/AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import PageLoadingState from '../components/PageLoadingState';
import PageTransition from '../components/PageTransition';
import { finalizeIfComplete } from '../services/surveyCompletionService';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import { clearMatchFromList } from '../services/matchFinishService';
import Logo from '../Logo.png';

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
    motivo_no_jugado: '',
    ganador: '',
    resultado: '',
  });
  const [jugadores, setJugadores] = useState([]);
  const [yaCalificado, _setYaCalificado] = useState(false);
  const [encuestaFinalizada, setEncuestaFinalizada] = useState(false);

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

        if (partidoData.jugadores && Array.isArray(partidoData.jugadores)) {
          setJugadores(partidoData.jugadores);
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

  const continueSubmitFlow = async () => {
    try {
      if (alreadySubmitted) {
        toast.info('Ya completaste esta encuesta');
        return;
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
        // Winner A/B/(draw) only makes sense when teams are confirmed.
        ganador: teamsConfirmed ? (formData.ganador || null) : null,
        resultado: teamsConfirmed ? (formData.resultado || null) : null,
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

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!user || !id) {
      toast.error('Debes iniciar sesión para calificar un partido');
      return;
    }

    if (alreadySubmitted) {
      toast.info('Ya completaste esta encuesta');
      return;
    }

    if (teamsConfirmed && currentStep === 5 && !formData.ganador) {
      toast.error('Elegí el ganador');
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
  const cardClass = 'w-[92%] max-w-[620px] mx-auto flex flex-col items-center min-h-[100dvh] pt-3 md:pt-5 pb-[calc(env(safe-area-inset-bottom)+110px)] px-3';
  const stepClass = 'w-full max-w-[620px] mx-auto flex flex-col min-h-[calc(100dvh-160px)] pt-6 md:pt-8';
  const titleClass = 'font-bebas text-[30px] md:text-[56px] text-white tracking-[0.08em] font-bold mb-4 md:mb-6 text-center leading-[1.06] uppercase drop-shadow-md break-words w-full px-1';
  const surveyBtnBaseClass = 'w-full border border-white/40 bg-white/[0.12] text-white font-bebas text-[22px] md:text-[24px] py-3 text-center cursor-pointer transition-all hover:bg-white/[0.17] active:scale-[0.98] flex items-center justify-center min-h-[64px] rounded-[22px] tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_24px_rgba(17,14,72,0.32)] disabled:opacity-60 disabled:cursor-not-allowed';
  const btnClass = `${surveyBtnBaseClass} font-bold uppercase`;
  const optionBtnClass = `${surveyBtnBaseClass} uppercase`;
  const optionBtnSelectedClass = 'bg-white/[0.24] border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_12px_26px_rgba(17,14,72,0.38)]';
  const gridClass = 'grid grid-cols-2 gap-4 w-full max-w-[420px] mx-auto mb-[18px]';
  const textClass = 'text-white text-[18px] md:text-[20px] font-oswald text-center mb-6 font-normal tracking-wide';
  const actionDockClass = 'w-full mt-auto pt-5 pb-[calc(env(safe-area-inset-bottom)+78px)]';
  const miniCardsStageClass = 'w-full flex-1 flex flex-col items-center justify-center';
  const miniGridClass = 'grid grid-cols-3 sm:grid-cols-4 gap-2 md:gap-2.5 w-full max-w-[500px] mx-auto place-items-center';
  const miniCardBaseClass = 'w-[104px] sm:w-[112px] md:w-[124px] flex flex-col items-center justify-start px-2 py-2 rounded-[18px] cursor-pointer transition-all min-h-[102px] border backdrop-blur-sm hover:-translate-y-[2px]';

  const SurveyFooterLogo = () => (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+34px)] opacity-55 pointer-events-none z-20">
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
        return 'bg-[#18d8ab] border-[#18d8ab] shadow-[0_10px_24px_rgba(24,216,171,0.4)]';
      case 'gk':
        return 'bg-[#ffd36b] border-[#ffd36b] shadow-[0_10px_24px_rgba(255,211,107,0.42)]';
      case 'danger':
        return 'bg-[#de1c49] border-[#de1c49] shadow-[0_10px_24px_rgba(222,28,73,0.45)]';
      default:
        return optionBtnSelectedClass;
    }
  };

  const renderMiniPlayerCards = ({
    isSelected,
    onSelect,
    variant = 'mvp',
  }) => (
    <div className={miniGridClass}>
      {jugadores.map((jugador, index) => {
        const selected = isSelected(jugador.uuid);
        return (
          <button
            key={jugador.uuid}
            type="button"
            onClick={() => onSelect(jugador.uuid)}
            className={`${miniCardBaseClass} ${selected
              ? getSelectedMiniCardClass(variant)
              : 'bg-white/[0.08] border-white/20 hover:bg-white/[0.14] hover:border-white/30'
              }`}
            style={{
              animation: 'cardIn 460ms cubic-bezier(0.22,1,0.36,1) both',
              animationDelay: `${index * 36}ms`,
            }}
          >
            <div className={`w-[54px] h-[54px] rounded-lg border overflow-hidden mb-1.5 bg-black/20 shrink-0 ${selected ? 'border-black/10' : 'border-black/20'}`}>
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
              className={`text-[12px] font-semibold text-center leading-tight w-full px-0.5 ${selected ? 'text-slate-900' : 'text-white'}`}
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
          </div>
          <SurveyFooterLogo />
        </div>
      </PageTransition>
    );
  }

  if (yaCalificado || alreadySubmitted) {
    return (
      <PageTransition>
        <div className="min-h-[100dvh] w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className={cardClass}>
            <div className={stepClass}>
              <div className="font-bebas text-[30px] md:text-[44px] text-white tracking-[0.04em] font-bold mb-8 text-center leading-[1.05] uppercase drop-shadow-md break-words w-full">
                YA COMPLETASTE<br />LA ENCUESTA
              </div>
              <div className="text-white text-[18px] md:text-[22px] font-oswald text-center mb-6 font-normal tracking-wide leading-[1.25] whitespace-nowrap">
                ¡Gracias por tu participación!
              </div>
              <div className={actionDockClass}>
                <button className={btnClass} onClick={() => navigate('/')}>
                  VOLVER AL INICIO
                </button>
              </div>
            </div>
          </div>
          <SurveyFooterLogo />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-[100dvh] w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <style>{animationStyle}</style>
        <div className={cardClass}>

          {/* STEP 0: ¿SE JUGÓ? */}
          {currentStep === 0 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿SE JUGÓ EL PARTIDO?
              </div>
              <div className={textClass}>
                {formatFecha(partido.fecha)}<br />
                {partido.hora && `${partido.hora} - `}{partido.sede ? partido.sede.split(/[,(]/)[0].trim() : 'Sin ubicación'}
              </div>
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
          )}

          {/* STEP 1: ¿ASISTIERON TODOS? */}
          {currentStep === 1 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿ASISTIERON TODOS?
              </div>
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
          )}

          {/* STEP 2: MVP */}
          {currentStep === 2 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿QUIÉN FUE EL MEJOR JUGADOR?
              </div>
              <div className={miniCardsStageClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.mvp_id === uuid,
                  onSelect: (uuid) => handleInputChange('mvp_id', uuid),
                  variant: 'mvp',
                })}
              </div>
              <div className={actionDockClass}>
                <button
                  className={btnClass}
                  onClick={() => setCurrentStep(3)}
                >
                  SIGUIENTE
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: ARQUERO */}
          {currentStep === 3 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿QUIÉN FUE EL MEJOR ARQUERO?
              </div>
              <div className={miniCardsStageClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.arquero_id === uuid,
                  onSelect: (uuid) => handleInputChange('arquero_id', uuid),
                  variant: 'gk',
                })}
                <div className="flex justify-center mt-3 w-full">
                  <button
                    type="button"
                    className={`${optionBtnClass} ${!formData.arquero_id ? optionBtnSelectedClass : ''} w-full max-w-[420px]`}
                    onClick={() => {
                      handleInputChange('arquero_id', '');
                      setCurrentStep(4);
                    }}
                  >
                    NO HUBO ARQUEROS FIJOS
                  </button>
                </div>
              </div>
              <div className={actionDockClass}>
                <button
                  className={btnClass}
                  onClick={() => setCurrentStep(4)}
                >
                  SIGUIENTE
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: ¿PARTIDO LIMPIO? */}
          {currentStep === 4 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿FUE UN PARTIDO LIMPIO?
              </div>
              <div className={gridClass}>
                <button
                  className={`${optionBtnClass} ${formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                  onClick={() => {
                    handleInputChange('partido_limpio', true);
                    setCurrentStep(6);
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
          )}

          {/* STEP 5: ¿QUIÉN GANÓ? */}
          {currentStep === 5 && teamsConfirmed && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿QUIÉN GANÓ?
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-[520px] mx-auto mb-5">
                {[
                  { value: 'equipo_a', label: 'Equipo A' },
                  { value: 'equipo_b', label: 'Equipo B' },
                  { value: 'empate', label: 'Empate' },
                ].map((option) => (
                  <button
                    key={option.value}
                    className={`${optionBtnClass} ${formData.ganador === option.value ? optionBtnSelectedClass : ''}`}
                    onClick={() => handleInputChange('ganador', option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-center w-full mb-5">
                <input
                  type="text"
                  className="w-full max-w-[420px] h-14 px-4 text-center font-oswald text-[20px] bg-white/90 border-[1.5px] border-[#eceaf1] rounded-xl text-[#333] outline-none transition-all placeholder:text-gray-500 focus:border-[#0EA9C6] focus:bg-white"
                  value={formData.resultado || ''}
                  onChange={(e) => handleInputChange('resultado', e.target.value)}
                  placeholder="¿Te acordás cómo salió?"
                />
              </div>
              <div className={actionDockClass}>
                <button
                  className={btnClass}
                  onClick={handleSubmit}
                >
                  FINALIZAR ENCUESTA
                </button>
              </div>
            </div>
          )}

          {/* STEP 6: JUGADORES VIOLENTOS */}
          {currentStep === 6 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿QUIÉN JUGÓ SUCIO?
              </div>
              <div className={miniCardsStageClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_violentos.includes(uuid),
                  onSelect: (uuid) => toggleJugadorViolento(uuid),
                  variant: 'danger',
                })}
              </div>
              <div className={actionDockClass}>
                <button
                  className={btnClass}
                  onClick={() => {
                    if (teamsConfirmed) {
                      setCurrentStep(5);
                      return;
                    }
                    if (submitting || encuestaFinalizada) return;
                    setSubmitting(true);
                    continueSubmitFlow();
                  }}
                >
                  {teamsConfirmed ? 'SIGUIENTE' : 'FINALIZAR ENCUESTA'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 10: MOTIVO NO JUGADO */}
          {currentStep === 10 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿POR QUÉ NO SE JUGÓ?
              </div>
              <div className="flex justify-center w-full">
                <textarea
                  className="w-full h-32 md:h-36 p-5 text-left font-oswald text-[20px] md:text-[22px] bg-white/90 border-[1.5px] border-[#eceaf1] rounded-xl text-[#333] outline-none transition-all placeholder:text-gray-500 focus:bg-white focus:border-[#0EA9C6] resize-none"
                  value={formData.motivo_no_jugado || ''}
                  onChange={(e) => handleInputChange('motivo_no_jugado', e.target.value)}
                  placeholder="Explica por qué no se pudo jugar..."
                />
              </div>
              <div className={`${actionDockClass} flex flex-col gap-3`}>
                <button
                  className={`${btnClass} !mt-0`}
                  onClick={() => setCurrentStep(11)}
                >
                  AUSENCIA SIN AVISO
                </button>
                <button
                  className={`${btnClass} !mt-0`}
                  onClick={continueSubmitFlow}
                >
                  FINALIZAR
                </button>
              </div>
            </div>
          )}

          {/* STEP 11: AUSENTES SIN AVISO (PARTIDO NO JUGADO) */}
          {currentStep === 11 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿QUIÉNES FALTARON?
              </div>
              <div className={miniCardsStageClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                  variant: 'danger',
                })}
              </div>
              <div className={actionDockClass}>
                <button
                  className={btnClass}
                  onClick={handleSubmit}
                >
                  FINALIZAR
                </button>
              </div>
            </div>
          )}

          {/* STEP 12: AUSENTES (PARTIDO JUGADO) */}
          {currentStep === 12 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¿QUIÉNES FALTARON?
              </div>
              <div className={miniCardsStageClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                  variant: 'danger',
                })}
              </div>
              <div className={actionDockClass}>
                <button
                  className={btnClass}
                  onClick={() => setCurrentStep(2)}
                >
                  SIGUIENTE
                </button>
              </div>
            </div>
          )}

          {/* STEP 99: FINAL */}
          {currentStep === 99 && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={titleClass}>
                ¡GRACIAS POR CALIFICAR!
              </div>
              <div className={`${textClass} text-[26px]`}>
                Los resultados se publicarán en ~6 horas.
              </div>
              <div className={actionDockClass}>
                <button
                  className={btnClass}
                  onClick={() => navigate('/proximos?surveyDone=1')}
                >
                  VOLVER AL INICIO
                </button>
              </div>
            </div>
          )}
        </div>
        <SurveyFooterLogo />
      </div>
    </PageTransition>
  );
};

export default EncuestaPartido;
