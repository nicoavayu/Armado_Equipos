import React, { useCallback, useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  hasEffectiveTournamentEntitlement,
  TOURNAMENT_ENTITLEMENTS,
} from '../domain/entitlements';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { SOCIAL_RESULTS_THEMES } from '../social/socialThemes';
import PremiumFeatureGate from './PremiumFeatureGate';
import styles from './SocialStudioPage.module.css';

export function canUsePremiumResultStyles(planState, tournamentId) {
  return planState?.status === 'ready'
    && planState.data?.isTrusted === true
    && planState.data?.scope?.tournamentId === tournamentId
    && hasEffectiveTournamentEntitlement(
      planState.data,
      TOURNAMENT_ENTITLEMENTS.PREMIUM_SOCIAL_STUDIO,
    );
}

export function isSocialResultThemeAllowed(themeId, planState, tournamentId) {
  return ['base', 'classic'].includes(themeId)
    || canUsePremiumResultStyles(planState, tournamentId);
}

export default function SocialResultsThemePicker({
  organizationId,
  tournamentId,
  planState,
  themeId,
  displayThemeId = themeId,
  onSelect,
  onFallback = null,
}) {
  const navigate = useNavigate();
  const [gateOpen, setGateOpen] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState('');
  const closeGate = useCallback(() => setGateOpen(false), []);
  const premiumAllowed = canUsePremiumResultStyles(planState, tournamentId);

  useEffect(() => {
    if (planState?.status !== 'ready' || ['base', 'classic'].includes(themeId) || premiumAllowed) return;
    onSelect('base');
    onFallback?.();
  }, [onFallback, onSelect, planState?.status, premiumAllowed, themeId]);

  const chooseTheme = (entry) => {
    setVerificationNotice('');
    if (entry.id === 'base' || premiumAllowed) {
      onSelect(entry.id);
      return;
    }
    if (planState?.status === 'ready') {
      setGateOpen(true);
      return;
    }
    setVerificationNotice(
      planState?.status === 'loading'
        ? 'Estamos verificando el plan de este torneo.'
        : 'Plan no verificado. Reintentá la validación antes de elegir este estilo.',
    );
  };

  return (
    <>
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
        {verificationNotice && (
          <p className={styles.planVerificationNotice} role="status">{verificationNotice}</p>
        )}
      </div>
      <PremiumFeatureGate
        open={gateOpen}
        onClose={closeGate}
        onViewPremium={() => navigate(
          canonicalRoutes.organizationSettingsPlan(organizationId),
          { state: { tournamentId } },
        )}
      />
    </>
  );
}
