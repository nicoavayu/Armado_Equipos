import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  FileClock,
  Filter,
  Flag,
  Goal,
  History,
  LockKeyhole,
  MapPin,
  Plus,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Shirt,
  Undo2,
  UserCheck,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFixture } from '../context/TorneosFixtureContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { hasCapability, TOURNAMENT_CAPABILITIES } from '../domain/capabilities';
import {
  getCompetitionErrorContext,
  getLifecycleErrorMessage,
  getMatchResolutionPresentation,
} from '../domain/competitionLifecycle';
import { tournamentResourceSurface, tournamentSurface } from '../routing/legacyRoutes';
import {
  RESOURCE_SCOPE_MESSAGE,
  resourceMatchesCanonicalScope,
} from '../domain/routeResourceScope';
import { describeMatchOutcomeGap } from '../domain/matchOutcome';
import { describeEarlyOpen, isEarlyOpenReasonValid } from '../domain/matchSchedule';
import {
  getMatchPeriodLabel,
  MATCH_EVENT_PERIOD_OPTIONS,
  SUSPENSION_PERIOD_OPTIONS,
} from '../domain/matchPeriods';
import CompetitionSelector from './CompetitionSelector';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './MatchOperations.module.css';

//
// Los links del partido salen de los builders, uno por superficie.
//
// Concatenar sobre la ruta del listado no alcanzaba: con `?categoria=` el
// listado ya termina en query, así que `${base}/${match.id}` producía
// `…/partidos?categoria=X/<id>`. El id tiene que entrar como segmento y la
// query rearmarse después, que es exactamente lo que hace el builder.
//
function useMatchRoutes(organizationId) {
  const { isTournamentRoute, routeTournamentId, activeTournament } = useTorneosCompetition();
  const { categoryId } = useTorneosFixture();
  const tournamentId = isTournamentRoute
    ? routeTournamentId
    : (activeTournament?.id || null);
  const options = { categoryId };
  const build = (name) => (matchId) => tournamentResourceSurface(
    name,
    organizationId,
    tournamentId,
    matchId,
    options,
  );
  return {
    list: tournamentSurface('tournamentMatches', organizationId, tournamentId, options),
    detail: build('tournamentMatch'),
    squads: build('tournamentMatchSquads'),
    report: build('tournamentMatchReport'),
    review: build('tournamentMatchReview'),
    history: build('tournamentMatchHistory'),
  };
}

const STATUS_LABELS = {
  draft: 'Borrador',
  submitted: 'Presentada',
  under_review: 'En revisión',
  validated: 'Validada',
  official: 'Oficial',
  correction_requested: 'Corrección solicitada',
  superseded: 'Reemplazada',
  voided: 'Anulada',
  scheduled: 'Programado',
  ready: 'Listo',
  postponed: 'Postergado',
  cancelled: 'Cancelado',
  suspended: 'Suspendido',
  abandoned: 'Abandonado',
  administrative: 'Administrativo',
  // Estados de `tournament_match_reviews`: la píldora del historial de
  // revisiones los mostraba crudos (`open`, `approved`).
  open: 'Abierta',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

const EVENT_LABELS = {
  goal: 'Gol',
  own_goal: 'Gol en contra',
  assist: 'Asistencia',
  yellow_card: 'Amarilla',
  second_yellow: 'Segunda amarilla',
  red_card: 'Roja',
  substitution_in: 'Ingreso',
  substitution_out: 'Salida',
  penalty_goal: 'Gol de penal',
  penalty_missed: 'Penal errado',
  incident: 'Incidencia',
  no_show: 'Ausencia',
  suspension: 'Suspensión',
  // Eventos de ciclo de vida del partido: no los carga nadie a mano, pero
  // aparecen en el timeline y sin etiqueta salían como `second_half_started`.
  match_started: 'Comienzo del partido',
  halftime: 'Entretiempo',
  second_half_started: 'Comienzo del segundo tiempo',
  match_ended: 'Fin del partido',
  resumption_future: 'Reanudación',
};

const REVIEW_TYPE_LABELS = {
  validation: 'Validación',
  correction: 'Corrección',
  dispute_future: 'Impugnación',
  administrative_resolution: 'Resolución administrativa',
};

const OUTCOME_OPTIONS = [
  ['played', 'Jugado'],
  ['postponed_before_start', 'Postergado antes de comenzar'],
  ['suspended', 'Suspendido'],
  ['abandoned', 'Abandonado'],
  ['home_no_show', 'Local ausente'],
  ['away_no_show', 'Visitante ausente'],
  ['double_no_show', 'Ambos ausentes'],
  ['walkover_home', 'Walkover local'],
  ['walkover_away', 'Walkover visitante'],
  ['administrative_result', 'Resultado administrativo'],
  ['cancelled', 'Cancelado'],
  ['not_played', 'No jugado'],
];

function dateParts(value) {
  if (!value) return ['A confirmar', 'Sin hora'];
  const date = new Date(value);
  return [
    new Intl.DateTimeFormat('es-AR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    }).format(date),
    new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date),
  ];
}

function StatusPill({ status, label }) {
  return (
    <span className={styles.statusPill} data-status={status}>
      <CircleDot size={12} />
      {label || STATUS_LABELS[status] || (status ? 'Sin estado' : 'Sin acta')}
    </span>
  );
}

/**
 * Abrir el acta. Cuando todavía falta mucho para el horario del partido, el
 * backend pide dejar registrado por qué se adelanta: el motivo se pide acá,
 * antes de intentar, en vez de devolver un error sin salida.
 */
function OpenReportAction({ match, busy, run }) {
  const [reason, setReason] = useState('');
  const earlyOpen = describeEarlyOpen(match);
  const blocked = Boolean(earlyOpen) && !isEarlyOpenReasonValid(reason);
  return (
    <div className={styles.openReport}>
      {earlyOpen && (
        <div className={styles.inlineHint}>
          <strong>{earlyOpen.title}</strong>
          <span>{earlyOpen.description}</span>
        </div>
      )}
      {earlyOpen && (
        <label>
          <span>{earlyOpen.label}</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={earlyOpen.placeholder}
            rows="3"
          />
        </label>
      )}
      <button
        type="button"
        disabled={busy || blocked}
        onClick={() => run('open', earlyOpen ? { overrideReason: reason.trim() } : {})}
      >
        <Plus size={17} /> Abrir acta
      </button>
    </div>
  );
}

function MatchScore({ match, operation }) {
  const score = operation?.score;
  return (
    <div className={styles.scoreboard} aria-label="Resultado">
      <div>
        <small>LOCAL</small>
        <strong>{match.homeName || operation?.operation?.home_team_snapshot?.name || 'Local'}</strong>
      </div>
      <span>
        <b>{score?.home_score ?? match.homeScore ?? '—'}</b>
        <em>:</em>
        <b>{score?.away_score ?? match.awayScore ?? '—'}</b>
      </span>
      <div>
        <small>VISITANTE</small>
        <strong>{match.awayName || operation?.operation?.away_team_snapshot?.name || 'Visitante'}</strong>
      </div>
    </div>
  );
}

function MatchList({
  matches,
  organization,
  filters,
  setFilters,
}) {
  const matchRoutes = useMatchRoutes(organization.id);
  const filtered = useMemo(() => matches.filter((match) => {
    const search = filters.search.trim().toLowerCase();
    if (search && !`${match.homeName} ${match.awayName}`.toLowerCase().includes(search)) {
      return false;
    }
    if (filters.status === 'without_squad'
      && match.homeSquadStatus && match.awaySquadStatus) return false;
    if (filters.status === 'without_report' && match.operationId) return false;
    if (filters.status === 'validation'
      && !['submitted', 'under_review', 'validated'].includes(match.operationStatus)) return false;
    if (filters.status === 'official' && match.operationStatus !== 'official') return false;
    if (filters.status === 'correction' && !match.hasOpenCorrection) return false;
    if (filters.status !== 'all'
      && !['without_squad', 'without_report', 'validation', 'official', 'correction'].includes(filters.status)
      && match.matchStatus !== filters.status
      && match.planningStatus !== filters.status) return false;
    return true;
  }), [filters, matches]);

  return (
    <>
      <section className={styles.metrics} aria-label="Resumen operativo">
        <article><span>Partidos</span><strong>{matches.length}</strong><small>fixture vigente</small></article>
        <article><span>Sin convocatoria</span><strong>{matches.filter((match) => !match.homeSquadStatus || !match.awaySquadStatus).length}</strong><small>uno o ambos equipos</small></article>
        <article><span>Por validar</span><strong>{matches.filter((match) => ['submitted', 'under_review', 'validated'].includes(match.operationStatus)).length}</strong><small>requieren control</small></article>
        <article><span>Oficiales</span><strong>{matches.filter((match) => match.operationStatus === 'official').length}</strong><small>fuente autoritativa</small></article>
      </section>
      <section className={styles.filterBar} aria-label="Filtros de partidos">
        <label className={styles.searchField}>
          <Search size={17} />
          <span className={styles.srOnly}>Buscar equipo</span>
          <input
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Buscar equipo"
          />
        </label>
        <label>
          <Filter size={17} />
          <span className={styles.srOnly}>Estado</span>
          <select
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
          >
            <option value="all">Todos los estados</option>
            <option value="without_squad">Sin convocatoria</option>
            <option value="without_report">Sin acta</option>
            <option value="validation">Pendiente de validación</option>
            <option value="official">Oficial</option>
            <option value="suspended">Suspendido</option>
            <option value="administrative">Ausente / administrativo</option>
            <option value="correction">Con corrección</option>
          </select>
        </label>
      </section>
      {!filtered.length ? (
        <section className={styles.emptyState}>
          <CalendarClock size={30} />
          <h2>No hay partidos para este filtro</h2>
          <p>La operación aparece cuando el fixture publicado tiene ambos equipos resueltos.</p>
        </section>
      ) : (
        <div className={styles.matchList}>
          {filtered.map((match) => {
            const [day, time] = dateParts(match.scheduledAt);
            const resolution = getMatchResolutionPresentation({
              status: match.planningStatus,
              cancellationReasonCode: match.cancellationReasonCode,
              cancellationReasonText: match.cancellationReasonText,
            });
            return (
              <article key={match.id} className={styles.matchRow}>
                <div className={styles.dateBlock}><span>{day}</span><strong>{time}</strong></div>
                <div className={styles.teamsBlock}>
                  <strong>{match.homeName}</strong>
                  <span>vs.</span>
                  <strong>{match.awayName}</strong>
                  {resolution ? (
                    <small>{resolution.description}</small>
                  ) : (
                    <small><MapPin size={13} /> {[match.venue, match.court].filter(Boolean).join(' · ') || 'Sede a confirmar'}</small>
                  )}
                </div>
                <div className={styles.squadSignals}>
                  <span data-ready={Boolean(match.homeSquadStatus)}>
                    L {match.homeSquadStatus ? '✓' : '—'}
                  </span>
                  <span data-ready={Boolean(match.awaySquadStatus)}>
                    V {match.awaySquadStatus ? '✓' : '—'}
                  </span>
                </div>
                <StatusPill
                  status={match.operationStatus || match.planningStatus}
                  label={resolution?.code === 'withdrawal_bye' ? resolution.label : null}
                />
                <div className={styles.rowActions}>
                  <Link to={matchRoutes.detail(match.id)}>
                    {resolution ? 'Ver' : 'Operar'}
                    <ChevronRight size={16} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

export function SquadEditor({
  context,
  readOnly,
  busy,
  onSave,
  onSubmit,
}) {
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    setPlayers((context?.players || []).map((player) => {
      const selection = player.selection || {};
      return {
        ...player,
        callupStatus: selection.callup_status || 'not_called_up',
        lineupStatus: selection.lineup_status || 'not_in_match_squad',
        isCaptain: Boolean(selection.is_captain),
        isGoalkeeper: Boolean(selection.is_goalkeeper ?? player.isGoalkeeper),
        attendanceStatus: selection.attendance_status || 'unknown',
        availabilityStatus: player.availability || 'no_response',
      };
    }));
  }, [context]);

  const selected = players.filter((player) => player.callupStatus === 'called_up');
  const starters = selected.filter((player) => player.lineupStatus === 'starter');
  const visible = players.filter((player) => (
    player.displayName.toLowerCase().includes(query.trim().toLowerCase())
  ));

  const patch = (id, values) => {
    setPlayers((current) => current.map((player) => (
      player.rosterPlayerId === id ? { ...player, ...values } : player
    )));
  };

  const toggleCallup = (player) => {
    if (player.callupStatus === 'called_up') {
      patch(player.rosterPlayerId, {
        callupStatus: 'not_called_up',
        lineupStatus: 'not_in_match_squad',
        isCaptain: false,
      });
    } else {
      patch(player.rosterPlayerId, {
        callupStatus: 'called_up',
        lineupStatus: 'substitute',
      });
    }
  };

  const serialize = () => players.map((player) => ({
    rosterPlayerId: player.rosterPlayerId,
    availabilityStatus: player.availabilityStatus,
    callupStatus: player.callupStatus,
    lineupStatus: player.lineupStatus,
    isGoalkeeper: player.isGoalkeeper,
    isCaptain: player.isCaptain,
    attendanceStatus: player.attendanceStatus,
  }));

  return (
    <section className={styles.squadPanel}>
      <div className={styles.panelHeading}>
        <div>
          <span>Plantel habilitado</span>
          <h2>{context?.teamName || 'Convocatoria'}</h2>
        </div>
        <StatusPill status={context?.squad?.status || 'draft'} />
      </div>
      <div className={styles.squadSummary}>
        <span><b>{selected.length}</b> convocados</span>
        <span><b>{starters.length}</b> / {context?.teamSize || 11} titulares</span>
        <span><b>{selected.filter((player) => player.isGoalkeeper).length}</b> arqueros</span>
      </div>
      <label className={styles.rosterSearch}>
        <Search size={17} />
        <span className={styles.srOnly}>Filtrar plantel</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar dentro del plantel" />
      </label>
      <div className={styles.rosterList}>
        {visible.map((player) => {
          const called = player.callupStatus === 'called_up';
          return (
            <article key={player.rosterPlayerId} className={called ? styles.rosterPlayerSelected : ''}>
              <button
                type="button"
                className={styles.playerIdentity}
                disabled={readOnly}
                onClick={() => toggleCallup(player)}
                aria-pressed={called}
              >
                <span className={styles.playerAvatar}>
                  {player.avatarUrl ? <img src={player.avatarUrl} alt="" /> : player.displayName.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{player.displayName}</strong>
                  <small>
                    #{player.shirtNumber ?? '—'} · {player.position || 'Sin posición'} · {
                      player.availability === 'available' ? 'Voy'
                        : player.availability === 'unavailable' ? 'No voy'
                          : player.availability === 'maybe' ? 'En duda' : 'Sin respuesta'
                    }
                  </small>
                </span>
                <em>{called ? 'Convocado' : 'No convocado'}</em>
              </button>
              {called && (
                <div className={styles.playerControls}>
                  <select
                    aria-label={`Alineación de ${player.displayName}`}
                    disabled={readOnly}
                    value={player.lineupStatus}
                    onChange={(event) => patch(player.rosterPlayerId, { lineupStatus: event.target.value })}
                  >
                    <option value="starter">Titular</option>
                    <option value="substitute">Suplente</option>
                  </select>
                  <select
                    aria-label={`Presencia de ${player.displayName}`}
                    disabled={readOnly}
                    value={player.attendanceStatus}
                    onChange={(event) => patch(player.rosterPlayerId, {
                      attendanceStatus: event.target.value,
                    })}
                  >
                    <option value="unknown">Presencia sin confirmar</option>
                    <option value="present">Presente</option>
                    <option value="late">Llegó tarde</option>
                    <option value="absent">Ausente</option>
                    <option value="excused">Ausencia justificada</option>
                  </select>
                  <button
                    type="button"
                    disabled
                    aria-pressed={player.isGoalkeeper}
                    title="La condición de arquero proviene del plantel habilitado"
                  >
                    ARQ
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    aria-pressed={player.isCaptain}
                    onClick={() => setPlayers((current) => current.map((candidate) => ({
                      ...candidate,
                      isCaptain: candidate.rosterPlayerId === player.rosterPlayerId,
                    })))}
                  >
                    CAP
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {!readOnly && (
        <div className={styles.stickyActions}>
          <button type="button" disabled={busy} onClick={() => onSave(serialize())}>
            <Save size={17} /> Guardar borrador
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || starters.length !== Number(context?.teamSize || 11)
              || selected.filter((player) => player.isCaptain).length !== 1}
            onClick={async () => {
              await onSave(serialize());
              await onSubmit();
            }}
          >
            <LockKeyhole size={17} /> Presentar
          </button>
        </div>
      )}
    </section>
  );
}

function ReportEditor({
  match,
  context,
  canManage,
  busy,
  run,
}) {
  const operation = context.operation;
  const [score, setScore] = useState({
    homeScore: context.score?.home_score ?? 0,
    awayScore: context.score?.away_score ?? 0,
    scoreType: context.score?.score_type || 'played',
    homePenalties: context.score?.home_penalties ?? '',
    awayPenalties: context.score?.away_penalties ?? '',
  });
  const [outcome, setOutcome] = useState({
    outcomeType: context.outcome?.outcome_type || 'played',
    reasonText: context.outcome?.reason_text || '',
    suspensionMinute: context.outcome?.suspension_minute ?? '',
    suspensionPeriod: context.outcome?.suspension_period || 'second_half',
    countsForStandings: context.outcome?.counts_for_standings ?? true,
    countsForPlayerStats: context.outcome?.counts_for_player_stats ?? true,
    requiresResolution: context.outcome?.requires_resolution ?? false,
    eventsRemainValid: context.outcome?.events_remain_valid ?? true,
  });
  const outcomeGap = describeMatchOutcomeGap(outcome);
  const [event, setEvent] = useState({
    eventType: 'goal',
    teamEntryId: operation.home_team_entry_id,
    rosterPlayerId: '',
    minute: '',
    period: 'first_half',
    unidentifiedPlayerReason: '',
    relatedEventId: '',
    relatedRosterPlayerId: '',
  });
  const [voidReason, setVoidReason] = useState('');
  const readOnly = !canManage || operation.status !== 'draft';
  const players = context.players.filter((player) => (
    event.eventType === 'own_goal'
      ? player.team_entry_id !== event.teamEntryId
      : player.team_entry_id === event.teamEntryId
  ));
  const relatedGoals = context.events.filter((item) => (
    !item.voided_at
      && ['goal', 'penalty_goal'].includes(item.event_type)
      && !(item.event_type === 'penalty_goal' && item.period === 'penalties')
      && item.team_entry_id === event.teamEntryId
      && item.roster_player_id
      && item.roster_player_id !== event.rosterPlayerId
  ));
  const relatedSubstitutionOuts = context.events.filter((item) => (
    !item.voided_at
      && item.event_type === 'substitution_out'
      && item.team_entry_id === event.teamEntryId
      && !context.events.some((candidate) => (
        !candidate.voided_at
          && candidate.event_type === 'substitution_in'
          && candidate.related_event_id === item.id
      ))
  ));
  const eventRequiresRelation = ['assist', 'substitution_in'].includes(event.eventType);

  return (
    <div className={styles.reportGrid}>
      <section className={styles.reportSection}>
        <div className={styles.panelHeading}>
          <div><span>Resolución explícita</span><h2>Estado del partido</h2></div>
          <ShieldAlert size={21} />
        </div>
        <label>
          <span>Qué ocurrió</span>
          <select
            disabled={readOnly}
            value={outcome.outcomeType}
            onChange={(e) => setOutcome((current) => ({ ...current, outcomeType: e.target.value }))}
          >
            {OUTCOME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {outcome.outcomeType === 'suspended' && (
          <div className={styles.twoColumns}>
            <label><span>Minuto</span><input disabled={readOnly} type="number" min="0" max="240" value={outcome.suspensionMinute} onChange={(e) => setOutcome((c) => ({ ...c, suspensionMinute: e.target.value }))} /></label>
            <label><span>Período</span><select disabled={readOnly} value={outcome.suspensionPeriod} onChange={(e) => setOutcome((c) => ({ ...c, suspensionPeriod: e.target.value }))}>{SUSPENSION_PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
        )}
        <label>
          <span>Motivo u observación</span>
          <textarea disabled={readOnly} value={outcome.reasonText} onChange={(e) => setOutcome((current) => ({ ...current, reasonText: e.target.value }))} placeholder="Lluvia, ausencia, incidente o decisión organizativa…" />
        </label>
        <div className={styles.checkGrid}>
          <label><input disabled={readOnly} type="checkbox" checked={outcome.countsForStandings} onChange={(e) => setOutcome((c) => ({ ...c, countsForStandings: e.target.checked }))} /> Cuenta para tabla</label>
          <label><input disabled={readOnly} type="checkbox" checked={outcome.countsForPlayerStats} onChange={(e) => setOutcome((c) => ({ ...c, countsForPlayerStats: e.target.checked }))} /> Cuenta estadísticas</label>
          <label><input disabled={readOnly} type="checkbox" checked={outcome.requiresResolution} onChange={(e) => setOutcome((c) => ({ ...c, requiresResolution: e.target.checked }))} /> Requiere resolución</label>
        </div>
        {!readOnly && outcomeGap && <p className={styles.inlineHint}>{outcomeGap}</p>}
        {!readOnly && <button type="button" disabled={busy || Boolean(outcomeGap)} onClick={() => run('outcome', outcome)}><Save size={17} /> Guardar estado</button>}
      </section>

      <section className={styles.reportSection}>
        <div className={styles.panelHeading}>
          <div><span>Marcador separado del fixture</span><h2>Resultado</h2></div>
          <Goal size={22} />
        </div>
        <div className={styles.scoreInputs}>
          <label><span>{match.homeName}</span><input disabled={readOnly} type="number" min="0" max="99" value={score.homeScore} onChange={(e) => setScore((c) => ({ ...c, homeScore: e.target.value }))} /></label>
          <em>—</em>
          <label><span>{match.awayName}</span><input disabled={readOnly} type="number" min="0" max="99" value={score.awayScore} onChange={(e) => setScore((c) => ({ ...c, awayScore: e.target.value }))} /></label>
        </div>
        <label>
          <span>Tipo de resultado</span>
          <select disabled={readOnly} value={score.scoreType} onChange={(e) => setScore((c) => ({ ...c, scoreType: e.target.value }))}>
            <option value="played">Jugado</option>
            <option value="administrative">Administrativo</option>
            <option value="walkover">Walkover</option>
            <option value="series_leg">Partido de serie</option>
          </select>
        </label>
        <div className={styles.twoColumns}>
          <label><span>Penales local (opcional)</span><input disabled={readOnly} type="number" min="0" max="99" value={score.homePenalties} onChange={(e) => setScore((c) => ({ ...c, homePenalties: e.target.value }))} /></label>
          <label><span>Penales visitante (opcional)</span><input disabled={readOnly} type="number" min="0" max="99" value={score.awayPenalties} onChange={(e) => setScore((c) => ({ ...c, awayPenalties: e.target.value }))} /></label>
        </div>
        <p className={styles.helperCopy}>Un walkover no crea goles individuales ni asume 3–0.</p>
        {!readOnly && <button type="button" disabled={busy} onClick={() => run('score', {
          ...score,
          homeScore: Number(score.homeScore),
          awayScore: Number(score.awayScore),
          homePenalties: score.homePenalties === '' ? null : Number(score.homePenalties),
          awayPenalties: score.awayPenalties === '' ? null : Number(score.awayPenalties),
        })}><Save size={17} /> Guardar resultado</button>}
      </section>

      <section className={`${styles.reportSection} ${styles.eventsSection}`}>
        <div className={styles.panelHeading}>
          <div><span>Secuencia auditable</span><h2>Eventos</h2></div>
          <Flag size={22} />
        </div>
        {!readOnly && (
          <div className={styles.eventComposer}>
            <label><span>Evento</span><select value={event.eventType} onChange={(e) => setEvent((c) => ({
              ...c,
              eventType: e.target.value,
              relatedEventId: '',
              relatedRosterPlayerId: '',
            }))}>{Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Equipo</span><select value={event.teamEntryId} onChange={(e) => setEvent((c) => ({
              ...c,
              teamEntryId: e.target.value,
              rosterPlayerId: '',
              relatedEventId: '',
              relatedRosterPlayerId: '',
            }))}><option value={operation.home_team_entry_id}>{match.homeName}</option><option value={operation.away_team_entry_id}>{match.awayName}</option></select></label>
            <label><span>Jugador</span><select value={event.rosterPlayerId} onChange={(e) => setEvent((c) => ({ ...c, rosterPlayerId: e.target.value }))}><option value="">Sin identificar / equipo</option>{players.map((player) => <option key={player.roster_player_id} value={player.roster_player_id}>{player.display_name_snapshot}</option>)}</select></label>
            <label><span>Minuto</span><input type="number" min="0" max="240" value={event.minute} onChange={(e) => setEvent((c) => ({ ...c, minute: e.target.value }))} /></label>
            <label><span>Período</span><select value={event.period} onChange={(e) => setEvent((c) => ({ ...c, period: e.target.value }))}>{MATCH_EVENT_PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {event.eventType === 'assist' && (
              <label className={styles.fullField}>
                <span>Gol asistido</span>
                <select value={event.relatedEventId} onChange={(e) => setEvent((c) => ({
                  ...c,
                  relatedEventId: e.target.value,
                }))}>
                  <option value="">Seleccioná un gol vigente</option>
                  {relatedGoals.map((goalEvent) => (
                    <option key={goalEvent.id} value={goalEvent.id}>
                      {goalEvent.minute ?? '·'}′ · {context.players.find(
                        (player) => player.roster_player_id === goalEvent.roster_player_id,
                      )?.display_name_snapshot || 'Gol identificado'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {event.eventType === 'substitution_in' && (
              <label className={styles.fullField}>
                <span>Salida vinculada</span>
                <select value={event.relatedEventId} onChange={(e) => {
                  const related = relatedSubstitutionOuts.find(
                    (candidate) => candidate.id === e.target.value,
                  );
                  setEvent((c) => ({
                    ...c,
                    relatedEventId: e.target.value,
                    relatedRosterPlayerId: related?.roster_player_id || '',
                    minute: related?.minute ?? c.minute,
                    period: related?.period || c.period,
                  }));
                }}>
                  <option value="">Primero registrá y elegí la salida</option>
                  {relatedSubstitutionOuts.map((outEvent) => (
                    <option key={outEvent.id} value={outEvent.id}>
                      {outEvent.minute ?? '·'}′ · {context.players.find(
                        (player) => player.roster_player_id === outEvent.roster_player_id,
                      )?.display_name_snapshot || 'Jugador saliente'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!event.rosterPlayerId && ['goal', 'own_goal'].includes(event.eventType) && <label className={styles.fullField}><span>Motivo del autor desconocido</span><input value={event.unidentifiedPlayerReason} onChange={(e) => setEvent((c) => ({ ...c, unidentifiedPlayerReason: e.target.value }))} /></label>}
            <button
              type="button"
              disabled={busy || (eventRequiresRelation && !event.relatedEventId)}
              onClick={() => run('event', {
                ...event,
                rosterPlayerId: event.rosterPlayerId || null,
                relatedEventId: event.relatedEventId || null,
                relatedRosterPlayerId: event.relatedRosterPlayerId || null,
                minute: event.minute === '' ? null : Number(event.minute),
              })}
            ><Plus size={17} /> Agregar evento</button>
          </div>
        )}
        <ol className={styles.eventTimeline}>
          {context.events.map((item) => (
            <li key={item.id} data-voided={Boolean(item.voided_at)}>
              <span>{item.minute ?? '·'}′</span>
              <div><strong>{EVENT_LABELS[item.event_type] || 'Evento del partido'}</strong><small>{context.players.find((player) => player.roster_player_id === item.roster_player_id)?.display_name_snapshot || 'Evento de equipo'} · {getMatchPeriodLabel(item.period)}</small></div>
              {!readOnly && !item.voided_at && (
                <button type="button" aria-label="Anular evento" onClick={() => {
                  const reason = window.prompt('Motivo de anulación (queda auditado):', voidReason);
                  if (reason) {
                    setVoidReason(reason);
                    run('voidEvent', { eventId: item.id, reason });
                  }
                }}><Undo2 size={16} /></button>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function MatchOperationsPage({ mode = 'list' }) {
  const { matchId } = useParams();
  const { organization } = useOutletContext();
  const { service } = useTorneosWorkspace();
  const { activeTournament, status: competitionStatus } = useTorneosCompetition();
  const { categoryId, categories } = useTorneosFixture();
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: 'loading',
    matches: [],
    operation: null,
    squads: {},
    error: '',
    notice: '',
  });
  const [filters, setFilters] = useState({ search: '', status: 'all' });
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState('');

  const load = useCallback(async ({ notice = '' } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!activeTournament?.id) {
      setActiveTeamId(null);
      setState({ status: 'ready', matches: [], operation: null, squads: {}, error: '', notice });
      return;
    }
    setActiveTeamId(null);
    setState({
      status: 'loading',
      matches: [],
      operation: null,
      squads: {},
      error: '',
      notice,
    });
    try {
      const payload = await service.loadMatchOperations({
        organizationId: organization.id,
        tournamentId: activeTournament.id,
        categoryId,
      });
      const matches = payload?.matches || [];
      const match = matchId ? matches.find((candidate) => candidate.id === matchId) : null;
      let operation = null;
      let squads = {};
      if (match?.operationId) {
        operation = await service.loadMatchOperation({
          organizationId: organization.id,
          operationId: match.operationId,
        });
        // `get_tournament_match_operation_context(org, operationId)` no recibe
        // torneo: autoriza la lectura, pero no afirma que la operación sea del
        // torneo de esta URL. La operación sí trae `tournament_id`, así que la
        // pertenencia se comprueba acá en vez de asumirse.
        if (!resourceMatchesCanonicalScope(operation?.operation, {
          organizationId: organization.id,
          tournamentId: activeTournament.id,
        })) {
          throw new Error(RESOURCE_SCOPE_MESSAGE);
        }
      }
      if (match && mode === 'squads') {
        const contexts = await Promise.all([
          service.loadMatchSquad({
            organizationId: organization.id,
            matchId: match.id,
            teamEntryId: match.homeTeamEntryId,
          }),
          service.loadMatchSquad({
            organizationId: organization.id,
            matchId: match.id,
            teamEntryId: match.awayTeamEntryId,
          }),
        ]);
        squads = {
          [match.homeTeamEntryId]: contexts[0],
          [match.awayTeamEntryId]: contexts[1],
        };
      }
      if (requestRef.current !== requestId) return;
      setActiveTeamId(match?.homeTeamEntryId || null);
      setState({
        status: 'ready',
        matches,
        operation,
        squads,
        error: '',
        notice,
      });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        matches: [],
        operation: null,
        squads: {},
        error: error.message,
        notice: '',
      });
    }
  }, [
    activeTournament?.id,
    categoryId,
    matchId,
    mode,
    organization.id,
    service,
  ]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const match = matchId ? state.matches.find((candidate) => candidate.id === matchId) : null;
  const canOpen = hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_OPEN);
  const canManage = hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_UPDATE_DRAFT);
  const canReview = hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_REVIEW);
  const matchRoutes = useMatchRoutes(organization.id);

  const run = async (action, payload = {}) => {
    if (busy) return;
    if (action === 'official'
      && !window.confirm('¿Confirmás que esta versión será el resultado oficial e inmutable?')) return;
    if (action === 'outcome'
      && ['walkover_home', 'walkover_away'].includes(payload.outcomeType)
      && !window.confirm('¿Confirmás el walkover? La decisión y el motivo quedarán auditados.')) return;
    if (action === 'event'
      && payload.eventType === 'red_card'
      && !window.confirm('¿Confirmás la expulsión por roja directa?')) return;
    setBusy(true);
    try {
      const common = { organizationId: organization.id };
      if (action === 'open') await service.openMatchOperation({ ...common, matchId, ...payload });
      if (action === 'saveSquad') await service.saveMatchSquad({ ...common, matchId, teamEntryId: activeTeamId, players: payload });
      if (action === 'submitSquad') await service.submitMatchSquad({ ...common, matchId, teamEntryId: activeTeamId });
      const operationId = state.operation?.operation?.id;
      if (action === 'outcome') await service.setMatchOutcome({ ...common, operationId, outcome: payload });
      if (action === 'score') await service.setMatchScore({ ...common, operationId, score: payload });
      if (action === 'event') await service.addMatchEvent({ ...common, operationId, event: payload });
      if (action === 'voidEvent') await service.voidMatchEvent({ ...common, ...payload });
      if (action === 'submit') await service.submitMatchOperation({ ...common, operationId });
      if (action === 'review') await service.reviewMatchOperation({ ...common, operationId, ...payload });
      if (action === 'validate') await service.validateMatchOperation({ ...common, operationId });
      if (action === 'official') await service.makeMatchOfficial({ ...common, operationId });
      if (action === 'requestCorrection') await service.requestMatchCorrection({ ...common, operationId, reason: payload.reason });
      if (action === 'createCorrection') await service.createMatchCorrection({ ...common, operationId });
      await load({ notice: {
        open: 'Acta abierta con snapshots del partido.',
        saveSquad: 'Convocatoria guardada.',
        submitSquad: 'Convocatoria presentada.',
        outcome: 'Estado deportivo guardado.',
        score: 'Resultado guardado.',
        event: 'Evento agregado.',
        voidEvent: 'Evento anulado sin borrar historial.',
        submit: 'Acta presentada para revisión.',
        review: 'Revisión registrada.',
        validate: 'Acta validada por doble control.',
        official: 'El resultado ya es oficial.',
        requestCorrection: 'Corrección solicitada.',
        createCorrection: 'Nueva versión editable creada.',
      }[action] });
    } catch (error) {
      // Con la competencia cerrada el rechazo llega casi siempre como falta de
      // permisos, aunque el propietario tenga el rol: la causa real es el
      // estado. Se explica con lo que esta pantalla ya sabe.
      setState((current) => ({
        ...current,
        error: getLifecycleErrorMessage(
          error,
          error.message,
          getCompetitionErrorContext(organization, activeTournament),
        ),
        notice: '',
      }));
    } finally {
      setBusy(false);
    }
  };

  if (competitionStatus === 'loading' || state.status === 'loading') {
    return <WorkspaceLoading label="Cargando operación de partidos…" />;
  }
  if (state.status === 'error' && !state.matches.length) {
    return <WorkspaceError message={state.error} onRetry={() => load()} />;
  }

  if (matchId && !match) {
    return <WorkspaceError message="El partido no pertenece al fixture publicado vigente." />;
  }

  return (
    <div className={styles.page}>
      {mode === 'list' ? (
        <>
          <CompetitionSelector />
          <header className={styles.pageHeader}>
            <div>
              <span className={styles.kicker}>Control de jornada</span>
              <h1>Partidos</h1>
              <p>Convocatorias, actas, incidencias y resultados oficiales en una sola cola operativa.</p>
            </div>
            <div className={styles.categoryStamp}>
              <ShieldCheck size={18} />
              <span>{categories.find((category) => category.id === categoryId)?.name || 'Categoría'}</span>
            </div>
          </header>
          {!activeTournament ? (
            <section className={styles.emptyState}><ShieldCheck size={30} /><h2>Seleccioná un torneo</h2><p>Los partidos se leen únicamente desde su fixture publicado.</p></section>
          ) : (
            <MatchList
              matches={state.matches}
              organization={organization}
              filters={filters}
              setFilters={setFilters}
            />
          )}
        </>
      ) : (
        <>
          <Link className={styles.backLink} to={matchRoutes.list}><ArrowLeft size={16} /> Volver a Partidos</Link>
          <header className={styles.matchHeader}>
            <div>
              <span className={styles.kicker}>Partido #{match.matchNumber}</span>
              <h1>{match.homeName} <em>vs.</em> {match.awayName}</h1>
              <p>{dateParts(match.scheduledAt).join(' · ')} · {[match.venue, match.court].filter(Boolean).join(' · ') || 'Sede a confirmar'}</p>
            </div>
            <StatusPill status={state.operation?.operation?.status || match.planningStatus} />
          </header>
          <MatchScore match={match} operation={state.operation} />
          <nav className={styles.matchSubnav} aria-label="Secciones del partido">
            <Link to={matchRoutes.detail(match.id)}>Resumen</Link>
            <Link to={matchRoutes.squads(match.id)}>Convocatorias</Link>
            <Link to={matchRoutes.report(match.id)}>Acta</Link>
            <Link to={matchRoutes.review(match.id)}>Revisión</Link>
            <Link to={matchRoutes.history(match.id)}>Historial</Link>
          </nav>
          {state.notice && <div className={styles.successNotice} role="status">{state.notice}</div>}
          {state.error && <div className={styles.errorNotice} role="alert">{state.error}</div>}

          {mode === 'detail' && (
            <div className={styles.detailGrid}>
              <section className={styles.detailCard}>
                <ClipboardCheck size={24} />
                <span>Convocatorias</span>
                <h2>{match.homeSquadStatus && match.awaySquadStatus ? 'Ambos equipos presentaron' : 'Hay convocatorias pendientes'}</h2>
                <p>Local: {STATUS_LABELS[match.homeSquadStatus] || 'Sin presentar'} · Visitante: {STATUS_LABELS[match.awaySquadStatus] || 'Sin presentar'}</p>
                <Link to={matchRoutes.squads(match.id)}>Ver alineaciones</Link>
              </section>
              <section className={styles.detailCard}>
                <FileClock size={24} />
                <span>Acta</span>
                <h2>{state.operation ? `Versión ${state.operation.operation.operation_version}` : 'Todavía no fue abierta'}</h2>
                <p>El fixture conserva cuándo y dónde; el acta registra qué ocurrió.</p>
                {state.operation ? (
                  <Link to={matchRoutes.report(match.id)}>Continuar acta</Link>
                ) : canOpen && ['scheduled', 'ready'].includes(match.planningStatus) ? (
                  <OpenReportAction match={match} busy={busy} run={run} />
                ) : <small>Acción no disponible para tu rol o estado.</small>}
              </section>
              <section className={styles.detailCard}>
                <History size={24} />
                <span>Autoridad</span>
                <h2>{match.operationStatus === 'official' ? 'Resultado oficial' : 'Sin resultado oficial'}</h2>
                <p>Un marcador editable nunca reemplaza la validación y el cierre del acta.</p>
                <Link to={matchRoutes.history(match.id)}>Ver versiones</Link>
              </section>
            </div>
          )}

          {mode === 'squads' && (
            <>
              <div className={styles.teamTabs} role="tablist" aria-label="Equipo de la convocatoria">
                {[match.homeTeamEntryId, match.awayTeamEntryId].map((teamId, index) => (
                  <button
                    key={teamId}
                    type="button"
                    role="tab"
                    aria-selected={activeTeamId === teamId}
                    onClick={() => setActiveTeamId(teamId)}
                  >
                    {index === 0 ? match.homeName : match.awayName}
                  </button>
                ))}
              </div>
              <SquadEditor
                context={state.squads[activeTeamId]}
                readOnly={!hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_SQUADS_MANAGE)
                  || (state.squads[activeTeamId]?.squad?.status
                    && state.squads[activeTeamId]?.squad?.status !== 'draft')}
                busy={busy}
                onSave={(players) => run('saveSquad', players)}
                onSubmit={() => run('submitSquad')}
              />
            </>
          )}

          {mode === 'report' && (
            !state.operation ? (
              <section className={styles.emptyState}>
                <ClipboardCheck size={30} />
                <h2>Primero abrí el acta</h2>
                <p>La apertura crea la versión y copia los snapshots disponibles.</p>
                {canOpen && ['scheduled', 'ready'].includes(match.planningStatus)
                  && <OpenReportAction match={match} busy={busy} run={run} />}
              </section>
            ) : (
              <>
                <ReportEditor match={match} context={state.operation} canManage={canManage} busy={busy} run={run} />
                {state.operation.operation.status === 'draft' && canManage && (
                  <section className={styles.closureCard}>
                    <div><CheckCircle2 size={25} /><span>Cierre</span><h2>Presentar acta</h2><p>El backend revalida outcome, score, eventos y resoluciones pendientes en una sola transacción.</p></div>
                    <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => run('submit')}><LockKeyhole size={17} /> Presentar para revisión</button>
                  </section>
                )}
              </>
            )
          )}

          {mode === 'review' && (
            <section className={styles.reviewPanel}>
              <div className={styles.panelHeading}>
                <div><span>Doble control</span><h2>Revisión y validación</h2></div>
                <UserCheck size={24} />
              </div>
              {!state.operation ? <p>No hay un acta abierta.</p> : (
                <>
                  <MatchScore match={match} operation={state.operation} />
                  <label><span>Fundamento de la revisión</span><textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Observaciones concretas, sin datos privados innecesarios…" /></label>
                  <div className={styles.reviewActions}>
                    {canReview && state.operation.operation.status === 'submitted' && (
                      <>
                        <button type="button" disabled={busy || reviewReason.trim().length < 3} onClick={() => run('review', { decision: 'rejected', reason: reviewReason })}><XCircle size={17} /> Devolver</button>
                        <button type="button" disabled={busy || reviewReason.trim().length < 3} onClick={() => run('review', { decision: 'approved', reason: reviewReason })}><ShieldCheck size={17} /> Aprobar revisión</button>
                      </>
                    )}
                    {hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_VALIDATE)
                      && state.operation.operation.status === 'under_review' && (
                      <button type="button" disabled={busy} onClick={() => run('validate')}><UserCheck size={17} /> Validar acta</button>
                    )}
                    {hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_MAKE_OFFICIAL)
                      && state.operation.operation.status === 'validated' && (
                      <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => run('official')}><CheckCircle2 size={17} /> Hacer oficial</button>
                    )}
                    {hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_REQUEST_CORRECTION)
                      && state.operation.operation.status === 'official'
                      && !(state.operation.reviews || []).some(
                        (review) => review.review_type === 'correction' && review.status === 'open',
                      ) && (
                      <button type="button" disabled={busy || reviewReason.trim().length < 3} onClick={() => run('requestCorrection', { reason: reviewReason })}><AlertTriangle size={17} /> Solicitar corrección</button>
                    )}
                    {hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCH_OPERATIONS_CORRECT)
                      && state.operation.operation.status === 'official'
                      && (state.operation.reviews || []).some(
                        (review) => review.review_type === 'correction' && review.status === 'open',
                      ) && (
                      <button type="button" disabled={busy} onClick={() => run('createCorrection')}><Plus size={17} /> Crear nueva versión</button>
                    )}
                  </div>
                  <div className={styles.reviewHistory}>
                    {(state.operation.reviews || []).map((review) => (
                      <article key={review.id}><StatusPill status={review.status} /><strong>{REVIEW_TYPE_LABELS[review.review_type] || 'Revisión'}</strong><p>{review.reason}</p><small>{new Date(review.requested_at).toLocaleString('es-AR')}</small></article>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {mode === 'history' && (
            <section className={styles.historyPanel}>
              <div className={styles.panelHeading}><div><span>Append-only</span><h2>Historial del acta</h2></div><History size={24} /></div>
              {!state.operation ? <p>No existen versiones del acta.</p> : (
                <div className={styles.versionCard}>
                  <span>v{state.operation.operation.operation_version}</span>
                  <div><StatusPill status={state.operation.operation.status} /><h3>{state.operation.operation.home_team_snapshot.name} vs. {state.operation.operation.away_team_snapshot.name}</h3><p>Abierta {new Date(state.operation.operation.opened_at).toLocaleString('es-AR')}</p></div>
                  {state.operation.operation.source_operation_id && <small>Corrige una versión anterior</small>}
                </div>
              )}
              <div className={styles.historyRule}><ShieldCheck size={19} /><p>Las versiones oficiales no se editan. Toda corrección crea una versión nueva y conserva la anterior como reemplazada.</p></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
