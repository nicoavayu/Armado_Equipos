// Pure helpers for the Jugar > PARTIDOS "what is this match looking for" filter
// and the compact card badges. A match can search for players
// (`falta_jugadores`), a goalkeeper (`busca_arquero`), both, or (once full/closed
// upstream) neither.

export const MATCH_SEARCH_FILTERS = ['all', 'players', 'goalkeeper'];

export const MATCH_SEARCH_FILTER_LABELS = {
  all: 'Todos',
  players: 'Busca jugador',
  goalkeeper: 'Busca arquero',
};

// Only the two narrowing filters are rendered as chips. `all` has no chip of its
// own: it is the state where neither chip is selected, so both labels fit on
// one line at 320px without truncation.
export const MATCH_SEARCH_FILTER_CHIPS = ['players', 'goalkeeper'];

/**
 * Next filter after tapping a chip: the chip's filter, or back to `all` when
 * the tapped chip was already active.
 * @param {('all'|'players'|'goalkeeper')} current
 * @param {('players'|'goalkeeper')} tapped
 * @returns {('all'|'players'|'goalkeeper')}
 */
export const toggleMatchSearchFilter = (current, tapped) => {
  if (!MATCH_SEARCH_FILTER_CHIPS.includes(tapped)) return 'all';
  return current === tapped ? 'all' : tapped;
};

/** @param {object} match @returns {boolean} */
export const matchSearchesPlayers = (match) => match?.falta_jugadores === true;

/** @param {object} match @returns {boolean} */
export const matchSearchesGoalkeeper = (match) => match?.busca_arquero === true;

/**
 * @param {object} match
 * @returns {{ players: boolean, goalkeeper: boolean }}
 */
export const getMatchSearchBadges = (match) => ({
  players: matchSearchesPlayers(match),
  goalkeeper: matchSearchesGoalkeeper(match),
});

/**
 * Single dynamic description line under the "Convocá jugadores" two toggles.
 * @param {boolean} players - "Jugadores" (falta_jugadores) toggle state.
 * @param {boolean} goalkeeper - "Arquero" (busca_arquero) toggle state.
 * @returns {string}
 */
export const getConvocatoriaDescription = (players, goalkeeper) => {
  if (players && goalkeeper) return 'El partido busca jugadores y también arquero.';
  if (players) return 'Otros jugadores pueden solicitar sumarse.';
  if (goalkeeper) return 'Arqueros disponibles pueden solicitar sumarse.';
  return 'El partido no está abierto a solicitudes.';
};

/**
 * Filter open matches by the active search-type chip.
 * @param {object[]} matches
 * @param {('all'|'players'|'goalkeeper')} filter
 * @returns {object[]}
 */
export const filterMatchesBySearchType = (matches, filter) => {
  const list = Array.isArray(matches) ? matches : [];
  if (filter === 'players') return list.filter(matchSearchesPlayers);
  if (filter === 'goalkeeper') return list.filter(matchSearchesGoalkeeper);
  return list;
};
