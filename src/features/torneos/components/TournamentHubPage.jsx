import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Goal,
  MapPin,
  Medal,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  Link,
  Navigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import styles from './ParticipantHub.module.css';

const SECTIONS = [
  ['resumen', 'Resumen', Sparkles],
  ['partidos', 'Partidos', CalendarDays],
  ['tabla', 'Tabla', Trophy],
  ['estadisticas', 'Estadísticas', BarChart3],
  ['equipos', 'Equipos', UsersRound],
  ['disciplina', 'Disciplina', ShieldAlert],
];
const VALID_SECTIONS = new Set(SECTIONS.map(([key]) => key));
const STATUS_LABELS = {
  draft: 'Preparación',
  registration: 'Inscripción',
  scheduled: 'Programado',
  active: 'En juego',
  completed: 'Finalizado',
  archived: 'Archivado',
  unscheduled: 'Fecha a confirmar',
  postponed: 'Postergado',
  cancelled: 'Cancelado',
  ready: 'Listo',
  official: 'Oficial',
};
const AVAILABILITY_LABELS = {
  available: 'Voy',
  unavailable: 'No voy',
  maybe: 'En duda',
};
const SUSPENSION_LABELS = {
  yellow_accumulation: 'Acumulación de amarillas',
  second_yellow: 'Segunda amarilla',
  direct_red: 'Roja directa',
  manual: 'Resolución disciplinaria',
};
const SUSPENSION_STATUS_LABELS = {
  active: 'Activa',
  reduced: 'Reducida',
  served: 'Cumplida',
};

function formatDate(value, withTime = true) {
  if (!value) return 'A confirmar';
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function TeamMark({ team, compact = false }) {
  const name = team?.shortName || team?.name || '—';
  return (
    <span className={compact ? styles.teamMarkCompact : styles.teamMark} aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Score({ match }) {
  const result = match.result || match.score;
  if (!result || result.home === null || result.home === undefined) {
    return <span className={styles.versus}>VS</span>;
  }
  return (
    <span className={styles.score}>
      {result.home}<small>:</small>{result.away}
      {result.homePenalties !== null && result.homePenalties !== undefined && (
        <em>({result.homePenalties}-{result.awayPenalties})</em>
      )}
    </span>
  );
}

function AvailabilityActions({
  match, busy, onRespond, readOnly,
}) {
  if (!match.isMyTeam || match.result || readOnly) return null;
  return (
    <div className={styles.availability} aria-label="Tu disponibilidad">
      <span>¿Podés jugar?</span>
      <div>
        {Object.entries(AVAILABILITY_LABELS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={match.myAvailability === value}
            onClick={() => onRespond(match, value)}
          >
            {value === 'available' ? <Check size={14} /> : value === 'unavailable' ? <X size={14} /> : <Clock3 size={14} />}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MatchCard({
  match, tournamentId, categoryId, busy, onRespond, readOnly = false,
}) {
  return (
    <article className={`${styles.matchCard} ${match.isMyTeam ? styles.matchCardMine : ''}`}>
      <header>
        <span>{match.roundName || match.round?.name || 'Fixture'}</span>
        <strong>{STATUS_LABELS[match.status] || match.status || 'Partido'}</strong>
      </header>
      <div className={styles.matchup}>
        <div>
          <TeamMark team={match.home} />
          <span><strong>{match.home?.name || 'Por definir'}</strong><small>Local</small></span>
        </div>
        <Score match={match} />
        <div>
          <TeamMark team={match.away} />
          <span><strong>{match.away?.name || 'Por definir'}</strong><small>Visitante</small></span>
        </div>
      </div>
      <div className={styles.matchMeta}>
        <span><CalendarDays size={15} /> {formatDate(match.scheduledAt)}</span>
        {(match.venueName || match.venue?.name) && (
          <span><MapPin size={15} /> {match.venueName || match.venue.name}</span>
        )}
      </div>
      {match.myCallupStatus === 'called_up' && (
        <div className={styles.callupBadge}>
          <Medal size={15} />
          Convocado · {match.myLineupStatus === 'starter' ? 'Titular' : 'Suplente'}
        </div>
      )}
      <AvailabilityActions
        match={match}
        busy={busy}
        onRespond={onRespond}
        readOnly={readOnly}
      />
      <div className={styles.matchActions}>
        <Link to={`/torneos/torneo/${tournamentId}/partidos/${match.matchId}?categoria=${categoryId}`}>
          Ver partido <ChevronRight size={16} />
        </Link>
        {match.isMyTeam && (
          <Link to={`/torneos/mis-partidos/${match.matchId}`}>
            Mi disponibilidad
          </Link>
        )}
      </div>
    </article>
  );
}

function HubState({
  icon: Icon = Trophy, title, copy, action = null,
}) {
  return (
    <section className={styles.hubState}>
      <Icon size={31} />
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </section>
  );
}

function HubSkeleton() {
  return (
    <div className={styles.hubSkeleton} role="status" aria-live="polite">
      <span className={styles.srOnly}>Cargando centro del torneo…</span>
      <div /><div /><div /><div />
    </div>
  );
}

function OverviewSection({
  hub, tournamentId, categoryId, busyMatchId, onRespond,
}) {
  const nextMatch = hub.nextMatches?.[0];
  const isCaptain = ['captain', 'delegate'].includes(hub.audience?.managerRole);
  const isOrganizer = Boolean(
    hub.audience?.canManageTournament && !isCaptain && !hub.audience?.isPlayer,
  );
  const nextMatchPanel = (
    <section className={`${styles.featurePanel} ${styles.nextMatchPanel}`}>
      <div className={styles.panelHeading}>
        <span>Próxima cita</span>
        <h2>{nextMatch ? 'Lo que viene' : 'Fixture por confirmar'}</h2>
      </div>
      {nextMatch ? (
        <MatchCard
          match={nextMatch}
          tournamentId={tournamentId}
          categoryId={categoryId}
          busy={busyMatchId === nextMatch.matchId}
          onRespond={onRespond}
          readOnly={hub.tournament.readOnly}
        />
      ) : (
        <p className={styles.panelEmpty}>La organización todavía no publicó un próximo partido.</p>
      )}
    </section>
  );
  const alertsPanel = (
    <section className={`${styles.featurePanel} ${styles.alertPanel}`}>
      <div className={styles.panelHeading}>
        <span>{isOrganizer ? 'Estado operativo' : 'Tu radar'}</span>
        <h2>{isOrganizer ? 'Alertas del torneo' : 'Alertas personales'}</h2>
      </div>
      {hub.alerts?.length ? (
        <div className={styles.alertList}>
          {hub.alerts.map((alert, index) => (
            <article key={`${alert.type}:${index}`}>
              {alert.type === 'suspension' ? <ShieldAlert size={18} /> : <Medal size={18} />}
              <span><strong>{alert.label}</strong><small>{alert.detail}</small></span>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.clearAlert}>
          <Check size={18} />
          {isOrganizer ? 'Sin alertas publicadas pendientes.' : 'Sin alertas pendientes.'}
        </div>
      )}
      {isOrganizer && (
        <Link
          className={styles.panelLink}
          to={`/torneos/organizacion/${hub.tournament.organizationId}/inicio`}
        >
          Abrir gestión operativa <ArrowRight size={16} />
        </Link>
      )}
    </section>
  );
  return (
    <div className={styles.overviewGrid}>
      {isOrganizer && alertsPanel}
      {nextMatchPanel}
      {isCaptain && hub.myTeam && (
        <section className={`${styles.featurePanel} ${styles.captainPanel}`}>
          <div className={styles.panelHeading}>
            <span>Vestuario</span>
            <h2>Respuestas y convocatoria</h2>
          </div>
          <dl className={styles.captainMetrics}>
            <div>
              <dt>Disponibles</dt>
              <dd>{hub.myTeam.nextMatchResponses?.available || 0}</dd>
            </div>
            <div>
              <dt>No disponibles</dt>
              <dd>{hub.myTeam.nextMatchResponses?.unavailable || 0}</dd>
            </div>
            <div>
              <dt>En duda</dt>
              <dd>{hub.myTeam.nextMatchResponses?.maybe || 0}</dd>
            </div>
            <div>
              <dt>Bloqueados</dt>
              <dd>{hub.myTeam.activeSuspensions?.length || 0}</dd>
            </div>
          </dl>
          {nextMatch && !hub.tournament.readOnly && (
            <Link className={styles.captainCta} to={`/torneos/mis-partidos/${nextMatch.matchId}/convocatoria`}>
              Preparar convocatoria <ArrowRight size={16} />
            </Link>
          )}
        </section>
      )}
      {!isOrganizer && alertsPanel}

      <section className={styles.featurePanel}>
        <div className={styles.panelHeading}>
          <span>Tabla publicada</span>
          <h2>La carrera por arriba</h2>
        </div>
        {hub.standings?.length ? (
          <ol className={styles.miniStandings}>
            {hub.standings.map((row) => (
              <li key={row.participantId} className={row.isMyTeam ? styles.isMine : ''}>
                <strong>{row.position}</strong>
                <span>{row.teamName}</span>
                <small>{row.played} PJ</small>
                <b>{row.points} pts</b>
              </li>
            ))}
          </ol>
        ) : <p className={styles.panelEmpty}>Todavía no hay una tabla publicada.</p>}
        <Link className={styles.panelLink} to={`/torneos/torneo/${tournamentId}/tabla?categoria=${categoryId}`}>
          Ver tabla completa <ArrowRight size={16} />
        </Link>
      </section>

      <section className={styles.featurePanel}>
        <div className={styles.panelHeading}>
          <span>Rendimiento oficial</span>
          <h2>Goles que pesan</h2>
        </div>
        {hub.topScorers?.length ? (
          <ol className={styles.scorerRail}>
            {hub.topScorers.map((player, index) => (
              <li key={player.rosterPlayerId} className={player.isMe ? styles.isMine : ''}>
                <strong>{String(index + 1).padStart(2, '0')}</strong>
                <span><b>{player.name}</b><small>{player.teamName}</small></span>
                <em>{player.goals}</em>
              </li>
            ))}
          </ol>
        ) : <p className={styles.panelEmpty}>Los goleadores aparecerán tras publicar estadísticas.</p>}
        <Link className={styles.panelLink} to={`/torneos/torneo/${tournamentId}/estadisticas?categoria=${categoryId}`}>
          Abrir estadísticas <ArrowRight size={16} />
        </Link>
      </section>

      {hub.myTeam && (
        <section className={`${styles.featurePanel} ${styles.myTeamPanel}`}>
          <div className={styles.panelHeading}>
            <span>Tu vestuario</span>
            <h2>{hub.myTeam.name}</h2>
          </div>
          <div className={styles.myTeamSummary}>
            <TeamMark team={hub.myTeam} />
            <div>
              <strong>{hub.myTeam.roster?.length || 0} jugadores publicados</strong>
              <small>{hub.myTeam.activeSuspensions?.length || 0} sanciones activas</small>
            </div>
          </div>
          {hub.myStatistics && (
            <dl className={styles.personalStats}>
              <div><dt>Partidos</dt><dd>{hub.myStatistics.appearances}</dd></div>
              <div><dt>Goles</dt><dd>{hub.myStatistics.goals}</dd></div>
              <div><dt>Asist.</dt><dd>{hub.myStatistics.assists}</dd></div>
            </dl>
          )}
        </section>
      )}

      <section className={styles.featurePanel}>
        <div className={styles.panelHeading}>
          <span>Últimos resultados</span>
          <h2>Marcadores oficiales</h2>
        </div>
        {hub.recentResults?.length ? (
          <div className={styles.resultList}>
            {hub.recentResults.map((match) => (
              <Link key={match.matchId} to={`/torneos/torneo/${tournamentId}/partidos/${match.matchId}?categoria=${categoryId}`}>
                <span>{match.home.name}</span>
                <Score match={match} />
                <span>{match.away.name}</span>
              </Link>
            ))}
          </div>
        ) : <p className={styles.panelEmpty}>Todavía no hay resultados oficiales.</p>}
      </section>
    </div>
  );
}

function ProjectionFilters({
  hub, phaseId, setPhaseId, groupId, setGroupId,
}) {
  const groups = (hub.competition?.groups || []).filter(
    (group) => group.phaseId === phaseId,
  );
  return (
    <section className={styles.projectionFilters} aria-label="Contexto de la competencia">
      <label>
        <span>Fase</span>
        <select value={phaseId || ''} onChange={(event) => {
          setPhaseId(event.target.value);
          setGroupId(null);
        }}>
          {(hub.competition?.phases || []).map((phase) => (
            <option key={phase.id} value={phase.id}>{phase.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Grupo</span>
        <select value={groupId || ''} onChange={(event) => setGroupId(event.target.value || null)}>
          <option value="">Tabla general</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </label>
    </section>
  );
}

function StandingsSection({ rows, myTeamId }) {
  if (!rows.length) return <HubState title="Sin tabla publicada" copy="La tabla aparecerá cuando la organización publique un cálculo oficial para esta fase." />;
  return (
    <div className={styles.participantTableWrap}>
      <table className={styles.participantTable}>
        <thead><tr><th>Pos.</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts.</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.participantId} className={row.teamEntryId === myTeamId ? styles.tableMine : ''}>
              <td><strong>{row.position}</strong></td>
              <td><TeamMark team={{ name: row.teamName, shortName: row.shortName }} compact /><span>{row.teamName}</span></td>
              <td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td>
              <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
              <td><b>{row.points}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatisticsSection({ data, myPlayerId }) {
  const players = data?.players || [];
  const teams = data?.teams || [];
  if (!players.length && !teams.length) return <HubState icon={BarChart3} title="Sin estadísticas publicadas" copy="No mostramos rankings hasta que exista una revisión oficial." />;
  return (
    <div className={styles.statisticsGrid}>
      <section className={styles.rankingPanel}>
        <div className={styles.panelHeading}><span>Ranking individual</span><h2>Goles y asistencias</h2></div>
        <ol className={styles.fullRanking}>
          {players.map((player, index) => (
            <li key={player.rosterPlayerId} className={player.rosterPlayerId === myPlayerId ? styles.isMine : ''}>
              <strong>{String(index + 1).padStart(2, '0')}</strong>
              <span><b>{player.name}</b><small>{player.appearances} apariciones</small></span>
              <em>{player.goals}<small>goles</small></em>
              <em>{player.assists}<small>asis.</small></em>
            </li>
          ))}
        </ol>
      </section>
      <section className={styles.rankingPanel}>
        <div className={styles.panelHeading}><span>Equipos</span><h2>Ritmo competitivo</h2></div>
        <div className={styles.teamStatList}>
          {teams.map((team) => (
            <article key={team.participantId}>
              <TeamMark team={team} compact />
              <span><strong>{team.teamName}</strong><small>{team.streakCount || 0} en racha</small></span>
              <b>{team.goals} GF</b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function TeamsSection({ payload }) {
  const teams = payload?.items || [];
  if (!teams.length) return <HubState icon={UsersRound} title="Sin equipos publicados" copy="Los participantes aparecerán cuando exista un fixture vigente." />;
  return (
    <div className={styles.teamDirectory}>
      {teams.map((team) => (
        <article key={team.participantId} className={team.isMyTeam ? styles.teamCardMine : ''}>
          <header><TeamMark team={team} /><span><strong>{team.name}</strong><small>{team.position ? `#${team.position} · ${team.points} pts` : 'Sin posición publicada'}</small></span></header>
          <details>
            <summary>Ver plantel ({team.roster.length})</summary>
            <ul>
              {team.roster.map((player) => (
                <li key={player.id}>
                  <b>{player.shirtNumber ?? '—'}</b>
                  <span>{player.displayName}</span>
                  <small>{player.primaryPosition || 'Sin posición'}</small>
                </li>
              ))}
            </ul>
          </details>
          {team.nextMatch && <p><CalendarDays size={15} /> {formatDate(team.nextMatch.scheduledAt)}</p>}
        </article>
      ))}
    </div>
  );
}

function DisciplineSection({ data, myPlayerId }) {
  const rows = data?.discipline || [];
  if (!rows.length) return <HubState icon={Shield} title="Sin novedades disciplinarias" copy="No hay tarjetas o sanciones publicadas para este contexto." />;
  return (
    <div className={styles.disciplineDirectory}>
      {rows.map((row) => (
        <article key={row.rosterPlayerId} className={row.rosterPlayerId === myPlayerId ? styles.isMine : ''}>
          <header><Shield size={18} /><span><strong>{row.name}</strong><small>{row.yellowCards} amarillas · {row.directReds + row.secondYellows} rojas</small></span><b>{row.fairPlayPoints} FP</b></header>
          {(row.suspensions || []).map((suspension) => (
            <div key={suspension.id}>
              <ShieldAlert size={16} />
              <span>
                <strong>{SUSPENSION_LABELS[suspension.sourceType] || 'Sanción publicada'}</strong>
                <small>
                  {suspension.servedMatches}/{suspension.totalMatches} fechas
                  {' · '}
                  {SUSPENSION_STATUS_LABELS[suspension.status] || 'Publicada'}
                </small>
              </span>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function MatchDetail({ match, tournamentId, categoryId }) {
  if (!match) return null;
  const goals = (match.officialEvents || []).filter((event) => (
    ['goal', 'own_goal', 'penalty_goal'].includes(event.type)
  ));
  const cards = (match.officialEvents || []).filter((event) => (
    ['yellow_card', 'second_yellow', 'red_card'].includes(event.type)
  ));
  return (
    <div className={styles.matchDetail}>
      <Link className={styles.backLink} to={`/torneos/torneo/${tournamentId}/partidos?categoria=${categoryId}`}>
        <ArrowLeft size={16} /> Volver a Partidos
      </Link>
      <section className={styles.matchDetailHero}>
        <span>{match.round?.name} · {match.phaseName}</span>
        <div className={styles.detailScoreboard}>
          <div><TeamMark team={match.home} /><strong>{match.home.name}</strong></div>
          <Score match={match} />
          <div><TeamMark team={match.away} /><strong>{match.away.name}</strong></div>
        </div>
        <p><CalendarDays size={16} /> {formatDate(match.scheduledAt)} {match.venue?.name ? `· ${match.venue.name}` : ''}</p>
      </section>
      {match.myContext && (
        <section className={styles.myMatchContext}>
          <UserRound size={20} />
          <span>
            <strong>Tu partido</strong>
            <small>
              Disponibilidad: {AVAILABILITY_LABELS[match.myContext.availability] || 'Sin respuesta'}
              {match.myContext.callup?.status === 'called_up'
                ? ` · ${match.myContext.callup.lineupStatus === 'starter' ? 'Titular' : 'Suplente'}`
                : ' · Sin convocatoria publicada'}
            </small>
          </span>
        </section>
      )}
      <div className={styles.matchDetailGrid}>
        <section className={styles.featurePanel}>
          <div className={styles.panelHeading}><span>Acta oficial</span><h2>Goles</h2></div>
          {goals.length ? goals.map((event) => (
            <article className={styles.eventRow} key={event.id}>
              <Goal size={17} /><span><strong>{event.playerName || 'Autor no identificado'}</strong><small>{event.minute ?? '—'}’</small></span>
            </article>
          )) : <p className={styles.panelEmpty}>Sin goles oficiales.</p>}
        </section>
        <section className={styles.featurePanel}>
          <div className={styles.panelHeading}><span>Disciplina publicable</span><h2>Tarjetas</h2></div>
          {cards.length ? cards.map((event) => (
            <article className={styles.eventRow} key={event.id}>
              <span className={event.type === 'yellow_card' ? styles.yellowCard : styles.redCard} />
              <span><strong>{event.playerName || 'Jugador'}</strong><small>{event.minute ?? '—'}’</small></span>
            </article>
          )) : <p className={styles.panelEmpty}>Sin tarjetas oficiales.</p>}
        </section>
      </div>
    </div>
  );
}

export default function TournamentHubPage({ defaultSection = 'resumen', matchMode = false }) {
  const { tournamentId, matchId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get('categoria');
  const { service } = useTorneosWorkspace();
  const hubRequestRef = useRef(0);
  const resourceRequestRef = useRef(0);
  const categoryRequestRef = useRef(0);
  const scopeGenerationRef = useRef(0);
  const [hubState, setHubState] = useState({
    status: 'loading',
    data: null,
    error: '',
  });
  const [resourceState, setResourceState] = useState({
    status: 'idle',
    data: null,
    error: '',
  });
  const [phaseId, setPhaseId] = useState(null);
  const [groupId, setGroupId] = useState(null);
  const [busyMatchId, setBusyMatchId] = useState(null);
  const section = VALID_SECTIONS.has(defaultSection) ? defaultSection : 'resumen';

  const loadHub = useCallback(async () => {
    scopeGenerationRef.current += 1;
    const requestId = hubRequestRef.current + 1;
    hubRequestRef.current = requestId;
    resourceRequestRef.current += 1;
    setHubState({ status: 'loading', data: null, error: '' });
    setResourceState({ status: 'idle', data: null, error: '' });
    try {
      const data = await service.loadParticipantHub({
        tournamentId,
        categoryId: requestedCategory || null,
      });
      if (hubRequestRef.current !== requestId) return;
      setHubState({ status: 'ready', data, error: '' });
      setPhaseId(data?.competition?.phaseId || data?.competition?.phases?.[0]?.id || null);
      setGroupId(data?.competition?.groupId || null);
      if (!requestedCategory && data?.activeCategoryId) {
        setSearchParams({ categoria: data.activeCategoryId }, { replace: true });
      }
    } catch (error) {
      if (hubRequestRef.current !== requestId) return;
      setHubState({
        status: 'error',
        data: null,
        error: error?.message || 'No pudimos cargar el torneo.',
      });
    }
  }, [requestedCategory, service, setSearchParams, tournamentId]);

  useEffect(() => {
    loadHub();
    return () => {
      hubRequestRef.current += 1;
      resourceRequestRef.current += 1;
      categoryRequestRef.current += 1;
      scopeGenerationRef.current += 1;
    };
  }, [loadHub]);

  const loadResource = useCallback(async () => {
    const hub = hubState.data;
    if (!hub || !hub.activeCategoryId) return;
    const requestId = resourceRequestRef.current + 1;
    resourceRequestRef.current = requestId;
    setResourceState({ status: 'loading', data: null, error: '' });
    try {
      let data;
      if (matchMode && matchId) {
        data = await service.loadParticipantMatch(matchId);
      } else if (section === 'partidos') {
        data = await service.loadPublishedMatches({
          tournamentId,
          categoryId: hub.activeCategoryId,
          view: 'all',
          limit: 30,
        });
      } else if (section === 'equipos') {
        data = await service.loadPublishedTeams({
          tournamentId,
          categoryId: hub.activeCategoryId,
          limit: 32,
        });
      } else if (['tabla', 'estadisticas', 'disciplina'].includes(section)) {
        if (!phaseId) {
          data = section === 'tabla'
            ? { revision: null, standings: [] }
            : { players: [], teams: [], discipline: [] };
        } else {
          const scope = {
            tournamentId,
            categoryId: hub.activeCategoryId,
            phaseId,
            groupId,
          };
          data = section === 'tabla'
            ? await service.loadPublishedStandings(scope)
            : await service.loadPublishedStatistics(scope);
        }
      } else {
        data = null;
      }
      if (resourceRequestRef.current !== requestId) return;
      setResourceState({ status: 'ready', data, error: '' });
    } catch (error) {
      if (resourceRequestRef.current !== requestId) return;
      setResourceState({
        status: 'error',
        data: null,
        error: error?.message || 'No pudimos cargar esta sección.',
      });
    }
  }, [
    groupId,
    hubState.data,
    matchId,
    matchMode,
    phaseId,
    section,
    service,
    tournamentId,
  ]);

  useEffect(() => {
    if (hubState.status !== 'ready') return;
    if (section === 'resumen' && !matchMode) return;
    loadResource();
  }, [hubState.status, loadResource, matchMode, section]);

  const respond = async (match, response) => {
    if (busyMatchId) return;
    const scopeGeneration = scopeGenerationRef.current;
    setBusyMatchId(match.matchId);
    try {
      await service.respondMatchAvailability({ matchId: match.matchId, response });
      if (scopeGenerationRef.current !== scopeGeneration) return;
      await loadHub();
    } finally {
      setBusyMatchId(null);
    }
  };

  const changeCategory = async (categoryId) => {
    if (!categoryId || categoryId === hubState.data?.activeCategoryId) return;
    const categoryRequestId = categoryRequestRef.current + 1;
    categoryRequestRef.current = categoryRequestId;
    scopeGenerationRef.current += 1;
    hubRequestRef.current += 1;
    resourceRequestRef.current += 1;
    setBusyMatchId(null);
    setHubState({ status: 'loading', data: null, error: '' });
    setResourceState({ status: 'idle', data: null, error: '' });
    try {
      await service.setHubCategory({ tournamentId, categoryId });
      if (categoryRequestRef.current !== categoryRequestId) return;
      setSearchParams({ categoria: categoryId });
    } catch (error) {
      if (categoryRequestRef.current !== categoryRequestId) return;
      setHubState({
        status: 'error',
        data: null,
        error: error?.message || 'No pudimos cambiar de categoría.',
      });
    }
  };

  if (!matchMode && !VALID_SECTIONS.has(section)) {
    return <Navigate to={`/torneos/torneo/${tournamentId}?categoria=${requestedCategory || ''}`} replace />;
  }
  if (hubState.status === 'loading') return <HubSkeleton />;
  if (hubState.status === 'error') {
    return (
      <HubState
        icon={AlertTriangle}
        title={typeof navigator !== 'undefined' && !navigator.onLine ? 'Estás sin conexión' : 'No pudimos abrir este torneo'}
        copy={hubState.error}
        action={<button type="button" onClick={loadHub}><RefreshCw size={16} /> Reintentar</button>}
      />
    );
  }

  const hub = hubState.data;
  const categoryId = hub.activeCategoryId;
  const myPlayerId = hub.myTeam?.roster?.find((player) => player.isMe)?.id || null;
  const navQuery = `?categoria=${categoryId}`;
  const resourceLoading = resourceState.status === 'loading';

  return (
    <div
      className={styles.hubPage}
      style={{
        '--hub-accent': hub.myTeam?.primaryColor || '#8b67ff',
        '--hub-accent-secondary': hub.myTeam?.secondaryColor || '#4de2a7',
      }}
    >
      <header className={styles.tournamentHero}>
        <div className={styles.tournamentIdentity}>
          <span className={styles.tournamentMonogram} aria-hidden="true">
            {hub.tournament.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <span className={styles.hubKicker}>{hub.tournament.seasonName} · {hub.tournament.organizationName}</span>
            <h1>{hub.tournament.name}</h1>
            <p>{hub.tournament.description || 'Competencia oficial dentro de Arma2.'}</p>
          </div>
        </div>
        <div className={styles.tournamentHeroActions}>
          <span className={styles.stateChip} data-state={hub.tournament.status}>
            {STATUS_LABELS[hub.tournament.status] || hub.tournament.status}
          </span>
          {hub.categories.length > 1 && (
            <label className={styles.categorySelect}>
              <span>Categoría</span>
              <select value={categoryId} onChange={(event) => changeCategory(event.target.value)}>
                {hub.categories.map((category) => (
                  <option value={category.id} key={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
          )}
          {hub.audience.canManageTournament && !hub.tournament.readOnly && (
            <Link className={styles.manageLink} to={`/torneos/organizacion/${hub.tournament.organizationId}/inicio`}>
              Abrir gestor
            </Link>
          )}
        </div>
      </header>

      {!matchMode && (
        <nav className={styles.hubNav} aria-label="Secciones del torneo">
          {SECTIONS.map(([key, label, Icon]) => (
            <Link
              key={key}
              to={`${key === 'resumen'
                ? `/torneos/torneo/${tournamentId}`
                : `/torneos/torneo/${tournamentId}/${key}`}${navQuery}`}
              aria-current={section === key ? 'page' : undefined}
              className={section === key ? styles.hubNavActive : ''}
            >
              <Icon size={16} /> {label}
            </Link>
          ))}
        </nav>
      )}

      {hub.tournament.readOnly && (
        <div className={styles.readOnlyNotice}>
          <Shield size={17} />
          Torneo histórico: toda la experiencia permanece en modo lectura.
        </div>
      )}

      {!matchMode && ['tabla', 'estadisticas', 'disciplina'].includes(section) && (
        <ProjectionFilters
          hub={hub}
          phaseId={phaseId}
          setPhaseId={setPhaseId}
          groupId={groupId}
          setGroupId={setGroupId}
        />
      )}

      {resourceLoading && <HubSkeleton />}
      {resourceState.status === 'error' && (
        <HubState
          icon={AlertTriangle}
          title="No pudimos cargar esta sección"
          copy={resourceState.error}
          action={<button type="button" onClick={loadResource}><RefreshCw size={16} /> Reintentar</button>}
        />
      )}

      {!matchMode && section === 'resumen' && (
        <OverviewSection
          hub={hub}
          tournamentId={tournamentId}
          categoryId={categoryId}
          busyMatchId={busyMatchId}
          onRespond={respond}
        />
      )}
      {!matchMode && section === 'partidos' && resourceState.status === 'ready' && (
        resourceState.data?.items?.length ? (
          <div className={styles.matchGrid}>
            {resourceState.data.items.map((match) => (
              <MatchCard
                key={match.matchId}
                match={match}
                tournamentId={tournamentId}
                categoryId={categoryId}
                busy={busyMatchId === match.matchId}
                onRespond={respond}
                readOnly={hub.tournament.readOnly}
              />
            ))}
          </div>
        ) : <HubState icon={CalendarDays} title="Sin partidos publicados" copy="El fixture de esta categoría todavía no tiene cruces visibles." />
      )}
      {!matchMode && section === 'tabla' && resourceState.status === 'ready' && (
        <StandingsSection rows={resourceState.data?.standings || []} myTeamId={hub.myTeam?.id} />
      )}
      {!matchMode && section === 'estadisticas' && resourceState.status === 'ready' && (
        <StatisticsSection data={resourceState.data} myPlayerId={myPlayerId} />
      )}
      {!matchMode && section === 'equipos' && resourceState.status === 'ready' && (
        <TeamsSection payload={resourceState.data} />
      )}
      {!matchMode && section === 'disciplina' && resourceState.status === 'ready' && (
        <DisciplineSection data={resourceState.data} myPlayerId={myPlayerId} />
      )}
      {matchMode && resourceState.status === 'ready' && (
        <MatchDetail match={resourceState.data} tournamentId={tournamentId} categoryId={categoryId} />
      )}
    </div>
  );
}
