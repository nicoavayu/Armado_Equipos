// Pure helpers for the Jugar > PARTIDOS "what is this match looking for" filter
// and the compact card badges. A match can search for players
// (`falta_jugadores`), a goalkeeper (`busca_arquero`), both, or (once full/closed
// upstream) neither.

export const MATCH_SEARCH_FILTERS = ['all', 'players', 'goalkeeper'];

export const MATCH_SEARCH_FILTER_LABELS = {
  all: 'Todos',
  players: 'Buscan jugadores',
  goalkeeper: 'Buscan arquero',
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
