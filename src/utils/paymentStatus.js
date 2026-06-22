// Pure helpers for post-match payments.
// No DB / no side effects so they can be unit-tested in isolation.

export const PAYMENT_STATUSES = ['pending', 'reported_paid', 'paid', 'exempt'];

const STATUS_META = {
  paid: {
    key: 'paid',
    label: 'Pagado',
    // verde
    pillClass: 'border-[#22c55e]/45 bg-[#22c55e]/12 text-[#86efac]',
    dotClass: 'bg-[#22c55e]',
  },
  reported_paid: {
    key: 'reported_paid',
    label: 'Avisó pago',
    // amarillo / naranja
    pillClass: 'border-amber-400/40 bg-amber-500/12 text-amber-300',
    dotClass: 'bg-amber-400',
  },
  exempt: {
    key: 'exempt',
    label: 'Exento',
    // gris / azul
    pillClass: 'border-[#38bdf8]/45 bg-[#38bdf8]/10 text-[#bae6fd]',
    dotClass: 'bg-[#38bdf8]',
  },
  pending: {
    key: 'pending',
    label: 'Debe',
    // rojo: deuda pendiente (debe / no pagó)
    pillClass: 'border-[#f43f5e]/55 bg-[#f43f5e]/14 text-[#fda4af]',
    dotClass: 'bg-[#f43f5e]',
  },
};

/**
 * Returns label + Tailwind classes for a payment status (defaults to pending).
 * @param {string} status
 */
export const getPaymentStatusMeta = (status) => {
  const key = String(status || '').trim();
  return STATUS_META[key] || STATUS_META.pending;
};

const parseAmount = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

/**
 * Resolves the per-player amount: explicit payment amount first, then the
 * match price (precio_cancha_por_persona / legacy fields), else null.
 * @param {Object|null} settings - match_payment_settings row
 * @param {Object|null} partido - match row
 */
export const resolvePaymentAmount = (settings, partido) => {
  const fromSettings = parseAmount(settings?.amount_per_player);
  if (fromSettings !== null) return fromSettings;
  const fromMatch = parseAmount(
    partido?.precio_cancha_por_persona
    ?? partido?.precio_cancha
    ?? partido?.precio
    ?? partido?.valor_cancha,
  );
  return fromMatch;
};

/**
 * Formats an amount as ARS currency, or a fallback when no amount is set.
 * @param {number|null} amount
 * @param {string} fallback
 */
export const formatPaymentAmount = (amount, fallback = 'A definir') => {
  if (amount === undefined || amount === null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return fallback;
  }
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(amount));
};

/**
 * Aggregates a list of payment rows into counts.
 * @param {Array<{status:string}>} rows
 */
export const summarizePayments = (rows = []) => {
  const list = Array.isArray(rows) ? rows : [];
  const counts = { total: list.length, paid: 0, reported_paid: 0, pending: 0, exempt: 0 };
  list.forEach((row) => {
    const key = String(row?.status || 'pending');
    if (counts[key] === undefined) counts.pending += 1;
    else counts[key] += 1;
  });
  return {
    total: counts.total,
    paid: counts.paid,
    reported: counts.reported_paid,
    pending: counts.pending,
    exempt: counts.exempt,
    // settled = nothing left for the admin to chase
    settled: counts.pending === 0 && counts.reported_paid === 0,
  };
};

export const POST_MATCH_PLAYER_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h
export const POST_MATCH_ADMIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

/**
 * Decides whether a finished match should still appear in "Mis partidos" as a
 * post-match card. Only meaningful once the match has started.
 *
 * Player: hidden when (survey done AND payment settled) OR > 72h after kickoff.
 * Admin:  hidden when payments closed OR > 7 días after kickoff.
 *
 * @returns {boolean} true => keep showing the post-match card
 */
export const shouldShowPostMatchCard = ({
  isAdmin = false,
  startsAt = null,
  now = new Date(),
  hasCompletedSurvey = false,
  myPaymentStatus = null,
  paymentsConfigured = false,
  isClosed = false,
} = {}) => {
  const start = startsAt instanceof Date ? startsAt : (startsAt ? new Date(startsAt) : null);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!start || Number.isNaN(start.getTime())) return true; // sin fecha: no ocultar
  const elapsed = nowDate.getTime() - start.getTime();
  if (elapsed < 0) return true; // todavía no empezó

  if (isAdmin) {
    if (isClosed) return false;
    return elapsed <= POST_MATCH_ADMIN_WINDOW_MS;
  }

  const paymentSettled = !paymentsConfigured
    || ['paid', 'exempt'].includes(String(myPaymentStatus || ''));
  if (hasCompletedSurvey && paymentSettled) return false;
  return elapsed <= POST_MATCH_PLAYER_WINDOW_MS;
};
