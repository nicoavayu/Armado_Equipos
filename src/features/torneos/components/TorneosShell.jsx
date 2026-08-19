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
  useParams,
} from 'react-router-dom';
import { useKeyboard } from '../../../hooks/useKeyboard';
import GlobalHeader from '../../../components/global-header/GlobalHeader';
import { shouldShowTorneosSpaceHeader } from '../../space-navigation/spaceNavigation';
import { torneosFeatureFlags } from '../config/featureFlags';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import CreateOrganizationPage from './CreateOrganizationPage';
import CompetitionOverviewPage from './CompetitionOverviewPage';
import OrganizationMembersPage from './OrganizationMembersPage';
import OrganizationRouteGuard from './OrganizationRouteGuard';
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

const organizationNavigation = [
  { label: 'Inicio', path: 'inicio', icon: Home },
  { label: 'Torneos', path: 'torneos', icon: Trophy },
  { label: 'Equipos', path: 'equipos', icon: UsersRound },
  {
    label: 'Fixture',
    path: 'fixture',
    icon: CalendarRange,
    relatedPaths: ['programacion', 'sedes'],
  },
  { label: 'Partidos', path: 'partidos', icon: ClipboardList },
  { label: 'Competencia', path: 'competencia', icon: Medal },
  { label: 'Comunicaciones', path: 'comunicaciones', icon: Megaphone },
  { label: 'Multimedia', path: 'multimedia', icon: Images },
  { label: 'Estudio Social', path: 'estudio-social', icon: Sparkles, flag: 'socialContentGenerator' },
  {
    label: 'Configuración',
    path: 'configuracion',
    icon: Settings2,
    relatedPaths: ['configuracion/plan'],
  },
];

function TournamentConfigurationRedirect({ step = null }) {
  const { organizationId, tournamentId } = useParams();
  const suffix = step === null ? '' : `?step=${step}`;
  return (
    <Navigate
      to={`/torneos/organizacion/${organizationId}/torneos/${tournamentId}/configuracion${suffix}`}
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
      to={`/torneos/organizacion/${organizationId}/equipos/${teamEntryId}/inscripcion`}
      replace
    />
  );
}

function OrganizationNavigation({
  organization,
  mobile = false,
  keyboardHidden = false,
  socialStudioAvailable = false,
}) {
  const location = useLocation();
  if (!organization) return null;
  const base = `/torneos/organizacion/${organization.id}`;
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
        .map(({
          label, path, icon: Icon, relatedPaths = [],
        }) => (
          <NavLink
            key={path}
            to={`${base}/${path}`}
            className={({ isActive }) => {
              const related = relatedPaths.some((candidate) => (
                location.pathname.startsWith(`${base}/${candidate}`)
              ));
              return `${styles.navigationItem} ${isActive || related ? styles.navigationItemActive : ''}`;
            }}
          >
            <span className={styles.navigationIcon} aria-hidden="true">
              <Icon size={mobile ? 20 : 18} strokeWidth={1.9} />
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
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
  const organizationRelativePath = isOrganizationRoute
    ? location.pathname.split('/').slice(4).join('/')
    : '';
  const currentNavigation = organizationNavigation.find(({ path, relatedPaths = [] }) => (
    relatedPaths.some((candidate) => organizationRelativePath.startsWith(candidate))
    || (
      ['torneos', 'equipos', 'fixture', 'partidos', 'competencia', 'comunicaciones', 'multimedia', 'estudio-social'].includes(path)
        ? (
          organizationRelativePath.startsWith(path)
          || (path === 'torneos' && organizationRelativePath.startsWith('temporadas'))
          || (path === 'fixture' && (
            organizationRelativePath.startsWith('programacion')
            || organizationRelativePath.startsWith('sedes')
          ))
        )
        : organizationRelativePath === path
    )
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
              <Route path="equipos" element={<TeamsPage />} />
              <Route path="equipos/nuevo" element={<NewTeamEntryPage />} />
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
                element={<TournamentWizardPage />}
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
                <Route path="fixture" element={<FixtureWorkspacePage mode="overview" />} />
                <Route path="fixture/participantes" element={<FixtureWorkspacePage mode="participants" />} />
                <Route path="fixture/bombos" element={<FixtureWorkspacePage mode="pots" />} />
                <Route path="fixture/sorteo" element={<FixtureWorkspacePage mode="draw" />} />
                <Route path="fixture/grupos" element={<FixtureWorkspacePage mode="groups" />} />
                <Route path="fixture/generar" element={<FixtureWorkspacePage mode="generate" />} />
                <Route path="fixture/version/:fixtureVersionId" element={<FixtureWorkspacePage mode="rounds" />} />
                <Route path="fixture/jornadas" element={<FixtureWorkspacePage mode="rounds" />} />
                <Route path="fixture/jornadas/:roundId" element={<FixtureWorkspacePage mode="rounds" />} />
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
              <Route path="sedes" element={<FixtureWorkspacePage mode="venues" />} />
              <Route path="sedes/:venueId" element={<FixtureWorkspacePage mode="venues" />} />
              <Route path="partidos" element={<MatchOperationsPage mode="list" />} />
              <Route path="partidos/:matchId" element={<MatchOperationsPage mode="detail" />} />
              <Route path="partidos/:matchId/convocatorias" element={<MatchOperationsPage mode="squads" />} />
              <Route path="partidos/:matchId/acta" element={<MatchOperationsPage mode="report" />} />
              <Route path="partidos/:matchId/revision" element={<MatchOperationsPage mode="review" />} />
              <Route path="partidos/:matchId/historial" element={<MatchOperationsPage mode="history" />} />
              <Route path="competencia" element={<Navigate to="tabla" replace />} />
              <Route path="competencia/tabla" element={<CompetitionCenterPage mode="table" />} />
              <Route path="competencia/estadisticas" element={<CompetitionCenterPage mode="statistics" />} />
              <Route path="competencia/clasificacion" element={<CompetitionCenterPage mode="qualification" />} />
              <Route path="competencia/disciplina" element={<CompetitionCenterPage mode="discipline" />} />
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
        />
      </section>

      <span className={styles.environmentTag}>
        {torneosFeatureFlags.deployEnvironment}
      </span>
    </div>
  );
}
