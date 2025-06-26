import React, { useState } from 'react';
import VotingView from './VotingView';
import AppNormal from './AppNormal';

export default function App() {
  const [showVoting, setShowVoting] = useState(false);

  return (
    <div>
      <button
        style={{
          position: "fixed",
          right: 16,
          top: 16,
          zIndex: 99,
          padding: "7px 14px",
          borderRadius: 18,
          background: "#DE1C49",
          color: "#fff",
          fontWeight: 700,
          border: "none",
          boxShadow: "0 2px 8px rgba(30,10,30,0.13)",
          cursor: "pointer"
        }}
        onClick={() => setShowVoting(v => !v)}
      >
        {showVoting ? "Ver Armado de Equipos" : "Ver Votación"}
      </button>
      {showVoting ? <VotingView /> : <AppNormal />}
    </div>
  );
}
