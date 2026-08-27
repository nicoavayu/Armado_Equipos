import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
  createIdempotencyKey,
  createTournamentCheckout,
  isMercadoPagoCheckoutUrl,
} from '../api/tournamentWorkspaceService';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import {
  normalizeTournamentEntitlements,
  TOURNAMENT_PLANS,
} from '../domain/entitlements';
import {
  formatPlanPrice,
  getTournamentPlanLifecycle,
} from '../domain/planExperience';
import CompetitionSelector from './CompetitionSelector';
import OrganizationSettingsNav from './OrganizationSettingsNav';
import styles from './PlanExperiencePage.module.css';

const FAIL_CLOSED_ENTITLEMENTS = normalizeTournamentEntitlements(null);

const AVAILABLE_PREMIUM_BENEFITS = Object.freeze([
  {
    icon: Sparkles,
    label: 'Más estilos para resultados',
    description: 'Sumá Street y Editorial a Classic en tus placas de resultados.',
  },
]);

function PremiumBenefit({ benefit }) {
  const Icon = benefit.icon;
  return (
    <article className={styles.premiumBenefit}>
      <span><Icon size={20} aria-hidden="true" /></span>
      <div>
        <h3>{benefit.label}</h3>
        <p>{benefit.description}</p>
      </div>
    </article>
  );
}

export default function PlanExperiencePage({
  organization: organizationProp = null,
  tournament: tournamentProp = null,
  checkoutRedirect = (url) => window.location.assign(url),
}) {
  const outletContext = useOutletContext() || {};
  const competition = useOptionalTorneosCompetition();
  const organization = organizationProp || outletContext.organization || null;
  const tournament = tournamentProp || competition?.activeTournament || null;
  const planState = competition?.planState || {
    status: tournament ? 'error' : 'empty',
    data: FAIL_CLOSED_ENTITLEMENTS,
    error: tournament ? 'No pudimos verificar el plan de este torneo.' : '',
  };
  const entitlements = planState.data || FAIL_CLOSED_ENTITLEMENTS;
  const lifecycle = getTournamentPlanLifecycle(entitlements);
  const isPremium = entitlements.plan === TOURNAMENT_PLANS.PREMIUM;
  const requiresPremium = entitlements.plan === TOURNAMENT_PLANS.PREMIUM_REQUIRED;
  const canManageBilling = ['owner', 'admin'].includes(organization?.role);
  const navigate = useNavigate();
  const { organizationId: routeOrganizationId, tournamentId: routeTournamentId } = useParams();
  const idempotencyKeyRef = useRef(null);
  const [checkoutState, setCheckoutState] = useState({ status: 'idle', error: '' });

  const beginCheckout = async () => {
    if (!organization?.id || !tournament?.id || checkoutState.status === 'loading') return;
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = createIdempotencyKey();
    setCheckoutState({ status: 'loading', error: '' });
    try {
      const result = await createTournamentCheckout({
        organizationId: organization.id,
        tournamentId: tournament.id,
        idempotencyKey: idempotencyKeyRef.current,
      });
      if (result.preference?.provider === 'MERCADO_PAGO') {
        if (!isMercadoPagoCheckoutUrl(result.preference.checkoutUrl)) {
          throw new Error('El proveedor devolvió una dirección de pago inválida.');
        }
        setCheckoutState({ status: 'redirecting', error: '' });
        checkoutRedirect(result.preference.checkoutUrl);
        return;
      }
      if (result.preference?.provider !== 'FAKE') {
        throw new Error('El proveedor de pago no está disponible.');
      }
      navigate(canonicalRoutes.tournamentPurchasePending(
        routeOrganizationId || organization.id,
        routeTournamentId || tournament.id,
        result.purchase.id,
      ));
    } catch (error) {
      setCheckoutState({
        status: 'error',
        error: error?.message || 'No pudimos iniciar la compra.',
      });
    }
  };

  const pageHeader = (
    <>
      <header className={styles.pageHeader}>
        <span>Torneo · Plan de esta edición</span>
        <h1>Plan</h1>
        <p>
          {tournament
            ? `${tournament.name} · ${organization?.name || 'Organización'}`
            : 'Seleccioná una edición para consultar su plan.'}
        </p>
      </header>
      <OrganizationSettingsNav />
      {competition && <CompetitionSelector />}
    </>
  );

  if (planState.status === 'empty') {
    return (
      <div className={styles.page}>
        {pageHeader}
        <section className={styles.loadingCard} role="status">
          Elegí un torneo en el selector para ver su plan.
        </section>
      </div>
    );
  }

  if (planState.status === 'loading') {
    return (
      <div className={styles.page}>
        {pageHeader}
        <section className={styles.loadingCard} role="status">
          Cargando el plan de este torneo…
        </section>
      </div>
    );
  }

  if (planState.status === 'error') {
    return (
      <div className={styles.page} data-fail-closed="true">
        {pageHeader}
        <div className={styles.errorBanner} role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <span>
            <strong>No pudimos cargar el plan</strong>
            <small>{planState.error}</small>
          </span>
          <button type="button" onClick={competition?.retryPlan}>Reintentar</button>
        </div>
        <section className={styles.currentPlan} data-plan="unverified">
          <div className={styles.planSignal} aria-hidden="true"><i /><span>—</span></div>
          <div className={styles.currentCopy}>
            <p>PLAN ACTUAL · {tournament?.name}</p>
            <h2>Plan no verificado</h2>
            <div className={styles.lifecycle} data-tone="danger">
              <span aria-hidden="true" /> No verificado
            </div>
            <div className={styles.planDetails}>
              <strong>No pudimos validar el plan de esta edición.</strong>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page} data-fail-closed={planState.status === 'error'}>
      {pageHeader}

      <section className={styles.currentPlan} data-plan={entitlements.plan.toLowerCase()}>
        <div className={styles.planSignal} aria-hidden="true">
          <i />
          <span>{entitlements.plan}</span>
        </div>
        <div className={styles.currentCopy}>
          <p>PLAN ACTUAL · {tournament?.name}</p>
          <h2>
            {requiresPremium ? 'Borrador · Premium requerido' : `Arma2 Torneos ${isPremium ? 'Premium' : 'Free'}`}
          </h2>
          <div className={styles.lifecycle} data-tone={lifecycle.tone}>
            <span aria-hidden="true" />
            {lifecycle.label}
          </div>
          <div className={styles.planDetails}>
            <strong>{lifecycle.description}</strong>
            {!isPremium && <small>Este estado corresponde únicamente a esta edición.</small>}
          </div>
        </div>
      </section>

      <section className={styles.comparison} aria-labelledby="plan-comparison-title">
        <div className={styles.sectionHeading}>
          <span>FREE VS PREMIUM</span>
          <h2 id="plan-comparison-title">Organizar es Free. Profesionalizar es Premium.</h2>
          <p>
            Tu primer torneo es gratis. Después, pagás una sola vez por cada nuevo torneo.
            Sin suscripción.
          </p>
        </div>
        <div className={styles.planCards}>
          <article className={styles.planCard} data-current={!isPremium && !requiresPremium}>
            <div className={styles.cardTopline}>
              <span>FREE</span>
              {!isPremium && !requiresPremium && <em>Plan actual</em>}
            </div>
            <h3>Tu primer torneo, gratis.</h3>
            <p>Todo lo necesario para organizar tu campeonato.</p>
            <ul>
              <li><Check size={16} /> Equipos, planteles, fixture y programación</li>
              <li><Check size={16} /> Actas, resultados, tabla y disciplina</li>
              <li><Check size={16} /> Identidad esencial y página pública básica</li>
              <li><Check size={16} /> Estadísticas y comunicados básicos</li>
            </ul>
          </article>

          <article className={`${styles.planCard} ${styles.proCard}`} data-current={isPremium}>
            <div className={styles.cardTopline}>
              <span>PREMIUM</span>
              {isPremium && <em>Plan actual</em>}
            </div>
            <h3>Premium para este torneo</h3>
            <p>Pagás una sola vez. Sin suscripción.</p>
            <div className={styles.noPrice}>
              <small>
                Precio habitual: <s>{formatPlanPrice(entitlements.pricing, 'listPrice')}</s>
              </small>
              <span>Precio lanzamiento</span>
              <strong>{formatPlanPrice(entitlements.pricing, 'launchPrice')}</strong>
              <p>Pagás una sola vez. Sin suscripción.</p>
            </div>
            {!isPremium && (
              <button
                type="button"
                onClick={beginCheckout}
                disabled={!canManageBilling || ['loading', 'redirecting'].includes(checkoutState.status)}
              >
                <Zap size={17} aria-hidden="true" />
                {checkoutState.status === 'loading' ? 'Preparando compra…'
                  : checkoutState.status === 'redirecting' ? 'Redirigiendo…' : 'Comprar Premium'}
              </button>
            )}
            {!isPremium && !canManageBilling && (
              <small>Sólo el Propietario o un Administrador pueden comprar.</small>
            )}
            {checkoutState.error && (
              <small className={styles.checkoutError} role="alert">{checkoutState.error}</small>
            )}
          </article>
        </div>
      </section>

      <section className={styles.benefits} aria-labelledby="premium-benefits-title">
        <div className={styles.sectionHeading}>
          <span>BENEFICIOS PREMIUM</span>
          <h2 id="premium-benefits-title">Qué suma Premium hoy</h2>
          <p>Más opciones visuales para comunicar cada fecha.</p>
        </div>
        <div className={styles.premiumBenefits}>
          {AVAILABLE_PREMIUM_BENEFITS.map((benefit) => (
            <PremiumBenefit key={benefit.label} benefit={benefit} />
          ))}
        </div>
        <div className={styles.brandSignature}>
          <Trophy size={16} aria-hidden="true" />
          <span>Premium mantiene la firma <strong>Powered by Arma2</strong>.</span>
        </div>
      </section>
    </div>
  );
}
