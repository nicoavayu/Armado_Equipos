import React from 'react';
import {
  Building2,
  Home,
  Settings2,
  ShieldCheck,
  Trophy,
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
import { torneosFeatureFlags } from '../config/featureFlags';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import CreateOrganizationPage from './CreateOrganizationPage';
import CompetitionOverviewPage from './CompetitionOverviewPage';
import OrganizationMembersPage from './OrganizationMembersPage';
import OrganizationRouteGuard from './OrganizationRouteGuard';
import OrganizationSettingsPage from './OrganizationSettingsPage';
import TorneosDashboard from './TorneosDashboard';
import TorneosLanding from './TorneosLanding';
import SeasonFormPage from './SeasonFormPage';
import TournamentWizardPage from './TournamentWizardPage';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import styles from './TorneosShell.module.css';

const organizationNavigation = [
  { label: 'Inicio', path: 'inicio', icon: Home },
  { label: 'Torneos', path: 'torneos', icon: Trophy },
  { label: 'Configuración', path: 'configuracion', icon: Settings2 },
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

function OrganizationNavigation({ organization, mobile = false }) {
  if (!organization) return null;
  const base = `/torneos/organizacion/${organization.id}`;
  return (
    <nav
      className={mobile ? styles.mobileNavigation : styles.desktopNavigation}
      aria-label={mobile ? 'Navegación móvil de la organización' : 'Navegación de la organización'}
    >
      {organizationNavigation.map(({ label, path, icon: Icon }) => (
        <NavLink
          key={path}
          to={`${base}/${path}`}
          className={({ isActive }) => (
            `${styles.navigationItem} ${isActive ? styles.navigationItemActive : ''}`
          )}
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
  const { activeOrganization } = useTorneosWorkspace();
  const isOrganizationRoute = location.pathname.includes('/torneos/organizacion/');
  const organizationRelativePath = isOrganizationRoute
    ? location.pathname.split('/').slice(4).join('/')
    : '';
  const currentNavigation = organizationNavigation.find(({ path }) => (
    path === 'torneos'
      ? (
        organizationRelativePath.startsWith('torneos')
        || organizationRelativePath.startsWith('temporadas')
      )
      : organizationRelativePath === path
  ));

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#torneos-main">
        Saltar al contenido
      </a>
      <div className={styles.ambientGlow} aria-hidden="true" />
      <div className={styles.gridTexture} aria-hidden="true" />

      <aside className={styles.sidebar}>
        <Link className={styles.brand} to="/torneos" aria-label="Arma2 Torneos">
          <span className={styles.brandMark}>A2</span>
          <span className={styles.brandLockup}>
            <strong>ARMA2</strong>
            <small>TORNEOS</small>
          </span>
        </Link>

        <WorkspaceSwitcher />

        <OrganizationNavigation organization={isOrganizationRoute ? activeOrganization : null} />

        <div className={styles.previewNotice}>
          <ShieldCheck size={16} aria-hidden="true" />
          <div>
            <strong>Entorno aislado</strong>
            <span>Sin conexión intencional a producción</span>
          </div>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <Link className={styles.mobileBrand} to="/torneos">
            <span className={styles.brandMark}>A2</span>
            <span className={styles.mobileTitle}>
              <small>Arma2 Torneos</small>
              <strong>{activeOrganization?.name || 'Tus espacios'}</strong>
            </span>
          </Link>

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
          {!torneosFeatureFlags.workspaceSwitcher && (
            <Link className={styles.topbarExit} to="/">
              <Building2 size={17} />
              Arma2
            </Link>
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
              <Route path="configuracion" element={<OrganizationSettingsPage />} />
              <Route path="miembros" element={<OrganizationMembersPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/torneos" replace />} />
          </Routes>
        </main>

        <OrganizationNavigation
          organization={isOrganizationRoute ? activeOrganization : null}
          mobile
        />
      </section>

      <span className={styles.environmentTag}>
        {torneosFeatureFlags.deployEnvironment}
      </span>
    </div>
  );
}
