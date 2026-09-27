import React from 'react';
import { BadgeCheck, Settings2, Users } from 'lucide-react';
import { NavLink, useParams } from 'react-router-dom';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { useTorneosFeature } from '../context/TorneosFeaturesContext';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import styles from './OrganizationSettingsNav.module.css';

// Where "Plan" points. The legacy redirects (organization settings / tournament plan) exist
// only where `plan_legacy_routes` is on; otherwise the link goes straight to the season plan
// of the active season, and without one it is not offered.
function planTarget({ organizationId, tournamentId, legacyRoutes, seasonId }) {
  if (legacyRoutes) {
    return tournamentId
      ? canonicalRoutes.tournamentPlan(organizationId, tournamentId)
      : canonicalRoutes.organizationSettingsPlan(organizationId);
  }
  return seasonId ? canonicalRoutes.seasonPlan(organizationId, seasonId) : null;
}

export default function OrganizationSettingsNav() {
  const { organizationId, tournamentId, seasonId: routeSeasonId } = useParams();
  const planEnabled = useTorneosFeature('plan');
  const legacyRoutes = useTorneosFeature('plan_legacy_routes');
  const competition = useOptionalTorneosCompetition();
  const target = planEnabled ? planTarget({
    organizationId,
    tournamentId,
    legacyRoutes,
    seasonId: routeSeasonId || competition?.activeSeason?.id || null,
  }) : null;
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
      {target && (
        <NavLink
          to={target}
          className={({ isActive }) => (isActive ? styles.active : '')}
        >
          <BadgeCheck size={17} aria-hidden="true" />
          Plan
        </NavLink>
      )}
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
