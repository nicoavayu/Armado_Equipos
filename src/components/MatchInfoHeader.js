import React from 'react';
import './MatchInfoHeader.css';

const MatchInfoHeader = ({ nombre, fecha, hora, sede }) => {
  const getShortVenueName = (venue) => {
    if (!venue) return '';
    return venue.split(/[,(]/)[0].trim();
  };

  // Fecha corta “jue 14 ago” (sin punto final) en es-AR
  const formatFechaCorta = (f) => {
    try {
      const d = new Date(`${f}T00:00:00`);
      return d
        .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
        .replace(/\./g, ''); // algunos navegadores agregan punto
    } catch {
      return '';
    }
  };

  const fechaStr = fecha ? formatFechaCorta(fecha) : '';
  const horaStr = hora ? (hora.length > 5 ? hora.slice(0, 5) : hora) : '';
  const venueShort = getShortVenueName(sede);

  return (
    <div className="match-info-header">
      <div className="match-name">{nombre || 'PARTIDO'}</div>

      <div className="match-details">
        {fechaStr}
        {horaStr && fechaStr && ' · '}
        {horaStr}
        {venueShort && (fechaStr || horaStr) && ' – '}
        {venueShort && (
          <a
            href={`https://www.google.com/maps/search/${encodeURIComponent(venueShort)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="venue-link"
          >
            {venueShort}
          </a>
        )}
      </div>
    </div>
  );
};

export default MatchInfoHeader;
