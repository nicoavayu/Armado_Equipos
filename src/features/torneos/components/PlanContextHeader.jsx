import React from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFeature } from '../context/TorneosFeaturesContext';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { describePlanState } from '../domain/planUx';
import styles from './PlanExperiencePage.module.css';

export default function PlanContextHeader({ organization }) {
  const { activeSeason, planState } = useTorneosCompetition();
  const planEnabled = useTorneosFeature('plan');
  const target = document.getElementById('torneos-plan-context');
  if (!planEnabled || !target || !organization) return null;
  const label = describePlanState(planState, activeSeason);
  return createPortal(<div className={styles.contextPlan}>
    <span>{organization.name}</span>
    <Link to={activeSeason ? canonicalRoutes.seasonPlan(organization.id, activeSeason.id) : canonicalRoutes.organizationMyPlan(organization.id)} aria-label={`Mi plan: ${label}${activeSeason ? ` · ${activeSeason.name}` : ''}`} data-plan={label.toLowerCase()}>
      {label}{activeSeason ? ` · ${activeSeason.name}` : ''}
    </Link>
  </div>, target);
}
