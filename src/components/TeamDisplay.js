// src/components/TeamDisplay.js
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'react-toastify';
import { PlayerCardTrigger } from './ProfileComponents';
import { TeamDisplayContext } from './PlayerCardTrigger';
import { supabase, notifyTeamsChange } from '../supabase';
import ChatButton from './ChatButton';
import './TeamDisplay.css';
import WhatsappIcon from './WhatsappIcon';
import LoadingSpinner from './LoadingSpinner';

const TeamDisplay = ({ teams, players, onTeamsChange, onBackToHome, isAdmin = false, partidoId = null }) => {
  const [showAverages, setShowAverages] = useState(false);
  const [lockedPlayers, setLockedPlayers] = useState([]);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [realtimeTeams, setRealtimeTeams] = useState(teams);
  const [realtimePlayers, setRealtimePlayers] = useState(players);
  
  // [TEAM_BALANCER_EDIT] Para jugadores no-admin, ocultar promedios por defecto
  useEffect(() => {
    if (!isAdmin) {
      setShowAverages(false);
    }
  }, [isAdmin]);
  
  // Actualizar estado local cuando cambian las props
  useEffect(() => {
    setRealtimeTeams(teams);
    setRealtimePlayers(players);
  }, [teams, players]);
  
  // Polling para invitados para detectar cambios
  useEffect(() => {
    if (!partidoId || isAdmin) return;
    
    console.log('[TEAMDISPLAY_POLLING] Starting polling for guest');
    let lastUpdateTime = null;
    
    const checkForUpdates = async () => {
      try {
        const { data, error } = await supabase
          .from('partidos')
          .select('jugadores')
          .eq('id', partidoId)
          .maybeSingle();
          
        if (error) return;
          
        const currentHash = JSON.stringify(data?.jugadores || []);
        if (currentHash && lastUpdateTime && currentHash !== lastUpdateTime) {
          window.location.reload();
        }
        lastUpdateTime = currentHash;
      } catch (error) {
        console.error('[TEAMDISPLAY_POLLING] Error:', error);
      }
    };
    
    const interval = setInterval(checkForUpdates, 2000);
    checkForUpdates();
    
    return () => clearInterval(interval);
  }, [partidoId, isAdmin]);

  // Remover toast duplicado - se maneja desde AdminPanel

  if (
    !Array.isArray(realtimeTeams) ||
    realtimeTeams.length < 2 ||
    !realtimeTeams.find((t) => t.id === 'equipoA') ||
    !realtimeTeams.find((t) => t.id === 'equipoB')
  ) {
    return <LoadingSpinner size="large" />;
  }

  const getPlayerDetails = (playerId) => {
    return realtimePlayers.find((p) => p.uuid === playerId) || {};
  };

  const handleDragEnd = (result) => {
    // [TEAM_BALANCER_EDIT] Solo admin puede mover jugadores
    if (!isAdmin) {
      toast.error('Solo el admin puede reorganizar los equipos');
      return;
    }
    
    const { source, destination } = result;
    if (!destination) return;

    // Check if player is locked
    const playerId = realtimeTeams[realtimeTeams.findIndex((t) => t.id === source.droppableId)].players[source.index];
    if (lockedPlayers.includes(playerId)) {
      toast.error('Este jugador está bloqueado y no puede ser movido.');
      return;
    }

    const sourceTeamIndex = realtimeTeams.findIndex((t) => t.id === source.droppableId);
    const destTeamIndex = realtimeTeams.findIndex((t) => t.id === destination.droppableId);

    if (sourceTeamIndex !== destTeamIndex) {
      const sourceTeam = realtimeTeams[sourceTeamIndex];
      const destTeam = realtimeTeams[destTeamIndex];

      if (destination.index >= destTeam.players.length) {
        return;
      }

      // Check if destination player is locked
      const destPlayerId = destTeam.players[destination.index];
      if (lockedPlayers.includes(destPlayerId)) {
        toast.error('No puedes intercambiar con un jugador bloqueado.');
        return;
      }

      const newSourcePlayers = Array.from(sourceTeam.players);
      const newDestPlayers = Array.from(destTeam.players);
      const [movedPlayerId] = newSourcePlayers.splice(source.index, 1);
      const [swappedPlayerId] = newDestPlayers.splice(destination.index, 1, movedPlayerId);
      
      newSourcePlayers.splice(source.index, 0, swappedPlayerId);

      const movedPlayer = getPlayerDetails(movedPlayerId);
      const swappedPlayer = getPlayerDetails(swappedPlayerId);

      const newTeams = [...realtimeTeams];
      newTeams[sourceTeamIndex] = { ...sourceTeam, players: newSourcePlayers, score: sourceTeam.score - movedPlayer.score + swappedPlayer.score };
      newTeams[destTeamIndex] = { ...destTeam, players: newDestPlayers, score: destTeam.score - swappedPlayer.score + movedPlayer.score };

      if (Math.abs(newTeams[0].score - newTeams[1].score) > 5) {
        toast.error('La diferencia de puntaje no puede ser mayor a 5.');
        return;
      }
      
      setRealtimeTeams(newTeams);
      onTeamsChange(newTeams);
      
      // Guardar cambios en la base de datos
      if (isAdmin && partidoId) {
        setTimeout(() => notifyTeamsChange(partidoId, newTeams), 100);
      }
      return;
    }

    // Same team reordering
    const team = realtimeTeams[sourceTeamIndex];
    const newPlayerIds = Array.from(team.players);
    
    // Check if destination player is locked
    if (source.index !== destination.index) {
      const destPlayerId = team.players[destination.index];
      if (lockedPlayers.includes(destPlayerId)) {
        toast.error('No puedes intercambiar con un jugador bloqueado.');
        return;
      }
    }
    
    const [removed] = newPlayerIds.splice(source.index, 1);
    newPlayerIds.splice(destination.index, 0, removed);
    const newTeams = realtimeTeams.map((t, i) => (
      i === sourceTeamIndex ? { ...t, players: newPlayerIds } : t
    ));
    setRealtimeTeams(newTeams);
    onTeamsChange(newTeams);
    
    // Notificar cambio para sincronización
    if (isAdmin && partidoId) {
      setTimeout(() => notifyTeamsChange(partidoId), 100);
    }
  };

  const togglePlayerLock = (playerId) => {
    // [TEAM_BALANCER_EDIT] Solo admin puede bloquear/desbloquear jugadores
    if (!isAdmin) {
      return;
    }
    
    if (lockedPlayers.includes(playerId)) {
      setLockedPlayers(lockedPlayers.filter((id) => id !== playerId));
      toast.info('Jugador desbloqueado');
    } else {
      setLockedPlayers([...lockedPlayers, playerId]);
      toast.info('Jugador bloqueado');
    }
  };

  const randomizeTeams = () => {
    // [TEAM_BALANCER_EDIT] Solo admin puede randomizar equipos
    if (!isAdmin) {
      toast.error('Solo el admin puede randomizar los equipos');
      return;
    }
    
    // Don't include locked players in randomization
    let allPlayers = realtimeTeams.flatMap((t) => t.players);
    const lockedPlayersMap = {};
    
    // Create a map of locked players with their current team
    lockedPlayers.forEach((playerId) => {
      const teamIndex = realtimeTeams.findIndex((team) => team.players.includes(playerId));
      if (teamIndex !== -1) {
        lockedPlayersMap[playerId] = realtimeTeams[teamIndex].id;
      }
    });
    
    // Filter out locked players for randomization
    const playersToRandomize = allPlayers.filter((playerId) => !lockedPlayers.includes(playerId));
    playersToRandomize.sort(() => Math.random() - 0.5);
    
    // Create new teams with locked players in their original positions
    const newTeamA = { ...realtimeTeams.find((t) => t.id === 'equipoA'), players: [] };
    const newTeamB = { ...realtimeTeams.find((t) => t.id === 'equipoB'), players: [] };
    
    // First, place locked players in their teams
    lockedPlayers.forEach((playerId) => {
      if (lockedPlayersMap[playerId] === 'equipoA') {
        newTeamA.players.push(playerId);
      } else if (lockedPlayersMap[playerId] === 'equipoB') {
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
    
    const newTeams = realtimeTeams.map((team) => {
      if (team.id === 'equipoA') {
        return newTeamA;
      } else if (team.id === 'equipoB') {
        return newTeamB;
      }
      return team;
    });
    
    setRealtimeTeams(newTeams);
    onTeamsChange(newTeams);
    
    // Guardar cambios en la base de datos
    if (isAdmin && partidoId) {
      setTimeout(() => notifyTeamsChange(partidoId, newTeams), 100);
    }
  };

  const handleWhatsAppShare = () => {
    const teamA = realtimeTeams.find((t) => t.id === 'equipoA');
    const teamB = realtimeTeams.find((t) => t.id === 'equipoB');
    
    const teamAText = `*${teamA.name}* (Puntaje: ${teamA.score.toFixed(2)})\\n${teamA.players.map((pId) => getPlayerDetails(pId).nombre).join('\\n')}`;
    const teamBText = `*${teamB.name}* (Puntaje: ${teamB.score.toFixed(2)})\\n${teamB.players.map((pId) => getPlayerDetails(pId).nombre).join('\\n')}`;
    
    const message = `Equipos armados:\\n\\n${teamAText}\\n\\n${teamBText}`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <TeamDisplayContext.Provider value={true}>
      {/* Chat button para todos los usuarios */}
      <ChatButton partidoId={partidoId} />
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="team-display-container">
          <h2 className="team-display-title">EQUIPOS</h2>
          <div className="teams-wrapper">
            {realtimeTeams.map((team) => (
              <div key={team.id} className="team-container dark-container">
                {editingTeamId === team.id && isAdmin ? (
                  <input
                    type="text"
                    className="team-name-input"
                    value={editingTeamName}
                    onChange={(e) => setEditingTeamName(e.target.value)}
                    onBlur={async () => {
                      if (editingTeamName.trim()) {
                        const newTeams = realtimeTeams.map((t) => 
                          t.id === team.id ? { ...t, name: editingTeamName.trim() } : t,
                        );
                        setRealtimeTeams(newTeams);
                        onTeamsChange(newTeams);
                        
                        // Guardar cambios en la base de datos
                        if (isAdmin && partidoId) {
                          await notifyTeamsChange(partidoId, newTeams);
                        }
                      }
                      setEditingTeamId(null);
                    }}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        if (editingTeamName.trim()) {
                          const newTeams = realtimeTeams.map((t) => 
                            t.id === team.id ? { ...t, name: editingTeamName.trim() } : t,
                          );
                          setRealtimeTeams(newTeams);
                          onTeamsChange(newTeams);
                          
                          // Guardar cambios en la base de datos
                          if (isAdmin && partidoId) {
                            await notifyTeamsChange(partidoId, newTeams);
                          }
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
                    onClick={isAdmin ? () => {
                      setEditingTeamId(team.id);
                      setEditingTeamName(team.name);
                    } : undefined}
                    style={{ cursor: isAdmin ? 'pointer' : 'default' }}
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
                        .filter((playerId) => realtimePlayers.some((p) => p.uuid === playerId))
                        .map((playerId, index) => {
                          const player = getPlayerDetails(playerId);
                          if (!playerId || !player?.nombre) return null;
                          
                          const isLocked = lockedPlayers.includes(playerId);

                          return (
                            <Draggable key={String(playerId)} draggableId={String(playerId)} index={index}>
                              {(provided) => (
                                <div
                                  className={`player-card ${isLocked ? 'locked' : ''} ${!isAdmin ? 'no-admin' : ''}`}
                                  ref={provided.innerRef}
                                  {...(isAdmin ? provided.draggableProps : {})}
                                  {...(isAdmin ? provided.dragHandleProps : {})}
                                  onClick={isAdmin ? () => togglePlayerLock(playerId) : undefined}
                                  style={{ cursor: isAdmin ? 'pointer' : 'default' }}
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
                                    {/* [TEAM_BALANCER_EDIT] Solo admin ve promedios y controles */}
                                    {showAverages && isAdmin && <span className="player-score">{(player.score || 0).toFixed(2)}</span>}
                                    {isLocked && isAdmin && (
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
                {/* Todos ven puntajes de equipos */}
                <div className="team-score-box">
                  Puntaje: {team.score?.toFixed(2) ?? '0'}
                </div>
              </div>
            ))}
          </div>
          <div className="team-actions">
            {/* [TEAM_BALANCER_EDIT] Botones solo para admin */}
            {isAdmin && (
              <div className="team-actions-row">
                <button onClick={randomizeTeams} className="team-action-btn randomize-btn wipe-btn">Randomizar</button>
                <button onClick={() => setShowAverages(!showAverages)} className="team-action-btn averages-btn wipe-btn">
                  {showAverages ? 'Ocultar Promedios' : 'Ver Promedios'}
                </button>
              </div>
            )}
            
            {/* Botón compartir disponible para todos */}
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