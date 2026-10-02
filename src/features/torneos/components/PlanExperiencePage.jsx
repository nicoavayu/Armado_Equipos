import React, { useEffect, useRef } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { useOutletContext, useLocation } from 'react-router-dom';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { PLAN_COMPARISON, SOCIAL_STUDIO_PLAN } from '../domain/planComparison';
import { describePlanState } from '../domain/planUx';
import { clearPremiumIntent } from '../domain/premiumIntent';
import CompetitionSelector from './CompetitionSelector';
import styles from './PlanExperiencePage.module.css';

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
    {confirmed && <section className={styles.inclusions} aria-label="Inclusiones actuales">
      <h2>Qué incluye tu plan</h2>
      <ul>{PLAN_COMPARISON.filter((row) => row.included).map(({ name, free, premium }) => <li key={name}><Check size={16} aria-hidden="true" /><span>{name}: {label === 'PREMIUM' ? premium : free}</span></li>)}</ul>
    </section>}
    <section ref={comparisonRef} tabIndex={-1} className={styles.comparison} aria-labelledby="plan-comparison-title">
      <div className={styles.sectionHeading}><span>FREE VS PREMIUM</span><h2 id="plan-comparison-title">Qué agrega Premium</h2><p>El plan se elige por temporada e incluye todos sus torneos. Premium no se extiende a otras temporadas.</p></div>
      <div className={styles.comparisonTable}>
        <table><caption className={styles.tableCaption}>Qué incluye cada plan en una temporada</caption><thead><tr><th scope="col">Incluye</th><th scope="col">FREE</th><th scope="col">PREMIUM</th></tr></thead><tbody>{PLAN_COMPARISON.map(({ name, free, premium, soon }) => <tr key={name}><th scope="row">{name}{soon && <small className={styles.comingSoon}>Próximamente</small>}</th><td>{free}</td><td>{premium}</td></tr>)}</tbody></table>
      </div>
      <section className={styles.studioPlan} aria-labelledby="plan-studio-title">
        <h3 id="plan-studio-title">Estudio Social</h3>
        <p>Placas para redes armadas con los datos oficiales del torneo, en {SOCIAL_STUDIO_PLAN.formats.join(' y ')}.</p>
        <div className={styles.studioTiers}>
          <div>
            <h4>FREE</h4>
            <ul>
              <li><strong>Placas:</strong> {SOCIAL_STUDIO_PLAN.freePieces.join(', ')}.</li>
              <li><strong>Estilo:</strong> {SOCIAL_STUDIO_PLAN.freeStyles.join(', ')}.</li>
              <li>Las placas llevan la firma Arma2.</li>
            </ul>
          </div>
          <div data-tier="premium">
            <h4>PREMIUM suma</h4>
            <ul>
              <li><strong>Placas:</strong> {SOCIAL_STUDIO_PLAN.premiumPieces.join(', ')}.</li>
              <li><strong>Estilos:</strong> {SOCIAL_STUDIO_PLAN.premiumStyles.join(', ')}, además de {SOCIAL_STUDIO_PLAN.freeStyles.join(', ')}.</li>
              <li>Podés quitar la firma Arma2.</li>
            </ul>
          </div>
        </div>
      </section>
      <p className={styles.availability}>Estudio Social, galería de fotos y carga de logos y escudos: <strong>Próximamente</strong>. Todavía no se pueden usar en la app.</p>
      <p className={styles.availability}>La compra de Premium todavía no está disponible.</p>
    </section>
  </div>;
}
