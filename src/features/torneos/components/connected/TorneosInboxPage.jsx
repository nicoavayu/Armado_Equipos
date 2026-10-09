import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Bell,
  CheckCheck,
  Inbox,
  Megaphone,
  RefreshCw,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import { useTorneosFeatures } from '../../context/TorneosFeaturesContext';
import { formatDateTime, formatKickoff, notificationTarget } from '../../domain/connectedProduct';
import MyCommunicationsPage from '../MyCommunicationsPage';
import { announceTorneosInboxChanged } from './torneosInboxEvents';
import { useTorneosInboxSummary } from './useTorneosInboxSummary';
import styles from './ConnectedProduct.module.css';

const PAGE_SIZE = 20;

function ActivityList() {
  const navigate = useNavigate();
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const [state, setState] = useState({ status: 'loading', items: [], pagination: null, error: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async ({ offset = 0, append = false } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const payload = await service.loadTorneosNotifications({ limit: PAGE_SIZE, offset });
      if (requestRef.current !== requestId) return;
      setState((current) => ({
        status: 'ready',
        items: append ? [...current.items, ...(payload?.items || [])] : (payload?.items || []),
        pagination: payload?.pagination || null,
        error: '',
      }));
    } catch (error) {
      if (requestRef.current === requestId) {
        setState({ status: 'error', items: [], pagination: null, error: error?.message || 'No pudimos cargar tus avisos.' });
      }
    }
  }, [service]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const open = async (item) => {
    setBusy(item.id);
    try {
      if (!item.readAt) {
        await service.markTorneosNotificationsRead({ notificationIds: [item.id] });
        announceTorneosInboxChanged();
      }
    } catch {
      // Opening the resource matters more than the read mark; it is retried on the next visit.
    } finally {
      setBusy('');
    }
    navigate(notificationTarget(item), { state: { from: '/torneos/avisos' } });
  };

  const markAll = async () => {
    setBusy('all');
    try {
      await service.markTorneosNotificationsRead({ notificationIds: null });
      announceTorneosInboxChanged();
      await load();
    } finally {
      setBusy('');
    }
  };

  if (state.status === 'error') {
    return (
      <section className={styles.stateCard} role="alert">
        <RefreshCw size={26} aria-hidden="true" />
        <h2>No pudimos cargar tus avisos</h2>
        <p>{state.error}</p>
        <button type="button" className={styles.secondaryAction} onClick={() => load()}>Reintentar</button>
      </section>
    );
  }
  if (state.status === 'loading' && !state.items.length) {
    return <div className={styles.skeletonBlock} role="status"><span className={styles.srOnly}>Cargando avisos…</span></div>;
  }
  if (!state.items.length) {
    return (
      <section className={styles.stateCard}>
        <Inbox size={28} aria-hidden="true" />
        <h2>Sin actividad todavía</h2>
        <p>
          Acá llegan los avisos de tus inscripciones: cuando enviás una solicitud, cuando la organización la aprueba,
          pide cambios o la rechaza. También cuando cambia el horario de uno de tus partidos y, si gestionás un torneo,
          las solicitudes que recibís.
        </p>
      </section>
    );
  }
  const unread = state.items.some((item) => !item.readAt);
  return (
    <>
      {unread && (
        <div className={styles.listToolbar}>
          <button type="button" className={styles.textAction} disabled={Boolean(busy)} onClick={markAll}>
            <CheckCheck size={16} aria-hidden="true" /> Marcar todo como leído
          </button>
        </div>
      )}
      <ul className={styles.activityList}>
        {state.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={styles.activityItem}
              data-unread={item.readAt ? 'false' : 'true'}
              disabled={busy === item.id}
              onClick={() => open(item)}
            >
              <span className={styles.activityIcon} aria-hidden="true"><Bell size={18} /></span>
              <span className={styles.activityCopy}>
                <small>
                  {item.tournamentName}
                  {item.audience === 'organization' ? ' · Gestión' : ''}
                </small>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
                {(item.kind === 'match.rescheduled' || item.kind === 'match.postponed') && (
                  <span className={styles.activityChange}>
                    {formatKickoff(item.previousScheduledAt) && (
                      <>Antes: <del>{formatKickoff(item.previousScheduledAt)}</del> · </>
                    )}
                    {item.kind === 'match.postponed'
                      ? <>Nueva fecha: <ins>a confirmar</ins></>
                      : <>Ahora: <ins>{formatKickoff(item.scheduledAt) || 'A confirmar'}</ins></>}
                  </span>
                )}
                {item.message && <q>{item.message}</q>}
                <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
              </span>
              {!item.readAt && <span className={styles.unreadDot}><span className={styles.srOnly}>Sin leer</span></span>}
            </button>
          </li>
        ))}
      </ul>
      {state.pagination?.hasMore && (
        <button
          type="button"
          className={styles.secondaryAction}
          disabled={state.status === 'loading'}
          onClick={() => load({ offset: state.items.length, append: true })}
        >
          {state.status === 'loading' ? 'Cargando…' : 'Ver avisos anteriores'}
        </button>
      )}
    </>
  );
}

// The Torneos inbox: ONLY Torneos. Registration activity (CONNECTED-V1) and the official communications that were
// already Torneos' own (audiences, read/confirm, documents unchanged). The bell counts exactly these two.
export default function TorneosInboxPage({ defaultTab = 'actividad' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { service } = useTorneosWorkspace();
  const features = useTorneosFeatures();
  const summary = useTorneosInboxSummary();
  const activitySupported = typeof service?.loadTorneosNotifications === 'function';
  const communicationsSupported = features.communications !== false;
  const requested = searchParams.get('vista') || defaultTab;
  const tab = !activitySupported ? 'comunicados'
    : (!communicationsSupported ? 'actividad' : (requested === 'comunicados' ? 'comunicados' : 'actividad'));

  const tabs = [
    activitySupported && { key: 'actividad', label: 'Actividad', icon: Bell, count: summary.notificationsUnread },
    communicationsSupported && { key: 'comunicados', label: 'Comunicados', icon: Megaphone, count: summary.communicationsUnread },
  ].filter(Boolean);

  return (
    <div className={styles.page}>
      <header className={styles.pageHero}>
        <span className={styles.kicker}><Bell size={15} aria-hidden="true" /> Avisos de Torneos</span>
        <h1>Tus avisos</h1>
        <p>Comunicados oficiales de tus competencias y novedades de tus inscripciones. Sólo de Torneos.</p>
      </header>

      {tabs.length > 1 && (
        <div className={styles.tabs} role="tablist" aria-label="Tipo de aviso">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setSearchParams(key === 'actividad' ? {} : { vista: key })}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
              {count > 0 && <span className={styles.tabCount}>{count}</span>}
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel">
        {tab === 'actividad' && <ActivityList />}
        {tab === 'comunicados' && communicationsSupported && <MyCommunicationsPage embedded />}
      </div>

      <p className={styles.channelNote}>
        Los avisos de Torneos llegan a esta bandeja. Torneos todavía no envía notificaciones push ni emails.
      </p>
    </div>
  );
}
