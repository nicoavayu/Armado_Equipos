// src/components/TeamDisplay.js
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'react-toastify';
import { PlayerCardTrigger } from './ProfileComponents';
import { TeamDisplayContext } from './PlayerCardTrigger';
import './TeamDisplay.css';
import WhatsappIcon from './WhatsappIcon';
import LoadingSpinner from './LoadingSpinner';

const TeamDisplay = ({ teams, players, onTeamsChange, onBackToHome }) => {
  const [showAverages, setShowAverages] = useState(false);
  const [lockedPlayers, setLockedPlayers] = useState([]);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [editingTeamName, setEditingTeamName] = useState('');

  useEffect(() => {
    // Show only one toast notification when teams are generated
    toast.success("¡Equipos generados exitosamente!");
    
    // Show additional toast if teams are perfectly balanced
    const teamA = teams.find(t => t.id === 'equipoA');
    const teamB = teams.find(t => t.id === 'equipoB');
    if (teamA && teamB && Math.abs(teamA.score - teamB.score) < 0.01) {
      toast.success("¡MATCH PERFECTO! Equipos perfectamente balanceados.");
    }
  }, []);  // Empty dependency array to run only once when component mounts

  if (
    !Array.isArray(teams) ||
    teams.length < 2 ||
    !teams.find(t => t.id === "equipoA") ||
    !teams.find(t => t.id === "equipoB")
  ) {
    return <LoadingSpinner size="large" />;
  }

  const getPlayerDetails = (playerId) => {
    return players.find(p => p.uuid === playerId) || {};
  };

  const handleDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;

    // Check if player is locked
    const playerId = teams[teams.findIndex((t) => t.id === source.droppableId)].players[source.index];
    if (lockedPlayers.includes(playerId)) {
      toast.error("Este jugador está bloqueado y no puede ser movido.");
      return;
    }

    const sourceTeamIndex = teams.findIndex((t) => t.id === source.droppableId);
    const destTeamIndex = teams.findIndex((t) => t.id === destination.droppableId);

    if (sourceTeamIndex !== destTeamIndex) {
      const sourceTeam = teams[sourceTeamIndex];
      const destTeam = teams[destTeamIndex];

      if (destination.index >= destTeam.players.length) {
        return;
      }

      // Check if destination player is locked
      const destPlayerId = destTeam.players[destination.index];
      if (lockedPlayers.includes(destPlayerId)) {
        toast.error("No puedes intercambiar con un jugador bloqueado.");
        return;
      }

      const newSourcePlayers = Array.from(sourceTeam.players);
      const newDestPlayers = Array.from(destTeam.players);
      const [movedPlayerId] = newSourcePlayers.splice(source.index, 1);
      const [swappedPlayerId] = newDestPlayers.splice(destination.index, 1, movedPlayerId);
      
      newSourcePlayers.splice(source.index, 0, swappedPlayerId);

      const movedPlayer = getPlayerDetails(movedPlayerId);
      const swappedPlayer = getPlayerDetails(swappedPlayerId);

      const newTeams = [...teams];
      newTeams[sourceTeamIndex] = { ...sourceTeam, players: newSourcePlayers, score: sourceTeam.score - movedPlayer.score + swappedPlayer.score };
      newTeams[destTeamIndex] = { ...destTeam, players: newDestPlayers, score: destTeam.score - swappedPlayer.score + movedPlayer.score };

      if (Math.abs(newTeams[0].score - newTeams[1].score) > 5) {
        toast.error("La diferencia de puntaje no puede ser mayor a 5.");
        return;
      }
      
      onTeamsChange(newTeams);
      return;
    }

    // Same team reordering
    const team = teams[sourceTeamIndex];
    const newPlayerIds = Array.from(team.players);
    
    // Check if destination player is locked
    if (source.index !== destination.index) {
      const destPlayerId = team.players[destination.index];
      if (lockedPlayers.includes(destPlayerId)) {
        toast.error("No puedes intercambiar con un jugador bloqueado.");
        return;
      }
    }
    
    const [removed] = newPlayerIds.splice(source.index, 1);
    newPlayerIds.splice(destination.index, 0, removed);
    const newTeams = teams.map((t, i) => (
      i === sourceTeamIndex ? { ...t, players: newPlayerIds } : t
    ));
    onTeamsChange(newTeams);
  };

  const togglePlayerLock = (playerId) => {
    if (lockedPlayers.includes(playerId)) {
      setLockedPlayers(lockedPlayers.filter(id => id !== playerId));
      toast.info("Jugador desbloqueado");
    } else {
      setLockedPlayers([...lockedPlayers, playerId]);
      toast.info("Jugador bloqueado");
    }
  };

  const randomizeTeams = () => {
    // Don't include locked players in randomization
    let allPlayers = teams.flatMap(t => t.players);
    const lockedPlayersMap = {};
    
    // Create a map of locked players with their current team
    lockedPlayers.forEach(playerId => {
      const teamIndex = teams.findIndex(team => team.players.includes(playerId));
      if (teamIndex !== -1) {
        lockedPlayersMap[playerId] = teams[teamIndex].id;
      }
    });
    
    // Filter out locked players for randomization
    const playersToRandomize = allPlayers.filter(playerId => !lockedPlayers.includes(playerId));
    playersToRandomize.sort(() => Math.random() - 0.5);
    
    // Create new teams with locked players in their original positions
    const newTeamA = { ...teams.find(t => t.id === "equipoA"), players: [] };
    const newTeamB = { ...teams.find(t => t.id === "equipoB"), players: [] };
    
    // First, place locked players in their teams
    lockedPlayers.forEach(playerId => {
      if (lockedPlayersMap[playerId] === "equipoA") {
        newTeamA.players.push(playerId);
      } else if (lockedPlayersMap[playerId] === "equipoB") {
        newTeamB.players.push(playerId);
      }
    });
    
    // Then distribute remaining players
    const remainingCount = playersToRandomize.length;
    const teamANeeds = Math.ceil(allPlayers.length / 2) - newTeamA.players.length;
    const teamBNeeds = allPlayers.length - Math.ceil(allPlayers.length / 2) - newTeamB.players.length;
    
    newTeamA.players = [...newTeamA.players, ...playersToRandomize.slice(0, teamANeeds)];
    newTeamB.players = [...newTeamB.players, ...playersToRandomize.slice(teamANeeds)];
    
    // Calculate scores
    newTeamA.score = newTeamA.players.reduce((acc, playerId) => acc + (getPlayerDetails(playerId).score || 0), 0);
    newTeamB.score = newTeamB.players.reduce((acc, playerId) => acc + (getPlayerDetails(playerId).score || 0), 0);
    
    const newTeams = teams.map(team => {
      if (team.id === "equipoA") {
        return newTeamA;
      } else if (team.id === "equipoB") {
        return newTeamB;
      }
      return team;
    });
    
    onTeamsChange(newTeams);
  };

  const handleWhatsAppShare = () => {
    const teamA = teams.find(t => t.id === 'equipoA');
    const teamB = teams.find(t => t.id === 'equipoB');
    
    const teamAText = `*${teamA.name}* (Puntaje: ${teamA.score.toFixed(2)})\\n${teamA.players.map(pId => getPlayerDetails(pId).nombre).join('\\n')}`;
    const teamBText = `*${teamB.name}* (Puntaje: ${teamB.score.toFixed(2)})\\n${teamB.players.map(pId => getPlayerDetails(pId).nombre).join('\\n')}`;
    
    const message = `Equipos armados:\\n\\n${teamAText}\\n\\n${teamBText}`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  return (
    <TeamDisplayContext.Provider value={true}>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="team-display-container">
          <h2 className="team-display-title">EQUIPOS</h2>
          <div className="teams-wrapper">
            {teams.map((team) => (
              <div key={team.id} className="team-container dark-container">
                {editingTeamId === team.id ? (
                  <input
                    type="text"
                    className="team-name-input"
                    value={editingTeamName}
                    onChange={(e) => setEditingTeamName(e.target.value)}
                    onBlur={() => {
                      if (editingTeamName.trim()) {
                        const newTeams = teams.map(t => 
                          t.id === team.id ? { ...t, name: editingTeamName.trim() } : t
                        );
                        onTeamsChange(newTeams);
                      }
                      setEditingTeamId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingTeamName.trim()) {
                          const newTeams = teams.map(t => 
                            t.id === team.id ? { ...t, name: editingTeamName.trim() } : t
                          );
                          onTeamsChange(newTeams);
                        }
                        setEditingTeamId(null);
                      } else if (e.key === 'Escape') {
                        setEditingTeamId(null);
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <h3 
                    className="team-name" 
                    onClick={() => {
                      setEditingTeamId(team.id);
                      setEditingTeamName(team.name);
                    }}
                  >
                    {team.name}
                  </h3>
                )}
                <Droppable droppableId={team.id} key={team.id}>
                  {(provided) => (
                    <div
                      className="players-grid"
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                    >
                      {team.players
                        .filter(playerId => players.some(p => p.uuid === playerId))
                        .map((playerId, index) => {
                          const player = getPlayerDetails(playerId);
                          if (!playerId || !player?.nombre) return null;
                          
                          const isLocked = lockedPlayers.includes(playerId);

                          return (
                            <Draggable key={String(playerId)} draggableId={String(playerId)} index={index}>
                              {(provided) => (
                                <div
                                  className={`player-card ${isLocked ? 'locked' : ''}`}
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => togglePlayerLock(playerId)}
                                >
                                <div className="player-card-content">
                                  <div className="player-avatar-container">
                                    <div className="player-avatar-wrapper">
                                      <img
                                        src={player.avatar_url || 'https://api.dicebear.com/6.x/pixel-art/svg?seed=default'}
                                        alt={player.nombre}
                                        className="player-avatar"
                                      />
                                    </div>
                                  </div>
                                  <span>{player.nombre}</span>
                                  {showAverages && <span className="player-score">{(player.score || 0).toFixed(2)}</span>}
                                  {isLocked && (
                                    <span className="lock-icon">
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                                        <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                                      </svg>
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
              <div className="team-score-box">
                Puntaje: {team.score?.toFixed(2) ?? "0"}
              </div>
            </div>
          ))}
        </div>
        <div className="team-actions">
          <div className="team-actions-row">
            <button onClick={randomizeTeams} className="team-action-btn randomize-btn wipe-btn">Randomizar</button>
            <button onClick={() => setShowAverages(!showAverages)} className="team-action-btn averages-btn wipe-btn">
              {showAverages ? 'Ocultar Promedios' : 'Ver Promedios'}
            </button>
          </div>
          <button onClick={handleWhatsAppShare} className="team-action-btn whatsapp-btn wipe-btn">
            <WhatsappIcon /> Compartir
          </button>
        </div>
      </div>
    </DragDropContext>
    </TeamDisplayContext.Provider>
  );
};

export default TeamDisplay;