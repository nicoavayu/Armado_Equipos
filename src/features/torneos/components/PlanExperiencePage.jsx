import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Check,
  Images,
  Palette,
  Trophy,
  UsersRound,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
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
    icon: Images,
    label: 'Multimedia ampliada',
    description: 'Más capacidad para fotos y galerías del torneo.',
  },
  {
    icon: UsersRound,
    label: 'Más colaboradores',
    description: 'Hasta 10 colaboradores administrativos, además del owner.',
  },
  {
    icon: Palette,
    label: 'Identidad más personalizada',
    description: 'Marca propia con una presencia más discreta de Arma2.',
  },
]);

export function useOrganizationPlan({ organizationId, tournamentId, service }) {
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: organizationId && tournamentId ? 'loading' : 'empty',
    data: FAIL_CLOSED_ENTITLEMENTS,
    error: '',
  });

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!organizationId || !tournamentId) {
      setState({ status: 'empty', data: FAIL_CLOSED_ENTITLEMENTS, error: '' });
      return;
    }
    if (typeof service?.loadEntitlements !== 'function') {
      setState({
        status: 'error',
        data: FAIL_CLOSED_ENTITLEMENTS,
        error: 'No pudimos cargar el plan de este torneo.',
      });
      return;
    }
    setState({ status: 'loading', data: FAIL_CLOSED_ENTITLEMENTS, error: '' });
    try {
      const payload = await service.loadEntitlements({ organizationId, tournamentId });
      if (requestRef.current !== requestId) return;
      const normalized = normalizeTournamentEntitlements(payload, {
        organizationId,
        tournamentId,
      });
      if (!normalized.isTrusted) {
        setState({
          status: 'error',
          data: normalized,
          error: 'No pudimos confirmar el plan de este torneo.',
        });
        return;
      }
      setState({ status: 'ready', data: normalized, error: '' });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        data: FAIL_CLOSED_ENTITLEMENTS,
        error: error?.message || 'No pudimos cargar el plan de este torneo.',
      });
    }
  }, [organizationId, service, tournamentId]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return { ...state, retry: load };
}

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
}) {
  const outletContext = useOutletContext() || {};
  const competition = useOptionalTorneosCompetition();
  const { service } = useTorneosWorkspace();
  const organization = organizationProp || outletContext.organization || null;
  const tournament = tournamentProp || competition?.activeTournament || null;
  const planState = useOrganizationPlan({
    organizationId: organization?.id || null,
    tournamentId: tournament?.id || null,
    service,
  });
  const entitlements = planState.data || FAIL_CLOSED_ENTITLEMENTS;
  const lifecycle = getTournamentPlanLifecycle(entitlements);
  const isPremium = entitlements.plan === TOURNAMENT_PLANS.PREMIUM;

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

  return (
    <div className={styles.page} data-fail-closed={planState.status === 'error'}>
      {pageHeader}

      {planState.status === 'error' && (
        <div className={styles.errorBanner} role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <span>
            <strong>No pudimos cargar el plan</strong>
            <small>{planState.error}</small>
          </span>
          <button type="button" onClick={planState.retry}>Reintentar</button>
        </div>
      )}

      <section className={styles.currentPlan} data-plan={entitlements.plan.toLowerCase()}>
        <div className={styles.planSignal} aria-hidden="true">
          <span>{entitlements.plan}</span>
        </div>
        <div className={styles.currentCopy}>
          <p>PLAN ACTUAL · {tournament?.name}</p>
          <h2>Arma2 Torneos {isPremium ? 'Premium' : 'Free'}</h2>
          <div className={styles.lifecycle} data-tone={lifecycle.tone}>
            <span aria-hidden="true" />
            {lifecycle.label}
          </div>
          <strong>{lifecycle.description}</strong>
          {!isPremium && <small>Este plan corresponde a esta edición.</small>}
        </div>
      </section>

      <section className={styles.comparison} aria-labelledby="plan-comparison-title">
        <div className={styles.sectionHeading}>
          <span>FREE VS PREMIUM</span>
          <h2 id="plan-comparison-title">Organizar es Free. Profesionalizar es Premium.</h2>
          <p>
            Tu primer torneo es gratis. Cada nueva edición posterior requiere Premium.
            Una vez adquirido, ese torneo conserva Premium.
          </p>
        </div>
        <div className={styles.planCards}>
          <article className={styles.planCard} data-current={!isPremium}>
            <div className={styles.cardTopline}>
              <span>FREE</span>
              {!isPremium && <em>Plan actual</em>}
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
            <h3>Premium para esta edición.</h3>
            <p>Pago único · acceso permanente para este torneo.</p>
            <div className={styles.noPrice}>
              <small>
                Precio habitual: <s>{formatPlanPrice(entitlements.pricing, 'listPrice')}</s>
              </small>
              <span>Precio lanzamiento</span>
              <strong>{formatPlanPrice(entitlements.pricing, 'launchPrice')}</strong>
              <p>Pago único por torneo · Sin suscripción</p>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.benefits} aria-labelledby="premium-benefits-title">
        <div className={styles.sectionHeading}>
          <span>BENEFICIOS PREMIUM</span>
          <h2 id="premium-benefits-title">Qué suma Premium hoy</h2>
          <p>Más capacidad y más control para profesionalizar tu torneo.</p>
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
