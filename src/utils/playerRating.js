export const DEFAULT_PLAYER_RATING = 5.0;
export const MAX_PLAYER_RATING = 5.0;
export const MIN_PLAYER_RATING = 0.0;

export const clampPlayerRating = (
  value,
  {
    fallback = DEFAULT_PLAYER_RATING,
    min = MIN_PLAYER_RATING,
  } = {},
) => {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(Number(fallback))
    ? Number(fallback)
    : DEFAULT_PLAYER_RATING;
  const finiteValue = Number.isFinite(parsed) ? parsed : safeFallback;
  return Math.min(MAX_PLAYER_RATING, Math.max(min, finiteValue));
};

export const formatPlayerRating = (value, options = {}) => (
  clampPlayerRating(value, options).toFixed(1)
);

export const applyPlayerRatingDelta = (currentRating, delta, options = {}) => {
  const parsedDelta = Number(delta);
  const safeDelta = Number.isFinite(parsedDelta) ? parsedDelta : 0;
  return clampPlayerRating(clampPlayerRating(currentRating, options) + safeDelta, options);
};

export default clampPlayerRating;
