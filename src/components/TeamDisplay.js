// src/components/TeamDisplay.js
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'react-toastify';
import './TeamDisplay.css';
import WhatsappIcon from './WhatsappIcon';

const TeamDisplay = ({ teams, players, onTeamsChange, onBackToHome }) => {
  const [showAverages, setShowAverages] = useState(false);

  useEffect(() => {
    const teamA = teams.find(t => t.id === 'equipoA');
    const teamB = teams.find(t => t.id === 'equipoB');
    if (teamA && teamB && Math.abs(teamA.score - teamB.score) < 0.01) {
      toast.success("¡Match Perfecto! Los equipos están balanceados.");
    }
  }, [teams]);

  if (
    !Array.isArray(teams) ||
    teams.length < 2 ||
    !teams.find(t => t.id === "equipoA") ||
    !teams.find(t => t.id === "equipoB")
  ) {
    return <div style={{ padding: 40, color: "#DE1C49" }}>
      Esperando que se armen ambos equipos...
    </div>;
  }

  const getPlayerDetails = (playerId) => {
    return players.find(p => p.uuid === playerId) || {};
  };

  const handleDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;

    const sourceTeamIndex = teams.findIndex((t) => t.id === source.droppableId);
    const destTeamIndex = teams.findIndex((t) => t.id === destination.droppableId);

    if (sourceTeamIndex !== destTeamIndex) {
      const sourceTeam = teams[sourceTeamIndex];
      const destTeam = teams[destTeamIndex];

      if (destination.index >= destTeam.players.length) {
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

    const team = teams[sourceTeamIndex];
    const newPlayerIds = Array.from(team.players);
    const [removed] = newPlayerIds.splice(source.index, 1);
    newPlayerIds.splice(destination.index, 0, removed);
    const newTeams = teams.map((t, i) => (
      i === sourceTeamIndex ? { ...t, players: newPlayerIds } : t
    ));
    onTeamsChange(newTeams);
  };

  const randomizeTeams = () => {
    let allPlayers = teams.flatMap(t => t.players);
    allPlayers.sort(() => Math.random() - 0.5);

    const mitad = Math.ceil(allPlayers.length / 2);
    const teamAPlayers = allPlayers.slice(0, mitad);
    const teamBPlayers = allPlayers.slice(mitad);

    const scoreA = teamAPlayers.reduce((acc, playerId) => acc + (getPlayerDetails(playerId).score || 0), 0);
    const scoreB = teamBPlayers.reduce((acc, playerId) => acc + (getPlayerDetails(playerId).score || 0), 0);

    const newTeams = teams.map(team => {
      if (team.id === "equipoA") {
        return { ...team, players: teamAPlayers, score: scoreA };
      } else if (team.id === "equipoB") {
        return { ...team, players: teamBPlayers, score: scoreB };
      }
      return team;
    });

    onTeamsChange(newTeams);
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
        <h2 className="team-display-title">EQUIPOS</h2>
        <div className="teams-wrapper">
          {teams.map((team) => (
            <div key={team.id} className="team-container dark-container">
              <h3 className="team-name">{team.name}</h3>
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

                        return (
                          <Draggable key={String(playerId)} draggableId={String(playerId)} index={index}>
                            {(provided) => (
                              <div
                                className="player-card"
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                              >
                                <img src={player.foto_url || 'https://api.dicebear.com/6.x/pixel-art/svg?seed=default'} alt={player.nombre} className="player-avatar" />
                                <span>{player.nombre}</span>
                                {showAverages && <span className="player-score">{(player.score || 0).toFixed(2)}</span>}
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
          <button onClick={randomizeTeams} className="team-action-btn randomize-btn wipe-btn">Randomizar</button>
          <button onClick={() => setShowAverages(!showAverages)} className="team-action-btn averages-btn wipe-btn">
            {showAverages ? 'Ocultar Promedios' : 'Ver Promedios'}
          </button>
          <button onClick={onBackToHome} className="team-action-btn back-btn wipe-btn">Volver al Inicio</button>
          <button onClick={handleWhatsAppShare} className="team-action-btn whatsapp-btn wipe-btn">
            <WhatsappIcon /> Compartir
          </button>
        </div>
      </div>
    </DragDropContext>
  );
};

export default TeamDisplay;
