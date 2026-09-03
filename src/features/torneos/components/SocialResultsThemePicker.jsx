import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  hasEffectiveTournamentEntitlement,
  TOURNAMENT_ENTITLEMENTS,
} from '../domain/entitlements';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { SOCIAL_RESULTS_THEMES } from '../social/socialThemes';
import styles from './SocialStudioPage.module.css';

export function canUsePremiumResultStyles(planState, seasonId) {
  return planState?.status === 'ready'
    && planState.data?.isTrusted === true
    && planState.data?.scope?.seasonId === seasonId
    && hasEffectiveTournamentEntitlement(
      planState.data,
      TOURNAMENT_ENTITLEMENTS.PREMIUM_SOCIAL_STUDIO,
    );
}

export function isSocialResultThemeAllowed(themeId, planState, seasonId) {
  return ['base', 'classic'].includes(themeId)
    || canUsePremiumResultStyles(planState, seasonId);
}

export default function SocialResultsThemePicker({
  organizationId,
  seasonId,
  planState,
  themeId,
  displayThemeId = themeId,
  onSelect,
  onLockedPreview = null,
}) {
  const navigate = useNavigate();
  const premiumAllowed = canUsePremiumResultStyles(planState, seasonId);

  const chooseTheme = (entry) => {
    onSelect(entry.id);
    if (entry.id !== 'base' && !premiumAllowed) onLockedPreview?.(entry.id);
  };

  return (
      <div className={styles.themePicker}>
        <div className={styles.chipRow} role="radiogroup" aria-label="Estilo de resultados">
          {SOCIAL_RESULTS_THEMES.map((entry) => {
            const locked = entry.id !== 'base' && !premiumAllowed;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={displayThemeId === entry.id}
                aria-label={locked ? `${entry.label}, disponible con Premium` : entry.label}
                className={`${displayThemeId === entry.id ? styles.chipActive : ''} ${locked ? styles.themeLocked : ''}`}
                onClick={() => chooseTheme(entry)}
              >
                {locked && <LockKeyhole size={15} aria-hidden="true" />}
                <span>{entry.label}</span>
                {locked && <small>Premium</small>}
              </button>
            );
          })}
        </div>
        {!premiumAllowed && displayThemeId !== 'base' && (
          <div className={styles.lockedThemeNotice} role="status">
            <span><LockKeyhole size={14} aria-hidden="true" /> Preview white-label · export bloqueado</span>
            <button
              type="button"
              onClick={() => navigate(canonicalRoutes.seasonPlan(organizationId, seasonId))}
            >
              Ver Premium
            </button>
          </div>
        )}
      </div>
  );
}
