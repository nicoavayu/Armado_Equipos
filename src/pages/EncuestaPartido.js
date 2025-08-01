import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, checkPartidoCalificado } from '../supabase';
import { processAbsenceWithoutNotice } from '../utils/matchStatsManager';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import { useBadges } from '../context/BadgeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import '../VotingView.css';

/**
 * Página de encuesta post-partido
 * Permite al usuario calificar un partido en el que participó
 */
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
    jugador_sucio_id: '',
    comentarios: '',
    motivo_no_jugado: '',
    ganador: '',
    resultado: '',
  });
  const [jugadores, setJugadores] = useState([]);
  const [yaCalificado, setYaCalificado] = useState(false);
  const [showingBadgeAnimations, setShowingBadgeAnimations] = useState(false);
  const [badgeAnimations, setBadgeAnimations] = useState([]);
  const [showAcceptButton, setShowAcceptButton] = useState(false);

  // Cargar datos del partido y verificar si ya fue calificado
  useEffect(() => {
    const fetchPartidoData = async () => {
      if (!partidoId || !user) {
        navigate('/');
        return;
      }
      
      try {
        setLoading(true);
        
        // Verificar si ya calificó este partido
        const calificado = await checkPartidoCalificado(partidoId, user.id);
        if (calificado) {
          setYaCalificado(true);
          toast.info('Ya has calificado este partido');
          return;
        }
        
        // Obtener datos del partido
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
        
        // Extraer jugadores del partido
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

  // Manejar cambios en el formulario
  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };
  
  // Avanzar al siguiente paso con animación
  const nextStep = () => {
    if (animating) return;
    setAnimating(true);
    setTimeout(() => {
      setCurrentStep((prev) => prev + 1);
      setAnimating(false);
    }, 200);
  };

  // Manejar selección/deselección de jugadores ausentes
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

  // Manejar selección/deselección de jugadores violentos
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

  // Manejar aceptar animaciones y continuar
  const handleAcceptAnimations = async () => {
    setShowingBadgeAnimations(false);
    setShowAcceptButton(false);
    setBadgeAnimations([]);
    
    // Continuar con el resto del flujo de envío
    await continueSubmitFlow();
  };

  // Función para actualizar ranking de usuario
  const updatePlayerRanking = async (playerId, change) => {
    try {
      console.log('[RANKING_UPDATE] Updating ranking for player:', { playerId, change });
      
      // Get current ranking from usuarios table
      const { data: user, error: fetchError } = await supabase
        .from('usuarios')
        .select('ranking')
        .eq('id', playerId)
        .single();
      
      if (fetchError) {
        console.error('[RANKING_UPDATE] Error fetching user:', fetchError);
        return;
      }
      
      const currentRanking = user?.ranking || 5.0;
      const newRanking = Math.max(1.0, Math.min(10.0, currentRanking + change));
      
      console.log('[RANKING_UPDATE] Ranking change:', { 
        playerId, 
        currentRanking, 
        change, 
        newRanking 
      });
      
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ ranking: newRanking })
        .eq('id', playerId);
      
      if (updateError) {
        console.error('[RANKING_UPDATE] Error updating ranking:', updateError);
      } else {
        console.log('[RANKING_UPDATE] Ranking updated successfully');
        // Trigger badge refresh to update profile data
        triggerBadgeRefresh();
      }
    } catch (error) {
      console.error('[RANKING_UPDATE] Error updating player ranking:', error);
    }
  };

  // Continuar con el flujo de envío después de las animaciones
  const continueSubmitFlow = async () => {
    try {
      // Lógica de guardado de datos...
      const surveyData = {
        partido_id: parseInt(partidoId),
        se_jugo: formData.se_jugo,
        motivo_no_jugado: formData.motivo_no_jugado || null,
        asistieron_todos: formData.asistieron_todos,
        jugadores_ausentes: formData.jugadores_ausentes,
        partido_limpio: formData.partido_limpio,
        jugadores_violentos: formData.jugadores_violentos,
        mejor_jugador_eq_a: null,
        mejor_jugador_eq_b: null,
        mejor_arquero: null,
        no_hubo_arqueros: false,
        created_at: new Date().toISOString(),
      };
      
      // Procesar ausencias sin aviso
      if (formData.jugadores_ausentes.length > 0) {
        for (const jugadorId of formData.jugadores_ausentes) {
          try {
            await processAbsenceWithoutNotice(jugadorId, parseInt(partidoId), user.id);
          } catch (error) {
            console.error('Error processing absence without notice:', error);
          }
        }
      }
      
      // Guardar encuesta
      const { error } = await supabase
        .from('post_match_surveys')
        .insert([surveyData]);
        
      if (error) throw error;
      
      // Actualizar historial del partido con ganador y resultado
      if (formData.se_jugo && (formData.ganador || formData.resultado)) {
        const updateData = {};
        if (formData.ganador) updateData.ganador = formData.ganador;
        if (formData.resultado) updateData.resultado = formData.resultado;
        
        const { error: updateError } = await supabase
          .from('partidos')
          .update(updateData)
          .eq('id', partidoId);
          
        if (updateError) {
          console.error('Error actualizando historial del partido:', updateError);
        }
      }
      
      // Guardar premios si se seleccionaron
      const premios = [];
      
      console.log('[BADGES] Form data:', formData);
      
      if (formData.mvp_id) {
        premios.push({
          jugador_id: formData.mvp_id,
          partido_id: parseInt(partidoId),
          award_type: 'mvp'
        });
        
        // Actualizar contador MVP en usuarios
        const { error: mvpError } = await supabase.rpc('increment_mvps', {
          user_id: formData.mvp_id
        });
        if (mvpError) {
          console.error('[BADGES] Error incrementing MVP:', mvpError);
        }
      }
      
      if (formData.arquero_id) {
        premios.push({
          jugador_id: formData.arquero_id,
          partido_id: parseInt(partidoId),
          award_type: 'guante_dorado'
        });
        
        // Actualizar contador guante dorado en usuarios
        const { error: gkError } = await supabase.rpc('increment_golden_gloves', {
          user_id: formData.arquero_id
        });
        if (gkError) {
          console.error('[BADGES] Error incrementing golden gloves:', gkError);
        }
      }
      
      if (formData.jugadores_violentos.length > 0) {
        for (const jugadorId of formData.jugadores_violentos) {
          premios.push({
            jugador_id: jugadorId,
            partido_id: parseInt(partidoId),
            award_type: 'tarjeta_roja'
          });
          
          // Actualizar contador tarjetas rojas en usuarios
          const { error: redCardError } = await supabase.rpc('increment_red_cards', {
            user_id: jugadorId
          });
          if (redCardError) {
            console.error('[BADGES] Error incrementing red cards:', redCardError);
          }
        }
      }
      
      console.log('[BADGES] Premios to insert:', premios);
      
      if (premios.length > 0) {
        const { data: insertedPremios, error: premiosError } = await supabase
          .from('player_awards')
          .insert(premios)
          .select();
          
        if (premiosError) {
          console.error('[BADGES] Error guardando premios:', premiosError);
        } else {
          console.log('[BADGES] Premios guardados exitosamente:', insertedPremios);
          // Trigger badge refresh for all components
          triggerBadgeRefresh();
        }
      } else {
        console.log('[BADGES] No hay premios para guardar');
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

  // Enviar encuesta
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user || !partidoId) {
      toast.error('Debes iniciar sesión para calificar un partido');
      return;
    }
    
    setSubmitting(true);
    
    // Preparar animaciones de badges solo si se jugó el partido
    const animations = [];
    if (formData.se_jugo) {
      if (formData.mvp_id) {
        const player = jugadores.find(j => j.uuid === formData.mvp_id);
        if (player) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'mvp',
            badgeText: 'MVP',
            badgeIcon: '🏆'
          });
        }
      }
      if (formData.arquero_id) {
        const player = jugadores.find(j => j.uuid === formData.arquero_id);
        if (player) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'guante_dorado',
            badgeText: 'GUANTE DORADO',
            badgeIcon: '🧤'
          });
        }
      }
      if (formData.jugadores_violentos.length > 0) {
        formData.jugadores_violentos.forEach(jugadorId => {
          const player = jugadores.find(j => j.uuid === jugadorId);
          if (player) {
            animations.push({
              playerName: player.nombre,
              playerAvatar: player.avatar_url || player.foto_url,
              badgeType: 'tarjeta_roja',
              badgeText: 'TARJETA ROJA',
              badgeIcon: '🟥'
            });
          }
        });
      }
    }
    
    // Mostrar animaciones si hay badges
    if (animations.length > 0) {
      console.log('[BADGE_ANIMATIONS] Showing animations:', animations);
      setBadgeAnimations(animations);
      setShowingBadgeAnimations(true);
      
      // Mostrar botón de aceptar después de las animaciones
      setTimeout(() => {
        setShowAcceptButton(true);
      }, 2000); // 2 segundos para que terminen las animaciones
      
      // Esperar a que el usuario presione aceptar
      return;
    } else {
      console.log('[BADGE_ANIMATIONS] No animations to show');
      // Si no hay animaciones, continuar directamente
      await continueSubmitFlow();
    }
  };

  // Formatear fecha para mostrar
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
    return (
      <div className="badge-all-awards">
        {animations.map((animation, index) => (
          <div key={index} className={`badge-award-item badge-${animation.badgeType}`}>
            <div className="badge-player-card">
              <div className="badge-player-avatar">
                {animation.playerAvatar ? (
                  <img src={animation.playerAvatar} alt={animation.playerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div className="badge-avatar-placeholder" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '24px', fontWeight: '600' }}>
                    {animation.playerName.charAt(0)}
                  </div>
                )}
              </div>
              <div className="badge-player-info">
                <div className="badge-award-text">{animation.badgeText}</div>
                <div className="badge-player-name">{animation.playerName}</div>
              </div>
            </div>
            <div className="badge-animation-icon">{animation.badgeIcon}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <>
        {showingBadgeAnimations && (
          <div className="badge-animations-overlay">
            <div className="badge-carousel-container">
              <BadgeAnimation animations={badgeAnimations} />
            </div>
            {showAcceptButton && (
              <button 
                className="badge-accept-btn"
                onClick={handleAcceptAnimations}
              >
                <span>ACEPTAR</span>
              </button>
            )}
          </div>
        )}
        <div className="voting-bg">
          <div className="voting-modern-card">
            <div className="voting-title-modern">Cargando...</div>
          </div>
        </div>
      </>
    );
  }

  if (yaCalificado) {
    return (
      <>
        {showingBadgeAnimations && (
          <div className="badge-animations-overlay">
            <div className="badge-carousel-container">
              <BadgeAnimation animations={badgeAnimations} />
            </div>
            {showAcceptButton && (
              <button 
                className="badge-accept-btn"
                onClick={handleAcceptAnimations}
              >
                <span>ACEPTAR</span>
              </button>
            )}
          </div>
        )}
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
      </>
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

  // Paso 0: Confirmación del partido
  if (currentStep === 0) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
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
                  setCurrentStep(10); // Ir al paso de motivo
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 1: ¿ASISTIERON TODOS?
  if (currentStep === 1) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿ASISTIERON TODOS?
            </div>
            <div className="player-select-grid">
              <button
                className="player-select-btn"
                onClick={() => {
                  handleInputChange('asistieron_todos', true);
                  setCurrentStep(2); // Ir al paso 2 (mejor jugador)
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
                  setCurrentStep(12); // Ir a seleccionar ausentes
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 2: ¿QUIÉN FUE EL MEJOR JUGADOR?
  if (currentStep === 2) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
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
                    minHeight: '90px'
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0
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
                        fontWeight: '600'
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
                    width: '100%'
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                setCurrentStep(3); // Ir al paso 3 (mejor arquero)
              }}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 3: ¿QUIÉN FUE EL MEJOR ARQUERO?
  if (currentStep === 3) {
    const arqueros = jugadores.filter(j => j.position === 'arquero' || j.posicion === 'arquero');
    const jugadoresParaArquero = arqueros.length > 0 ? arqueros : jugadores;
    
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿QUIÉN FUE EL MEJOR ARQUERO?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadoresParaArquero.map((jugador) => (
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
                    minHeight: '90px'
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0
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
                        fontWeight: '600'
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
                    width: '100%'
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
                  width: '90%'
                }}
              >
                NO HUBO ARQUEROS FIJOS
              </button>
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                setCurrentStep(4); // Ir al paso 4 (¿FUE LIMPIO?)
              }}
              style={{ marginTop: '10px' }}
            >
              SIGUIENTE
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 4: ¿FUE UN PARTIDO LIMPIO?
  if (currentStep === 4) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-title-modern">
              ¿FUE UN PARTIDO LIMPIO?
            </div>
            <div className="player-select-grid">
              <button
                className={`player-select-btn${formData.partido_limpio ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('partido_limpio', true);
                  setCurrentStep(5); // Ir al paso 5 (¿Quién ganó?)
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
                  setCurrentStep(6); // Ir a jugadores sucios
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 5: ¿QUIÉN GANÓ?
  if (currentStep === 5) {
    return (
      <div className="voting-bg">
        {showingBadgeAnimations && (
          <div className="badge-animations-overlay">
            <div className="badge-carousel-container">
              <BadgeAnimation animations={badgeAnimations} />
            </div>
            {showAcceptButton && (
              <button 
                className="badge-accept-btn"
                onClick={handleAcceptAnimations}
              >
                <span>ACEPTAR</span>
              </button>
            )}
          </div>
        )}
        <div className="voting-modern-card">
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
                  borderRadius: '12px'
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
                  borderRadius: '12px'
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
                  color: 'white'
                }}
                value={formData.resultado || ''}
                onChange={(e) => handleInputChange('resultado', e.target.value)}
                placeholder="¿Te acordás cómo salió?"
              />
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                handleSubmit({ preventDefault: () => {} });
              }}
              style={{ marginTop: '20px' }}
            >
              FINALIZAR ENCUESTA
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 6: Seleccionar jugadores sucios (solo si no fue limpio)
  if (currentStep === 6) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
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
                    minHeight: '90px'
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0
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
                        fontWeight: '600'
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
                    width: '100%'
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                setCurrentStep(5); // Ir al paso 5 (¿Quién ganó?)
              }}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 10: Motivo por no jugarse (cuando se_jugo = false)
  if (currentStep === 10) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
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
                fontFamily: "'Oswald', Arial, sans-serif"
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
                width: '90%'
              }}
            >
              AUSENCIA SIN AVISO
            </button>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                handleSubmit({ preventDefault: () => {} });
              }}
            >
              FINALIZAR
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 11: Seleccionar jugadores ausentes sin aviso
  if (currentStep === 11) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
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
                    minHeight: '90px'
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0
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
                        fontWeight: '600'
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
                    width: '100%'
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                handleSubmit({ preventDefault: () => {} });
              }}
              style={{ marginTop: '20px' }}
            >
              FINALIZAR
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso 12: Seleccionar jugadores ausentes (cuando se jugó pero faltaron)
  if (currentStep === 12) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
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
                    minHeight: '90px'
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0
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
                        fontWeight: '600'
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
                    width: '100%'
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                setCurrentStep(2); // Ir al paso 2 (mejor jugador)
              }}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Paso final: Enviar
  if (currentStep === 99) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">
            ¡GRACIAS POR CALIFICAR!
          </div>
          <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
            Tu calificación ha sido registrada.
          </div>
          <button 
            className="voting-confirm-btn"
            onClick={() => navigate('/')}
          >
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }
  
  // Si llegamos aquí, enviar la encuesta
  handleSubmit({ preventDefault: () => {} });
  return null;

};

export default EncuestaPartido;