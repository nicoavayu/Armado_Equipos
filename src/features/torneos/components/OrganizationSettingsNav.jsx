import React from 'react';
import { BadgeCheck, Settings2, Users } from 'lucide-react';
import { NavLink, useParams } from 'react-router-dom';
import styles from './OrganizationSettingsNav.module.css';

export default function OrganizationSettingsNav() {
  const { organizationId } = useParams();
  const base = `/torneos/organizacion/${organizationId}/configuracion`;
  return (
    <nav className={styles.nav} aria-label="Secciones de configuración">
      <NavLink
        to={base}
        end
        className={({ isActive }) => (isActive ? styles.active : '')}
      >
        <Settings2 size={17} aria-hidden="true" />
        General
      </NavLink>
      <NavLink
        to={`${base}/plan`}
        className={({ isActive }) => (isActive ? styles.active : '')}
      >
        <BadgeCheck size={17} aria-hidden="true" />
        Plan
      </NavLink>
      <NavLink
        to={`/torneos/organizacion/${organizationId}/miembros`}
        className={({ isActive }) => (isActive ? styles.active : '')}
      >
        <Users size={17} aria-hidden="true" />
        Miembros
      </NavLink>
    </nav>
  );
}
