// src/FifaHome.js
import React, { useState, useEffect } from "react";
import "./HomeStyleKit.css";
import Logo from "./Logo.png";
import GoogleAuth from "./components/GoogleAuth";
import { useAuth } from "./components/AuthProvider";
import FifaHomeContent from "./components/FifaHomeContent";
import ProfileEditor from "./components/ProfileEditor";
import NotificationsView from "./components/NotificationsView";

export default function FifaHome({ onModoSeleccionado }) {
  const { user, profile } = useAuth();
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

  // We no longer need this handler as notifications are handled by the GlobalHeader
  // const handleNotificationsClick = () => {
  //   setShowNotifications(true);
  // };

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
        <div className="voting-modern-card" style={{maxWidth: 600, padding: '20px'}}>
          <div className="notifications-back-button" onClick={() => setShowNotifications(false)}>←</div>
          <NotificationsView />
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg home-bg content-with-tabbar">
      <div className="voting-modern-card fifa-home-container">
        {/* Authentication */}
        {!user && (
          <div className="fifa-auth-container">
            <img
              src={Logo}
              alt="Logo"
              className="fifa-auth-logo"
            />
            <GoogleAuth user={user} />
          </div>
        )}
        
        {/* FIFA-style menu content */}
        {user && (
          <FifaHomeContent 
            onCreateMatch={() => onModoSeleccionado('votacion')}
            onViewHistory={() => onModoSeleccionado('votacion')}
            onViewInvitations={() => onModoSeleccionado('quiero-jugar', 'matches')}
            onViewActivePlayers={() => onModoSeleccionado('quiero-jugar', 'players')}
          />
        )}
      </div>
      
      {/* Profile Editor */}
      <ProfileEditor
        isOpen={showProfileEditor}
        onClose={() => setShowProfileEditor(false)}
      />
    </div>
  );
}