import React from 'react';

function PlayerList({ players, selectedPlayers, onSelectPlayer, onDeletePlayer }) {
  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));
  // Divide la lista en dos columnas equilibradas
  const mid = Math.ceil(sortedPlayers.length / 2);
  const columns = [sortedPlayers.slice(0, mid), sortedPlayers.slice(mid)];

  return (
    <div className="player-list-box">
      <div className="player-list-title-row">
        <h2 className="player-list-title">
          Lista de Jugadores{' '}
          <span className="player-list-badge">{players.length}</span>
        </h2>
      </div>
      <div className="player-list-grid-two-cols">
        {columns.map((col, colIdx) => (
          <ul className="player-list-col" key={colIdx}>
            {col.map((p, i) => (
              <li key={p.name + i} className="player-list-li">
                <label className="player-list-label">
                  <input
                    type="checkbox"
                    checked={selectedPlayers.includes(p)}
                    onChange={() => onSelectPlayer(p)}
                    className="player-list-checkbox"
                  />
                  <span className="player-list-name">{p.name}</span>
                </label>
                <button
                  onClick={() => onDeletePlayer(p)}
                  className="delete-player-button"
                  title="Eliminar"
                >
                  <span style={{ fontWeight: 900, fontSize: 17 }}>×</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export default PlayerList;
