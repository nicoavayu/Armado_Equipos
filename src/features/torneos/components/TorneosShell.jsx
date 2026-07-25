import React from 'react';
import {
  Building2,
  Home,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { torneosFeatureFlags } from '../config/featureFlags';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import CreateOrganizationPage from './CreateOrganizationPage';
import OrganizationMembersPage from './OrganizationMembersPage';
import OrganizationRouteGuard from './OrganizationRouteGuard';
import OrganizationSettingsPage from './OrganizationSettingsPage';
import TorneosDashboard from './TorneosDashboard';
import TorneosLanding from './TorneosLanding';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import styles from './TorneosShell.module.css';

const organizationNavigation = [
  { label: 'Inicio', path: 'inicio', icon: Home },
  { label: 'Miembros', path: 'miembros', icon: Users },
  { label: 'Configuración', path: 'configuracion', icon: Settings2 },
];

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
  const currentNavigation = organizationNavigation.find(({ path }) => (
    location.pathname.endsWith(`/${path}`)
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
