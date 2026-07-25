export const TEAM_ENTRY_STATUSES = Object.freeze([
  'draft',
  'invited',
  'in_progress',
  'submitted',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
  'archived',
]);

export const TEAM_ENTRY_STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  invited: 'Invitado',
  in_progress: 'En preparación',
  submitted: 'Presentado',
  changes_requested: 'Con observaciones',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  withdrawn: 'Retirado',
  archived: 'Archivado',
});

export const TEAM_ENTRY_TRANSITIONS = Object.freeze({
  draft: ['invited', 'in_progress', 'withdrawn', 'archived'],
  invited: ['in_progress', 'withdrawn', 'archived'],
  in_progress: ['submitted', 'withdrawn', 'archived'],
  submitted: ['approved', 'changes_requested', 'rejected', 'archived'],
  changes_requested: ['submitted', 'withdrawn', 'archived'],
  approved: ['withdrawn', 'archived'],
  rejected: ['archived'],
  withdrawn: ['archived'],
  archived: [],
});

export const ROSTER_POSITIONS = Object.freeze([
  { value: 'ARQ', label: 'Arquero' },
  { value: 'DEF', label: 'Defensor' },
  { value: 'MED', label: 'Mediocampista' },
  { value: 'DEL', label: 'Delantero' },
]);

export function getRosterProgress(players = [], settings = {}) {
  const count = players.length;
  const minimum = Number(settings.minimumPlayers || 0);
  const maximum = Number(settings.maximumPlayers || 0);
  const goalkeepers = players.filter((player) => player.isGoalkeeper).length;
  const minimumGoalkeepers = Number(settings.minimumGoalkeepers || 0);
  const errors = [];
  if (count < minimum) errors.push(`Faltan ${minimum - count} jugadores para el mínimo.`);
  if (maximum && count > maximum) errors.push(`El plantel supera el máximo de ${maximum}.`);
  if (goalkeepers < minimumGoalkeepers) {
    errors.push(`Faltan ${minimumGoalkeepers - goalkeepers} arqueros.`);
  }
  if (settings.shirtNumberRequired && players.some((player) => player.shirtNumber == null)) {
    errors.push('Todos los jugadores necesitan dorsal.');
  }
  if (settings.positionRequired && players.some((player) => !player.primaryPosition)) {
    errors.push('Todos los jugadores necesitan una posición.');
  }
  const numbers = players.map((player) => player.shirtNumber).filter((value) => value != null);
  if (settings.uniqueShirtNumbers && new Set(numbers).size !== numbers.length) {
    errors.push('Hay dorsales repetidos.');
  }
  return {
    count,
    minimum,
    maximum,
    goalkeepers,
    minimumGoalkeepers,
    errors,
    complete: errors.length === 0,
    percent: minimum ? Math.min(100, Math.round((count / minimum) * 100)) : 0,
  };
}
