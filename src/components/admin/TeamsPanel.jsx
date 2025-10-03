import React from 'react';
import TeamDisplay from '../TeamDisplay';

/**
 * Teams panel component for displaying formed teams
 * @param {Object} props - Component props
 */
const TeamsPanel = ({
  showTeams,
  teams,
  jugadores,
  handleTeamsChange,
  onBackToHome,
  isAdmin,
  partidoActual,
}) => {
  if (!showTeams) return null;

  return (
    <TeamDisplay
      teams={teams}
      players={jugadores}
      onTeamsChange={handleTeamsChange}
      onBackToHome={onBackToHome}
      isAdmin={isAdmin}
      partidoId={partidoActual?.id}
      nombre={partidoActual?.nombre}
      fecha={partidoActual?.fecha}
      hora={partidoActual?.hora}
      sede={partidoActual?.sede}
      modalidad={partidoActual?.modalidad}
      tipo={partidoActual?.tipo_partido}
    />
  );
};

export default TeamsPanel;