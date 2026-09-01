import React, { useState } from 'react';
import { CalendarRange, ChevronDown, Trophy } from 'lucide-react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import {
  CANONICAL_TOURNAMENT_ROUTE_PATTERN,
  tournamentSectionRoute,
} from '../routing/canonicalRoutes';
import styles from './CompetitionCore.module.css';

function TournamentPlanBadge({ planState }) {
  const trustedPlan = planState?.status === 'ready' && planState.data?.isTrusted
    ? planState.data.plan
    : null;
  const label = trustedPlan === 'PREMIUM'
    ? 'Premium'
    : trustedPlan === 'FREE'
      ? 'Free'
      : planState?.status === 'loading'
        ? 'Verificando plan'
        : 'Plan no verificado';
  const tone = trustedPlan?.toLowerCase()
    || (planState?.status === 'loading' ? 'loading' : 'unverified');

  return (
    <span
      className={styles.planBadge}
      data-plan={tone}
      role="status"
      aria-label={`Plan del torneo: ${label}`}
    >
      {label}
    </span>
  );
}

export default function CompetitionSelector({ compact = false }) {
  const {
    status,
    seasons,
    tournaments,
    preference,
    planState,
    selectContext,
  } = useTorneosCompetition();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const canonicalMatch = useMatch(CANONICAL_TOURNAMENT_ROUTE_PATTERN);
  const seasonTournaments = tournaments.filter(
    (tournament) => tournament.seasonId === preference.activeSeasonId,
  );

  //
  // Dentro de una ruta canónica, elegir torneo es *ir* al otro torneo.
  //
  // Escribir la preferencia y quedarse acá no alcanzaría: el provider anclado
  // ignora la preferencia a propósito, así que el selector diría una cosa y la
  // pantalla seguiría mostrando otra. La preferencia se actualiza igual, sin
  // bloquear la navegación, porque sigue siendo el default de las superficies
  // que no nombran torneo.
  //
  const goToTournament = (tournamentId) => {
    if (!canonicalMatch || !tournamentId) return false;
    const build = tournamentSectionRoute(canonicalMatch.params['*']);
    navigate(build(canonicalMatch.params.organizationId, tournamentId));
    return true;
  };

  const selectSeason = async (event) => {
    const seasonId = event.target.value;
    if (!seasonId) return;
    setBusy(true);
    try {
      const fallback = tournaments.find(
        (tournament) => tournament.seasonId === seasonId,
      );
      if (goToTournament(fallback?.id)) {
        selectContext(seasonId, fallback.id).catch(() => {});
        return;
      }
      await selectContext(seasonId, fallback?.id || null);
    } finally {
      setBusy(false);
    }
  };

  const selectTournament = async (event) => {
    const tournamentId = event.target.value || null;
    if (!preference.activeSeasonId) return;
    setBusy(true);
    try {
      if (goToTournament(tournamentId)) {
        selectContext(preference.activeSeasonId, tournamentId).catch(() => {});
        return;
      }
      await selectContext(preference.activeSeasonId, tournamentId);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className={`${styles.contextSelector} ${compact ? styles.contextSelectorCompact : ''}`}>
        <span className={styles.selectorSkeleton}>Validando contexto…</span>
      </div>
    );
  }

  if (!seasons.length) return null;

  return (
    <section
      className={`${styles.contextSelector} ${compact ? styles.contextSelectorCompact : ''}`}
      aria-label="Contexto competitivo activo"
    >
      <label>
        {!compact && <CalendarRange size={15} className={styles.selectorIcon} aria-hidden="true" />}
        <span>Temporada</span>
        <select
          value={preference.activeSeasonId || ''}
          onChange={selectSeason}
          disabled={busy}
          aria-label="Temporada activa"
        >
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>{season.name}</option>
          ))}
        </select>
        <ChevronDown size={14} className={styles.selectorChevron} aria-hidden="true" />
      </label>
      <label className={styles.tournamentSelectorLabel}>
        {!compact && <Trophy size={15} className={styles.selectorIcon} aria-hidden="true" />}
        <span>Torneo</span>
        <select
          value={preference.activeTournamentId || ''}
          onChange={selectTournament}
          disabled={busy}
          aria-label="Torneo activo"
        >
          {!preference.activeTournamentId && (
            <option value="">Elegí un torneo</option>
          )}
          {seasonTournaments.map((tournament) => (
            <option key={tournament.id} value={tournament.id}>
              {tournament.name}
            </option>
          ))}
        </select>
        {preference.activeTournamentId && <TournamentPlanBadge planState={planState} />}
        <ChevronDown size={14} className={styles.selectorChevron} aria-hidden="true" />
      </label>
    </section>
  );
}
