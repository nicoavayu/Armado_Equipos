import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { useTorneosCommerce } from '../context/TorneosCommerceContext';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { isCheckoutProUrl } from '../domain/checkoutRedirect';
import {
  canContinueCheckout, formatArs, formatPurchaseDate, purchaseStatusCopy, seasonPurchaseSummary,
} from '../domain/premiumPurchase';
import styles from './PremiumPurchasePanel.module.css';

const INVALID_CHECKOUT_URL = 'Mercado Pago devolvió una dirección de pago inválida. No se realizó ningún cobro.';
const defaultRedirect = (url) => window.location.assign(url);

// COMMERCE-PRODUCTION: the purchase part of Mi plan. Everything it states comes from the server: the price and the plan
// from the season's effective entitlement, the purchase from get_tournament_season_purchases. It never shows Premium as
// active by itself and never starts a second purchase while one is open (the database reuses it anyway).
export default function PremiumPurchasePanel({ organization, season, entitlements, premiumRows = [] }) {
  const commerce = useTorneosCommerce();
  const competition = useOptionalTorneosCompetition();
  const navigate = useNavigate();
  const organizationId = organization?.id || null;
  const seasonId = season?.id || null;
  const [purchases, setPurchases] = useState({ status: 'loading', data: null });
  const [checkout, setCheckout] = useState({ status: 'idle', error: '', code: '' });
  // One idempotency key per purchase attempt of this organization + season: retries and double taps reuse it.
  const keyRef = useRef(null);
  const inFlightRef = useRef(false);
  const requestRef = useRef(0);
  const redirect = commerce.redirect || defaultRedirect;

  const loadPurchases = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!organizationId || !seasonId || typeof commerce.loadSeasonPurchases !== 'function') {
      setPurchases({ status: 'unavailable', data: null });
      return;
    }
    setPurchases((current) => ({ status: current.data ? 'refreshing' : 'loading', data: current.data }));
    try {
      const data = await commerce.loadSeasonPurchases({ organizationId, seasonId });
      if (requestId === requestRef.current) setPurchases({ status: 'ready', data });
    } catch {
      if (requestId === requestRef.current) setPurchases({ status: 'error', data: null });
    }
  }, [commerce, organizationId, seasonId]);

  useEffect(() => {
    loadPurchases();
    return () => { requestRef.current += 1; };
  }, [loadPurchases]);

  const pricing = entitlements?.pricing || null;
  const isPremium = entitlements?.plan === 'PREMIUM';
  const summary = seasonPurchaseSummary(purchases.data);
  const canManage = typeof purchases.data?.canManageBilling === 'boolean'
    ? purchases.data.canManageBilling : ['owner', 'admin'].includes(organization?.role);
  const testEnvironment = commerce.environment !== 'production';
  // Production: only where the operator switch lets this organization buy (server-side, the same rule the checkout
  // enforces). The TEST lab never depends on it. Until the read answers, nothing is offered.
  const checkoutAvailable = testEnvironment || purchases.data?.checkoutAvailable === true;
  const busy = checkout.status === 'loading' || checkout.status === 'redirecting';

  const beginCheckout = async () => {
    if (!canManage || !organizationId || !seasonId || inFlightRef.current) return;
    inFlightRef.current = true;
    const scope = `${organizationId}:${seasonId}`;
    if (keyRef.current?.scope !== scope) keyRef.current = { scope, key: commerce.createIdempotencyKey() };
    setCheckout({ status: 'loading', error: '', code: '' });
    try {
      const result = await commerce.createCheckout({ organizationId, seasonId, idempotencyKey: keyRef.current.key });
      const preference = result?.preference || null;
      if (preference?.provider === 'MERCADO_PAGO') {
        // The validated Checkout Pro URL is the only thing used; the state comes later from the server reads.
        if (!isCheckoutProUrl(preference.checkoutUrl)) throw new Error(INVALID_CHECKOUT_URL);
        setCheckout({ status: 'redirecting', error: '', code: '' });
        redirect(preference.checkoutUrl);
        return;
      }
      if (!result?.purchase?.id) throw new Error('El servicio de pagos no está disponible. No se realizó ningún cobro.');
      // A purchase that is no longer open (already paid, in process): its status page asks the server.
      inFlightRef.current = false;
      navigate(canonicalRoutes.seasonPurchasePending(organizationId, seasonId, result.purchase.id));
    } catch (error) {
      inFlightRef.current = false;
      const code = typeof error?.code === 'string' ? error.code : '';
      setCheckout({ status: 'error', error: error?.message || 'No pudimos iniciar la compra. No se realizó ningún cobro.', code });
      if (code === 'TORNEOS_SEASON_ALREADY_PREMIUM') competition?.retryPlan?.();
      // A new attempt after a refusal gets a new key (the refused one is spent or no longer matches the season).
      if (['TORNEOS_CHECKOUT_EXPIRED', 'TORNEOS_IDEMPOTENCY_CONFLICT', 'TORNEOS_PURCHASE_NOT_PAYABLE'].includes(code)) keyRef.current = null;
      loadPurchases();
    }
  };

  const statusLink = (purchase) => canonicalRoutes.seasonPurchasePending(organizationId, seasonId, purchase.id);
  const environmentNote = testEnvironment
    ? <p className={styles.testNote}>Entorno de prueba: no se cobra dinero real.</p> : null;

  if (isPremium) {
    const paid = summary.kind === 'approved' ? summary.purchase : null;
    return (
      <section className={styles.panel} data-state="premium" aria-labelledby="premium-purchase-title">
        <header className={styles.heading}>
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <span>PREMIUM ACTIVO</span>
            <h2 id="premium-purchase-title">{season?.name ? `Premium activo en ${season.name}` : 'Premium activo'}</h2>
          </div>
        </header>
        <p className={styles.lead}>Incluye todos los torneos de esta temporada. Otras temporadas tienen su propio plan.</p>
        {paid && (
          <dl className={styles.facts}>
            <div><dt>Pago</dt><dd>{formatArs(paid.amount)} · pago único</dd></div>
            <div><dt>Aprobado</dt><dd>{formatPurchaseDate(paid.approvedAt) || 'Confirmado'}</dd></div>
            <div><dt>Medio</dt><dd>Mercado Pago</dd></div>
          </dl>
        )}
        <p className={styles.note}>No es una suscripción: no se renueva ni se vuelve a cobrar.</p>
        {paid && <Link className={styles.secondary} to={statusLink(paid)}>Ver la compra</Link>}
        {environmentNote}
      </section>
    );
  }

  if (summary.kind === 'charged_back') {
    return (
      <section className={styles.panel} data-state="warning" aria-labelledby="premium-purchase-title">
        <header className={styles.heading}>
          <AlertTriangle size={22} aria-hidden="true" />
          <div><span>PREMIUM SUSPENDIDO</span><h2 id="premium-purchase-title">Hay un contracargo en revisión</h2></div>
        </header>
        <p className={styles.lead}>
          El pago de Premium de esta temporada está en disputa en Mercado Pago. Mientras se resuelve, la temporada funciona
          como FREE y no se puede iniciar otra compra. No se borró nada de lo cargado.
        </p>
        <Link className={styles.secondary} to={statusLink(summary.purchase)}>Ver la compra</Link>
      </section>
    );
  }

  if (summary.kind === 'open') {
    const purchase = summary.purchase;
    const copy = purchaseStatusCopy(purchase.status);
    const continuable = canManage && canContinueCheckout(purchase);
    return (
      <section className={styles.panel} data-state="open" aria-labelledby="premium-purchase-title">
        <header className={styles.heading}>
          <Clock3 size={22} aria-hidden="true" />
          <div><span>COMPRA EN CURSO</span><h2 id="premium-purchase-title">{copy.label}</h2></div>
        </header>
        <p className={styles.lead}>
          {purchase.status === 'pending'
            ? 'Mercado Pago está procesando el pago. No hace falta volver a pagar: Premium se activa solo cuando se confirme.'
            : 'Ya hay una compra iniciada para esta temporada. Podés continuarla o consultar su estado; no se va a cobrar dos veces.'}
        </p>
        <div className={styles.actions}>
          {continuable && (
            <button type="button" className={styles.primary} onClick={beginCheckout} disabled={busy}>
              <CreditCard size={17} aria-hidden="true" />
              {checkout.status === 'redirecting' ? 'Abriendo Mercado Pago…' : checkout.status === 'loading' ? 'Preparando el pago…' : 'Continuar el pago'}
            </button>
          )}
          <Link className={styles.secondary} to={statusLink(purchase)}>Ver estado de la compra</Link>
        </div>
        {checkout.error && <p className={styles.error} role="alert">{checkout.error}</p>}
        {environmentNote}
      </section>
    );
  }

  const refunded = summary.kind === 'refunded' ? summary.purchase : null;
  return (
    <section className={styles.panel} data-state="offer" aria-labelledby="premium-purchase-title">
      {refunded && (
        <p className={styles.notice} role="status">
          El pago de Premium de esta temporada fue devuelto{formatPurchaseDate(refunded.refundedAt) ? ` el ${formatPurchaseDate(refunded.refundedAt)}` : ''}.
          La temporada volvió a FREE y no se borró nada de lo cargado.
        </p>
      )}
      <header className={styles.heading}>
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <span>PREMIUM PARA ESTA TEMPORADA</span>
          <h2 id="premium-purchase-title">{season?.name ? `Pasá ${season.name} a Premium` : 'Pasá esta temporada a Premium'}</h2>
        </div>
      </header>
      {pricing ? (
        <div className={styles.price}>
          {pricing.listPrice > pricing.launchPrice && (
            <small>Precio habitual <s>{formatArs(pricing.listPrice)}</s></small>
          )}
          {entitlements?.offer?.label && <span>{entitlements.offer.label}</span>}
          <div className={styles.amount}><strong>{formatArs(pricing.launchPrice)}</strong><em>ARS · por temporada</em></div>
          <p>Pago único. No es una suscripción: no se renueva ni se vuelve a cobrar.</p>
        </div>
      ) : (
        <p className={styles.lead}>No pudimos consultar el precio de esta temporada. Reintentá en unos momentos.</p>
      )}
      <p className={styles.lead}>Incluye todos los torneos de esta temporada. Otras temporadas tienen su propio plan.</p>
      {premiumRows.length > 0 && (
        <ul className={styles.benefits} aria-label="Qué agrega Premium">
          {premiumRows.map(({ name, premium }) => <li key={name}><CheckCircle2 size={15} aria-hidden="true" /><span><strong>{name}</strong>{premium}</span></li>)}
        </ul>
      )}
      {checkoutAvailable ? (
        <>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={beginCheckout} disabled={!canManage || !pricing || busy}>
              <CreditCard size={17} aria-hidden="true" />
              {checkout.status === 'redirecting' ? 'Abriendo Mercado Pago…' : checkout.status === 'loading' ? 'Preparando el pago…' : 'Pagar con Mercado Pago'}
            </button>
            {checkout.status === 'error' && (
              <button type="button" className={styles.secondary} onClick={loadPurchases}>
                <RefreshCw size={15} aria-hidden="true" /> Actualizar
              </button>
            )}
          </div>
          {!canManage && <p className={styles.note}>Sólo el Propietario o un Administrador de esta temporada pueden comprar Premium.</p>}
          {checkout.error && <p className={styles.error} role="alert">{checkout.error}</p>}
          <p className={styles.note}>
            Vas a pagar en Mercado Pago. Premium se activa cuando Mercado Pago confirma el pago; si cerrás la ventana, el estado
            se ve acá en Mi plan.
          </p>
        </>
      ) : purchases.status === 'error' ? (
        <div className={styles.actions}>
          <p className={styles.note}>No pudimos consultar si la compra está disponible para esta organización.</p>
          <button type="button" className={styles.secondary} onClick={loadPurchases}><RefreshCw size={15} aria-hidden="true" /> Reintentar</button>
        </div>
      ) : (
        <p className={styles.note}>{purchases.status === 'ready' ? 'La compra de Premium todavía no está disponible para esta organización.' : 'Consultando la disponibilidad de la compra…'}</p>
      )}
      {environmentNote}
    </section>
  );
}
