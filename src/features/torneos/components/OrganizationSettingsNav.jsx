import React from 'react';
import { BadgeCheck, Settings2, Users } from 'lucide-react';
import { NavLink, useParams } from 'react-router-dom';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import styles from './OrganizationSettingsNav.module.css';

export default function OrganizationSettingsNav() {
  const { organizationId, tournamentId } = useParams();
  return (
    <nav className={styles.nav} aria-label="Secciones de configuración">
      <NavLink
        to={canonicalRoutes.organizationSettings(organizationId)}
        end
        className={({ isActive }) => (isActive ? styles.active : '')}
      >
        <Settings2 size={17} aria-hidden="true" />
        General
      </NavLink>
      <NavLink
        to={tournamentId
          ? canonicalRoutes.tournamentPlan(organizationId, tournamentId)
          : canonicalRoutes.organizationSettingsPlan(organizationId)}
        className={({ isActive }) => (isActive ? styles.active : '')}
      >
        <BadgeCheck size={17} aria-hidden="true" />
        Plan
      </NavLink>
      <NavLink
        to={canonicalRoutes.organizationMembers(organizationId)}
        className={({ isActive }) => (isActive ? styles.active : '')}
      >
        <Users size={17} aria-hidden="true" />
        Miembros
      </NavLink>
    </nav>
  );
}
