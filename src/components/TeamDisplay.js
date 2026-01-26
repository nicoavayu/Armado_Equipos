// src/components/TeamDisplay.js
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'react-toastify';
import { PlayerCardTrigger } from './ProfileComponents';
import { TeamDisplayContext } from './PlayerCardTrigger';
import { supabase, saveTeamsToDatabase, getTeamsFromDatabase, subscribeToTeamsChanges, unsubscribeFromTeamsChanges } from '../supabase';
import ChatButton from './ChatButton';
import PageTitle from './PageTitle';
import MatchInfoSection from './MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import WhatsappIcon from './WhatsappIcon';
import LoadingSpinner from './LoadingSpinner';

const TeamDisplay = ({ teams, players, onTeamsChange, onBackToHome, isAdmin = false, partidoId = null, nombre, fecha, hora, sede, modalidad, tipo }) => {
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
    } else {
      setLockedPlayers([...lockedPlayers, playerId]);
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
        <div className="w-full max-w-full p-0 mx-auto flex flex-col gap-3 box-border lg:max-w-[1000px]">
          <PageTitle onBack={onBackToHome}>EQUIPOS ARMADOS</PageTitle>
          <MatchInfoSection
            partido={normalizePartidoForHeader(typeof partidoId === 'object' ? partidoId : undefined)}
            fecha={fecha}
            hora={hora}
            sede={sede}
            modalidad={modalidad}
            tipo={tipo}
            precio={(typeof partidoId === 'object' && partidoId?.valor_cancha) ? partidoId?.valor_cancha : undefined}
          />
          <div className="p-0 flex-1 flex flex-col gap-3 pt-5">

            <div className="flex flex-row gap-4 w-[min(90vw,980px)] mx-auto mb-[10px] box-border">
              {realtimeTeams.map((team) => (
                <div key={team.id} className="bg-white/12 border-2 border-white/25 rounded-2xl p-4 pb-1 w-[calc(50%-8px)] box-border transition-all shadow-md flex flex-col h-auto min-h-auto hover:bg-white/15 hover:border-white/35 hover:shadow-lg md:p-[18px] lg:p-6 sm:p-3 sm:pb-2">
                  {editingTeamId === team.id && isAdmin ? (
                    <input
                      type="text"
                      className="font-bebas text-lg text-[#333] bg-white/95 border-2 border-[#0EA9C6] rounded-lg px-3 py-2 text-center tracking-widest uppercase w-full box-border shadow-sm md:text-xl lg:text-2xl"
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
                      className="font-bebas text-lg text-white m-0 tracking-widest uppercase shadow-sm cursor-pointer px-3 py-2 rounded-lg transition-all bg-transparent break-words text-center block w-full hover:bg-white/10 md:text-xl lg:text-2xl mb-4 flex justify-center items-center"
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
                        className="flex flex-col gap-1 mb-1.5 w-full flex-1"
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
                              <Draggable key={String(playerId)} draggableId={String(playerId)} index={index} isDragDisabled={!isAdmin}>
                                {(provided, snapshot) => (
                                  <div
                                    className={`bg-white/15 border-2 border-white/20 rounded-md py-1.5 px-2.5 flex items-center gap-2.5 cursor-grab text-white transition-all min-h-[32px] relative w-full box-border overflow-hidden select-none hover:bg-white/20 hover:border-white/40 hover:-translate-y-px hover:shadow-md active:bg-white/25 active:scale-[0.98] sm:min-h-[28px] sm:py-1 sm:gap-2 md:min-h-[36px] md:py-2 md:px-3 lg:min-h-[40px] lg:py-3 lg:px-4 ${isLocked ? 'bg-[#FFC107]/20 border-[#FFC107]/60 shadow-[0_0_8px_rgba(255,193,7,0.3)] hover:bg-[#FFC107]/30 hover:border-[#FFC107]/80 hover:shadow-[0_0_12px_rgba(255,193,7,0.4)]' : ''} ${!isAdmin ? 'cursor-default pointer-events-none' : ''} ${snapshot.isDragging ? 'scale-105 rotate-2 shadow-xl z-50 !bg-white/30 !border-white/80 opacity-90' : ''}`}
                                    ref={provided.innerRef}
                                    {...(isAdmin ? provided.draggableProps : {})}
                                    {...(isAdmin ? provided.dragHandleProps : {})}
                                    onClick={isAdmin ? () => togglePlayerLock(playerId) : undefined}
                                    style={{
                                      cursor: isAdmin ? 'grab' : 'default',
                                      ...provided.draggableProps.style
                                    }}
                                  >
                                    <div className="flex items-center gap-2.5 w-full h-full sm:gap-2">
                                      <div className="flex items-center justify-center">
                                        <div className="flex items-center justify-center">
                                          <img
                                            src={player.avatar_url || 'https://api.dicebear.com/6.x/pixel-art/svg?seed=default'}
                                            alt={player.nombre}
                                            className="w-7 h-7 rounded-full object-cover border border-white/40 shrink-0 sm:w-6 sm:h-6 md:w-8 md:h-8 lg:w-10 lg:h-10"
                                          />
                                        </div>
                                      </div>
                                      <span className="font-oswald text-[13px] font-semibold text-white flex-1 shadow-sm overflow-hidden text-ellipsis whitespace-nowrap min-w-0 max-w-[140px] sm:text-[11px] sm:max-w-[100px] md:text-sm md:max-w-[150px] lg:text-base lg:max-w-[180px]">{player.nombre}</span>
                                      {/* [TEAM_BALANCER_EDIT] Solo admin ve promedios y controles */}
                                      {showAverages && isAdmin && (
                                        <span
                                          className="font-bebas text-xs font-bold text-white bg-[#22293b]/90 px-2 py-1 rounded-md border border-white/20 shrink-0 whitespace-nowrap shadow-sm sm:text-[10px] sm:px-1.5 sm:py-0.5 md:text-[13px] lg:text-[15px] lg:px-3 lg:py-1.5"
                                          style={{
                                            background: getScoreColor(player.score),
                                            borderColor: getScoreColor(player.score).replace('0.9', '0.5'),
                                          }}
                                        >
                                          {(player.score || 0).toFixed(2)}
                                        </span>
                                      )}
                                      {isLocked && isAdmin && (
                                        <span className="text-base text-[#FFC107] shadow-sm shrink-0 ml-auto mr-1 p-1 rounded bg-[#FFC107]/20 border border-[#FFC107]/40 animate-pulse lg:text-lg sm:text-sm sm:p-0.5">
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
                  <div className="bg-white/20 border-2 border-white/30 text-white p-[8px_6px] rounded-lg text-center font-bebas text-[13px] font-bold tracking-[0.5px] shadow-sm w-full box-border break-words mt-1.5 mb-0 md:text-[15px] md:p-[10px_8px] lg:text-base lg:p-[12px_10px] sm:text-[11px] sm:p-[6px_4px]">
                    Puntaje: {team.score?.toFixed(2) ?? '0'}
                  </div>
                </div>
              ))}
            </div>
            {/* Botones de acción */}
            <div className="w-[min(90vw,980px)] mx-auto mt-4 text-center box-border">
              {isAdmin && (
                <div className="flex gap-2 w-full mb-3">
                  <button
                    className="flex-1 font-bebas text-base text-white bg-white/20 border-2 border-white/40 rounded-[10px] tracking-[0.05em] p-0 m-0 h-[50px] cursor-pointer font-bold transition-all relative overflow-hidden box-border flex items-center justify-center gap-2 hover:bg-white/30 hover:border-white/60 hover:-translate-y-px active:scale-[0.98] sm:h-[46px] sm:text-[1.3rem] md:h-[52px] md:text-[1.5rem] lg:h-[54px] lg:text-[1.6rem] bg-orange-500/80 hover:bg-orange-600/90 border-orange-400"
                    onClick={randomizeTeams}
                  >
                    RANDOMIZAR
                  </button>

                  <button
                    className="flex-1 font-bebas text-base text-white bg-white/20 border-2 border-white/40 rounded-[10px] tracking-[0.05em] p-0 m-0 h-[50px] cursor-pointer font-bold transition-all relative overflow-hidden box-border flex items-center justify-center gap-2 hover:bg-white/30 hover:border-white/60 hover:-translate-y-px active:scale-[0.98] sm:h-[46px] sm:text-[1.3rem] md:h-[52px] md:text-[1.5rem] lg:h-[54px] lg:text-[1.6rem] bg-blue-500/80 hover:bg-blue-600/90 border-blue-400"
                    onClick={() => setShowAverages(!showAverages)}
                  >
                    {showAverages ? 'OCULTAR PROMEDIOS' : 'VER PROMEDIOS'}
                  </button>
                </div>
              )}

              <button
                className="w-full font-bebas text-base text-white bg-white/20 border-2 border-white/40 rounded-[10px] tracking-[0.05em] p-0 m-0 h-[50px] cursor-pointer font-bold transition-all relative overflow-hidden box-border flex items-center justify-center gap-2 hover:bg-white/30 hover:border-white/60 hover:-translate-y-px active:scale-[0.98] sm:h-[46px] sm:text-[1.3rem] md:h-[52px] md:text-[1.5rem] lg:h-[54px] lg:text-[1.6rem] bg-[#25d366]/80 hover:bg-[#25d366]/90 border-white"
                onClick={handleWhatsAppShare}
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