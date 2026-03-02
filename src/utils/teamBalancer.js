const TEAM_A_ID = 'equipoA';
const TEAM_B_ID = 'equipoB';
const SCORE_SCALE = 10;

const normalizeTextKey = (value) => String(value || '').trim().toLowerCase();

const toNumericScore = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
};

const roundOneDecimal = (value) => Math.round((Number(value) || 0) * SCORE_SCALE) / SCORE_SCALE;

const defaultGetPlayerKey = (player) => (
  String(
    player?.key
    || player?.uuid
    || player?.usuario_id
    || player?.id
    || player?.player_id
    || '',
  ).trim()
);

const defaultGetPlayerName = (player) => (
  String(player?.nombre || player?.name || '').trim()
);

const normalizeLockedAssignments = (lockedAssignments = {}) => {
  const map = new Map();

  if (lockedAssignments instanceof Map) {
    lockedAssignments.forEach((teamId, key) => {
      const k = String(key || '').trim();
      const t = String(teamId || '').trim();
      if (!k || (t !== TEAM_A_ID && t !== TEAM_B_ID)) return;
      map.set(k, t);
    });
    return map;
  }

  Object.entries(lockedAssignments || {}).forEach(([key, teamId]) => {
    const k = String(key || '').trim();
    const t = String(teamId || '').trim();
    if (!k || (t !== TEAM_A_ID && t !== TEAM_B_ID)) return;
    map.set(k, t);
  });

  return map;
};

const shuffle = (items = []) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const normalizePlayers = ({
  players = [],
  getPlayerKey = defaultGetPlayerKey,
  getPlayerScore = (player) => player?.score,
  getPlayerName = defaultGetPlayerName,
}) => {
  const usedKeys = new Set();
  const unique = [];

  (players || []).forEach((player) => {
    const rawKey = getPlayerKey(player);
    const normalizedKey = String(rawKey || '').trim();
    const nameKey = normalizeTextKey(getPlayerName(player));
    const fallbackKey = nameKey ? `name:${nameKey}` : '';
    const key = normalizedKey || fallbackKey;
    if (!key || usedKeys.has(key)) return;

    usedKeys.add(key);
    unique.push({
      key,
      score: toNumericScore(getPlayerScore(player)),
    });
  });

  return unique;
};

export const buildBalancedTeams = ({
  players = [],
  lockedAssignments = {},
  teamAName = 'Equipo A',
  teamBName = 'Equipo B',
  getPlayerKey = defaultGetPlayerKey,
  getPlayerScore = (player) => player?.score,
  getPlayerName = defaultGetPlayerName,
  preferRandomTies = false,
}) => {
  const normalizedPlayers = normalizePlayers({
    players,
    getPlayerKey,
    getPlayerScore,
    getPlayerName,
  });

  const totalPlayers = normalizedPlayers.length;
  if (totalPlayers < 2) {
    throw new Error('No hay jugadores suficientes para armar equipos.');
  }
  if (totalPlayers % 2 !== 0) {
    throw new Error('Se necesita un número par de jugadores para formar equipos.');
  }

  const teamSize = totalPlayers / 2;
  const lockedByKey = normalizeLockedAssignments(lockedAssignments);
  const lockedTeamA = [];
  const lockedTeamB = [];
  const unlocked = [];

  normalizedPlayers.forEach((player) => {
    const teamId = lockedByKey.get(player.key);
    if (teamId === TEAM_A_ID) {
      lockedTeamA.push(player);
      return;
    }
    if (teamId === TEAM_B_ID) {
      lockedTeamB.push(player);
      return;
    }
    unlocked.push(player);
  });

  if (lockedTeamA.length > teamSize || lockedTeamB.length > teamSize) {
    throw new Error('Hay demasiados jugadores bloqueados en un mismo equipo.');
  }

  const freeSlotsA = teamSize - lockedTeamA.length;
  const freeSlotsB = teamSize - lockedTeamB.length;
  if (freeSlotsA < 0 || freeSlotsB < 0 || freeSlotsA + freeSlotsB !== unlocked.length) {
    throw new Error('No se pudo distribuir jugadores respetando los bloqueos.');
  }

  const candidates = preferRandomTies ? shuffle(unlocked) : [...unlocked];
  const lockedScoreAInt = Math.round(
    lockedTeamA.reduce((acc, player) => acc + player.score, 0) * SCORE_SCALE,
  );
  const totalScoreInt = Math.round(
    normalizedPlayers.reduce((acc, player) => acc + player.score, 0) * SCORE_SCALE,
  );

  const states = Array.from({ length: freeSlotsA + 1 }, () => new Map());
  states[0].set(0, null);

  for (let index = 0; index < candidates.length; index += 1) {
    const scoreInt = Math.round(candidates[index].score * SCORE_SCALE);
    const maxCount = Math.min(index + 1, freeSlotsA);

    for (let count = maxCount; count >= 1; count -= 1) {
      const prevStates = Array.from(states[count - 1].keys());
      for (let i = 0; i < prevStates.length; i += 1) {
        const prevSum = prevStates[i];
        const nextSum = prevSum + scoreInt;
        if (states[count].has(nextSum)) continue;
        states[count].set(nextSum, { prevSum, pickedIndex: index });
      }
    }
  }

  const finalSums = Array.from(states[freeSlotsA].keys());
  if (finalSums.length === 0) {
    throw new Error('No se pudo calcular una combinación válida de equipos.');
  }

  let bestGap = Number.POSITIVE_INFINITY;
  let bestSums = [];

  finalSums.forEach((sumFreeAInt) => {
    const totalTeamAInt = lockedScoreAInt + sumFreeAInt;
    const gap = Math.abs((totalTeamAInt * 2) - totalScoreInt);

    if (gap < bestGap) {
      bestGap = gap;
      bestSums = [sumFreeAInt];
      return;
    }
    if (gap === bestGap) {
      bestSums.push(sumFreeAInt);
    }
  });

  const selectedSum = bestSums[
    preferRandomTies && bestSums.length > 1
      ? Math.floor(Math.random() * bestSums.length)
      : 0
  ];

  const selectedIndexes = new Set();
  let pendingCount = freeSlotsA;
  let pendingSum = selectedSum;

  while (pendingCount > 0) {
    const entry = states[pendingCount].get(pendingSum);
    if (!entry) {
      throw new Error('No se pudo reconstruir la combinación de equipos.');
    }
    selectedIndexes.add(entry.pickedIndex);
    pendingSum = entry.prevSum;
    pendingCount -= 1;
  }

  const freeTeamA = [];
  const freeTeamB = [];
  candidates.forEach((player, idx) => {
    if (selectedIndexes.has(idx)) freeTeamA.push(player);
    else freeTeamB.push(player);
  });

  const teamAPlayers = [...lockedTeamA, ...freeTeamA];
  const teamBPlayers = [...lockedTeamB, ...freeTeamB];
  const teamAScore = roundOneDecimal(teamAPlayers.reduce((acc, player) => acc + player.score, 0));
  const teamBScore = roundOneDecimal(teamBPlayers.reduce((acc, player) => acc + player.score, 0));

  return {
    diff: roundOneDecimal(Math.abs(teamAScore - teamBScore)),
    teams: [
      {
        id: TEAM_A_ID,
        name: teamAName,
        players: teamAPlayers.map((player) => player.key),
        score: teamAScore,
      },
      {
        id: TEAM_B_ID,
        name: teamBName,
        players: teamBPlayers.map((player) => player.key),
        score: teamBScore,
      },
    ],
  };
};
