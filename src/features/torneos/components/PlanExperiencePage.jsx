import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  PanelsTopLeft,
  ShieldCheck,
  Sparkles,
  UsersRound,
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
import OrganizationSettingsNav from './OrganizationSettingsNav';
import styles from './PlanExperiencePage.module.css';
import { clearPremiumIntent } from '../domain/premiumIntent';

const FAIL_CLOSED_ENTITLEMENTS = normalizeTournamentEntitlements(null);

const AVAILABLE_PREMIUM_BENEFITS = Object.freeze([
  {
    icon: Sparkles,
    label: 'Multimedia ampliada',
    description: 'hasta 1.000 archivos compartidos por la temporada.',
  },
  {
    icon: UsersRound,
    label: 'Más colaboradores',
    description: 'Owner + hasta 10.',
  },
  {
    icon: PanelsTopLeft,
    label: 'Las 11 familias Base de Social Studio',
    description: 'Street y Editorial disponibles donde están implementados: Resultados.',
  },
  {
    icon: ShieldCheck,
    label: 'Acceso Premium permanente',
    description: 'para esta temporada y todos sus torneos actuales y futuros.',
  },
]);

export default function PlanExperiencePage({
  organization: organizationProp = null,
  season: seasonProp = null,
  checkoutRedirect = (url) => window.location.assign(url),
}) {
  const outletContext = useOutletContext() || {};
  const competition = useOptionalTorneosCompetition();
  const organization = organizationProp || outletContext.organization || null;
  const season = seasonProp || competition?.activeSeason || null;
  const planState = competition?.planState || {
    status: season ? 'error' : 'empty',
    data: FAIL_CLOSED_ENTITLEMENTS,
    error: season ? 'No pudimos verificar el plan de esta temporada.' : '',
  };
  const entitlements = planState.data || FAIL_CLOSED_ENTITLEMENTS;
  const lifecycle = getTournamentPlanLifecycle(entitlements);
  const isPremium = entitlements.plan === TOURNAMENT_PLANS.PREMIUM;
  const requiresPremium = entitlements.plan === TOURNAMENT_PLANS.PREMIUM_REQUIRED;
  const canManageBilling = ['owner', 'admin'].includes(organization?.role);
  const navigate = useNavigate();
  const { organizationId: routeOrganizationId, seasonId: routeSeasonId } = useParams();
  const idempotencyKeyRef = useRef(null);
  const [checkoutState, setCheckoutState] = useState({ status: 'idle', error: '' });

  useEffect(() => { clearPremiumIntent(); }, []);

  const beginCheckout = async () => {
    if (!organization?.id || !season?.id || checkoutState.status === 'loading') return;
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = createIdempotencyKey();
    setCheckoutState({ status: 'loading', error: '' });
    try {
      const result = await createTournamentCheckout({
        organizationId: organization.id,
        seasonId: season.id,
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
      navigate(canonicalRoutes.seasonPurchasePending(
        routeOrganizationId || organization.id,
        routeSeasonId || season.id,
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
        <span>Temporada · Plan comercial</span>
        <h1>Plan</h1>
        <p>
          {season
            ? `${season.name} · ${organization?.name || 'Organización'}`
            : 'Seleccioná una temporada para consultar su plan.'}
        </p>
      </header>
      <OrganizationSettingsNav />
    </>
  );

  if (planState.status === 'empty') {
    return (
      <div className={styles.page}>
        {pageHeader}
        <section className={styles.loadingCard} role="status">
          Elegí una temporada para ver su plan.
        </section>
      </div>
    );
  }

  if (planState.status === 'loading') {
    return (
      <div className={styles.page}>
        {pageHeader}
        <section className={styles.loadingCard} role="status">
          Cargando el plan de esta temporada…
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
            <p>PLAN ACTUAL · {season?.name}</p>
            <h2>Plan no verificado</h2>
            <div className={styles.lifecycle} data-tone="danger">
              <span aria-hidden="true" /> No verificado
            </div>
            <div className={styles.planDetails}>
              <strong>No pudimos validar el plan de esta temporada.</strong>
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
          <p>PLAN ACTUAL · {season?.name}</p>
          <h2>
            {requiresPremium ? 'Borrador · Premium requerido' : `Arma2 Torneos ${isPremium ? 'Premium' : 'Free'}`}
          </h2>
          <div className={styles.lifecycle} data-tone={lifecycle.tone}>
            <span aria-hidden="true" />
            {lifecycle.label}
          </div>
          <div className={styles.planDetails}>
            <strong>{lifecycle.description}</strong>
            {!isPremium && <small>FREE es permanente para esta temporada y no limita crear otras temporadas.</small>}
          </div>
        </div>
      </section>

      <section className={styles.comparison} aria-labelledby="plan-comparison-title">
        <div className={styles.sectionHeading}>
          <span>FREE VS PREMIUM</span>
          <h2 id="plan-comparison-title">Organizar es Free. Profesionalizar es Premium.</h2>
          <p>
            Cada temporada nace FREE para siempre. Premium se paga una sola vez por la temporada,
            incluye todos sus torneos y no se hereda a otras temporadas.
          </p>
        </div>
        <div className={styles.planCards}>
          <article className={styles.planCard} data-current={!isPremium && !requiresPremium}>
            <div className={styles.cardTopline}>
              <span>FREE</span>
              {!isPremium && !requiresPremium && <em>Plan actual</em>}
            </div>
            <h3>Gratis para siempre por temporada.</h3>
            <p>Todo lo necesario para organizar y publicar tu torneo.</p>
            <ul>
              <li><Check size={16} /> Equipos y planteles</li>
              <li><Check size={16} /> Fixture, programación, partidos y resultados</li>
              <li><Check size={16} /> Tabla, goleadores, disciplina y estadísticas básicas</li>
              <li><Check size={16} /> Logo, portada, escudos, fotos y retratos</li>
              <li><Check size={16} /> Página pública y comunicados</li>
              <li><Check size={16} /> 3 familias Base: Resultados, Tabla y Próximo partido</li>
              <li><Check size={16} /> Formatos 4:5 y 9:16</li>
              <li><Check size={16} /> Galería multimedia — hasta 25 archivos por temporada</li>
              <li><Check size={16} /> Owner + 1 colaborador</li>
              <li className={styles.quietFeature}><Check size={16} /> Firma de Arma2 Torneos en Social Studio Base</li>
            </ul>
          </article>

          <article className={`${styles.planCard} ${styles.proCard}`} data-current={isPremium}>
            <div className={styles.cardTopline}>
              <span>PREMIUM</span>
              {isPremium && <em>Plan actual</em>}
            </div>
            <h3>Profesionalizá esta temporada</h3>
            <p className={styles.premiumAdds}>INCLUYE TODO LO DE FREE, MÁS:</p>
            <ul className={styles.premiumFeatureList}>
              {AVAILABLE_PREMIUM_BENEFITS.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <li key={benefit.label}>
                    <Icon size={17} aria-hidden="true" />
                    <span><strong>{benefit.label}</strong><small>{benefit.description}</small></span>
                  </li>
                );
              })}
            </ul>
            <div className={styles.noPrice}>
              <small>
                Precio habitual: <s>{formatPlanPrice(entitlements.pricing, 'listPrice')}</s>
              </small>
              <span>Precio lanzamiento</span>
              <div className={styles.priceAmount}>
                <strong>{formatPlanPrice(entitlements.pricing, 'launchPrice')}</strong>
                <em>ARS · por temporada</em>
              </div>
              <p>Pago único para esta temporada · Sin suscripción</p>
              <small className={styles.permanentAccess}>Acceso Premium permanente para todos sus torneos.</small>
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

    </div>
  );
}
