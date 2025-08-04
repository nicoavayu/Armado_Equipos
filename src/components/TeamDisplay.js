// src/components/TeamDisplay.js
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'react-toastify';
import { PlayerCardTrigger } from './ProfileComponents';
import { TeamDisplayContext } from './PlayerCardTrigger';
import { supabase, saveTeamsToDatabase, getTeamsFromDatabase, subscribeToTeamsChanges, unsubscribeFromTeamsChanges } from '../supabase';
import ChatButton from './ChatButton';
import PageTitle from './PageTitle';
import PlayerBadges from './PlayerBadges';
import './TeamDisplay.css';
import WhatsappIcon from './WhatsappIcon';
import LoadingSpinner from './LoadingSpinner';

const TeamDisplay = ({ teams, players, onTeamsChange, onBackToHome, isAdmin = false, partidoId = null, nombre, fecha, hora, sede }) => {
  const [showAverages, setShowAverages] = useState(false);
  const [lockedPlayers, setLockedPlayers] = useState([]);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [realtimeTeams, setRealtimeTeams] = useState(teams);
  const [realtimePlayers, setRealtimePlayers] = useState(players);
  const [teamsSubscription, setTeamsSubscription] = useState(null);
  
  // [TEAM_BALANCER_EDIT] Para jugadores no-admin, ocultar promedios por defecto
  useEffect(() => {
    if (!isAdmin) {
      setShowAverages(false);
    }
  }, [isAdmin]);
  
  // Load teams from database on mount
  useEffect(() => {
    const loadTeamsFromDatabase = async () => {
      if (!partidoId) return;
      
      try {
        const savedTeams = await getTeamsFromDatabase(partidoId);
        if (savedTeams && Array.isArray(savedTeams) && savedTeams.length === 2) {
          console.log('[TEAMS_LOAD] Loading teams from database:', savedTeams);
          setRealtimeTeams(savedTeams);
          onTeamsChange(savedTeams);
        } else {
          // Fallback to props if no saved teams
          setRealtimeTeams(teams);
        }
      } catch (error) {
        console.error('[TEAMS_LOAD] Error loading teams:', error);
        setRealtimeTeams(teams);
      }
    };
    
    loadTeamsFromDatabase();
  }, [partidoId]);
  
  // Update teams when props change
  useEffect(() => {
    setRealtimeTeams(teams);
  }, [teams]);
  
  // Update players when props change
  useEffect(() => {
    setRealtimePlayers(players);
  }, [players]);
  
  // Subscribe to real-time team changes
  useEffect(() => {
    if (!partidoId) return;
    
    const subscription = subscribeToTeamsChanges(partidoId, (newTeams) => {
      console.log('[TEAMS_REALTIME] Received team update:', newTeams);
      if (newTeams && Array.isArray(newTeams) && newTeams.length === 2) {
        setRealtimeTeams(newTeams);
        onTeamsChange(newTeams);
      }
    });
    
    setTeamsSubscription(subscription);
    
    return () => {
      if (subscription) {
        unsubscribeFromTeamsChanges(subscription);
      }
    };
  }, [partidoId, onTeamsChange]);
  




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
  
  // Función para obtener color basado en el puntaje (1-10)
  const getScoreColor = (score) => {
    const normalizedScore = Math.max(1, Math.min(10, score || 5)); // Clamp entre 1-10
    
    if (normalizedScore <= 3) {
      // Rojo para puntajes bajos (1-3)
      const intensity = (normalizedScore - 1) / 2; // 0 a 1
      return `rgba(222, 28, 73, ${0.7 + intensity * 0.3})`; // Más intenso para más bajo
    } else if (normalizedScore <= 5) {
      // Naranja para puntajes medio-bajos (3-5)
      return 'rgba(255, 165, 0, 0.9)';
    } else if (normalizedScore <= 7) {
      // Azul para puntajes medio-altos (5-7)
      return 'rgba(14, 169, 198, 0.9)';
    } else {
      // Verde para puntajes altos (7-10)
      const intensity = (normalizedScore - 7) / 3; // 0 a 1
      return `rgba(0, 212, 155, ${0.7 + intensity * 0.3})`; // Más intenso para más alto
    }
  };

  const handleDragEnd = async (result) => {
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
      
      // Save changes to database
      if (isAdmin && partidoId) {
        try {
          await saveTeamsToDatabase(partidoId, newTeams);
        } catch (error) {
          console.error('[TEAMS_SAVE] Error saving teams:', error);
        }
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
    
    // Save changes to database
    if (isAdmin && partidoId) {
      try {
        await saveTeamsToDatabase(partidoId, newTeams);
      } catch (error) {
        console.error('[TEAMS_SAVE] Error saving teams:', error);
      }
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

  const randomizeTeams = async () => {
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
    
    // Save changes to database
    if (isAdmin && partidoId) {
      try {
        await saveTeamsToDatabase(partidoId, newTeams);
      } catch (error) {
        console.error('[TEAMS_SAVE] Error saving teams:', error);
      }
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
          <PageTitle onBack={onBackToHome}>EQUIPOS ARMADOS</PageTitle>
          
          <div className="team-display-content" style={{ paddingTop: '90px' }}>
            {/* Match header with large title and details */}
            {(nombre || fecha || hora || sede) && (
              <div className="match-header-large">
                {nombre && (
                  <div className="match-title-large">
                    {nombre}
                  </div>
                )}
                <div className="match-details-large">
                  {fecha && new Date(fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
                    weekday: 'long', 
                    day: 'numeric', 
                    month: 'numeric', 
                  }).toUpperCase()}
                  {hora && ` · ${hora}`}
                  {sede && (
                    <>
                      {' · '}
                      <a 
                        href={`https://www.google.com/maps/search/${encodeURIComponent(sede.split(/[,(]/)[0].trim())}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="venue-link-large"
                      >
                        {sede.split(/[,(]/)[0].trim()}
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
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
                          
                          // Save changes to database
                          if (isAdmin && partidoId) {
                            try {
                              await saveTeamsToDatabase(partidoId, newTeams);
                            } catch (error) {
                              console.error('[TEAMS_SAVE] Error saving teams:', error);
                            }
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
                            
                            // Save changes to database
                            if (isAdmin && partidoId) {
                              try {
                                await saveTeamsToDatabase(partidoId, newTeams);
                              } catch (error) {
                                console.error('[TEAMS_SAVE] Error saving teams:', error);
                              }
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
                                      {showAverages && isAdmin && (
                                        <span 
                                          className="player-score"
                                          style={{ 
                                            background: getScoreColor(player.score),
                                            borderColor: getScoreColor(player.score).replace('0.9', '0.5'),
                                          }}
                                        >
                                          {(player.score || 0).toFixed(2)}
                                        </span>
                                      )}
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
            {/* Botones de acción */}
            <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '16px auto 0', textAlign: 'center' }}>
              {isAdmin && (
                <div style={{ display: 'flex', gap: '8px', width: '100%', marginBottom: '12px' }}>
                  <button 
                    className="admin-btn-orange" 
                    onClick={randomizeTeams}
                    style={{ flex: 1 }}
                  >
                    RANDOMIZAR
                  </button>
                
                  <button 
                    className="admin-btn-blue" 
                    onClick={() => setShowAverages(!showAverages)}
                    style={{ flex: 1 }}
                  >
                    {showAverages ? 'OCULTAR PROMEDIOS' : 'VER PROMEDIOS'}
                  </button>
                </div>
              )}
              
              <button 
                className="admin-btn-green" 
                onClick={handleWhatsAppShare}
                style={{ width: '100%' }}
              >
                <WhatsappIcon size={16} style={{ marginRight: 8 }} />
                COMPARTIR
              </button>
            </div>
          </div>
        </div>
      </DragDropContext>
    </TeamDisplayContext.Provider>
  );
};

export default TeamDisplay;