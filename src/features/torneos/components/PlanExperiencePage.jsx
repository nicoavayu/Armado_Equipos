import React, { useEffect, useRef } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { useOutletContext, useLocation } from 'react-router-dom';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { planComparisonFor } from '../domain/planComparison';
import { torneosFeatureFlags } from '../config/featureFlags';
import { useTorneosFeatures } from '../context/TorneosFeaturesContext';
import { useTorneosCommerce } from '../context/TorneosCommerceContext';
import { describePlanState } from '../domain/planUx';
import { clearPremiumIntent } from '../domain/premiumIntent';
import { isArma2NativeRuntime } from '../../../utils/runtimePlatform';
import CompetitionSelector from './CompetitionSelector';
import PremiumPurchasePanel from './PremiumPurchasePanel';
import styles from './PlanExperiencePage.module.css';

export default function PlanExperiencePage({ organization: organizationProp = null, season: seasonProp = null }) {
  const outlet = useOutletContext() || {};
  const competition = useOptionalTorneosCompetition();
  const features = useTorneosFeatures();
  const commerce = useTorneosCommerce();
  // Same condition as the Estudio Social entry of the navigation (TorneosShell): flag + composition feature.
  const { comparison, comingSoon } = planComparisonFor({
    socialStudio: torneosFeatureFlags.socialContentGenerator === true && features.social_studio === true,
    // MEDIA-V1: same condition as the Multimedia entry of the navigation.
    media: torneosFeatureFlags.mediaEnabled === true && features.media === true,
  });
  const organization = organizationProp || outlet.organization;
  const season = seasonProp || competition?.activeSeason;
  const state = competition?.planState;
  const label = describePlanState(state, season);
  const confirmed = ['FREE', 'PREMIUM'].includes(label);
  const comparisonRef = useRef(null);
  const purchaseRef = useRef(null);
  const { hash } = useLocation();
  // COMMERCE-PRODUCTION: the purchase exists only where the hybrid composition enabled billing (production web app or the
  // TEST lab) and only for a confirmed plan of this season; native shells never show a purchase or a price.
  const billing = features.billing === true && commerce.source === 'hybrid' && confirmed;
  const native = isArma2NativeRuntime();
  const premiumTarget = () => (billing ? purchaseRef.current : null) || comparisonRef.current;
  useEffect(() => { if (hash === '#premium') { premiumTarget()?.scrollIntoView?.(); premiumTarget()?.focus?.(); } }, [hash]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { clearPremiumIntent(); }, []);
  const viewPremium = () => { premiumTarget()?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); premiumTarget()?.focus?.(); };
  // What Premium adds (only rows that differ and are available today: the same table, never "Próximamente").
  const premiumRows = comparison.filter(({ free, premium }) => free !== premium);
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span>Tu temporada</span><h1>Mi plan</h1>
      <p>{organization?.name || 'Organización'} · {season?.name || 'Sin temporada'}</p>
    </header>
    {competition && <CompetitionSelector compact />}
    <section className={styles.currentPlan} data-plan={confirmed ? label.toLowerCase() : 'unknown'} aria-label="Plan actual">
      <div className={styles.planSignal} aria-hidden="true"><span className={styles.planSignalMark}><ShieldCheck size={44} /><span className={styles.planSignalLabel}>{confirmed ? label : '—'}</span></span></div>
      <div className={styles.currentCopy}>
        <p>PLAN DE ESTA TEMPORADA</p>
        <h2 aria-live="polite">{label}{confirmed ? ` · ${season.name}` : ''}</h2>
        <div className={styles.planDetails}>
          {confirmed ? <><strong>{label} confirmado para esta temporada y sus torneos.</strong><small>El plan de otras temporadas se consulta por separado.</small></>
            : <strong>{label === 'Sin temporada' ? 'Seleccioná o creá una temporada para consultar su plan.' : label === 'Cargando plan…' ? 'Estamos consultando el plan de esta temporada.' : label === 'Lectura no disponible' ? 'Todavía no podemos consultar el plan de esta temporada.' : 'No pudimos cargar el plan. Reintentá en unos momentos.'}</strong>}
        </div>
        {label === 'Error transitorio' && <button type="button" className={styles.viewPremium} onClick={competition?.retryPlan}>Reintentar</button>}
        <button type="button" className={styles.viewPremium} onClick={viewPremium}>Ver Premium</button>
      </div>
    </section>
    {billing && <div ref={purchaseRef} tabIndex={-1}>
      <PremiumPurchasePanel organization={organization} season={season} entitlements={state?.data} premiumRows={premiumRows} />
    </div>}
    {confirmed && <section className={styles.inclusions} aria-label="Inclusiones actuales">
      <h2>Qué incluye tu plan</h2>
      <ul>{comparison.map(({ name, free, premium }) => <li key={name}><Check size={16} aria-hidden="true" /><span>{name}: {label === 'PREMIUM' ? premium : free}</span></li>)}</ul>
    </section>}
    <section ref={comparisonRef} tabIndex={-1} className={styles.comparison} aria-labelledby="plan-comparison-title">
      <div className={styles.sectionHeading}><span>FREE VS PREMIUM</span><h2 id="plan-comparison-title">Qué agrega Premium</h2><p>El plan se elige por temporada e incluye todos sus torneos. Premium no se extiende a otras temporadas.</p></div>
      <div className={styles.comparisonTable}>
        <table><caption className={styles.tableCaption}>Qué incluye cada plan en una temporada</caption><thead><tr><th scope="col">Incluye</th><th scope="col">FREE</th><th scope="col">PREMIUM</th></tr></thead><tbody>{comparison.map(({ name, free, premium }) => <tr key={name}><th scope="row">{name}</th><td>{free}</td><td>{premium}</td></tr>)}</tbody></table>
      </div>
      {!billing && !native && <p className={styles.availability}>La compra de Premium todavía no está disponible.</p>}
    </section>
    <section className={styles.upcoming} aria-labelledby="plan-upcoming-title">
      <div className={styles.sectionHeading}><span>EN PREPARACIÓN</span><h2 id="plan-upcoming-title">Próximamente</h2><p>Estas funciones todavía no están disponibles. Así se van a repartir entre los planes cuando lleguen.</p></div>
      <div className={styles.upcomingList}>
        {comingSoon.map(({ name, summary, free, premium }) => <section key={name} className={styles.upcomingItem} aria-label={name}>
          <h3>{name}</h3>
          <p>{summary}</p>
          {free && <div className={styles.upcomingTiers}>
            <div><h4>FREE</h4><ul>{free.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div data-tier="premium"><h4>PREMIUM</h4><ul>{premium.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>}
        </section>)}
      </div>
    </section>
  </div>;
}
