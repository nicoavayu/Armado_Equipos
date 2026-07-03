import {
  applyPlayerRatingDelta,
  clampPlayerRating,
  DEFAULT_PLAYER_RATING,
  formatPlayerRating,
  MAX_PLAYER_RATING,
} from '../utils/playerRating';

describe('player rating invariant', () => {
  test('a new player starts at 5.0', () => {
    expect(DEFAULT_PLAYER_RATING).toBe(5.0);
    expect(clampPlayerRating(undefined)).toBe(5.0);
  });

  test('rating never exceeds the absolute 5.0 ceiling', () => {
    expect(MAX_PLAYER_RATING).toBe(5.0);
    expect(clampPlayerRating(Number.MAX_SAFE_INTEGER)).toBe(5.0);
    expect(formatPlayerRating(Number.POSITIVE_INFINITY)).toBe('5.0');
  });

  test.each([
    [5.0, -0.5, 4.5],
    [5.0, -0.3, 4.7],
    [4.7, 0.2, 4.9],
    [4.9, 0.2, 5.0],
    [5.0, 0.2, 5.0],
  ])('%s with delta %s resolves to %s', (current, delta, expected) => {
    expect(applyPlayerRatingDelta(current, delta)).toBe(expected);
  });
});
