import React from 'react';
import {
  ArrowLeft,
  CalendarRange,
  ClipboardList,
  Images,
  Medal,
  Megaphone,
  Home,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  UsersRound,
} from 'lucide-react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useMatch,
  useParams,
} from 'react-router-dom';
import { useKeyboard } from '../../../hooks/useKeyboard';
import GlobalHeader from '../../../components/global-header/GlobalHeader';
import { shouldShowTorneosSpaceHeader } from '../../space-navigation/spaceNavigation';
import { torneosFeatureFlags } from '../config/featureFlags';
import {
  CANONICAL_TOURNAMENT_ROUTE_PATTERN,
  canonicalRoutes,
  readCategoryId,
} from '../routing/canonicalRoutes';
import { tournamentSurface } from '../routing/legacyRoutes';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { useTorneosFeatures } from '../context/TorneosFeaturesContext';
import FeatureUnavailablePage from './FeatureUnavailablePage';
import CreateOrganizationPage from './CreateOrganizationPage';
import CompetitionOverviewPage from './CompetitionOverviewPage';
import OrganizationMembersPage from './OrganizationMembersPage';
import LegacyTournamentRoute from './LegacyTournamentRoute';
import OrganizationRouteGuard from './OrganizationRouteGuard';
import OrganizationVenuesPage from './OrganizationVenuesPage';
import TournamentRouteGuard from './TournamentRouteGuard';
import OrganizationSettingsPage from './OrganizationSettingsPage';
import PlanExperiencePage from './PlanExperiencePage';
import PurchaseStatusPage from './PurchaseStatusPage';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import TorneosDashboard from './TorneosDashboard';
import TorneosLanding from './TorneosLanding';
import SeasonFormPage from './SeasonFormPage';
import TournamentWizardPage from './TournamentWizardPage';
import TeamsPage from './TeamsPage';
import NewTeamEntryPage from './NewTeamEntryPage';
import TeamRegistrationPage from './TeamRegistrationPage';
import TeamInvitationPage from './TeamInvitationPage';
import OrganizationInvitationPage from './OrganizationInvitationPage';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import FixtureWorkspacePage from './FixtureWorkspacePage';
import MatchOperationsPage from './MatchOperationsPage';
import MyTournamentMatchesPage from './MyTournamentMatchesPage';
import CaptainMatchSquadPage from './CaptainMatchSquadPage';
import CompetitionCenterPage from './CompetitionCenterPage';
import MyTournamentsPage from './MyTournamentsPage';
import TournamentHubPage from './TournamentHubPage';
import MyCommunicationsPage from './MyCommunicationsPage';
import CommunicationsAdminPage from './CommunicationsAdminPage';
import MediaAdminPage from './MediaAdminPage';
import SocialStudioPage from './SocialStudioPage';
import { resolveTorneosEnvironmentNotice } from '../config/environmentNotice';
import styles from './TorneosShell.module.css';

//
// Cada entrada declara a qué pertenece.
//
// Las de la organización tienen una sola dirección. Las del torneo tienen dos:
// la canónica, que se usa cuando la URL ya nombra un torneo, y la vieja, que se
// usa cuando no —y que resuelve o pregunta en vez de adivinar—. Ninguna de las
// dos se escribe a mano: el que arma la ruta es siempre el builder.
//
// `feature` names the surface of the composition's feature map that serves the
// entry; when the map turns it off, the entry disappears with its routes.
export const organizationNavigation = [
  {
    label: 'Inicio', path: 'inicio', icon: Home, builder: 'organizationHome', feature: 'organizations_workspaces',
  },
  {
    label: 'Torneos',
    path: 'torneos',
    icon: Trophy,
    builder: 'organizationTournaments',
    relatedPaths: ['temporadas'],
    feature: 'tournaments',
  },
  {
    label: 'Equipos',
    path: 'equipos',
    icon: UsersRound,
    builder: 'tournamentTeams',
    scoped: true,
    feature: 'team_registration_basic_roster',
  },
  {
    label: 'Fixture',
    path: 'fixture',
    icon: CalendarRange,
    builder: 'tournamentFixture',
    scoped: true,
    relatedPaths: ['programacion', 'sedes'],
    feature: 'fixtures',
  },
  {
    label: 'Partidos',
    path: 'partidos',
    icon: ClipboardList,
    builder: 'tournamentMatches',
    scoped: true,
    feature: 'match_operations',
  },
  {
    label: 'Competencia',
    mobileLabel: 'Tabla',
    path: 'competencia',
    icon: Medal,
    builder: 'tournamentTable',
    scoped: true,
    feature: 'standings',
  },
  {
    label: 'Comunicaciones',
    mobileLabel: 'Avisos',
    path: 'comunicaciones',
    icon: Megaphone,
    builder: 'organizationCommunications',
    feature: 'communications',
  },
  {
    label: 'Multimedia',
    mobileLabel: 'Fotos',
    path: 'multimedia',
    icon: Images,
    flag: 'mediaEnabled',
    builder: 'organizationMedia',
    feature: 'media',
  },
  {
    label: 'Estudio Social',
    mobileLabel: 'Estudio',
    path: 'estudio-social',
    icon: Sparkles,
    flag: 'socialContentGenerator',
    builder: 'organizationSocialStudio',
    feature: 'social_studio',
  },
  { label: 'Mi plan', path: 'mi-plan', icon: ShieldCheck, builder: 'organizationMyPlan', feature: 'plan', relatedPaths: ['temporada'] },
  {
    label: 'Configuración',
    mobileLabel: 'Ajustes',
    path: 'configuracion',
    icon: Settings2,
    builder: 'organizationSettings',
    relatedPaths: ['configuracion/plan'],
    feature: 'organizations_workspaces',
  },
];

//
// La traducción completa de las direcciones viejas del torneo.
//
// Es una tabla y no un `if` por página porque la propiedad que importa es que
// esté completa: cualquier ruta legacy del torneo que quedara fuera seguiría
// renderizando contra la preferencia, que es el problema que este hito cierra.
//
const LEGACY_TOURNAMENT_ROUTES = Object.freeze([
  ['equipos', 'tournamentTeams'],
  ['equipos/nuevo', 'tournamentTeamNew'],
  ['fixture', 'tournamentFixture'],
  ['fixture/participantes', 'tournamentFixtureParticipants'],
  ['fixture/bombos', 'tournamentFixturePots'],
  ['fixture/sorteo', 'tournamentFixtureDraw'],
  ['fixture/grupos', 'tournamentFixtureGroups'],
  ['fixture/generar', 'tournamentFixtureGenerate'],
  ['fixture/jornadas', 'tournamentFixtureRounds'],
  ['fixture/llave', 'tournamentFixtureBracket'],
  ['programacion', 'tournamentSchedule'],
  ['partidos', 'tournamentMatches'],
  ['competencia', 'tournamentTable'],
  ['competencia/tabla', 'tournamentTable'],
  ['competencia/estadisticas', 'tournamentStatistics'],
  ['competencia/clasificacion', 'tournamentQualification'],
  ['competencia/disciplina', 'tournamentDiscipline'],
]);

const LEGACY_TOURNAMENT_RESOURCE_ROUTES = Object.freeze([
  ['fixture/version/:fixtureVersionId', 'tournamentFixtureVersion', 'fixtureVersionId'],
  ['fixture/jornadas/:roundId', 'tournamentFixtureRound', 'roundId'],
  ['fixture/partidos/:matchId', 'tournamentFixtureMatch', 'matchId'],
  ['partidos/:matchId', 'tournamentMatch', 'matchId'],
  ['partidos/:matchId/convocatorias', 'tournamentMatchSquads', 'matchId'],
  ['partidos/:matchId/acta', 'tournamentMatchReport', 'matchId'],
  ['partidos/:matchId/revision', 'tournamentMatchReview', 'matchId'],
  ['partidos/:matchId/historial', 'tournamentMatchHistory', 'matchId'],
]);

// La configuración vieja sí nombraba el torneo, sólo que bajo el plural de la
// colección: se traduce sin preguntar nada. El paso del asistente viaja igual,
// venga del prop —`categorias` era el paso 4— o de la propia query.
function TournamentConfigurationRedirect({ step = null }) {
  const { organizationId, tournamentId } = useParams();
  const { search } = useLocation();
  const requestedStep = step === null
    ? new URLSearchParams(search).get('step')
    : step;
  return (
    <Navigate
      to={canonicalRoutes.tournamentConfiguration(organizationId, tournamentId, {
        categoryId: readCategoryId(search),
        step: requestedStep,
      })}
      replace
    />
  );
}

// Los redirects internos de las rutas canónicas no pueden tirar `?categoria=`:
// la categoría es parte de lo que la URL reproduce.
function CanonicalIndexRedirect({ to }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}

function TeamEntryRedirect() {
  const { organizationId, teamEntryId } = useParams();
  return (
    <Navigate
      to={canonicalRoutes.organizationTeamEntryRegistration(organizationId, teamEntryId)}
      replace
    />
  );
}

function LegacyPlanRedirect() {
  const { organizationId } = useParams();
  const competition = useOptionalTorneosCompetition();
  const seasonId = competition?.activeSeason?.id;
  if (!seasonId) return <PlanExperiencePage />;
  return <Navigate to={canonicalRoutes.seasonPlan(organizationId, seasonId)} replace />;
}

function LegacyTournamentPlanRedirect() {
  const { organizationId } = useParams();
  const competition = useOptionalTorneosCompetition();
  const seasonId = competition?.activeSeason?.id;
  if (!seasonId) return <Navigate to={canonicalRoutes.organizationTournaments(organizationId)} replace />;
  return <Navigate to={canonicalRoutes.seasonPlan(organizationId, seasonId)} replace />;
}

function OrganizationNavigation({
  organization,
  mobile = false,
  keyboardHidden = false,
  socialStudioAvailable = false,
  tournamentId = null,
  categoryId = null,
  relativePath = '',
  features,
}) {
  if (!organization) return null;
  // Estar dentro de un torneo no puede perderse al cambiar de sección: si la
  // URL lo nombra, la navegación sigue nombrándolo, con su categoría.
  const target = ({ builder, scoped }) => (scoped
    ? tournamentSurface(builder, organization.id, tournamentId, { categoryId })
    : canonicalRoutes[builder](organization.id));
  const isCurrent = (path, relatedPaths) => (
    relativePath === path
    || relativePath.startsWith(`${path}/`)
    || relatedPaths.some((candidate) => (
      relativePath === candidate || relativePath.startsWith(`${candidate}/`)
    ))
  );
  return (
    <nav
      className={
        mobile
          ? `${styles.mobileNavigation} ${keyboardHidden ? styles.mobileNavigationHidden : ''}`
          : styles.desktopNavigation
      }
      aria-label={mobile ? 'Navegación móvil de la organización' : 'Navegación de la organización'}
      aria-hidden={mobile && keyboardHidden ? 'true' : undefined}
    >
      {organizationNavigation
        // A flagged surface must not even appear in the nav when it is off.
        .filter(({ flag }) => !flag || torneosFeatureFlags[flag])
        // Nor a surface the mounted composition does not serve.
        .filter(({ feature }) => !feature || features[feature] !== false)
        .filter(({ path }) => path !== 'estudio-social' || socialStudioAvailable)
        .map((item) => {
          const {
            label, mobileLabel, path, icon: Icon, relatedPaths = [],
          } = item;
          const active = isCurrent(path, relatedPaths);
          return (
            <NavLink
              key={path}
              to={target(item)}
              end={false}
              className={`${styles.navigationItem} ${active ? styles.navigationItemActive : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className={styles.navigationIcon} aria-hidden="true">
                <Icon size={mobile ? 20 : 18} strokeWidth={1.9} />
              </span>
              <span>{mobile && mobileLabel ? mobileLabel : label}</span>
            </NavLink>
          );
        })}
    </nav>
  );
}

export default function TorneosShell() {
  const location = useLocation();
  const { isKeyboardOpen } = useKeyboard();
  const { activeOrganization } = useTorneosWorkspace();
  const features = useTorneosFeatures();
  const environmentNotice = resolveTorneosEnvironmentNotice();
  // A route whose surface is off renders the unavailable page instead of its
  // component, so the component never mounts and never requests anything.
  const gate = (feature, element) => (
    features[feature] === false ? <FeatureUnavailablePage feature={feature} /> : element
  );
  // The tournament index used to open the fixture; without fixtures it opens
  // the teams, which is the first operational surface of staging v1.
  const tournamentIndex = features.fixtures === false ? 'equipos' : 'fixture';
  const showSpaceHeader = shouldShowTorneosSpaceHeader(location.pathname);
  const isCreateOrganizationRoute = /^\/torneos\/nueva-organizacion\/?$/.test(location.pathname);
  const isOrganizationRoute = location.pathname.includes('/torneos/organizacion/');
  // El torneo se lee de la URL también acá, fuera de los guards: el shell se
  // dibuja por encima de ellos y no tiene contexto de competencia, pero la
  // dirección alcanza para saber a qué torneo pertenece lo que se está viendo.
  const canonicalTournamentMatch = useMatch(CANONICAL_TOURNAMENT_ROUTE_PATTERN);
  const routeTournamentId = canonicalTournamentMatch?.params?.tournamentId || null;
  const routeCategoryId = readCategoryId(location.search);
  const organizationRelativePath = canonicalTournamentMatch
    ? (canonicalTournamentMatch.params['*'] || '')
    : (isOrganizationRoute ? location.pathname.split('/').slice(4).join('/') : '');
  const currentNavigation = organizationNavigation.find(({ path, relatedPaths = [] }) => (
    organizationRelativePath === path
    || organizationRelativePath.startsWith(`${path}/`)
    || relatedPaths.some((candidate) => (
      organizationRelativePath === candidate
      || organizationRelativePath.startsWith(`${candidate}/`)
    ))
  ));
  return (
    <div className={`${styles.shell} ${showSpaceHeader ? '' : styles.shellWithoutGlobalHeader}`}>
      <a className={styles.skipLink} href="#torneos-main">
        Saltar al contenido
      </a>
      <div className={styles.ambientGlow} aria-hidden="true" />
      <div className={styles.gridTexture} aria-hidden="true" />
      {/* El inset superior lo aplica una sola capa (GlobalHeader o, sin él, la
        topbar), pero sólo ubica bien el estado en reposo: al scrollear, el
        contenido pasaba por debajo del reloj y la cámara (Android 15+
        edge-to-edge / iOS). Esta franja fija del alto del inset lo tapa, como la
        de MainLayout. No agrega padding; en web sin inset mide 0. */}
      <div className={styles.statusBarScrim} aria-hidden="true" data-testid="torneos-status-bar-scrim" />

      {showSpaceHeader && <GlobalHeader className={styles.globalHeader} />}

      <aside className={styles.sidebar}>
        <WorkspaceSwitcher />

        <OrganizationNavigation
          organization={isOrganizationRoute ? activeOrganization : null}
          socialStudioAvailable={torneosFeatureFlags.socialContentGenerator}
          tournamentId={routeTournamentId}
          categoryId={routeCategoryId}
          relativePath={organizationRelativePath}
          features={features}
        />

        {environmentNotice && (
          <div className={styles.previewNotice}>
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <strong>{environmentNotice.title}</strong>
              <span>{environmentNotice.detail}</span>
            </div>
          </div>
        )}
      </aside>

      <section className={styles.workspace}>
        <header className={`${styles.topbar} ${isCreateOrganizationRoute ? styles.topbarContextual : ''}`}>
          {isCreateOrganizationRoute ? (
            <Link className={styles.contextBackLink} to="/torneos">
              <ArrowLeft size={17} aria-hidden="true" />
              <span><small>Volver a</small><strong>Tus espacios</strong></span>
            </Link>
          ) : (
            <>
              <div className={styles.pageIdentity}>
                <span>{currentNavigation?.label || (isOrganizationRoute ? 'Organización' : 'Torneos')}</span>
                <strong>
                  {activeOrganization
                    ? `${activeOrganization.name} · ${activeOrganization.slug}`
                    : 'Workspaces privados'}
                </strong>
              </div>

              <div className={styles.mobileSwitcher}>
                <WorkspaceSwitcher />
              </div>
            </>
          )}
          <div id="torneos-plan-context" className={styles.planContext} />
        </header>

        <main id="torneos-main" className={styles.main} tabIndex="-1">
          <Routes>
            <Route index element={<TorneosLanding />} />
            <Route path="nueva-organizacion" element={<CreateOrganizationPage />} />
            <Route
              path="organizacion/:organizationId"
              element={<OrganizationRouteGuard />}
            >
              <Route index element={<Navigate to="inicio" replace />} />
              <Route path="mi-plan" element={gate('plan', <LegacyPlanRedirect />)} />
              <Route path="inicio" element={<TorneosDashboard />} />
              <Route path="temporadas" element={<Navigate to="../torneos" replace />} />
              <Route path="temporadas/nueva" element={<SeasonFormPage />} />
              <Route path="temporadas/:seasonId" element={<SeasonFormPage />} />
              <Route path="temporada/:seasonId/plan" element={gate('plan', <PlanExperiencePage />)} />
              <Route
                path="temporada/:seasonId/plan/compra/:purchaseId/exito"
                element={gate('billing', <PurchaseStatusPage view="success" />)}
              />
              <Route
                path="temporada/:seasonId/plan/compra/:purchaseId/pendiente"
                element={gate('billing', <PurchaseStatusPage view="pending" />)}
              />
              <Route
                path="temporada/:seasonId/plan/compra/:purchaseId/fallo"
                element={gate('billing', <PurchaseStatusPage view="failure" />)}
              />
              <Route path="torneos" element={<CompetitionOverviewPage />} />
              <Route path="torneos/nuevo" element={<TournamentWizardPage />} />
              <Route
                path="equipos/:teamEntryId"
                element={<TeamEntryRedirect />}
              />
              <Route
                path="equipos/:teamEntryId/inscripcion"
                element={<TeamRegistrationPage initialTab="inscripcion" />}
              />
              <Route
                path="equipos/:teamEntryId/identidad-visual"
                element={gate('team_photos', <TeamRegistrationPage initialTab="identidad-visual" />)}
              />
              <Route
                path="equipos/:teamEntryId/plantel"
                element={<TeamRegistrationPage initialTab="plantel" />}
              />
              <Route
                path="equipos/:teamEntryId/revision"
                element={<TeamRegistrationPage initialTab="revision" />}
              />
              <Route
                path="torneos/:tournamentId"
                element={<TournamentConfigurationRedirect />}
              />
              <Route
                path="torneos/:tournamentId/configuracion"
                element={<TournamentConfigurationRedirect />}
              />
              <Route
                path="torneos/:tournamentId/categorias"
                element={<TournamentConfigurationRedirect step={4} />}
              />
              {/*
                * Rutas canónicas montadas EN PARALELO con las legacy. Todavía
                * no se retira ninguna vieja: el objetivo del hito es validar
                * el modelo, no cortar accesos.
                */}
              <Route path="torneo/:tournamentId" element={<TournamentRouteGuard />}>
                <Route index element={<CanonicalIndexRedirect to={tournamentIndex} />} />
                <Route path="configuracion" element={<TournamentWizardPage />} />
                {/*
                  * Legacy, tournament-scoped Plan routes: `plan_legacy_routes`, never
                  * part of the hybrid billing overlay (MP-A5 buys per season only).
                  */}
                <Route path="plan" element={gate('plan_legacy_routes', <LegacyTournamentPlanRedirect />)} />
                <Route
                  path="plan/compra/:purchaseId/exito"
                  element={gate('plan_legacy_routes', <PurchaseStatusPage view="success" />)}
                />
                <Route
                  path="plan/compra/:purchaseId/pendiente"
                  element={gate('plan_legacy_routes', <PurchaseStatusPage view="pending" />)}
                />
                <Route
                  path="plan/compra/:purchaseId/fallo"
                  element={gate('plan_legacy_routes', <PurchaseStatusPage view="failure" />)}
                />
                {/*
                  * El listado de equipos es del torneo: `loadTeamsContext` pide
                  * `tournamentId`, así que sin torneo en la URL la lista salía
                  * de la preferencia. La inscripción ya creada sigue siendo
                  * organization-scoped, más abajo, para no romper el acceso
                  * relacional de capitán/delegado.
                  */}
                <Route path="equipos" element={<TeamsPage />} />
                <Route path="equipos/nuevo" element={<NewTeamEntryPage />} />
                <Route path="fixture" element={gate('fixtures', <FixtureWorkspacePage mode="overview" />)} />
                <Route path="fixture/participantes" element={gate('fixtures', <FixtureWorkspacePage mode="participants" />)} />
                <Route path="fixture/bombos" element={gate('fixtures', <FixtureWorkspacePage mode="pots" />)} />
                <Route path="fixture/sorteo" element={gate('fixtures', <FixtureWorkspacePage mode="draw" />)} />
                <Route path="fixture/grupos" element={gate('fixtures', <FixtureWorkspacePage mode="groups" />)} />
                <Route path="fixture/generar" element={gate('fixtures', <FixtureWorkspacePage mode="generate" />)} />
                <Route path="fixture/version/:fixtureVersionId" element={gate('fixtures', <FixtureWorkspacePage mode="rounds" />)} />
                <Route path="fixture/jornadas" element={gate('fixtures', <FixtureWorkspacePage mode="rounds" />)} />
                <Route path="fixture/jornadas/:roundId" element={gate('fixtures', <FixtureWorkspacePage mode="rounds" />)} />
                <Route path="fixture/partidos/:matchId" element={gate('fixtures', <FixtureWorkspacePage mode="rounds" />)} />
                <Route path="fixture/llave" element={gate('fixtures', <FixtureWorkspacePage mode="bracket" />)} />
                <Route path="programacion" element={gate('fixtures', <FixtureWorkspacePage mode="schedule" />)} />
                <Route path="partidos" element={gate('match_operations', <MatchOperationsPage mode="list" />)} />
                <Route path="partidos/:matchId" element={gate('match_operations', <MatchOperationsPage mode="detail" />)} />
                <Route path="partidos/:matchId/convocatorias" element={gate('match_operations', <MatchOperationsPage mode="squads" />)} />
                <Route path="partidos/:matchId/acta" element={gate('match_operations', <MatchOperationsPage mode="report" />)} />
                <Route path="partidos/:matchId/revision" element={gate('match_operations', <MatchOperationsPage mode="review" />)} />
                <Route path="partidos/:matchId/historial" element={gate('match_operations', <MatchOperationsPage mode="history" />)} />
                <Route path="competencia" element={gate('standings', <CanonicalIndexRedirect to="tabla" />)} />
                <Route path="competencia/tabla" element={gate('standings', <CompetitionCenterPage mode="table" />)} />
                <Route path="competencia/estadisticas" element={gate('standings', <CompetitionCenterPage mode="statistics" />)} />
                <Route path="competencia/clasificacion" element={gate('standings', <CompetitionCenterPage mode="qualification" />)} />
                <Route path="competencia/disciplina" element={gate('standings', <CompetitionCenterPage mode="discipline" />)} />
              </Route>
              {/*
                * Direcciones viejas del torneo. NO se retiran: siguen montadas
                * y siguen respondiendo. Lo que ya no hacen es renderizar contra
                * `activeTournamentId`; resuelven a su equivalente canónica, y
                * cuando la organización tiene más de un torneo lo preguntan en
                * vez de adivinarlo.
                */}
              {LEGACY_TOURNAMENT_ROUTES.map(([path, builder]) => (
                <Route
                  key={path}
                  path={path}
                  element={(
                    <LegacyTournamentRoute
                      build={({ organizationId, tournamentId, options }) => (
                        canonicalRoutes[builder](organizationId, tournamentId, options)
                      )}
                    />
                  )}
                />
              ))}
              {LEGACY_TOURNAMENT_RESOURCE_ROUTES.map(([path, builder, resourceParam]) => (
                <Route
                  key={path}
                  path={path}
                  element={(
                    <LegacyTournamentRoute
                      build={({ organizationId, tournamentId, params, options }) => (
                        canonicalRoutes[builder](
                          organizationId,
                          tournamentId,
                          params[resourceParam],
                          options,
                        )
                      )}
                    />
                  )}
                />
              ))}
              {/*
                * Sedes y canchas son de la organización: no se mueven bajo
                * torneo/:tournamentId por uniformidad estética, y por eso
                * tampoco entran en el barrido de arriba.
                */}
              <Route path="sedes" element={gate('fixtures', <OrganizationVenuesPage />)} />
              <Route path="sedes/:venueId" element={gate('fixtures', <OrganizationVenuesPage />)} />
              <Route path="comunicaciones" element={gate('communications', <CommunicationsAdminPage />)} />
              <Route
                path="multimedia"
                element={torneosFeatureFlags.mediaEnabled
                  ? gate('media', <MediaAdminPage />)
                  : <Navigate to="../inicio" replace />}
              />
              {torneosFeatureFlags.socialContentGenerator && (
                <Route
                  path="estudio-social"
                  element={gate('social_studio', <SocialStudioPage />)}
                />
              )}
              <Route path="configuracion" element={<OrganizationSettingsPage />} />
              <Route path="configuracion/plan" element={gate('plan_legacy_routes', <LegacyPlanRedirect />)} />
              <Route path="miembros" element={<OrganizationMembersPage />} />
            </Route>
            <Route path="mis-partidos" element={gate('match_operations', <MyTournamentMatchesPage />)} />
            <Route path="mis-partidos/:matchId" element={gate('match_operations', <MyTournamentMatchesPage />)} />
            <Route path="mis-partidos/:matchId/convocatoria" element={gate('match_operations', <CaptainMatchSquadPage />)} />
            <Route path="mis-torneos" element={<MyTournamentsPage />} />
            <Route path="comunicados" element={gate('communications', <MyCommunicationsPage />)} />
            <Route path="torneo/:tournamentId" element={gate('participant_hub', <TournamentHubPage />)} />
            <Route
              path="torneo/:tournamentId/novedades"
              element={gate('participant_hub', <TournamentHubPage defaultSection="novedades" />)}
            />
            <Route
              path="torneo/:tournamentId/partidos"
              element={gate('participant_hub', <TournamentHubPage defaultSection="partidos" />)}
            />
            <Route
              path="torneo/:tournamentId/partidos/:matchId"
              element={gate('participant_hub', <TournamentHubPage defaultSection="partidos" matchMode />)}
            />
            <Route
              path="torneo/:tournamentId/tabla"
              element={gate('participant_hub', <TournamentHubPage defaultSection="tabla" />)}
            />
            <Route
              path="torneo/:tournamentId/estadisticas"
              element={gate('participant_hub', <TournamentHubPage defaultSection="estadisticas" />)}
            />
            <Route
              path="torneo/:tournamentId/equipos"
              element={gate('participant_hub', <TournamentHubPage defaultSection="equipos" />)}
            />
            <Route
              path="torneo/:tournamentId/fotos"
              element={gate('participant_hub', <TournamentHubPage defaultSection="fotos" />)}
            />
            <Route
              path="torneo/:tournamentId/disciplina"
              element={gate('participant_hub', <TournamentHubPage defaultSection="disciplina" />)}
            />
            <Route path="invitacion/equipo/:token" element={<TeamInvitationPage />} />
            <Route path="invitacion/organizacion/:token" element={gate('organization_members', <OrganizationInvitationPage />)} />
            <Route path="*" element={<Navigate to="/torneos" replace />} />
          </Routes>
        </main>

        <OrganizationNavigation
          organization={isOrganizationRoute ? activeOrganization : null}
          mobile
          keyboardHidden={isKeyboardOpen}
          socialStudioAvailable={torneosFeatureFlags.socialContentGenerator}
          tournamentId={routeTournamentId}
          categoryId={routeCategoryId}
          relativePath={organizationRelativePath}
          features={features}
        />
      </section>

      <span className={styles.environmentTag}>
        {torneosFeatureFlags.deployEnvironment}
      </span>
    </div>
  );
}
