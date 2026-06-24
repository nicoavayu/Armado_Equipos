const TEAM_IDS = ['equipoA', 'equipoB'];
const TEAM_PLAYER_FIELDS = [
  'players',
  'player_ids',
  'players_ids',
  'team_players',
  'jugadores',
  'members',
  'roster',
];
const PLAYER_IDENTITY_FIELDS = [
  'key',
  'uuid',
  'id',
  'player_id',
  'usuario_id',
  'user_id',
];

const normalizeIdentity = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
};

export const getPlayerIdentityAliases = (player) => {
  if (player === null || player === undefined) return [];
  if (typeof player !== 'object') {
    const identity = normalizeIdentity(player);
    return identity ? [identity] : [];
  }

  return Array.from(new Set(
    PLAYER_IDENTITY_FIELDS
      .map((field) => normalizeIdentity(player?.[field]))
      .filter(Boolean),
  ));
};

export const getTeamPlayerReferences = (team) => {
  for (const field of TEAM_PLAYER_FIELDS) {
    if (Array.isArray(team?.[field])) return team[field];
  }
  return [];
};

const hasExpectedTeamShape = (teams) => (
  Array.isArray(teams)
  && teams.length === TEAM_IDS.length
  && TEAM_IDS.every((teamId) => teams.some((team) => team?.id === teamId))
);

export const analyzeTeamsAgainstRoster = (teams, players) => {
  const hasTeamShape = hasExpectedTeamShape(teams);
  const activeRoster = (Array.isArray(players) ? players : [])
    .filter((player) => player?.is_substitute !== true);

  if (!hasTeamShape) {
    return {
      hasTeamShape: false,
      isValid: false,
      isStale: false,
      missingTeamPlayerReferences: [],
      unassignedRosterPlayers: activeRoster,
      duplicateRosterPlayers: [],
    };
  }

  const rosterAliases = new Map();
  activeRoster.forEach((player, index) => {
    getPlayerIdentityAliases(player).forEach((alias) => {
      if (!rosterAliases.has(alias)) rosterAliases.set(alias, index);
    });
  });

  const assignedRosterIndexes = new Set();
  const missingTeamPlayerReferences = [];
  const duplicateRosterPlayers = [];

  TEAM_IDS.forEach((teamId) => {
    const team = teams.find((candidate) => candidate?.id === teamId);
    getTeamPlayerReferences(team).forEach((reference) => {
      const referenceAliases = getPlayerIdentityAliases(reference);
      const rosterIndex = referenceAliases
        .map((alias) => rosterAliases.get(alias))
        .find((index) => index !== undefined);

      if (rosterIndex === undefined) {
        missingTeamPlayerReferences.push(reference);
        return;
      }

      if (assignedRosterIndexes.has(rosterIndex)) {
        duplicateRosterPlayers.push(activeRoster[rosterIndex]);
        return;
      }

      assignedRosterIndexes.add(rosterIndex);
    });
  });

  const unassignedRosterPlayers = activeRoster.filter(
    (_player, index) => !assignedRosterIndexes.has(index),
  );
  const isStale = (
    missingTeamPlayerReferences.length > 0
    || unassignedRosterPlayers.length > 0
    || duplicateRosterPlayers.length > 0
  );

  return {
    hasTeamShape: true,
    isValid: !isStale,
    isStale,
    missingTeamPlayerReferences,
    unassignedRosterPlayers,
    duplicateRosterPlayers,
  };
};

export const findRosterPlayerByTeamReference = (players, reference) => {
  const referenceAliases = new Set(getPlayerIdentityAliases(reference));
  if (referenceAliases.size === 0) return null;

  return (Array.isArray(players) ? players : []).find((player) => (
    getPlayerIdentityAliases(player).some((alias) => referenceAliases.has(alias))
  )) || null;
};
