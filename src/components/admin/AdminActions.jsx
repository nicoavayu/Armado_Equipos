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


    </>
  );
};

export default AdminActions;