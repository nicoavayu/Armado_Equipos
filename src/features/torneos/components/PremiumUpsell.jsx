import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PremiumFeatureGate from './PremiumFeatureGate';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import styles from './PlanExperiencePage.module.css';

export default function PremiumUpsell({ feature, organizationId, seasonId, soon = false }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return <>
    <button type="button" className={styles.viewPremium} onClick={() => setOpen(true)}>{feature} · Premium 🔒{soon ? ' · Próximamente' : ''}</button>
    <PremiumFeatureGate open={open} feature={feature} onClose={() => setOpen(false)} onViewPremium={() => {
      setOpen(false);
      navigate(`${seasonId ? canonicalRoutes.seasonPlan(organizationId, seasonId) : canonicalRoutes.organizationMyPlan(organizationId)}#premium`);
    }} />
  </>;
}
