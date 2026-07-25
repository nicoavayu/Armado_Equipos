import React from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Gavel,
  LayoutGrid,
  Megaphone,
  Settings2,
  Shield,
  Table2,
  Trophy,
  Users,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  getRoleLabel,
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import styles from './TorneosShell.module.css';

const futureModules = [
  { label: 'Torneos', description: 'Temporadas y competencias', icon: Trophy },
  { label: 'Equipos', description: 'Inscripciones y planteles', icon: Shield },
  { label: 'Fixture', description: 'Fechas, cruces y sedes', icon: CalendarDays },
  { label: 'Partidos', description: 'Operación y resultados', icon: ClipboardList },
  { label: 'Tabla', description: 'Posiciones y desempates', icon: Table2 },
  { label: 'Estadísticas', description: 'Rendimiento oficial', icon: LayoutGrid },
  { label: 'Disciplina', description: 'Casos y sanciones', icon: Gavel },
  { label: 'Comunicaciones', description: 'Avisos por audiencia', icon: Megaphone },
  { label: 'Contenido', description: 'Placas y publicaciones', icon: CheckCircle2 },
];

function formatDate(value) {
  if (!value) return 'Sin dato';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export default function TorneosDashboard() {
  const { organization } = useOutletContext();
  const canUpdate = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.ORGANIZATION_UPDATE,
  );
  const canReadMembers = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.MEMBERS_READ,
  );

  return (
    <div className={styles.dashboard}>
      <section className={styles.dashboardHero}>
        <div className={styles.organizationIdentity}>
          <span className={styles.largeMonogram}>
            {organization.logoPath
              ? <img src={organization.logoPath} alt="" />
              : organization.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <span className={styles.eyebrow}>Workspace institucional</span>
            <h1>Bienvenido a <em>{organization.name}</em></h1>
            <p>
              La base de tu organización está lista. Podés revisar su configuración
              y miembros; la operación deportiva llegará en las próximas fases.
            </p>
          </div>
        </div>
        <span className={styles.activeStatus}>
          <span aria-hidden="true" />
          {organization.status === 'active' ? 'Organización activa' : 'Archivada'}
        </span>
      </section>

      <section className={styles.summaryGrid} aria-label="Resumen de la organización">
        <article>
          <span>Tu rol</span>
          <strong>{getRoleLabel(organization.role)}</strong>
          <small>{organization.capabilities?.length || 0} capacidades activas</small>
        </article>
        <article>
          <span>Estado</span>
          <strong>{organization.status === 'active' ? 'Activa' : 'Archivada'}</strong>
          <small>Workspace privado</small>
        </article>
        <article>
          <span>Creada</span>
          <strong>{formatDate(organization.createdAt)}</strong>
          <small>Identificador: {organization.slug}</small>
        </article>
      </section>

      <section className={styles.dashboardGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>Acciones habilitadas</span>
              <h2>Administración inicial</h2>
            </div>
          </div>
          <div className={styles.availableActions}>
            {canReadMembers && (
              <Link to="../miembros">
                <span><Users size={20} /></span>
                <span>
                  <strong>Ver miembros</strong>
                  <small>Roles, estado y fecha de ingreso</small>
                </span>
                <ArrowRight size={18} />
              </Link>
            )}
            <Link to="../configuracion">
              <span><Settings2 size={20} /></span>
              <span>
                <strong>{canUpdate ? 'Configurar organización' : 'Ver configuración'}</strong>
                <small>Nombre, slug y estado institucional</small>
              </span>
              <ArrowRight size={18} />
            </Link>
          </div>
        </article>

        <article className={`${styles.panel} ${styles.securityPanel}`}>
          <CheckCircle2 size={24} aria-hidden="true" />
          <span className={styles.eyebrow}>Acceso verificado</span>
          <h2>Tu membresía está activa</h2>
          <p>
            Este workspace se resolvió contra el backend. Conocer una URL o un UUID
            no alcanza para acceder a otra organización.
          </p>
        </article>
      </section>

      <section className={styles.futureSection} aria-labelledby="future-modules-title">
        <div className={styles.sectionHeading}>
          <span>Hoja de ruta</span>
          <h2 id="future-modules-title">Próximos módulos</h2>
          <p>No hay datos simulados ni rutas incompletas en esta fase.</p>
        </div>
        <div className={styles.futureGrid}>
          {futureModules.map(({ label, description, icon: Icon }) => (
            <article key={label}>
              <Icon size={20} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <em>Próximamente</em>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
