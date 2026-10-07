import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { normalizeTournamentEntitlements, TOURNAMENT_PLANS } from '../domain/entitlements';
import { formatPurchaseDate, notifyPlanChanged } from '../domain/premiumPurchase';
import styles from './PurchaseStatusPage.module.css';

const SUCCESS = new Set(['approved']);
const FAILURE = new Set(['rejected', 'cancelled', 'expired', 'refunded', 'charged_back']);
const OPEN_STATUSES = new Set(['created', 'preference_created', 'pending']);
// After these the season plan may have changed: read the effective entitlement again.
const PLAN_AFFECTING_STATUSES = new Set(['approved', 'refunded', 'charged_back']);
const POLL_INTERVAL_MS = 4000;
// COMMERCE-PRODUCTION: the page polls the server's own read for 3 minutes after a return from Mercado Pago, then stops
// and says so; "Consultar de nuevo" asks Mercado Pago again through the gateway (throttled per purchase on the server).
const MAX_POLLS = 45;

const STATUS_LABELS = Object.freeze({
  created: 'Compra iniciada',
  preference_created: 'Esperando el pago',
  pending: 'Pago en proceso',
  approved: 'Pago aprobado',
  rejected: 'Pago rechazado',
  cancelled: 'Compra cancelada',
  expired: 'Solicitud vencida',
  refunded: 'Pago devuelto',
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
  const competition = useOptionalTorneosCompetition();
  const sharedPlanRef = useRef(null);
  sharedPlanRef.current = competition?.activeSeason?.id === seasonId
    ? competition.retryPlan : null;
  const requestRef = useRef(0);
  const pollsRef = useRef(0);
  const reconciledRef = useRef(false);
  const notifiedRef = useRef(null);
  const entitlementsAuthority = commerce.entitlementsAuthority === true;
  const canReconcile = typeof commerce.refreshPurchase === 'function';
  const [state, setState] = useState({
    status: 'loading', purchase: null, plan: null, error: '',
  });
  const [pollingStopped, setPollingStopped] = useState(false);

  // `reconcile`: ask Mercado Pago through the gateway first (the return URL alone proves nothing); otherwise the plain
  // read of the purchase. Either way the database's answer is what the page shows.
  const refresh = useCallback(async ({ reconcile = false } = {}) => {
    const requestId = ++requestRef.current;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const input = { purchaseId, organizationId, seasonId, tournamentId };
      const purchase = reconcile && canReconcile
        ? (await commerce.refreshPurchase(input)).purchase
        : await commerce.loadPurchase(input);
      if (requestId !== requestRef.current) return;
      let plan = null;
      if (entitlementsAuthority && PLAN_AFFECTING_STATUSES.has(purchase?.status)) {
        try {
          // Reuse the context's authoritative read so Plan and this page agree.
          // Standalone/legacy compositions retain their existing adapter path.
          const refreshSharedPlan = sharedPlanRef.current;
          const normalized = refreshSharedPlan && purchase.seasonId === seasonId
            ? await refreshSharedPlan()
            : normalizeTournamentEntitlements(await commerce.loadSeasonEntitlements({
              organizationId,
              seasonId: purchase.seasonId,
            }), { organizationId, seasonId: purchase.seasonId });
          plan = normalized.isTrusted ? normalized.plan : null;
        } catch {
          plan = null;
        }
      }
      if (requestId !== requestRef.current) return;
      setState({
        status: 'ready', purchase, plan, error: '',
      });
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setState({
        status: 'error',
        purchase: null,
        plan: null,
        error: error?.message || 'No pudimos consultar esta compra.',
      });
    }
  }, [canReconcile, commerce, entitlementsAuthority, organizationId, purchaseId, seasonId, tournamentId]);

  useEffect(() => {
    pollsRef.current = 0;
    reconciledRef.current = false;
    setPollingStopped(false);
    refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);
  // Back from Mercado Pago with the purchase still open: one reconcile right away (webhook late or lost).
  useEffect(() => {
    if (state.status !== 'ready' || !OPEN_STATUSES.has(state.purchase?.status) || reconciledRef.current || !canReconcile) return;
    reconciledRef.current = true;
    refresh({ reconcile: true });
  }, [canReconcile, refresh, state.purchase?.status, state.status]);
  // Poll only while the purchase is open, at most MAX_POLLS times; every final status stops it.
  useEffect(() => {
    if (state.status !== 'ready' || !OPEN_STATUSES.has(state.purchase?.status) || pollingStopped) return undefined;
    const timer = window.setInterval(() => {
      pollsRef.current += 1;
      if (pollsRef.current > MAX_POLLS) { setPollingStopped(true); return; }
      refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pollingStopped, refresh, state.purchase?.status, state.status]);
  // Tell the other surfaces (Galería, Estudio Social…) once the server confirms a plan change of this season.
  useEffect(() => {
    if (state.status !== 'ready' || !entitlementsAuthority || !state.plan || !PLAN_AFFECTING_STATUSES.has(state.purchase?.status)) return;
    const key = `${state.purchase.id}:${state.purchase.status}:${state.plan}`;
    if (notifiedRef.current === key) return;
    notifiedRef.current = key;
    notifyPlanChanged({ organizationId, seasonId: state.purchase.seasonId, plan: state.plan });
  }, [entitlementsAuthority, organizationId, state.plan, state.purchase, state.status]);
  const consultAgain = () => { pollsRef.current = 0; setPollingStopped(false); refresh({ reconcile: true }); };

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
          <button type="button" onClick={() => refresh()}><RefreshCw size={16} /> Reintentar</button>
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
    description: state.purchase.status === 'refunded'
      ? 'Mercado Pago confirmó la devolución del pago. La temporada volvió a FREE y no se borró nada de lo cargado.'
      : state.purchase.status === 'charged_back'
        ? 'El pago está en disputa en Mercado Pago. Mientras se resuelve, la temporada funciona como FREE y no se borró nada.'
        : 'No se activó Premium y no se cobró nada por esta solicitud. Podés volver a Mi plan e iniciar una compra nueva.',
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
    description: state.purchase.status === 'pending'
      ? 'Mercado Pago está procesando el pago; algunos medios (por ejemplo, efectivo) tardan en acreditarse. No hace falta volver a pagar: Premium se activa solo cuando se confirme.'
      : 'Premium se activa cuando Mercado Pago confirma el pago. Si ya pagaste, puede demorar unos minutos; podés cerrar esta página y volver a Mi plan.',
    tone: 'pending',
  };
  const Icon = presentation.icon;
  const isTestPurchase = state.purchase.provider === 'FAKE';
  const isMercadoPagoTest = state.purchase.provider === 'MERCADO_PAGO' && state.purchase.providerEnvironment === 'test';
  const approvedOn = canonicalView === 'success' ? formatPurchaseDate(state.purchase.approvedAt) : '';
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
          {isMercadoPagoTest && <div><dt>Entorno</dt><dd>Prueba · sin cobro real</dd></div>}
          {approvedOn && <div><dt>Aprobado</dt><dd>{approvedOn}</dd></div>}
          <div><dt>Modalidad</dt><dd>Pago único por temporada</dd></div>
        </dl>
        {pollingStopped && OPEN_STATUSES.has(state.purchase.status) && (
          <p className={styles.waitNote} role="status">
            Todavía no tenemos la confirmación de Mercado Pago. Si ya pagaste, no vuelvas a pagar: consultá de nuevo en unos minutos
            o volvé a Mi plan más tarde.
          </p>
        )}
        <div className={styles.actions}>
          <Link to={canonicalRoutes.seasonPlan(organizationId, state.purchase.seasonId)}>Volver a Mi plan</Link>
          <button type="button" onClick={consultAgain}><RefreshCw size={16} /> {canReconcile ? 'Consultar de nuevo' : 'Actualizar'}</button>
        </div>
        <small><ShieldCheck size={14} /> Premium se activa sólo cuando Mercado Pago confirma el pago.</small>
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
