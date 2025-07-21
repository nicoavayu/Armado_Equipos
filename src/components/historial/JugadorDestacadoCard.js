import React from 'react';
import './JugadorDestacadoCard.css';

/**
 * Tarjeta para mostrar jugadores destacados con badges
 * @param {Object} jugador - Datos del jugador
 * @param {String} tipo - Tipo de destacado (mvp, arquero, sucio)
 */
const JugadorDestacadoCard = ({ jugador, tipo }) => {
  if (!jugador) return null;
  
  // Configurar badge según el tipo
  const getBadgeInfo = () => {
    switch (tipo) {
      case 'mvp':
        return {
          icon: '🏆',
          label: 'MVP',
          className: 'badge-mvp'
        };
      case 'arquero':
        return {
          icon: '🧤',
          label: 'Mejor Arquero',
          className: 'badge-arquero'
        };
      case 'sucio':
        return {
          icon: '🃏',
          label: 'Tarjeta Negra',
          className: 'badge-sucio'
        };
      default:
        return {
          icon: '⭐',
          label: 'Destacado',
          className: 'badge-default'
        };
    }
  };
  
  const { icon, label, className } = getBadgeInfo();
  
  return (
    <div className={`jugador-destacado-card ${className}`}>
      <div className="jugador-destacado-badge">
        <span className="badge-icon">{icon}</span>
        <span className="badge-label">{label}</span>
      </div>
      <div className="jugador-destacado-avatar">
        {jugador.avatar_url ? (
          <img src={jugador.avatar_url} alt={jugador.nombre} />
        ) : (
          <div className="jugador-destacado-placeholder">
            {jugador.nombre.charAt(0)}
          </div>
        )}
      </div>
      <div className="jugador-destacado-info">
        <div className="jugador-destacado-nombre">{jugador.nombre}</div>
        {jugador.position && (
          <div className="jugador-destacado-posicion">{jugador.position}</div>
        )}
      </div>
    </div>
  );
};

export default JugadorDestacadoCard;