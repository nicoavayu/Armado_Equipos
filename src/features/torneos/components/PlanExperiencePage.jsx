import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Camera,
  Check,
  Clock3,
  Gauge,
  ImagePlus,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { torneosFeatureFlags } from '../config/featureFlags';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import {
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import {
  normalizeTournamentEntitlements,
  TOURNAMENT_PLANS,
} from '../domain/entitlements';
import {
  describeMediaLimit,
  formatPlanDate,
  getTournamentPlanLifecycle,
  PLAN_BENEFITS,
  resolvePlanBenefit,
} from '../domain/planExperience';
import OrganizationSettingsNav from './OrganizationSettingsNav';
import styles from './PlanExperiencePage.module.css';

const FAIL_CLOSED_ENTITLEMENTS = normalizeTournamentEntitlements(null);

export function useOrganizationPlan({ organizationId, service }) {
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: 'loading',
    data: FAIL_CLOSED_ENTITLEMENTS,
    error: '',
  });

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!organizationId || typeof service?.loadEntitlements !== 'function') {
      setState({
        status: 'error',
        data: FAIL_CLOSED_ENTITLEMENTS,
        error: 'No pudimos identificar una organización válida.',
      });
      return;
    }
    setState({
      status: 'loading',
      data: FAIL_CLOSED_ENTITLEMENTS,
      error: '',
    });
    try {
      const payload = await service.loadEntitlements({
        organizationId,
        tournamentId: null,
      });
      if (requestRef.current !== requestId) return;
      const normalized = normalizeTournamentEntitlements(payload, {
        organizationId,
        tournamentId: null,
      });
      if (!normalized.isTrusted) {
        setState({
          status: 'error',
          data: normalized,
          error: 'La respuesta del plan está incompleta o no coincide con este workspace.',
        });
        return;
      }
      setState({ status: 'ready', data: normalized, error: '' });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        data: FAIL_CLOSED_ENTITLEMENTS,
        error: error?.message || 'No pudimos validar el plan de esta organización.',
      });
    }
  }, [organizationId, service]);

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
  const Icon = benefit.status === 'included'
    ? Check
    : benefit.status === 'feature_unavailable' ? AlertTriangle : LockKeyhole;
  return (
    <li className={styles.capability} data-status={benefit.status}>
      <span className={styles.capabilityIcon}><Icon size={17} aria-hidden="true" /></span>
      <div>
        <span className={styles.capabilityHeading}>
          <strong>{benefit.label}</strong>
          <code>{benefit.capability}</code>
        </span>
        <p>{benefit.description}</p>
        <small>{benefit.statusLabel}</small>
      </div>
    </li>
  );
}

function UpgradeModal({ organizationName, onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Cerrar">
          <X size={19} />
        </button>
        <span className={styles.modalMark}><Sparkles size={25} aria-hidden="true" /></span>
        <p>ARMA2 TORNEOS · PRO</p>
        <h2 id="upgrade-modal-title">Disponible próximamente</h2>
        <span>
          Estamos preparando la futura administración del plan de {organizationName}.
          Esta acción no compra, no crea una suscripción y no cambia beneficios.
        </span>
        <button type="button" onClick={onClose}>Entendido</button>
      </section>
    </div>
  );
}

export default function PlanExperiencePage({
  organization: organizationProp = null,
  featureFlags = torneosFeatureFlags,
}) {
  const outletContext = useOutletContext() || {};
  const { service } = useTorneosWorkspace();
  const organization = organizationProp || outletContext.organization || null;
  const planState = useOrganizationPlan({
    organizationId: organization?.id || null,
    service,
  });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const entitlements = planState.data || FAIL_CLOSED_ENTITLEMENTS;
  const lifecycle = getTournamentPlanLifecycle(entitlements);
  const isPro = entitlements.plan === TOURNAMENT_PLANS.PRO;
  const canManagePlan = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.WORKSPACE_MANAGE,
  );
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
  const media = entitlements.media;
  const protectedUntil = formatPlanDate(media?.postProProtectedUntil);

  if (planState.status === 'loading') {
    return (
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <span>Organización · Suscripción</span>
          <h1>Plan</h1>
          <p>Validando el plan efectivo de {organization?.name || 'esta organización'}.</p>
        </header>
        <OrganizationSettingsNav />
        <section className={styles.loadingCard} role="status">
          Validando plan y beneficios con el servidor…
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page} data-fail-closed={planState.status === 'error'}>
      <header className={styles.pageHeader}>
        <span>Organización · Suscripción</span>
        <h1>Plan</h1>
        <p>
          Beneficios y límites efectivos de {organization?.name || 'esta organización'}.
          El rol y el plan se validan por separado.
        </p>
      </header>

      <OrganizationSettingsNav />

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
          <p>PLAN ACTUAL</p>
          <h2>PLAN {entitlements.plan}</h2>
          <div className={styles.lifecycle} data-tone={lifecycle.tone}>
            <span aria-hidden="true" />
            {lifecycle.label}
          </div>
          <strong>{lifecycle.description}</strong>
          {protectedUntil && (
            <small>
              Protección multimedia post-PRO hasta {protectedUntil}.
            </small>
          )}
        </div>
        <div className={styles.planAuthority}>
          <ShieldCheck size={22} aria-hidden="true" />
          <span>
            <strong>Validado por servidor</strong>
            <small>Organización · no usuario individual</small>
          </span>
        </div>
      </section>

      <section className={styles.metrics} aria-label="Límites efectivos de multimedia">
        <PlanMetric
          icon={ImagePlus}
          label="Fotos por fecha"
          value={media ? describeMediaLimit(media.maxPhotosPerMatchday, 'foto', 'fotos') : 'No verificado'}
          detail="Límite comercial efectivo; las cuotas operativas siguen separadas."
        />
        <PlanMetric
          icon={Camera}
          label="Fechas conservadas"
          value={media ? describeMediaLimit(media.retainedMatchdays, 'fecha', 'fechas') : 'No verificado'}
          detail="Ventana definida por la política server-side del plan actual."
        />
        <PlanMetric
          icon={Clock3}
          label="Gracia de retención"
          value={media ? describeMediaLimit(media.retentionGraceDays, 'día', 'días') : 'No verificado'}
          detail="No altera el orden deportivo ni elimina datos estructurados."
        />
        <PlanMetric
          icon={Gauge}
          label="Protección post-PRO"
          value={media ? describeMediaLimit(media.postExpirationRetentionDays, 'día', 'días') : 'No verificado'}
          detail="Estado de protección informado por la configuración oficial."
        />
      </section>

      <section className={styles.comparison} aria-labelledby="plan-comparison-title">
        <div className={styles.sectionHeading}>
          <span>FREE VS PRO</span>
          <h2 id="plan-comparison-title">Un plan para cada etapa del torneo</h2>
          <p>
            La disponibilidad real de cada beneficio se detalla debajo. No hay precios ni compra habilitada.
          </p>
        </div>
        <div className={styles.planCards}>
          <article className={styles.planCard} data-current={!isPro}>
            <div className={styles.cardTopline}>
              <span>FREE</span>
              {!isPro && <em>Plan actual</em>}
            </div>
            <h3>Empezá y participá</h3>
            <p>
              Organización base con capacidades y límites resueltos por servidor.
              La experiencia participant no se convierte en un paywall.
            </p>
            <ul>
              <li><Check size={16} /> Plan por organización</li>
              <li><Check size={16} /> Roles y permisos independientes</li>
              <li><Check size={16} /> Sin checkout ni cobros</li>
            </ul>
          </article>

          <article className={`${styles.planCard} ${styles.proCard}`} data-current={isPro}>
            <div className={styles.cardTopline}>
              <span>PRO</span>
              <em>{isPro ? 'Plan actual' : 'Disponible próximamente'}</em>
            </div>
            <h3>Más profundidad para organizar</h3>
            <p>
              Las capacidades avanzadas aparecen sólo cuando el resolver canónico las concede
              y sus feature flags están activos.
            </p>
            <div className={styles.noPrice}>Sin precio publicado</div>
            <button
              type="button"
              disabled={!canManagePlan}
              onClick={() => setUpgradeOpen(true)}
            >
              {isPro ? 'Gestionar plan' : 'Pasar a PRO'}
              <ArrowUpRight size={17} aria-hidden="true" />
            </button>
            {!canManagePlan && (
              <small>Tu rol permite ver el plan, no administrar futuras acciones comerciales.</small>
            )}
          </article>
        </div>
      </section>

      <section className={styles.benefits} aria-labelledby="effective-benefits-title">
        <div className={styles.sectionHeading}>
          <span>CATÁLOGO EFECTIVO</span>
          <h2 id="effective-benefits-title">Beneficios de esta organización</h2>
          <p>
            Cada fila está vinculada a una capability real. Un flag global apagado prevalece sobre el entitlement.
          </p>
        </div>
        <div className={styles.benefitGroups}>
          {Object.entries(benefitGroups).map(([group, items]) => (
            <article key={group} className={styles.benefitGroup}>
              <header>
                {group === 'Estudio Social' ? <Sparkles size={18} /> : <Trophy size={18} />}
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
          Esta pantalla es de lectura. No modifica suscripciones, entitlements, retención,
          Storage ni flags de Estudio Social.
        </p>
      </footer>

      {upgradeOpen && (
        <UpgradeModal
          organizationName={organization?.name || 'esta organización'}
          onClose={() => setUpgradeOpen(false)}
        />
      )}
    </div>
  );
}
