export const AWARDS_READY_NOTIFICATION_TYPES = new Set([
  'survey_results_ready',
  'awards_ready',
]);

export const hasAnyAwardData = (row) => Boolean(
  row?.mvp
  || row?.golden_glove
  || row?.dirty_player
  || (Array.isArray(row?.red_cards) && row.red_cards.length > 0)
  || row?.awards?.mvp?.player_id
  || row?.awards?.best_gk?.player_id
  || row?.awards?.red_card?.player_id
);

export const isAwardsStatusSkippedOrInsufficient = (row) => {
  const awardsStatus = String(row?.awards_status || '').toLowerCase();
  return awardsStatus.includes('insufficient') || awardsStatus.includes('skip');
};

export const isAwardsTrulyReady = (row) => (
  Boolean(row?.results_ready)
  && !isAwardsStatusSkippedOrInsufficient(row)
  && hasAnyAwardData(row)
);

export const toNumericMatchId = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};
