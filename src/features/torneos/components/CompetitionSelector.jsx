import React, { useState } from 'react';
import { CalendarRange, Trophy } from 'lucide-react';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { importantNameProps } from './importantNames';
import TorneosSelect from './TorneosSelect';
import styles from './CompetitionCore.module.css';

export default function CompetitionSelector({ compact = false }) {
  const {
    status,
    seasons,
    tournaments,
    preference,
    selectContext,
  } = useTorneosCompetition();
  const [busy, setBusy] = useState(false);
  const seasonTournaments = tournaments.filter(
    (tournament) => tournament.seasonId === preference.activeSeasonId,
  );
  const activeSeason = seasons.find((season) => season.id === preference.activeSeasonId);
  const activeTournament = seasonTournaments.find(
    (tournament) => tournament.id === preference.activeTournamentId,
  );

  const selectSeason = async (event) => {
    const seasonId = event.target.value;
    if (!seasonId) return;
    setBusy(true);
    try {
      const fallback = tournaments.find(
        (tournament) => tournament.seasonId === seasonId,
      );
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
        <CalendarRange size={15} aria-hidden="true" />
        <span>Temporada</span>
        <TorneosSelect
          {...importantNameProps(activeSeason?.name, 'selector')}
          value={preference.activeSeasonId || ''}
          onChange={selectSeason}
          disabled={busy}
          aria-label="Temporada activa"
        >
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>{season.name}</option>
          ))}
        </TorneosSelect>
      </label>
      <label>
        <Trophy size={15} aria-hidden="true" />
        <span>Torneo</span>
        <TorneosSelect
          {...importantNameProps(activeTournament?.name || 'Sin torneo seleccionado', 'selector')}
          value={preference.activeTournamentId || ''}
          onChange={selectTournament}
          disabled={busy}
          aria-label="Torneo activo"
        >
          <option value="">Sin torneo seleccionado</option>
          {seasonTournaments.map((tournament) => (
            <option key={tournament.id} value={tournament.id}>
              {tournament.name}
            </option>
          ))}
        </TorneosSelect>
      </label>
    </section>
  );
}
