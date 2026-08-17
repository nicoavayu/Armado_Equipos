import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
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
} from '../domain/competitionCatalog';
import {
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import CompetitionSelector from './CompetitionSelector';
import CompetitionLifecycleActions from './CompetitionLifecycleActions';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TorneosShell.module.css';
import coreStyles from './CompetitionCore.module.css';
import BrandingImage from './BrandingImage';
import {
  countScheduledMatches,
  hasScheduledTime,
} from '../domain/matchSchedule';
import {
  getOwnerNextStep,
  getTournamentStage,
} from '../domain/competitionLifecycle';

const operationalModules = [
  { label: 'Partidos', description: 'Resultados, actas e historial', icon: ClipboardList, path: 'partidos' },
  { label: 'Tabla', description: 'Posiciones y desempates', icon: Table2, path: 'competencia/tabla' },
  { label: 'Disciplina', description: 'Tarjetas, casos y sanciones derivadas', icon: Gavel, path: 'competencia/disciplina' },
  { label: 'Comunicaciones', description: 'Avisos para la competencia', icon: Megaphone, path: 'comunicaciones' },
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
  const teamsRequestRef = useRef(0);
  const [teamsSummary, setTeamsSummary] = useState({
    status: 'idle',
    data: null,
    error: '',
  });
  const canCreateTournament = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_CREATE,
  );
  const canUpdateTournament = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_UPDATE,
  );

  const loadTeamsSummary = useCallback(() => {
    const requestId = teamsRequestRef.current + 1;
    teamsRequestRef.current = requestId;
    setTeamsSummary({ status: 'loading', data: null, error: '' });
    if (!activeTournament?.id || typeof service.loadTeamsContext !== 'function') {
      setTeamsSummary({ status: 'ready', data: null, error: '' });
      return Promise.resolve();
    }
    return service.loadTeamsContext(organization.id, activeTournament.id)
      .then((payload) => {
        if (teamsRequestRef.current !== requestId) return;
        const entries = payload?.entries || [];
        const minimumValue = Number(payload?.settings?.minimumPlayers);
        const minimum = Number.isFinite(minimumValue) && minimumValue > 0
          ? minimumValue
          : null;
        setTeamsSummary({
          status: 'ready',
          error: '',
          data: {
            total: entries.length,
            submitted: entries.filter((entry) => entry.status === 'submitted').length,
            approved: entries.filter((entry) => entry.status === 'approved').length,
            incomplete: minimum === null ? null : entries.filter(
              (entry) => Number(entry.roster?.playerCount || 0) < minimum,
            ).length,
          },
        });
      })
      .catch((loadError) => {
        if (teamsRequestRef.current !== requestId) return;
        setTeamsSummary({
          status: 'error',
          data: null,
          error: loadError?.message || 'No pudimos cargar las inscripciones.',
        });
      });
  }, [activeTournament?.id, organization.id, service]);

  useEffect(() => {
    loadTeamsSummary().catch(() => {});
    return () => { teamsRequestRef.current += 1; };
  }, [loadTeamsSummary]);

  if (status === 'loading') return <WorkspaceLoading label="Armando tu tablero…" />;
  if (status === 'error') {
    return <WorkspaceError message={error} onRetry={() => refresh().catch(() => {})} />;
  }

  if (!seasons.length || !activeTournament) {
    return (
      <div className={styles.dashboard}>
        <section className={styles.dashboardHero}>
          <div className={styles.organizationIdentity}>
            <BrandingImage
              kind="organization"
              path={organization.logoPath}
              name={organization.name}
              className={styles.largeMonogram}
              imageClassName={styles.brandingContain}
            />
            <div>
              <span className={styles.eyebrow}>Organización de competencias</span>
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
            <span className={coreStyles.kicker}>Primer paso</span>
            <h2>{seasons.length ? 'No hay un torneo activo' : 'No hay temporadas todavía'}</h2>
            <p>
              {seasons.length
                ? 'Creá el torneo que vas a organizar y completá sus reglas y categorías.'
                : 'Creá una temporada para agrupar los torneos de este período.'}
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
  const stage = getTournamentStage(activeTournament.status);
  const nextStep = getOwnerNextStep({
    tournament: activeTournament,
    teamsSummary,
    fixture,
    organizationPath,
  });
  const teams = teamsSummary.data;
  const fixtureReady = fixture.status === 'ready';
  const publishedFixture = fixtureReady
    ? fixture.versions.find((version) => version.status === 'published')
    : null;

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
          {stage.label}
        </span>
      </section>

      <section className={styles.lifecyclePanel} data-blocked={Boolean(nextStep?.blocked)}>
        <div>
          <span className={styles.eyebrow}>Estado actual · {stage.label}</span>
          <h2>{nextStep?.title}</h2>
          <p>{stage.description} {nextStep?.description}</p>
        </div>
        {nextStep?.to && (
          <Link className={styles.dashboardPrimaryLink} to={nextStep.to}>
            {nextStep.label}
            <ArrowRight size={17} />
          </Link>
        )}
        <CompetitionLifecycleActions
          organization={organization}
          tournament={activeTournament}
        />
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
          {fixture.status === 'loading' || fixture.status === 'idle' ? (
            <><strong>Cargando…</strong><small>Consultando partidos y versiones</small></>
          ) : fixture.status === 'error' ? (
            <>
              <strong>No disponible</strong>
              <small>La consulta falló; no se interpreta como 0.</small>
              <button type="button" className={styles.inlineRetry} onClick={() => fixture.refresh().catch(() => {})}>
                Reintentar
              </button>
            </>
          ) : (
            <>
              <strong>{publishedFixture ? 'Publicado' : fixture.versions.length ? 'Borrador' : 'Pendiente'}</strong>
              <small>{fixture.matches.length} partidos · {countScheduledMatches(fixture.matches)} programados</small>
            </>
          )}
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
          <h2>{teamsSummary.status === 'error'
            ? 'No disponible'
            : teams
              ? `${teams.total} equipos`
              : 'Cargando inscripciones…'}</h2>
          {teamsSummary.status === 'error' ? (
            <div className={styles.inlineError} role="alert">
              <AlertCircle size={18} />
              <p>{teamsSummary.error}</p>
              <button type="button" onClick={() => loadTeamsSummary().catch(() => {})}>Reintentar</button>
            </div>
          ) : (
            <p>
              {teams
                ? `${teams.submitted} para revisar · ${teams.approved} aprobados · ${teams.incomplete === null
                  ? 'requisitos de plantel sin configurar.'
                  : `${teams.incomplete} incompletos.`}`
                : 'Consultando equipos y planteles.'}
            </p>
          )}
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
            {fixture.status === 'error'
              ? 'No pudimos consultar el fixture. Reintentá antes de continuar.'
              : fixture.participantSet?.status === 'frozen'
                ? `${fixture.participants.length} equipos confirmados para esta versión.`
                : 'Confirmá los equipos aprobados antes de generar cruces.'}
          </p>
          <Link className={styles.dashboardPrimaryLink} to={`${organizationPath}/fixture`}>
            Abrir fixture
            <CalendarDays size={17} />
          </Link>
        </article>
        <article className={`${styles.panel} ${styles.securityPanel}`}>
          <CalendarDays size={24} aria-hidden="true" />
          <span className={styles.eyebrow}>Operación previa</span>
          <h2>{fixtureReady
            ? `${fixture.matches.filter((match) => !hasScheduledTime(match)).length} sin horario`
            : 'Programación no disponible'}</h2>
          <p>{fixtureReady
            ? 'Asigná horarios y canchas antes de iniciar la competencia.'
            : 'Primero necesitamos cargar el fixture para indicar qué partidos requieren programación.'}</p>
          <Link className={styles.dashboardPrimaryLink} to={`${organizationPath}/programacion`}>
            Programar partidos
            <ArrowRight size={17} />
          </Link>
        </article>
      </section>

      <section className={styles.futureSection} aria-labelledby="available-modules-title">
        <div className={styles.sectionHeading}>
          <span>Operación y seguimiento</span>
          <h2 id="available-modules-title">Herramientas disponibles</h2>
          <p>Usan los mismos partidos y datos oficiales que la página pública.</p>
        </div>
        <div className={styles.futureGrid}>
          {operationalModules.map(({ label, description, icon: Icon, path }) => (
            <Link key={label} to={`${organizationPath}/${path}`}>
              <Icon size={20} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
