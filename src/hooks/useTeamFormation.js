
import { buildBalancedTeams } from '../utils/teamBalancer';

/**
 * Custom hook for team formation logic
 * @returns {Object} Team formation utilities
 */
export const useTeamFormation = () => {
  /**
   * Creates balanced teams based on player scores
   * @param {Array} jugadores - Array of players
   * @returns {Array} Array of two teams
   */
  const armarEquipos = (jugadores) => {
    const result = buildBalancedTeams({
      players: jugadores,
      getPlayerKey: (player) => String(player?.uuid || player?.id || player?.usuario_id || '').trim(),
      getPlayerScore: (player) => player?.score,
      getPlayerName: (player) => player?.nombre,
      preferRandomTies: false,
    });
    return result.teams;
  };

  const safeSetTeams = (setTeams) => (newTeams) => {
    if (!Array.isArray(newTeams)) return;
    let equipoA = newTeams.find((t) => t && t.id === 'equipoA');
    let equipoB = newTeams.find((t) => t && t.id === 'equipoB');
    if (!equipoA) equipoA = { id: 'equipoA', name: 'Equipo A', players: [], score: 0 };
    if (!equipoB) equipoB = { id: 'equipoB', name: 'Equipo B', players: [], score: 0 };
    setTeams([equipoA, equipoB]);
  };

  const handleArmarEquipos = (jugadores, setShowArmarEquiposView) => {
    if (jugadores.length < 8) {
      console.warn('Necesitás al menos 8 jugadores para armar los equipos.');
      return;
    }
    setShowArmarEquiposView(true);
  };

  return {
    armarEquipos,
    safeSetTeams,
    handleArmarEquipos,
  };
};
