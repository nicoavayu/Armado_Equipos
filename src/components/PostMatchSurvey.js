import React, { useState, useEffect } from 'react';
import { supabase, processPostMatchSurveys, checkSurveysProcessed, markSurveysAsProcessed } from '../supabase';
import { useAuth } from './AuthProvider';
import { toast } from 'react-toastify';
import './PostMatchSurvey.css';

/**
 * Componente de encuesta post-partido con interfaz adaptable para móviles
 * Muestra una encuesta para que los jugadores completen después de un partido
 */
const PostMatchSurvey = ({ partido, onClose, onSubmit }) => {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [survey, setSurvey] = useState({
    se_jugo: true,
    motivo_no_jugado: '',
    asistieron_todos: true,
    jugadores_ausentes: [],
    mejor_jugador_eq_a: null,
    mejor_jugador_eq_b: null,
    mejor_arquero: null,
    no_hubo_arqueros: false,
    partido_limpio: true,
    jugadores_violentos: [],
  });

  // Dividir jugadores en equipos
  const [equipoA, setEquipoA] = useState([]);
  const [equipoB, setEquipoB] = useState([]);
  const [arqueros, setArqueros] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (partido && partido.jugadores) {
      setAllPlayers(partido.jugadores || []);
      if (partido.equipos && partido.equipos.length === 2) {
        setEquipoA(partido.equipos[0].jugadores || []);
        setEquipoB(partido.equipos[1].jugadores || []);
      } else {
        const mitad = Math.ceil((partido.jugadores.length || 0) / 2);
        setEquipoA(partido.jugadores.slice(0, mitad) || []);
        setEquipoB(partido.jugadores.slice(mitad) || []);
      }
      setArqueros(partido.jugadores.filter((j) => j.position === 'arquero') || []);
    }
  }, [partido]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSurvey((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handlePlayerSelection = (field, playerId) => {
    setSurvey((prev) => ({
      ...prev,
      [field]: playerId,
    }));
  };

  const toggleAbsentPlayer = (playerId) => {
    setSurvey((prev) => {
      const currentSet = new Set(prev.jugadores_ausentes);
      if (currentSet.has(playerId)) {
        currentSet.delete(playerId);
      } else {
        currentSet.add(playerId);
      }
      return {
        ...prev,
        jugadores_ausentes: Array.from(currentSet),
      };
    });
  };

  const toggleViolentPlayer = (playerId) => {
    setSurvey((prev) => {
      const currentSet = new Set(prev.jugadores_violentos);
      if (currentSet.has(playerId)) {
        currentSet.delete(playerId);
      } else {
        currentSet.add(playerId);
      }
      return {
        ...prev,
        jugadores_violentos: Array.from(currentSet),
      };
    });
  };

  // Función simple para avanzar al siguiente paso
  const nextStep = () => {
    setStep(step + 1);
  };
  
  // Función para avanzar con lógica condicional basada en el estado actual
  const handleNavigation = () => {
    switch (step) {
      case 0: // Después de responder si se jugó
        if (survey.se_jugo) {
          setStep(2); // Ir a asistencia
        } else {
          setStep(1); // Ir a motivo
        }
        break;
        
      case 1: // Después de ingresar motivo
        if (!survey.se_jugo) {
          // Si el partido no se jugó, finalizar encuesta
          handleSubmit();
        }
        break;
        
      case 2: // Después de responder asistencia
        if (survey.asistieron_todos) {
          setStep(4); // Saltar selección de ausentes
        } else {
          setStep(3); // Ir a selección de ausentes
        }
        break;
        
      case 3: // Después de seleccionar ausentes
        setStep(4); // Ir a mejor jugador equipo A
        break;
        
      case 4: // Después de mejor jugador equipo A
        setStep(5); // Ir a mejor jugador equipo B
        break;
        
      case 5: // Después de mejor jugador equipo B
        if (arqueros.length === 0) {
          setStep(7); // Si no hay arqueros, saltar a partido limpio
        } else {
          setStep(6); // Ir a mejor arquero
        }
        break;
        
      case 6: // Después de mejor arquero
        setStep(7); // Ir a partido limpio
        break;
        
      case 7: // Después de responder partido limpio
        if (survey.partido_limpio) {
          setStep(9); // Saltar selección de violentos
        } else {
          setStep(8); // Ir a selección de violentos
        }
        break;
        
      case 8: // Después de seleccionar violentos
        setStep(9); // Ir a finalizar
        break;
        
      case 9: // Finalizar encuesta
        handleSubmit();
        break;
        
      default:
        nextStep(); // Avance normal
    }
  };

  const prevStep = () => {
    if (step === 9 && survey.partido_limpio) {
      setStep(7);
    } else if (step === 9 && !survey.partido_limpio) {
      setStep(8);
    } else if (step === 8) {
      setStep(7);
    } else if (step === 7) {
      setStep(6);
    } else if (step === 6 && arqueros.length === 0) {
      setStep(5);
    } else if (step === 5) {
      setStep(4);
    } else if (step === 4) {
      if (!survey.asistieron_todos) setStep(3);
      else setStep(2);
    } else if (step === 3) {
      setStep(2);
    } else if (step === 2) {
      setStep(0);
    } else if (step === 1) {
      setStep(0);
    } else {
      setStep(Math.max(0, step - 1));
    }
  };

  const isFormValid = () => {
    if (!survey.se_jugo) {
      return survey.motivo_no_jugado.trim().length > 0;
    }
    if (!survey.asistieron_todos && survey.jugadores_ausentes.length === 0) {
      return false;
    }
    if (!survey.partido_limpio && survey.jugadores_violentos.length === 0) {
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!user || !partido) return;
    setSubmitting(true);
    try {
      // Submit survey
      const { error } = await supabase
        .from('post_match_surveys')
        .insert({
          partido_id: partido.id,
          votante_id: user.id,
          ...survey,
        });
      if (error) throw error;

      // Mark notification as read
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('type', 'post_match_survey')
        .eq('match_id', partido.id);

      // Check if this is the last survey needed and process if so
      try {
        const alreadyProcessed = await checkSurveysProcessed(partido.id);
        if (!alreadyProcessed) {
          // Get total surveys count to see if we should process
          const { data: allSurveys } = await supabase
            .from('post_match_surveys')
            .select('id')
            .eq('partido_id', partido.id);
            
          // Process surveys if we have at least 3 responses or if match has been completed for a while
          if (allSurveys && allSurveys.length >= 3) {
            console.log('[SURVEY] Processing surveys with', allSurveys.length, 'responses');
            await processPostMatchSurveys(partido.id);
            await markSurveysAsProcessed(partido.id);
            toast.success('¡Estadísticas de jugadores actualizadas!');
          }
        }
      } catch (processError) {
        console.error('Error processing surveys:', processError);
        // Don't show error to user as survey was submitted successfully
      }

      toast.success('¡Encuesta enviada con éxito!');
      setCompleted(true);
      setStep(10);
      setTimeout(() => {
        if (onSubmit) onSubmit();
        if (onClose) onClose();
      }, 3000);
    } catch (error) {
      toast.error('Error al enviar la encuesta: ' + error.message);
      setSubmitting(false);
    }
  };

  // Componente mini tarjeta de jugador
  const PlayerCardMini = ({ player, selected, onClick }) => {
    const playerId = player.uuid || player.id;
    return (
      <div 
        className={`survey-player-card ${selected ? 'selected' : ''}`}
        onClick={() => onClick(playerId)}
      >
        <div className="survey-player-photo">
          {player.avatar_url ? (
            <img src={player.avatar_url} alt={player.nombre} />
          ) : (
            <div className="survey-player-photo-placeholder">
              <svg viewBox="0 0 24 24" fill="#999">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </div>
          )}
        </div>
        <div className="survey-player-name">{player.nombre}</div>
      </div>
    );
  };

  // Render del paso actual
  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Se jugó el partido?</h2>
            <div className="survey-options">
              <button 
                className={`survey-option-btn ${survey.se_jugo ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, se_jugo: true }))}
              >Sí</button>
              <button 
                className={`survey-option-btn ${!survey.se_jugo ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, se_jugo: false }))}
              >No</button>
            </div>
            <div className="survey-nav-buttons">
              <button 
                className="survey-nav-btn next" 
                onClick={handleNavigation}
              >
                Siguiente
              </button>
            </div>
          </div>
        );
      case 1:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">Motivo por el que no se jugó:</h2>
            <div className="survey-text-input">
              <textarea
                name="motivo_no_jugado"
                value={survey.motivo_no_jugado}
                onChange={handleChange}
                placeholder="Explica brevemente por qué no se jugó el partido"
              />
            </div>
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button
                className="survey-submit-btn"
                onClick={handleNavigation}
                disabled={submitting || !survey.motivo_no_jugado.trim()}
              >
                {submitting ? 'Enviando...' : 'Enviar encuesta'}
              </button>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Asistieron todos los jugadores?</h2>
            <div className="survey-options">
              <button 
                className={`survey-option-btn ${survey.asistieron_todos ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, asistieron_todos: true, jugadores_ausentes: [] }))}
              >Sí</button>
              <button 
                className={`survey-option-btn ${!survey.asistieron_todos ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, asistieron_todos: false }))}
              >No</button>
            </div>
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button 
                className="survey-nav-btn next" 
                onClick={handleNavigation}
              >
                Siguiente
              </button>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Quiénes faltaron?</h2>
            <p className="survey-instruction">Selecciona todos los jugadores que no asistieron</p>
            <div className="survey-players-grid">
              {allPlayers.map((player) => (
                <PlayerCardMini
                  key={player.uuid || player.id}
                  player={player}
                  selected={survey.jugadores_ausentes.includes(player.uuid || player.id)}
                  onClick={toggleAbsentPlayer}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button
                className="survey-nav-btn next"
                onClick={handleNavigation}
                disabled={survey.jugadores_ausentes.length === 0}
              >
                Siguiente
              </button>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Quién fue el mejor jugador del equipo A?</h2>
            <div className="survey-players-grid">
              {equipoA.map((player) => (
                <PlayerCardMini
                  key={player.uuid || player.id}
                  player={player}
                  selected={survey.mejor_jugador_eq_a === (player.uuid || player.id)}
                  onClick={(playerId) => handlePlayerSelection('mejor_jugador_eq_a', playerId)}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button className="survey-nav-btn skip" onClick={handleNavigation}>Siguiente</button>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Quién fue el mejor jugador del equipo B?</h2>
            <div className="survey-players-grid">
              {equipoB.map((player) => (
                <PlayerCardMini
                  key={player.uuid || player.id}
                  player={player}
                  selected={survey.mejor_jugador_eq_b === (player.uuid || player.id)}
                  onClick={(playerId) => handlePlayerSelection('mejor_jugador_eq_b', playerId)}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button className="survey-nav-btn skip" onClick={handleNavigation}>Siguiente</button>
            </div>
          </div>
        );
      case 6:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Quién fue el mejor arquero del partido?</h2>
            {arqueros.length > 0 ? (
              <div className="survey-players-grid">
                {arqueros.map((player) => (
                  <PlayerCardMini
                    key={player.uuid || player.id}
                    player={player}
                    selected={survey.mejor_arquero === (player.uuid || player.id)}
                    onClick={(playerId) => handlePlayerSelection('mejor_arquero', playerId)}
                  />
                ))}
              </div>
            ) : (
              <div className="survey-no-options">
                <button 
                  className={`survey-option-btn ${survey.no_hubo_arqueros ? 'selected' : ''}`}
                  onClick={() => setSurvey((prev) => ({ ...prev, no_hubo_arqueros: !prev.no_hubo_arqueros }))}
                >No hubo arqueros fijos</button>
              </div>
            )}
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button className="survey-nav-btn skip" onClick={handleNavigation}>Siguiente</button>
            </div>
          </div>
        );
      case 7:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Fue un partido limpio?</h2>
            <div className="survey-options">
              <button 
                className={`survey-option-btn ${survey.partido_limpio ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, partido_limpio: true, jugadores_violentos: [] }))}
              >Sí</button>
              <button 
                className={`survey-option-btn ${!survey.partido_limpio ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, partido_limpio: false }))}
              >No</button>
            </div>
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button 
                className="survey-nav-btn next" 
                onClick={handleNavigation}
              >
                Siguiente
              </button>
            </div>
          </div>
        );
      case 8:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Quién tuvo mala actitud o fue violento?</h2>
            <p className="survey-instruction">Selecciona todos los jugadores que consideres</p>
            <div className="survey-players-grid">
              {allPlayers.map((player) => (
                <PlayerCardMini
                  key={player.uuid || player.id}
                  player={player}
                  selected={survey.jugadores_violentos.includes(player.uuid || player.id)}
                  onClick={toggleViolentPlayer}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button className="survey-nav-btn back" onClick={prevStep}>Atrás</button>
              <button
                className="survey-nav-btn next"
                onClick={handleNavigation}
                disabled={submitting || survey.jugadores_violentos.length === 0}
              >
                Siguiente
              </button>
            </div>
          </div>
        );
      case 9:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">Finalizar encuesta</h2>
            <div className="survey-submit-container">
              <p className="survey-final-message">Has completado todas las preguntas. Gracias por tu participación.</p>
              <button 
                className="survey-submit-btn" 
                onClick={handleSubmit}
                disabled={submitting || !isFormValid()}
              >
                {submitting ? 'Enviando...' : 'Enviar encuesta'}
              </button>
            </div>
          </div>
        );
      case 10:
        return (
          <div className="survey-step slide-in">
            <div className="survey-thank-you">
              <div className="thank-you-icon">✅</div>
              <h2 className="thank-you-title">¡Gracias por tu voto!</h2>
              <p className="thank-you-message">Esto ayuda a mejorar la comunidad.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="post-match-survey-fullscreen">
      <div className="post-match-survey-container">
        <div className="post-match-survey-header">
          <h1>📝 Encuesta post-partido</h1>
          {!completed && (
            <button className="close-button" onClick={onClose}>×</button>
          )}
        </div>
        <div className="post-match-survey-content">
          {renderStepContent()}
        </div>
        {!completed && (
          <div className="survey-progress-bar">
            <div 
              className="survey-progress-fill" 
              style={{ width: `${(step / 9) * 100}%` }}
            ></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PostMatchSurvey;
