// src/FifaHome.js
import React, { useState } from 'react';
// import '../HomeStyleKit.css'; // Removed in Tailwind migration

import { useAuth } from '../components/AuthProvider';
import FifaHomeContent from '../components/FifaHomeContent';
import ProfileEditor from '../components/ProfileEditor';
import NotificationsView from '../components/NotificationsView';
import PageTitle from '../components/PageTitle';




export default function FifaHome({ onModoSeleccionado }) {
  useAuth(); // Hook call required for context
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // If showing notifications, render the NotificationsView
  if (showNotifications) {
    return (
      <div className="fixed inset-0 min-h-[100dvh] w-full overflow-y-auto z-[9999]" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <PageTitle title="NOTIFICACIONES" onBack={() => setShowNotifications(false)}>NOTIFICACIONES</PageTitle>
        <NotificationsView />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* FIFA-style menu content - Siempre mostramos el contenido porque la autenticación se maneja en App.js */}
      <FifaHomeContent
        onCreateMatch={() => onModoSeleccionado('votacion')}
        onViewHistory={() => { }}
        onViewInvitations={() => onModoSeleccionado('quiero-jugar', 'matches')}
        onViewActivePlayers={() => onModoSeleccionado('quiero-jugar', 'players')}
      />

      {/* Profile Editor */}
      <ProfileEditor
        isOpen={showProfileEditor}
        onClose={() => setShowProfileEditor(false)}
      />
    </div>
  );
}
