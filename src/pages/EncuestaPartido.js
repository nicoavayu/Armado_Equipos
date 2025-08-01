import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, checkPartidoCalificado } from '../supabase';
import { processAbsenceWithoutNotice } from '../utils/matchStatsManager';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import { useBadges } from '../context/BadgeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ProfileCard from '../components/ProfileCard';
import '../VotingView.css';

const EncuestaPartido = () => {
  const { partidoId } = useParams();
  const { user } = useAuth();
  const { triggerBadgeRefresh } = useBadges();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partido, setPartido] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [animating, setAnimating] = useState(false);
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
  const [showingBadgeAnimations, setShowingBadgeAnimations] = useState(false);
  const [badgeAnimations, setBadgeAnimations] = useState([]);
  const [currentAnimationIndex, setCurrentAnimationIndex] = useState(0);
  const [animationComplete, setAnimationComplete] = useState(false);
  const [animationProcessed, setAnimationProcessed] = useState(false);


  useEffect(() => {
    const fetchPartidoData = async () => {
      if (!partidoId || !user) {
        navigate('/');
        return;
      }
      
      try {
        setLoading(true);
        
        const calificado = await checkPartidoCalificado(partidoId, user.id);
        if (calificado) {
          setYaCalificado(true);
          toast.info('Ya has calificado este partido');
          return;
        }
        
        const { data: partidoData, error: partidoError } = await supabase
          .from('partidos')
          .select('*')
          .eq('id', partidoId)
          .single();
          
        if (partidoError) throw partidoError;
        if (!partidoData) {
          toast.error('Partido no encontrado');
          navigate('/');
          return;
        }
        
        setPartido(partidoData);
        
        if (partidoData.jugadores && Array.isArray(partidoData.jugadores)) {
          setJugadores(partidoData.jugadores);
        }
        
      } catch (error) {
        console.error('Error cargando datos del partido:', error);
        toast.error('Error cargando datos del partido');
      } finally {
        setLoading(false);
      }
    };
    
    fetchPartidoData();
  }, [partidoId, user, navigate]);

  useEffect(() => {
    if (showingBadgeAnimations && badgeAnimations.length > 0) {
      setCurrentAnimationIndex(0);
      setAnimationComplete(false);
    }
  }, [showingBadgeAnimations, badgeAnimations.length]);



  // Control del ciclo de animaciones - la última card queda visible
  useEffect(() => {
    if (showingBadgeAnimations && badgeAnimations.length > 0 && !animationComplete) {
      if (currentAnimationIndex < badgeAnimations.length - 1) {
        const timer = setTimeout(() => {
          setCurrentAnimationIndex((prev) => prev + 1);
        }, 3000);
        return () => clearTimeout(timer);
      } else {
        // Llegamos a la última animación - mostrar botón ACEPTAR sin avanzar más
        setAnimationComplete(true);
      }
    }
  }, [currentAnimationIndex, showingBadgeAnimations, badgeAnimations.length, animationComplete]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const nextStep = () => {
    if (animating) return;
    setAnimating(true);
    setTimeout(() => {
      setCurrentStep((prev) => prev + 1);
      setAnimating(false);
    }, 200);
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

  const handleAcceptAnimations = async () => {
    setShowingBadgeAnimations(false);
    setBadgeAnimations([]);
    setCurrentAnimationIndex(0);
    setAnimationComplete(false);
    await continueSubmitFlow();
  };

  const continueSubmitFlow = async () => {
    try {
      const surveyData = {
        partido_id: parseInt(partidoId),
        se_jugo: formData.se_jugo,
        motivo_no_jugado: formData.motivo_no_jugado || null,
        asistieron_todos: formData.asistieron_todos,
        jugadores_ausentes: formData.jugadores_ausentes,
        partido_limpio: formData.partido_limpio,
        jugadores_violentos: formData.jugadores_violentos,
        created_at: new Date().toISOString(),
      };
      
      if (formData.jugadores_ausentes.length > 0) {
        for (const jugadorId of formData.jugadores_ausentes) {
          try {
            await processAbsenceWithoutNotice(jugadorId, parseInt(partidoId), user.id);
          } catch (error) {
            console.error('Error processing absence without notice:', error);
          }
        }
      }
      
      const { error } = await supabase
        .from('post_match_surveys')
        .insert([surveyData]);
        
      if (error) throw error;
      
      // Match result update removed - columns don't exist in current schema
      
      const premios = [];
      
      if (formData.mvp_id) {
        premios.push({
          jugador_id: formData.mvp_id,
          partido_id: parseInt(partidoId),
          award_type: 'mvp',
          otorgado_por: user.id,
        });
      }
      
      if (formData.arquero_id) {
        premios.push({
          jugador_id: formData.arquero_id,
          partido_id: parseInt(partidoId),
          award_type: 'guante_dorado',
          otorgado_por: user.id,
        });
      }
      
      if (formData.jugadores_violentos.length > 0) {
        formData.jugadores_violentos.forEach((jugadorId) => {
          premios.push({
            jugador_id: jugadorId,
            partido_id: parseInt(partidoId),
            award_type: 'tarjeta_roja',
            otorgado_por: user.id,
          });
        });
      }
      
      if (premios.length > 0) {
        try {
          // Remover campo otorgado_por si no existe en la tabla
          const premiosLimpios = premios.map(({ otorgado_por, ...resto }) => resto);
          
          await supabase
            .from('player_awards')
            .insert(premiosLimpios);
          
          triggerBadgeRefresh();
        } catch (awardsError) {
          console.warn('Error inserting awards:', awardsError);
          // Continuar sin fallar si no se pueden insertar los premios
        }
      }
      
      toast.success('¡Gracias por calificar el partido!');
      setCurrentStep(99);
      
    } catch (error) {
      console.error('Error guardando encuesta:', error);
      toast.error('Error guardando encuesta: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user || !partidoId) {
      toast.error('Debes iniciar sesión para calificar un partido');
      return;
    }
    
    if (submitting || animationProcessed) {
      return;
    }
    
    setSubmitting(true);
    setAnimationProcessed(true);
    
    const animations = [];
    const addedPlayers = new Set();
    
    if (formData.se_jugo) {
      if (formData.mvp_id) {
        const player = jugadores.find((j) => j.uuid === formData.mvp_id);
        if (player && !addedPlayers.has(player.uuid + '_mvp')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'mvp',
            badgeText: 'MVP',
            badgeIcon: '🏆',
          });
          addedPlayers.add(player.uuid + '_mvp');
        }
      }
      if (formData.arquero_id) {
        const player = jugadores.find((j) => j.uuid === formData.arquero_id);
        if (player && !addedPlayers.has(player.uuid + '_guante_dorado')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'guante_dorado',
            badgeText: 'GUANTE DORADO',
            badgeIcon: '🧤',
          });
          addedPlayers.add(player.uuid + '_guante_dorado');
        }
      }
      if (formData.jugadores_violentos.length > 0) {
        const firstViolentPlayer = jugadores.find((j) => j.uuid === formData.jugadores_violentos[0]);
        if (firstViolentPlayer && !addedPlayers.has(firstViolentPlayer.uuid + '_tarjeta_roja')) {
          animations.push({
            playerName: firstViolentPlayer.nombre,
            playerAvatar: firstViolentPlayer.avatar_url || firstViolentPlayer.foto_url,
            badgeType: 'tarjeta_roja',
            badgeText: 'TARJETA ROJA',
            badgeIcon: '🟥',
          });
          addedPlayers.add(firstViolentPlayer.uuid + '_tarjeta_roja');
        }
      }
      
      // Agregar ausencias injustificadas al final
      if (formData.jugadores_ausentes.length > 0) {
        formData.jugadores_ausentes.forEach((jugadorId) => {
          const player = jugadores.find((j) => j.uuid === jugadorId);
          if (player && !addedPlayers.has(player.uuid + '_ausencia')) {
            animations.push({
              playerName: player.nombre,
              playerAvatar: player.avatar_url || player.foto_url,
              playerData: player,
              badgeType: 'ausencia_injustificada',
              badgeText: 'AUSENCIAS INJUSTIFICADAS',
              badgeIcon: '📉',
              pointsLost: -0.3,
            });
            addedPlayers.add(player.uuid + '_ausencia');
          }
        });
      }
    }
    
    if (animations.length > 0) {
      console.log('Setting badge animations:', animations);
      console.log('Total animations:', animations.length);
      setBadgeAnimations(animations);
      setShowingBadgeAnimations(true);
      return;
    } else {
      await continueSubmitFlow();
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

  const BadgeAnimation = ({ animations }) => {
    if (!animations || animations.length === 0) return null;
    
    // Mostrar la animación actual o la última si ya terminó el ciclo
    const animation = animations[Math.min(currentAnimationIndex, animations.length - 1)];
    if (!animation) return null;
    
    const player = jugadores.find((j) => j.nombre === animation.playerName);
    const isAbsence = animation.badgeType === 'ausencia_injustificada';
    
    // Estado local para la animación del score
    const [localAnimatedScore, setLocalAnimatedScore] = React.useState(null);
    const scoreAnimatingRef = React.useRef(false);
    
    // Animación del score para ausencias - solo se ejecuta una vez por animación
    React.useEffect(() => {
      if (isAbsence && player && animation.pointsLost && !scoreAnimatingRef.current) {
        scoreAnimatingRef.current = true;
        const currentScore = player.puntuacion || 0;
        const targetScore = currentScore + animation.pointsLost;
        setLocalAnimatedScore(currentScore);
        
        const timer = setTimeout(() => {
          let current = currentScore;
          let steps = 0;
          const maxSteps = 3;
          
          const interval = setInterval(() => {
            steps++;
            current = Math.round((current - 0.1) * 10) / 10;
            setLocalAnimatedScore(current);
            
            if (steps >= maxSteps || current <= targetScore) {
              clearInterval(interval);
              setLocalAnimatedScore(targetScore);
            }
          }, 300);
          
          return () => clearInterval(interval);
        }, 1500);
        
        return () => {
          clearTimeout(timer);
          scoreAnimatingRef.current = false;
        };
      }
    }, [isAbsence, player?.uuid, animation.pointsLost]);
    
    // Reset al cambiar de animación
    React.useEffect(() => {
      setLocalAnimatedScore(null);
      scoreAnimatingRef.current = false;
    }, [currentAnimationIndex]);
    
    return (
      // Centrado perfecto: flex con center en ambos ejes
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100%',
        padding: '20px',
        boxSizing: 'border-box',
      }}>
        <style>
          {`
            @keyframes slideInFromLeft {
              0% {
                transform: translateX(-100%) scale(0.9);
                opacity: 0;
              }
              100% {
                transform: translateX(0) scale(0.9);
                opacity: 1;
              }
            }
            @keyframes titleFadeIn {
              0% {
                opacity: 0;
                transform: translateY(-20px);
              }
              100% {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @keyframes emojiZoomIn {
              0% {
                opacity: 0;
                transform: scale(0);
              }
              100% {
                opacity: 1;
                transform: scale(1);
              }
            }
          `}
        </style>
        
        {/* Contenedor central compacto - elementos más juntos */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '500px',
          maxWidth: '400px',
          width: '100%',
        }}>
          
          {/* Título del badge - reducido margen inferior */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '15px',
            textAlign: 'center',
            width: '100%',
          }}>
            <div style={{
              color: '#FFD700',
              fontSize: '32px',
              fontWeight: '700',
              fontFamily: "'Oswald', Arial, sans-serif",
              animation: 'titleFadeIn 0.8s ease-out 0.2s both',
              lineHeight: '0',
              wordWrap: 'break-word',
              maxWidth: '100%',
            }}>
              {animation.badgeType === 'mvp' ? 'MVP' : 
                animation.badgeType === 'guante_dorado' ? 'GUANTE DORADO' : 
                  animation.badgeType === 'tarjeta_roja' ? 'TARJETA ROJA' :
                    animation.badgeType === 'ausencia_injustificada' ? 'AUSENCIAS INJUSTIFICADAS' : animation.badgeText}
            </div>
          </div>
          
          {/* ProfileCard - margen reducido */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '0px',
          }}>
            {player && (
              <div style={{ 
                pointerEvents: 'none',
                opacity: 1,
                transition: 'none',
                transform: 'scale(0.9)',
                animation: 'slideInFromLeft 0.8s ease-out 0.4s both',
              }}>
                <ProfileCard 
                  profile={{
                    ...player,
                    puntuacion: isAbsence && localAnimatedScore !== null ? localAnimatedScore : player.puntuacion,
                  }}
                  enableTilt={false}
                  isVisible={true}
                />
              </div>
            )}
          </div>
          
          {/* Emoji - margen muy reducido */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '5px',
          }}>
            <div style={{
              fontSize: '55px',
              animation: 'emojiZoomIn 0.6s ease-out 1.2s both',
            }}>
              {animation.badgeIcon}
            </div>
          </div>
          
          {/* Texto de puntos penalizados - pegado al emoji */}
          {isAbsence && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{
                color: '#FFD700',
                fontSize: '24px',
                fontWeight: '700',
                fontFamily: "'Oswald', Arial, sans-serif",
                animation: 'titleFadeIn 0.8s ease-out 2s both',
              }}>
                {animation.pointsLost} PUNTOS
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">Cargando...</div>
        </div>
      </div>
    );
  }

  if (yaCalificado) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">YA CALIFICASTE</div>
          <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
            Ya has calificado este partido.<br />¡Gracias por tu participación!
          </div>
          <button className="voting-confirm-btn" onClick={() => navigate('/')}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }

  if (!partido) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">PARTIDO NO ENCONTRADO</div>
          <button className="voting-confirm-btn" onClick={() => navigate('/')}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg">
      {/* Overlay de animaciones - centrado perfecto */}
      {showingBadgeAnimations && (
        <div className="badge-animations-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Título principal - centrado horizontal, fijo arriba */}
          <div style={{
            position: 'absolute',
            top: '40px',
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}>
            <div className="voting-title-modern">
              PREMIOS Y PENALIZACIONES
            </div>
          </div>
          
          {/* Contenedor de animaciones - centrado vertical y horizontal */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
          }}>
            {/* Mostrar animación siempre mientras el overlay esté activo */}
            {badgeAnimations.length > 0 && (
              <BadgeAnimation animations={badgeAnimations} />
            )}
          </div>
          
          {/* Botón ACEPTAR - solo aparece cuando termina la última animación */}
          {animationComplete && (
            <button 
              className="voting-confirm-btn"
              onClick={handleAcceptAnimations}
              style={{
                position: 'absolute',
                bottom: '50px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1002,
                width: '300px',
                maxWidth: '90vw',
              }}
            >
              ACEPTAR
            </button>
          )}
        </div>
      )}
      
      <div className="voting-modern-card">
        {currentStep === 0 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿SE JUGÓ EL PARTIDO?
            </div>
            <div style={{ color: '#fff', fontSize: 20, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
              {formatFecha(partido.fecha)}<br />
              {partido.hora && `${partido.hora} - `}{partido.sede ? partido.sede.split(/[,(]/)[0].trim() : 'Sin ubicación'}
            </div>
            <div className="player-select-grid">
              <button
                className={`player-select-btn${formData.se_jugo ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('se_jugo', true);
                  setCurrentStep(1);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                SÍ
              </button>
              <button
                className={`player-select-btn${!formData.se_jugo ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('se_jugo', false);
                  setCurrentStep(10);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿ASISTIERON TODOS?
            </div>
            <div className="player-select-grid">
              <button
                className="player-select-btn"
                onClick={() => {
                  handleInputChange('asistieron_todos', true);
                  setCurrentStep(2);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                SÍ
              </button>
              <button
                className="player-select-btn"
                onClick={() => {
                  handleInputChange('asistieron_todos', false);
                  setCurrentStep(12);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿QUIÉN FUE EL MEJOR JUGADOR?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => handleInputChange('mvp_id', jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.mvp_id === jugador.uuid ? '#00D49B' : '#2a2a40',
                    border: formData.mvp_id === jugador.uuid ? '1px solid #00D49B' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(3)}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 3 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿QUIÉN FUE EL MEJOR ARQUERO?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => handleInputChange('arquero_id', jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.arquero_id === jugador.uuid ? '#FFD700' : '#2a2a40',
                    border: formData.arquero_id === jugador.uuid ? '1px solid #FFD700' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
              <button
                className="player-select-btn"
                onClick={() => {
                  handleInputChange('arquero_id', '');
                  setCurrentStep(4);
                }}
                style={{
                  backgroundColor: 'rgba(255, 87, 34, 0.3)',
                  borderColor: '#fff',
                  borderRadius: '12px',
                  width: '90%',
                }}
              >
                NO HUBO ARQUEROS FIJOS
              </button>
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(4)}
              style={{ marginTop: '10px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 4 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿FUE UN PARTIDO LIMPIO?
            </div>
            <div className="player-select-grid">
              <button
                className={`player-select-btn${formData.partido_limpio ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('partido_limpio', true);
                  setCurrentStep(5);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                SÍ
              </button>
              <button
                className={`player-select-btn${!formData.partido_limpio ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('partido_limpio', false);
                  setCurrentStep(6);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿QUIÉN GANÓ?
            </div>
            <div className="player-select-grid">
              <button
                className={`player-select-btn${formData.ganador === 'equipo_a' ? ' selected' : ''}`}
                onClick={() => handleInputChange('ganador', 'equipo_a')}
                type="button"
                style={{
                  backgroundColor: formData.ganador === 'equipo_a' ? '#9C27B0' : 'rgba(156, 39, 176, 0.3)',
                  borderColor: '#fff',
                  borderRadius: '12px',
                }}
              >
                EQUIPO A
              </button>
              <button
                className={`player-select-btn${formData.ganador === 'equipo_b' ? ' selected' : ''}`}
                onClick={() => handleInputChange('ganador', 'equipo_b')}
                type="button"
                style={{
                  backgroundColor: formData.ganador === 'equipo_b' ? '#FF9800' : 'rgba(255, 152, 0, 0.3)',
                  borderColor: '#fff',
                  borderRadius: '12px',
                }}
              >
                EQUIPO B
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginBottom: '20px' }}>
              <input
                type="text"
                className="input-modern"
                style={{ 
                  width: '90%', 
                  padding: '15px',
                  textAlign: 'center',
                  fontFamily: "'Oswald', Arial, sans-serif",
                  backgroundColor: '#2a2a40',
                  border: '1px solid #444',
                  borderRadius: '8px',
                  color: 'white',
                }}
                value={formData.resultado || ''}
                onChange={(e) => handleInputChange('resultado', e.target.value)}
                placeholder="¿Te acordás cómo salió?"
              />
            </div>
            <button
              className="voting-confirm-btn"
              onClick={handleSubmit}
              style={{ marginTop: '20px' }}
            >
              FINALIZAR ENCUESTA
            </button>
          </div>
        )}

        {currentStep === 6 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿QUIÉN JUGÓ SUCIO?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => toggleJugadorViolento(jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.jugadores_violentos.includes(jugador.uuid) ? '#DE1C49' : '#2a2a40',
                    border: formData.jugadores_violentos.includes(jugador.uuid) ? '1px solid #DE1C49' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(5)}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 10 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿POR QUÉ NO SE JUGÓ?
            </div>
            <textarea
              className="input-modern"
              style={{ 
                width: '90%', 
                height: '80px', 
                resize: 'none',
                marginBottom: '20px',
                padding: '15px',
                textAlign: 'center',
                fontFamily: "'Oswald', Arial, sans-serif",
              }}
              value={formData.motivo_no_jugado || ''}
              onChange={(e) => handleInputChange('motivo_no_jugado', e.target.value)}
              placeholder="Explica por qué no se pudo jugar..."
              rows={2}
            />
            <button
              className="player-select-btn"
              onClick={() => setCurrentStep(11)}
              style={{
                backgroundColor: '#DE1C49',
                marginBottom: '15px',
                width: '90%',
              }}
            >
              AUSENCIA SIN AVISO
            </button>
            <button
              className="voting-confirm-btn"
              onClick={handleSubmit}
            >
              FINALIZAR
            </button>
          </div>
        )}

        {currentStep === 11 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              SELECCIONA JUGADORES AUSENTES
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => toggleJugadorAusente(jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.jugadores_ausentes.includes(jugador.uuid) ? '#DE1C49' : '#2a2a40',
                    border: formData.jugadores_ausentes.includes(jugador.uuid) ? '1px solid #DE1C49' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={handleSubmit}
              style={{ marginTop: '20px' }}
            >
              FINALIZAR
            </button>
          </div>
        )}

        {currentStep === 12 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿QUIÉNES FALTARON?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => toggleJugadorAusente(jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.jugadores_ausentes.includes(jugador.uuid) ? '#DE1C49' : '#2a2a40',
                    border: formData.jugadores_ausentes.includes(jugador.uuid) ? '1px solid #DE1C49' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(2)}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 99 && (
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¡GRACIAS POR FINALIZAR LA ENCUESTA!
            </div>
            <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
              En 6 horas publicaremos los resultados
            </div>
            <button 
              className="voting-confirm-btn"
              onClick={() => navigate('/')}
            >
              VOLVER AL INICIO
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EncuestaPartido;