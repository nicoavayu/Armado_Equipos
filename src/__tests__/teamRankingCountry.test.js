import {
  countryCodeToFlag,
  getTeamCountryCode,
  getTeamFlag,
  getCountryName,
  listCountriesFromRows,
  matchesCountry,
  sortRankingRows,
} from '../features/equipos/utils/teamRanking';

describe('teamRanking — país helpers', () => {
  test('countryCodeToFlag converts ISO alpha-2 to emoji', () => {
    expect(countryCodeToFlag('AR')).toBe('🇦🇷');
    expect(countryCodeToFlag('uy')).toBe('🇺🇾');
    expect(countryCodeToFlag('BR')).toBe('🇧🇷');
    expect(countryCodeToFlag('')).toBe('');
    expect(countryCodeToFlag('ARG')).toBe('');
  });

  test('getTeamCountryCode reads real country_code, falls back to AR', () => {
    expect(getTeamCountryCode({ country_code: 'UY' })).toBe('UY');
    expect(getTeamCountryCode({ country: 'br' })).toBe('BR');
    expect(getTeamCountryCode({})).toBe('AR'); // fallback, no rompe UI
    expect(getTeamFlag({ country_code: 'UY' })).toBe('🇺🇾');
  });

  test('getCountryName maps known codes', () => {
    expect(getCountryName('AR')).toBe('Argentina');
    expect(getCountryName('UY')).toBe('Uruguay');
    expect(getCountryName('ZZ')).toBe('ZZ');
  });

  test('listCountriesFromRows returns the distinct countries present (sorted)', () => {
    const rows = [
      { team_id: 'a', country_code: 'AR' },
      { team_id: 'b', country_code: 'UY' },
      { team_id: 'c', country_code: 'AR' },
      { team_id: 'd' }, // sin país -> AR por fallback
    ];
    const countries = listCountriesFromRows(rows);
    const codes = countries.map((c) => c.code);
    expect(codes).toEqual(['AR', 'UY']); // ordenado por nombre, sin duplicados
    expect(countries.find((c) => c.code === 'UY')).toMatchObject({ name: 'Uruguay', flag: '🇺🇾' });
  });

  test('matchesCountry filters by selected country, empty = todos', () => {
    const ar = { country_code: 'AR' };
    const uy = { country_code: 'UY' };
    expect(matchesCountry(ar, '')).toBe(true);
    expect(matchesCountry(ar, 'AR')).toBe(true);
    expect(matchesCountry(uy, 'AR')).toBe(false);
    expect(matchesCountry({}, 'AR')).toBe(true); // fallback AR
    expect(matchesCountry({}, 'UY')).toBe(false);
  });

  test('sortRankingRows still orders independently of country', () => {
    const rows = [
      { team_id: '1', team_name: 'A', played_count: 3, wins: 1, country_code: 'AR' },
      { team_id: '2', team_name: 'B', played_count: 9, wins: 5, country_code: 'UY' },
    ];
    const byPlayedDesc = sortRankingRows(rows, 'played', 'desc').map((r) => r.team_id);
    expect(byPlayedDesc).toEqual(['2', '1']);
    const byPlayedAsc = sortRankingRows(rows, 'played', 'asc').map((r) => r.team_id);
    expect(byPlayedAsc).toEqual(['1', '2']);
  });
});
