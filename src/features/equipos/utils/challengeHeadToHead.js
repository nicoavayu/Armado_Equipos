// Pure view-model for the rival head-to-head card shown on a challenge detail.
// Key rule: never surface wins/losses unless there are real loaded results.
// "Partidos jugados" counts only matches with a manual result; "encuentros"
// counts non-cancelled coordinated matches (excluding the current one).

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeId = (value) => String(value ?? '').trim();

export const buildChallengeHeadToHeadView = ({
  stats,
  teamAId,
  teamBId,
  currentUserTeamId,
  teamAName = '',
  teamBName = '',
} = {}) => {
  const safeStats = stats || {};
  const playedCount = toNumber(safeStats.totalMatchesPlayed);
  const encountersCount = toNumber(safeStats.totalEncounters);
  const winsTeamA = toNumber(safeStats.winsTeamA);
  const winsTeamB = toNumber(safeStats.winsTeamB);
  const draws = toNumber(safeStats.draws);

  const aId = normalizeId(teamAId);
  const bId = normalizeId(teamBId);
  const perspectiveIsTeamB = Boolean(currentUserTeamId) && normalizeId(currentUserTeamId) === bId;

  const wins = perspectiveIsTeamB ? winsTeamB : winsTeamA;
  const losses = perspectiveIsTeamB ? winsTeamA : winsTeamB;

  const hasPlayedHistory = playedCount > 0;
  const hasEncounters = encountersCount > 0;

  const lastResultStatus = safeStats.lastResultStatus || null;
  const lastWinnerId = normalizeId(safeStats.lastWinnerTeamId);
  let lastWinnerText = '—';
  if (lastResultStatus === 'draw') {
    lastWinnerText = 'Empate';
  } else if (lastWinnerId && lastWinnerId === aId) {
    lastWinnerText = String(teamAName || '').trim() || '—';
  } else if (lastWinnerId && lastWinnerId === bId) {
    lastWinnerText = String(teamBName || '').trim() || '—';
  }

  let emptyStateText = null;
  if (!hasPlayedHistory) {
    emptyStateText = hasEncounters
      ? 'Partidos jugados contra este rival: 0'
      : 'Primera vez que se enfrentan';
  }

  return {
    hasPlayedHistory,
    hasEncounters,
    playedCount,
    encountersCount,
    wins,
    draws,
    losses,
    historialValue: `${wins}G · ${draws}E · ${losses}P`,
    lastWinnerText,
    lastResultAt: safeStats.lastResultAt || null,
    lastEncounterAt: safeStats.lastEncounterAt || null,
    emptyStateText,
  };
};

export default buildChallengeHeadToHeadView;
