import React from 'react';
import InviteAmigosModal from '../InviteAmigosModal';

/**
 * Modal components for AdminPanel
 * @param {Object} props - Component props
 */
const Modals = ({
  showInviteModal,
  setShowInviteModal,
  partidoActual,
  user,
  jugadores,
}) => {
  return (
    <>
      {/* Modal de invitar amigos */}
      {showInviteModal && partidoActual?.id && (
        <InviteAmigosModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          currentUserId={user?.id}
          partidoActual={partidoActual}
          jugadores={jugadores}
        />
      )}
    </>
  );
};

export default Modals;