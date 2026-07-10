import {
  buildMatchOpportunitySummary,
  normalizeAvailabilityInput,
} from '../services/db/availability';

describe('availability MVP', () => {
  test('normalizes formats, distance and coordinates', () => {
    const result = normalizeAvailabilityInput({
      startsAt: '2026-07-11T20:00:00-03:00',
      endsAt: '2026-07-11T23:00:00-03:00',
      formats: ['f5', 'F7', 'F7', 'unknown'],
      maxDistanceKm: 90,
      latitude: '-34.6037',
      longitude: '-58.3816',
    });

    expect(result.formats).toEqual(['F5', 'F7']);
    expect(result.maxDistanceKm).toBe(50);
    expect(result.latitude).toBe(-34.6037);
    expect(result.longitude).toBe(-58.3816);
  });

  test('rejects an invalid time window', () => {
    expect(() => normalizeAvailabilityInput({
      startsAt: '2026-07-11T23:00:00-03:00',
      endsAt: '2026-07-11T20:00:00-03:00',
      formats: ['F5'],
    })).toThrow('posterior al inicio');
  });

  test('detects when a format has enough compatible players', () => {
    const matches = Array.from({ length: 13 }, (_, index) => ({
      user_id: `user-${index}`,
      shared_formats: index < 9 ? ['F5', 'F7'] : ['F7'],
    }));

    const summary = buildMatchOpportunitySummary(matches, ['F5', 'F7']);

    expect(summary[0]).toEqual({
      format: 'F5',
      playersNeeded: 10,
      compatiblePlayers: 10,
      missingPlayers: 0,
      ready: true,
    });
    expect(summary[1]).toEqual({
      format: 'F7',
      playersNeeded: 14,
      compatiblePlayers: 14,
      missingPlayers: 0,
      ready: true,
    });
  });
});
