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
import { useTorneosFeature } from '../context/TorneosFeaturesContext';
import { getRoleLabel } from '../domain/rolePresentation';
import { useTorneosFeatures } from '../context/TorneosFeaturesContext';
import MyRegistrationsSection from './connected/MyRegistrationsSection';
import styles from './ParticipantHub.module.css';

const STATUS_LABELS = {
  draft: 'Preparación',
  registration: 'Inscripción',
  scheduled: 'Próximo',
  active: 'En juego',
  completed: 'Finalizado',
  archived: 'Archivado',
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

function MyTournamentCard({ item, hubEnabled = true }) {
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
        <span className={styles.stateChip} data-state={item.tournamentStatus}>
          <CircleDot size={13} />
          {stateLabel}
        </span>
      </header>
      <div className={styles.tournamentCardCopy}>
        <span>{item.seasonName} · {item.categoryName}</span>
        <h2>{item.tournamentName}</h2>
        <p>
          {item.teamName || item.organizationName}
          {' · '}
          {getRoleLabel(item.role, 'Participante')}
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
            <strong>{next.homeName} vs. {next.awayName}</strong>
            <small>{next.roundName || 'Fixture publicado'}</small>
          </span>
        </div>
      )}
      {hubEnabled ? (
        <Link
          className={styles.cardCta}
          to={`/torneos/torneo/${item.tournamentId}?categoria=${item.categoryId}`}
        >
          Abrir torneo
          <ArrowRight size={17} />
        </Link>
      ) : (
        <span className={styles.cardCta} aria-disabled="true">
          Portal del participante no disponible en esta versión
        </span>
      )}
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
  const { service, availableOrganizations } = useTorneosWorkspace();
  // CONNECTED-V1: «Mis torneos» is participation (approved entries you represent or play in), paged by the server.
  // Managing a tournament lives under Gestionar. Without the connected product, the earlier list stays as it was.
  const participationOnly = typeof service?.loadMyParticipations === 'function';
  const managesOrganizations = (availableOrganizations || []).length > 0;
  const hubEnabled = useTorneosFeature('participant_hub');
  const features = useTorneosFeatures();
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
      const payload = participationOnly
        ? await service.loadMyParticipations({ limit: 18, offset })
        : await service.loadMyTournaments({ limit: 18, offset });
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
  }, [participationOnly, service]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return (
    <div className={styles.hubPage}>
      <header className={styles.myTournamentsHero}>
        <div>
          <span className={styles.hubKicker}><ShieldCheck size={15} /> Tus competencias</span>
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

      {/* Requests are not tournaments: they live in their own section, above and apart. */}
      <MyRegistrationsSection />

      {participationOnly && managesOrganizations && (
        <p className={styles.manageHint}>
          Los torneos que organizás están en <Link to="/torneos?vista=gestionar">Gestionar</Link>.
        </p>
      )}

      {state.status === 'ready' && !state.items.length && (
        <section className={styles.hubState}>
          <Trophy size={31} />
          <h2>Todavía no tenés torneos confirmados</h2>
          <p>
            {participationOnly
              ? 'Aparecen cuando la organización aprueba la inscripción de tu equipo y vos estás en su plantel o sos su responsable.'
              : 'Aparecen cuando la organización aprueba la inscripción de tu equipo y vos estás en su plantel o sos su responsable, o cuando una organización te suma como miembro.'}
          </p>
          {features.tournament_catalog !== false
            ? <Link to="/torneos/explorar">Explorar torneos</Link>
            : <Link to="/torneos">Volver al inicio</Link>}
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
                hubEnabled={hubEnabled}
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
