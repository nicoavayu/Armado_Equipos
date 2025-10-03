import { toast } from 'react-toastify';

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
    // Eliminar duplicados por UUID y nombre
    const jugadoresUnicos = jugadores.reduce((acc, jugador) => {
      const existeUuid = acc.find((j) => j.uuid === jugador.uuid);
      const existeNombre = acc.find((j) => j.nombre.toLowerCase() === jugador.nombre.toLowerCase());
      
      if (!existeUuid && !existeNombre) {
        acc.push(jugador);
      }
      return acc;
    }, []);
    
    // Verificar que hay número par de jugadores
    if (jugadoresUnicos.length % 2 !== 0) {
      throw new Error('Se necesita un número par de jugadores para formar equipos');
    }
    
    const jugadoresOrdenados = [...jugadoresUnicos].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const equipoA = [];
    const equipoB = [];
    let puntajeA = 0;
    let puntajeB = 0;
    
    // Distribuir jugadores alternando por puntaje para mejor balance
    jugadoresOrdenados.forEach((jugador, index) => {
      if (index % 2 === 0) {
        equipoA.push(jugador.uuid);
        puntajeA += jugador.score ?? 0;
      } else {
        equipoB.push(jugador.uuid);
        puntajeB += jugador.score ?? 0;
      }
    });

    return [
      { id: 'equipoA', name: 'Equipo A', players: equipoA, score: puntajeA },
      { id: 'equipoB', name: 'Equipo B', players: equipoB, score: puntajeB },
    ];
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
      toast.warn('Necesitás al menos 8 jugadores para armar los equipos.');
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