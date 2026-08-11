const STATUS_LABELS = Object.freeze({
  active: 'En juego',
  approved: 'Aprobado',
  archived: 'Archivado',
  cancelled: 'Cancelado',
  completed: 'Finalizado',
  correction_requested: 'Corrección solicitada',
  draft: 'Borrador',
  frozen: 'Cerrado',
  hidden: 'Oculto',
  official: 'Oficial',
  open: 'Abierto',
  pending: 'Pendiente',
  pending_review: 'Pendiente de revisión',
  postponed: 'Postergado',
  published: 'Publicado',
  ready: 'Listo',
  registration: 'Inscripción',
  rejected: 'Rechazado',
  revoked: 'Revocado',
  scheduled: 'Programado',
  submitted: 'Presentado',
  superseded: 'Reemplazado',
  suspended: 'Suspendido',
  under_review: 'En revisión',
  unscheduled: 'Sin horario',
  validated: 'Validado',
  voided: 'Anulado',
  withdrawn: 'Retirado',
});

const MODALITY_LABELS = Object.freeze({
  football_5: 'Fútbol 5',
  football_6: 'Fútbol 6',
  football_7: 'Fútbol 7',
  football_8: 'Fútbol 8',
  football_9: 'Fútbol 9',
  football_11: 'Fútbol 11',
  futsal: 'Futsal',
});

const FORMAT_LABELS = Object.freeze({
  league: 'Liga',
  knockout: 'Eliminación directa',
  groups: 'Fase de grupos',
  groups_and_playoffs: 'Grupos y playoffs',
  league_and_playoffs: 'Liga y playoffs',
  custom_knockout: 'Eliminación personalizada',
});

const GENERATION_METHOD_LABELS = Object.freeze({
  automatic: 'Automática',
  manual: 'Manual',
  copied: 'Copia manual',
});

const REVIEW_TYPE_LABELS = Object.freeze({
  correction: 'Corrección',
  standard: 'Revisión',
});

function humanizeInternalValue(value, fallback = 'Sin definir') {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value).trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return text ? `${text.charAt(0).toLocaleUpperCase('es-AR')}${text.slice(1)}` : fallback;
}

export function getStatusLabel(value, fallback) {
  return STATUS_LABELS[value] || humanizeInternalValue(value, fallback);
}

export function getModalityLabel(value, fallback) {
  return MODALITY_LABELS[value] || humanizeInternalValue(value, fallback);
}

export function getFormatLabel(value, fallback) {
  return FORMAT_LABELS[value] || humanizeInternalValue(value, fallback);
}

export function getGenerationMethodLabel(value, fallback) {
  return GENERATION_METHOD_LABELS[value] || humanizeInternalValue(value, fallback);
}

export function getReviewTypeLabel(value, fallback) {
  return REVIEW_TYPE_LABELS[value] || humanizeInternalValue(value, fallback);
}

export { humanizeInternalValue };
