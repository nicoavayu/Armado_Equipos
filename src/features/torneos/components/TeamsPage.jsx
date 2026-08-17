import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Filter,
  Plus,
  Search,
  Shield,
  UserRoundX,
  Users,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { hasCapability, TOURNAMENT_CAPABILITIES } from '../domain/capabilities';
import { TEAM_ENTRY_STATUS_LABELS } from '../domain/teamRegistration';
import { getTeamRegistrationAvailability } from '../domain/competitionLifecycle';
import CompetitionSelector from './CompetitionSelector';
import TeamWithdrawalDialog from './TeamWithdrawalDialog';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TeamRegistration.module.css';
import BrandingImage from './BrandingImage';

// El retiro estructural sólo existe una vez que la competencia tiene el fixture
// publicado y sus participantes congelados.
const WITHDRAWABLE_TOURNAMENT_STATUSES = ['scheduled', 'active'];

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'submitted', label: 'Presentados' },
  { value: 'changes_requested', label: 'Observados' },
  { value: 'approved', label: 'Aprobados' },
  { value: 'incomplete', label: 'Incompletos' },
];

function configuredMinimumPlayers(settings) {
  const minimum = Number(settings?.minimumPlayers);
  return Number.isFinite(minimum) && minimum > 0 ? minimum : null;
}

export default function TeamsPage() {
  const { organization } = useOutletContext();
  const {
    activeTournament,
    status: competitionStatus,
    error: competitionError,
    refresh: refreshCompetition,
  } = useTorneosCompetition();
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: 'idle',
    entries: [],
    settings: {},
    error: '',
  });
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [withdrawing, setWithdrawing] = useState(null);
  const { service: workspaceService } = useTorneosWorkspace();

  const loadTeams = useCallback(() => {
    if (!activeTournament?.id || typeof workspaceService.loadTeamsContext !== 'function') {
      setState({ status: 'ready', entries: [], settings: {}, error: '' });
      return Promise.resolve();
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ status: 'loading', entries: [], settings: {}, error: '' });
    return workspaceService.loadTeamsContext(organization.id, activeTournament.id)
      .then((payload) => {
        if (requestRef.current !== requestId) return;
        setState({
          status: 'ready',
          entries: payload?.entries || [],
          settings: payload?.settings || {},
          error: '',
        });
      })
      .catch((error) => {
        if (requestRef.current !== requestId) return;
        setState({ status: 'error', entries: [], settings: {}, error: error.message });
      });
  }, [activeTournament?.id, organization.id, workspaceService]);

  useEffect(() => {
    loadTeams();
    return () => { requestRef.current += 1; };
  }, [loadTeams]);

  const rows = useMemo(() => state.entries.filter((entry) => {
    const searchMatch = entry.name.toLowerCase().includes(query.trim().toLowerCase());
    if (!searchMatch) return false;
    if (filter === 'all') return true;
    if (filter === 'incomplete') {
      const minimum = configuredMinimumPlayers(state.settings);
      return minimum !== null && Number(entry.roster?.playerCount || 0) < minimum;
    }
    return entry.status === filter;
  }), [filter, query, state.entries, state.settings?.minimumPlayers]);

  const metrics = useMemo(() => ({
    total: state.entries.length,
    submitted: state.entries.filter((entry) => entry.status === 'submitted').length,
    approved: state.entries.filter((entry) => entry.status === 'approved').length,
    withoutManager: state.entries.filter((entry) => !entry.manager).length,
  }), [state.entries]);
  const canCreate = hasCapability(organization, TOURNAMENT_CAPABILITIES.TEAM_ENTRIES_CREATE);
  const canUpdateTournament = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_UPDATE,
  );
  const canWithdrawParticipants = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.PARTICIPANTS_WITHDRAW,
  ) && WITHDRAWABLE_TOURNAMENT_STATUSES.includes(activeTournament?.status);
  const registration = getTeamRegistrationAvailability(activeTournament);
  const canAdd = canCreate && registration.canAdd;
  const base = `/torneos/organizacion/${organization.id}/equipos`;

  if (competitionStatus === 'loading' || state.status === 'loading') {
    return <WorkspaceLoading label="Cargando inscripciones…" />;
  }
  if (competitionStatus === 'error') {
    return (
      <WorkspaceError
        message={competitionError}
        onRetry={() => refreshCompetition().catch(() => {})}
      />
    );
  }
  if (state.status === 'error') {
    return <WorkspaceError message={state.error} onRetry={() => loadTeams()} />;
  }

  return (
    <div className={styles.page}>
      <CompetitionSelector />
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.kicker}>Inscripciones y planteles</span>
          <h1>Equipos</h1>
          <p>
            {activeTournament
              ? `${activeTournament.name} · seguimiento real de cada inscripción`
              : 'Seleccioná un torneo para administrar sus equipos.'}
          </p>
        </div>
        {canAdd && (
          <Link className={styles.primaryButton} to={`${base}/nuevo`}>
            <Plus size={18} />
            Agregar equipo
          </Link>
        )}
      </header>

      {!activeTournament ? (
        <section className={styles.emptyState}>
          <Shield size={28} />
          <h2>No hay un torneo seleccionado</h2>
          <p>Elegí una temporada y un torneo para ver sus inscripciones.</p>
        </section>
      ) : (
        <>
          <section className={styles.stageNotice} data-open={registration.canAdd}>
            <div>
              <strong>{registration.title}</strong>
              <p>{registration.description}</p>
            </div>
            {!registration.canAdd
              && activeTournament.status === 'draft'
              && canUpdateTournament && (
                <Link
                  className={styles.secondaryButton}
                  to={`/torneos/organizacion/${organization.id}/torneos/${activeTournament.id}/configuracion?step=5`}
                >
                  Revisar configuración
                  <ArrowRight size={17} />
                </Link>
            )}
          </section>

          <section className={styles.metrics} aria-label="Resumen de inscripciones">
            <article><span>Total</span><strong>{metrics.total}</strong><small>equipos vigentes</small></article>
            <article><span>Para revisar</span><strong>{metrics.submitted}</strong><small>presentados</small></article>
            <article><span>Aprobados</span><strong>{metrics.approved}</strong><small>habilitados</small></article>
            <article><span>Sin responsable</span><strong>{metrics.withoutManager}</strong><small>requieren acción</small></article>
          </section>

          <section className={styles.toolbar} aria-label="Filtros de equipos">
            <label className={styles.searchBox}>
              <Search size={17} />
              <span className={styles.srOnly}>Buscar equipo</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar equipo"
              />
            </label>
            <div className={styles.filterRail}>
              <Filter size={16} aria-hidden="true" />
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          {!rows.length ? (
            <section className={styles.emptyState}>
              <Users size={28} />
              <h2>{state.entries.length ? 'No hay coincidencias' : 'Todavía no hay equipos'}</h2>
              <p>
                {state.entries.length
                  ? 'Ajustá los filtros o la búsqueda.'
                  : registration.canAdd
                    ? 'Agregá los equipos que van a participar antes de cerrar la lista y generar el fixture.'
                    : registration.description}
              </p>
              {canAdd && (
                <Link className={styles.primaryButton} to={`${base}/nuevo`}>Agregar equipo</Link>
              )}
            </section>
          ) : (
            <div className={styles.entryList}>
              {rows.map((entry) => {
                const count = Number(entry.roster?.playerCount || 0);
                const minimum = configuredMinimumPlayers(state.settings);
                const incomplete = minimum !== null && count < minimum;
                return (
                  <article key={entry.id} className={styles.entryCard}>
                    <div className={styles.entryIdentity}>
                      <BrandingImage
                        kind="team"
                        path={entry.shieldPath}
                        name={entry.name}
                        className={styles.teamMark}
                        imageClassName={styles.brandingContain}
                      />
                      <div>
                        <span>{entry.categoryName}</span>
                        <h2>{entry.name}</h2>
                        <small>{entry.linked ? 'Equipo Arma2 vinculado' : 'Equipo provisional'}</small>
                      </div>
                    </div>
                    <div className={styles.entryFacts}>
                      <span className={styles.statusPill} data-status={entry.status}>
                        {TEAM_ENTRY_STATUS_LABELS[entry.status]}
                      </span>
                      <span>
                        {incomplete || minimum === null
                          ? <AlertTriangle size={16} />
                          : <CheckCircle2 size={16} />}
                        {minimum === null
                          ? `${count} jugadores · mínimo sin definir`
                          : `${count}/${minimum} jugadores`}
                      </span>
                      <span>
                        {entry.manager ? <Users size={16} /> : <UserRoundX size={16} />}
                        {entry.manager?.displayName || 'Sin responsable'}
                      </span>
                    </div>
                    <div className={styles.entryActions}>
                      {canWithdrawParticipants && entry.status === 'approved' && (
                        <button
                          type="button"
                          className={styles.withdrawButton}
                          onClick={() => setWithdrawing(entry)}
                        >
                          <UserRoundX size={16} />
                          Retirar equipo
                        </button>
                      )}
                      <Link to={`${base}/${entry.id}`}>
                        Abrir
                        <ArrowRight size={17} />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {withdrawing && (
            <TeamWithdrawalDialog
              organization={organization}
              tournament={activeTournament}
              entry={withdrawing}
              onClose={() => setWithdrawing(null)}
              onWithdrawn={() => loadTeams()}
            />
          )}
        </>
      )}
    </div>
  );
}
