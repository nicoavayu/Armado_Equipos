import React, { useEffect, useRef } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { useOutletContext, useLocation } from 'react-router-dom';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { describePlanState } from '../domain/planUx';
import { clearPremiumIntent } from '../domain/premiumIntent';
import CompetitionSelector from './CompetitionSelector';
import styles from './PlanExperiencePage.module.css';

const COMPARISON = [
  ['Operación deportiva', 'Incluida', 'Incluida'],
  ['Página pública y comunicados', 'Incluidos', 'Incluidos'],
  ['Logo e identidad esencial', 'Incluidos', 'Incluidos'],
  ['Colaboradores por temporada', 'Propietario + 1', 'Propietario + 10'],
  ['Galería', '25 archivos', '1.000 archivos', true],
  ['Social Studio Base', '3 familias', '11 familias', true],
  ['Heritage / Street / Scoreboard / Editorial', 'Preview donde corresponde', 'Preview y exportación', true],
  ['Branding Arma2 en Social Studio Base', 'Obligatorio', 'Configurable', true],
];

export default function PlanExperiencePage({ organization: organizationProp = null, season: seasonProp = null }) {
  const outlet = useOutletContext() || {};
  const competition = useOptionalTorneosCompetition();
  const organization = organizationProp || outlet.organization;
  const season = seasonProp || competition?.activeSeason;
  const state = competition?.planState;
  const label = describePlanState(state, season);
  const confirmed = ['FREE', 'PREMIUM'].includes(label);
  const comparisonRef = useRef(null);
  const { hash } = useLocation();
  useEffect(() => { if (hash === '#premium') { comparisonRef.current?.scrollIntoView?.(); comparisonRef.current?.focus(); } }, [hash]);
  useEffect(() => { clearPremiumIntent(); }, []);
  const viewPremium = () => { comparisonRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); comparisonRef.current?.focus(); };
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span>Tu temporada</span><h1>Mi plan</h1>
      <p>{organization?.name || 'Organización'} · {season?.name || 'Sin temporada'}</p>
    </header>
    {competition && <CompetitionSelector compact />}
    <section className={styles.currentPlan} data-plan={confirmed ? label.toLowerCase() : 'unknown'} aria-label="Plan actual">
      <div className={styles.planSignal} aria-hidden="true"><ShieldCheck size={48} /><span>{confirmed ? label : '—'}</span></div>
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
    {confirmed && <section className={styles.inclusions} aria-label="Inclusiones actuales">
      <h2>Qué incluye tu plan</h2>
      <ul>{COMPARISON.filter((row) => !row[3]).map(([name, free, premium]) => <li key={name}><Check size={16} aria-hidden="true" /><span>{name}: {label === 'PREMIUM' ? premium : free}</span></li>)}</ul>
    </section>}
    <section ref={comparisonRef} tabIndex={-1} className={styles.comparison} aria-labelledby="plan-comparison-title">
      <div className={styles.sectionHeading}><span>FREE VS PREMIUM</span><h2 id="plan-comparison-title">Qué agrega Premium</h2><p>El plan corresponde a una temporada e incluye sus torneos. Premium no se extiende a otras temporadas.</p></div>
      <div className={styles.comparisonTable}>
        <table><caption className={styles.tableCaption}>Capacidades por temporada</caption><thead><tr><th scope="col">Incluye</th><th scope="col">FREE</th><th scope="col">PREMIUM</th></tr></thead><tbody>{COMPARISON.map(([name, free, premium, soon]) => <tr key={name}><th scope="row">{name}{soon && <small className={styles.comingSoon}>Próximamente</small>}</th><td>{free}</td><td>{premium}</td></tr>)}</tbody></table>
      </div>
      <p className={styles.availability}>Galería, Social Studio y uploads: <strong>Próximamente</strong>. Estas capacidades todavía no están disponibles.</p>
      <p className={styles.availability}>La compra de Premium todavía no está disponible.</p>
    </section>
  </div>;
}
