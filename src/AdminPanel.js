import React, { useState, useEffect, useRef } from "react";
import {
  addJugador,
  deleteJugador,
  getJugadores,
  closeVotingAndCalculateScores,
  updateJugadoresPartido,
  getVotantesIds,
  getVotantesConNombres,
} from "./supabase";
import { toast } from 'react-toastify';
import { LOADING_STATES, UI_SIZES } from "./appConstants";
import { useNativeFeatures } from "./hooks/useNativeFeatures";

import "./HomeStyleKit.css";
import "./AdminPanel.css";
import WhatsappIcon from "./components/WhatsappIcon";
import TeamDisplay from "./components/TeamDisplay";



export default function AdminPanel({ onBackToHome, jugadores, onJugadoresChange, partidoActual }) {
  const { shareContent, vibrate, sendNotification, saveData, getData } = useNativeFeatures();
  const [votantes, setVotantes] = useState([]);
  const [votantesConNombres, setVotantesConNombres] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [addFrecuente, setAddFrecuente] = useState(false);
  const [jugadoresFrecuentes, setJugadoresFrecuentes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const [showTeamView, setShowTeamView] = useState(false);

  const [teams, setTeams] = useState([
    { id: "equipoA", name: "Equipo A", players: [], score: 0 },
    { id: "equipoB", name: "Equipo B", players: [], score: 0 },
  ]);
  const inputRef = useRef();

  // 🟢 Si jugadores viene undefined o null, usá array vacío
  jugadores = jugadores || [];
  if (!Array.isArray(jugadores)) jugadores = [];

  useEffect(() => {
    async function fetchVotantes() {
      if (!partidoActual?.id) return;
      try {
        const votantesIds = await getVotantesIds(partidoActual.id);
        const votantesNombres = await getVotantesConNombres(partidoActual.id);
        setVotantes(votantesIds || []);
        setVotantesConNombres(votantesNombres || []);
        
        // Refresh players to get updated photos
        const updatedPlayers = await getJugadores();
        const matchPlayers = updatedPlayers.filter(p => 
          partidoActual.jugadores.some(pj => pj.uuid === p.uuid)
        );
        if (matchPlayers.length > 0) {
          onJugadoresChange(matchPlayers);
        }
      } catch (error) {
        console.error("Error cargando votantes:", error);
      }
    }
    fetchVotantes();
    
    // Auto-refresh every 2 seconds for real-time updates
    const interval = setInterval(fetchVotantes, 2000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partidoActual?.id]);
  
  // Refresh voters when players change
  useEffect(() => {
    if (jugadores.length > 0 && partidoActual?.id) {
      async function refreshVotantes() {
        try {
          const votantesIds = await getVotantesIds(partidoActual.id);
          setVotantes(votantesIds || []);
        } catch (error) {
          // Silent refresh error - not critical for UX
        }
      }
      refreshVotantes();
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
    if (jugadores.some(j => j.nombre.toLowerCase() === nombre.toLowerCase())) {
      toast.warn("Este jugador ya existe.");
      return;
    }
    setLoading(true);
    try {
      // Create player in database
      const nuevoJugador = await addJugador(nombre);
      // Add to match roster
      const nuevosJugadores = [...jugadores, nuevoJugador];
      await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
      onJugadoresChange(nuevosJugadores);
      setNuevoNombre("");
      setTimeout(() => inputRef.current?.focus(), 10);
    } catch (error) {
      toast.error("Error agregando jugador: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function eliminarJugador(uuid) {
    setLoading(true);
    try {
      await deleteJugador(uuid);
      const nuevosJugadores = jugadores.filter(j => j.uuid !== uuid);
      await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
      onJugadoresChange(nuevosJugadores);
    } catch (error) {
      toast.error("Error eliminando jugador: " + error.message);
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

    jugadoresOrdenados.forEach(jugador => {
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
      { id: "equipoA", name: "Equipo A", players: equipoA, score: puntajeA },
      { id: "equipoB", name: "Equipo B", players: equipoB, score: puntajeB },
    ];
  }

  const safeSetTeams = (newTeams) => {
    if (!Array.isArray(newTeams)) return;
    let equipoA = newTeams.find(t => t && t.id === 'equipoA');
    let equipoB = newTeams.find(t => t && t.id === 'equipoB');
    if (!equipoA) equipoA = { id: "equipoA", name: "Equipo A", players: [], score: 0 };
    if (!equipoB) equipoB = { id: "equipoB", name: "Equipo B", players: [], score: 0 };
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
      toast.warn('Agrega al menos 2 jugadores para formar equipos', { autoClose: 2000 });
      return;
    }
    
    // Validate player UUIDs
    const invalidPlayers = jugadores.filter(j => !j.uuid);
    if (invalidPlayers.length > 0) {
      toast.error('Error: Algunos jugadores no tienen ID válido');
      return;
    }
    
    // Check if there are any votes
    if (votantes.length === 0) {
      const shouldContinue = window.confirm(
        'No se detectaron votos. ¿Estás seguro de que querés continuar? Los equipos se formarán con puntajes por defecto.'
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
      const matchPlayers = updatedPlayers.filter(j => {
        return partidoActual.jugadores.some(pj => pj.uuid === j.uuid);
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
      
      // Success!
      await vibrate('heavy');
      await sendNotification('Equipos Listos', 'Los equipos han sido creados exitosamente');
      toast.success(result.message || 'Votación cerrada y equipos creados');
      
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

  const getCorrectDomain = () => {
    // Si estamos en el dominio con nicoavayus-projects, usar el dominio limpio
    if (window.location.hostname.includes('nicoavayus-projects')) {
      return 'https://arma2.vercel.app';
    }
    return window.location.origin;
  };

  async function handleCopyLink() {
    const url = `${getCorrectDomain()}/?codigo=${partidoActual.codigo}`;
    try {
      await navigator.clipboard.writeText(url);
      await vibrate('light');
      toast.success("¡Link copiado!", { autoClose: 2000 });
    } catch (error) {
      toast.error("Error copiando link");
    }
  }

  async function handleWhatsApp() {
    const url = `${getCorrectDomain()}/?codigo=${partidoActual.codigo}`;
    const title = "Team Balancer";
    const text = "Entrá a votar para armar los equipos";
    
    try {
      await shareContent(title, text, url);
      await vibrate('medium');
    } catch (error) {
      // Fallback to WhatsApp web
      window.open(`https://wa.me/?text=${encodeURIComponent(text + ": " + url)}`, "_blank");
    }
  }





  const showTeams =
    showTeamView &&
    Array.isArray(teams) &&
    teams.length === 2 &&
    teams.find(t => t.id === "equipoA") &&
    teams.find(t => t.id === "equipoB");

  // Determine if button should be disabled
  const isButtonDisabled = isClosing || loading || jugadores.length < 2;

  if (!partidoActual) return <div style={{color:"red"}}>Sin partido cargado</div>;
  
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
                month: 'numeric' 
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
                onChange={e => setNuevoNombre(e.target.value)}
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
                {loading ? LOADING_STATES.ADDING_PLAYER : "AGREGAR"}
              </button>
            </form>
          </div>

          {/* Players list section */}
          <div className="admin-players-section">
            <div className="admin-players-title">
              JUGADORES ({jugadores.length}) - VOTARON: {votantesConNombres.map(v => v.nombre).join(', ') || 'Nadie aún'}
            </div>
            {jugadores.length === 0 ? (
              <div className="admin-players-empty">
                Aún no hay jugadores agregados
              </div>
            ) : (
              <div className="admin-players-grid">
                {jugadores.map(j => {
                  // Check if this specific player voted by name
                  const hasVoted = votantesConNombres.some(v => v.nombre === j.nombre);
                  return (
                  <div
                    key={j.uuid}
                    className={`admin-player-item${hasVoted ? " voted" : ""}`}
                    style={hasVoted ? {
                      background: 'rgba(0,255,136,0.3) !important',
                      border: '3px solid #00ff88 !important',
                      boxShadow: '0 0 15px rgba(0,255,136,0.6) !important'
                    } : {}}
                  >
                    {j.foto_url ? (
                      <img src={j.foto_url} alt={j.nombre} className="admin-player-avatar" />
                    ) : (
                      <div className="admin-player-avatar-placeholder">👤</div>
                    )}
                    <span className="admin-player-name">{j.nombre}</span>
                    <button
                      className="admin-remove-btn"
                      onClick={() => eliminarJugador(j.uuid)}
                      type="button"
                      aria-label="Eliminar jugador"
                      disabled={isClosing}
                    >
                      ×
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="admin-actions">
            <button 
              className="voting-confirm-btn admin-btn-primary" 
              onClick={handleCopyLink}
              aria-label="Copiar enlace para que los jugadores voten"
            >
              LINK PARA JUGADORES
            </button>
            <button 
              className="voting-confirm-btn admin-btn-whatsapp" 
              onClick={handleWhatsApp}
              aria-label="Compartir enlace por WhatsApp"
            >
              <WhatsappIcon size={UI_SIZES.WHATSAPP_ICON_SIZE} style={{marginRight: 8}} />
              COMPARTIR POR WHATSAPP
            </button>
            <div style={{ position: 'relative' }}>
              <button 
                className="voting-confirm-btn admin-btn-danger" 
                onClick={handleCerrarVotacion} 
                disabled={isButtonDisabled}
                style={{
                  opacity: isButtonDisabled ? 0.6 : 1,
                  cursor: isButtonDisabled ? 'not-allowed' : 'pointer'
                }}
                aria-label={isClosing ? 'Cerrando votación' : `Cerrar votación con ${jugadores.length} jugadores`}
              >
                {isClosing ? (
                  <>
                    🔄 {LOADING_STATES.CLOSING_VOTING}
                  </>
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
                  border: '1px solid rgba(255,255,255,0.2)'
                }}>
                  Agrega al menos 2 jugadores para formar equipos
                </div>
              )}
            </div>
            <button 
              className="voting-confirm-btn admin-btn-secondary" 
              onClick={onBackToHome}
              aria-label="Volver al menú principal"
              style={{ width: '100%', fontSize: '1.5rem' }}
            >
              VOLVER AL INICIO
            </button>
          </div>


        </>
      )}
    </div>
  );
}
