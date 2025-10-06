import React from 'react';
import { PlayerCardTrigger } from '../ProfileComponents';
import LoadingSpinner from '../LoadingSpinner';

/**
 * Players list section component
 * @param {Object} props - Component props
 */
const PlayersSection = ({
  isAdmin,
  jugadores,
  partidoActual,
  duplicatesDetected,
  votantesConNombres,
  transferirAdmin,
  user,
  eliminarJugador,
  isClosing,
  // Guest view props
  isPlayerInMatch,
  aceptarInvitacion,
  rechazarInvitacion,
  invitationLoading,
  setShowInviteModal,
  currentPlayerInMatch,
}) => {
  const renderPlayerCard = (j) => {
    const hasVoted = votantesConNombres.some((v) => v.nombre === j.nombre);
    
    return (
      <PlayerCardTrigger 
        key={j.uuid} 
        profile={j}
        partidoActual={partidoActual}
        onMakeAdmin={transferirAdmin}
      >
        <div
          className={`admin-player-item${hasVoted ? ' voted' : ''}`}
          style={hasVoted ? {
            background: 'rgba(0,255,136,0.3) !important',
            border: '3px solid #00ff88 !important',
            boxShadow: '0 0 15px rgba(0,255,136,0.6) !important',
          } : {}}
        >
          {j.foto_url || j.avatar_url ? (
            <img
              src={j.foto_url || j.avatar_url}
              alt={j.nombre}
              className="admin-player-avatar"
            />
          ) : (
            <div className="admin-player-avatar-placeholder">👤</div>
          )}

          <span className="admin-player-name" style={{ color: 'white' }}>
            {j.nombre}
          </span>
          
          {/* Corona para admin */}
          {partidoActual?.creado_por === j.usuario_id && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="#FFD700" style={{ flexShrink: 0 }}>
              <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z"/>
            </svg>
          )}
          
          {/* Botón eliminar - Solo admin puede eliminar otros */}
          {isAdmin && j.usuario_id !== user?.id ? (
            <button
              className="admin-remove-btn"
              onClick={(e) => {
                e.stopPropagation();
                const isOwnPlayer = j.usuario_id === user?.id;
                const confirmMessage = isOwnPlayer 
                  ? '¿Estás seguro de que quieres salir del partido?' 
                  : `¿Eliminar a ${j.nombre} del partido?`;
                if (window.confirm(confirmMessage)) {
                  eliminarJugador(j.uuid);
                }
              }}
              type="button"
              aria-label={j.usuario_id === user?.id ? 'Salir del partido' : 'Eliminar jugador'}
              disabled={isClosing}
              title={j.usuario_id === user?.id ? 'Salir del partido' : 'Eliminar jugador'}
            >
              ×
            </button>
          ) : null}
        </div>
      </PlayerCardTrigger>
    );
  };

  // Guest view (non-admin) OR user with pending invitation
  if (!isAdmin || (!isPlayerInMatch && jugadores.length > 0)) {
    return (
      <div style={{ position: 'fixed', top: isPlayerInMatch ? '70px' : '70px', left: '0', right: '0', zIndex: 10, marginBottom: '8px' }}>
        {/* Botones de invitado (solo si no está en el partido) */}
        {!isPlayerInMatch && (
          <div className="admin-add-section" style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%' }}>
              <button
                className="guest-action-btn invite-btn"
                onClick={aceptarInvitacion}
                disabled={invitationLoading || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                style={{ 
                  flex: 1,
                  fontSize: '13px',
                  padding: '10px 4px',
                  opacity: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) ? 0.5 : 1,
                }}
              >
                {invitationLoading ? <LoadingSpinner size="small" /> : 'SUMARME AL PARTIDO'}
              </button>
              <button
                className="guest-action-btn leave-btn"
                onClick={rechazarInvitacion}
                disabled={invitationLoading}
                style={{ 
                  flex: 1,
                  fontSize: '13px',
                  padding: '10px 4px',
                  background: 'rgb(222 28 73)',
                  borderColor: 'rgb(222 28 73)',
                }}
              >
                {invitationLoading ? <LoadingSpinner size="small" /> : 'RECHAZAR INVITACIÓN'}
              </button>
            </div>
          </div>
        )}
        
        {/* Lista de jugadores para no-admin */}
        <div className="admin-players-section" style={{ marginTop: isPlayerInMatch ? '52px' : '12px' }}>
          <div className="admin-players-title">
            JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
          </div>
          {jugadores.length === 0 ? (
            <div className="admin-players-empty">
              <LoadingSpinner size="medium" />
            </div>
          ) : (
            <div className="admin-players-grid">
              {jugadores.map(renderPlayerCard)}
            </div>
          )}
        </div>
        
        {/* Botones para jugador ya en el partido (no-admin) */}
        {isPlayerInMatch && (
          <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '8px auto 0' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="guest-action-btn leave-btn"
                onClick={() => {
                  if (window.confirm('¿Estás seguro de que quieres abandonar el partido?')) {
                    eliminarJugador(currentPlayerInMatch?.uuid || user.id, false);
                  }
                }}
                style={{ 
                  flex: 1,
                  fontSize: '13px',
                  padding: '10px 4px',
                  background: 'rgb(222 28 73)',
                  borderColor: 'rgb(222 28 73)',
                }}
              >
                ABANDONAR PARTIDO
              </button>
              <button
                className="guest-action-btn invite-btn"
                onClick={() => setShowInviteModal(true)}
                style={{ 
                  flex: 1,
                  fontSize: '13px',
                  padding: '10px 4px',
                }}
              >
                INVITAR AMIGOS
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Admin view
  return (
    <div className="admin-players-section">
      <div className="admin-players-title">
        JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
        {duplicatesDetected > 0 && isAdmin && (
          <span style={{ 
            color: '#ff6b35', 
            fontSize: '12px', 
            marginLeft: '10px',
            background: 'rgba(255, 107, 53, 0.1)',
            padding: '2px 6px',
            borderRadius: '4px',
            border: '1px solid rgba(255, 107, 53, 0.3)',
          }}>
            ⚠️ {duplicatesDetected} duplicado{duplicatesDetected > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {jugadores.length === 0 ? (
        <div className="admin-players-empty">
          <LoadingSpinner size="medium" />
        </div>
      ) : (
        <div className="admin-players-grid">
          {jugadores.map(renderPlayerCard)}
        </div>
      )}
    </div>
  );
};

export default PlayersSection;