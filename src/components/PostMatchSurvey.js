import React, { useState, useEffect } from 'react';
import { supabase, processPostMatchSurveys, checkSurveysProcessed, markSurveysAsProcessed } from '../supabase';
import { useAuth } from './AuthProvider';
import { useBadges } from '../context/BadgeContext';
import { processAbsenceWithoutNotice } from '../utils/matchStatsManager';
import { toast } from 'react-toastify';
import './PostMatchSurvey.css';

/**
 * Componente de encuesta post-partido siguiendo el flujo exacto especificado
 */
const PostMatchSurvey = ({ partido, onClose, onSubmit }) => {
  const { user } = useAuth();
  const { triggerBadgeRefresh } = useBadges();
  const [step, setStep] = useState(0);
  const [survey, setSurvey] = useState({
    se_jugo: null,
    motivo_no_jugado: '',
    asistieron_todos: null,
    jugadores_ausentes: [],
    mejor_jugador: null,
    mejor_arquero: null,
    partido_limpio: null,
    jugadores_violentos: [],
    ganador: null,
    resultado: '',
  });

  const [allPlayers, setAllPlayers] = useState([]);
  const [arqueros, setArqueros] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [showingBadgeAnimations, setShowingBadgeAnimations] = useState(false);
  const [badgeAnimations, setBadgeAnimations] = useState([]);

  useEffect(() => {
    if (partido && partido.jugadores) {
      setAllPlayers(partido.jugadores || []);
      setArqueros(partido.jugadores.filter((j) => j.position === 'arquero') || []);
    }
  }, [partido]);

  const togglePlayer = (field, playerId) => {
    setSurvey((prev) => {
      const currentSet = new Set(prev[field]);
      if (currentSet.has(playerId)) {
        currentSet.delete(playerId);
      } else {
        currentSet.add(playerId);
      }
      return { ...prev, [field]: Array.from(currentSet) };
    });
  };

  const updatePlayerRanking = async (playerId, change) => {
    try {
      console.log('[RANKING_UPDATE] Updating ranking for player:', { playerId, change });
      
      // Check if this player already has a ranking penalty for this match
      const { data: existingPenalty, error: penaltyCheckError } = await supabase
        .from('player_awards')
        .select('id')
        .eq('jugador_id', playerId)
        .eq('partido_id', partido.id)
        .eq('award_type', 'ranking_penalty')
        .single();
      
      if (penaltyCheckError && penaltyCheckError.code !== 'PGRST116') {
        console.error('[RANKING_UPDATE] Error checking existing penalty:', penaltyCheckError);
        return;
      }
      
      if (existingPenalty) {
        console.log('[RANKING_UPDATE] Player already has ranking penalty for this match, skipping');
        return;
      }
      
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
        newRanking, 
      });
      
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ ranking: newRanking })
        .eq('id', playerId);
      
      if (updateError) {
        console.error('[RANKING_UPDATE] Error updating ranking:', updateError);
        return;
      }
      
      // Record the penalty to prevent duplicates
      const { error: penaltyError } = await supabase
        .from('player_awards')
        .insert({
          jugador_id: playerId,
          partido_id: partido.id,
          award_type: 'ranking_penalty',
          otorgado_por: user.id,
        });
      
      if (penaltyError) {
        console.error('[RANKING_UPDATE] Error recording penalty:', penaltyError);
      } else {
        console.log('[RANKING_UPDATE] Ranking updated and penalty recorded successfully');
        // Trigger badge refresh to update profile data
        triggerBadgeRefresh();
      }
    } catch (error) {
      console.error('[RANKING_UPDATE] Error updating player ranking:', error);
    }
  };

  const addPlayerBadge = async (playerId, badgeType) => {
    try {
      console.log('[BADGE_INSERT] Adding badge:', { playerId, badgeType, partidoId: partido.id, votanteId: user.id });
      
      const { data, error } = await supabase
        .from('player_awards')
        .insert({
          jugador_id: playerId,
          partido_id: partido.id,
          award_type: badgeType,
          otorgado_por: user.id,
        })
        .select();
      
      if (error) {
        console.error('[BADGE_INSERT] Error:', error);
        throw error;
      }
      
      console.log('[BADGE_INSERT] Success:', data);
      // Trigger badge refresh for all components
      triggerBadgeRefresh();
    } catch (error) {
      console.error('[BADGE_INSERT] Failed to add badge:', error);
      throw error; // Re-throw to handle in calling function
    }
  };

  const handleSubmit = async () => {
    if (!user || !partido) return;
    setSubmitting(true);
    
    // Preparar animaciones de badges solo si se jugó el partido
    const animations = [];
    if (survey.se_jugo) {
      if (survey.mejor_jugador) {
        const player = allPlayers.find((p) => (p.uuid || p.id) === survey.mejor_jugador);
        if (player) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url,
            badgeType: 'mvp',
            badgeText: 'MVP',
            badgeIcon: '🏆',
          });
        }
      }
      if (survey.mejor_arquero) {
        const player = allPlayers.find((p) => (p.uuid || p.id) === survey.mejor_arquero);
        if (player) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url,
            badgeType: 'guante_dorado',
            badgeText: 'GUANTE DORADO',
            badgeIcon: '🥅',
          });
        }
      }
      if (survey.jugadores_violentos.length > 0) {
        survey.jugadores_violentos.forEach((playerId) => {
          const player = allPlayers.find((p) => (p.uuid || p.id) === playerId);
          if (player) {
            animations.push({
              playerName: player.nombre,
              playerAvatar: player.avatar_url,
              badgeType: 'tarjeta_roja',
              badgeText: 'TARJETA ROJA',
              badgeIcon: '🟥',
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
      
      // Esperar a que el usuario haga clic en aceptar
      await new Promise((resolve) => {
        window.badgeAnimationResolve = resolve;
      });
    } else {
      console.log('[BADGE_ANIMATIONS] No animations to show');
    }
    
    try {
      // Procesar ausencias sin aviso (partido no se jugó)
      if (!survey.se_jugo && survey.jugadores_ausentes.length > 0) {
        for (const playerId of survey.jugadores_ausentes) {
          try {
            await processAbsenceWithoutNotice(playerId, partido.id, user.id);
          } catch (error) {
            console.error('Error processing absence without notice (no match):', error);
          }
        }
      }
      
      // Procesar ausencias cuando se jugó
      if (survey.se_jugo && !survey.asistieron_todos && survey.jugadores_ausentes.length > 0) {
        for (const playerId of survey.jugadores_ausentes) {
          try {
            await processAbsenceWithoutNotice(playerId, partido.id, user.id);
          } catch (error) {
            console.error('Error processing absence without notice (match played):', error);
          }
        }
      }
      
      // Procesar MVP
      if (survey.mejor_jugador) {
        try {
          await addPlayerBadge(survey.mejor_jugador, 'mvp');
        } catch (error) {
          console.error('Error adding MVP badge:', error);
          // Continue with survey submission even if badge fails
        }
      }
      
      // Procesar Guante Dorado
      if (survey.mejor_arquero) {
        try {
          await addPlayerBadge(survey.mejor_arquero, 'guante_dorado');
        } catch (error) {
          console.error('Error adding Guante Dorado badge:', error);
          // Continue with survey submission even if badge fails
        }
      }
      
      // Procesar tarjetas rojas
      if (survey.jugadores_violentos.length > 0) {
        for (const playerId of survey.jugadores_violentos) {
          try {
            await addPlayerBadge(playerId, 'tarjeta_roja');
          } catch (error) {
            console.error('Error adding Tarjeta Roja badge:', error);
            // Continue with next player even if this badge fails
          }
        }
      }
      
      // Guardar encuesta
      const { error } = await supabase
        .from('post_match_surveys')
        .insert({
          partido_id: partido.id,
          votante_id: user.id,
          ...survey,
        });
      
      if (error) throw error;
      
      // Actualizar historial del partido
      if (survey.se_jugo) {
        const updateData = {};
        if (survey.ganador) updateData.ganador = survey.ganador;
        if (survey.resultado) updateData.resultado = survey.resultado;
        
        if (Object.keys(updateData).length > 0) {
          await supabase
            .from('partidos')
            .update(updateData)
            .eq('id', partido.id);
        }
      }
      
      // Marcar notificación como leída
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('type', 'post_match_survey')
        .eq('match_id', partido.id);
      
      toast.success('¡Encuesta enviada con éxito!');
      setCompleted(true);
      setStep(99);
      
      setTimeout(() => {
        if (onSubmit) onSubmit();
        if (onClose) onClose();
      }, 3000);
    } catch (error) {
      toast.error('Error al enviar la encuesta: ' + error.message);
      setSubmitting(false);
    }
  };

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

  const renderStepContent = () => {
    switch (step) {
      // Paso 0: ¿SE JUGÓ EL PARTIDO?
      case 0:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿SE JUGÓ EL PARTIDO?</h2>
            <div className="survey-options">
              <button 
                className={`survey-option-btn ${survey.se_jugo === true ? 'selected' : ''}`}
                onClick={() => {
                  setSurvey((prev) => ({ ...prev, se_jugo: true }));
                  setStep(1);
                }}
              >SÍ</button>
              <button 
                className={`survey-option-btn ${survey.se_jugo === false ? 'selected' : ''}`}
                onClick={() => {
                  setSurvey((prev) => ({ ...prev, se_jugo: false }));
                  setStep(10);
                }}
              >NO</button>
            </div>
          </div>
        );
      
      // Paso 1: ¿ASISTIERON TODOS?
      case 1:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿ASISTIERON TODOS?</h2>
            <div className="survey-options">
              <button 
                className={`survey-option-btn ${survey.asistieron_todos === true ? 'selected' : ''}`}
                onClick={() => {
                  setSurvey((prev) => ({ ...prev, asistieron_todos: true, jugadores_ausentes: [] }));
                  setStep(2);
                }}
              >SÍ</button>
              <button 
                className={`survey-option-btn ${survey.asistieron_todos === false ? 'selected' : ''}`}
                onClick={() => {
                  setSurvey((prev) => ({ ...prev, asistieron_todos: false }));
                  setStep(11);
                }}
              >NO</button>
            </div>
          </div>
        );
      
      // Paso 2: ¿QUIÉN FUE EL MEJOR JUGADOR?
      case 2:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿QUIÉN FUE EL MEJOR JUGADOR?</h2>
            <div className="survey-players-grid">
              {allPlayers.map((player) => (
                <PlayerCardMini
                  key={player.uuid || player.id}
                  player={player}
                  selected={survey.mejor_jugador === (player.uuid || player.id)}
                  onClick={(playerId) => setSurvey((prev) => ({ ...prev, mejor_jugador: playerId }))}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button 
                className="survey-nav-btn next" 
                onClick={() => setStep(3)}
              >Siguiente</button>
            </div>
          </div>
        );
      
      // Paso 3: ¿QUIÉN FUE EL MEJOR ARQUERO?
      case 3:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿QUIÉN FUE EL MEJOR ARQUERO?</h2>
            {arqueros.length > 0 ? (
              <div className="survey-players-grid">
                {arqueros.map((player) => (
                  <PlayerCardMini
                    key={player.uuid || player.id}
                    player={player}
                    selected={survey.mejor_arquero === (player.uuid || player.id)}
                    onClick={(playerId) => setSurvey((prev) => ({ ...prev, mejor_arquero: playerId }))}
                  />
                ))}
              </div>
            ) : (
              <div className="survey-players-grid">
                {allPlayers.map((player) => (
                  <PlayerCardMini
                    key={player.uuid || player.id}
                    player={player}
                    selected={survey.mejor_arquero === (player.uuid || player.id)}
                    onClick={(playerId) => setSurvey((prev) => ({ ...prev, mejor_arquero: playerId }))}
                  />
                ))}
              </div>
            )}
            <div className="survey-nav-buttons">
              <button 
                className="survey-nav-btn skip"
                onClick={() => setStep(4)}
              >No hubo arqueros</button>
              <button 
                className="survey-nav-btn next" 
                onClick={() => setStep(4)}
              >Siguiente</button>
            </div>
          </div>
        );
      
      // Paso 4: ¿FUE UN PARTIDO LIMPIO?
      case 4:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿FUE UN PARTIDO LIMPIO?</h2>
            <div className="survey-options">
              <button 
                className={`survey-option-btn ${survey.partido_limpio === true ? 'selected' : ''}`}
                onClick={() => {
                  setSurvey((prev) => ({ ...prev, partido_limpio: true, jugadores_violentos: [] }));
                  setStep(5);
                }}
              >SÍ</button>
              <button 
                className={`survey-option-btn ${survey.partido_limpio === false ? 'selected' : ''}`}
                onClick={() => {
                  setSurvey((prev) => ({ ...prev, partido_limpio: false }));
                  setStep(12);
                }}
              >NO</button>
            </div>
          </div>
        );
      
      // Paso 5: ¿QUIÉN GANÓ?
      case 5:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿QUIÉN GANÓ?</h2>
            <div className="survey-options">
              <button 
                className={`survey-option-btn ${survey.ganador === 'equipo_a' ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, ganador: 'equipo_a' }))}
              >Equipo A</button>
              <button 
                className={`survey-option-btn ${survey.ganador === 'equipo_b' ? 'selected' : ''}`}
                onClick={() => setSurvey((prev) => ({ ...prev, ganador: 'equipo_b' }))}
              >Equipo B</button>
            </div>
            <div className="survey-text-input">
              <input
                type="text"
                value={survey.resultado}
                onChange={(e) => setSurvey((prev) => ({ ...prev, resultado: e.target.value }))}
                placeholder="Resultado (opcional)"
                style={{ 
                  width: '100%', 
                  padding: '15px', 
                  backgroundColor: '#2a2a40', 
                  border: '1px solid #444', 
                  borderRadius: '8px', 
                  color: 'white', 
                  fontSize: '16px', 
                }}
              />
            </div>
            <div className="survey-nav-buttons">
              <button 
                className="survey-submit-btn" 
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Enviando...' : 'Finalizar encuesta'}
              </button>
            </div>
          </div>
        );
      
      // Paso 10: Descargo cuando no se jugó
      case 10:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Por qué no se jugó el partido?</h2>
            <div className="survey-text-input">
              <textarea
                value={survey.motivo_no_jugado}
                onChange={(e) => setSurvey((prev) => ({ ...prev, motivo_no_jugado: e.target.value }))}
                placeholder="Explica brevemente por qué no se jugó el partido"
              />
            </div>
            <div style={{ marginTop: '20px', marginBottom: '20px' }}>
              <button 
                onClick={() => setStep(13)}
                style={{
                  width: '100%',
                  padding: '15px',
                  backgroundColor: '#DE1C49',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  marginBottom: '15px',
                }}
              >Ausencia sin aviso</button>
            </div>
            <button 
              className="survey-submit-btn" 
              onClick={handleSubmit}
              disabled={!survey.motivo_no_jugado.trim()}
            >Finalizar</button>
          </div>
        );
      
      // Paso 11: Seleccionar ausentes cuando se jugó
      case 11:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">¿Quiénes faltaron?</h2>
            <div className="survey-players-grid">
              {allPlayers.map((player) => (
                <PlayerCardMini
                  key={player.uuid || player.id}
                  player={player}
                  selected={survey.jugadores_ausentes.includes(player.uuid || player.id)}
                  onClick={(playerId) => togglePlayer('jugadores_ausentes', playerId)}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button 
                className="survey-nav-btn next" 
                onClick={() => setStep(2)}
              >Siguiente</button>
            </div>
          </div>
        );
      
      // Paso 12: Seleccionar jugadores violentos
      case 12:
        console.log('PASO 12 - JUGADORES VIOLENTOS - allPlayers:', allPlayers);
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">ARCHIVO CORRECTO - ¿Qué jugador/es tuvieron actitudes violentas durante el partido?</h2>
            <div className="survey-players-grid">
              {allPlayers.map((player) => (
                <PlayerCardMini
                  key={`violent-${player.uuid || player.id}`}
                  player={player}
                  selected={survey.jugadores_violentos.includes(player.uuid || player.id)}
                  onClick={(playerId) => togglePlayer('jugadores_violentos', playerId)}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button 
                className="survey-nav-btn next" 
                onClick={() => setStep(5)}
              >Siguiente</button>
            </div>
          </div>
        );
      
      // Paso 13: Seleccionar ausentes sin aviso
      case 13:
        return (
          <div className="survey-step slide-in">
            <h2 className="survey-question">Selecciona jugadores que no asistieron</h2>
            <div className="survey-players-grid">
              {allPlayers.map((player) => (
                <PlayerCardMini
                  key={player.uuid || player.id}
                  player={player}
                  selected={survey.jugadores_ausentes.includes(player.uuid || player.id)}
                  onClick={(playerId) => togglePlayer('jugadores_ausentes', playerId)}
                />
              ))}
            </div>
            <div className="survey-nav-buttons">
              <button 
                className="survey-submit-btn" 
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Enviando...' : 'Finalizar'}
              </button>
            </div>
          </div>
        );
      
      // Paso 99: Pantalla de gracias
      case 99:
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

  const BadgeAnimation = ({ animation, index }) => {
    if (!animation) return null;
    
    return (
      <div 
        className={`badge-animation badge-${animation.badgeType}`}
        style={{
          animationDelay: `${index * 1}s`,
        }}
      >
        <div className="badge-player-card">
          <div className="badge-player-avatar">
            {animation.playerAvatar ? (
              <img src={animation.playerAvatar} alt={animation.playerName} />
            ) : (
              <div className="badge-avatar-placeholder">
                {animation.playerName?.charAt(0) || '?'}
              </div>
            )}
          </div>
          <div className="badge-player-name">{animation.playerName || 'Jugador'}</div>
        </div>
        <div className="badge-animation-text">
          <div className="badge-award-text">GANÓ {animation.badgeText}</div>
        </div>
        <div className={`badge-animation-icon badge-icon-${animation.badgeType}`}>
          {animation.badgeIcon}
        </div>
      </div>
    );
  };

  return (
    <div className="post-match-survey-fullscreen">
      {showingBadgeAnimations && (
        <div className="badge-animations-overlay">
          {badgeAnimations.map((animation, index) => (
            <BadgeAnimation key={index} animation={animation} index={index} />
          ))}
        </div>
      )}
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
        {!completed && step !== 99 && (
          <div className="survey-progress-bar">
            <div 
              className="survey-progress-fill" 
              style={{ width: `${(step / 5) * 100}%` }}
            ></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PostMatchSurvey;
