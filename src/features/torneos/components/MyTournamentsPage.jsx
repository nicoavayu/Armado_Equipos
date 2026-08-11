import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowRight,
  CalendarClock,
  CircleDot,
  RefreshCw,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { getImportantNameLength, importantNameProps } from './importantNames';
import styles from './ParticipantHub.module.css';

const STATUS_LABELS = {
  draft: 'Preparación',
  registration: 'Inscripción',
  scheduled: 'Próximo',
  active: 'En juego',
  completed: 'Finalizado',
  archived: 'Archivado',
};

const ROLE_LABELS = {
  owner: 'Responsable',
  admin: 'Administrador',
  collaborator: 'Colaborador',
  captain: 'Capitán',
  delegate: 'Delegado',
  assistant: 'Asistente',
  player: 'Jugador',
};

function TournamentMonogram({ item }) {
  const label = item.teamShortName || item.tournamentName || 'A2';
  return (
    <span
      className={styles.tournamentMonogram}
      style={{ '--hub-accent': item.primaryColor || '#8b67ff' }}
      aria-hidden="true"
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function MyTournamentCard({ item }) {
  const stateLabel = item.hasPublishedFixture
    ? STATUS_LABELS[item.tournamentStatus] || 'Torneo'
    : item.tournamentStatus === 'registration'
      ? 'Inscripción'
      : 'Sin fixture';
  const next = item.nextMatch;
  return (
    <article className={styles.tournamentCard}>
      <header className={styles.tournamentCardTop}>
        <TournamentMonogram item={item} />
        <span className={styles.stateChip} data-state={item.tournamentStatus} data-torneos-chip>
          <CircleDot size={13} />
          {stateLabel}
        </span>
      </header>
      <div className={styles.tournamentCardCopy}>
        <span>{item.seasonName} · {item.categoryName}</span>
        <h2 {...importantNameProps(item.tournamentName, 'card')}>{item.tournamentName}</h2>
        <p>
          <span {...importantNameProps(item.teamName || item.organizationName, 'compact')}>
            {item.teamName || item.organizationName}
          </span>
          <small>{ROLE_LABELS[item.role] || 'Participante'}</small>
        </p>
      </div>
      <dl className={styles.tournamentFacts}>
        <div>
          <dt>Posición</dt>
          <dd>{item.position ? `#${item.position}` : '—'}</dd>
        </div>
        <div>
          <dt>Próximo</dt>
          <dd>{next?.scheduledAt ? new Intl.DateTimeFormat('es-AR', {
            day: '2-digit',
            month: 'short',
          }).format(new Date(next.scheduledAt)) : 'A confirmar'}</dd>
        </div>
      </dl>
      {next && (
        <div className={styles.nextMatchLine}>
          <CalendarClock size={16} />
          <span>
            <strong
              className={styles.nextMatchTeams}
              data-long-names={[
                getImportantNameLength(next.homeName),
                getImportantNameLength(next.awayName),
              ].includes('extra-long') || `${next.homeName}${next.awayName}`.length >= 26}
            >
              <span {...importantNameProps(next.homeName, 'match')}>{next.homeName}</span>
              <em>vs.</em>
              <span {...importantNameProps(next.awayName, 'match')}>{next.awayName}</span>
            </strong>
            <small>{next.roundName || 'Fixture publicado'}</small>
          </span>
        </div>
      )}
      <Link
        className={styles.cardCta}
        to={`/torneos/torneo/${item.tournamentId}?categoria=${item.categoryId}`}
      >
        Abrir torneo
        <ArrowRight size={17} />
      </Link>
    </article>
  );
}

function TournamentSkeleton() {
  return (
    <div className={styles.tournamentGrid} aria-hidden="true">
      {[1, 2, 3].map((key) => (
        <div className={styles.tournamentSkeleton} key={key}>
          <span /><span /><span /><span />
        </div>
      ))}
    </div>
  );
}

export default function MyTournamentsPage() {
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: 'loading',
    items: [],
    pagination: null,
    error: '',
  });

  const load = useCallback(async ({ offset = 0, append = false } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({
      status: 'loading',
      items: append ? current.items : [],
      pagination: append ? current.pagination : null,
      error: '',
    }));
    try {
      const payload = await service.loadMyTournaments({ limit: 18, offset });
      if (requestRef.current !== requestId) return;
      setState((current) => ({
        status: 'ready',
        items: append
          ? [...current.items, ...(payload?.items || [])]
          : (payload?.items || []),
        pagination: payload?.pagination || null,
        error: '',
      }));
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        items: [],
        pagination: null,
        error: error?.message || 'No pudimos cargar tus torneos.',
      });
    }
  }, [service]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return (
    <div className={styles.hubPage}>
      <header className={styles.myTournamentsHero}>
        <div>
          <span className={styles.hubKicker}><ShieldCheck size={15} /> Experiencia autenticada</span>
          <h1>Mis torneos</h1>
          <p>
            Tu calendario competitivo, tu equipo y cada dato oficial,
            reunidos sin mezclar organizaciones ni categorías.
          </p>
        </div>
        <span className={styles.heroNumber} aria-hidden="true">
          {String(state.pagination?.total || state.items.length).padStart(2, '0')}
        </span>
      </header>

      {state.status === 'loading' && !state.items.length && (
        <div role="status" aria-live="polite">
          <span className={styles.srOnly}>Cargando tus torneos…</span>
          <TournamentSkeleton />
        </div>
      )}

      {state.status === 'error' && (
        <section className={styles.hubState} role="alert">
          <RefreshCw size={28} />
          <h2>{typeof navigator !== 'undefined' && !navigator.onLine
            ? 'Estás sin conexión'
            : 'No pudimos abrir Mis torneos'}</h2>
          <p>{state.error}</p>
          <button type="button" onClick={() => load()}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </section>
      )}

      {state.status === 'ready' && !state.items.length && (
        <section className={styles.hubState}>
          <Trophy size={31} />
          <h2>Todavía no tenés torneos vinculados</h2>
          <p>
            Cuando una organización te agregue como jugador, capitán,
            delegado o miembro, aparecerá acá.
          </p>
          <Link to="/torneos">Explorar tus espacios</Link>
        </section>
      )}

      {state.items.length > 0 && (
        <>
          <section className={styles.sectionIntro}>
            <span>Competencias vinculadas</span>
            <h2>Elegí dónde entrar a la cancha</h2>
          </section>
          <div className={styles.tournamentGrid}>
            {state.items.map((item) => (
              <MyTournamentCard
                key={`${item.tournamentId}:${item.categoryId}`}
                item={item}
              />
            ))}
          </div>
          {state.pagination?.hasMore && (
            <button
              className={styles.loadMore}
              type="button"
              disabled={state.status === 'loading'}
              onClick={() => load({
                offset: state.items.length,
                append: true,
              })}
            >
              {state.status === 'loading' ? 'Cargando…' : 'Ver más torneos'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
