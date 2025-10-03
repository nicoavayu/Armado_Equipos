import React from 'react';
import LoadingSpinner from '../LoadingSpinner';

/**
 * Admin action buttons component (add player, invite friends, toggle settings)
 * @param {Object} props - Component props
 */
const AdminActions = ({
  isAdmin,
  pendingInvitation,
  nuevoNombre,
  setNuevoNombre,
  loading,
  isClosing,
  partidoActual,
  jugadores,
  agregarJugador,
  setShowInviteModal,
  user,
  inputRef,
  faltanJugadoresState,
  handleFaltanJugadores,
  handleArmarEquipos,
  isPlayerInMatch,
  eliminarJugador,
  currentPlayerInMatch,
}) => {
  if (!isAdmin) return null;

  return (
    <>
      {/* Add player section */}
      {!pendingInvitation && (
        <div className="admin-add-section">
          <div className="admin-add-form-new">
            <input
              className="input-modern-full"
              type="text"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre del jugador"
              disabled={loading || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
              ref={inputRef}
              maxLength={40}
              required
              aria-label="Nombre del nuevo jugador"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  agregarJugador(e);
                }
              }}
            />
            <div className="admin-buttons-row">
              <button
                className="voting-confirm-btn admin-btn-half"
                type="button"
                onClick={agregarJugador}
                disabled={loading || isClosing || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
              >
                {loading ? <LoadingSpinner size="small" /> : 'AGREGAR'}
              </button>
              <button
                className="voting-confirm-btn admin-btn-half admin-invite-btn"
                type="button"
                onClick={() => {
                  console.log('Opening invite modal with:', { userId: user?.id, matchId: partidoActual?.id });
                  setShowInviteModal(true);
                }}
                disabled={!partidoActual?.id || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                aria-label="Invitar amigos al partido"
              >
                INVITAR AMIGOS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle para abrir partido a la comunidad */}
      {!pendingInvitation && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: '12px', 
          margin: '16px auto', 
          fontSize: '14px', 
          color: 'rgba(255,255,255,0.8)',
          fontFamily: 'Oswald, Arial, sans-serif',
        }}>
          <span>¿Faltan jugadores?</span>
          <label style={{ 
            position: 'relative', 
            display: 'inline-block', 
            width: '50px', 
            height: '24px',
            cursor: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores && !faltanJugadoresState) ? 'not-allowed' : 'pointer',
          }}>
            <input 
              type="checkbox" 
              checked={faltanJugadoresState}
              onChange={handleFaltanJugadores}
              disabled={partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
              position: 'absolute',
              cursor: 'inherit',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: faltanJugadoresState ? '#009dffff' : '#ccc',
              transition: '0.3s',
              borderRadius: '24px',
              opacity: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) ? 0.5 : 1,
            }}>
              <span style={{
                position: 'absolute',
                content: '',
                height: '18px',
                width: '18px',
                left: faltanJugadoresState ? '29px' : '3px',
                bottom: '3px',
                backgroundColor: 'white',
                transition: '0.3s',
                borderRadius: '50%',
              }} />
            </span>
          </label>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Abrir a la comunidad</span>
        </div>
      )}

      {/* Botón ARMAR EQUIPOS PAREJOS */}
      {!pendingInvitation && (
        <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '8px auto 0', textAlign: 'center' }}>
          <button 
            className="admin-btn-orange" 
            onClick={handleArmarEquipos}
            disabled={jugadores.length < 8}
            style={{
              width: '100%',
            }}
            title={jugadores.length < 8 ? 'Necesitás al menos 8 jugadores para armar los equipos.' : ''}
          >
            ARMAR EQUIPOS PAREJOS
          </button>
        </div>
      )}
        
      {/* Botón para jugadores que están en el partido (solo admin) */}
      {isPlayerInMatch && !pendingInvitation && (
        <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '8px auto 0' }}>
          <button
            className="guest-action-btn leave-btn"
            onClick={() => {
              if (window.confirm('¿Estás seguro de que quieres abandonar el partido?')) {
                eliminarJugador(currentPlayerInMatch?.uuid || user.id, false);
              }
            }}
            style={{ 
              width: '100%',
              fontSize: '13px',
              padding: '10px 4px',
            }}
          >
            ABANDONAR PARTIDO
          </button>
        </div>
      )}
    </>
  );
};

export default AdminActions;