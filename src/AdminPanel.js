import React, { useState, useEffect, useRef } from "react";
import {
  addJugador,
  deleteJugador,
  getJugadores,
  closeVotingAndCalculateScores,
  getPartidoPorCodigo,
  updateJugadoresPartido,
  getVotantesIds,
} from "./supabase";
import { toast } from 'react-toastify';
import { handleError, handleSuccess, safeAsync } from "./utils/errorHandler";
import { UI_MESSAGES, VALIDATION_RULES } from "./constants";
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import "./HomeStyleKit.css";
import "./AdminPanel.css";
import WhatsappIcon from "./components/WhatsappIcon";
import TeamDisplay from "./components/TeamDisplay";
import PartidoInfoBox from "./PartidoInfoBox";

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
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
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
      try {
        console.log('📊 ADMIN: Fetching voters');
        const votantesIds = await getVotantesIds();
        console.log('✅ ADMIN: Voters fetched:', votantesIds);
        setVotantes(votantesIds || []);
      } catch (error) {
        console.error('❌ ADMIN: Error fetching voters:', error);
        toast.error("Error cargando votantes: " + error.message);
      }
    }
    fetchVotantes();
  }, []);
  
  // Refresh voters when players change
  useEffect(() => {
    if (jugadores.length > 0) {
      async function refreshVotantes() {
        try {
          const votantesIds = await getVotantesIds();
          setVotantes(votantesIds || []);
        } catch (error) {
          console.error('❌ ADMIN: Error refreshing voters:', error);
        }
      }
      refreshVotantes();
    }
  }, [jugadores.length]);

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
    // 🔥 Primero, borrá el jugador de la tabla jugadores
    await deleteJugador(uuid);

    // Después, borrá el jugador del partido
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
  console.log('🔄 CLOSE VOTING: Starting process');
  console.log('🔄 CLOSE VOTING: Current players:', jugadores);
  console.log('🔄 CLOSE VOTING: Current match:', partidoActual);
  console.log('🔄 CLOSE VOTING: Is closing state:', isClosing);
  
  // Prevent double execution
  if (isClosing) {
    console.warn('⚠️ CLOSE VOTING: Already in progress, ignoring');
    toast.warn('Operación en progreso, espera un momento');
    return;
  }
  
  // Validate preconditions
  if (!partidoActual) {
    console.error('❌ CLOSE VOTING: No current match');
    toast.error('Error: No hay partido activo');
    return;
  }
  
  if (!jugadores || jugadores.length === 0) {
    console.error('❌ CLOSE VOTING: No players');
    toast.error('Error: No hay jugadores en el partido');
    return;
  }
  
  if (jugadores.length < 2) {
    console.error('❌ CLOSE VOTING: Not enough players');
    toast.error('Se necesitan al menos 2 jugadores');
    return;
  }
  
  if (jugadores.length % 2 !== 0) {
    console.error('❌ CLOSE VOTING: Odd number of players');
    toast.error(UI_MESSAGES.ERROR_EVEN_PLAYERS);
    return;
  }
  
  // Validate player UUIDs
  const invalidPlayers = jugadores.filter(j => !j.uuid);
  if (invalidPlayers.length > 0) {
    console.error('❌ CLOSE VOTING: Players without UUID:', invalidPlayers);
    toast.error('Error: Algunos jugadores no tienen ID válido');
    return;
  }
  
  // Check if there are any votes
  console.log('🔄 CLOSE VOTING: Checking for votes, voters:', votantes);
  if (votantes.length === 0) {
    const shouldContinue = window.confirm(
      'No se detectaron votos. ¿Estás seguro de que querés continuar? Los equipos se formarán con puntajes por defecto.'
    );
    if (!shouldContinue) {
      console.log('🔄 CLOSE VOTING: User cancelled due to no votes');
      return;
    }
  }
  
  const confirmMessage = votantes.length > 0 
    ? `¿Cerrar votación y armar equipos? Se procesaron ${votantes.length} votos.`
    : '¿Cerrar votación y armar equipos con puntajes por defecto?';
    
  if (!window.confirm(confirmMessage)) {
    console.log('🔄 CLOSE VOTING: User cancelled');
    return;
  }
  
  console.log('🔄 CLOSE VOTING: All validations passed, starting process');
  setIsClosing(true);
  
  try {
    // Step 1: Close voting and calculate scores
    console.log('🔄 CLOSE VOTING: Step 1 - Closing voting and calculating scores');
    const result = await closeVotingAndCalculateScores();
    console.log('✅ CLOSE VOTING: Step 1 completed:', result);
    
    if (!result) {
      throw new Error('No se recibió respuesta del cierre de votación');
    }
    
    // Step 2: Get fresh player data with updated scores
    console.log('🔄 CLOSE VOTING: Step 2 - Fetching updated players');
    const updatedPlayers = await getJugadores();
    console.log('✅ CLOSE VOTING: Step 2 completed, players fetched:', updatedPlayers?.length || 0);
    
    if (!updatedPlayers || updatedPlayers.length === 0) {
      throw new Error('No se pudieron obtener los jugadores actualizados');
    }
    
    // Step 3: Filter players for this match
    console.log('🔄 CLOSE VOTING: Step 3 - Filtering match players');
    console.log('🔄 CLOSE VOTING: Match player UUIDs:', partidoActual.jugadores.map(p => p.uuid));
    
    const matchPlayers = updatedPlayers.filter(j => {
      const isInMatch = partidoActual.jugadores.some(pj => pj.uuid === j.uuid);
      if (isInMatch) {
        console.log(`✅ CLOSE VOTING: Player ${j.nombre} (${j.uuid}) - Score: ${j.score}`);
      }
      return isInMatch;
    });
    
    console.log('✅ CLOSE VOTING: Step 3 completed, match players:', matchPlayers.length);
    
    if (matchPlayers.length === 0) {
      throw new Error('No se encontraron jugadores del partido con puntajes actualizados');
    }
    
    if (matchPlayers.length !== jugadores.length) {
      console.warn('⚠️ CLOSE VOTING: Player count mismatch:', {
        original: jugadores.length,
        updated: matchPlayers.length
      });
    }
    
    // Step 4: Create balanced teams
    console.log('🔄 CLOSE VOTING: Step 4 - Creating teams');
    const teams = armarEquipos(matchPlayers);
    console.log('✅ CLOSE VOTING: Step 4 completed, teams created:', teams);
    
    if (!teams || teams.length !== 2) {
      throw new Error('Error al crear los equipos');
    }
    
    // Validate teams
    const teamAPlayers = teams[0]?.players?.length || 0;
    const teamBPlayers = teams[1]?.players?.length || 0;
    if (teamAPlayers === 0 || teamBPlayers === 0) {
      throw new Error('Los equipos creados están vacíos');
    }
    
    // Step 5: Update UI state
    console.log('🔄 CLOSE VOTING: Step 5 - Updating UI state');
    safeSetTeams(teams);
    setShowTeamView(true);
    onJugadoresChange(matchPlayers);
    console.log('✅ CLOSE VOTING: Step 5 completed, UI updated');
    
    // Success!
    console.log('🎉 CLOSE VOTING: Process completed successfully');
    toast.success(result.message || 'Votación cerrada y equipos creados');
    
  } catch (error) {
    console.error('❌ CLOSE VOTING: Error occurred:', error);
    console.error('❌ CLOSE VOTING: Error stack:', error.stack);
    
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
    console.log('🔄 CLOSE VOTING: Cleaning up, setting isClosing to false');
    setIsClosing(false);
  }
}


  function handleCopyLink() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    navigator.clipboard.writeText(url);
    setCopyMsg("¡Link copiado!");
    setTimeout(() => setCopyMsg(""), 1700);
  }

  function handleWhatsApp() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    window.open(`https://wa.me/?text=${encodeURIComponent("Entrá a votar para armar los equipos: " + url)}`, "_blank");
  }





  const showTeams =
    showTeamView &&
    Array.isArray(teams) &&
    teams.length === 2 &&
    teams.find(t => t.id === "equipoA") &&
    teams.find(t => t.id === "equipoB");

  // Button state debugging
  const buttonStateDebug = {
    isClosing,
    loading,
    jugadoresLength: jugadores.length,
    isEvenPlayers: jugadores.length % 2 === 0,
    hasMinPlayers: jugadores.length >= 2,
    votantesCount: votantes.length
  };
  
  // Log button state conditions
  console.log('🔘 BUTTON STATE DEBUG:', buttonStateDebug);
  
  // Determine if button should be disabled
  const isButtonDisabled = isClosing || loading || jugadores.length < 2;
  const hasOddPlayers = jugadores.length > 0 && jugadores.length % 2 !== 0;
  const hasNoVotes = votantes.length === 0 && jugadores.length > 0;
  
  console.log('🔘 BUTTON CONDITIONS:', {
    isButtonDisabled,
    hasOddPlayers,
    hasNoVotes,
    reasons: {
      isClosing: isClosing ? 'Operation in progress' : null,
      loading: loading ? 'Loading state active' : null,
      tooFewPlayers: jugadores.length < 2 ? `Only ${jugadores.length} players (need 2+)` : null,
      oddPlayers: hasOddPlayers ? `${jugadores.length} players (need even number)` : null,
      noVotes: hasNoVotes ? 'No votes detected' : null
    }
  });

  if (!partidoActual) return <div style={{color:"red"}}>Sin partido cargado</div>;

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
          <div className="voting-title-modern">MODO PARTICIPATIVO</div>

          {/* Match code section */}
          {partidoActual.codigo && (
            <div className="admin-match-code">
              <div className="admin-match-code-content">
                <div>
                  <div className="admin-match-code-label">CÓDIGO DEL PARTIDO</div>
                  <div className="admin-match-code-value">{partidoActual.codigo}</div>
                </div>
                <button
                  className="admin-copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(partidoActual.codigo);
                    toast.success("¡Código copiado!");
                  }}
                >
                  COPIAR
                </button>
              </div>
            </div>
          )}

          {/* PartidoInfoBox */}
          {partidoActual && <PartidoInfoBox partido={partidoActual} />}

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
              />
              <button
                className="voting-confirm-btn"
                type="submit"
                disabled={loading || isClosing}
              >
                {loading ? "..." : "AGREGAR"}
              </button>
            </form>
          </div>

          {/* Players list section */}
          <div className="admin-players-section">
            <div className="admin-players-title">
              JUGADORES ({jugadores.length})
            </div>
            {jugadores.length === 0 ? (
              <div className="admin-players-empty">
                Aún no hay jugadores agregados
              </div>
            ) : (
              <div className="admin-players-grid">
                {jugadores.map(j => (
                  <div
                    key={j.uuid}
                    className={`admin-player-item${votantes.includes(j.uuid) ? " voted" : ""}`}
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
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="admin-actions">
            <button 
              className="voting-confirm-btn admin-btn-primary" 
              onClick={handleCopyLink}
            >
              LINK PARA JUGADORES
            </button>
            <button 
              className="voting-confirm-btn admin-btn-whatsapp" 
              onClick={handleWhatsApp}
            >
              📱 WHATSAPP
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
              >
                {isClosing ? (
                  <>
                    🔄 CERRANDO VOTACIÓN...
                  </>
                ) : (
                  `CERRAR VOTACIÓN (${jugadores.length} jugadores)`
                )}
              </button>
              
              {/* Warning messages */}
              {hasOddPlayers && (
                <div style={{
                  color: '#DE1C49',
                  fontSize: '14px',
                  fontFamily: 'Oswald, Arial, sans-serif',
                  textAlign: 'center',
                  marginTop: '8px',
                  background: 'rgba(222,28,73,0.1)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(222,28,73,0.3)'
                }}>
                  ⚠️ Necesitas un número PAR de jugadores para formar equipos
                </div>
              )}
              
              {hasNoVotes && !hasOddPlayers && jugadores.length >= 2 && (
                <div style={{
                  color: '#0EA9C6',
                  fontSize: '14px',
                  fontFamily: 'Oswald, Arial, sans-serif',
                  textAlign: 'center',
                  marginTop: '8px',
                  background: 'rgba(14,169,198,0.1)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(14,169,198,0.3)'
                }}>
                  ℹ️ No se detectaron votos. Los equipos se formarán con puntajes por defecto (5/10)
                </div>
              )}
              
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
            >
              VOLVER AL INICIO
            </button>
          </div>

          {copyMsg && (
            <div className="admin-copy-toast">{copyMsg}</div>
          )}
        </>
      )}
    </div>
  );
}
