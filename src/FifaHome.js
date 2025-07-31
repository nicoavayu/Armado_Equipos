// src/FifaHome.js
import React, { useState, useEffect } from 'react';
import './HomeStyleKit.css';
import Logo from './Logo.png';
import GoogleAuth from './components/GoogleAuth';
import { useAuth } from './components/AuthProvider';
import FifaHomeContent from './components/FifaHomeContent';
import ProfileEditor from './components/ProfileEditor';
import NotificationsView from './components/NotificationsView';
import PageTitle from './components/PageTitle';




export default function FifaHome({ onModoSeleccionado }) {
  const { user } = useAuth();
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loading, setLoading] = useState(true);

  // Simulate loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // If loading, show only the logo
  if (loading) {
    return (
      <div className="voting-bg home-bg content-with-tabbar">
        <div className="voting-modern-card splash-screen">
          <img
            src={Logo}
            alt="Logo"
            className="splash-logo"
          />
        </div>
      </div>
    );
  }

  // If showing notifications, render the NotificationsView
  if (showNotifications) {
    return (
      <div className="voting-bg home-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 600, padding: '20px' }}>
          <PageTitle onBack={() => setShowNotifications(false)}>NOTIFICACIONES</PageTitle>
          <NotificationsView />
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg home-bg content-with-tabbar">


      {/* FIFA-style menu content - Siempre mostramos el contenido porque la autenticación se maneja en App.js */}
      <FifaHomeContent 
        onCreateMatch={() => onModoSeleccionado('votacion')}
        onViewHistory={() => {}}
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