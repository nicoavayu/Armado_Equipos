import React from 'react';
import { LockKeyhole } from 'lucide-react';
import {
  hasEffectiveTournamentEntitlement,
  TOURNAMENT_ENTITLEMENTS,
} from '../domain/entitlements';
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

/**
 * One row of compact style chips, each with a swatch of the style's own paper and accent, so the choice reads at a
 * glance without a second preview. A locked style is still selectable: the page previews it for real, behind the
 * Premium lock, and explains the lock once, where the download would be.
 */
export default function SocialResultsThemePicker({
  seasonId,
  planState,
  themeId,
  displayThemeId = themeId,
  onSelect,
}) {
  const premiumAllowed = canUsePremiumResultStyles(planState, seasonId);

  return (
    <div className={styles.themePicker}>
      <div className={styles.fieldHeading}>
        <span id="social-style-label">Estilo</span>
        {!premiumAllowed && (
          <small><LockKeyhole size={12} aria-hidden="true" /> Premium</small>
        )}
      </div>
      <div className={styles.styleRow} role="radiogroup" aria-labelledby="social-style-label">
        {SOCIAL_RESULTS_THEMES.map((entry) => {
          const locked = entry.id !== 'base' && !premiumAllowed;
          const active = displayThemeId === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={locked ? `${entry.label}, disponible con Premium` : entry.label}
              className={`${styles.styleChip} ${active ? styles.styleChipActive : ''} ${locked ? styles.styleChipLocked : ''}`}
              onClick={() => onSelect(entry.id)}
            >
              <span
                className={styles.styleSwatch}
                style={{ '--swatch-paper': entry.tokens.background, '--swatch-ink': entry.tokens.accent }}
                aria-hidden="true"
              />
              <span className={styles.styleName}>{entry.label}</span>
              {locked && <LockKeyhole className={styles.styleLock} size={12} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
