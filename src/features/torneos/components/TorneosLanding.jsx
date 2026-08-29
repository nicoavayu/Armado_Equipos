import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  CalendarRange,
  Plus,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isArma2NativeRuntime } from '../../../utils/runtimePlatform';
import { getRoleLabel } from '../domain/capabilities';
import { resolveTorneosUserExperience } from '../domain/userExperience';
import { capturePremiumIntent, isPremiumIntentSearch, withPremiumIntent } from '../domain/premiumIntent';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import MobileAppCallout from './MobileAppCallout';
import styles from './TorneosShell.module.css';

// `tournament_organizations.status` es `active` | `archived`. En la tarjeta va
// junto al rol, así que se dice en castellano y no como clave de la base.
const ORGANIZATION_STATUS_LABELS = {
  active: 'Activa',
  archived: 'Archivada',
};

const ACTIVITY_LINKS = [
  {
    title: 'Mis torneos',
    copy: 'Fixture, tabla, equipos y estadísticas',
    path: '/torneos/mis-torneos',
    icon: Trophy,
  },
  {
    title: 'Mis partidos',
    copy: 'Próximos cruces y disponibilidad',
    path: '/torneos/mis-partidos',
    icon: CalendarDays,
  },
  {
    title: 'Comunicados',
    copy: 'Novedades oficiales de tus competencias',
    path: '/torneos/comunicados',
    icon: Bell,
  },
];

export default function TorneosLanding() {
  const navigate = useNavigate();
  const location = useLocation();
  const nativeRuntime = isArma2NativeRuntime();
  const premiumIntent = isPremiumIntentSearch(location.search);
  const {
    status,
    error,
    availableOrganizations,
    selectOrganization,
    refresh,
    service,
  } = useTorneosWorkspace();
  const relationsRequestRef = useRef(0);
  const [relationsState, setRelationsState] = useState({
    status: 'loading',
    relations: [],
    error: '',
  });

  const loadRelations = useCallback(async () => {
    const requestId = relationsRequestRef.current + 1;
    relationsRequestRef.current = requestId;
    setRelationsState({ status: 'loading', relations: [], error: '' });
    try {
      const payload = typeof service.loadExperienceRelations === 'function'
        ? await service.loadExperienceRelations()
        : await service.loadMyTournaments({ limit: 50, offset: 0 });
      if (relationsRequestRef.current !== requestId) return;
      setRelationsState({
        status: 'ready',
        relations: Array.isArray(payload?.items) ? payload.items : [],
        error: '',
      });
    } catch (loadError) {
      if (relationsRequestRef.current !== requestId) return;
      setRelationsState({
        status: 'error',
        relations: [],
        error: loadError?.message || 'No pudimos resolver tu actividad de Torneos.',
      });
    }
  }, [service]);

  useEffect(() => {
    capturePremiumIntent(location.search);
    loadRelations();
    return () => { relationsRequestRef.current += 1; };
  }, [loadRelations]);

  const experience = useMemo(() => resolveTorneosUserExperience({
    organizations: availableOrganizations,
    tournamentRelations: relationsState.relations,
  }), [availableOrganizations, relationsState.relations]);

  if (status === 'validating' || status === 'idle' || relationsState.status === 'loading') {
    return <WorkspaceLoading label="Resolviendo tu experiencia de Torneos…" />;
  }
  if (status === 'error' || relationsState.status === 'error') {
    return (
      <WorkspaceError
        message={error || relationsState.error}
        onRetry={() => Promise.all([
          refresh().catch(() => {}),
          loadRelations(),
        ])}
      />
    );
  }

  const openOrganization = async (organization) => {
    const selected = await selectOrganization(organization.id);
    if (selected) navigate(premiumIntent
      ? withPremiumIntent(canonicalRoutes.organizationTournaments(organization.id))
      : canonicalRoutes.organizationHome(organization.id));
  };

  return (
    <div className={styles.landing}>
      <section className={styles.landingHero}>
        <div className={styles.heroBadge}>
          <ShieldCheck size={17} aria-hidden="true" />
          Una cuenta · Todos tus torneos
        </div>
        <h1>Tu competencia, <em>en un solo lugar.</em></h1>
        <p>
          Consultá tu actividad como jugador y abrí las organizaciones que administrás,
          siempre con la misma identidad Arma2.
        </p>
        {(nativeRuntime || (
          experience.hasParticipantActivity && !experience.hasAdministration
        )) && (
          <div className={styles.heroActions}>
            {experience.hasParticipantActivity && !experience.hasAdministration && (
              <Link className={styles.primaryButton} to={premiumIntent ? withPremiumIntent('/torneos/nueva-organizacion') : '/torneos/nueva-organizacion'}>
                <Plus size={18} aria-hidden="true" />
                Crear organización
              </Link>
            )}
            {nativeRuntime && (
              <Link className={styles.secondaryButton} to="/">
                <ArrowLeft size={18} aria-hidden="true" />
                Volver a Arma2
              </Link>
            )}
          </div>
        )}
      </section>

      {location.state?.safeMessage && (
        <div className={styles.contextNotice} role="status">
          <ShieldCheck size={17} aria-hidden="true" />
          {location.state.safeMessage}
        </div>
      )}

      <MobileAppCallout />

      {experience.hasParticipantActivity && (
        <section className={styles.experienceSection} aria-labelledby="activity-title">
          <div className={styles.sectionHeading}>
            <span>Mi actividad</span>
            <h2 id="activity-title">Viví tus torneos</h2>
            <p>Accesos personales derivados de tu equipo, plantel o rol deportivo real.</p>
          </div>
          <div className={styles.experienceActions}>
            {ACTIVITY_LINKS.map(({ title, copy, path, icon: Icon }) => (
              <Link key={path} to={path}>
                <span><Icon size={21} aria-hidden="true" /></span>
                <span><strong>{title}</strong><small>{copy}</small></span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {experience.hasAdministration && (
        <section className={`${styles.organizationPicker} ${styles.experienceSection}`} aria-labelledby="organizations-title">
          <div className={styles.sectionHeadingRow}>
            <div className={styles.sectionHeading}>
              <span>Administrar</span>
              <h2 id="organizations-title">Tus organizaciones</h2>
              <p>Cada workspace conserva sus datos, permisos y capacidades.</p>
            </div>
            <Link className={styles.secondaryButton} to={premiumIntent ? withPremiumIntent('/torneos/nueva-organizacion') : '/torneos/nueva-organizacion'}>
              <Plus size={17} aria-hidden="true" /> Nueva organización
            </Link>
          </div>
          <div className={styles.organizationCards}>
            {experience.administrativeOrganizations.map((organization) => (
              <button
                key={organization.id}
                type="button"
                onClick={() => openOrganization(organization)}
              >
                <span className={styles.organizationMonogram}>
                  <Building2 size={22} aria-hidden="true" />
                </span>
                <span>
                  <strong>{organization.name}</strong>
                  <small>{getRoleLabel(organization.role)}{ORGANIZATION_STATUS_LABELS[organization.status] ? ` · ${ORGANIZATION_STATUS_LABELS[organization.status]}` : ''}</small>
                </span>
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      {!experience.hasAnyRelationship && (
        <section className={styles.unifiedEmptyState}>
          <span><CalendarRange size={28} aria-hidden="true" /></span>
          <div>
            <span className={styles.eyebrow}>Arma2 Torneos</span>
            <h2>No participás ni administrás torneos todavía</h2>
            <p>
              Cuando una organización te vincule como jugador, responsable o miembro,
              tu actividad aparecerá acá.
            </p>
            <Link className={styles.primaryButton} to={premiumIntent ? withPremiumIntent('/torneos/nueva-organizacion') : '/torneos/nueva-organizacion'}>
              <Plus size={17} aria-hidden="true" /> Crear organización
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
