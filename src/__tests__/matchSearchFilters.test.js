import {
  filterMatchesBySearchType,
  getMatchSearchBadges,
  getConvocatoriaDescription,
  matchSearchesPlayers,
  matchSearchesGoalkeeper,
  toggleMatchSearchFilter,
  MATCH_SEARCH_FILTERS,
  MATCH_SEARCH_FILTER_CHIPS,
  MATCH_SEARCH_FILTER_LABELS,
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

describe('match search chips (ALL / PLAYER / GOALKEEPER)', () => {
  test('the three states still exist; only the two narrowing ones have a chip', () => {
    expect(MATCH_SEARCH_FILTERS).toEqual(['all', 'players', 'goalkeeper']);
    expect(MATCH_SEARCH_FILTER_CHIPS).toEqual(['players', 'goalkeeper']);
  });

  test('chip labels are the full, untruncated copy', () => {
    expect(MATCH_SEARCH_FILTER_LABELS.players).toBe('Busca jugador');
    expect(MATCH_SEARCH_FILTER_LABELS.goalkeeper).toBe('Busca arquero');
  });

  test('tapping a chip from ALL selects it', () => {
    expect(toggleMatchSearchFilter('all', 'players')).toBe('players');
    expect(toggleMatchSearchFilter('all', 'goalkeeper')).toBe('goalkeeper');
  });

  test('tapping the other chip switches filter', () => {
    expect(toggleMatchSearchFilter('players', 'goalkeeper')).toBe('goalkeeper');
    expect(toggleMatchSearchFilter('goalkeeper', 'players')).toBe('players');
  });

  test('tapping the active chip returns to ALL', () => {
    expect(toggleMatchSearchFilter('players', 'players')).toBe('all');
    expect(toggleMatchSearchFilter('goalkeeper', 'goalkeeper')).toBe('all');
  });

  test('an unknown chip falls back to ALL', () => {
    expect(toggleMatchSearchFilter('players', 'all')).toBe('all');
    expect(toggleMatchSearchFilter('players', 'nope')).toBe('all');
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
