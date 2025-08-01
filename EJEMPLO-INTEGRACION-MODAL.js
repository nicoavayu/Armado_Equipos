// EJEMPLO DE INTEGRACIÓN DEL MODAL DE INVITAR AMIGOS

import React, { useState, useEffect } from 'react';
import InviteAmigosModal from './components/InviteAmigosModal';
import { supabase } from './supabase';

// EJEMPLO 1: Integración en AdminPanel
const AdminPanelConModal = ({ partidoActual }) => {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Obtener usuario actual
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    };
    getCurrentUser();
  }, []);

  return (
    <div className="admin-actions">
      {/* Otros botones del admin panel */}
      <button 
        className="voting-confirm-btn admin-btn-primary"
        onClick={() => setShowInviteModal(true)}
      >
        👥 INVITAR AMIGOS
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

// EJEMPLO 2: Uso básico con datos hardcodeados
const EjemploBasico = () => {
  const [showModal, setShowModal] = useState(false);

  const partidoEjemplo = {
    id: 21,
    nombre: 'Partido del Viernes',
    fecha: '2024-01-15',
    hora: '20:00',
    sede: 'Cancha Central',
  };

  return (
    <div>
      <button onClick={() => setShowModal(true)}>
        Abrir Modal de Amigos
      </button>

      <InviteAmigosModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        currentUserId="user-uuid-123"
        partidoActual={partidoEjemplo}
      />
    </div>
  );
};

// EJEMPLO 3: Con manejo de estados completo
const ComponenteCompleto = () => {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [partidoActual, setPartidoActual] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeData = async () => {
      try {
        // Obtener usuario actual
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
        }

        // Obtener partido actual (ejemplo)
        const partido = {
          id: 21,
          nombre: 'Mi Partido',
          fecha: new Date().toISOString().split('T')[0],
          hora: '20:00',
          sede: 'Cancha Local',
        };
        setPartidoActual(partido);
      } catch (error) {
        console.error('Error initializing data:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeData();
  }, []);

  if (loading) {
    return <div>Cargando...</div>;
  }

  return (
    <div>
      <h2>Mi Partido: {partidoActual?.nombre}</h2>
      
      <button 
        onClick={() => setShowInviteModal(true)}
        disabled={!currentUserId || !partidoActual}
      >
        Invitar Amigos al Partido
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

export { AdminPanelConModal, EjemploBasico, ComponenteCompleto };