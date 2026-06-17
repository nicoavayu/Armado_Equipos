import {
  ZONE_UNDEFINED_LABEL,
  computeWinRate,
  formatFormatLabel,
  formatStatsLine,
  formatZoneLabel,
  getRankAccent,
  hasDefinedZone,
} from '../features/equipos/utils/teamRanking';

describe('teamRanking utils', () => {
  describe('computeWinRate (Test 10 / metric)', () => {
    test('wins/played * 100 rounded', () => {
      expect(computeWinRate(8, 12)).toBe(67); // 66.67 -> 67
      expect(computeWinRate(5, 9)).toBe(56); // 55.56 -> 56
      expect(computeWinRate(3, 3)).toBe(100);
    });

    test('returns 0 when there are no played matches', () => {
      expect(computeWinRate(0, 0)).toBe(0);
      expect(computeWinRate(5, 0)).toBe(0);
      expect(computeWinRate(undefined, undefined)).toBe(0);
      expect(computeWinRate(null, null)).toBe(0);
    });
  });

  describe('formatZoneLabel (Test 10: "Zona no definida")', () => {
    test('uses the team zone when present', () => {
      expect(formatZoneLabel('Villa Devoto')).toBe('Villa Devoto');
      expect(formatZoneLabel('  Palermo  ')).toBe('Palermo');
    });

    test('falls back to "Zona no definida" when missing', () => {
      expect(formatZoneLabel('')).toBe(ZONE_UNDEFINED_LABEL);
      expect(formatZoneLabel('   ')).toBe(ZONE_UNDEFINED_LABEL);
      expect(formatZoneLabel(null)).toBe(ZONE_UNDEFINED_LABEL);
      expect(formatZoneLabel(undefined)).toBe(ZONE_UNDEFINED_LABEL);
      expect(ZONE_UNDEFINED_LABEL).toBe('Zona no definida');
    });

    test('hasDefinedZone mirrors the fallback decision', () => {
      expect(hasDefinedZone('CABA')).toBe(true);
      expect(hasDefinedZone('   ')).toBe(false);
      expect(hasDefinedZone(null)).toBe(false);
    });
  });

  describe('formatFormatLabel (Test 12: F5/F6/F7/F11)', () => {
    test('renders F-prefixed format', () => {
      expect(formatFormatLabel(5)).toBe('F5');
      expect(formatFormatLabel(7)).toBe('F7');
      expect(formatFormatLabel(11)).toBe('F11');
      expect(formatFormatLabel('F8')).toBe('F8');
    });

    test('handles missing format gracefully', () => {
      expect(formatFormatLabel(null)).toBe('F-');
      expect(formatFormatLabel('')).toBe('F-');
    });
  });

  describe('formatStatsLine', () => {
    test('compact PJ/G/E/P/% line', () => {
      expect(formatStatsLine({ played: 12, wins: 8, draws: 2, losses: 2 })).toBe('12 PJ · 8G · 2E · 2P · 67%');
      expect(formatStatsLine({ played: 0, wins: 0, draws: 0, losses: 0 })).toBe('0 PJ · 0G · 0E · 0P · 0%');
    });
  });

  describe('getRankAccent', () => {
    test('only the podium gets an accent', () => {
      expect(getRankAccent(1)).toBeTruthy();
      expect(getRankAccent(2)).toBeTruthy();
      expect(getRankAccent(3)).toBeTruthy();
      expect(getRankAccent(4)).toBeNull();
      expect(getRankAccent(50)).toBeNull();
    });
  });
});
