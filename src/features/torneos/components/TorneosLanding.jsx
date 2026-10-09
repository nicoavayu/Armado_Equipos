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
  CalendarClock,
  CalendarDays,
  Compass,
  Images,
  ListOrdered,
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
import { useTorneosFeatures } from '../context/TorneosFeaturesContext';
import { SESSION_CHECK_DETAIL, WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { firstName } from '../../../utils/displayName';
import { OPEN_REGISTRATION_STATUSES, formatDateTime } from '../domain/connectedProduct';
import MobileAppCallout from './MobileAppCallout';
import MyRegistrationsSection from './connected/MyRegistrationsSection';
import { useTorneosProfile } from './connected/useTorneosProfile';
import styles from './TorneosShell.module.css';
import connectedStyles from './connected/ConnectedProduct.module.css';

// `tournament_organizations.status` es `active` | `archived`. En la tarjeta va
// junto al rol, así que se dice en castellano y no como clave de la base.
const ORGANIZATION_STATUS_LABELS = {
  active: 'Activa',
  archived: 'Archivada',
};

// Visual preference only: which half of the home a person with BOTH kinds of relation sees first. It never decides
// access — every route and RPC revalidates relations and capabilities on the backend.
const HOME_VIEW_KEY = 'arma2:torneos:home-view:v1';
function readHomeView() {
  try { return window.localStorage.getItem(HOME_VIEW_KEY); } catch { return null; }
}
function writeHomeView(value) {
  try { window.localStorage.setItem(HOME_VIEW_KEY, value); } catch { /* preference only */ }
}

const ACTIVITY_LINKS = [
  {
    title: 'Mis torneos',
    copy: 'Fixture, resultados, tabla y fotos',
    path: '/torneos/mis-torneos',
    icon: Trophy,
    feature: 'organizations_workspaces',
  },
  {
    title: 'Mis partidos',
    copy: 'Próximos cruces, convocatoria y disponibilidad',
    path: '/torneos/mis-partidos',
    icon: CalendarDays,
    feature: 'match_operations',
  },
  {
    title: 'Avisos',
    copy: 'Comunicados oficiales y novedades de tus inscripciones',
    path: '/torneos/avisos',
    icon: Bell,
    feature: 'communications',
  },
  {
    title: 'Explorar torneos',
    copy: 'Convocatorias abiertas para tu equipo',
    path: '/torneos/explorar',
    icon: Compass,
    feature: 'tournament_catalog',
  },
];

function nextMatchOf(relations) {
  const upcoming = relations
    .filter((relation) => relation.nextMatch?.matchId)
    .map((relation) => ({ relation, match: relation.nextMatch }))
    .sort((left, right) => {
      const a = left.match.scheduledAt ? Date.parse(left.match.scheduledAt) : Infinity;
      const b = right.match.scheduledAt ? Date.parse(right.match.scheduledAt) : Infinity;
      return a - b;
    });
  return upcoming[0] || null;
}

function uniqueTournaments(relations) {
  const seen = new Set();
  return relations.filter((relation) => {
    const key = `${relation.tournamentId}:${relation.categoryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hubPath(relation, section = '') {
  const query = relation.categoryId ? `?categoria=${encodeURIComponent(relation.categoryId)}` : '';
  return `/torneos/torneo/${encodeURIComponent(relation.tournamentId)}${section}${query}`;
}

function ParticipantHome({ relations, features }) {
  const next = nextMatchOf(relations);
  const tournaments = uniqueTournaments(relations).slice(0, 3);
  const hubEnabled = features.participant_hub !== false;
  const links = ACTIVITY_LINKS.filter(({ feature }) => features[feature] !== false);
  return (
    <>
      {next && hubEnabled && (
        <section className={connectedStyles.nextMatch} aria-labelledby="next-match-title">
          <span className={connectedStyles.kicker}><CalendarClock size={15} aria-hidden="true" /> Tu próximo partido</span>
          <h2 id="next-match-title">{next.match.homeName} vs. {next.match.awayName}</h2>
          <p>
            {next.match.scheduledAt ? formatDateTime(next.match.scheduledAt) : 'Fecha a confirmar'}
            {' · '}
            {next.relation.tournamentName}
            {next.match.roundName ? ` · ${next.match.roundName}` : ''}
          </p>
          <div className={connectedStyles.formActions}>
            <Link className={connectedStyles.primaryAction} to={hubPath(next.relation, `/partidos/${encodeURIComponent(next.match.matchId)}`)}>
              Ver partido
            </Link>
            {features.match_operations !== false && (
              <Link className={connectedStyles.secondaryAction} to={`/torneos/mis-partidos/${encodeURIComponent(next.match.matchId)}`}>
                Convocatoria y disponibilidad
              </Link>
            )}
          </div>
        </section>
      )}

      {tournaments.length > 0 && (
        <section className={connectedStyles.homeTournaments} aria-labelledby="home-tournaments-title">
          <div className={connectedStyles.sectionTitle}>
            <span><Trophy size={15} aria-hidden="true" /> Tus torneos</span>
            <h2 id="home-tournaments-title">Donde jugás</h2>
          </div>
          <ul>
            {tournaments.map((relation) => (
              <li key={`${relation.tournamentId}:${relation.categoryId}`} className={connectedStyles.homeTournament}>
                <div>
                  <strong>{relation.tournamentName}</strong>
                  <span>{relation.teamName || relation.organizationName}{relation.categoryName ? ` · ${relation.categoryName}` : ''}</span>
                </div>
                {hubEnabled && (
                  <nav aria-label={`Accesos de ${relation.tournamentName}`}>
                    <Link to={hubPath(relation, '/partidos')}><CalendarDays size={15} aria-hidden="true" /> Fixture y resultados</Link>
                    <Link to={hubPath(relation, '/tabla')}><ListOrdered size={15} aria-hidden="true" /> Tabla</Link>
                    {features.media !== false && <Link to={hubPath(relation, '/fotos')}><Images size={15} aria-hidden="true" /> Fotos</Link>}
                  </nav>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <MyRegistrationsSection compact />

      <section className={styles.experienceSection} aria-labelledby="activity-title">
        <div className={styles.sectionHeading}>
          <span>Mi actividad</span>
          <h2 id="activity-title">Viví tus torneos</h2>
          <p>Accesos personales derivados de tu equipo, plantel o rol deportivo real.</p>
        </div>
        <div className={styles.experienceActions}>
          {links.map(({ title, copy, path, icon: Icon }) => (
            <Link key={path} to={path}>
              <span><Icon size={21} aria-hidden="true" /></span>
              <span><strong>{title}</strong><small>{copy}</small></span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function ManageHome({ organizations, onOpen, premiumIntent }) {
  return (
    <section className={`${styles.organizationPicker} ${styles.experienceSection}`} aria-labelledby="organizations-title">
      <div className={styles.sectionHeadingRow}>
        <div className={styles.sectionHeading}>
          <span>Gestionar</span>
          <h2 id="organizations-title">Tus organizaciones</h2>
          <p>Cada organización conserva sus datos, permisos y capacidades.</p>
        </div>
        <Link className={styles.secondaryButton} to={premiumIntent ? withPremiumIntent('/torneos/nueva-organizacion') : '/torneos/nueva-organizacion'}>
          <Plus size={17} aria-hidden="true" /> Nueva organización
        </Link>
      </div>
      <div className={styles.organizationCards}>
        {organizations.map((organization) => (
          <button key={organization.id} type="button" onClick={() => onOpen(organization)}>
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
  );
}

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
  const features = useTorneosFeatures();
  const { displayName } = useTorneosProfile();
  const relationsRequestRef = useRef(0);
  const [relationsState, setRelationsState] = useState({
    status: 'loading',
    relations: [],
    registrations: [],
    error: '',
  });

  const loadRelations = useCallback(async () => {
    const requestId = relationsRequestRef.current + 1;
    relationsRequestRef.current = requestId;
    setRelationsState({ status: 'loading', relations: [], registrations: [], error: '' });
    try {
      const [payload, registrationPayload] = await Promise.all([
        typeof service.loadExperienceRelations === 'function'
          ? service.loadExperienceRelations()
          : service.loadMyTournaments({ limit: 50, offset: 0 }),
        // Requests in progress are a relation too (not a tournament): a failure here never blocks the home.
        typeof service.loadMyRegistrations === 'function'
          ? service.loadMyRegistrations({ limit: 30, offset: 0 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (relationsRequestRef.current !== requestId) return;
      setRelationsState({
        status: 'ready',
        relations: Array.isArray(payload?.items) ? payload.items : [],
        registrations: (registrationPayload?.items || []).filter((item) => OPEN_REGISTRATION_STATUSES.includes(item.status)),
        error: '',
      });
    } catch (loadError) {
      if (relationsRequestRef.current !== requestId) return;
      setRelationsState({
        status: 'error',
        relations: [],
        registrations: [],
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
  const hasParticipantSide = experience.hasParticipantActivity || relationsState.registrations.length > 0;
  const dual = experience.hasAdministration && hasParticipantSide;
  // `?vista=` (a link such as «Los torneos que organizás están en Gestionar») is an explicit, visual-only request.
  const requestedView = new URLSearchParams(location.search).get('vista');
  const [view, setView] = useState(() => (
    requestedView === 'gestionar' || requestedView === 'mis-torneos' ? requestedView : readHomeView()
  ));
  const effectiveView = dual
    ? (view === 'gestionar' || view === 'mis-torneos' ? view : 'mis-torneos')
    : (experience.hasAdministration ? 'gestionar' : 'mis-torneos');

  if (status === 'validating' || status === 'idle' || relationsState.status === 'loading') {
    return <WorkspaceLoading label="Resolviendo tu experiencia de Torneos…" detail={SESSION_CHECK_DETAIL} />;
  }
  if (status === 'error' || relationsState.status === 'error') {
    return (
      <WorkspaceError
        title="No pudimos abrir Torneos"
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

  const chooseView = (next) => {
    setView(next);
    writeHomeView(next);
  };

  const noRelationship = !experience.hasAdministration && !hasParticipantSide;
  const name = firstName(displayName, '');

  return (
    <div className={`${styles.landing} ${connectedStyles.home}`}>
      <section className={connectedStyles.homeHero}>
        <span className={connectedStyles.kicker}><ShieldCheck size={15} aria-hidden="true" /> Arma2 Torneos</span>
        <h1>{noRelationship ? 'Encontrá tu próxima competencia' : `Hola${name ? `, ${name}` : ''}`}</h1>
        <p>
          {noRelationship
            ? 'Explorá torneos abiertos a equipos y seguí tus competencias desde un solo lugar.'
            : effectiveView === 'gestionar'
              ? 'Tus organizaciones y lo que necesitan de vos.'
              : 'Tu próximo partido, tus torneos y tus inscripciones.'}
        </p>
        {dual && (
          <div className={connectedStyles.segmented} role="radiogroup" aria-label="Qué querés ver">
            <button type="button" role="radio" aria-checked={effectiveView === 'mis-torneos'} onClick={() => chooseView('mis-torneos')}>
              Mis torneos
            </button>
            <button type="button" role="radio" aria-checked={effectiveView === 'gestionar'} onClick={() => chooseView('gestionar')}>
              Gestionar
            </button>
          </div>
        )}
        {nativeRuntime && (
          <div className={styles.heroActions}>
            <Link className={styles.secondaryButton} to="/">
              <ArrowLeft size={18} aria-hidden="true" />
              Volver a Arma2
            </Link>
          </div>
        )}
      </section>

      {location.state?.safeMessage && (
        <div className={styles.contextNotice} role="status">
          <ShieldCheck size={17} aria-hidden="true" />
          {location.state.safeMessage}
        </div>
      )}

      {hasParticipantSide && effectiveView === 'mis-torneos' && (
        <ParticipantHome relations={experience.participantRelations} features={features} />
      )}

      {experience.hasAdministration && effectiveView === 'gestionar' && (
        <ManageHome organizations={experience.administrativeOrganizations} onOpen={openOrganization} premiumIntent={premiumIntent} />
      )}

      {noRelationship && (
        <section className={styles.unifiedEmptyState}>
          <span><Compass size={28} aria-hidden="true" /></span>
          <div>
            <span className={styles.eyebrow}>Todavía sin torneos</span>
            <h2>No participás ni administrás torneos todavía</h2>
            <p>
              Si administrás un equipo, buscá una convocatoria abierta y pedí la inscripción. Si tu equipo ya juega un
              torneo, pedile a quien lo administra que te sume al plantel con tu cuenta de Arma2: cuando la
              organización apruebe la inscripción, el torneo aparece acá.
            </p>
            {features.tournament_catalog !== false && (
              <Link className={styles.primaryButton} to="/torneos/explorar">
                <Compass size={17} aria-hidden="true" /> Explorar torneos
              </Link>
            )}
          </div>
        </section>
      )}

      {/* The app is an extra: it comes after what the person came for (their activity, their organizations). */}
      <MobileAppCallout audience={experience.hasAdministration && effectiveView === 'gestionar' ? 'organizer' : 'participant'} />

      {!experience.hasAdministration && (
        <p className={connectedStyles.discreetLink}>
          ¿Organizás torneos?{' '}
          <Link to={premiumIntent ? withPremiumIntent('/torneos/nueva-organizacion') : '/torneos/nueva-organizacion'}>
            Crear organización
          </Link>
        </p>
      )}
    </div>
  );
}
