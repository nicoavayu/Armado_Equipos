// src/FifaHome.js
import React, { useState, useEffect } from 'react';
// import '../HomeStyleKit.css'; // Removed in Tailwind migration
import Logo from '../Logo.png';

import { useAuth } from '../components/AuthProvider';
import FifaHomeContent from '../components/FifaHomeContent';
import ProfileEditor from '../components/ProfileEditor';
import NotificationsView from '../components/NotificationsView';
import PageTitle from '../components/PageTitle';




export default function FifaHome({ onModoSeleccionado }) {
  useAuth(); // Hook call required for context
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loading, setLoading] = useState(true);

  // Simulate loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  // If loading, show only the logo
  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-[9999]">
        <img
          src={Logo}
          alt="Logo"
          className="w-48 h-auto animate-pulse-zoom drop-shadow-2xl"
        />
      </div>
    );
  }

  // If showing notifications, render the NotificationsView
  if (showNotifications) {
    return (
      <div className="fixed inset-0 min-h-screen w-full overflow-y-auto z-[9999]" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <PageTitle title="NOTIFICACIONES" onBack={() => setShowNotifications(false)}>NOTIFICACIONES</PageTitle>
        <NotificationsView />
      </div>
    );
  }

  return (
    <div className="pb-24">
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