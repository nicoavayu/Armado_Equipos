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
import CreateOrganizationPage from './CreateOrganizationPage';
import CompetitionOverviewPage from './CompetitionOverviewPage';
import OrganizationMembersPage from './OrganizationMembersPage';
import LegacyTournamentRoute from './LegacyTournamentRoute';
import OrganizationRouteGuard from './OrganizationRouteGuard';
import OrganizationVenuesPage from './OrganizationVenuesPage';
import TournamentRouteGuard from './TournamentRouteGuard';
import OrganizationSettingsPage from './OrganizationSettingsPage';
import PlanExperiencePage from './PlanExperiencePage';
import TorneosDashboard from './TorneosDashboard';
import TorneosLanding from './TorneosLanding';
import SeasonFormPage from './SeasonFormPage';
import TournamentWizardPage from './TournamentWizardPage';
import TeamsPage from './TeamsPage';
import NewTeamEntryPage from './NewTeamEntryPage';
import TeamRegistrationPage from './TeamRegistrationPage';
import TeamInvitationPage from './TeamInvitationPage';
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
import SocialStudioEntitlementGate, {
  useSocialStudioEntitlement,
} from './SocialStudioEntitlementGate';
import styles from './TorneosShell.module.css';

//
// Cada entrada declara a qué pertenece.
//
// Las de la organización tienen una sola dirección. Las del torneo tienen dos:
// la canónica, que se usa cuando la URL ya nombra un torneo, y la vieja, que se
// usa cuando no —y que resuelve o pregunta en vez de adivinar—. Ninguna de las
// dos se escribe a mano: el que arma la ruta es siempre el builder.
//
const organizationNavigation = [
  { label: 'Inicio', path: 'inicio', icon: Home, builder: 'organizationHome' },
  {
    label: 'Torneos',
    path: 'torneos',
    icon: Trophy,
    builder: 'organizationTournaments',
    relatedPaths: ['temporadas'],
  },
  {
    label: 'Equipos',
    path: 'equipos',
    icon: UsersRound,
    builder: 'tournamentTeams',
    scoped: true,
  },
  {
    label: 'Fixture',
    path: 'fixture',
    icon: CalendarRange,
    builder: 'tournamentFixture',
    scoped: true,
    relatedPaths: ['programacion', 'sedes'],
  },
  {
    label: 'Partidos',
    path: 'partidos',
    icon: ClipboardList,
    builder: 'tournamentMatches',
    scoped: true,
  },
  {
    label: 'Competencia',
    path: 'competencia',
    icon: Medal,
    builder: 'tournamentTable',
    scoped: true,
  },
  {
    label: 'Comunicaciones', path: 'comunicaciones', icon: Megaphone, builder: 'organizationCommunications',
  },
  {
    label: 'Multimedia', path: 'multimedia', icon: Images, builder: 'organizationMedia',
  },
  {
    label: 'Estudio Social',
    path: 'estudio-social',
    icon: Sparkles,
    flag: 'socialContentGenerator',
    builder: 'organizationSocialStudio',
  },
  {
    label: 'Configuración',
    path: 'configuracion',
    icon: Settings2,
    builder: 'organizationSettings',
    relatedPaths: ['configuracion/plan'],
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

function OrganizationNavigation({
  organization,
  mobile = false,
  keyboardHidden = false,
  socialStudioAvailable = false,
  tournamentId = null,
  categoryId = null,
  relativePath = '',
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
        .filter(({ path }) => path !== 'estudio-social' || socialStudioAvailable)
        .map((item) => {
          const { label, path, icon: Icon, relatedPaths = [] } = item;
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
              <span>{label}</span>
            </NavLink>
          );
        })}
    </nav>
  );
}

export default function TorneosShell() {
  const location = useLocation();
  const { isKeyboardOpen } = useKeyboard();
  const { activeOrganization, service } = useTorneosWorkspace();
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
  const socialStudioAccess = useSocialStudioEntitlement({
    organizationId: isOrganizationRoute ? activeOrganization?.id : null,
    service,
    enabled: torneosFeatureFlags.socialContentGenerator,
  });

  return (
    <div className={`${styles.shell} ${showSpaceHeader ? '' : styles.shellWithoutGlobalHeader}`}>
      <a className={styles.skipLink} href="#torneos-main">
        Saltar al contenido
      </a>
      <div className={styles.ambientGlow} aria-hidden="true" />
      <div className={styles.gridTexture} aria-hidden="true" />

      {showSpaceHeader && <GlobalHeader className={styles.globalHeader} />}

      <aside className={styles.sidebar}>
        <WorkspaceSwitcher />

        <OrganizationNavigation
          organization={isOrganizationRoute ? activeOrganization : null}
          socialStudioAvailable={socialStudioAccess.allowed}
          tournamentId={routeTournamentId}
          categoryId={routeCategoryId}
          relativePath={organizationRelativePath}
        />

        <div className={styles.previewNotice}>
          <ShieldCheck size={16} aria-hidden="true" />
          <div>
            <strong>Entorno aislado</strong>
            <span>Sin conexión intencional a producción</span>
          </div>
        </div>
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
              <Route path="inicio" element={<TorneosDashboard />} />
              <Route path="temporadas" element={<Navigate to="../torneos" replace />} />
              <Route path="temporadas/nueva" element={<SeasonFormPage />} />
              <Route path="temporadas/:seasonId" element={<SeasonFormPage />} />
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
                <Route index element={<CanonicalIndexRedirect to="fixture" />} />
                <Route path="configuracion" element={<TournamentWizardPage />} />
                {/*
                  * El listado de equipos es del torneo: `loadTeamsContext` pide
                  * `tournamentId`, así que sin torneo en la URL la lista salía
                  * de la preferencia. La inscripción ya creada sigue siendo
                  * organization-scoped, más abajo, para no romper el acceso
                  * relacional de capitán/delegado.
                  */}
                <Route path="equipos" element={<TeamsPage />} />
                <Route path="equipos/nuevo" element={<NewTeamEntryPage />} />
                <Route path="fixture" element={<FixtureWorkspacePage mode="overview" />} />
                <Route path="fixture/participantes" element={<FixtureWorkspacePage mode="participants" />} />
                <Route path="fixture/bombos" element={<FixtureWorkspacePage mode="pots" />} />
                <Route path="fixture/sorteo" element={<FixtureWorkspacePage mode="draw" />} />
                <Route path="fixture/grupos" element={<FixtureWorkspacePage mode="groups" />} />
                <Route path="fixture/generar" element={<FixtureWorkspacePage mode="generate" />} />
                <Route path="fixture/version/:fixtureVersionId" element={<FixtureWorkspacePage mode="rounds" />} />
                <Route path="fixture/jornadas" element={<FixtureWorkspacePage mode="rounds" />} />
                <Route path="fixture/jornadas/:roundId" element={<FixtureWorkspacePage mode="rounds" />} />
                <Route path="fixture/partidos/:matchId" element={<FixtureWorkspacePage mode="rounds" />} />
                <Route path="fixture/llave" element={<FixtureWorkspacePage mode="bracket" />} />
                <Route path="programacion" element={<FixtureWorkspacePage mode="schedule" />} />
                <Route path="partidos" element={<MatchOperationsPage mode="list" />} />
                <Route path="partidos/:matchId" element={<MatchOperationsPage mode="detail" />} />
                <Route path="partidos/:matchId/convocatorias" element={<MatchOperationsPage mode="squads" />} />
                <Route path="partidos/:matchId/acta" element={<MatchOperationsPage mode="report" />} />
                <Route path="partidos/:matchId/revision" element={<MatchOperationsPage mode="review" />} />
                <Route path="partidos/:matchId/historial" element={<MatchOperationsPage mode="history" />} />
                <Route path="competencia" element={<CanonicalIndexRedirect to="tabla" />} />
                <Route path="competencia/tabla" element={<CompetitionCenterPage mode="table" />} />
                <Route path="competencia/estadisticas" element={<CompetitionCenterPage mode="statistics" />} />
                <Route path="competencia/clasificacion" element={<CompetitionCenterPage mode="qualification" />} />
                <Route path="competencia/disciplina" element={<CompetitionCenterPage mode="discipline" />} />
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
              <Route path="sedes" element={<OrganizationVenuesPage />} />
              <Route path="sedes/:venueId" element={<OrganizationVenuesPage />} />
              <Route path="comunicaciones" element={<CommunicationsAdminPage />} />
              <Route path="multimedia" element={<MediaAdminPage />} />
              {torneosFeatureFlags.socialContentGenerator && (
                <Route
                  path="estudio-social"
                  element={(
                    <SocialStudioEntitlementGate
                      access={socialStudioAccess}
                      organizationId={activeOrganization?.id || ''}
                    >
                      <SocialStudioPage />
                    </SocialStudioEntitlementGate>
                  )}
                />
              )}
              <Route path="configuracion" element={<OrganizationSettingsPage />} />
              <Route path="configuracion/plan" element={<PlanExperiencePage />} />
              <Route path="miembros" element={<OrganizationMembersPage />} />
            </Route>
            <Route path="mis-partidos" element={<MyTournamentMatchesPage />} />
            <Route path="mis-partidos/:matchId" element={<MyTournamentMatchesPage />} />
            <Route path="mis-partidos/:matchId/convocatoria" element={<CaptainMatchSquadPage />} />
            <Route path="mis-torneos" element={<MyTournamentsPage />} />
            <Route path="comunicados" element={<MyCommunicationsPage />} />
            <Route path="torneo/:tournamentId" element={<TournamentHubPage />} />
            <Route
              path="torneo/:tournamentId/novedades"
              element={<TournamentHubPage defaultSection="novedades" />}
            />
            <Route
              path="torneo/:tournamentId/partidos"
              element={<TournamentHubPage defaultSection="partidos" />}
            />
            <Route
              path="torneo/:tournamentId/partidos/:matchId"
              element={<TournamentHubPage defaultSection="partidos" matchMode />}
            />
            <Route
              path="torneo/:tournamentId/tabla"
              element={<TournamentHubPage defaultSection="tabla" />}
            />
            <Route
              path="torneo/:tournamentId/estadisticas"
              element={<TournamentHubPage defaultSection="estadisticas" />}
            />
            <Route
              path="torneo/:tournamentId/equipos"
              element={<TournamentHubPage defaultSection="equipos" />}
            />
            <Route
              path="torneo/:tournamentId/fotos"
              element={<TournamentHubPage defaultSection="fotos" />}
            />
            <Route
              path="torneo/:tournamentId/disciplina"
              element={<TournamentHubPage defaultSection="disciplina" />}
            />
            <Route path="invitacion/equipo/:token" element={<TeamInvitationPage />} />
            <Route path="*" element={<Navigate to="/torneos" replace />} />
          </Routes>
        </main>

        <OrganizationNavigation
          organization={isOrganizationRoute ? activeOrganization : null}
          mobile
          keyboardHidden={isKeyboardOpen}
          socialStudioAvailable={socialStudioAccess.allowed}
          tournamentId={routeTournamentId}
          categoryId={routeCategoryId}
          relativePath={organizationRelativePath}
        />
      </section>

      <span className={styles.environmentTag}>
        {torneosFeatureFlags.deployEnvironment}
      </span>
    </div>
  );
}
