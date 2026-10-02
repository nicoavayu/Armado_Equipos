import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFeature } from '../context/TorneosFeaturesContext';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { describePlanState } from '../domain/planUx';
import styles from './PlanExperiencePage.module.css';

// The header entry is how "Mi plan" is found on mobile, where the bottom bar
// keeps its operational order and the nav item sits past the first five: it
// names the destination, shows the plan as a badge and reads as tappable.
export default function PlanContextHeader({ organization }) {
  const { activeSeason, planState } = useTorneosCompetition();
  const planEnabled = useTorneosFeature('plan');
  const target = document.getElementById('torneos-plan-context');
  if (!planEnabled || !target || !organization) return null;
  const label = describePlanState(planState, activeSeason);
  return createPortal(<div className={styles.contextPlan}>
    <span>{organization.name}</span>
    <Link to={activeSeason ? canonicalRoutes.seasonPlan(organization.id, activeSeason.id) : canonicalRoutes.organizationMyPlan(organization.id)} aria-label={`Mi plan: ${label}${activeSeason ? ` · ${activeSeason.name}` : ''}`} data-plan={label.toLowerCase()}>
      <ShieldCheck size={16} strokeWidth={1.9} aria-hidden="true" />
      <span className={styles.contextPlanTitle}>Mi plan</span>
      <strong className={styles.contextPlanBadge}>{label}</strong>
      {activeSeason && <span className={styles.contextPlanSeason}>{` · ${activeSeason.name}`}</span>}
      <ChevronRight size={16} className={styles.contextPlanChevron} aria-hidden="true" />
    </Link>
  </div>, target);
}
