import React, { useState } from 'react';
import StarRating from './StarRating';
import './VotingView.css';

const initialFrequentPlayers = [
  { name: 'Nico' }, { name: 'Beto' }, { name: 'Fede' }, { name: 'Alex' }
];

export default function VotingView() {
  const [step, setStep] = useState(0); // 0: nombre+foto, 1: votar, 2: resumen
  const [playerName, setPlayerName] = useState('');
  const [playerPhoto, setPlayerPhoto] = useState(null);
  const [frequentPlayers, setFrequentPlayers] = useState(initialFrequentPlayers);
  const [votes, setVotes] = useState({});
  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState({});
  const [editingName, setEditingName] = useState(null);

  // Subir foto y mostrar preview
  const handlePhoto = (e) => {
    if (e.target.files && e.target.files[0]) {
      setPlayerPhoto(URL.createObjectURL(e.target.files[0]));
    }
  };

  // Paso 1: nombre + foto
  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    if (!frequentPlayers.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase())) {
      setFrequentPlayers(prev => [...prev, { name: playerName }]);
    }
    setStep(1);
    setCurrent(0);
  };

  // Filtrar el propio
  const filteredPlayers = frequentPlayers.filter(
    p => p.name.toLowerCase() !== playerName.toLowerCase()
  );

  // Votación/edición de un solo jugador
  const handleVote = (targetName, value) => {
    setVotes(prev => ({
      ...prev,
      [targetName]: Number(value)
    }));

    setTimeout(() => {
      if (editingName) {
        setEditingName(null);
        // Guardar resultados actualizados al editar
        const updatedResults = { ...results, [targetName]: Number(value) };
        setResults(updatedResults);
        setStep(2);
      } else if (current < filteredPlayers.length - 1) {
        setCurrent(cur => cur + 1);
      } else {
        handleFinishVoting();
      }
    }, 170);
  };

  // Termina votación
  const handleFinishVoting = () => {
    let averages = {};
    filteredPlayers.forEach(p => {
      averages[p.name] = votes[p.name] || 0;
    });
    setResults(averages);
    setStep(2);
  };

  // Editar solo un jugador
  const handleEdit = (name) => {
    const idx = filteredPlayers.findIndex(p => p.name === name);
    if (idx !== -1) {
      setCurrent(idx);
      setEditingName(name);
      setStep(1);
    }
  };

  return (
    <div className="voting-container">
      {/* Paso 1: Nombre + Foto */}
      {step === 0 && (
        <form onSubmit={handleNameSubmit}>
          <h2>Ingresá tu nombre</h2>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 18 }}>
            <label>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handlePhoto}
              />
              <div className="voting-photo" style={{
                backgroundImage: playerPhoto ? `url(${playerPhoto})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                cursor: 'pointer'
              }}>
                {!playerPhoto && <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#bbb',
                  fontSize: 38
                }}>+</span>}
              </div>
            </label>
            <input
              autoFocus
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Tu nombre"
              className="voting-input"
              style={{ flex: 1 }}
            />
          </div>
          <button type="submit" className="vote-button">Entrar</button>
        </form>
      )}

      {/* Paso 2: Votar o editar solo uno */}
      {step === 1 && (
        <>
          <h2>Calificá a los jugadores</h2>
          <div style={{ margin: "24px 0", textAlign: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 22, marginBottom: 10 }}>
              {filteredPlayers[current].name}
            </div>
            <div style={{ marginBottom: 18 }}>
              <div className="voting-photo"></div>
            </div>
            <StarRating
              value={votes[filteredPlayers[current].name] || 0}
              onChange={val => handleVote(filteredPlayers[current].name, val)}
              max={10}
            />
          </div>
        </>
      )}

      {/* Paso 3: Resumen final y edición */}
      {step === 2 && (
        <>
          <h2>Tu votación</h2>
          <ul className="player-list-summary">
            {Object.entries(results).map(([name, avg]) => (
              <li key={name}>
                <span>{name}:</span>
                <span>{avg}</span>
                <button
                  className="edit-button"
                  onClick={() => handleEdit(name)}
                  type="button"
                >Editar</button>
              </li>
            ))}
          </ul>
          <button className="finish-button" onClick={() => window.location.reload()}>
            Finalizar
          </button>
        </>
      )}
    </div>
  );
}
