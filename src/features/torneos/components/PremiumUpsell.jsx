import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PremiumFeatureGate from './PremiumFeatureGate';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import styles from './PlanExperiencePage.module.css';
import { isNativeCommerceBlocked, nativePremiumNotice } from '../domain/nativeCommerce';

export default function PremiumUpsell({ feature, organizationId, seasonId, soon = false }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // Store apps: a neutral fact, no button, no dialog, no way towards a purchase (domain/nativeCommerce); nothing at all
  // for what is not available yet.
  if (isNativeCommerceBlocked()) return soon ? null : <p role="note" data-native-premium-notice="true">{nativePremiumNotice(feature)}</p>;

  return <>
    <button type="button" className={styles.viewPremium} onClick={() => setOpen(true)}>{feature} · Premium 🔒{soon ? ' · Próximamente' : ''}</button>
    <PremiumFeatureGate open={open} feature={feature} onClose={() => setOpen(false)} onViewPremium={() => {
      setOpen(false);
      navigate(`${seasonId ? canonicalRoutes.seasonPlan(organizationId, seasonId) : canonicalRoutes.organizationMyPlan(organizationId)}#premium`);
    }} />
  </>;
}
