import {
  ZONE_UNDEFINED_LABEL,
  computeWinRate,
  countryCodeToFlag,
  defaultSortDir,
  formatFormatLabel,
  formatStatsLine,
  formatZoneLabel,
  getRankAccent,
  getTeamCountryCode,
  getTeamFlag,
  hasDefinedZone,
  nextSort,
  sortDirectoryRows,
  sortRankingRows,
} from '../features/equipos/utils/teamRanking';

const AR_FLAG = '🇦🇷';

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

  describe('country / flag (Test 6)', () => {
    test('countryCodeToFlag maps ISO codes to emoji flags', () => {
      expect(countryCodeToFlag('AR')).toBe(AR_FLAG);
      expect(countryCodeToFlag('uy')).toBe('🇺🇾');
      expect(countryCodeToFlag('BR')).toBe('🇧🇷');
    });

    test('countryCodeToFlag is safe on bad input', () => {
      expect(countryCodeToFlag('')).toBe('');
      expect(countryCodeToFlag(null)).toBe('');
      expect(countryCodeToFlag('ARG')).toBe('');
      expect(countryCodeToFlag('1')).toBe('');
    });

    test('getTeamCountryCode reads team data and falls back to AR', () => {
      expect(getTeamCountryCode({ country_code: 'UY' })).toBe('UY');
      expect(getTeamCountryCode({ countryCode: 'br' })).toBe('BR');
      expect(getTeamCountryCode({ country: 'cl' })).toBe('CL');
      expect(getTeamCountryCode({})).toBe('AR');
      expect(getTeamCountryCode(null)).toBe('AR');
      expect(getTeamCountryCode({ country: 'Argentina' })).toBe('AR'); // not a 2-letter code
    });

    test('getTeamFlag never disappears (AR fallback)', () => {
      expect(getTeamFlag({})).toBe(AR_FLAG);
      expect(getTeamFlag({ country_code: 'UY' })).toBe('🇺🇾');
    });
  });

  describe('sorting (Tests 4)', () => {
    const rows = [
      { team_id: 'z', team_name: 'Zeta', format: 5, played_count: 3, wins: 1, draws: 0, losses: 2 }, // 33%
      { team_id: 'a', team_name: 'Alfa', format: 11, played_count: 10, wins: 7, draws: 1, losses: 2 }, // 70%
      { team_id: 'm', team_name: 'Mid', format: 7, played_count: 10, wins: 3, draws: 3, losses: 4 }, // 30%
    ];
    const ids = (sorted) => sorted.map((r) => r.team_id);

    test('defaultSortDir: stats start desc, text/format start asc', () => {
      expect(defaultSortDir('played')).toBe('desc');
      expect(defaultSortDir('wins')).toBe('desc');
      expect(defaultSortDir('winRate')).toBe('desc');
      expect(defaultSortDir('name')).toBe('asc');
      expect(defaultSortDir('format')).toBe('asc');
    });

    test('nextSort activates new column at its default dir, toggles the active one', () => {
      expect(nextSort({ key: 'played', dir: 'desc' }, 'wins')).toEqual({ key: 'wins', dir: 'desc' });
      expect(nextSort({ key: 'wins', dir: 'desc' }, 'wins')).toEqual({ key: 'wins', dir: 'asc' });
      expect(nextSort({ key: 'wins', dir: 'asc' }, 'wins')).toEqual({ key: 'wins', dir: 'desc' });
      expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' });
    });

    test('sortRankingRows does not mutate the input', () => {
      const copy = [...rows];
      sortRankingRows(rows, 'played', 'desc');
      expect(rows).toEqual(copy);
    });

    test('sort by played (PJ): desc and asc, with win-rate tie-break', () => {
      // a & m both played 10 -> tie broken by higher win rate (a 70% > m 30%).
      expect(ids(sortRankingRows(rows, 'played', 'desc'))).toEqual(['a', 'm', 'z']);
      expect(ids(sortRankingRows(rows, 'played', 'asc'))).toEqual(['z', 'a', 'm']);
    });

    test('sort by wins (G)', () => {
      expect(ids(sortRankingRows(rows, 'wins', 'desc'))).toEqual(['a', 'm', 'z']);
    });

    test('sort by winRate (%)', () => {
      expect(ids(sortRankingRows(rows, 'winRate', 'desc'))).toEqual(['a', 'z', 'm']);
    });

    test('sort by format (F)', () => {
      expect(ids(sortRankingRows(rows, 'format', 'asc'))).toEqual(['z', 'm', 'a']);
      expect(ids(sortRankingRows(rows, 'format', 'desc'))).toEqual(['a', 'm', 'z']);
    });

    test('sort by name (Equipo), alphabetical', () => {
      expect(ids(sortRankingRows(rows, 'name', 'asc'))).toEqual(['a', 'm', 'z']);
      expect(ids(sortRankingRows(rows, 'name', 'desc'))).toEqual(['z', 'm', 'a']);
    });

    test('unknown sort key returns a stable copy', () => {
      expect(ids(sortRankingRows(rows, 'nope', 'desc'))).toEqual(['z', 'a', 'm']);
    });
  });

  describe('sortDirectoryRows (Equipos: mis equipos primero, luego A-Z)', () => {
    const rows = [
      { team_id: 'r-zeta', team_name: 'Zeta FC' },
      { team_id: 'mine-b', team_name: 'Bravos' },
      { team_id: 'r-alfa', team_name: 'Alfa' },
      { team_id: 'mine-a', team_name: 'Águilas' },
    ];
    const isMine = (team) => String(team?.team_id || '').startsWith('mine-');
    const ids = (sorted) => sorted.map((r) => r.team_id);

    test('mis equipos primero (A-Z), después el resto (A-Z)', () => {
      expect(ids(sortDirectoryRows(rows, isMine))).toEqual([
        'mine-a', // Águilas
        'mine-b', // Bravos
        'r-alfa', // Alfa
        'r-zeta', // Zeta FC
      ]);
    });

    test('si no soy de ningún equipo, queda todo alfabético', () => {
      // Águilas, Alfa, Bravos, Zeta FC
      expect(ids(sortDirectoryRows(rows, () => false))).toEqual([
        'mine-a', 'r-alfa', 'mine-b', 'r-zeta',
      ]);
    });

    test('no muta el input y tolera entradas inválidas', () => {
      const copy = [...rows];
      sortDirectoryRows(rows, isMine);
      expect(rows).toEqual(copy);
      expect(sortDirectoryRows(null, isMine)).toEqual([]);
      expect(sortDirectoryRows(rows, undefined).map((r) => r.team_id)).toEqual([
        'mine-a', 'r-alfa', 'mine-b', 'r-zeta',
      ]);
    });
  });
});
