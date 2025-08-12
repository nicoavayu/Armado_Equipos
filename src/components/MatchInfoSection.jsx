import MatchInfoHeader from './MatchInfoHeader';
import './MatchInfoSection.css';

export default function MatchInfoSection({ nombre, fecha, hora, sede, modalidad, tipo, rightActions }) {
  const getShortVenue = (venue) => {
    if (!venue) return '';
    return venue.split(' ')[0];
  };

  const getGoogleMapsUrl = (venue) => {
    if (!venue) return '#';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
  };

  return (
    <div className="view-container">
      <div className="match-info-container">
        <div className="match-info-card">
        <div className="match-info-row">
          <div className="match-info-item">
            <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
            </svg>
            <div className="match-info-text">{fecha || 'Sin fecha'}</div>
          </div>
          
          <div className="match-info-separator"></div>
          
          <div className="match-info-item">
            <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/>
            </svg>
            <div className="match-info-text">{hora || 'Sin hora'}</div>
          </div>
          
          <div className="match-info-separator"></div>
          
          <div className="match-info-item">
            <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <div className="match-info-text">{modalidad || 'F5'}</div>
          </div>
          
          <div className="match-info-separator"></div>
          
          <div className="match-info-item">
            <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            <div className="match-info-text">{tipo || 'Masculino'}</div>
          </div>
          
          {sede && (
            <>
              <div className="match-info-separator"></div>
              <div className="match-info-item">
                <svg className="match-info-icon" viewBox="0 0 384 512" fill="currentColor">
                  <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z"/>
                </svg>
                <a 
                  href={getGoogleMapsUrl(sede)} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="match-info-text venue-link"
                >
                  {getShortVenue(sede)}
                </a>
              </div>
            </>
          )}
        </div>
        
        {rightActions ? <div className="match-info-actions">{rightActions}</div> : null}
        </div>
      </div>
    </div>
  );
}