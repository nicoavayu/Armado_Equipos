import {
  filterMatchesBySearchType,
  getMatchSearchBadges,
  getConvocatoriaDescription,
  matchSearchesPlayers,
  matchSearchesGoalkeeper,
} from '../utils/matchSearchFilters';

const playersOnly = { id: 1, falta_jugadores: true, busca_arquero: false };
const goalkeeperOnly = { id: 2, falta_jugadores: false, busca_arquero: true };
const both = { id: 3, falta_jugadores: true, busca_arquero: true };
const neither = { id: 4, falta_jugadores: false, busca_arquero: false };

const all = [playersOnly, goalkeeperOnly, both, neither];

describe('match search flags', () => {
  test('matchSearchesPlayers / matchSearchesGoalkeeper', () => {
    expect(matchSearchesPlayers(playersOnly)).toBe(true);
    expect(matchSearchesGoalkeeper(playersOnly)).toBe(false);
    expect(matchSearchesGoalkeeper(goalkeeperOnly)).toBe(true);
  });

  test('getMatchSearchBadges reflects both needs', () => {
    expect(getMatchSearchBadges(both)).toEqual({ players: true, goalkeeper: true });
    expect(getMatchSearchBadges(neither)).toEqual({ players: false, goalkeeper: false });
  });
});

describe('filterMatchesBySearchType', () => {
  test('Todos returns everything', () => {
    expect(filterMatchesBySearchType(all, 'all')).toHaveLength(4);
  });

  test('Buscan jugadores returns player-searching matches (incl. both)', () => {
    expect(filterMatchesBySearchType(all, 'players').map((m) => m.id)).toEqual([1, 3]);
  });

  test('Buscan arquero returns goalkeeper-searching matches (incl. both)', () => {
    expect(filterMatchesBySearchType(all, 'goalkeeper').map((m) => m.id)).toEqual([2, 3]);
  });

  test('a "both" match is never duplicated', () => {
    const players = filterMatchesBySearchType([both], 'players');
    const gk = filterMatchesBySearchType([both], 'goalkeeper');
    expect(players).toHaveLength(1);
    expect(gk).toHaveLength(1);
  });
});

describe('getConvocatoriaDescription', () => {
  test('all four combinations', () => {
    expect(getConvocatoriaDescription(false, false)).toBe('El partido no está abierto a solicitudes.');
    expect(getConvocatoriaDescription(true, false)).toBe('Otros jugadores pueden solicitar sumarse.');
    expect(getConvocatoriaDescription(false, true)).toBe('Arqueros disponibles pueden solicitar sumarse.');
    expect(getConvocatoriaDescription(true, true)).toBe('El partido busca jugadores y también arquero.');
  });
});
