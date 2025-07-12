// src/AppNormal.js

import React, { useEffect, useState, useReducer } from 'react';
import PlayerForm from './components/PlayerForm';
import PlayerList from './components/PlayerList';
import FrequentPlayers from './components/FrequentPlayers';
import './HomeStyleKit.css';
import { motion, AnimatePresence } from 'framer-motion';
import WhatsappIcon from './components/WhatsappIcon';
import { toast } from 'react-toastify';
import Confetti from 'react-confetti';
import {
  normalizePlayer,
  balanceTeamsRespetandoLocks,
  putCaptainFirst,
  getCaptain,
} from './utils';

const initialState = {
  players: [],
  selectedPlayers: [],
  teams: [[], []],
  frequentPlayers: [],
  teamNames: ['', ''],
  lockedPlayers: {},
  prevPlayerNames: [],
  showConfetti: false,
  editingTeamName: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'INITIALIZE_STATE':
      return {
        ...state,
        players: (JSON.parse(localStorage.getItem('players')) || []).map(normalizePlayer),
        frequentPlayers: (JSON.parse(localStorage.getItem('frequentPlayers')) || []).map(normalizePlayer)
      };
    case 'ADD_PLAYER': {
      const player = normalizePlayer(action.payload);
      if (state.players.some(p => p.name.toLowerCase() === player.name.toLowerCase())) {
        toast.warn(`El jugador "${player.name}" ya está en la lista.`);
        return state;
      }
      const newPlayers = [...state.players, player];
      const existsInFrequent = state.frequentPlayers.find(p => (p.name || "").toLowerCase() === player.name.toLowerCase());
      const newFrequentPlayers = existsInFrequent
        ? state.frequentPlayers.map(p =>
            (p.name || "").toLowerCase() === player.name.toLowerCase()
              ? { ...p, score: player.score, nickname: player.nickname, foto: player.foto }
              : p
          )
        : [...state.frequentPlayers, player];
      return { ...state, players: newPlayers, frequentPlayers: newFrequentPlayers };
    }
    case 'DELETE_PLAYER': {
      const player = action.payload;
      return {
        ...state,
        players: state.players.filter(x => x.id !== player.id),
        selectedPlayers: state.selectedPlayers.filter(x => x.id !== player.id),
      };
    }
    case 'SELECT_PLAYER': {
      const player = action.payload;
      const isSelected = state.selectedPlayers.some(p => p.id === player.id);
      return {
        ...state,
        selectedPlayers: isSelected
          ? state.selectedPlayers.filter(p => p.id !== player.id)
          : [...state.selectedPlayers, player],
      };
    }
    case 'SELECT_ALL':
      return { ...state, selectedPlayers: state.players };
    case 'CLEAR_SELECTED':
      return {
        ...state,
        players: state.players.filter(p => !state.selectedPlayers.some(sp => sp.id === p.id)),
        selectedPlayers: [],
        teams: [[], []],
        lockedPlayers: {},
      };
    case 'DELETE_FREQUENT_PLAYER':
      return {
        ...state,
        frequentPlayers: state.frequentPlayers.filter(x => x.id !== action.payload.id),
      };
    case 'EDIT_FREQUENT':
      return { ...state, frequentPlayers: action.payload.map(normalizePlayer) };
    case 'EDIT_FREQUENT_GLOBAL': {
      const jugadorEditado = action.payload;
      return {
        ...state,
        players: state.players.map(p =>
          p.id === jugadorEditado.id ? { ...p, ...jugadorEditado } : p
        ),
      };
    }
    case 'GENERATE_TEAMS': {
      if (state.selectedPlayers.length < 2) {
        toast.warn("Seleccioná al menos 2 jugadores.");
        return state;
      }
      if (state.selectedPlayers.length % 2 !== 0) {
        toast.warn("La cantidad de jugadores seleccionados debe ser PAR.");
        return state;
      }
      let [t1, t2] = balanceTeamsRespetandoLocks(state.selectedPlayers, state.lockedPlayers, state.teams);
      const allIds = [...t1.map(p => p.id), ...t2.map(p => p.id)];
      if (new Set(allIds).size !== allIds.length) {
        toast.error('Hay jugadores repetidos en ambos equipos. Intentalo de nuevo.');
        return state;
      }
      t1 = putCaptainFirst(t1);
      t2 = putCaptainFirst(t2);

      const currentPlayerIds = state.selectedPlayers.map(p => p.id).sort();
      const isNewPlayersList =
        currentPlayerIds.length !== state.prevPlayerNames.length ||
        currentPlayerIds.some((id, idx) => id !== state.prevPlayerNames[idx]);

      return {
        ...state,
        teams: [t1, t2],
        showConfetti: isNewPlayersList,
        prevPlayerNames: isNewPlayersList ? currentPlayerIds : state.prevPlayerNames,
      };
    }
    case 'HIDE_CONFETTI':
      return { ...state, showConfetti: false };
    case 'TOGGLE_LOCK': {
      const playerId = action.payload.id;
      return {
        ...state,
        lockedPlayers: {
          ...state.lockedPlayers,
          [playerId]: !state.lockedPlayers[playerId],
        },
      };
    }
    case 'SET_TEAM_NAME': {
      const { index, value } = action.payload;
      const newTeamNames = [...state.teamNames];
      newTeamNames[index] = value;
      return { ...state, teamNames: newTeamNames };
    }
    case 'START_EDITING_TEAM_NAME':
      return { ...state, editingTeamName: action.payload };
    case 'STOP_EDITING_TEAM_NAME':
      return { ...state, editingTeamName: null };
    default:
      return state;
  }
}

function AppNormal({ onBack }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    players,
    selectedPlayers,
    teams,
    frequentPlayers,
    teamNames,
    lockedPlayers,
    showConfetti,
    editingTeamName,
  } = state;

  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    dispatch({ type: 'INITIALIZE_STATE' });
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (players.length > 0) {
      localStorage.setItem('players', JSON.stringify(players));
    }
  }, [players]);
  
  useEffect(() => {
    if (frequentPlayers.length > 0) {
      localStorage.setItem('frequentPlayers', JSON.stringify(frequentPlayers));
    }
  }, [frequentPlayers]);

  useEffect(() => {
    if (showConfetti) {
      const timer = setTimeout(() => dispatch({ type: 'HIDE_CONFETTI' }), 4000);
      return () => clearTimeout(timer);
    }
  }, [showConfetti]);

  const handleGenerate = () => dispatch({ type: 'GENERATE_TEAMS' });
  const addPlayer = player => dispatch({ type: 'ADD_PLAYER', payload: player });
  const deletePlayer = player => dispatch({ type: 'DELETE_PLAYER', payload: player });
  const selectPlayer = player => dispatch({ type: 'SELECT_PLAYER', payload: player });
  const selectAll = () => dispatch({ type: 'SELECT_ALL' });
  const clearSelected = () => dispatch({ type: 'CLEAR_SELECTED' });
  const deleteFrequentPlayer = player => dispatch({ type: 'DELETE_FREQUENT_PLAYER', payload: player });
  const handleEditFrequent = newList => dispatch({ type: 'EDIT_FREQUENT', payload: newList });
  const handleEditFrequentGlobal = player => dispatch({ type: 'EDIT_FREQUENT_GLOBAL', payload: player });
  const toggleLock = player => dispatch({ type: 'TOGGLE_LOCK', payload: player });
  const handleTeamNameChange = (index, value) => dispatch({ type: 'SET_TEAM_NAME', payload: { index, value } });
  const startEditingTeamName = (index) => dispatch({ type: 'START_EDITING_TEAM_NAME', payload: index });
  const stopEditingTeamName = () => dispatch({ type: 'STOP_EDITING_TEAM_NAME' });
  
  const handleTeamNameKeyDown = (e, index) => {
    if (e.key === 'Enter') {
      stopEditingTeamName();
    }
  };
  
  const handleTeamNameBlur = () => {
    stopEditingTeamName();
  };

  const shareTeams = () => {
    if (teams.every(team => team.length === 0)) {
      toast.info("No hay equipos para compartir");
      return;
    }
    const teamTexts = teams.map((team, idx) =>
      `${teamNames[idx] || `Equipo ${idx + 1}`}:\n` +
      team.map(p => {
        const isCaptain = p.id === getCaptain(team)?.id;
        return `${p.name}${isCaptain ? ' (C)' : ''}`;
      }).join('\n')
    ).join('\n\n');
    const url = `https://wa.me/?text=${encodeURIComponent(teamTexts)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="voting-bg">
      {isClient && showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          numberOfPieces={500}
          gravity={0.59}
          recycle={false}
        />
      )}
      <div className="voting-modern-card" style={{ maxWidth: '1200px', padding: '30px' }}>
        <div className="match-name">Modo Rápido</div>

        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '340px 1fr 340px', gap: '20px', alignItems: 'stretch' }}>
          
          <aside>
            <div className="dark-container">
              <FrequentPlayers
                players={frequentPlayers}
                onAdd={addPlayer}
                onDelete={deleteFrequentPlayer}
                playersInList={players}
                onEdit={handleEditFrequent}
                onEditGlobal={handleEditFrequentGlobal}
              />
            </div>
          </aside>

          <main style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div className="dark-container">
              <h2 className="admin-list-title">INGRESA TUS JUGADORES</h2>
              <PlayerForm onAddPlayer={addPlayer} />
            </div>
            {teams[0].length === 0 && (
              <button onClick={handleGenerate} className="voting-confirm-btn wipe-btn" disabled={selectedPlayers.length < 2 || selectedPlayers.length % 2 !== 0} style={{width: '100%', padding: '15px 0', fontSize: '1.5rem', background: 'rgba(37, 211, 102, 0.5)', marginTop: '15px'}}>
                Generar Equipos
              </button>
            )}
          </main>

          <aside>
            <div className="dark-container">
              <PlayerList
                players={players}
                selectedPlayers={selectedPlayers}
                onSelectPlayer={selectPlayer}
                onDeletePlayer={deletePlayer}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <button onClick={selectAll} className="voting-confirm-btn wipe-btn" style={{background: 'rgba(255, 193, 7, 0.7)', width: '100%', fontSize: '1.1rem', letterSpacing: 0, padding: '10px 8px', marginTop: '0'}}>
                Seleccionar Todos
              </button>
              <button onClick={clearSelected} className="voting-confirm-btn wipe-btn" style={{background: 'rgba(222, 28, 73, 0.5)', width: '100%', fontSize: '1.1rem', letterSpacing: 0, padding: '10px 8px', marginTop: '0'}}>
                Borrar Seleccionados
              </button>
            </div>
          </aside>
        </div>
        
        <div style={{marginTop: '10px', gridColumn: '1 / -1', width: '100%'}}>
          <div className="team-list-grid">
            <AnimatePresence>
              {teams.map((team, idx) => {
                const teamScore = team.reduce((acc, p) => acc + (+p.score || 0), 0);
                const captain = getCaptain(team);
                return (
                  <motion.div
                    key={idx}
                    className="admin-jugadores-col"
                    style={{ flex: 1, background: 'rgba(0,0,0,0.1)', padding: '15px', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {editingTeamName === idx ? (
                      <input
                        type="text"
                        value={teamNames[idx]}
                        onChange={e => handleTeamNameChange(idx, e.target.value)}
                        onKeyDown={e => handleTeamNameKeyDown(e, idx)}
                        onBlur={handleTeamNameBlur}
                        className="input-modern"
                        style={{ textAlign: 'center', fontSize: '1.2rem', marginBottom: '15px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
                        placeholder={`Equipo ${String.fromCharCode(65 + idx)}`}
                        autoFocus
                      />
                    ) : (
                      <h2 
                        className="admin-list-title" 
                        style={{color: '#fff', textAlign: 'center', cursor: 'pointer'}} 
                        onClick={() => startEditingTeamName(idx)}
                      >
                        {teamNames[idx] || `Equipo ${String.fromCharCode(65 + idx)}`}
                      </h2>
                    )}
                    <ul style={{listStyle: 'none', padding: 0, margin: 0, flexGrow: 1}}>
                      {team.map((p, i) => (
                        <li key={p.id + i} className="team-player-row admin-jugador-box" style={{borderColor: p.id === captain?.id ? '#FFD700' : 'transparent'}}>
                          <span className="admin-jugador-nombre">{p.name}{p.id === captain?.id ? ' (C)' : ''}</span>
                          <motion.button
                            className="lock-player-button"
                            onClick={() => toggleLock(p)}
                            animate={{ scale: lockedPlayers[p.id] ? 1.2 : 1 }}
                          >
                            {lockedPlayers[p.id] ? "🔒" : "🔓"}
                          </motion.button>
                        </li>
                      ))}
                    </ul>
                    <div className="team-score-container">
                      <span className="team-score-value">{teamScore}</span>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {teams[0].length > 0 && teams[1].length > 0 && teams[0].reduce((a, p) => a + (+p.score || 0), 0) === teams[1].reduce((a, p) => a + (+p.score || 0), 0) && (
            <div className="perfect-match-message">
              ¡MATCH PERFECTO!
            </div>
          )}

          {teams[0].length > 0 && (
            <>
              <button onClick={handleGenerate} className="voting-confirm-btn wipe-btn" disabled={selectedPlayers.length < 2 || selectedPlayers.length % 2 !== 0} style={{width: '100%', padding: '15px 0', fontSize: '1.5rem', background: 'rgba(37, 211, 102, 0.5)', marginTop: '10px'}}>
                Volver a Generar
              </button>
              <button className="voting-confirm-btn wipe-btn" onClick={shareTeams} style={{background: 'rgba(37, 211, 102, 0.7)', width: '100%', marginTop: '10px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'}}>
                <WhatsappIcon />
                Compartir Equipos
              </button>
            </>
          )}
        </div>
        
        <div style={{ width: "100%", display: "flex", justifyContent: "center", marginTop: 38, gridColumn: '1 / -1' }}>
          <button
            onClick={() => {
              localStorage.setItem('players', JSON.stringify(players));
              onBack();
            }}
            className="voting-confirm-btn wipe-btn"
            style={{ width: '100%', fontSize: '1.5rem' }}
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppNormal;
