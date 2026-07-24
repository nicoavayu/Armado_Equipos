import React from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  ChevronDown,
  Home,
  Search,
  Settings2,
  Shield,
  Table2,
} from 'lucide-react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { torneosFeatureFlags } from '../config/featureFlags';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import TorneosDashboard from './TorneosDashboard';
import TorneosPlaceholderPage from './TorneosPlaceholderPage';
import styles from './TorneosShell.module.css';

const navigationItems = [
  { label: 'Inicio', path: 'inicio', icon: Home },
  { label: 'Partidos', path: 'partidos', icon: CalendarDays },
  { label: 'Equipos', path: 'equipos', icon: Shield },
  { label: 'Tabla', path: 'tabla', icon: Table2 },
  { label: 'Gestión', path: 'gestion', icon: Settings2 },
];

const placeholderSections = {
  partidos: {
    eyebrow: 'Operación',
    title: 'Centro de partidos',
    description: 'Programación, carga rápida y operación detallada vivirán en este espacio.',
    items: ['Vista por fecha', 'Agenda por cancha', 'Resultados y reclamos'],
  },
  equipos: {
    eyebrow: 'Participantes',
    title: 'Equipos y planteles',
    description: 'Inscripciones, aprobaciones y rosters oficiales sin mezclar el equipo general.',
    items: ['Equipos pendientes', 'Planteles presentados', 'Jugadores suspendidos'],
  },
  tabla: {
    eyebrow: 'Competencia',
    title: 'Tabla y estadísticas',
    description: 'Posiciones, forma, goleadores y disciplina calculados desde datos confirmados.',
    items: ['Tabla general', 'Goleadores y asistencias', 'Fair play'],
  },
  gestion: {
    eyebrow: 'Administración',
    title: 'Gestión del torneo',
    description: 'Configuración institucional y operativa, ordenada por capacidades.',
    items: ['Temporadas y categorías', 'Sedes y árbitros', 'Roles y exportaciones'],
  },
};

function Navigation({ compact = false }) {
  return (
    <nav
      className={compact ? styles.mobileNavigation : styles.desktopNavigation}
      aria-label={compact ? 'Navegación móvil de Torneos' : 'Navegación de Torneos'}
    >
      {navigationItems.map(({ label, path, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) => (
            `${styles.navigationItem} ${isActive ? styles.navigationItemActive : ''}`
          )}
        >
          <span className={styles.navigationIcon} aria-hidden="true">
            <Icon size={compact ? 20 : 18} strokeWidth={1.9} />
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function TorneosShell() {
  const location = useLocation();
  const {
    activeWorkspace,
    selectedSeason,
    selectedTournament,
  } = useTorneosWorkspace();
  const activePath = navigationItems.find(({ path }) => location.pathname.includes(`/${path}`));

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#torneos-main">
        Saltar al contenido
      </a>
      <div className={styles.ambientGlow} aria-hidden="true" />

      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>A2</span>
          <span className={styles.brandLockup}>
            <strong>ARMA2</strong>
            <small>TORNEOS</small>
          </span>
        </div>

        <button className={styles.workspaceButton} type="button" disabled>
          <span className={styles.workspaceAvatar}>{activeWorkspace?.initials || 'A2'}</span>
          <span className={styles.workspaceCopy}>
            <small>Organización</small>
            <strong>{activeWorkspace?.name || 'Sin organización'}</strong>
          </span>
          <ChevronDown size={17} aria-hidden="true" />
        </button>

        <Navigation />

        <div className={styles.previewNotice}>
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>Entorno de preview</strong>
            <span>Datos ficticios · sin conexión productiva</span>
          </div>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.mobileBrand}>
            <span className={styles.brandMark}>A2</span>
            <span className={styles.mobileTitle}>
              <small>Torneos</small>
              <strong>{activeWorkspace?.name}</strong>
            </span>
          </div>

          <div className={styles.pageIdentity}>
            <span>{activePath?.label || 'Inicio'}</span>
            <strong>{selectedSeason?.name} · {selectedTournament?.name}</strong>
          </div>

          <div className={styles.topbarActions}>
            <button type="button" className={styles.iconButton} aria-label="Buscar" disabled>
              <Search size={19} />
            </button>
            <button type="button" className={styles.iconButton} aria-label="Notificaciones" disabled>
              <Bell size={19} />
              <span className={styles.notificationDot} aria-hidden="true" />
            </button>
          </div>
        </header>

        <main id="torneos-main" className={styles.main} tabIndex="-1">
          <Routes>
            <Route index element={<Navigate to="inicio" replace />} />
            <Route path="inicio" element={<TorneosDashboard />} />
            {Object.entries(placeholderSections).map(([path, page]) => (
              <Route
                key={path}
                path={path}
                element={<TorneosPlaceholderPage {...page} />}
              />
            ))}
            <Route path="*" element={<Navigate to="inicio" replace />} />
          </Routes>
        </main>

        <Navigation compact />
      </section>

      <span className={styles.environmentTag}>
        {torneosFeatureFlags.deployEnvironment}
      </span>
    </div>
  );
}

