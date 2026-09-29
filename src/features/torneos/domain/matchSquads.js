//
// Cuándo se puede guardar o presentar una convocatoria.
//
// La regla es la de `save_match_squad` / `submit_match_squad` (base de Torneos,
// 0000 + 0006), en su orden:
//
//   1. el partido tiene que estar `scheduled` o `ready` (si no, TORNEOS_MATCH_FORBIDDEN);
//   2. el partido no puede tener un acta activa: cualquier operación que no esté
//      `superseded` ni `voided` la cierra (TORNEOS_MATCH_OPERATION_ACTIVE). Un partido
//      oficial sigue `scheduled`/`ready` en la planificación, así que es este paso
//      el que lo rechaza;
//   3. la convocatoria tiene que seguir en borrador (TORNEOS_MATCH_SQUAD_LOCKED).
//
// El frontend sólo lo usa para no ofrecer una acción que el backend va a
// rechazar siempre y para explicar por qué. El backend sigue siendo la autoridad:
// un dato viejo en pantalla termina en el mismo rechazo, con esta misma copy.
//

export const SQUAD_EDITABLE_MATCH_STATUSES = Object.freeze(['scheduled', 'ready']);
const CLOSED_OPERATION_STATUSES = Object.freeze(['superseded', 'voided']);

const MATCH_STATUS_LOCK_COPY = Object.freeze({
  postponed: 'El partido está postergado: la convocatoria se conserva, pero no admite cambios hasta que se reprograme.',
  cancelled: 'El partido fue cancelado: la convocatoria ya no admite cambios.',
});
const MATCH_STATUS_LOCK_FALLBACK = 'El partido todavía no está programado: la convocatoria se habilita cuando tenga fecha.';

export const SQUAD_OFFICIAL_LOCK_MESSAGE = 'El partido ya tiene resultado oficial. La convocatoria quedó cerrada cuando se abrió el acta y ya no se puede guardar ni presentar.';
export const SQUAD_OPERATION_LOCK_MESSAGE = 'El acta de este partido ya fue abierta, así que la convocatoria quedó cerrada: ya no se puede guardar ni presentar.';

export function hasActiveMatchOperation({ operationId = null, operationStatus = null } = {}) {
  return Boolean(operationId) && !CLOSED_OPERATION_STATUSES.includes(operationStatus);
}

/**
 * `null` cuando la convocatoria se puede editar; si no, `{ code, message }` con la
 * causa. `operationId` / `operationStatus` vienen de la fila del partido
 * (get_tournament_match_operations_context); sin ellos (vista del capitán) sólo se
 * evalúa el estado del partido y el backend decide el resto.
 */
export function describeSquadLock({
  planningStatus = null,
  operationId = null,
  operationStatus = null,
} = {}) {
  if (planningStatus && !SQUAD_EDITABLE_MATCH_STATUSES.includes(planningStatus)) {
    return {
      code: 'match_status',
      message: MATCH_STATUS_LOCK_COPY[planningStatus] || MATCH_STATUS_LOCK_FALLBACK,
    };
  }
  if (hasActiveMatchOperation({ operationId, operationStatus })) {
    return operationStatus === 'official'
      ? { code: 'official', message: SQUAD_OFFICIAL_LOCK_MESSAGE }
      : { code: 'operation_active', message: SQUAD_OPERATION_LOCK_MESSAGE };
  }
  return null;
}

// TORNEOS_MATCH_OPERATION_ACTIVE lo levantan también la programación y la
// disponibilidad, así que su copy general no habla de convocatorias en
// particular. Desde la convocatoria, el rechazo se explica en sus términos.
export function getSquadActionErrorMessage(error, fallback) {
  const code = error?.code;
  const text = [code, error?.message].filter(Boolean).join(' ');
  if (text.includes('TORNEOS_MATCH_OPERATION_ACTIVE')) return SQUAD_OPERATION_LOCK_MESSAGE;
  return fallback;
}
