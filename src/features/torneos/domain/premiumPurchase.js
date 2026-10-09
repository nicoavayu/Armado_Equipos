// COMMERCE-PRODUCTION: how Mi plan and the purchase status page talk about a Premium purchase. Pure functions; the
// server decides every state (purchase reads, effective season entitlement), this module only names it.

// Fired when the plan of a season changed under the user's eyes (purchase confirmed, payment returned, chargeback).
// Other surfaces that keep their own copy of plan limits (Galería, Estudio Social) can listen and re-read.
export const PLAN_CHANGED_EVENT = 'torneos:plan-changed';

export function notifyPlanChanged({ organizationId, seasonId, plan }) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(PLAN_CHANGED_EVENT, { detail: { organizationId, seasonId, plan } }));
  } catch {
    // Old engines without CustomEvent: the next read of each surface still shows the server's plan.
  }
}

export const OPEN_PURCHASE_STATUSES = Object.freeze(['created', 'preference_created', 'pending']);

const currency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export function formatArs(amount) {
  return Number.isFinite(amount) ? currency.format(amount) : '';
}

const dateFormat = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
export function formatPurchaseDate(value) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? dateFormat.format(new Date(time)) : '';
}

// What the buyer reads for each purchase status (never provider codes).
export const PURCHASE_STATUS_COPY = Object.freeze({
  created: Object.freeze({ label: 'Pago sin iniciar', tone: 'pending' }),
  preference_created: Object.freeze({ label: 'Esperando el pago', tone: 'pending' }),
  pending: Object.freeze({ label: 'Pago en proceso', tone: 'pending' }),
  approved: Object.freeze({ label: 'Pago aprobado', tone: 'success' }),
  rejected: Object.freeze({ label: 'Pago rechazado', tone: 'failure' }),
  cancelled: Object.freeze({ label: 'Compra cancelada', tone: 'failure' }),
  expired: Object.freeze({ label: 'Solicitud vencida', tone: 'failure' }),
  refunded: Object.freeze({ label: 'Pago devuelto', tone: 'failure' }),
  charged_back: Object.freeze({ label: 'Pago en contracargo', tone: 'warning' }),
});
export function purchaseStatusCopy(status) {
  return PURCHASE_STATUS_COPY[status] || Object.freeze({ label: 'Estado en revisión', tone: 'pending' });
}

/**
 * The one purchase Mi plan talks about: the open one if any (only one can exist per season), otherwise the latest
 * that mattered (approved, returned or disputed). Closed attempts without money (expired, cancelled) are history.
 */
export function seasonPurchaseSummary(answer) {
  const purchases = Array.isArray(answer?.purchases) ? answer.purchases : [];
  const open = purchases.find((p) => OPEN_PURCHASE_STATUSES.includes(p.status));
  if (open) return { kind: 'open', purchase: open };
  const settled = purchases.find((p) => ['approved', 'refunded', 'charged_back'].includes(p.status));
  if (settled) return { kind: settled.status, purchase: settled };
  return { kind: 'none', purchase: null };
}

/** True while the open purchase still has a payable Mercado Pago checkout (the same one is reused, never a second). */
export function canContinueCheckout(purchase, now = Date.now()) {
  if (!purchase) return false;
  if (purchase.status === 'created') return true;
  if (purchase.status !== 'preference_created') return false;
  const expires = Date.parse(String(purchase.preferenceExpiresAt ?? ''));
  return Number.isFinite(expires) && expires > now;
}
