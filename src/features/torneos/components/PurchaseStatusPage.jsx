import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { useTorneosCommerce } from '../context/TorneosCommerceContext';
import { normalizeTournamentEntitlements, TOURNAMENT_PLANS } from '../domain/entitlements';
import styles from './PurchaseStatusPage.module.css';

const SUCCESS = new Set(['approved']);
const FAILURE = new Set(['rejected', 'cancelled', 'expired', 'refunded', 'charged_back']);
const OPEN_STATUSES = new Set(['created', 'preference_created', 'pending']);
// After these the season plan may have changed: read the effective entitlement again.
const PLAN_AFFECTING_STATUSES = new Set(['approved', 'refunded', 'charged_back']);
const POLL_INTERVAL_MS = 4000;

const STATUS_LABELS = Object.freeze({
  created: 'Compra iniciada',
  preference_created: 'Pago generado',
  pending: 'Pendiente de confirmación',
  approved: 'Pago aprobado',
  rejected: 'Pago no aprobado',
  cancelled: 'Compra cancelada',
  expired: 'Solicitud vencida',
  refunded: 'Pago reembolsado',
  charged_back: 'Pago en contracargo',
});

function statusLabel(status) {
  return STATUS_LABELS[status] || 'Estado en revisión';
}

function routeForStatus(organizationId, seasonId, purchaseId, status) {
  if (SUCCESS.has(status)) {
    return canonicalRoutes.seasonPurchaseSuccess(organizationId, seasonId, purchaseId);
  }
  if (FAILURE.has(status)) {
    return canonicalRoutes.seasonPurchaseFailure(organizationId, seasonId, purchaseId);
  }
  return canonicalRoutes.seasonPurchasePending(organizationId, seasonId, purchaseId);
}

// The redirect route (exito / pendiente / fallo) and any Mercado Pago query parameter only say
// which screen to open: the purchase read decides the view and, where the composition has the
// authority (hybrid), only the server's effective season entitlement can show Premium.
export default function PurchaseStatusPage({ view }) {
  const { organizationId, seasonId, tournamentId, purchaseId } = useParams();
  const commerce = useTorneosCommerce();
  const entitlementsAuthority = commerce.entitlementsAuthority === true;
  const [state, setState] = useState({
    status: 'loading', purchase: null, plan: null, error: '',
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const purchase = await commerce.loadPurchase({
        purchaseId,
        organizationId,
        seasonId,
        tournamentId,
      });
      let plan = null;
      if (entitlementsAuthority && PLAN_AFFECTING_STATUSES.has(purchase?.status)) {
        try {
          const payload = await commerce.loadSeasonEntitlements({
            organizationId,
            seasonId: purchase.seasonId,
          });
          const normalized = normalizeTournamentEntitlements(payload, {
            organizationId,
            seasonId: purchase.seasonId,
          });
          plan = normalized.isTrusted ? normalized.plan : null;
        } catch {
          plan = null;
        }
      }
      setState({
        status: 'ready', purchase, plan, error: '',
      });
    } catch (error) {
      setState({
        status: 'error',
        purchase: null,
        plan: null,
        error: error?.message || 'No pudimos consultar esta compra.',
      });
    }
  }, [commerce, entitlementsAuthority, organizationId, purchaseId, seasonId, tournamentId]);

  useEffect(() => { refresh(); }, [refresh]);
  // Poll only while the purchase is open; every final status stops it.
  useEffect(() => {
    if (state.status !== 'ready' || !OPEN_STATUSES.has(state.purchase?.status)) return undefined;
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, state.purchase?.status, state.status]);

  const canonicalView = useMemo(() => {
    if (!state.purchase) return null;
    return SUCCESS.has(state.purchase.status) ? 'success'
      : FAILURE.has(state.purchase.status) ? 'failure' : 'pending';
  }, [state.purchase]);

  if (state.status === 'loading' && !state.purchase) {
    return <main className={styles.page}><section className={styles.card} role="status">Verificando compra…</section></main>;
  }
  if (state.status === 'error') {
    return (
      <main className={styles.page}>
        <section className={styles.card} data-tone="failure">
          <AlertTriangle aria-hidden="true" />
          <p>{state.error}</p>
          <button type="button" onClick={refresh}><RefreshCw size={16} /> Reintentar</button>
        </section>
      </main>
    );
  }
  if (canonicalView && canonicalView !== view) {
    return <Navigate to={routeForStatus(
      organizationId,
      state.purchase.seasonId,
      purchaseId,
      state.purchase.status,
    )} replace />;
  }

  const premiumVerified = !entitlementsAuthority || state.plan === TOURNAMENT_PLANS.PREMIUM;
  const presentation = canonicalView === 'success' && premiumVerified ? {
    icon: CheckCircle2,
    eyebrow: 'PAGO VERIFICADO',
    title: 'Premium ya está activo',
    description: 'El pago se confirmó y Premium quedó activo para esta temporada.',
    tone: 'success',
  } : canonicalView === 'success' ? {
    icon: Clock3,
    eyebrow: 'PAGO APROBADO',
    title: 'Pago aprobado · verificando Premium',
    description: 'Todavía no vemos Premium activo en esta temporada. No lo consideres activo hasta que figure en el Plan; podés actualizar en unos minutos.',
    tone: 'pending',
  } : canonicalView === 'failure' ? {
    icon: AlertTriangle,
    eyebrow: 'COMPRA NO COMPLETADA',
    title: state.purchase.status === 'expired' ? 'La solicitud venció'
      : state.purchase.status === 'refunded' ? 'El pago fue reembolsado'
        : state.purchase.status === 'charged_back' ? 'El pago está en contracargo'
          : 'El pago no fue aprobado',
    description: ['refunded', 'charged_back'].includes(state.purchase.status)
      ? 'Premium no está activo porque se confirmó una reversión del pago.'
      : 'No se activó Premium. Podés volver al Plan e iniciar una compra nueva.',
    tone: 'failure',
  } : entitlementsAuthority && state.purchase.providerStatus === 'rejected' ? {
    // MP-A2.1: a rejected attempt leaves the purchase open (another card may still pay it).
    icon: AlertTriangle,
    eyebrow: 'INTENTO RECHAZADO',
    title: 'El último intento de pago no fue aprobado',
    description: 'La compra sigue abierta y Premium no se activó. Podés volver al Plan e intentar de nuevo con otro medio de pago.',
    tone: 'pending',
  } : {
    icon: Clock3,
    eyebrow: 'PAGO EN PROCESO',
    title: 'Estamos esperando confirmación',
    description: 'Tu solicitud se generó correctamente. Premium se activa cuando recibimos la confirmación del pago.',
    tone: 'pending',
  };
  const Icon = presentation.icon;
  const isTestPurchase = state.purchase.provider === 'FAKE';
  const planLabel = state.plan === TOURNAMENT_PLANS.PREMIUM ? 'Premium'
    : state.plan === TOURNAMENT_PLANS.FREE ? 'Free'
      : state.plan === TOURNAMENT_PLANS.PREMIUM_REQUIRED ? 'Premium requerido' : 'No verificado';
  const showPlan = entitlementsAuthority && PLAN_AFFECTING_STATUSES.has(state.purchase.status);

  return (
    <main className={styles.page}>
      <section className={styles.card} data-tone={presentation.tone}>
        <div className={styles.signal}><Icon size={38} aria-hidden="true" /></div>
        <span>{presentation.eyebrow}</span>
        <h1>{presentation.title}</h1>
        <p>{presentation.description}</p>
        <dl>
          <div><dt>Estado</dt><dd>{statusLabel(state.purchase.status)}</dd></div>
          <div><dt>Total</dt><dd>{new Intl.NumberFormat('es-AR', { style: 'currency', currency: state.purchase.currency, maximumFractionDigits: 0 }).format(state.purchase.amount)}</dd></div>
          <div>
            <dt>{isTestPurchase ? 'Entorno' : 'Medio de pago'}</dt>
            <dd>{isTestPurchase ? 'Prueba · sin cobro real' : 'Mercado Pago'}</dd>
          </div>
          {showPlan && (
            <div><dt>Plan de la temporada</dt><dd>{planLabel}</dd></div>
          )}
        </dl>
        <div className={styles.actions}>
          <Link to={canonicalRoutes.seasonPlan(organizationId, state.purchase.seasonId)}>Volver al Plan</Link>
          <button type="button" onClick={refresh}><RefreshCw size={16} /> Actualizar</button>
        </div>
        <small><ShieldCheck size={14} /> Premium se activa sólo cuando el pago queda verificado.</small>
        {isTestPurchase && (
          <details className={styles.qaDetails}>
            <summary>Información de prueba</summary>
            <code>status: {state.purchase.status} · provider: {state.purchase.provider}</code>
          </details>
        )}
      </section>
    </main>
  );
}
