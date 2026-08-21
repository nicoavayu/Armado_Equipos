import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Gauge,
  Images,
  LockKeyhole,
  Palette,
  ShieldCheck,
  Sparkles,
  Trophy,
  UsersRound,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { torneosFeatureFlags } from '../config/featureFlags';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import {
  normalizeTournamentEntitlements,
  TOURNAMENT_PLANS,
} from '../domain/entitlements';
import {
  describePlanLimit,
  formatPlanPrice,
  getTournamentPlanLifecycle,
  PLAN_BENEFITS,
  resolvePlanBenefit,
} from '../domain/planExperience';
import CompetitionSelector from './CompetitionSelector';
import OrganizationSettingsNav from './OrganizationSettingsNav';
import styles from './PlanExperiencePage.module.css';

const FAIL_CLOSED_ENTITLEMENTS = normalizeTournamentEntitlements(null);

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
        error: 'No pudimos validar el plan de esta edición.',
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
          error: 'La respuesta del plan está incompleta o corresponde a otra edición.',
        });
        return;
      }
      setState({ status: 'ready', data: normalized, error: '' });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        data: FAIL_CLOSED_ENTITLEMENTS,
        error: error?.message || 'No pudimos validar el plan de esta edición.',
      });
    }
  }, [organizationId, service, tournamentId]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return { ...state, retry: load };
}

function PlanMetric({ icon: Icon, label, value, detail }) {
  return (
    <article className={styles.metric}>
      <span><Icon size={18} aria-hidden="true" /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function CapabilityRow({ benefit }) {
  const Icon = benefit.status === 'included' || benefit.status === 'entitled_future'
    ? Check
    : benefit.status === 'feature_unavailable' ? AlertTriangle : LockKeyhole;
  return (
    <li className={styles.capability} data-status={benefit.status}>
      <span className={styles.capabilityIcon}><Icon size={17} aria-hidden="true" /></span>
      <div>
        <span className={styles.capabilityHeading}>
          <strong>{benefit.label}</strong>
        </span>
        <p>{benefit.description}</p>
        <small>{benefit.statusLabel}</small>
      </div>
    </li>
  );
}

export default function PlanExperiencePage({
  organization: organizationProp = null,
  tournament: tournamentProp = null,
  featureFlags = torneosFeatureFlags,
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
  const benefits = useMemo(
    () => PLAN_BENEFITS.map((benefit) => (
      resolvePlanBenefit(benefit, entitlements, featureFlags)
    )),
    [entitlements, featureFlags],
  );
  const benefitGroups = useMemo(() => benefits.reduce((groups, benefit) => ({
    ...groups,
    [benefit.group]: [...(groups[benefit.group] || []), benefit],
  }), {}), [benefits]);

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
          Elegí un torneo en el selector para ver su plan. Cada edición conserva su propia licencia.
        </section>
      </div>
    );
  }

  if (planState.status === 'loading') {
    return (
      <div className={styles.page}>
        {pageHeader}
        <section className={styles.loadingCard} role="status">
          Validando el plan de esta edición con el servidor…
        </section>
      </div>
    );
  }

  const galleryLimit = entitlements.media?.galleryAssetLimit;
  const adminUsage = entitlements.administration?.currentAdministrativeSeatUsage;
  const adminLimit = entitlements.administration?.administrativeSeatLimit;

  return (
    <div className={styles.page} data-fail-closed={planState.status === 'error'}>
      {pageHeader}

      {planState.status === 'error' && (
        <div className={styles.errorBanner} role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <span>
            <strong>Plan no verificado · acceso cerrado</strong>
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
        </div>
        <div className={styles.planAuthority}>
          <ShieldCheck size={22} aria-hidden="true" />
          <span>
            <strong>Validado por servidor</strong>
            <small>La licencia pertenece sólo a esta edición</small>
          </span>
        </div>
      </section>

      <section className={styles.metrics} aria-label="Límites efectivos del plan">
        <PlanMetric
          icon={Images}
          label="Galería general"
          value={describePlanLimit(galleryLimit, 'asset', 'assets')}
          detail="Logo, portada, escudos, fotos de equipo y retratos no consumen esta cuota."
        />
        <PlanMetric
          icon={UsersRound}
          label="Colaboradores administrativos"
          value={Number.isInteger(adminUsage) && Number.isInteger(adminLimit)
            ? `${adminUsage} de ${adminLimit}` : 'No verificado'}
          detail="El owner está incluido y no ocupa un lugar. Roles deportivos no cuentan."
        />
        <PlanMetric
          icon={Palette}
          label="Firma de marca"
          value={entitlements.branding?.label || 'No verificado'}
          detail={isPremium
            ? 'Marca propia más fuerte con presencia reducida de Arma2.'
            : 'Arma2 Torneos permanece visible.'}
        />
        <PlanMetric
          icon={Gauge}
          label="Acceso"
          value={isPremium ? 'Permanente' : 'Sin vencimiento temporal'}
          detail="Archivar o finalizar el torneo no cambia su plan."
        />
      </section>

      <section className={styles.comparison} aria-labelledby="plan-comparison-title">
        <div className={styles.sectionHeading}>
          <span>FREE VS PREMIUM</span>
          <h2 id="plan-comparison-title">Organizar es Free. Profesionalizar es Premium.</h2>
          <p>
            Tu primer torneo es gratis. Cada edición posterior requiere su propia licencia
            Premium y, una vez asignada, la conserva.
          </p>
        </div>
        <div className={styles.planCards}>
          <article className={styles.planCard} data-current={!isPremium}>
            <div className={styles.cardTopline}>
              <span>FREE</span>
              {!isPremium && <em>Plan actual</em>}
            </div>
            <h3>Tu primer torneo, gratis</h3>
            <p>Todo lo necesario para organizar un campeonato real completo.</p>
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
            <h3>Premium para esta edición</h3>
            <p>Más capacidad y herramientas profesionales, sin suscripción mensual.</p>
            <div className={styles.noPrice}>
              <small>Precio habitual: {formatPlanPrice(entitlements.pricing, 'listPrice')}</small>
              <strong>Lanzamiento: {formatPlanPrice(entitlements.pricing, 'launchPrice')}</strong>
              <span>Pago único por torneo · Sin suscripción</span>
            </div>
            {!isPremium && (
              <div className={styles.checkoutNotice}>
                El checkout todavía no está habilitado en este entorno.
              </div>
            )}
          </article>
        </div>
      </section>

      <section className={styles.benefits} aria-labelledby="effective-benefits-title">
        <div className={styles.sectionHeading}>
          <span>BENEFICIOS PREMIUM</span>
          <h2 id="effective-benefits-title">Qué suma Premium</h2>
          <p>
            Que un beneficio esté incluido en el plan no significa que su herramienta ya exista.
            Las funcionalidades futuras se identifican claramente.
          </p>
        </div>
        <div className={styles.benefitGroups}>
          {Object.entries(benefitGroups).map(([group, items]) => (
            <article key={group} className={styles.benefitGroup}>
              <header>
                {group === 'Contenido' ? <Sparkles size={18} /> : <Trophy size={18} />}
                <h3>{group}</h3>
              </header>
              <ul>
                {items.map((benefit) => (
                  <CapabilityRow key={benefit.capability} benefit={benefit} />
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.disclaimer}>
        <BadgeCheck size={19} aria-hidden="true" />
        <p>
          Esta pantalla es informativa. No realiza pagos, no crea compras y no cambia el plan.
        </p>
      </footer>
    </div>
  );
}
