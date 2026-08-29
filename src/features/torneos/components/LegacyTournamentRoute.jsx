import React, { useState } from 'react';
import { ArrowRight, Trophy } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { LEGACY_RESOLUTION, planLegacyResolution } from '../domain/routeResourceScope';
import {
  organizationTournaments,
  readCategoryId,
} from '../routing/canonicalRoutes';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './LegacyTournamentRoute.module.css';

//
// Adopción de las rutas viejas que no nombran torneo.
//
//   /torneos/organizacion/:organizationId/fixture
//   /torneos/organizacion/:organizationId/partidos/:matchId/acta
//
// Estas direcciones siguen existiendo —no se retira ninguna— pero ya no
// renderizan: resuelven a su equivalente canónica. La diferencia importa
// porque el contenido que mostraban dependía de `activeTournamentId`, o sea de
// una preferencia que la URL no dice y que otra pestaña puede cambiar.
//
// La regla de resolución es la del CHECKPOINT 5A y no se relaja acá: con un
// solo torneo en la organización no hay nada que preguntar, y con varios se
// pregunta. La preferencia NO desempata —es exactamente el caso en el que
// estaría adivinando— y entra sólo como preselección del selector.
//
export default function LegacyTournamentRoute({ build }) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    status,
    error,
    preference,
    refresh,
    seasons,
    tournaments,
  } = useTorneosCompetition();
  const [choice, setChoice] = useState('');
  const plan = planLegacyResolution({
    tournaments,
    preferredTournamentId: preference.activeTournamentId,
  });

  if (status === 'loading' || status === 'idle') {
    return <WorkspaceLoading label="Buscando torneos disponibles…" />;
  }
  if (status === 'error') {
    return <WorkspaceError message={error} onRetry={() => refresh().catch(() => {})} />;
  }

  const { organizationId } = params;
  // La categoría es parte de lo que la dirección vieja reproducía: viaja al
  // destino canónico y ahí el guard decide si pertenece a ese torneo. Perderla
  // en la traducción sería cambiar lo que la persona estaba viendo.
  const categoryId = readCategoryId(location.search);
  const toCanonical = (tournamentId) => build({
    organizationId,
    tournamentId,
    params,
    options: { categoryId },
  });

  if (plan.kind === LEGACY_RESOLUTION.RESOURCE
    || plan.kind === LEGACY_RESOLUTION.SINGLE_TOURNAMENT) {
    return <Navigate to={toCanonical(plan.tournamentId)} replace />;
  }

  if (!tournaments.length) {
    return (
      <Navigate
        to={organizationTournaments(organizationId)}
        replace
        state={{
          safeMessage: 'Esta organización todavía no tiene torneos.',
          from: `${location.pathname}${location.search}`,
        }}
      />
    );
  }

  const selected = choice || plan.hint || '';
  const seasonName = (seasonId) => (
    seasons.find((season) => season.id === seasonId)?.name || 'Sin temporada'
  );

  return (
    <section className={styles.selector} aria-labelledby="legacy-tournament-selector">
      <header>
        <span className={styles.kicker}>Elegí un torneo</span>
        <h1 id="legacy-tournament-selector">¿Qué torneo querés abrir?</h1>
        <p>
          Esta sección está disponible en más de una competencia. Elegí cuál querés
          consultar y conservaremos ese torneo mientras navegás.
        </p>
      </header>

      <ul className={styles.options}>
        {tournaments.map((tournament) => (
          <li key={tournament.id}>
            <label className={styles.option} data-selected={selected === tournament.id}>
              <input
                type="radio"
                name="legacy-tournament"
                value={tournament.id}
                checked={selected === tournament.id}
                onChange={(event) => setChoice(event.target.value)}
              />
              <Trophy size={18} aria-hidden="true" />
              <span>
                <strong>{tournament.name}</strong>
                <small>{seasonName(tournament.seasonId)}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={styles.confirm}
        disabled={!selected}
        onClick={() => navigate(toCanonical(selected), { replace: true })}
      >
        Abrir torneo
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </section>
  );
}
