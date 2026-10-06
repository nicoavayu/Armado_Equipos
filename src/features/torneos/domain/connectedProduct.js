// CONNECTED-V1 — presentation of the connected product, shared by participants and organizers. Pure functions and
// copy only: every decision (who may apply, what is open, what consumes a place) is made by the backend.

// What a team representative sees for each state of their team entry. A request is never shown as a confirmed place.
export const REGISTRATION_STAGES = Object.freeze({
  draft: { key: 'preparing', label: 'En preparación', tone: 'neutral', detail: 'Completá el plantel y enviá la solicitud.' },
  invited: { key: 'preparing', label: 'Invitación pendiente', tone: 'neutral', detail: 'Aceptá la invitación para preparar el plantel.' },
  in_progress: { key: 'preparing', label: 'En preparación', tone: 'neutral', detail: 'Completá el plantel y enviá la solicitud.' },
  submitted: {
    key: 'submitted',
    label: 'Solicitud enviada',
    tone: 'pending',
    detail: 'La organización la está revisando. Todavía no ocupa un cupo.',
  },
  changes_requested: {
    key: 'changes',
    label: 'Cambios pedidos',
    tone: 'warning',
    detail: 'Revisá el pedido de la organización y volvé a enviar.',
  },
  approved: {
    key: 'approved',
    label: 'Inscripción confirmada',
    tone: 'success',
    detail: 'El equipo ocupa un cupo. El torneo se abre para sus responsables y para los jugadores del plantel aprobado.',
  },
  rejected: { key: 'rejected', label: 'Rechazada', tone: 'danger', detail: 'La organización no aprobó la inscripción.' },
  withdrawn: { key: 'withdrawn', label: 'Retirada', tone: 'neutral', detail: 'La inscripción fue retirada.' },
  archived: { key: 'withdrawn', label: 'Archivada', tone: 'neutral', detail: 'La inscripción fue archivada.' },
});

export function registrationStage(status) {
  return REGISTRATION_STAGES[status] || { key: 'unknown', label: 'Sin estado', tone: 'neutral', detail: '' };
}

export const OPEN_REGISTRATION_STATUSES = Object.freeze(['draft', 'invited', 'in_progress', 'submitted', 'changes_requested']);

// Why a call does not accept requests (tournament_catalog_block_reason).
export const BLOCK_REASON_COPY = Object.freeze({
  not_listed: 'La convocatoria ya no está publicada.',
  paused: 'La organización pausó las solicitudes por ahora.',
  closed: 'Las inscripciones están cerradas.',
  not_open_yet: 'Las inscripciones todavía no abrieron.',
  category_unavailable: 'Esa categoría ya no está disponible.',
  category_full: 'La categoría completó su cupo.',
});

export const CATALOG_STATE = Object.freeze({
  open: { label: 'Inscripción abierta', tone: 'success' },
  paused: { label: 'Solicitudes pausadas', tone: 'warning' },
  closed: { label: 'Inscripción cerrada', tone: 'neutral' },
  upcoming: { label: 'Abre pronto', tone: 'pending' },
  full: { label: 'Cupos completos', tone: 'neutral' },
});

export const CATALOG_SORTS = Object.freeze([
  { value: 'closing', label: 'Cierre de inscripción más próximo' },
  { value: 'starting', label: 'Inicio más próximo' },
  { value: 'recent', label: 'Publicadas recientemente' },
]);

export const GENDER_LABELS = Object.freeze({
  male: 'Masculino',
  female: 'Femenino',
  mixed: 'Mixto',
  open: 'Abierto',
});

const SPORT_LABELS = Object.freeze({
  football_5: 'Fútbol 5',
  football_6: 'Fútbol 6',
  football_7: 'Fútbol 7',
  football_8: 'Fútbol 8',
  football_9: 'Fútbol 9',
  football_11: 'Fútbol 11',
});

export function sportLabel(code) {
  return SPORT_LABELS[code] || (code ? String(code).replace(/_/g, ' ') : 'Deporte a definir');
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

// The entry fee is information, never a checkout: Arma2 does not collect it.
export const ENTRY_FEE_UNITS = Object.freeze({ team: 'por equipo', player: 'por jugador' });

// Three different things, never collapsed: not informed (null), free (0) and a price (with its unit). Not informed
// is not «free»: `null` is returned so a card shows nothing instead of an empty or invented label.
export function entryFeeState(entryFee) {
  if (!entryFee || entryFee.amountCents === null || entryFee.amountCents === undefined) return 'not_informed';
  return Number(entryFee.amountCents) === 0 ? 'free' : 'price';
}

export function entryFeeLabel(entryFee) {
  const state = entryFeeState(entryFee);
  if (state === 'not_informed') return null;
  if (state === 'free') return 'Participación gratuita';
  return `${money.format(Number(entryFee.amountCents) / 100)} ${ENTRY_FEE_UNITS[entryFee.unit] || ENTRY_FEE_UNITS.team}`;
}

// The organizer's WhatsApp for one call (published by them for it): an international number, digits only.
export function whatsappContactUrl(number, tournamentName) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  const text = `Hola, vi la convocatoria «${String(tournamentName || '').slice(0, 80)}» en Arma2 Torneos y quería hacer una consulta.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function formatWhatsapp(number) {
  const digits = String(number || '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export function formatDay(value, { withYear = false } = {}) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function periodLabel(startDate, endDate) {
  const start = formatDay(startDate, { withYear: true });
  const end = formatDay(endDate, { withYear: true });
  if (start && end) return `${start} → ${end}`;
  if (start) return `Desde ${start}`;
  if (end) return `Hasta ${end}`;
  return 'Fechas a confirmar';
}

export function ageRangeLabel(minAge, maxAge) {
  if (minAge && maxAge) return `${minAge} a ${maxAge} años`;
  if (minAge) return `Desde ${minAge} años`;
  if (maxAge) return `Hasta ${maxAge} años`;
  return 'Sin límite de edad';
}

export function capacityLabel(category) {
  if (!category || category.capacity === null || category.capacity === undefined) return 'Sin cupo máximo publicado';
  const remaining = Math.max(Number(category.capacity) - Number(category.approvedTeams || 0), 0);
  if (remaining === 0) return `Completo · ${category.capacity} equipos`;
  return `Quedan ${remaining} de ${category.capacity} lugares`;
}

// Where a Torneos inbox item leads. Only internal routes of Torneos, built from the item's own resource ids.
export function notificationTarget(item) {
  if (!item?.organizationId || !item?.tournamentId) return '/torneos/avisos';
  if (item.audience === 'organization') {
    const query = item.teamEntryId ? `?equipo=${encodeURIComponent(item.teamEntryId)}` : '';
    return `/torneos/organizacion/${encodeURIComponent(item.organizationId)}/torneo/${encodeURIComponent(item.tournamentId)}/solicitudes${query}`;
  }
  if (item.teamEntryId) {
    return `/torneos/mis-equipos/${encodeURIComponent(item.organizationId)}/${encodeURIComponent(item.teamEntryId)}`;
  }
  return '/torneos/mis-torneos';
}

