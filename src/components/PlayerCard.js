import React from 'react';
import ReactCountryFlag from 'react-country-flag';
import PlayerAwards from './PlayerAwards';
import './PlayerCard.css';

export default function PlayerCard({ profile, user, isVisible }) {
  const getPositionAbbr = (position) => {
    const positions = {
      'ARQ': 'ARQ',
      'DEF': 'DEF', 
      'MED': 'MED',
      'DEL': 'DEL',
    };
    return positions[position] || 'DEF';
  };

  // Use usuarios.avatar_url as primary source
  const playerPhoto = profile?.avatar_url || user?.user_metadata?.avatar_url;
  const playerNumber = profile?.numero || 10;
  const playerName = profile?.nombre || 'LIONEL MESSI';
  console.log('[AMIGOS] Processing position field in PlayerCard:', { posicion: profile?.posicion });
  const position = getPositionAbbr(profile?.posicion);
  const email = profile?.email || user?.email;
  const countryCode = profile?.pais_codigo || 'AR';
  console.log('[AMIGOS] Processing ranking field in PlayerCard:', { ranking: profile?.ranking, calificacion: profile?.calificacion });
  const rating = profile?.ranking || profile?.calificacion || 4.5; // Support both ranking and calificacion for backward compatibility
  const matchesPlayed = profile?.partidos_jugados || 28;
  const ageRange = profile?.rango_edad || '31-45';
  const social = profile?.social || '@leomessi';

  const renderStars = (rating) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    
    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(<span key={i} className="star filled">★</span>);
      } else if (i === fullStars && hasHalfStar) {
        stars.push(<span key={i} className="star half">★</span>);
      } else {
        stars.push(<span key={i} className="star empty">☆</span>);
      }
    }
    return stars;
  };

  return (
    <div className={`player-card ${isVisible ? 'visible' : ''}`}>
      {/* Header with Number and Position */}
      <div className="card-header">
        <div className="player-number">{playerNumber}</div>
        <div className="player-position">{position}</div>
        <div className="country-flag">
          <ReactCountryFlag 
            countryCode={countryCode} 
            svg 
            style={{ width: '2em', height: '1.5em' }}
          />
        </div>
      </div>

      {/* Photo Section */}
      <div className="card-photo-section">
        {playerPhoto ? (
          <img 
            src={playerPhoto} 
            alt="Player" 
            className="card-player-photo"
          />
        ) : (
          <div className="card-photo-placeholder">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="#999">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Name and Email */}
      <div className="card-name-section">
        <div className="player-name">{playerName.toUpperCase()}</div>
        <div className="player-email">{email}</div>
      </div>

      {/* Stats Section */}
      <div className="card-stats-section">
        <div className="stats-row">
          <div className="stat-item">
            <span className="stat-value">{matchesPlayed}</span>
            <span className="stat-label">PJ</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{ageRange}</span>
            <span className="stat-label">EDAD</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{social}</span>
            <span className="stat-label">SOCIAL</span>
          </div>
        </div>
        
        <div className="rating-section">
          <div className="big-rating">{rating.toFixed(1)}</div>
          <div className="stars-row">
            {renderStars(rating)}
          </div>
          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
            <PlayerAwards playerId={profile?.uuid || profile?.id} />
          </div>
        </div>
      </div>
    </div>
  );
}