import React, { useState } from 'react';
import { CalendarRange, ChevronDown, Trophy } from 'lucide-react';
import { Link, useMatch, useNavigate, useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFeature } from '../context/TorneosFeaturesContext';
import {
  canonicalRoutes,
  CANONICAL_TOURNAMENT_ROUTE_PATTERN,
  tournamentSectionRoute,
} from '../routing/canonicalRoutes';
import { describePlanState } from '../domain/planUx';
import styles from './CompetitionCore.module.css';

function TournamentPlanBadge({ planState, season, organizationId }) {
  const label = describePlanState(planState, season);
  return <Link className={styles.planBadge} data-plan={label.toLowerCase()}
    to={season ? canonicalRoutes.seasonPlan(organizationId, season.id) : canonicalRoutes.organizationMyPlan(organizationId)}
    aria-label={`Mi plan: ${label} · ${season?.name || 'Sin temporada'}`}>{label}</Link>;
}

export default function CompetitionSelector({ compact = false }) {
  const {
    status,
    seasons,
    tournaments,
    preference,
    planState,
    activeSeason,
    selectContext,
  } = useTorneosCompetition();
  const { organizationId: routeOrganizationId } = useParams();
  const organizationId = routeOrganizationId || preference.organizationId;
  const planEnabled = useTorneosFeature('plan');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const canonicalMatch = useMatch(CANONICAL_TOURNAMENT_ROUTE_PATTERN);
  const seasonMatch = useMatch('/torneos/organizacion/:organizationId/temporada/:seasonId/plan');
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
      if (seasonMatch) {
        navigate(canonicalRoutes.seasonPlan(organizationId, seasonId));
        selectContext(seasonId, fallback?.id || null).catch(() => {});
        return;
      }
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
          {!preference.activeSeasonId && <option value="">Elegí una temporada</option>}
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

        <ChevronDown size={14} className={styles.selectorChevron} aria-hidden="true" />
      </label>
      {planEnabled && <TournamentPlanBadge planState={planState} season={activeSeason} organizationId={organizationId} />}
    </section>
  );
}
