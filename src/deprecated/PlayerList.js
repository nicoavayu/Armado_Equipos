import React from 'react';
import { PlayerCardTrigger } from './ProfileComponents';

function PlayerList({ players, selectedPlayers, onSelectPlayer, onDeletePlayer }) {
  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="admin-jugadores-col">
      <h2 className="admin-list-title">
        Lista de Jugadores ({players.length})
      </h2>
      <div className="player-list-grid">
        {sortedPlayers.map((p, i) => {
          const isSelected = selectedPlayers.some((sp) => sp.id === p.id);
          return (
            <PlayerCardTrigger key={p.uuid || p.id || i} profile={p}>
              <div
                className={`admin-jugador-box ${isSelected ? 'votado' : ''}`}
                onClick={(e) => {
                  e.stopPropagation(); // Prevent modal from opening when selecting player
                  onSelectPlayer(p);
                }}
                style={{ cursor: 'pointer' }}
              >
                <span className="admin-jugador-nombre">{p.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent modal from opening when deleting player
                    onDeletePlayer(p);
                  }}
                  className="remove-btn"
                  title="Eliminar"
                >
                  ×
                </button>
              </div>
            </PlayerCardTrigger>
          );
        })}
      </div>
    </div>
  );
}

export default PlayerList;
