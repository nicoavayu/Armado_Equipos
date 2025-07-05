import React from 'react';

function PlayerList({ players, selectedPlayers, onSelectPlayer, onDeletePlayer }) {
  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="admin-jugadores-col">
      <h2 className="admin-list-title">
        Lista de Jugadores ({players.length})
      </h2>
      <div className="player-list-grid">
        {sortedPlayers.map((p, i) => {
          const isSelected = selectedPlayers.some(sp => sp.id === p.id);
          return (
            <div
              key={p.id || i}
              className={`admin-jugador-box ${isSelected ? "votado" : ""}`}
              onClick={() => onSelectPlayer(p)}
              style={{ cursor: 'pointer' }}
            >
              <span className="admin-jugador-nombre">{p.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation(); // Evita que el click se propague al div
                  onDeletePlayer(p);
                }}
                className="remove-btn"
                title="Eliminar"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PlayerList;
