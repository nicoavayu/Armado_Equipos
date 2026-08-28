import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  loadTournamentPurchase,
} from '../api/tournamentWorkspaceService';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import styles from './PurchaseStatusPage.module.css';

const SUCCESS = new Set(['approved']);
const FAILURE = new Set(['rejected', 'cancelled', 'expired', 'refunded', 'charged_back']);
const OPEN_STATUSES = new Set(['created', 'preference_created', 'pending']);

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

export default function PurchaseStatusPage({ view }) {
  const { organizationId, seasonId, tournamentId, purchaseId } = useParams();
  const [state, setState] = useState({ status: 'loading', purchase: null, error: '' });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const purchase = await loadTournamentPurchase({
        purchaseId,
        organizationId,
        seasonId,
        tournamentId,
      });
      setState({ status: 'ready', purchase, error: '' });
    } catch (error) {
      setState({
        status: 'error',
        purchase: null,
        error: error?.message || 'No pudimos consultar esta compra.',
      });
    }
  }, [organizationId, purchaseId, seasonId, tournamentId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (state.status !== 'ready' || !OPEN_STATUSES.has(state.purchase?.status)) return undefined;
    const timer = window.setInterval(refresh, 4000);
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

  const presentation = canonicalView === 'success' ? {
    icon: CheckCircle2,
    eyebrow: 'PAGO VERIFICADO',
    title: 'Premium ya está activo',
    description: 'El pago se confirmó y Premium quedó activo para esta temporada.',
    tone: 'success',
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
  } : {
    icon: Clock3,
    eyebrow: 'PAGO EN PROCESO',
    title: 'Estamos esperando confirmación',
    description: 'Tu solicitud se generó correctamente. Premium se activa cuando recibimos la confirmación del pago.',
    tone: 'pending',
  };
  const Icon = presentation.icon;
  const isTestPurchase = state.purchase.provider === 'FAKE';

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
