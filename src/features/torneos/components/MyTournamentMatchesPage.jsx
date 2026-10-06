import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  MapPin,
  ShieldCheck,
  Swords,
  X,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './MatchOperations.module.css';

// `tournament_matches.status` tal como lo devuelve la API. La tarjeta del
// jugador lo mostraba crudo (`unscheduled`, `scheduled`) en el riel de fecha.
const MATCH_STATUS_LABELS = {
  draft: 'Borrador',
  unscheduled: 'Sin fecha',
  scheduled: 'Programado',
  postponed: 'Postergado',
  cancelled: 'Cancelado',
  ready: 'Listo',
};

const AVAILABILITY_OPTIONS = [
  { value: 'available', label: 'Voy', icon: Check },
  { value: 'unavailable', label: 'No voy', icon: X },
  { value: 'maybe', label: 'En duda', icon: CircleHelp },
];

function formatMatchDate(value) {
  if (!value) return { day: 'A confirmar', time: 'Sin horario' };
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat('es-AR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date),
    time: new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date),
  };
}

function AvailabilityButtons({
  match,
  busy,
  onRespond,
}) {
  return (
    <div className={styles.availabilityGroup} role="group" aria-label="Tu disponibilidad">
      {AVAILABILITY_OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={match.availability === value ? styles.availabilityActive : ''}
          aria-pressed={match.availability === value}
          disabled={busy || !['scheduled', 'ready'].includes(match.status)}
          onClick={() => onRespond(value)}
        >
          <Icon size={17} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function PlayerMatchCard({
  match,
  busy,
  onRespond,
  detailed = false,
  headingLevel = 2,
}) {
  const date = formatMatchDate(match.scheduledAt);
  // Under a "Por jugar" / "Jugados" group the match is a level-3 heading; alone (its own page) it is level 2.
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <article className={`${styles.playerMatchCard} ${detailed ? styles.playerMatchCardDetailed : ''}`}>
      <div className={styles.matchRail}>
        <span>{date.day}</span>
        <strong>{date.time}</strong>
        <small>{MATCH_STATUS_LABELS[match.status] || 'Sin estado'}</small>
      </div>
      <div className={styles.playerMatchBody}>
        <div className={styles.playerMatchHeading}>
          <div>
            <small>{match.teamName}</small>
            <Heading>vs. {match.opponentName}</Heading>
          </div>
          <span className={styles.teamSide}>{match.isHome ? 'LOCAL' : 'VISITANTE'}</span>
        </div>
        <dl className={styles.matchFacts}>
          <div><MapPin size={16} /><dt>Sede</dt><dd>{match.venue || 'A confirmar'}</dd></div>
          <div><Swords size={16} /><dt>Cancha</dt><dd>{match.court || 'A confirmar'}</dd></div>
          <div><ShieldCheck size={16} /><dt>Convocatoria</dt><dd>{
            match.callupStatus === 'called_up'
              ? match.lineupStatus === 'starter' ? 'Titular' : 'Suplente'
              : match.squadStatus === 'submitted' || match.squadStatus === 'locked'
                ? 'No convocado'
                : 'Pendiente'
          }</dd></div>
        </dl>
        {match.officialScore && (
          <div className={styles.officialResult}>
            <span>Resultado oficial</span>
            <strong>{match.officialScore.home} — {match.officialScore.away}</strong>
          </div>
        )}
        {/*
          * Responder "Voy / No voy" es contestar por uno mismo, y por eso lo
          * habilita el vínculo con el plantel, no el cargo. Dirigir la
          * organización o el equipo trae la convocatoria —el enlace de abajo—,
          * no la respuesta de asistencia de otra persona. Quien además de
          * dirigir está en el plantel conserva el control por esa segunda
          * relación.
          */}
        {match.isRosteredPlayer && (
          <AvailabilityButtons
            match={match}
            busy={busy}
            onRespond={onRespond}
          />
        )}
        {match.canManageSquad && (
          <Link className={styles.textLink} to={`/torneos/mis-partidos/${match.matchId}/convocatoria`}>
            Gestionar convocatoria
          </Link>
        )}
        {!detailed && (
          <Link className={styles.textLink} to={`/torneos/mis-partidos/${match.matchId}`}>
            Ver partido
          </Link>
        )}
      </div>
    </article>
  );
}

export default function MyTournamentMatchesPage() {
  const { matchId } = useParams();
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: 'loading',
    matches: [],
    error: '',
    notice: '',
  });
  const [busyMatchId, setBusyMatchId] = useState(null);

  const load = useCallback(async ({ notice = '' } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({
      ...current,
      status: 'loading',
      matches: [],
      error: '',
      notice,
    }));
    try {
      const payload = await service.loadPlayerMatches();
      if (requestRef.current !== requestId) return;
      setState({
        status: 'ready',
        matches: Array.isArray(payload) ? payload : [],
        error: '',
        notice,
      });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        matches: [],
        error: error.message,
        notice: '',
      });
    }
  }, [service]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const visibleMatches = useMemo(
    () => (matchId
      ? state.matches.filter((match) => match.matchId === matchId)
      : state.matches),
    [matchId, state.matches],
  );
  // What is still to be played comes first, soonest first (no date yet: last); what was played (it has its
  // official result) is history, most recent first, folded under the upcoming list.
  const { upcoming, played } = useMemo(() => {
    const time = (match) => (match.scheduledAt ? new Date(match.scheduledAt).getTime() : Number.POSITIVE_INFINITY);
    const upcomingMatches = visibleMatches.filter((match) => !match.officialScore)
      .sort((a, b) => time(a) - time(b));
    const playedMatches = visibleMatches.filter((match) => match.officialScore)
      .sort((a, b) => {
        const left = Number.isFinite(time(a)) ? time(a) : 0;
        const right = Number.isFinite(time(b)) ? time(b) : 0;
        return right - left;
      });
    return { upcoming: upcomingMatches, played: playedMatches };
  }, [visibleMatches]);
  // One person can be linked to both sides of a match (manager of two teams): the side is part of the identity.
  const cardKey = (match, index) => `${match.matchId}:${match.teamName || ''}:${match.isHome ? 'home' : 'away'}:${index}`;
  const renderCard = (match, index) => (
    <PlayerMatchCard
      key={cardKey(match, index)}
      match={match}
      detailed={Boolean(matchId)}
      headingLevel={matchId ? 2 : 3}
      busy={busyMatchId === match.matchId}
      onRespond={(response) => respond(match, response)}
    />
  );

  const respond = async (match, response) => {
    if (busyMatchId) return;
    setBusyMatchId(match.matchId);
    try {
      await service.respondMatchAvailability({ matchId: match.matchId, response });
      await load({ notice: 'Tu disponibilidad quedó guardada.' });
    } catch (error) {
      setState((current) => ({ ...current, error: error.message, notice: '' }));
    } finally {
      setBusyMatchId(null);
    }
  };

  if (state.status === 'loading') return <WorkspaceLoading label="Cargando tus partidos…" />;
  if (state.status === 'error' && !state.matches.length) {
    return <WorkspaceError message={state.error} onRetry={() => load()} />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.kicker}>{matchId ? 'Disponibilidad' : 'Experiencia del jugador'}</span>
          <h1>{matchId ? 'Tu próximo partido' : 'Mis partidos'}</h1>
          <p>
            Confirmá si podés jugar. Tu respuesta informa al capitán,
            pero no define automáticamente la convocatoria.
          </p>
        </div>
        <div className={styles.headerStamp}>
          <CalendarDays size={20} />
          <span>Fixture publicado</span>
        </div>
      </header>

      {state.notice && <div className={styles.successNotice} role="status">{state.notice}</div>}
      {state.error && <div className={styles.errorNotice} role="alert">{state.error}</div>}

      {!visibleMatches.length ? (
        <section className={styles.emptyState}>
          <Clock3 size={30} />
          <h2>{matchId ? 'Este partido ya no está disponible' : 'No tenés partidos próximos'}</h2>
          <p>
            Sólo aparecen cruces del fixture publicado donde tu usuario está
            vinculado a un jugador habilitado.
          </p>
          {matchId && <Link to="/torneos/mis-partidos">Volver a Mis partidos</Link>}
        </section>
      ) : matchId ? (
        <div className={styles.playerMatches}>{visibleMatches.map(renderCard)}</div>
      ) : (
        <>
          <section className={styles.playerMatchGroup} aria-labelledby="upcoming-matches-title">
            <h2 id="upcoming-matches-title" className={styles.playerMatchGroupTitle}>
              Por jugar <span>{upcoming.length}</span>
            </h2>
            {upcoming.length ? (
              <div className={styles.playerMatches}>{upcoming.map(renderCard)}</div>
            ) : (
              <p className={styles.playerMatchGroupEmpty}>
                No te quedan partidos por jugar. Los que ya se jugaron están abajo, con su resultado oficial.
              </p>
            )}
          </section>
          {played.length > 0 && (
            <details className={styles.playedMatches}>
              <summary>
                <span>
                  <strong>Jugados</strong>
                  <small>{played.length === 1 ? '1 partido con resultado oficial' : `${played.length} partidos con resultado oficial`}</small>
                </span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className={styles.playerMatches}>{played.map(renderCard)}</div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
