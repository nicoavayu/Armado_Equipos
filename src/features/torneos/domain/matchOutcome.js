/**
 * Contrato del estado deportivo de un partido.
 *
 * `tournament_match_outcomes` sólo exige minuto, período y motivo cuando el
 * partido se suspendió; para el resto de los estados esas columnas son nulas.
 * El formulario del acta refleja eso mostrando el minuto únicamente para
 * "Suspendido", pero conservaba el valor del campo en el estado del componente,
 * así que enviaba una cadena vacía donde el backend espera un `smallint`. El
 * caso por defecto —"Jugado"— fallaba siempre con `22P02`.
 */

/** Estados que sí necesitan minuto, período y motivo. */
export const OUTCOMES_REQUIRING_SUSPENSION_DETAIL = Object.freeze(['suspended']);

export function outcomeRequiresSuspensionDetail(outcomeType) {
  return OUTCOMES_REQUIRING_SUSPENSION_DETAIL.includes(outcomeType);
}

function optionalText(value) {
  const text = typeof value === 'string' ? value.trim() : value;
  return text ? text : null;
}

function optionalMinute(value) {
  if (value === null || value === undefined || value === '') return null;
  const minute = Number(value);
  return Number.isInteger(minute) ? minute : null;
}

/**
 * Normaliza el estado deportivo antes de mandarlo al backend: los campos que el
 * estado elegido no usa viajan como `null`, nunca como cadena vacía.
 */
export function normalizeMatchOutcome(outcome = {}) {
  const outcomeType = outcome.outcomeType || 'played';
  const needsDetail = outcomeRequiresSuspensionDetail(outcomeType);
  return {
    outcomeType,
    reasonText: optionalText(outcome.reasonText),
    suspensionMinute: needsDetail ? optionalMinute(outcome.suspensionMinute) : null,
    suspensionPeriod: needsDetail ? (optionalText(outcome.suspensionPeriod) || null) : null,
    countsForStandings: Boolean(outcome.countsForStandings),
    countsForPlayerStats: Boolean(outcome.countsForPlayerStats),
    requiresResolution: Boolean(outcome.requiresResolution),
    eventsRemainValid: outcome.eventsRemainValid === undefined ? true : Boolean(outcome.eventsRemainValid),
  };
}

/**
 * Qué le falta al estado deportivo para poder guardarse, en lenguaje de producto.
 * Devuelve `null` cuando está completo.
 */
export function describeMatchOutcomeGap(outcome = {}) {
  if (!outcomeRequiresSuspensionDetail(outcome.outcomeType || 'played')) return null;
  const missing = [];
  if (optionalMinute(outcome.suspensionMinute) === null) missing.push('el minuto en que se suspendió');
  if (!optionalText(outcome.suspensionPeriod)) missing.push('el período');
  if (!optionalText(outcome.reasonText)) missing.push('el motivo');
  if (missing.length === 0) return null;
  if (missing.length === 1) return `Para un partido suspendido falta ${missing[0]}.`;
  return `Para un partido suspendido faltan ${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}.`;
}
