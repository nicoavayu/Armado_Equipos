import React, { useState, useEffect, useRef } from 'react';
import {
  addJugador,
  deleteJugador,
  getJugadores,
  closeVotingAndCalculateScores,
  getPartidoPorCodigo,
  updateJugadoresPartido,
  getVotantesIds,
  getVotantesConNombres,
  getJugadoresDelPartido,
  supabase,
} from './supabase';
import { toast } from 'react-toastify';
import { handleError, handleSuccess, safeAsync } from './utils/errorHandler';
import { UI_MESSAGES, VALIDATION_RULES } from './constants';
import { LOADING_STATES, UI_SIZES } from './appConstants';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import './HomeStyleKit.css';
import './AdminPanel.css';
import WhatsappIcon from './components/WhatsappIcon';
import TeamDisplay from './components/TeamDisplay';
import PartidoInfoBox from './PartidoInfoBox';
import Button from './components/Button';
import ChatButton from './components/ChatButton';
import { PlayerCardTrigger } from './components/ProfileComponents';
import LoadingSpinner from './components/LoadingSpinner';
import { HistorialDePartidosButton } from './components/historial';

function MiniAvatar({ foto_url, nombre, size = 34 }) {
  if (foto_url) {
    return (
      <LazyLoadImage
        alt={nombre}
        src={foto_url}
        effect="blur"
        width={size}
        height={size}
        className="mini-avatar"
      />
    );
  }
  return <div className="mini-avatar-placeholder" style={{ width: size, height: size }} />;
}

export default function AdminPanel({ onBackToHome, jugadores, onJugadoresChange, partidoActual }) {
  const [votantes, setVotantes] = useState([]);
  const [votantesConNombres, setVotantesConNombres] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showTeamView, setShowTeamView] = useState(false);

  const [teams, setTeams] = useState([
    { id: 'equipoA', name: 'Equipo A', players: [], score: 0 },
    { id: 'equipoB', name: 'Equipo B', players: [], score: 0 },
  ]);
  const inputRef = useRef();

  // 🟢 Si jugadores viene undefined o null, usá array vacío
  jugadores = jugadores || [];
  if (!Array.isArray(jugadores)) jugadores = [];
  console.log('Jugadores en AdminPanel:', jugadores);
  // useEffect para refrescar jugadores desde la tabla jugadores
  useEffect(() => {
    async function fetchJugadoresDelPartido() {
      if (!partidoActual?.id) return;
      try {
        console.log('[ADMIN_PANEL] Fetching players from jugadores table for match:', partidoActual.id);
        
        // Obtener jugadores directamente de la tabla jugadores
        const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
        console.log('[ADMIN_PANEL] Players fetched:', {
          count: jugadoresPartido.length,
          players: jugadoresPartido.map((j) => ({ nombre: j.nombre, uuid: j.uuid })),
        });
        
        // Obtener votantes
        const votantesIds = await getVotantesIds(partidoActual.id);
        const votantesNombres = await getVotantesConNombres(partidoActual.id);
        setVotantes(votantesIds || []);
        setVotantesConNombres(votantesNombres || []);
        
        // Actualizar jugadores
        onJugadoresChange(jugadoresPartido);
      } catch (error) {
        console.error('[ADMIN_PANEL] Error loading match data:', error);
      }
    }
    
    fetchJugadoresDelPartido();
    const interval = setInterval(fetchJugadoresDelPartido, 2000);
    return () => clearInterval(interval);
  }, [partidoActual?.id]);


  async function refreshVotantes(partidoActual, setVotantes) {
    try {
      const votantesIds = await getVotantesIds(partidoActual.id);
      setVotantes(votantesIds || []);
    } catch (error) {
      // Silent refresh error - not critical for UX
    }
  }

  // Refresh voters when players change
  useEffect(() => {
    if (jugadores.length > 0 && partidoActual?.id) {
      refreshVotantes(partidoActual, setVotantes);
    }
  }, [jugadores.length, partidoActual?.id]);

  /**
 * Adds a new player to the current match
 * Creates player in database and updates match roster
 */
  async function agregarJugador(e) {
    e.preventDefault();
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    if (jugadores.some((j) => j.nombre.toLowerCase() === nombre.toLowerCase())) {
      toast.warn('Este jugador ya existe.');
      return;
    }
    setLoading(true);
    try {
      console.log('[ADMIN_PANEL] Adding player to match:', { nombre, partidoId: partidoActual.id });
      
      // Generar UUID único para el jugador
      const uuid = crypto.randomUUID();
      
      // Insertar jugador directamente en la tabla jugadores con partido_id (SOLO INSERT, nunca DELETE)
      const { data: nuevoJugador, error } = await supabase
        .from('jugadores')
        .insert([{
          uuid,
          nombre,
          partido_id: partidoActual.id,
          score: 5,
          is_goalkeeper: false,
        }])
        .select()
        .single();
        
      if (error) throw error;
      
      console.log('[ADMIN_PANEL] Player added successfully:', nuevoJugador);
      setNuevoNombre('');
      setTimeout(() => inputRef.current?.focus(), 10);
      
      // El useEffect se encargará de refrescar la lista automáticamente
    } catch (error) {
      console.error('[ADMIN_PANEL] Error adding player:', error);
      toast.error('Error agregando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  }


  async function eliminarJugador(uuid) {
    setLoading(true);
    try {
      console.log('[ADMIN_PANEL] Removing player from match:', { uuid, partidoId: partidoActual.id });
      
      // Eliminar jugador específico de la tabla jugadores (usando uuid como string)
      const { error } = await supabase
        .from('jugadores')
        .delete()
        .eq('uuid', uuid)
        .eq('partido_id', partidoActual.id);
        
      if (error) throw error;
      
      console.log('[ADMIN_PANEL] Player removed successfully');
      
      // El useEffect se encargará de refrescar la lista automáticamente
    } catch (error) {
      console.error('[ADMIN_PANEL] Error removing player:', error);
      toast.error('Error eliminando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  }
  /**
   * Creates balanced teams based on player scores
   * Distributes players to minimize score difference between teams
   */
  function armarEquipos(jugadores) {
    const jugadoresOrdenados = [...jugadores].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const equipoA = [];
    const equipoB = [];
    let puntajeA = 0;
    let puntajeB = 0;

    jugadoresOrdenados.forEach((jugador) => {
      if (equipoA.length < equipoB.length) {
        equipoA.push(jugador.uuid);
        puntajeA += jugador.score ?? 0;
      } else if (equipoB.length < equipoA.length) {
        equipoB.push(jugador.uuid);
        puntajeB += jugador.score ?? 0;
      } else {
        if (puntajeA <= puntajeB) {
          equipoA.push(jugador.uuid);
          puntajeA += jugador.score ?? 0;
        } else {
          equipoB.push(jugador.uuid);
          puntajeB += jugador.score ?? 0;
        }
      }
    });

    return [
      { id: 'equipoA', name: 'Equipo A', players: equipoA, score: puntajeA },
      { id: 'equipoB', name: 'Equipo B', players: equipoB, score: puntajeB },
    ];
  }

  const safeSetTeams = (newTeams) => {
    if (!Array.isArray(newTeams)) return;
    let equipoA = newTeams.find((t) => t && t.id === 'equipoA');
    let equipoB = newTeams.find((t) => t && t.id === 'equipoB');
    if (!equipoA) equipoA = { id: 'equipoA', name: 'Equipo A', players: [], score: 0 };
    if (!equipoB) equipoB = { id: 'equipoB', name: 'Equipo B', players: [], score: 0 };
    setTeams([equipoA, equipoB]);
  };

  const handleTeamsChange = (newTeams) => {
    safeSetTeams(newTeams);
  };

  /**
 * Closes voting phase and creates balanced teams
 * Calculates player averages from votes and forms teams
 */
  async function handleCerrarVotacion() {
  // Prevent double execution
    if (isClosing) {
      toast.warn('Operación en progreso, espera un momento');
      return;
    }
  
    // Validate preconditions
    if (!partidoActual) {
      toast.error('Error: No hay partido activo');
      return;
    }
  
    if (!jugadores || jugadores.length === 0) {
      toast.error('Error: No hay jugadores en el partido');
      return;
    }
  
    if (jugadores.length < 2) {
      toast.error('Se necesitan al menos 2 jugadores');
      return;
    }
  
    if (jugadores.length % 2 !== 0) {
      toast.error('NECESITAS UN NÚMERO PAR DE JUGADORES PARA FORMAR EQUIPOS');
      return;
    }
  
    // Validate player UUIDs
    const invalidPlayers = jugadores.filter((j) => !j.uuid);
    if (invalidPlayers.length > 0) {
      toast.error('Error: Algunos jugadores no tienen ID válido');
      return;
    }
  
    // Check if there are any votes
    if (votantes.length === 0) {
      const shouldContinue = window.confirm(
        'No se detectaron votos. ¿Estás seguro de que querés continuar? Los equipos se formarán con puntajes por defecto.',
      );
      if (!shouldContinue) {
        return;
      }
    }
  
    const confirmMessage = votantes.length > 0 
      ? `¿Cerrar votación y armar equipos? Se procesaron ${votantes.length} votos.`
      : '¿Cerrar votación y armar equipos con puntajes por defecto?';
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
  
    setIsClosing(true);
  
    try {
    // Close voting and calculate scores
      const result = await closeVotingAndCalculateScores(partidoActual.id);
    
      if (!result) {
        throw new Error('No se recibió respuesta del cierre de votación');
      }
    
      // Get fresh player data with updated scores
      const updatedPlayers = await getJugadores();
    
      if (!updatedPlayers || updatedPlayers.length === 0) {
        throw new Error('No se pudieron obtener los jugadores actualizados');
      }
    
      // Filter players for this match
      const matchPlayers = updatedPlayers.filter((j) => {
        return partidoActual.jugadores.some((pj) => pj.uuid === j.uuid);
      });
    
      if (matchPlayers.length === 0) {
        throw new Error('No se encontraron jugadores del partido con puntajes actualizados');
      }
    
      // Create balanced teams
      const teams = armarEquipos(matchPlayers);
    
      if (!teams || teams.length !== 2) {
        throw new Error('Error al crear los equipos');
      }
    
      // Validate teams
      const teamAPlayers = teams[0]?.players?.length || 0;
      const teamBPlayers = teams[1]?.players?.length || 0;
      if (teamAPlayers === 0 || teamBPlayers === 0) {
        throw new Error('Los equipos creados están vacíos');
      }
    
      // Update UI state
      safeSetTeams(teams);
      setShowTeamView(true);
      onJugadoresChange(matchPlayers);
    
      // Programar notificaciones de encuesta post-partido
      try {
        const { schedulePostMatchSurveyNotifications } = await import('./utils/matchNotifications');
        await schedulePostMatchSurveyNotifications(partidoActual);
      } catch (scheduleError) {
        console.warn('No se pudieron programar las notificaciones de encuesta:', scheduleError);
      // No mostramos error al usuario ya que no es crítico para la funcionalidad principal
      }
    
      // Success! Show only one toast notification
      toast.success('¡Equipos generados exitosamente!');
    
    } catch (error) {
    // Provide specific error messages
      let errorMessage = 'Error al cerrar la votación';
      if (error.message.includes('votos')) {
        errorMessage = 'Error al procesar los votos';
      } else if (error.message.includes('jugadores')) {
        errorMessage = 'Error al actualizar los jugadores';
      } else if (error.message.includes('equipos')) {
        errorMessage = 'Error al crear los equipos';
      } else if (error.message) {
        errorMessage = error.message;
      }
    
      toast.error(errorMessage);
    
      // Reset state on error
      setShowTeamView(false);
    
    } finally {
      setIsClosing(false);
    }
  }


  function handleCopyLink() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    navigator.clipboard.writeText(url);
    toast.success('¡Link copiado!', { autoClose: 2000 });
  }
  
  async function handleCallToVote() {
    try {
      // Verificar que haya jugadores para notificar
      if (!jugadores || jugadores.length === 0) {
        toast.warn('No hay jugadores para notificar');
        return;
      }
      
      // Importar dinámicamente la función para crear notificaciones
      const { createCallToVoteNotifications } = await import('./utils/matchNotifications');
      
      // Crear notificaciones para todos los jugadores
      const notificaciones = await createCallToVoteNotifications(partidoActual);
      
      // Mostrar mensaje de éxito con el número de notificaciones creadas
      if (notificaciones.length > 0) {
        toast.success(`Notificación enviada a ${notificaciones.length} jugadores`);
      } else {
        toast.info('No se pudieron enviar notificaciones. Asegúrate que los jugadores tengan cuenta.');
      }
      
    } catch (error) {
      console.error('Error al enviar notificaciones:', error);
      toast.error('Error al enviar notificaciones: ' + error.message);
    }
  }

  function handleWhatsApp() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    window.open(`https://wa.me/?text=${encodeURIComponent('Entrá a votar para armar los equipos: ' + url)}`, '_blank');
  }
  
 
  async function handleFaltanJugadores() {
    try {
      const nuevoEstado = !partidoActual.falta_jugadores;
      const { error } = await supabase
        .from('partidos')
        .update({ falta_jugadores: nuevoEstado })
        .eq('id', partidoActual.id);
      
      if (error) throw error;
      
      // Update local state
      partidoActual.falta_jugadores = nuevoEstado;
      
      toast.success(nuevoEstado ? 
        '¡Partido abierto a la comunidad!' : 
        'Partido cerrado a nuevos jugadores',
      );
    } catch (error) {
      toast.error('Error al actualizar el partido: ' + error.message);
    }
  }

  // Función handleRefreshPlayers eliminada

  // Funciones de jugadores libres eliminadas





  const showTeams =
    showTeamView &&
    Array.isArray(teams) &&
    teams.length === 2 &&
    teams.find((t) => t.id === 'equipoA') &&
    teams.find((t) => t.id === 'equipoB');

  // Determine if button should be disabled
  const isButtonDisabled = isClosing || loading || jugadores.length < 2;
  const hasOddPlayers = jugadores.length > 0 && jugadores.length % 2 !== 0;
  const hasNoVotes = votantes.length === 0 && jugadores.length > 0;

  if (!partidoActual) return <LoadingSpinner size="large" />;
  
  // Utility function to extract short venue name
  const getShortVenueName = (venue) => {
    if (!venue) return '';
    // Extract text before first comma or parenthesis
    const shortName = venue.split(/[,(]/)[0].trim();
    return shortName;
  };
  
  // Get match name from frequent match or regular match
  const getMatchName = () => {
    // Try to get name from frequent match first
    if (partidoActual.from_frequent_match_id && partidoActual.frequent_match_name) {
      return partidoActual.frequent_match_name;
    }
    // Then try regular match name
    if (partidoActual.nombre) {
      return partidoActual.nombre;
    }
    // Fallback to generic name
    return 'PARTIDO';
  };

  return (
    <>
      <ChatButton partidoId={partidoActual?.id} />
      <div className="admin-panel-content">
        {showTeams ? (
          <TeamDisplay
            teams={teams}
            players={jugadores}
            onTeamsChange={handleTeamsChange}
            onBackToHome={onBackToHome}
          />
        ) : (
          <>
            {/* Match header with custom name and details */}
            <div className="match-header">
              <div className="match-name">
                {getMatchName()}
              </div>
              <div className="match-details">
                {partidoActual.fecha && new Date(partidoActual.fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
                  weekday: 'long', 
                  day: 'numeric', 
                  month: 'numeric', 
                })}
                {partidoActual.hora && ` ${partidoActual.hora}`}
                {partidoActual.sede && (
                  <>
                    {' – '}
                    <a 
                      href={`https://www.google.com/maps/search/${encodeURIComponent(getShortVenueName(partidoActual.sede))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="venue-link"
                    >
                      {getShortVenueName(partidoActual.sede)}
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Add player section */}
            <div className="admin-add-section">
              <form className="admin-add-form" onSubmit={agregarJugador} autoComplete="off">
                <input
                  className="input-modern"
                  type="text"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  placeholder="Nombre del jugador"
                  disabled={loading}
                  ref={inputRef}
                  maxLength={40}
                  required
                  aria-label="Nombre del nuevo jugador"
                />
                <button
                  className="voting-confirm-btn"
                  type="submit"
                  disabled={loading || isClosing}
                >
                  {loading ? <LoadingSpinner size="small" /> : 'AGREGAR'}
                </button>
              </form>
            </div>

            {/* Players list section */}
            <div className="admin-players-section">
              <div className="admin-players-title">
              JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'}) - VOTARON: {votantesConNombres.map((v) => v.nombre).join(', ') || 'Nadie aún'}
              </div>
              {jugadores.length === 0 ? (
                <div className="admin-players-empty">
                  <LoadingSpinner size="medium" />
                </div>
              ) : (
                <div className="admin-players-grid">
                  {jugadores.map((j) => {
                  // Check if this specific player voted by name
                    const hasVoted = votantesConNombres.some((v) => v.nombre === j.nombre);
                    // LOG POR JUGADOR
                    console.log('Render jugador:', j.nombre, j.foto_url, j.avatar_url, j.uuid);

                    return (
                      <PlayerCardTrigger key={j.uuid} profile={j}>
                        <div
                          className={`admin-player-item${hasVoted ? ' voted' : ''}`}
                          style={hasVoted ? {
                            background: 'rgba(0,255,136,0.3) !important',
                            border: '3px solid #00ff88 !important',
                            boxShadow: '0 0 15px rgba(0,255,136,0.6) !important',
                          } : {}}
                        >
                          {j.foto_url || j.avatar_url ? (
                            <img
                              src={j.foto_url || j.avatar_url}
                              alt={j.nombre}
                              className="admin-player-avatar"
                            />
                          ) : (
                            <div className="admin-player-avatar-placeholder">👤</div>
                          )}

                          <span className="admin-player-name">{j.nombre}</span>
                          <button
                            className="admin-remove-btn"
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent modal from opening when deleting
                              eliminarJugador(j.uuid);
                            }}
                            type="button"
                            aria-label="Eliminar jugador"
                            disabled={isClosing}
                          >
                        ×
                          </button>
                        </div>
                      </PlayerCardTrigger>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="admin-actions">
              <button 
                className="voting-confirm-btn admin-btn-primary" 
                onClick={handleCallToVote}
                aria-label="Enviar notificación a los jugadores para que voten"
              >
              LLAMAR A VOTAR
              </button>
            
              <button 
                className="voting-confirm-btn admin-btn-whatsapp" 
                onClick={handleWhatsApp}
                aria-label="Compartir enlace por WhatsApp"
              >
                <WhatsappIcon size={UI_SIZES.WHATSAPP_ICON_SIZE} style={{ marginRight: 8 }} />
              COMPARTIR POR WHATSAPP
              </button>
              <div style={{ position: 'relative' }}>
                <button 
                  className="voting-confirm-btn admin-btn-danger" 
                  onClick={handleCerrarVotacion} 
                  disabled={isButtonDisabled}
                  style={{
                    opacity: isButtonDisabled ? 0.6 : 1,
                    cursor: isButtonDisabled ? 'not-allowed' : 'pointer',
                  }}
                  aria-label={isClosing ? 'Cerrando votación' : `Cerrar votación con ${jugadores.length} jugadores`}
                >
                  {isClosing ? (
                    <LoadingSpinner size="small" />
                  ) : (
                    `CERRAR VOTACIÓN (${jugadores.length} jugadores)`
                  )}
                </button>
              
                {/* Warning messages */}
              
                {jugadores.length < 2 && (
                  <div style={{
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: '14px',
                    fontFamily: 'Oswald, Arial, sans-serif',
                    textAlign: 'center',
                    marginTop: '8px',
                    background: 'rgba(255,255,255,0.1)',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.2)',
                  }}>
                  Agrega al menos 2 jugadores para formar equipos
                  </div>
                )}
              </div>
            
              {/* Botón Faltan Jugadores */}
              <button 
                className="voting-confirm-btn" 
                style={{ 
                  background: partidoActual.falta_jugadores ? '#28a745' : '#ff6b35',
                  borderColor: '#fff',
                  marginBottom: 12,
                }}
                onClick={handleFaltanJugadores}
                aria-label='Abrir/cerrar partido a la comunidad'
              >
                {partidoActual.falta_jugadores ? 'PARTIDO ABIERTO' : 'FALTAN JUGADORES'}
              </button>
            
              {/* Botón de Historial de Partidos */}
              <HistorialDePartidosButton partidoFrecuente={{
                id: partidoActual.id,
                es_frecuente: partidoActual.es_frecuente,
                partido_frecuente_id: partidoActual.partido_frecuente_id,
                nombre: partidoActual.nombre,
              }} />
            
              {/* Botón de volver al inicio eliminado */}
            </div>
          
            {/* Sección de jugadores libres eliminada */}

          </>
        )}
      </div>
    </>
  );
}
