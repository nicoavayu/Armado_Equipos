import React, { useState, useContext } from 'react';
import ProfileCardModal from './ProfileCardModal';
import './PlayerCardTrigger.css';

// Create a context to determine if we're in TeamDisplay
export const TeamDisplayContext = React.createContext(false);

/**
 * Wrapper component that makes any player item clickable to show a ProfileCardModal
 * @param {Object} props - Component props
 * @param {Object} props.profile - Player profile data
 * @param {ReactNode} props.children - Child components to render as the clickable trigger
 */
const PlayerCardTrigger = ({ profile, children }) => {
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
        className="player-card-trigger"
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
      />
    </>
  );
};

export default PlayerCardTrigger;