import React, { useState } from 'react';

function FrequentPlayers({ players, onAdd, onDelete, playersInList }) {
  const [search, setSearch] = useState('');
  const filtered = players
    .filter(
      p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.nickname && p.nickname.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const exists = n => playersInList.some(p => p.name === n);

  return (
    <aside className="frequent-players-container">
      <details open>
        <summary className="frequent-title" style={{ paddingLeft: 20 }}>
          <span className="frequent-arrow" />
          Jugadores Frecuentes
        </summary>
        <input
          className="frequent-search"
          type="text"
          placeholder="Buscar frecuentes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <ul className="frequent-list">
          {filtered.map((p, i) => (
            <li className="frequent-player-row" key={p.name + i}>
              <span className="frequent-player-name">{p.name}</span>
              <div className="frequent-btns">
                <button
                  onClick={() => onAdd(p)}
                  disabled={exists(p.name)}
                  className={`add-player-button${exists(p.name) ? ' disabled' : ''}`}
                  title="Agregar"
                  style={{
                    marginRight: 6,
                    background: exists(p.name) ? '#ececec' : '#27ae60',
                    color: exists(p.name) ? '#babec4' : '#fff',
                    border: 'none',
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    fontWeight: 900,
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.14s'
                  }}
                >
                  +
                </button>
                <button
                  onClick={() => onDelete(p)}
                  className="delete-player-button"
                  title="Quitar de frecuentes"
                  style={{
                    background: '#ef443a',
                    color: '#fff',
                    border: 'none',
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    fontWeight: 900,
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}

export default FrequentPlayers;
