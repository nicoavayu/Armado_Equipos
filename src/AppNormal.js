// src/AppNormal.js

import React, { useRef, useEffect, useState } from 'react';
import PlayerForm from './components/PlayerForm';
import PlayerList from './components/PlayerList';
import FrequentPlayers from './components/FrequentPlayers';
import './styles.css';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from './Logo.png';
import Logo2 from './Logo_2.png';
import Confetti from 'react-confetti';

// Utilidad para id único
function uid() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

function normalizePlayer(player) {
  if (!player) return { name: "", score: 1, nickname: "", foto: null, id: uid() };
  return {
    name: (player.name || player.nombre || "").trim(),
    score: Math.max(1, +player.score ?? +player.puntaje ?? 1),
    nickname: player.nickname ?? "",
    foto: player.foto ?? null,
    id: player.id || uid(),
  };
}

const SunIcon = (
  <svg height="18" width="18" viewBox="0 0 20 20" fill="gold"><circle cx="10" cy="10" r="6"/><g stroke="gold" strokeWidth="2"><line x1="10" y1="1" x2="10" y2="4"/><line x1="10" y1="16" x2="10" y2="19"/><line x1="1" y1="10" x2="4" y2="10"/><line x1="16" y1="10" x2="19" y2="10"/><line x1="4.5" y1="4.5" x2="6.5" y2="6.5"/><line x1="13.5" y1="13.5" x2="15.5" y2="15.5"/><line x1="4.5" y1="15.5" x2="6.5" y2="13.5"/><line x1="13.5" y1="6.5" x2="15.5" y2="4.5"/></g></svg>
);
const MoonIcon = (
  <svg height="18" width="18" viewBox="0 0 20 20"><path d="M15.5 13.5A7 7 0 0 1 6.5 4.5a6.5 6.5 0 1 0 9 9z" fill="#fff"/><circle cx="14" cy="6" r="1.4" fill="#fff" /></svg>
);

// ---- EQUILIBRADO con "no repetir combinación" y máxima diferencia ----

let lastTeamsCache = {};

function sameTeams(a1, b1, a2, b2) {
  const getIds = arr => arr.map(p => p.id).sort().join(',');
  return (
    (getIds(a1) === getIds(a2) && getIds(b1) === getIds(b2)) ||
    (getIds(a1) === getIds(b2) && getIds(b1) === getIds(a2))
  );
}

function bestEvenPartitionWithRandom(players, maxDiff = 5, lastTeamKey = "") {
  const N = players.length;
  const half = N / 2;

  if (N > 14) {
    let tries = 0;
    let bestA = [], bestB = [];
    let bestScoreDiff = Infinity;
    let lastTeams = lastTeamsCache[lastTeamKey] || null;

    while (tries < 10000) {
      tries++;
      const arr = shuffleArray(players);
      const teamA = arr.slice(0, half);
      const teamB = arr.slice(half);

      if (lastTeams && sameTeams(teamA, teamB, lastTeams[0], lastTeams[1])) continue;

      const scoreA = teamA.reduce((a, p) => a + (+p.score || 0), 0);
      const scoreB = teamB.reduce((a, p) => a + (+p.score || 0), 0);
      const diff = Math.abs(scoreA - scoreB);

      if (diff < bestScoreDiff) {
        bestScoreDiff = diff;
        bestA = teamA;
        bestB = teamB;
        if (diff === 0) break;
        if (diff <= maxDiff) break;
      }
    }
    lastTeamsCache[lastTeamKey] = [bestA, bestB];
    return [bestA, bestB];
  }

  let minDiff = Infinity;
  let options = [];
  let lastTeams = lastTeamsCache[lastTeamKey] || null;

  function combine(arr, k, start = 0, acc = []) {
    if (acc.length === k) {
      const teamA = acc;
      const Aids = new Set(teamA.map(p => p.id));
      const teamB = arr.filter(p => !Aids.has(p.id));
      if (lastTeams && sameTeams(teamA, teamB, lastTeams[0], lastTeams[1])) return;
      const scoreA = teamA.reduce((a, p) => a + (+p.score || 0), 0);
      const scoreB = teamB.reduce((a, p) => a + (+p.score || 0), 0);
      const diff = Math.abs(scoreA - scoreB);
      if (diff <= maxDiff) options.push({teamA, teamB, diff});
      if (diff < minDiff) minDiff = diff;
      return;
    }
    for (let i = start; i <= arr.length - (k - acc.length); i++) {
      combine(arr, k, i + 1, acc.concat(arr[i]));
    }
  }
  combine(players, half);

  if (options.length > 0) {
    const selected = options[Math.floor(Math.random() * options.length)];
    lastTeamsCache[lastTeamKey] = [selected.teamA, selected.teamB];
    return [selected.teamA, selected.teamB];
  } else {
    let arr = shuffleArray(players);
    return [arr.slice(0, half), arr.slice(half)];
  }
}

function balanceTeamsRespetandoLocks(playersList, lockedPlayers, lastTeams) {
  if (!playersList.length) return [[], []];

  const idsSet = new Set();
  const list = playersList.filter(p => {
    if (idsSet.has(p.id)) return false;
    idsSet.add(p.id);
    return true;
  });

  const lockedA = lastTeams?.[0]?.filter(p => lockedPlayers[p.id]) || [];
  const lockedB = lastTeams?.[1]?.filter(p => lockedPlayers[p.id]) || [];

  const lockedIds = new Set([...lockedA.map(p => p.id), ...lockedB.map(p => p.id)]);
  const restantes = list.filter(p => !lockedIds.has(p.id));

  const totalPlayers = lockedA.length + lockedB.length + restantes.length;
  const mitadA = Math.ceil(totalPlayers / 2);
  const mitadB = totalPlayers - mitadA;

  if (lockedA.length > mitadA || lockedB.length > mitadB) {
    window.alert("Hay más jugadores lockeados que lugares disponibles en un equipo. Revisá los candados.");
    return [[], []];
  }

  if (lockedA.length === 0 && lockedB.length === 0 && restantes.length % 2 === 0) {
    const key = restantes.map(p => p.id).sort().join('-');
    return bestEvenPartitionWithRandom(restantes, 5, key);
  }

  const faltaA = mitadA - lockedA.length;
  const faltaB = mitadB - lockedB.length;

  let restantesShuffled = shuffleArray(restantes);
  let teamA = [...lockedA, ...restantesShuffled.slice(0, faltaA)];
  let teamB = [...lockedB, ...restantesShuffled.slice(faltaA, faltaA + faltaB)];

  while (teamA.length < mitadA && restantesShuffled.length) {
    teamA.push(restantesShuffled.pop());
  }
  while (teamB.length < mitadB && restantesShuffled.length) {
    teamB.push(restantesShuffled.pop());
  }
  return [teamA, teamB];
}

function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
  const idx = team.findIndex(p => p.id === captain.id);
  if (idx > 0) {
    const arr = team.slice();
    arr.splice(idx, 1);
    arr.unshift(captain);
    return arr;
  }
  return team;
}

function AppNormal({ onBackToHome }) {
  // Estado jugadores principales
  const [players, setPlayers] = useState(() =>
    (JSON.parse(localStorage.getItem('players')) || []).map(normalizePlayer)
  );
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [teams, setTeams] = useState([[], []]);
  const [frequentPlayers, setFrequentPlayers] = useState(() =>
    (JSON.parse(localStorage.getItem('frequentPlayers')) || []).map(normalizePlayer)
  );
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [teamNames, setTeamNames] = useState(['', '']);
  const [lockedPlayers, setLockedPlayers] = useState({});
  const [prevPlayerNames, setPrevPlayerNames] = useState([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const mainButtonRef = useRef(null);
  const [showFloatingButton, setShowFloatingButton] = useState(false);

  useEffect(() => setIsClient(true), []);
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

  const handleEditFrequent = (nuevaLista) => {
    setFrequentPlayers(nuevaLista.map(normalizePlayer));
  };
  const handleEditFrequentGlobal = (jugadorEditado) => {
    setPlayers(prev =>
      prev.map(p =>
        p.id === jugadorEditado.id
          ? { ...p, ...jugadorEditado }
          : p
      )
    );
  };

  const addPlayer = playerIn => {
    const player = normalizePlayer(playerIn);
    setPlayers(prev => [...prev, player]);
    setFrequentPlayers(fp => {
      const exists = fp.find(
        p => (p.name || "").toLowerCase() === player.name.toLowerCase()
      );
      if (exists) {
        return fp.map(p =>
          (p.name || "").toLowerCase() === player.name.toLowerCase()
            ? { ...p, score: player.score, nickname: player.nickname, foto: player.foto }
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
    setPlayers(p => p.filter(x => x.id !== player.id));
    setSelectedPlayers(sp => sp.filter(x => x.id !== player.id));
  };
  const deleteFrequentPlayer = player =>
    setFrequentPlayers(fp => fp.filter(x => x.id !== player.id));
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
      [player.id]: !prev[player.id]
    }));
  };

  const handleGenerate = () => {
    if (selectedPlayers.length < 2) {
      window.alert("Seleccioná al menos 2 jugadores.");
      return;
    }
    if (selectedPlayers.length % 2 !== 0) {
      window.alert("La cantidad de jugadores seleccionados debe ser PAR.");
      return;
    }
    let [t1, t2] = balanceTeamsRespetandoLocks(selectedPlayers, lockedPlayers, teams);

    // Safety: nunca puede haber jugadores en ambos equipos
    const allIds = [...t1.map(p => p.id), ...t2.map(p => p.id)];
    const idSet = new Set(allIds);
    if (idSet.size !== allIds.length) {
      window.alert('Hay jugadores repetidos en ambos equipos. Intentalo de nuevo.');
      return;
    }
    t1 = putCaptainFirst(t1);
    t2 = putCaptainFirst(t2);

    const currentPlayerIds = selectedPlayers.map(p => p.id).sort();
    const prevPlayerIdsSorted = prevPlayerNames.slice().sort();
    const isNewPlayersList =
      currentPlayerIds.length !== prevPlayerIdsSorted.length ||
      currentPlayerIds.some((id, idx) => id !== prevPlayerIdsSorted[idx]);
    if (isNewPlayersList) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
      setPrevPlayerNames(currentPlayerIds);
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
      {isClient && showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          numberOfPieces={500}
          gravity={0.59}
          recycle={false}
        />
      )}

      {/* Barra superior SOLO con toggle de tema */}
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
                onEdit={handleEditFrequent}
                onEditGlobal={handleEditFrequentGlobal}
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
                    selectedPlayers.length < 2 ||
                    selectedPlayers.length % 2 !== 0
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
                        const isCaptain = captain && p.id === captain.id;
                        const isLocked = !!lockedPlayers[p.id];
                        const showNick = p.nickname && p.nickname.trim() && p.nickname.trim() !== p.name.trim();
                        return (
                          <li
                            key={p.id + i}
                            className="team-player-item"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "9px 10px",
                              borderLeft: `5px solid ${idx === 0 ? "#27ae60" : "#3498db"}`,
                              background: isLocked
                                ? "linear-gradient(90deg, #edeff2 60%, #d0e4f7 120%)"
                                : i % 2
                                  ? "#f4f8fc"
                                  : "#fff",
                              borderRadius: 8,
                              marginBottom: 6,
                              opacity: isLocked ? 0.68 : 1,
                              filter: isLocked ? "grayscale(0.42)" : "none",
                              transition: "background 0.21s, filter 0.18s, opacity 0.21s"
                            }}
                          >
                            <div className="player-main-content" style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              fontWeight: isCaptain ? 800 : 600,
                              color: isCaptain ? "#b6b8ba" : "#232a32"
                            }}>
                              <span style={{
                                marginRight: 6,
                                fontSize: 20,
                                color: isCaptain ? "#bbb" : "#888"
                              }}>
                                {isCaptain ? (p.score + " (C)") : p.score}
                              </span>
                              <span style={{
                                fontWeight: 700,
                                color: "#232a32",
                                fontSize: 19
                              }}>
                                {p.name}
                              </span>
                              {showNick && (
                                <span className="apodo" style={{ marginLeft: 8 }}>
                                  {p.nickname}
                                </span>
                              )}
                            </div>
                            <motion.button
                              className={`lock-player-button${isLocked ? " locked" : ""}`}
                              onClick={() => toggleLock(idx, p)}
                              title="Lockear jugador en este equipo"
                              style={{
                                marginLeft: 7,
                                background: "none",
                                border: "none",
                                fontSize: 20,
                                cursor: "pointer"
                              }}
                              animate={{
                                scale: isLocked ? 1.24 : 1,
                                rotate: isLocked ? 15 : 0
                              }}
                              transition={{ type: "spring", stiffness: 280, damping: 16 }}
                            >
                              <span
                                role="img"
                                aria-label={isLocked ? "Desbloquear" : "Lockear"}
                                style={{
                                  color: isLocked ? "#988f45" : "#999",
                                  filter: isLocked ? "drop-shadow(0 0 4px #ffe680)" : "none",
                                  transition: "color .18s"
                                }}
                              >
                                {isLocked ? "🔒" : "🔓"}
                              </span>
                            </motion.button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="team-score">
                      Puntaje total: <span style={{ color: "#27ae60", fontWeight: 800, fontSize: 22 }}>{teamScore}</span>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* BOTÓN VOLVER AL INICIO GRANDE ABAJO */}
          <div style={{ width: "100%", display: "flex", justifyContent: "center", marginTop: 38, marginBottom: 38 }}>
            <button
              onClick={onBackToHome}
              style={{
                background: "linear-gradient(90deg, #DE1C49 0%, #0EA9C6 100%)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 32,
                border: "none",
                borderRadius: 22,
                padding: "24px 58px",
                boxShadow: "0 4px 20px #8882",
                cursor: "pointer",
                transition: "background .18s, color .18s"
              }}
            >
              Volver al inicio
            </button>
          </div>

        </div>
      </div>
      {/* BOTÓN flotante en mobile */}
      {showFloatingButton && (
        <button
          className="floating-generate-teams-button"
          onClick={handleGenerate}
          disabled={selectedPlayers.length < 2 || selectedPlayers.length % 2 !== 0}
        >
          Generar Equipos
        </button>
      )}
    </div>
  );
}

export default AppNormal;
