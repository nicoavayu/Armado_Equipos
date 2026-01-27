import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
import { useAuth } from '../components/AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import LoadingSpinner from '../components/LoadingSpinner';
import PageTitle from '../components/PageTitle';
import PageTransition from '../components/PageTransition';
import { finalizeIfComplete } from '../services/surveyCompletionService';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';

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
  const { navigateWithAnimation } = useAnimatedNavigation();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partido, setPartido] = useState(null);
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
  const [yaCalificado, setYaCalificado] = useState(false);
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
          .from('partidos')
          .select('*')
          .eq('id', id)
          .single();

        if (partidoError) throw partidoError;
        if (!partidoData) {
          throw new AppError('Partido no encontrado', ERROR_CODES.NOT_FOUND);
        }

        setPartido(partidoData);

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

        try { await fetchNotifications?.(); } catch { }
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
        created_at: new Date().toISOString(),
      };

      const { data: insertData, error: insertError } = await supabase
        .from('post_match_surveys')
        .insert([surveyData]);

      if (insertError) {
        console.error('[ENCUESTA] post_match_surveys insert error full:', insertError);
        throw insertError;
      }

      try {
        await finalizeIfComplete(parseInt(id));
      } catch (e) {
        console.warn('[finalizeIfComplete] non-blocking error:', e);
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
  const wrapperClass = 'min-h-screen bg-fifa-gradient w-full p-0 flex flex-col overflow-x-hidden';
  const cardClass = 'w-[90%] max-w-[520px] mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-120px)] p-5 relative';
  const titleClass = 'font-bebas text-[38px] md:text-[64px] text-white tracking-widest font-bold mb-10 text-center leading-[1.1] uppercase drop-shadow-md break-words w-full';
  const btnClass = 'font-bebas text-[27px] md:text-[28px] text-white bg-primary border border-white/40 rounded-xl tracking-wide py-4 px-4 mt-4 w-full cursor-pointer font-bold transition-all hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed relative overflow-hidden flex items-center justify-center shadow-[0_10px_30px_rgba(129,120,229,0.35)]';
  const optionBtnClass = 'w-full bg-white/10 border border-white/30 text-white font-bebas text-2xl md:text-[2rem] py-3 text-center cursor-pointer transition-all hover:bg-white/16 active:scale-[0.98] flex items-center justify-center min-h-[52px] rounded-xl shadow-[0_6px_18px_rgba(0,0,0,0.25)]';
  const optionBtnSelectedClass = 'bg-primary border-white/80 shadow-[0_8px_24px_rgba(129,120,229,0.45)]';
  const gridClass = 'grid grid-cols-2 gap-4 w-full max-w-[400px] mx-auto mb-[18px]';
  const textClass = 'text-white text-[20px] font-oswald text-center mb-[30px] font-normal tracking-wide';

  // Animation style
  const animationStyle = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;

  if (loading) {
    return (
      <PageTransition>
        <div className="min-h-screen w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className={cardClass}>
            <LoadingSpinner size="large" />
          </div>
        </div>
      </PageTransition>
    );
  }

  if (yaCalificado || alreadySubmitted) {
    return (
      <PageTransition>
        <div className="min-h-screen w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className={cardClass}>
            <div className={titleClass}>YA COMPLETASTE LA ENCUESTA</div>
            <div className={`${textClass} text-[26px]`}>
              Ya has completado la encuesta de este partido.<br />¡Gracias por tu participación!
            </div>
            <button className={btnClass} onClick={() => navigate('/')}>
              VOLVER AL INICIO
            </button>

            <button
              className="mt-4 text-white/50 text-sm font-oswald underline cursor-pointer hover:text-white"
              onClick={async () => {
                try {
                  const res = await finalizeIfComplete(id);
                  if (res.done) {
                    toast.success('Estado actualizado: Encuesta finalizada');
                  } else {
                    toast.info(`Estado: ${res.surveysCount}/${res.playersCount} votos. Cierra: ${Utils_formatTime(res.deadlineAt)}`);
                  }
                } catch (e) { console.error(e); toast.error('Error verificando estado'); }
              }}
            >
                ADMIN: Verificar Estado / Forzar Cierre
            </button>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen w-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <style>{animationStyle}</style>
        <div className={cardClass}>

          {/* STEP 0: ¿SE JUGÓ? */}
          {currentStep === 0 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
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
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
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
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿QUIÉN FUE EL MEJOR JUGADOR?
              </div>
              <div className="grid grid-cols-4 gap-2 w-[85%] mx-auto mb-5">
                {jugadores.map((jugador) => (
                  <div
                    key={jugador.uuid}
                    onClick={() => handleInputChange('mvp_id', jugador.uuid)}
                    className={`flex flex-col items-center p-2.5 rounded-md cursor-pointer transition-all min-h-[90px] ${formData.mvp_id === jugador.uuid
                      ? 'bg-[#00D49B] border border-[#00D49B]'
                      : 'bg-white/10 border border-white/20 hover:bg-white/15'
                    }`}
                  >
                    <div className="w-[55px] h-[55px] rounded border border-black/10 overflow-hidden mb-1.5 bg-black/20 shrink-0">
                      {jugador.avatar_url || jugador.foto_url ? (
                        <img
                          src={jugador.avatar_url || jugador.foto_url}
                          alt={jugador.nombre}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/50 text-base font-semibold">
                          {jugador.nombre.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="text-white text-[10px] font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap w-full">
                      {jugador.nombre}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className={btnClass}
                onClick={() => setCurrentStep(3)}
              >
              SIGUIENTE
              </button>
            </div>
          )}

          {/* STEP 3: ARQUERO */}
          {currentStep === 3 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿QUIÉN FUE EL MEJOR ARQUERO?
              </div>
              <div className="grid grid-cols-4 gap-2 w-[85%] mx-auto mb-5">
                {jugadores.map((jugador) => (
                  <div
                    key={jugador.uuid}
                    onClick={() => handleInputChange('arquero_id', jugador.uuid)}
                    className={`flex flex-col items-center p-2.5 rounded-md cursor-pointer transition-all min-h-[90px] ${formData.arquero_id === jugador.uuid
                      ? 'bg-[#FFD700] border border-[#FFD700] shadow-[0_0_10px_rgba(255,215,0,0.3)]'
                      : 'bg-white/10 border border-white/20 hover:bg-white/15'
                    }`}
                  >
                    <div className="w-[55px] h-[55px] rounded border border-black/10 overflow-hidden mb-1.5 bg-black/20 shrink-0">
                      {jugador.avatar_url || jugador.foto_url ? (
                        <img
                          src={jugador.avatar_url || jugador.foto_url}
                          alt={jugador.nombre}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/50 text-base font-semibold">
                          {jugador.nombre.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="text-white text-[10px] font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap w-full">
                      {jugador.nombre}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-center mb-2.5">
                <button
                  className={`${optionBtnClass} bg-primary border-primary/80 shadow-[0_8px_24px_rgba(129,120,229,0.45)] w-[90%] mx-auto`}
                  onClick={() => {
                    handleInputChange('arquero_id', '');
                    setCurrentStep(4);
                  }}
                >
                NO HUBO ARQUEROS FIJOS
                </button>
              </div>
              <button
                className={btnClass}
                onClick={() => setCurrentStep(4)}
                style={{ marginTop: 10 }}
              >
              SIGUIENTE
              </button>
            </div>
          )}

          {/* STEP 4: ¿PARTIDO LIMPIO? */}
          {currentStep === 4 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿FUE UN PARTIDO LIMPIO?
              </div>
              <div className={gridClass}>
                <button
                  className={`${optionBtnClass} ${formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                  onClick={() => {
                    handleInputChange('partido_limpio', true);
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
          )}

          {/* STEP 5: ¿QUIÉN GANÓ? */}
          {currentStep === 5 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿QUIÉN GANÓ?
              </div>
              <div className={gridClass}>
                <button
                  className={`${optionBtnClass} ${formData.ganador === 'equipo_a' ? 'bg-[#9C27B0] border-white' : 'bg-[#9C27B0]/30 border-white'}`}
                  onClick={() => handleInputChange('ganador', 'equipo_a')}
                  type="button"
                >
                EQUIPO A
                </button>
                <button
                  className={`${optionBtnClass} ${formData.ganador === 'equipo_b' ? 'bg-[#FF9800] border-white' : 'bg-[#FF9800]/30 border-white'}`}
                  onClick={() => handleInputChange('ganador', 'equipo_b')}
                  type="button"
                >
                EQUIPO B
                </button>
              </div>
              <div className="flex justify-center w-full mb-5">
                <input
                  type="text"
                  className="w-[90%] p-4 text-center font-oswald text-[19px] bg-white/90 border-[1.5px] border-[#eceaf1] rounded-none text-[#333] outline-none transition-all placeholder:text-gray-500 focus:border-[#0EA9C6] focus:bg-white"
                  value={formData.resultado || ''}
                  onChange={(e) => handleInputChange('resultado', e.target.value)}
                  placeholder="¿Te acordás cómo salió?"
                />
              </div>
              <button
                className={btnClass}
                onClick={handleSubmit}
              >
              FINALIZAR ENCUESTA
              </button>
            </div>
          )}

          {/* STEP 6: JUGADORES VIOLENTOS */}
          {currentStep === 6 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿QUIÉN JUGÓ SUCIO?
              </div>
              <div className="grid grid-cols-4 gap-2 w-[85%] mx-auto mb-5">
                {jugadores.map((jugador) => (
                  <div
                    key={jugador.uuid}
                    onClick={() => toggleJugadorViolento(jugador.uuid)}
                    className={`flex flex-col items-center p-2.5 rounded-md cursor-pointer transition-all min-h-[90px] ${formData.jugadores_violentos.includes(jugador.uuid)
                      ? 'bg-[#DE1C49] border border-[#DE1C49] shadow-[0_0_10px_rgba(222,28,73,0.4)]'
                      : 'bg-white/10 border border-white/20 hover:bg-white/15'
                    }`}
                  >
                    <div className="w-[55px] h-[55px] rounded border border-black/10 overflow-hidden mb-1.5 bg-black/20 shrink-0">
                      {jugador.avatar_url || jugador.foto_url ? (
                        <img
                          src={jugador.avatar_url || jugador.foto_url}
                          alt={jugador.nombre}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/50 text-base font-semibold">
                          {jugador.nombre.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="text-white text-[10px] font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap w-full">
                      {jugador.nombre}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className={btnClass}
                onClick={() => setCurrentStep(5)}
              >
              SIGUIENTE
              </button>
            </div>
          )}

          {/* STEP 10: MOTIVO NO JUGADO */}
          {currentStep === 10 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿POR QUÉ NO SE JUGÓ?
              </div>
              <div className="flex justify-center w-full mb-5">
                <textarea
                  className="w-[90%] h-20 p-4 text-center font-oswald text-[19px] bg-white/90 border-[1.5px] border-[#eceaf1] rounded-lg text-[#333] outline-none transition-all placeholder:text-gray-500 focus:bg-white focus:border-[#0EA9C6] resize-none"
                  value={formData.motivo_no_jugado || ''}
                  onChange={(e) => handleInputChange('motivo_no_jugado', e.target.value)}
                  placeholder="Explica por qué no se pudo jugar..."
                />
              </div>
              <button
                className={btnClass}
                onClick={() => setCurrentStep(11)}
                style={{
                  backgroundColor: '#DE1C49',
                  borderColor: '#DE1C49',
                  marginBottom: 15,
                  marginTop: 0,
                }}
              >
              AUSENCIA SIN AVISO
              </button>
              <button
                className={btnClass}
                onClick={continueSubmitFlow}
                style={{ marginTop: 0 }}
              >
              FINALIZAR
              </button>
            </div>
          )}

          {/* STEP 11: AUSENTES SIN AVISO (PARTIDO NO JUGADO) */}
          {currentStep === 11 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿QUIÉNES FALTARON?
              </div>
              <div className="grid grid-cols-4 gap-2 w-[85%] mx-auto mb-5">
                {jugadores.map((jugador) => (
                  <div
                    key={jugador.uuid}
                    onClick={() => toggleJugadorAusente(jugador.uuid)}
                    className={`flex flex-col items-center p-2.5 rounded-md cursor-pointer transition-all min-h-[90px] ${formData.jugadores_ausentes.includes(jugador.uuid)
                      ? 'bg-[#DE1C49] border border-[#DE1C49] shadow-[0_0_10px_rgba(222,28,73,0.4)]'
                      : 'bg-white/10 border border-white/20 hover:bg-white/15'
                    }`}
                  >
                    <div className="w-[55px] h-[55px] rounded border border-black/10 overflow-hidden mb-1.5 bg-black/20 shrink-0">
                      {jugador.avatar_url || jugador.foto_url ? (
                        <img
                          src={jugador.avatar_url || jugador.foto_url}
                          alt={jugador.nombre}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/50 text-base font-semibold">
                          {jugador.nombre.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="text-white text-[10px] font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap w-full">
                      {jugador.nombre}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className={btnClass}
                onClick={handleSubmit}
              >
              FINALIZAR
              </button>
            </div>
          )}

          {/* STEP 12: AUSENTES (PARTIDO JUGADO) */}
          {currentStep === 12 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¿QUIÉNES FALTARON?
              </div>
              <div className="grid grid-cols-4 gap-2 w-[85%] mx-auto mb-5">
                {jugadores.map((jugador) => (
                  <div
                    key={jugador.uuid}
                    onClick={() => toggleJugadorAusente(jugador.uuid)}
                    className={`flex flex-col items-center p-2.5 rounded-md cursor-pointer transition-all min-h-[90px] ${formData.jugadores_ausentes.includes(jugador.uuid)
                      ? 'bg-[#DE1C49] border border-[#DE1C49] shadow-[0_0_10px_rgba(222,28,73,0.4)]'
                      : 'bg-white/10 border border-white/20 hover:bg-white/15'
                    }`}
                  >
                    <div className="w-[55px] h-[55px] rounded border border-black/10 overflow-hidden mb-1.5 bg-black/20 shrink-0">
                      {jugador.avatar_url || jugador.foto_url ? (
                        <img
                          src={jugador.avatar_url || jugador.foto_url}
                          alt={jugador.nombre}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/50 text-base font-semibold">
                          {jugador.nombre.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="text-white text-[10px] font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap w-full">
                      {jugador.nombre}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className={btnClass}
                onClick={() => setCurrentStep(2)}
              >
              SIGUIENTE
              </button>
            </div>
          )}

          {/* STEP 99: FINAL */}
          {currentStep === 99 && (
            <div className="w-full animate-[slideIn_0.4s_ease-out_forwards]">
              <div className={titleClass}>
              ¡GRACIAS POR CALIFICAR!
              </div>
              <div className={`${textClass} text-[26px]`}>
              Los resultados se publicarán en ~6 horas.
              </div>
              <button
                className={btnClass}
                onClick={() => navigate('/')}
              >
              VOLVER AL INICIO
              </button>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
};

export default EncuestaPartido;