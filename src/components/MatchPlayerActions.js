import React, { useState } from 'react';
import AbsenceNotification from './AbsenceNotification';
import { useAuth } from './AuthProvider';
import { toast } from 'react-toastify';

/**
 * Component that shows action buttons for players in a match
 * Includes the "Notify Absence" functionality
 */
const MatchPlayerActions = ({ partidoId, onPlayerRemoved }) => {
  const { user } = useAuth();
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);

  const handleNotifyAbsence = () => {
    if (!user) {
      toast.error('Debes iniciar sesión para notificar tu ausencia');
      return;
    }
    setShowAbsenceModal(true);
  };

  const handleAbsenceSuccess = (result) => {
    console.log('Absence notification successful:', result);
    // Optionally remove player from match if they're absent
    if (onPlayerRemoved) {
      onPlayerRemoved(user.id);
    }
  };

  if (!user || !partidoId) {
    return null;
  }

  return (
    <div className="match-player-actions">
      <button 
        className="absence-notification-button"
        onClick={handleNotifyAbsence}
        style={{
          background: '#dc3545',
          color: 'white',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '6px',
          fontSize: '14px',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={(e) => e.target.style.background = '#c82333'}
        onMouseLeave={(e) => e.target.style.background = '#dc3545'}
      >
        ❌ No puedo asistir
      </button>

      {showAbsenceModal && (
        <AbsenceNotification
          userId={user.id}
          partidoId={partidoId}
          onClose={() => setShowAbsenceModal(false)}
          onSuccess={handleAbsenceSuccess}
        />
      )}
    </div>
  );
};

export default MatchPlayerActions;