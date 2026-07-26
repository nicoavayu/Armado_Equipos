import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardList,
  Gavel,
  Megaphone,
  Shield,
  Table2,
  Trophy,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFixture } from '../context/TorneosFixtureContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import {
  CHECKLIST_ITEMS,
  getOptionName,
  TOURNAMENT_STATUS_LABELS,
} from '../domain/competitionCatalog';
import {
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import CompetitionSelector from './CompetitionSelector';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TorneosShell.module.css';
import coreStyles from './CompetitionCore.module.css';

const futureModules = [
  { label: 'Partidos', description: 'Operación y resultados', icon: ClipboardList },
  { label: 'Tabla', description: 'Posiciones y desempates', icon: Table2 },
  { label: 'Disciplina', description: 'Casos y sanciones', icon: Gavel },
  { label: 'Comunicaciones', description: 'Avisos por audiencia', icon: Megaphone },
];

function formatDate(value) {
  if (!value) return 'A definir';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export default function TorneosDashboard() {
  const { organization } = useOutletContext();
  const organizationPath = `/torneos/organizacion/${organization.id}`;
  const {
    status,
    error,
    seasons,
    modalities,
    formats,
    activeSeason,
    activeTournament,
    refresh,
  } = useTorneosCompetition();
  const { service } = useTorneosWorkspace();
  const fixture = useTorneosFixture();
  const [teamsSummary, setTeamsSummary] = useState(null);
  const canCreateTournament = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_CREATE,
  );
  const canUpdateTournament = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_UPDATE,
  );

  useEffect(() => {
    let active = true;
    setTeamsSummary(null);
    if (!activeTournament?.id || typeof service.loadTeamsContext !== 'function') {
      return undefined;
    }
    service.loadTeamsContext(organization.id, activeTournament.id)
      .then((payload) => {
        if (!active) return;
        const entries = payload?.entries || [];
        const minimum = Number(payload?.settings?.minimumPlayers || 0);
        setTeamsSummary({
          total: entries.length,
          submitted: entries.filter((entry) => entry.status === 'submitted').length,
          approved: entries.filter((entry) => entry.status === 'approved').length,
          incomplete: entries.filter(
            (entry) => Number(entry.roster?.playerCount || 0) < minimum,
          ).length,
        });
      })
      .catch(() => {
        if (active) setTeamsSummary(null);
      });
    return () => { active = false; };
  }, [activeTournament?.id, organization.id, service]);

  if (status === 'loading') return <WorkspaceLoading label="Armando tu tablero…" />;
  if (status === 'error') {
    return <WorkspaceError message={error} onRetry={() => refresh().catch(() => {})} />;
  }

  if (!seasons.length || !activeTournament) {
    return (
      <div className={styles.dashboard}>
        <section className={styles.dashboardHero}>
          <div className={styles.organizationIdentity}>
            <span className={styles.largeMonogram}>
              {organization.logoPath
                ? <img src={organization.logoPath} alt="" />
                : organization.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <span className={styles.eyebrow}>Workspace competitivo</span>
              <h1>{seasons.length ? 'Creá tu primer ' : 'Empezá un '}<em>torneo</em></h1>
              <p>
                {seasons.length
                  ? 'La temporada ya está lista. Ahora definí una competencia y sus reglas.'
                  : 'Primero creá una temporada; después vas a poder configurar torneos y categorías.'}
              </p>
            </div>
          </div>
        </section>
        {seasons.length > 0 && <CompetitionSelector />}
        <section className={coreStyles.emptyCompetition}>
          <span><Trophy size={27} /></span>
          <div>
            <span className={coreStyles.kicker}>Sin datos ficticios</span>
            <h2>{seasons.length ? 'No hay un torneo activo' : 'No hay temporadas todavía'}</h2>
            <p>
              Este tablero se completa únicamente con configuración real guardada
              por tu organización.
            </p>
          </div>
          {canCreateTournament && (
            <Link
              className={coreStyles.primaryAction}
              to={seasons.length
                ? `${organizationPath}/torneos/nuevo`
                : `${organizationPath}/temporadas/nueva`}
            >
              {seasons.length ? 'Crear torneo' : 'Crear temporada'}
              <ArrowRight size={17} />
            </Link>
          )}
        </section>
      </div>
    );
  }

  const checks = activeTournament.checklist?.checks || {};
  const completeCount = CHECKLIST_ITEMS.filter((item) => checks[item.key]).length;
  const completion = Math.round((completeCount / CHECKLIST_ITEMS.length) * 100);

  return (
    <div className={styles.dashboard}>
      <CompetitionSelector />

      <section className={styles.dashboardHero}>
        <div className={styles.organizationIdentity}>
          <span className={styles.largeMonogram}><Trophy size={30} /></span>
          <div>
            <span className={styles.eyebrow}>{activeSeason?.name}</span>
            <h1>{activeTournament.name}</h1>
            <p>
              {getOptionName(modalities, activeTournament.sportModality)}
              {' · '}
              {getOptionName(formats, activeTournament.competitionFormat)}
              {' · '}
              {activeTournament.categories?.length || 0} categorías
            </p>
          </div>
        </div>
        <span className={styles.activeStatus}>
          <span aria-hidden="true" />
          {TOURNAMENT_STATUS_LABELS[activeTournament.status]}
        </span>
      </section>

      <section className={styles.summaryGrid} aria-label="Resumen del torneo">
        <article>
          <span>Configuración</span>
          <strong>{completion}%</strong>
          <small>{completeCount} de {CHECKLIST_ITEMS.length} requisitos</small>
        </article>
        <article>
          <span>Inicio tentativo</span>
          <strong>{formatDate(activeTournament.startDate)}</strong>
          <small>La fecha puede editarse antes de comenzar</small>
        </article>
        <article>
          <span>Categorías</span>
          <strong>{activeTournament.categories?.length || 0}</strong>
          <small>Activas y seleccionables</small>
        </article>
        <article>
          <span>Fixture</span>
          <strong>{fixture.versions.find((version) => version.status === 'published') ? 'Publicado' : fixture.versions.length ? 'Draft' : 'Pendiente'}</strong>
          <small>{fixture.matches.length} partidos · {fixture.matches.filter((match) => match.status === 'scheduled').length} programados</small>
        </article>
      </section>

      <section className={styles.dashboardGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>Checklist real</span>
              <h2>Preparación competitiva</h2>
            </div>
          </div>
          <ul className={styles.dashboardChecklist}>
            {CHECKLIST_ITEMS.map((item) => (
              <li key={item.key} data-complete={Boolean(checks[item.key])}>
                {checks[item.key]
                  ? <CheckCircle2 size={17} />
                  : <Circle size={17} />}
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
          <Link
            className={styles.dashboardPrimaryLink}
            to={`${organizationPath}/torneos/${activeTournament.id}/configuracion`}
          >
            {canUpdateTournament ? 'Continuar configuración' : 'Consultar configuración'}
            <ArrowRight size={17} />
          </Link>
        </article>

        <article className={`${styles.panel} ${styles.securityPanel}`}>
          <Shield size={24} aria-hidden="true" />
          <span className={styles.eyebrow}>Operación de equipos</span>
          <h2>{teamsSummary ? `${teamsSummary.total} equipos` : 'Inscripciones'}</h2>
          <p>
            {teamsSummary
              ? `${teamsSummary.submitted} para revisar · ${teamsSummary.approved} aprobados · ${teamsSummary.incomplete} incompletos.`
              : 'El resumen se completa únicamente con inscripciones persistidas.'}
          </p>
          <Link
            className={styles.dashboardPrimaryLink}
            to={`${organizationPath}/equipos`}
          >
            Ver equipos
            <ArrowRight size={17} />
          </Link>
        </article>
      </section>

      <section className={styles.dashboardGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>Estructura competitiva</span>
              <h2>Fixture y programación</h2>
            </div>
          </div>
          <p>
            {fixture.participantSet?.status === 'frozen'
              ? `${fixture.participants.length} participantes congelados en una fotografía auditable.`
              : 'Cerrá los participantes aprobados antes de generar cruces.'}
          </p>
          <Link className={styles.dashboardPrimaryLink} to={`${organizationPath}/fixture`}>
            Abrir fixture
            <CalendarDays size={17} />
          </Link>
        </article>
        <article className={`${styles.panel} ${styles.securityPanel}`}>
          <CalendarDays size={24} aria-hidden="true" />
          <span className={styles.eyebrow}>Operación previa</span>
          <h2>{fixture.matches.filter((match) => match.status === 'unscheduled').length} sin horario</h2>
          <p>Las canchas, ventanas y conflictos se resuelven antes de habilitar cualquier operación de resultados.</p>
          <Link className={styles.dashboardPrimaryLink} to={`${organizationPath}/programacion`}>
            Programar partidos
            <ArrowRight size={17} />
          </Link>
        </article>
      </section>

      <section className={styles.futureSection} aria-labelledby="future-modules-title">
        <div className={styles.sectionHeading}>
          <span>Módulos futuros</span>
          <h2 id="future-modules-title">Todavía inactivos</h2>
          <p>No hay enlaces, métricas ni datos simulados para estas funciones.</p>
        </div>
        <div className={styles.futureGrid}>
          {futureModules.map(({ label, description, icon: Icon }) => (
            <article key={label}>
              <Icon size={20} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <em>Próximamente</em>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
