// src/Home.js
import React, { useState } from "react";
import "./HomeStyleKit.css";
import Logo from "./Logo.png";
import GoogleAuth from "./components/GoogleAuth";
import { useAuth } from "./components/AuthProvider";
import AvatarWithProgress from "./components/AvatarWithProgress";
import ProfileEditor from "./components/ProfileEditor";

export default function Home({ onModoSeleccionado }) {
  const { user, profile } = useAuth();
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  return (
    <div className="voting-bg home-bg">
      <div className="voting-modern-card" style={{ position: 'relative' }}>
        {/* Avatar with Progress */}
        {user && (
          <div style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 10
          }}>
            <AvatarWithProgress 
              profile={profile}
              onClick={() => setShowProfileEditor(true)}
              size={60}
            />
          </div>
        )}
        <img
          src={Logo}
          alt="Logo"
          style={{ height: '150px', marginBottom: '20px' }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
            alignItems: 'stretch'
          }}
        >
          <div className="player-select-btn" onClick={() => onModoSeleccionado("simple")}>
            <span className="player-select-txt">Rápido</span>
          </div>
          <div className="player-select-btn" onClick={() => onModoSeleccionado("votacion")}>
            <span className="player-select-txt">Participativo</span>
          </div>
          <div className="player-select-btn" onClick={() => onModoSeleccionado("quiero-jugar")} style={{ background: '#ff6b35', borderColor: '#ff6b35' }}>
            <span className="player-select-txt">⚽ Quiero Jugar</span>
          </div>
        </div>
        <GoogleAuth user={user} />
      </div>
      
      {/* Profile Editor */}
      <ProfileEditor
        isOpen={showProfileEditor}
        onClose={() => setShowProfileEditor(false)}
      />
    </div>
  );
}
