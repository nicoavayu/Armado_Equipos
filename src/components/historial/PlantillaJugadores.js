import React from 'react';
import './PlantillaJugadores.css';

/**
 * Componente que muestra la plantilla de jugadores de un partido
 * @param {Array} jugadores - Lista de jugadores del partido
 */
const PlantillaJugadores = ({ jugadores = [] }) => {
  if (!jugadores || jugadores.length === 0) {
    return (
      <div className="plantilla-no-data">
        No hay jugadores registrados para este partido
      </div>
    );
  }

  return (
    <div className="plantilla-jugadores">
      <h3 className="ficha-section-title">Plantilla de Jugadores</h3>
      <div className="plantilla-grid">
        {jugadores.map((jugador, index) => (
          <div key={jugador.uuid || index} className="plantilla-jugador-card">
            <div className="plantilla-jugador-avatar">
              {jugador.foto_url || jugador.avatar_url ? (
                <img 
                  src={jugador.foto_url || jugador.avatar_url} 
                  alt={jugador.nombre} 
                  className="plantilla-avatar-img"
                />
              ) : (
                <div className="plantilla-avatar-placeholder">
                  {jugador.nombre?.charAt(0) || '?'}
                </div>
              )}
            </div>
            <div className="plantilla-jugador-info">
              <div className="plantilla-jugador-nombre">{jugador.nombre}</div>
              {jugador.score && (
                <div className="plantilla-jugador-score">
                  Score: {jugador.score}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlantillaJugadores;