import React, { useRef, useEffect, useState } from 'react';
import PlayerForm from './components/PlayerForm';
import PlayerList from './components/PlayerList';
import FrequentPlayers from './components/FrequentPlayers';
import './styles.css';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from './Logo.png';
import Logo2 from './Logo_2.png';
import Confetti from 'react-confetti';

// ICONOS
const SunIcon = (
  <svg height="18" width="18" viewBox="0 0 20 20" fill="gold"><circle cx="10" cy="10" r="6"/><g stroke="gold" strokeWidth="2"><line x1="10" y1="1" x2="10" y2="4"/><line x1="10" y1="16" x2="10" y2="19"/><line x1="1" y1="10" x2="4" y2="10"/><line x1="16" y1="10" x2="19" y2="10"/><line x1="4.5" y1="4.5" x2="6.5" y2="6.5"/><line x1="13.5" y1="13.5" x2="15.5" y2="15.5"/><line x1="4.5" y1="15.5" x2="6.5" y2="13.5"/><line x1="13.5" y1="6.5" x2="15.5" y2="4.5"/></g></svg>
);
const MoonIcon = (
  <svg height="18" width="18" viewBox="0 0 20 20"><path d="M15.5 13.5A7 7 0 0 1 6.5 4.5a6.5 6.5 0 1 0 9 9z" fill="#fff"/><circle cx="14" cy="6" r="1.4" fill="#fff" /></svg>
);

// --------- LÓGICA EQUIPOS Y CAPITÁN -----------

function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function balanceTeamsEquitable(playersList, maxDiff = 5, maxTries = 2000) {
  if (playersList.length < 2) return [[], []];
  let best = null;
  let bestDiff = Infinity;
  for (let t = 0; t < maxTries; t++) {
    const shuffled = shuffleArray(playersList);
    const half = Math.ceil(shuffled.length / 2);
    const teamA = shuffled.slice(0, half);
    const teamB = shuffled.slice(half);

    const sumA = teamA.reduce((acc, p) => acc + (+p.score || 0), 0);
    const sumB = teamB.reduce((acc, p) => acc + (+p.score || 0), 0);
    const diff = Math.abs(sumA - sumB);

    const namesA = new Set(teamA.map(p => p.name));
    const namesB = new Set(teamB.map(p => p.name));
    const hasOverlap = [...namesA].some(n => namesB.has(n));
    if (hasOverlap) continue;

    if (diff < bestDiff) {
      best = { teamA, teamB, sumA, sumB };
      bestDiff = diff;
    }
    if (diff <= maxDiff) break;
  }
  return [best.teamA, best.teamB];
}
function getCaptain(team) {
  if (!team.length) return null;
  const maxScore = Math.max(...team.map(j => +j.score || 0));
  const tops = team.filter(j => (+j.score || 0) === maxScore);
  if (!tops.length) return null;
  return tops[Math.floor(Math.random() * tops.length)];
}
function putCaptainFirst(team) {
  const captain = getCaptain(team);
  if (!captain) return team;
  const idx = team.findIndex(p => p.name === captain.name);
  if (idx > 0) {
    const arr = team.slice();
    arr.splice(idx, 1);
    arr.unshift(captain);
    return arr;
  }
  return team;
}

// ----------- COMPONENTE PRINCIPAL ---------------
function App() {
  const [players, setPlayers] = useState(() => JSON.parse(localStorage.getItem('players')) || []);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [teams, setTeams] = useState([[], []]);
  const [frequentPlayers, setFrequentPlayers] = useState(() => JSON.parse(localStorage.getItem('frequentPlayers')) || []);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [teamNames, setTeamNames] = useState(['', '']);
  const [lockedPlayers, setLockedPlayers] = useState({});

  // Confetti animation control
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiFade, setConfettiFade] = useState(false);
  const prevPlayerNames = useRef([]);

  const mainButtonRef = useRef(null);
  const [showFloatingButton, setShowFloatingButton] = useState(false);

  useEffect(() => {
    if (window.innerWidth > 800) return;
    const observer = new window.IntersectionObserver(
      ([entry]) => setShowFloatingButton(!entry.isIntersecting),
      { threshold: 0.01 }
    );
    if (mainButtonRef.current) observer.observe(mainButtonRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    localStorage.setItem('players', JSON.stringify(players));
  }, [players]);
  useEffect(() => {
    localStorage.setItem('frequentPlayers', JSON.stringify(frequentPlayers));
  }, [frequentPlayers]);
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => {
    setPlayers(prev =>
      prev.map(p => ({
        ...p,
        emoji: undefined
      }))
    );
  }, []);

  const addPlayer = player => {
    setPlayers(prev => [...prev, player]);
    setFrequentPlayers(fp => {
      const existing = fp.find(p => p.name.trim().toLowerCase() === player.name.trim().toLowerCase());
      if (existing) {
        return fp.map(p =>
          p.name.trim().toLowerCase() === player.name.trim().toLowerCase()
            ? { ...p, score: player.score, nickname: player.nickname }
            : p
        );
      }
      return [...fp, player];
    });
  };

  const selectPlayer = player =>
    setSelectedPlayers(sp =>
      sp.includes(player) ? sp.filter(p => p !== player) : [...sp, player]
    );

  const deletePlayer = player => {
    setPlayers(p => p.filter(x => x !== player));
    setSelectedPlayers(sp => sp.filter(x => x !== player));
  };
  const deleteFrequentPlayer = player =>
    setFrequentPlayers(fp => fp.filter(x => x !== player));
  const selectAll = () => setSelectedPlayers(players);
  const clearSelected = () => {
    setPlayers(p => p.filter(x => !selectedPlayers.includes(x)));
    setSelectedPlayers([]);
    setTeams([[], []]);
    setLockedPlayers({});
  };
  const toggleLock = (teamIdx, player) => {
    setLockedPlayers(prev => ({
      ...prev,
      [player.name]: !prev[player.name]
    }));
  };

  // ----------- GENERATE TEAMS + CONFETTI LOGIC -----------
  const handleGenerate = () => {
    const lockedInA = teams[0].filter(p => lockedPlayers[p.name]);
    const lockedInB = teams[1].filter(p => lockedPlayers[p.name]);
    const lockedNames = [
      ...lockedInA.map(j => j.name),
      ...lockedInB.map(j => j.name)
    ];
    const restPlayers = selectedPlayers.filter(
      p => !lockedNames.includes(p.name)
    );
    const lockedSet = new Set([...lockedInA.map(j => j.name), ...lockedInB.map(j => j.name)]);
    if (lockedSet.size !== lockedInA.length + lockedInB.length) {
      window.alert('Un jugador está lockeado en ambos equipos. Por favor, revisá los bloqueos.');
      return;
    }
    let t1 = [...lockedInA], t2 = [...lockedInB];
    let [randomA, randomB] = balanceTeamsEquitable(restPlayers, 5, 2000);
    t1 = [...lockedInA, ...randomA];
    t2 = [...lockedInB, ...randomB];
    const allNames = [...t1.map(p => p.name), ...t2.map(p => p.name)];
    const nameSet = new Set(allNames);
    if (nameSet.size !== allNames.length) {
      window.alert('Hay jugadores repetidos en ambos equipos, vuelve a intentar.');
      return;
    }
    t1 = putCaptainFirst(t1);
    t2 = putCaptainFirst(t2);

    // CONFETTI SOLO si cambia la lista de jugadores seleccionados respecto a la última generación
    const currentPlayerNames = selectedPlayers.map(p => p.name.trim().toLowerCase()).sort();
    const prevNames = prevPlayerNames.current;
    const isNewList =
      currentPlayerNames.length !== prevNames.length ||
      currentPlayerNames.some((name, idx) => name !== prevNames[idx]);
    if (isNewList) {
      setShowConfetti(true);
      setConfettiFade(false);
      setTimeout(() => setConfettiFade(true), 3400);
      setTimeout(() => setShowConfetti(false), 4100);
      prevPlayerNames.current = currentPlayerNames;
    }
    setTeams([t1, t2]);
  };

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  const showToast = (msg) => window.alert(msg);

  const shareTeams = () => {
    if (teams.every(team => team.length === 0)) {
      showToast("No hay equipos para compartir");
      return;
    }
    const teamTexts = teams.map((team, idx) =>
      `${teamNames[idx] || `Equipo ${idx + 1}`}:\n` +
      team.map(p =>
        p.nickname && p.nickname.trim() && p.nickname.trim() !== p.name.trim()
          ? `${p.name} "${p.nickname}"`
          : `${p.name}`
      ).join('\n')
    ).join('\n\n');
    const url = `https://wa.me/?text=${encodeURIComponent(teamTexts)}`;
    window.open(url, '_blank');
  };
  const handleTeamNameChange = (i, value) => {
    const newNames = [...teamNames];
    newNames[i] = value;
    setTeamNames(newNames);
  };

  return (
    <div>
      {/* CONFETTI */}
      {showConfetti && (
        <div
          style={{
            pointerEvents: 'none',
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            opacity: confettiFade ? 0 : 1,
            transition: 'opacity 0.7s'
          }}
        >
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight + 100}
            numberOfPieces={480}
            gravity={0.58}
            wind={0.11}
            initialVelocityY={18}
            recycle={false}
            run={showConfetti}
          />
        </div>
      )}

      {/* Barra superior con toggle */}
      <div
        style={{
          width: '100%',
          minHeight: '60px',
          borderRadius: '0px 0px 0 0',
          background: 'linear-gradient(90deg, #DE1C49 0%, #0EA9C6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 38px',
          boxSizing: 'border-box',
          position: 'absolute',
          left: 0,
          top: 0,
          zIndex: 20
        }}
      >
        <button
          aria-label="Cambiar modo"
          onClick={toggleTheme}
          style={{
            width: 48, height: 28,
            borderRadius: 14,
            background: '#e5f0ff',
            border: 'none',
            boxShadow: '0 2px 6px rgba(50,40,80,0.09)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: theme === 'dark' ? 'flex-end' : 'flex-start',
            padding: 3,
            transition: 'background .2s'
          }}
        >
          <span
            style={{
              width: 22, height: 22,
              borderRadius: '50%',
              background: theme === 'dark' ? '#333a50' : '#ffd600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background .15s'
            }}
          >
            {theme === 'dark' ? MoonIcon : SunIcon}
          </span>
        </button>
      </div>

      <div className="container">
        <div className="mobile-padding-wrapper">
          <div className="header-bar">
            <div style={{ textAlign: 'center', flex: 1 }}>
              <img
                src={theme === 'dark' ? Logo2 : Logo}
                alt="Logo Armando Equipos"
                className="app-logo"
                style={{
                  height: '130px',
                  width: 'auto',
                  margin: '0 auto -0px auto',
                  display: 'block',
                  objectFit: 'contain'
                }}
              />
              <div className="header-title">Armando Equipos</div>
            </div>
          </div>
          <div className="content">
            <aside className="sidebar frequent-players">
              <FrequentPlayers
                players={frequentPlayers}
                onAdd={addPlayer}
                onDelete={deleteFrequentPlayer}
                playersInList={players}
              />
            </aside>
            <section className="player-form">
              <PlayerForm onAddPlayer={addPlayer} players={players} />
              <div className="button-container under-form">
                <button
                  ref={mainButtonRef}
                  onClick={handleGenerate}
                  className="generate-teams-button big"
                  disabled={
                    selectedPlayers.length < 10 || selectedPlayers.length % 2 !== 0
                  }
                  type="button"
                  style={{ height: 96, fontSize: '2rem', borderRadius: 18, marginBottom: 15 }}
                >
                  Generar Equipos
                </button>
              </div>
              <div className="button-row">
                <button onClick={clearSelected} className="clear-selected-button" type="button">
                  Borrar Seleccionados
                </button>
                <button onClick={selectAll} className="select-all-button" type="button">
                  Seleccionar Todos
                </button>
              </div>
            </section>
            <section className="player-list">
              <PlayerList
                players={players}
                selectedPlayers={selectedPlayers}
                onSelectPlayer={selectPlayer}
                onDeletePlayer={deletePlayer}
              />
            </section>
          </div>
          <div className="team-names-inputs">
            <input
              type="text"
              placeholder="Equipo 1"
              value={teamNames[0]}
              onChange={e => handleTeamNameChange(0, e.target.value)}
              className="team-name-input"
            />
            <input
              type="text"
              placeholder="Equipo 2"
              value={teamNames[1]}
              onChange={e => handleTeamNameChange(1, e.target.value)}
              className="team-name-input"
            />
          </div>
          <button className="share-teams-button" onClick={shareTeams} type="button">
            Compartir equipos por WhatsApp
          </button>
          <div className="team-container fixed-spacing">
            <AnimatePresence>
              {teams.map((team, idx) => {
                const teamScore = team.reduce((acc, p) => acc + (+p.score || 0), 0);
                const captain = getCaptain(team);
                return (
                  <motion.div
                    key={idx}
                    className="team-list"
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 40 }}
                    transition={{ duration: 0.4 }}
                  >
                    <h2>{teamNames[idx] || `Equipo ${idx + 1}`}</h2>
                    <ul>
                      {team.map((p, i) => {
                        const isCaptain = captain && p.name === captain.name;
                        const isLocked = !!lockedPlayers[p.name];
                        const showNick = p.nickname && p.nickname.trim() && p.nickname.trim() !== p.name.trim();
                        return (
                          <li key={p.name + i} className="player-item team-player-item">
                            <span
                              className="player-main-content"
                              style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                width: '100%',
                                fontSize: '1.05em',
                                fontWeight: isCaptain ? 700 : 500,
                                gap: '0.3em',
                                color: isLocked ? '#a7aab0' : undefined,
                                opacity: isLocked ? 0.5 : 1,
                                transition: 'color .13s, opacity .13s'
                              }}
                            >
                              {showNick
                                ? <>
                                    {p.name} <span style={{ fontStyle: 'italic', color: '#313a4e' }}>"{p.nickname}"</span>
                                    {isCaptain && <span style={{ marginLeft: 8, fontWeight: 600 }}>(C)</span>}
                                  </>
                                : <>
                                    {p.name}
                                    {isCaptain && <span style={{ marginLeft: 8, fontWeight: 600 }}>(C)</span>}
                                  </>
                              }
                            </span>
                            <button
                              className={`lock-player-button${isLocked ? ' locked' : ''}`}
                              onClick={() => toggleLock(idx, p)}
                              title={isLocked ? "Desbloquear jugador" : "Fijar en este equipo"}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                marginLeft: 7,
                                fontSize: 19,
                                color: isLocked ? "#2272b6" : "#babec4",
                                opacity: isLocked ? 1 : 0.7,
                                outline: "none"
                              }}
                            >
                              {isLocked ? '🔒' : '🔓'}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="team-score">Puntaje total: <b>{teamScore}</b></div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {showFloatingButton && (
        <button
          className="floating-generate-teams-button"
          onClick={handleGenerate}
          disabled={
            selectedPlayers.length < 10 || selectedPlayers.length % 2 !== 0
          }
        >
          Generar Equipos
        </button>
      )}
    </div>
  );
}

export default App;
