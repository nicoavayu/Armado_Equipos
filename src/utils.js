// src/utils.js
import { toast } from 'react-toastify';

// Utilidad para id único
export function uid() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

export function normalizePlayer(player) {
  if (!player) return { name: '', score: 1, nickname: '', foto: null, id: uid() };
  return {
    name: (player.name || player.nombre || '').trim(),
    score: Math.max(1, +player.score ?? +player.puntaje ?? 1),
    nickname: player.nickname ?? '',
    foto: player.foto ?? null,
    id: player.id || uid(),
  };
}

// ---- LÓGICA DE BALANCEO DE EQUIPOS ----

let lastTeamsCache = {};

function sameTeams(a1, b1, a2, b2) {
  const getIds = (arr) => arr.map((p) => p.id).sort().join(',');
  return (
    (getIds(a1) === getIds(a2) && getIds(b1) === getIds(b2)) ||
    (getIds(a1) === getIds(b2) && getIds(b1) === getIds(a2))
  );
}

function bestEvenPartitionWithRandom(players, maxDiff = 5, lastTeamKey = '') {
  const N = players.length;
  const half = N / 2;

  if (N > 14) {
    let tries = 0;
    let bestA = [], bestB = [];
    let bestScoreDiff = Infinity;
    let lastTeams = lastTeamsCache[lastTeamKey] || null;

    while (tries < 50000) { // Aumentamos los intentos para encontrar una mejor solución
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
        if (bestScoreDiff <= maxDiff) break; // Si ya encontramos una solución aceptable, paramos
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
      const Aids = new Set(teamA.map((p) => p.id));
      const teamB = arr.filter((p) => !Aids.has(p.id));
      if (lastTeams && sameTeams(teamA, teamB, lastTeams[0], lastTeams[1])) return;
      const scoreA = teamA.reduce((a, p) => a + (+p.score || 0), 0);
      const scoreB = teamB.reduce((a, p) => a + (+p.score || 0), 0);
      const diff = Math.abs(scoreA - scoreB);
      if (diff <= maxDiff) options.push({ teamA, teamB, diff });
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

export function balanceTeamsRespetandoLocks(playersList, lockedPlayers, lastTeams) {
  if (!playersList.length) return [[], []];

  const idsSet = new Set();
  const list = playersList.filter((p) => {
    if (idsSet.has(p.id)) return false;
    idsSet.add(p.id);
    return true;
  });

  const lockedA = lastTeams?.[0]?.filter((p) => lockedPlayers[p.id]) || [];
  const lockedB = lastTeams?.[1]?.filter((p) => lockedPlayers[p.id]) || [];

  const lockedIds = new Set([...lockedA.map((p) => p.id), ...lockedB.map((p) => p.id)]);
  const restantes = list.filter((p) => !lockedIds.has(p.id));

  const totalPlayers = lockedA.length + lockedB.length + restantes.length;
  const mitadA = Math.ceil(totalPlayers / 2);
  const mitadB = totalPlayers - mitadA;

  if (lockedA.length > mitadA || lockedB.length > mitadB) {
    toast.error('Hay más jugadores lockeados que lugares disponibles en un equipo. Revisá los candados.');
    return [[], []];
  }

  if (lockedA.length === 0 && lockedB.length === 0 && restantes.length % 2 === 0) {
    const key = restantes.map((p) => p.id).sort().join('-');
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

export function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getCaptain(team) {
  if (!team.length) return null;
  const maxScore = Math.max(...team.map((j) => +j.score || 0));
  const tops = team.filter((j) => (+j.score || 0) === maxScore);
  if (!tops.length) return null;
  return tops[Math.floor(Math.random() * tops.length)];
}

export function putCaptainFirst(team) {
  const captain = getCaptain(team);
  if (!captain) return team;
  const idx = team.findIndex((p) => p.id === captain.id);
  if (idx > 0) {
    const arr = team.slice();
    arr.splice(idx, 1);
    arr.unshift(captain);
    return arr;
  }
  return team;
}