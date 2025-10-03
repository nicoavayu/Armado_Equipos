// EJEMPLO DE USO DEL MODAL MOBILE DE INVITAR AMIGOS

import React, { useState } from 'react';
import InviteAmigosModal from './components/InviteAmigosModal';

const EjemploUsoModal = () => {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('user-uuid-123');
  const [partidoActual, setPartidoActual] = useState({
    id: 21,
    nombre: 'Partido del Viernes',
    fecha: '2024-01-15',
    hora: '20:00',
    sede: 'Cancha Central',
  });

  return (
    <div>
      {/* Botón para abrir el modal */}
      <button 
        onClick={() => setShowInviteModal(true)}
        className="invite-friends-btn"
      >
        👥 Invitar Amigos
      </button>

      {/* Modal de invitar amigos */}
      <InviteAmigosModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        currentUserId={currentUserId}
        partidoActual={partidoActual}
      />
    </div>
  );
};

// CALLBACK PERSONALIZADO (si necesitas más control)
const EjemploConCallback = () => {
  const [showInviteModal, setShowInviteModal] = useState(false);

  const handleInvitarAmigo = async (amigoId) => {
    console.log('Invitando amigo:', amigoId);
    
    try {
      // Tu lógica personalizada aquí
      await enviarInvitacion(amigoId);
      toast.success('Invitación enviada');
      setShowInviteModal(false);
    } catch (error) {
      toast.error('Error al invitar');
    }
  };

  return (
    <InviteAmigosModal
      isOpen={showInviteModal}
      onClose={() => setShowInviteModal(false)}
      currentUserId="user-uuid"
      partidoActual={{ id: 21, nombre: 'Mi Partido' }}
      onInvitar={handleInvitarAmigo} // Callback personalizado
    />
  );
};

// INTEGRACIÓN EN ADMINPANEL
const AdminPanelConInvitaciones = () => {
  const [showInviteModal, setShowInviteModal] = useState(false);

  return (
    <div className="admin-actions">
      {/* Otros botones del admin panel */}
      <button 
        className="voting-confirm-btn admin-btn-primary"
        onClick={() => setShowInviteModal(true)}
      >
        👥 INVITAR AMIGOS
      </button>

      <InviteAmigosModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        currentUserId={currentUserId}
        partidoActual={partidoActual}
      />
    </div>
  );
};

export { EjemploUsoModal, EjemploConCallback, AdminPanelConInvitaciones };