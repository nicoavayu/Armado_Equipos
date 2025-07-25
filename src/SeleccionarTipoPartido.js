// src/SeleccionarTipoPartido.js
import React from 'react';

export default function SeleccionarTipoPartido({ onNuevo, onExistente }) {
  return (
    <div className="voting-bg">
      <div className="voting-modern-card" style={{ padding: 48, maxWidth: 400 }}>
        <div className="voting-title-modern" style={{ marginBottom: 38 }}>
          ¿QUÉ QUERÉS HACER?
        </div>
        <button
          className="voting-confirm-btn"
          style={{ marginBottom: 24 }}
          onClick={onNuevo}
        >
          PARTIDO NUEVO
        </button>
        <button
          className="voting-confirm-btn"
          onClick={onExistente}
        >
          PARTIDO FRECUENTE
        </button>
      </div>
    </div>
  );
}
