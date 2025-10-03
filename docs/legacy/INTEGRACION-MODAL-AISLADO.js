// INTEGRACIÓN DEL MODAL COMPLETAMENTE AISLADO
// El modal usa React Portal y está 100% separado del DOM principal

import React, { useState, useEffect } from 'react';
import InviteAmigosModal from './components/InviteAmigosModal';
import { supabase } from './supabase';

// EJEMPLO 1: Integración básica en AdminPanel
const AdminPanelConModalAislado = ({ partidoActual }) => {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Obtener usuario actual una sola vez
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        console.log('[ADMIN_PANEL] Current user set:', user.id);
        setCurrentUserId(user.id);
      }
    };
    getCurrentUser();
  }, []);

  const handleOpenModal = () => {
    console.log('[ADMIN_PANEL] Opening invite modal with:', {
      currentUserId,
      partidoId: partidoActual?.id,
      partidoNombre: partidoActual?.nombre,
    });
    setShowInviteModal(true);
  };

  return (
    <div className="admin-actions">
      {/* Botón para abrir modal */}
      <button 
        className="voting-confirm-btn admin-btn-primary"
        onClick={handleOpenModal}
        disabled={!currentUserId || !partidoActual}
      >
        👥 INVITAR AMIGOS
      </button>

      {/* 
        MODAL AISLADO - Se monta en document.body via Portal
        NO hereda estilos ni contenido del componente padre
        SOLO muestra lista de amigos, nunca partidos
      */}
      <InviteAmigosModal
        isOpen={showInviteModal}
        onClose={() => {
          console.log('[ADMIN_PANEL] Closing invite modal');
          setShowInviteModal(false);
        }}
        currentUserId={currentUserId}
        partidoActual={partidoActual}
      />
    </div>
  );
};

// EJEMPLO 2: Uso mobile-first independiente
const ComponenteMobileConModal = () => {
  const [showModal, setShowModal] = useState(false);
  const [user, setUser] = useState(null);
  const [partido, setPartido] = useState(null);

  useEffect(() => {
    // Simular datos de usuario y partido
    const initData = async () => {
      // Usuario actual
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      // Partido ejemplo
      const partidoEjemplo = {
        id: 21,
        nombre: 'Partido Mobile',
        fecha: '2024-01-15',
        hora: '20:00',
        sede: 'Cancha Local',
      };
      setPartido(partidoEjemplo);
    };

    initData();
  }, []);

  return (
    <div className="mobile-container">
      <h2>Mi Partido</h2>
      <p>{partido?.nombre} - {partido?.fecha}</p>
      
      {/* Botón mobile-first */}
      <button 
        className="mobile-invite-btn"
        onClick={() => setShowModal(true)}
        disabled={!user || !partido}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          background: '#007bff',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          marginTop: '16px',
        }}
      >
        Invitar Amigos al Partido
      </button>

      {/* 
        MODAL PORTAL - Completamente aislado
        Se renderiza fuera de este componente
      */}
      <InviteAmigosModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        currentUserId={user?.id}
        partidoActual={partido}
      />
    </div>
  );
};

// EJEMPLO 3: Verificación de aislamiento
const TestModalAislamiento = () => {
  const [showModal, setShowModal] = useState(false);
  
  // Datos de prueba
  const testUser = 'test-user-uuid-123';
  const testPartido = {
    id: 999,
    nombre: 'Test Partido',
    fecha: '2024-01-20',
    hora: '18:00',
    sede: 'Test Cancha',
  };

  return (
    <div style={{ padding: '20px', background: '#f0f0f0' }}>
      <h3>Test de Aislamiento del Modal</h3>
      <p>Este contenido NO debe aparecer en el modal</p>
      
      <div style={{ background: '#fff', padding: '10px', margin: '10px 0' }}>
        <h4>Lista de Partidos (NO debe aparecer en modal)</h4>
        <ul>
          <li>Partido 1 - Lunes 20:00</li>
          <li>Partido 2 - Miércoles 19:00</li>
          <li>Partido 3 - Viernes 21:00</li>
        </ul>
      </div>

      <button 
        onClick={() => setShowModal(true)}
        style={{ 
          padding: '10px 20px', 
          background: '#28a745', 
          color: '#fff', 
          border: 'none',
          borderRadius: '5px',
        }}
      >
        Abrir Modal (Solo debe mostrar amigos)
      </button>

      {/* 
        MODAL AISLADO - NO debe mostrar el contenido de arriba
        Solo debe mostrar la lista de amigos
      */}
      <InviteAmigosModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        currentUserId={testUser}
        partidoActual={testPartido}
      />
    </div>
  );
};

export { 
  AdminPanelConModalAislado, 
  ComponenteMobileConModal, 
  TestModalAislamiento, 
};