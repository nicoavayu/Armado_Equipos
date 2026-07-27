import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './TournamentCommunications.module.css';

const TYPE_LABELS = {
  general: 'Información',
  registration: 'Inscripciones',
  schedule_change: 'Cambio de fecha',
  match_update: 'Partido',
  discipline: 'Disciplina',
  regulation: 'Documento',
  administrative: 'Administrativo',
  emergency: 'Urgente',
};

function formatDate(value) {
  if (!value) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function internalLinkPath(announcement, link) {
  const tournamentId = encodeURIComponent(announcement.tournament.id);
  const resourceId = encodeURIComponent(link.resourceId || '');
  const categoryQuery = announcement.category?.id
    ? `?categoria=${encodeURIComponent(announcement.category.id)}` : '';
  if (link.type === 'tournament') return `/torneos/torneo/${tournamentId}`;
  if (link.type === 'category') {
    return `/torneos/torneo/${tournamentId}?categoria=${resourceId}`;
  }
  if (link.type === 'match') {
    return `/torneos/torneo/${tournamentId}/partidos/${resourceId}${categoryQuery}`;
  }
  if (link.type === 'standings') return `/torneos/torneo/${tournamentId}/tabla`;
  if (link.type === 'discipline') return `/torneos/torneo/${tournamentId}/disciplina`;
  if (link.type === 'round') return `/torneos/torneo/${tournamentId}/partidos`;
  if (link.type === 'document') return `/torneos/torneo/${tournamentId}/novedades`;
  return null;
}

function StateCard({
  icon: Icon,
  title,
  copy,
  action = null,
}) {
  return (
    <section className={styles.stateCard} role="status">
      <Icon size={24} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </section>
  );
}

function AnnouncementDetail({
  announcement,
  busy,
  onRead,
  onClose,
}) {
  const confirm = announcement.acknowledgementMode === 'explicit';
  return (
    <article className={styles.detailCard} aria-labelledby="announcement-title">
      <div className={styles.detailTopline}>
        <button type="button" onClick={onClose}>Volver</button>
        <span data-priority={announcement.priority}>
          {announcement.priority === 'urgent' ? 'Urgente' : TYPE_LABELS[announcement.type]}
        </span>
      </div>
      <p className={styles.eyebrow}>
        {announcement.organization.name} · {announcement.tournament.name}
        {announcement.category ? ` · ${announcement.category.name}` : ''}
      </p>
      <h2 id="announcement-title">{announcement.title}</h2>
      <p className={styles.summary}>{announcement.summary}</p>
      {announcement.status === 'revoked' && (
        <div className={styles.withdrawnNotice}>
          <ShieldAlert size={18} /> Este comunicado fue retirado por la organización.
        </div>
      )}
      {announcement.correctionReason && (
        <div className={styles.updatedNotice}>
          <Sparkles size={18} /> Actualización: {announcement.correctionReason}
        </div>
      )}
      <div className={styles.bodyCopy}>
        {announcement.body.split('\n').map((paragraph, index) => (
          <p key={`${paragraph.slice(0, 12)}-${index}`}>{paragraph}</p>
        ))}
      </div>
      {!!announcement.links?.length && (
        <nav className={styles.relatedLinks} aria-label="Enlaces relacionados">
          {announcement.links.map((link) => (
            link.externalUrl ? (
              <a href={link.externalUrl} target="_blank" rel="noreferrer" key={link.id}>
                {link.label} <small>{link.externalDomain}</small>
              </a>
            ) : internalLinkPath(announcement, link) ? (
              <Link key={link.id} to={internalLinkPath(announcement, link)}>
                {link.label}
              </Link>
            ) : null
          ))}
        </nav>
      )}
      <footer className={styles.detailFooter}>
        <span><Clock3 size={15} /> {formatDate(announcement.publishedAt)}</span>
        {!announcement.delivery?.readAt && (
          <button type="button" disabled={busy} onClick={() => onRead(confirm)}>
            {confirm ? <CheckCheck size={18} /> : <Check size={18} />}
            {busy ? 'Guardando…' : confirm ? 'Confirmo que lo leí' : 'Marcar como leído'}
          </button>
        )}
        {announcement.delivery?.readAt && (
          <span className={styles.readState}><CheckCheck size={17} /> Lectura registrada</span>
        )}
      </footer>
      {confirm && (
        <p className={styles.legalNote}>
          Esta confirmación registra lectura; no representa una aceptación legal.
        </p>
      )}
    </article>
  );
}

function DocumentsView({
  documents,
  busyId,
  onAcknowledge,
}) {
  if (!documents.length) {
    return (
      <StateCard
        icon={FileText}
        title="Todavía no hay documentos publicados"
        copy="Los reglamentos y requisitos oficiales aparecerán acá."
      />
    );
  }
  return (
    <div className={styles.documentGrid}>
      {documents.map((document) => {
        const confirmed = document.acknowledgement?.status === 'confirmed';
        const needsConfirm = document.acknowledgementMode === 'explicit';
        return (
          <article className={styles.documentCard} key={document.id}>
            <div className={styles.documentIcon}><BookOpen size={21} /></div>
            <div>
              <p className={styles.eyebrow}>
                {TYPE_LABELS[document.type] || 'Documento oficial'} · Versión {document.version}
              </p>
              <h3>{document.title}</h3>
              <p>{document.summary}</p>
              <div className={styles.documentBody}>{document.body}</div>
              <small>Vigente desde {formatDate(document.effectiveAt)}</small>
            </div>
            <div className={styles.documentAction}>
              {document.acknowledgement ? (
                <span><CheckCheck size={16} /> {confirmed ? 'Lectura confirmada' : 'Leído'}</span>
              ) : document.acknowledgementMode !== 'none' ? (
                <button
                  type="button"
                  disabled={busyId === document.versionId}
                  onClick={() => onAcknowledge(document, needsConfirm)}
                >
                  {needsConfirm ? 'Confirmo que lo leí' : 'Marcar como leído'}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function PreferencesView({
  preferences,
  busy,
  onSave,
}) {
  const [draft, setDraft] = useState(preferences);
  useEffect(() => setDraft(preferences), [preferences]);
  if (!draft) return null;
  const fields = [
    ['general', 'Comunicados generales'],
    ['matchChanges', 'Cambios de partidos'],
    ['callups', 'Convocatorias'],
    ['discipline', 'Disciplina'],
    ['documents', 'Documentos'],
    ['summaries', 'Resúmenes'],
  ];
  return (
    <form
      className={styles.preferencesCard}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div>
        <p className={styles.eyebrow}>Preferencias personales</p>
        <h2>Qué querés destacar</h2>
        <p>
          El inbox interno siempre conserva avisos obligatorios de partidos propios,
          sanciones y documentos requeridos. Push y email siguen desactivados.
        </p>
      </div>
      <div className={styles.preferenceList}>
        {fields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={Boolean(draft[key])}
              onChange={(event) => setDraft((current) => ({
                ...current,
                [key]: event.target.checked,
              }))}
            />
          </label>
        ))}
      </div>
      <button type="submit" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar preferencias'}
      </button>
    </form>
  );
}

export default function TournamentCommunicationsPanel({
  tournamentId,
  categoryId = null,
  service,
}) {
  const requestRef = useRef(0);
  const scopeKey = `${tournamentId}:${categoryId || ''}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [section, setSection] = useState('news');
  const [state, setState] = useState({
    status: 'loading',
    inbox: null,
    documents: null,
    preferences: null,
    error: '',
  });
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSelected(null);
    setState({
      status: 'loading',
      inbox: null,
      documents: null,
      preferences: null,
      error: '',
    });
    try {
      const [inbox, documents, preferences] = await Promise.all([
        service.loadCommunicationsInbox({ tournamentId, limit: 30 }),
        service.loadPublishedDocuments({ tournamentId, categoryId }),
        service.loadNotificationPreferences(tournamentId),
      ]);
      if (requestRef.current !== requestId) return;
      setState({
        status: 'ready',
        inbox,
        documents,
        preferences,
        error: '',
      });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        inbox: null,
        documents: null,
        preferences: null,
        error: error?.message || 'No pudimos cargar las novedades.',
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
  }, [tournamentId, categoryId, service]);

  const openAnnouncement = async (item) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy(item.id);
    setSelected(null);
    try {
      const announcement = await service.loadAnnouncement(item.id);
      if (requestRef.current === requestId) setSelected(announcement);
    } catch (error) {
      if (requestRef.current === requestId) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: error?.message || 'No pudimos abrir el comunicado.',
        }));
      }
    } finally {
      if (requestRef.current === requestId) setBusy('');
    }
  };

  const markRead = async (confirm) => {
    if (!selected || busy) return;
    const actionScope = scopeKey;
    setBusy(selected.id);
    try {
      await service.markAnnouncementRead({
        announcementId: selected.id,
        confirm,
      });
      if (scopeRef.current === actionScope) await load();
    } finally {
      if (scopeRef.current === actionScope) setBusy('');
    }
  };

  const acknowledgeDocument = async (document, confirm) => {
    if (busy) return;
    const actionScope = scopeKey;
    setBusy(document.versionId);
    try {
      await service.acknowledgeDocument({
        versionId: document.versionId,
        confirm,
      });
      if (scopeRef.current === actionScope) {
        await load();
        setSection('documents');
      }
    } finally {
      if (scopeRef.current === actionScope) setBusy('');
    }
  };

  const savePreferences = async (preferences) => {
    if (busy) return;
    const actionScope = scopeKey;
    setBusy('preferences');
    try {
      const saved = await service.updateNotificationPreferences({
        tournamentId,
        ...preferences,
      });
      if (scopeRef.current === actionScope) {
        setState((current) => ({ ...current, preferences: saved }));
      }
    } finally {
      if (scopeRef.current === actionScope) setBusy('');
    }
  };

  if (state.status === 'loading') {
    return (
      <div className={styles.skeletonGrid} aria-label="Cargando novedades">
        <span /><span /><span />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <StateCard
        icon={typeof navigator !== 'undefined' && !navigator.onLine
          ? Bell : AlertTriangle}
        title={typeof navigator !== 'undefined' && !navigator.onLine
          ? 'Estás sin conexión' : 'No pudimos cargar las novedades'}
        copy={state.error}
        action={(
          <button type="button" onClick={load}>
            <RefreshCw size={17} /> Reintentar
          </button>
        )}
      />
    );
  }
  if (selected) {
    return (
      <AnnouncementDetail
        announcement={selected}
        busy={busy === selected.id}
        onRead={markRead}
        onClose={() => setSelected(null)}
      />
    );
  }

  const items = state.inbox?.items || [];
  return (
    <section className={styles.communicationPanel}>
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Centro del torneo</p>
          <h2>Novedades oficiales</h2>
          <p>Información publicada por la organización, sin email ni push.</p>
        </div>
        {state.inbox?.unreadCount > 0 && (
          <span className={styles.unreadCount}>
            {state.inbox.unreadCount} sin leer
          </span>
        )}
      </header>
      <div className={styles.sectionTabs} role="tablist" aria-label="Contenido oficial">
        {[
          ['news', 'Novedades', Bell],
          ['documents', 'Documentos', BookOpen],
          ['preferences', 'Preferencias', SlidersHorizontal],
        ].map(([key, label, Icon]) => (
          <button
            type="button"
            role="tab"
            aria-selected={section === key}
            key={key}
            onClick={() => setSection(key)}
          >
            <Icon size={17} /> {label}
          </button>
        ))}
      </div>
      {section === 'news' && (
        items.length ? (
          <div className={styles.newsList}>
            {items.map((item) => (
              <button
                type="button"
                className={styles.newsCard}
                data-priority={item.priority}
                data-unread={!item.readAt}
                key={item.id}
                disabled={busy === item.id}
                onClick={() => openAnnouncement(item)}
              >
                <span className={styles.newsIcon}>
                  {item.type === 'discipline' ? <ShieldAlert size={20} /> : <Bell size={20} />}
                </span>
                <span className={styles.newsCopy}>
                  <small>
                    {TYPE_LABELS[item.type] || 'Comunicado'}
                    {item.categoryName ? ` · ${item.categoryName}` : ''}
                  </small>
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                  <time>{formatDate(item.publishedAt)}</time>
                </span>
                {!item.readAt && <span className={styles.unreadDot}>Sin leer</span>}
                {item.updated && <span className={styles.updatedChip}>Actualizado</span>}
              </button>
            ))}
          </div>
        ) : (
          <StateCard
            icon={Bell}
            title="Estás al día"
            copy="No hay comunicados publicados para vos en este torneo."
          />
        )
      )}
      {section === 'documents' && (
        <DocumentsView
          documents={state.documents?.items || []}
          busyId={busy}
          onAcknowledge={acknowledgeDocument}
        />
      )}
      {section === 'preferences' && (
        <PreferencesView
          preferences={state.preferences}
          busy={busy === 'preferences'}
          onSave={savePreferences}
        />
      )}
    </section>
  );
}
