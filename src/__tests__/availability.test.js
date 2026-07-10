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

  test('rejects unparseable dates', () => {
    expect(() => normalizeAvailabilityInput({
      startsAt: 'no es una fecha',
      endsAt: '2026-07-11T23:00:00-03:00',
      formats: ['F5'],
    })).toThrow('día y horario válidos');
  });

  test('rejects windows shorter than one hour', () => {
    expect(() => normalizeAvailabilityInput({
      startsAt: '2026-07-11T20:00:00-03:00',
      endsAt: '2026-07-11T20:30:00-03:00',
      formats: ['F5'],
    })).toThrow('al menos una hora');
  });

  test('rejects empty or unknown-only format lists', () => {
    expect(() => normalizeAvailabilityInput({
      startsAt: '2026-07-11T20:00:00-03:00',
      endsAt: '2026-07-11T23:00:00-03:00',
      formats: ['F4', 'F12'],
    })).toThrow('al menos un formato');
  });

  test('clamps distance to the minimum and defaults NaN', () => {
    const base = {
      startsAt: '2026-07-11T20:00:00-03:00',
      endsAt: '2026-07-11T23:00:00-03:00',
      formats: ['F5'],
    };
    expect(normalizeAvailabilityInput({ ...base, maxDistanceKm: 0.4 }).maxDistanceKm).toBe(1);
    expect(normalizeAvailabilityInput({ ...base, maxDistanceKm: 'nada' }).maxDistanceKm).toBe(8);
  });

  test('treats empty or invalid coordinates as missing, never 0,0', () => {
    const result = normalizeAvailabilityInput({
      startsAt: '2026-07-11T20:00:00-03:00',
      endsAt: '2026-07-11T23:00:00-03:00',
      formats: ['F5'],
      latitude: '',
      longitude: 'NaN',
    });
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
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

  test('orders opportunities: ready first, then fewest missing players', () => {
    const matches = [
      { user_id: 'a', shared_formats: ['F5', 'F7'] },
      ...Array.from({ length: 13 }, (_, index) => ({
        user_id: `b-${index}`,
        shared_formats: ['F7'],
      })),
    ];

    const summary = buildMatchOpportunitySummary(matches, ['F5', 'F7', 'F11']);

    expect(summary.map((item) => item.format)).toEqual(['F7', 'F5', 'F11']);
    expect(summary[0].ready).toBe(true);
    expect(summary[1].missingPlayers).toBeLessThan(summary[2].missingPlayers);
  });

  test('ignores unknown preferred formats and empty matches', () => {
    const summary = buildMatchOpportunitySummary([], ['F5', 'F4', 'F5']);
    expect(summary).toEqual([{
      format: 'F5',
      playersNeeded: 10,
      compatiblePlayers: 1,
      missingPlayers: 9,
      ready: false,
    }]);
  });
});
