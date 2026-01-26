import React, { useState, useContext } from 'react';
import ProfileCardModal from './ProfileCardModal';

// Create a context to determine if we're in TeamDisplay
export const TeamDisplayContext = React.createContext(false);

/**
 * Wrapper component that makes any player item clickable to show a ProfileCardModal
 * @param {Object} props - Component props
 * @param {Object} props.profile - Player profile data
 * @param {React.ReactNode} props.children - Child components to render as the clickable trigger
 * @param {Object} [props.partidoActual] - Current match data
 * @param {Function} [props.onMakeAdmin] - Function to transfer admin rights
 */
const PlayerCardTrigger = ({ profile, children, partidoActual, onMakeAdmin }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const isInTeamDisplay = useContext(TeamDisplayContext);

  const handleOpenModal = (e) => {
    e.stopPropagation(); // Prevent event from bubbling up to parent elements

    // Don't open profile card if we're in TeamDisplay
    if (isInTeamDisplay) {
      console.log('[PLAYER_TRIGGER] Prevented opening modal in TeamDisplay');
      return;
    }

    console.log('[PLAYER_TRIGGER] Opening modal for profile:', profile?.id);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    console.log('[PLAYER_TRIGGER] Closing modal for profile:', profile?.id);
    setIsModalOpen(false);
  };

  return (
    <>
      <div
        className="cursor-pointer transition-transform duration-200 ease-ease relative w-full h-full hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus-visible:outline-2 focus-visible:outline-white/50 focus-visible:outline-offset-2"
        onClick={handleOpenModal}
        role="button"
        tabIndex={0}
        aria-label={`Ver perfil de ${profile?.nombre || 'jugador'}`}
      >
        {children}
      </div>
      <ProfileCardModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        profile={profile}
        partidoActual={partidoActual}
        onMakeAdmin={onMakeAdmin}
      />
    </>
  );
};

export default PlayerCardTrigger;