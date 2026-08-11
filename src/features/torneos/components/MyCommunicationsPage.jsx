import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  Clock3,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { importantNameProps } from './importantNames';
import styles from './TournamentCommunications.module.css';

function formatDate(value) {
  return value ? new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value)) : 'Sin fecha';
}

function internalLinkPath(detail, link) {
  const tournamentId = encodeURIComponent(detail.tournament.id);
  const resourceId = encodeURIComponent(link.resourceId || '');
  if (link.type === 'tournament') return `/torneos/torneo/${tournamentId}`;
  if (link.type === 'category') {
    return `/torneos/torneo/${tournamentId}?categoria=${resourceId}`;
  }
  if (link.type === 'match') {
    return `/torneos/torneo/${tournamentId}/partidos/${resourceId}`;
  }
  if (link.type === 'standings') return `/torneos/torneo/${tournamentId}/tabla`;
  if (link.type === 'discipline') return `/torneos/torneo/${tournamentId}/disciplina`;
  return `/torneos/torneo/${tournamentId}/novedades`;
}

function priorityLabel(priority) {
  if (priority === 'urgent') return 'Urgente';
  if (priority === 'important') return 'Importante';
  return 'Información';
}

export default function MyCommunicationsPage() {
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const [filter, setFilter] = useState('all');
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const [state, setState] = useState({
    status: 'loading',
    data: null,
    detail: null,
    error: '',
  });
  const [busy, setBusy] = useState('');

  const load = async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ status: 'loading', data: null, detail: null, error: '' });
    try {
      const data = await service.loadCommunicationsInbox({ filter, limit: 40 });
      if (requestRef.current !== requestId) return;
      setState({ status: 'ready', data, detail: null, error: '' });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        data: null,
        detail: null,
        error: error?.message || 'No pudimos cargar tus comunicados.',
      });
    }
  };

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
    // service is stable in the workspace provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, service]);

  const open = async (id) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy(id);
    try {
      const detail = await service.loadAnnouncement(id);
      if (requestRef.current === requestId) {
        setState((current) => ({ ...current, detail }));
      }
    } finally {
      if (requestRef.current === requestId) setBusy('');
    }
  };

  const markRead = async (confirm) => {
    if (!state.detail || busy) return;
    const actionFilter = filter;
    setBusy(state.detail.id);
    try {
      await service.markAnnouncementRead({
        announcementId: state.detail.id,
        confirm,
      });
      if (filterRef.current === actionFilter) await load();
    } finally {
      if (filterRef.current === actionFilter) setBusy('');
    }
  };

  if (state.status === 'loading') {
    return <div className={styles.skeletonGrid}><span /><span /><span /></div>;
  }
  if (state.status === 'error') {
    return (
      <section className={styles.stateCard}>
        <AlertTriangle size={24} />
        <h2>No pudimos abrir tus comunicados</h2>
        <p>{state.error}</p>
        <button type="button" onClick={load}><RefreshCw size={17} /> Reintentar</button>
      </section>
    );
  }
  if (state.detail) {
    const detail = state.detail;
    const requiresConfirmation = detail.acknowledgementMode === 'explicit';
    return (
      <article className={styles.detailCard}>
        <div className={styles.detailTopline}>
          <button
            type="button"
            onClick={() => setState((current) => ({ ...current, detail: null }))}
          >
            Volver
          </button>
          <span data-priority={detail.priority}>{priorityLabel(detail.priority)}</span>
        </div>
        <p className={styles.eyebrow}>
          <span {...importantNameProps(detail.organization.name, 'compact')}>{detail.organization.name}</span>
          <span aria-hidden="true">·</span>
          <span {...importantNameProps(detail.tournament.name, 'compact')}>{detail.tournament.name}</span>
        </p>
        <h2>{detail.title}</h2>
        <p className={styles.summary}>{detail.summary}</p>
        {detail.status === 'revoked' && (
          <div className={styles.withdrawnNotice}>
            <ShieldAlert size={18} /> Este comunicado fue retirado.
          </div>
        )}
        <div className={styles.bodyCopy}>{detail.body}</div>
        {!!detail.links?.length && (
          <nav className={styles.relatedLinks} aria-label="Enlaces relacionados">
            {detail.links.map((link) => (
              link.externalUrl ? (
                <a href={link.externalUrl} target="_blank" rel="noreferrer" key={link.id}>
                  {link.label} <small>{link.externalDomain}</small>
                </a>
              ) : (
                <Link key={link.id} to={internalLinkPath(detail, link)}>
                  {link.label}
                </Link>
              )
            ))}
          </nav>
        )}
        <footer className={styles.detailFooter}>
          <span><Clock3 size={15} /> {formatDate(detail.publishedAt)}</span>
          {!detail.delivery?.readAt && (
            <button
              type="button"
              disabled={busy === detail.id}
              onClick={() => markRead(requiresConfirmation)}
            >
              <Check size={17} />
              {requiresConfirmation ? 'Confirmo que lo leí' : 'Marcar como leído'}
            </button>
          )}
        </footer>
      </article>
    );
  }

  const items = state.data?.items || [];
  return (
    <section className={styles.communicationPanel}>
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Tu centro personal</p>
          <h2>Comunicados</h2>
          <p>Avisos oficiales de todos tus torneos, ordenados por prioridad.</p>
        </div>
        <Link to="/torneos/mis-torneos">Volver a Mis torneos</Link>
      </header>
      <div className={styles.sectionTabs} role="tablist" aria-label="Filtrar comunicados">
        {[
          ['all', 'Todos'],
          ['unread', 'Sin leer'],
          ['important', 'Importantes'],
        ].map(([key, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={filter === key}
            key={key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {items.length ? (
        <div className={styles.newsList}>
          {items.map((item) => (
            <button
              type="button"
              className={styles.newsCard}
              data-priority={item.priority}
              data-unread={!item.readAt}
              key={item.id}
              disabled={busy === item.id}
              onClick={() => open(item.id)}
            >
              <span className={styles.newsIcon}><Bell size={20} /></span>
              <span className={styles.newsCopy}>
                <small>{item.tournamentName} · {item.organizationName}</small>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
                <time>{formatDate(item.publishedAt)}</time>
              </span>
              {!item.readAt && <span className={styles.unreadDot}>Sin leer</span>}
            </button>
          ))}
        </div>
      ) : (
        <section className={styles.stateCard}>
          <Bell size={24} />
          <h2>Estás al día</h2>
          <p>No hay comunicados para este filtro.</p>
        </section>
      )}
    </section>
  );
}
