import { isAllowedMatchTime, MATCH_TIME_MIN, MATCH_TIME_MAX } from '../lib/matchDateDebug';

describe('isAllowedMatchTime — booking window 07:00–00:00', () => {
  it('allows the opening boundary and daytime/evening hours', () => {
    expect(isAllowedMatchTime('07:00')).toBe(true);
    expect(isAllowedMatchTime('07:15')).toBe(true);
    expect(isAllowedMatchTime('12:30')).toBe(true);
    expect(isAllowedMatchTime('20:00')).toBe(true);
    expect(isAllowedMatchTime('23:45')).toBe(true);
    expect(isAllowedMatchTime('23:59')).toBe(true);
  });

  it('allows exactly midnight as the closing boundary', () => {
    expect(isAllowedMatchTime('00:00')).toBe(true);
  });

  it('blocks the small hours (00:01–06:59)', () => {
    expect(isAllowedMatchTime('00:01')).toBe(false);
    expect(isAllowedMatchTime('03:00')).toBe(false);
    expect(isAllowedMatchTime('06:59')).toBe(false);
  });

  it('rejects malformed / empty values', () => {
    expect(isAllowedMatchTime('')).toBe(false);
    expect(isAllowedMatchTime(null)).toBe(false);
    expect(isAllowedMatchTime('25:00')).toBe(false);
    expect(isAllowedMatchTime('abc')).toBe(false);
  });

  it('accepts HH:mm:ss form (normalized)', () => {
    expect(isAllowedMatchTime('07:00:00')).toBe(true);
    expect(isAllowedMatchTime('03:00:00')).toBe(false);
  });

  it('exposes input min/max bounds for <input type="time">', () => {
    expect(MATCH_TIME_MIN).toBe('07:00');
    expect(MATCH_TIME_MAX).toBe('23:59');
  });
});
