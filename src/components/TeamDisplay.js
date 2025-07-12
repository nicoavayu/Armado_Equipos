// src/components/TeamDisplay.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'react-toastify';
import './TeamDisplay.css';
import WhatsappIcon from './WhatsappIcon';
import PlayerCard from './PlayerCard';
import { TEAM_BALANCING, ANIMATION_DURATIONS, UI_SIZES } from '../appConstants';

const TeamDisplay = ({ teams, players, onTeamsChange, onBackToHome }) => {
  const [showAverages, setShowAverages] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [dragOverPlayer, setDragOverPlayer] = useState(null);
  const [showPerfectMatch, setShowPerfectMatch] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [lockedPlayers, setLockedPlayers] = useState(new Set());
  
  // All hooks must be called before any early returns
  const getPlayerDetails = useCallback((playerId) => {
    return players.find(p => p.uuid === playerId) || {};
  }, [players]);
  
  // Memoize all player scores for color coding
  const allPlayerScores = useMemo(() => {
    return players.map(p => p.score || TEAM_BALANCING.DEFAULT_PLAYER_SCORE);
  }, [players]);
  
  const togglePlayerLock = useCallback((playerId) => {
    const teamId = teams.find(t => t.players.includes(playerId))?.id;
    if (!teamId) return;
    
    const teamLockedCount = teams.find(t => t.id === teamId).players.filter(p => lockedPlayers.has(p)).length;
    
    if (lockedPlayers.has(playerId)) {
      const newLocked = new Set(lockedPlayers);
      newLocked.delete(playerId);
      setLockedPlayers(newLocked);
    } else {
      if (teamLockedCount >= TEAM_BALANCING.MAX_LOCKED_PLAYERS_PER_TEAM) {
        toast.error('Máximo 3 jugadores bloqueados por equipo');
        return;
      }
      const newLocked = new Set(lockedPlayers);
      newLocked.add(playerId);
      setLockedPlayers(newLocked);
    }
  }, [teams, lockedPlayers]);

  useEffect(() => {
    const teamA = teams.find(t => t.id === 'equipoA');
    const teamB = teams.find(t => t.id === 'equipoB');
    if (teamA && teamB && Math.abs(teamA.score - teamB.score) < 0.01) {
      toast.success("¡Match Perfecto! Los equipos están balanceados.");
    }
  }, [teams]);
  
  // Get score color class based on value
  const getScoreColorClass = (score, allScores) => {
    if (!allScores.length) return '';
    const sortedScores = [...allScores].sort((a, b) => a - b);
    const min = sortedScores[0];
    const max = sortedScores[sortedScores.length - 1];
    const avg = sortedScores.reduce((sum, s) => sum + s, 0) / sortedScores.length;
    
    if (score <= min + (max - min) * 0.25) return 'score-low';
    if (score < avg) return 'score-below-avg';
    if (score > avg + (max - avg) * 0.5) return 'score-high';
    return 'score-above-avg';
  };

  if (
    !Array.isArray(teams) ||
    teams.length < 2 ||
    !teams.find(t => t.id === "equipoA") ||
    !teams.find(t => t.id === "equipoB")
  ) {
    return (
      <div className="team-display-container">
        <div style={{ 
          padding: '40px 20px', 
          color: '#DE1C49',
          textAlign: 'center',
          fontFamily: 'Oswald, Arial, sans-serif',
          fontSize: '18px',
          background: 'rgba(222,28,73,0.1)',
          borderRadius: '16px',
          border: '2px solid rgba(222,28,73,0.3)'
        }}>
          ⏳ Esperando que se armen ambos equipos...
        </div>
      </div>
    );
  }

  const handleDragEnd = (result) => {
    const { source, destination } = result;
    setDragOverPlayer(null);
    
    if (!destination) return;

    const sourceTeamIndex = teams.findIndex((t) => t.id === source.droppableId);
    const destTeamIndex = teams.findIndex((t) => t.id === destination.droppableId);

    // True swap behavior - always swap positions
    if (sourceTeamIndex !== destTeamIndex) {
      const sourceTeam = teams[sourceTeamIndex];
      const destTeam = teams[destTeamIndex];

      const newSourcePlayers = Array.from(sourceTeam.players);
      const newDestPlayers = Array.from(destTeam.players);
      
      const [movedPlayerId] = newSourcePlayers.splice(source.index, 1);
      const [swappedPlayerId] = newDestPlayers.splice(destination.index, 1, movedPlayerId);
      
      newSourcePlayers.splice(source.index, 0, swappedPlayerId);

      const movedPlayer = getPlayerDetails(movedPlayerId);
      const swappedPlayer = getPlayerDetails(swappedPlayerId);

      const newTeams = [...teams];
      newTeams[sourceTeamIndex] = { 
        ...sourceTeam, 
        players: newSourcePlayers, 
        score: sourceTeam.score - (movedPlayer.score || 0) + (swappedPlayer.score || 0)
      };
      newTeams[destTeamIndex] = { 
        ...destTeam, 
        players: newDestPlayers, 
        score: destTeam.score - (swappedPlayer.score || 0) + (movedPlayer.score || 0)
      };
      
      onTeamsChange(newTeams);
    } else {
      // Same team - reorder
      const team = teams[sourceTeamIndex];
      const newPlayerIds = Array.from(team.players);
      const [removed] = newPlayerIds.splice(source.index, 1);
      newPlayerIds.splice(destination.index, 0, removed);
      const newTeams = teams.map((t, i) => (
        i === sourceTeamIndex ? { ...t, players: newPlayerIds } : t
      ));
      onTeamsChange(newTeams);
    }
  };


  
  const randomizeTeams = () => {
    const teamA = teams.find(t => t.id === 'equipoA');
    const teamB = teams.find(t => t.id === 'equipoB');
    
    const lockedA = teamA.players.filter(p => lockedPlayers.has(p));
    const lockedB = teamB.players.filter(p => lockedPlayers.has(p));
    const unlockedPlayers = teams.flatMap(t => t.players).filter(p => !lockedPlayers.has(p));
    
    const totalPlayers = teamA.players.length + teamB.players.length;
    const playersPerTeam = Math.ceil(totalPlayers / 2);
    const unlockedNeededA = playersPerTeam - lockedA.length;
    const unlockedNeededB = playersPerTeam - lockedB.length;
    
    if (unlockedNeededA < 0 || unlockedNeededB < 0 || unlockedNeededA + unlockedNeededB !== unlockedPlayers.length) {
      toast.error('No se puede balancear con los jugadores bloqueados actuales');
      return;
    }
    
    const validCombinations = [];
    
    // Try up to max attempts to find acceptable ones
    for (let attempt = 0; attempt < TEAM_BALANCING.MAX_SHUFFLE_ATTEMPTS; attempt++) {
      const shuffled = [...unlockedPlayers].sort(() => Math.random() - 0.5);
      const teamAUnlocked = shuffled.slice(0, unlockedNeededA);
      const teamBUnlocked = shuffled.slice(unlockedNeededA);
      
      const teamAPlayers = [...lockedA, ...teamAUnlocked];
      const teamBPlayers = [...lockedB, ...teamBUnlocked];
      
      const scoreA = teamAPlayers.reduce((acc, playerId) => acc + (getPlayerDetails(playerId).score || 0), 0);
      const scoreB = teamBPlayers.reduce((acc, playerId) => acc + (getPlayerDetails(playerId).score || 0), 0);
      const scoreDiff = Math.abs(scoreA - scoreB);
      
      if (scoreDiff <= TEAM_BALANCING.MAX_SCORE_DIFFERENCE) {
        validCombinations.push({
          teamA: teamAPlayers,
          teamB: teamBPlayers,
          scoreA,
          scoreB,
          scoreDiff
        });
      }
    }
    
    if (validCombinations.length === 0) {
      toast.error('No se pudo balancear los equipos. Intenta desbloquear algunos jugadores.');
      return;
    }
    
    // Pick a random valid combination for variety
    const selectedCombo = validCombinations[Math.floor(Math.random() * validCombinations.length)];
    
    const newTeams = teams.map(team => {
      if (team.id === "equipoA") {
        return { ...team, players: selectedCombo.teamA, score: selectedCombo.scoreA };
      } else if (team.id === "equipoB") {
        return { ...team, players: selectedCombo.teamB, score: selectedCombo.scoreB };
      }
      return team;
    });
    
    onTeamsChange(newTeams);
    
    // Only show perfect match celebration for exact ties
    if (selectedCombo.scoreDiff === TEAM_BALANCING.PERFECT_MATCH_SCORE_DIFF) {
      setShowPerfectMatch(true);
      setShowConfetti(true);
      setTimeout(() => {
        setShowPerfectMatch(false);
        setShowConfetti(false);
      }, ANIMATION_DURATIONS.PERFECT_MATCH_CELEBRATION);
    }
  };
  
  const handleTeamNameChange = (teamId, newName) => {
    const newTeams = teams.map(team => 
      team.id === teamId ? { ...team, name: newName } : team
    );
    onTeamsChange(newTeams);
    setEditingTeam(null);
  };

  const handleWhatsAppShare = () => {
    const teamA = teams.find(t => t.id === 'equipoA');
    const teamB = teams.find(t => t.id === 'equipoB');
    
    const teamAText = `*${teamA.name}* (Puntaje: ${teamA.score.toFixed(2)})\n${teamA.players.map(pId => getPlayerDetails(pId).nombre).join('\n')}`;
    const teamBText = `*${teamB.name}* (Puntaje: ${teamB.score.toFixed(2)})\n${teamB.players.map(pId => getPlayerDetails(pId).nombre).join('\n')}`;
    
    const message = `Equipos armados:\n\n${teamAText}\n\n${teamBText}`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="team-display-container">
        <h2 className="team-display-title">EQUIPOS ARMADOS</h2>
        
        <div className="teams-wrapper">
          {teams.map((team) => (
            <div key={team.id} className="team-container">
              <div className="team-header">
                {editingTeam === team.id ? (
                  <input
                    className="team-name-input"
                    type="text"
                    defaultValue={team.name}
                    autoFocus
                    onBlur={(e) => handleTeamNameChange(team.id, e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleTeamNameChange(team.id, e.target.value);
                      }
                    }}
                  />
                ) : (
                  <h3 
                    className="team-name" 
                    onClick={() => setEditingTeam(team.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Editar nombre del ${team.name}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setEditingTeam(team.id);
                      }
                    }}
                  >
                    {team.name}
                  </h3>
                )}
              </div>
              
              <Droppable droppableId={team.id} key={team.id}>
                {(provided) => (
                  <div
                    className="players-grid"
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                  >
                    {team.players.length === 0 ? (
                      <div className="team-empty-state">
                        No hay jugadores asignados
                      </div>
                    ) : (
                      team.players
                        .filter(playerId => players.some(p => p.uuid === playerId))
                        .map((playerId, index) => {
                          const player = getPlayerDetails(playerId);
                          if (!playerId || !player?.nombre) return null;

                          return (
                            <Draggable key={String(playerId)} draggableId={String(playerId)} index={index}>
                              {(provided, snapshot) => (
                                <PlayerCard
                                  player={player}
                                  playerId={playerId}
                                  isLocked={lockedPlayers.has(playerId)}
                                  isDragging={snapshot.isDragging}
                                  isDragOver={dragOverPlayer === playerId && !snapshot.isDragging}
                                  showAverages={showAverages}
                                  scoreColorClass={getScoreColorClass(
                                    player.score || TEAM_BALANCING.DEFAULT_PLAYER_SCORE,
                                    allPlayerScores
                                  )}
                                  onToggleLock={togglePlayerLock}
                                  provided={provided}
                                  onDragEnter={(e) => {
                                    e.preventDefault();
                                    if (!snapshot.isDragging) {
                                      setDragOverPlayer(playerId);
                                    }
                                  }}
                                  onDragLeave={(e) => {
                                    e.preventDefault();
                                    setDragOverPlayer(null);
                                  }}
                                  onDragOver={(e) => e.preventDefault()}
                                />
                              )}
                            </Draggable>
                          );
                        })
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
              
              <div className="team-score-box">
                PUNTAJE TOTAL: {team.score?.toFixed(1) ?? "0.0"}
              </div>
            </div>
          ))}
        </div>
        
        {showPerfectMatch && (
          <div className="perfect-match-overlay">
            <div className="perfect-match-message">
              ¡PARTIDO PAREJO!
            </div>
          </div>
        )}
        
        {showConfetti && <div className="confetti-container"></div>}
        
        <div className="team-actions">
          <button onClick={randomizeTeams} className="team-action-btn randomize-btn wipe-btn" aria-label="Mezclar jugadores entre equipos">
            <span>MEZCLAR EQUIPOS</span>
          </button>
          
          <button 
            onClick={() => setShowAverages(!showAverages)} 
            className="team-action-btn averages-btn wipe-btn"
            aria-label={showAverages ? 'Ocultar puntajes de jugadores' : 'Mostrar puntajes de jugadores'}
          >
            <span>{showAverages ? 'OCULTAR PUNTAJES' : 'VER PUNTAJES'}</span>
          </button>
          
          <button onClick={handleWhatsAppShare} className="team-action-btn whatsapp-btn wipe-btn" aria-label="Compartir equipos por WhatsApp">
            <span><WhatsappIcon size={UI_SIZES.WHATSAPP_ICON_SIZE} style={{marginRight: 8}} />COMPARTIR POR WHATSAPP</span>
          </button>
          
          <button onClick={onBackToHome} className="team-action-btn back-btn wipe-btn" aria-label="Volver al menú principal">
            <span>VOLVER AL INICIO</span>
          </button>
        </div>
      </div>
    </DragDropContext>
  );
};

export default TeamDisplay;
