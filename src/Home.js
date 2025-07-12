// src/Home.js
import React from "react";
import "./HomeStyleKit.css";
import Logo from "./Logo.png";

export default function Home({ onModoSeleccionado }) {
  return (
    <div className="voting-bg home-bg">
      <div className="voting-modern-card">
        <img
          src={Logo}
          alt="Logo"
          style={{ height: '150px', marginBottom: '20px' }} // Logo más grande y menos espacio abajo
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
      </div>
    </div>
  );
}
