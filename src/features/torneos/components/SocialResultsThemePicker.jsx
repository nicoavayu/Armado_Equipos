import React, { useId } from 'react';
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

/**
 * The style of the piece: one compact dropdown (it never outgrows a 320 px phone, and the current style always reads at
 * a glance). A FREE season can still pick a Premium style to preview it: the option says so, and the preview carries
 * the Premium lock.
 */
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
  const hintId = useId();
  const planTarget = seasonId ? canonicalRoutes.seasonPlan(organizationId, seasonId) : canonicalRoutes.organizationMyPlan(organizationId);
  const premiumAllowed = canUsePremiumResultStyles(planState, seasonId);
  const lockedPreview = !premiumAllowed && displayThemeId !== 'base';

  const chooseTheme = (nextThemeId) => {
    onSelect(nextThemeId);
    if (nextThemeId !== 'base' && !premiumAllowed) onLockedPreview?.(nextThemeId);
  };

  return (
    <div className={styles.themePicker}>
      <label className={styles.fieldLabel}>
        <span>Estilo</span>
        <select
          value={displayThemeId}
          onChange={(event) => chooseTheme(event.target.value)}
          aria-describedby={lockedPreview ? hintId : undefined}
        >
          {SOCIAL_RESULTS_THEMES.map((entry) => {
            const locked = entry.id !== 'base' && !premiumAllowed;
            return (
              <option key={entry.id} value={entry.id}>
                {locked ? `${entry.label} · Premium` : entry.label}
              </option>
            );
          })}
        </select>
      </label>
      {lockedPreview && (
        <p id={hintId} className={styles.lockedThemeNotice} role="status">
          <span><LockKeyhole size={13} aria-hidden="true" /> Vista previa del estilo Premium · Se descarga con Premium</span>
          <button type="button" onClick={() => navigate(`${planTarget}#premium`)}>Ver Premium</button>
        </p>
      )}
    </div>
  );
}
