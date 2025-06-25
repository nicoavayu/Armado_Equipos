import React, { useState } from 'react';

function PlayerForm({ onAddPlayer, players }) {
  const [name, setName] = useState('');
  const [score, setScore] = useState('');
  const [nickname, setNickname] = useState('');

  const exists = n =>
    players.some(
      p => p.name.trim().toLowerCase() === n.trim().toLowerCase()
    );

  const handleSubmit = e => {
    e.preventDefault();
    const numScore = Number(score);

    if (!name.trim()) return;
    if (exists(name)) {
      window.alert('Ese jugador ya está en la lista');
      return;
    }
    if (!numScore || numScore < 1 || numScore > 10) {
      window.alert('El puntaje debe ser un número del 1 al 10');
      return;
    }

    onAddPlayer({
      name: name.trim(),
      score: numScore,
      nickname: nickname.trim() || undefined
    });
    setName('');
    setScore('');
    setNickname('');
  };

  return (
    <form onSubmit={handleSubmit} autoComplete="off">
      <label>
        Nombre:
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Nombre del jugador"
          required
        />
      </label>
      <label>
        Puntaje (1-10):
        <input
          type="number"
          value={score}
          min={1}
          max={10}
          step={1}
          onChange={e => setScore(e.target.value)}
          placeholder="Puntaje"
          required
        />
      </label>
      <label>
        Apodo (opcional):
        <input
          type="text"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          placeholder="Apodo"
        />
      </label>
      <button type="submit" className="main-button">
        Agregar Jugador
      </button>
    </form>
  );
}

export default PlayerForm;
