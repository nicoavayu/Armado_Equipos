export const AWARDS_READY_NOTIFICATION_TYPES = new Set([
  'awards_ready',
  'award_won',
]);

export const AWARDS_STATUS_PENDING = 'pending';
export const AWARDS_STATUS_READY = 'ready';
export const AWARDS_STATUS_NOT_ELIGIBLE = 'not_eligible';

export const hasAnyAwardData = (row) => Boolean(
  row?.mvp
  || row?.golden_glove
  || row?.dirty_player
  || (Array.isArray(row?.red_cards) && row.red_cards.length > 0)
  || row?.awards?.mvp?.player_id
  || row?.awards?.best_gk?.player_id
  || row?.awards?.red_card?.player_id
);

const normalizeStatusToken = (value) => String(value || '').trim().toLowerCase();

export const normalizeAwardsStatus = (value) => {
  const token = normalizeStatusToken(value);
  if (!token) return null;

  if ([
    AWARDS_STATUS_READY,
    'applied',
    'generated',
    'done',
  ].includes(token)) {
    return AWARDS_STATUS_READY;
  }

  if ([
    AWARDS_STATUS_NOT_ELIGIBLE,
    'insufficient',
    'insufficient_voters',
    'skipped',
    'skip',
    'skipped_not_played',
  ].includes(token)) {
    return AWARDS_STATUS_NOT_ELIGIBLE;
  }

  if ([
    AWARDS_STATUS_PENDING,
    'pending_retry',
    'retry',
    'processing',
    'queued',
  ].includes(token)) {
    return AWARDS_STATUS_PENDING;
  }

  return AWARDS_STATUS_PENDING;
};

export const isAwardsReadyStatus = (row) => (
  row?.awards_generated === true
  || normalizeAwardsStatus(row?.awards_status) === AWARDS_STATUS_READY
);

export const isAwardsStatusSkippedOrInsufficient = (row) => (
  normalizeAwardsStatus(row?.awards_status) === AWARDS_STATUS_NOT_ELIGIBLE
);

export const isAwardsNotEligibleStatus = (row) => (
  normalizeAwardsStatus(row?.awards_status) === AWARDS_STATUS_NOT_ELIGIBLE
);

export const isAwardsPendingStatus = (row) => (
  normalizeAwardsStatus(row?.awards_status) === AWARDS_STATUS_PENDING
);

export const isAwardsTrulyReady = (row) => isAwardsReadyStatus(row);

export const toNumericMatchId = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};
