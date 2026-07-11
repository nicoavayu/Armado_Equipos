import {
  buildMatchOpportunitySummary,
  normalizeAvailabilityInput,
} from '../services/db/availability';

describe('availability MVP', () => {
  const base = {
    days: [1, 3, 5],
    timeStart: '20:00',
    timeEnd: '23:00',
    formats: ['F5'],
  };

  test('normalizes days, formats, distance and coordinates', () => {
    const result = normalizeAvailabilityInput({
      days: ['5', 1, 1, 3, 9],
      timeStart: '20:00',
      timeEnd: '23:00',
      formats: ['f5', 'F7', 'F7', 'unknown'],
      maxDistanceKm: 90,
      latitude: '-34.6037',
      longitude: '-58.3816',
    });

    expect(result.days).toEqual([1, 3, 5]);
    expect(result.timeStart).toBe('20:00');
    expect(result.timeEnd).toBe('23:00');
    expect(result.formats).toEqual(['F5', 'F7']);
    expect(result.maxDistanceKm).toBe(50);
    expect(result.latitude).toBe(-34.6037);
    expect(result.longitude).toBe(-58.3816);
  });

  test('accepts 24:00 as an end-of-day bound', () => {
    const result = normalizeAvailabilityInput({ ...base, timeStart: '22:00', timeEnd: '24:00' });
    expect(result.timeEnd).toBe('24:00');
  });

  test('rejects empty or invalid day lists', () => {
    expect(() => normalizeAvailabilityInput({ ...base, days: [] })).toThrow('al menos un día');
    expect(() => normalizeAvailabilityInput({ ...base, days: [0, 8] })).toThrow('al menos un día');
  });

  test('rejects an inverted time range', () => {
    expect(() => normalizeAvailabilityInput({ ...base, timeStart: '23:00', timeEnd: '20:00' }))
      .toThrow('posterior al inicio');
  });

  test('rejects unparseable times', () => {
    expect(() => normalizeAvailabilityInput({ ...base, timeStart: 'no es hora' }))
      .toThrow('rango horario válido');
    expect(() => normalizeAvailabilityInput({ ...base, timeEnd: '24:30' }))
      .toThrow('rango horario válido');
  });

  test('rejects windows shorter than one hour', () => {
    expect(() => normalizeAvailabilityInput({ ...base, timeStart: '20:00', timeEnd: '20:30' }))
      .toThrow('al menos una hora');
  });

  test('rejects empty or unknown-only format lists', () => {
    expect(() => normalizeAvailabilityInput({ ...base, formats: ['F4', 'F12'] }))
      .toThrow('al menos un formato');
  });

  test('clamps distance to the minimum and defaults NaN', () => {
    expect(normalizeAvailabilityInput({ ...base, maxDistanceKm: 0.4 }).maxDistanceKm).toBe(1);
    expect(normalizeAvailabilityInput({ ...base, maxDistanceKm: 'nada' }).maxDistanceKm).toBe(8);
  });

  test('treats empty or invalid coordinates as missing, never 0,0', () => {
    const result = normalizeAvailabilityInput({
      ...base,
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
      gestationThreshold: 4,
      gestating: true,
    });
    expect(summary[1]).toEqual({
      format: 'F7',
      playersNeeded: 14,
      compatiblePlayers: 14,
      missingPlayers: 0,
      ready: true,
      gestationThreshold: 6,
      gestating: true,
    });
  });

  test('marks a format as gestating before the full cupo is reached', () => {
    const matches = Array.from({ length: 3 }, (_, index) => ({
      user_id: `user-${index}`,
      shared_formats: ['F5'],
    }));

    expect(buildMatchOpportunitySummary(matches, ['F5'])[0]).toMatchObject({
      compatiblePlayers: 4,
      playersNeeded: 10,
      gestationThreshold: 4,
      gestating: true,
      ready: false,
    });
  });

  test('does not mark gestation before the threshold', () => {
    const matches = Array.from({ length: 2 }, (_, index) => ({
      user_id: `user-${index}`,
      shared_formats: ['F7'],
    }));

    expect(buildMatchOpportunitySummary(matches, ['F7'])[0]).toMatchObject({
      compatiblePlayers: 3,
      gestationThreshold: 6,
      gestating: false,
      ready: false,
    });
  });

  test('orders opportunities: gestating first, then ready and fewest missing players', () => {
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
      gestationThreshold: 4,
      gestating: false,
    }]);
  });
});
