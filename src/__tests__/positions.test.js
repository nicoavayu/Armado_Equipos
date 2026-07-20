import {
  normalizePositionToken,
  normalizePositions,
  getProfilePositions,
  getDisplayPositions,
  hasGoalkeeperPosition,
  togglePosition,
  MAX_POSITIONS,
} from '../utils/positions';

describe('positions helpers', () => {
  test('normalizePositionToken maps aliases and rejects junk', () => {
    expect(normalizePositionToken('arquero')).toBe('ARQ');
    expect(normalizePositionToken(' def ')).toBe('DEF');
    expect(normalizePositionToken('Mediocampista')).toBe('MED');
    expect(normalizePositionToken('DELANTERO')).toBe('DEL');
    expect(normalizePositionToken('coach')).toBeNull();
    expect(normalizePositionToken('')).toBeNull();
    expect(normalizePositionToken(null)).toBeNull();
  });

  test('normalizePositions dedupes, validates and caps at 2', () => {
    expect(normalizePositions(['ARQ', 'ARQ', 'DEF'])).toEqual(['ARQ', 'DEF']);
    expect(normalizePositions(['DEF', 'MED', 'DEL'])).toEqual(['DEF', 'MED']);
    expect(normalizePositions(['ARQ', 'bogus', 'DEL'])).toEqual(['ARQ', 'DEL']);
    expect(normalizePositions('arquero, delantero')).toEqual(['ARQ', 'DEL']);
    expect(normalizePositions('DEF')).toEqual(['DEF']);
    expect(normalizePositions(null)).toEqual([]);
  });

  test('MAX_POSITIONS is 2', () => {
    expect(MAX_POSITIONS).toBe(2);
    expect(normalizePositions(['ARQ', 'DEF', 'MED', 'DEL']).length).toBe(2);
  });

  test('getProfilePositions prefers array, falls back to legacy posicion', () => {
    expect(getProfilePositions({ posiciones: ['ARQ', 'DEL'] })).toEqual(['ARQ', 'DEL']);
    expect(getProfilePositions({ posicion: 'MED' })).toEqual(['MED']);
    expect(getProfilePositions({ posiciones: [], posicion: 'DEF' })).toEqual(['DEF']);
    expect(getProfilePositions({})).toEqual([]);
  });

  test('getDisplayPositions never returns empty (falls back to DEF)', () => {
    expect(getDisplayPositions({})).toEqual(['DEF']);
    expect(getDisplayPositions({ posiciones: ['ARQ'] })).toEqual(['ARQ']);
  });

  test('hasGoalkeeperPosition detects ARQ', () => {
    expect(hasGoalkeeperPosition({ posiciones: ['ARQ', 'DEL'] })).toBe(true);
    expect(hasGoalkeeperPosition({ posiciones: ['DEF', 'MED'] })).toBe(false);
    expect(hasGoalkeeperPosition({ posicion: 'ARQ' })).toBe(true);
  });

  describe('togglePosition — max 2, no duplicates', () => {
    test('adds a new position when under the cap', () => {
      expect(togglePosition(['DEF'], 'ARQ')).toEqual(['DEF', 'ARQ']);
    });

    test('removes a selected position', () => {
      expect(togglePosition(['DEF', 'ARQ'], 'ARQ')).toEqual(['DEF']);
    });

    test('does not add a third position', () => {
      expect(togglePosition(['DEF', 'ARQ'], 'DEL')).toEqual(['DEF', 'ARQ']);
    });

    test('never produces duplicates', () => {
      expect(togglePosition(['ARQ'], 'ARQ')).toEqual([]);
      expect(togglePosition(['DEF'], 'def')).toEqual([]);
    });

    test('ignores invalid keys', () => {
      expect(togglePosition(['DEF'], 'bogus')).toEqual(['DEF']);
    });
  });
});
