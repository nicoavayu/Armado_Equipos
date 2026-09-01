/**
 * El período del partido, en castellano.
 *
 * `tournament_match_events.period` y `tournament_match_outcomes.suspension_period`
 * viajan como claves técnicas (`second_half`, `extra_time`) y hasta acá llegaban
 * intactas al acta: el timeline de eventos imprimía el valor crudo. Este módulo
 * es el único lugar donde esas claves se traducen, para que el enum de la base y
 * el texto que lee un veedor no vuelvan a ser la misma cadena.
 *
 * No se deriva del identificador (nada de `replace('_', ' ')`): son términos de
 * fútbol, no palabras separadas por guiones bajos. La lista cubre los ocho
 * valores del CHECK, incluido `unknown`, que la base admite y ninguna pantalla
 * ofrece.
 */
export const MATCH_PERIOD_LABELS = Object.freeze({
  pre_match: 'Prepartido',
  first_half: 'Primer tiempo',
  halftime: 'Entretiempo',
  second_half: 'Segundo tiempo',
  extra_time: 'Alargue',
  penalties: 'Penales',
  post_match: 'Postpartido',
  unknown: 'Período sin determinar',
});

/**
 * Traduce un período. Un valor desconocido no se imprime crudo: si la base
 * suma un período nuevo, la UI dice que no lo sabe en vez de filtrar la clave.
 */
export function getMatchPeriodLabel(value, fallback = 'Período sin determinar') {
  if (!value) return fallback;
  return MATCH_PERIOD_LABELS[value] || fallback;
}

const options = (values) => Object.freeze(
  values.map((value) => Object.freeze({ value, label: MATCH_PERIOD_LABELS[value] })),
);

/** Los períodos que se pueden elegir al cargar un evento del partido. */
export const MATCH_EVENT_PERIOD_OPTIONS = options([
  'pre_match', 'first_half', 'halftime', 'second_half', 'extra_time', 'penalties', 'post_match',
]);

/** Los períodos en los que un partido puede quedar suspendido. */
export const SUSPENSION_PERIOD_OPTIONS = options([
  'first_half', 'halftime', 'second_half', 'extra_time',
]);
