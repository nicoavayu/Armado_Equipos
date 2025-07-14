// src/Home.js
import React from "react";
import "./HomeStyleKit.css";
import Logo from "./Logo.png";
import GoogleAuth from "./components/GoogleAuth";
import { useAuth } from "./components/AuthProvider";

export default function Home({ onModoSeleccionado }) {
  const { user } = useAuth();

  return (
    <div className="voting-bg home-bg">
      <div className="voting-modern-card">
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
        </div>
        <GoogleAuth user={user} />
      </div>
    </div>
  );
}
