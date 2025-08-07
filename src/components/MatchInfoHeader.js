import React from 'react';
import './MatchInfoHeader.css';

const MatchInfoHeader = ({ nombre, fecha, hora, sede }) => {
  // Utility function to extract short venue name
  const getShortVenueName = (venue) => {
    if (!venue) return '';
    // Extract text before first comma or parenthesis
    const shortName = venue.split(/[,(]/)[0].trim();
    return shortName;
  };

  return (
    <div className="match-info-header">
      <div className="match-name">{nombre || 'PARTIDO'}</div>
      <div className="match-details">
        {fecha && new Date(fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
          weekday: 'long', 
          day: 'numeric', 
          month: 'numeric', 
        })}
        {hora && ` - ${hora}`}
        {sede && (
          <>
            {' – '}
            <a 
              href={`https://www.google.com/maps/search/${encodeURIComponent(getShortVenueName(sede))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="venue-link"
            >
              {getShortVenueName(sede)}
            </a>
          </>
        )}
      </div>
    </div>
  );
};

export default MatchInfoHeader;