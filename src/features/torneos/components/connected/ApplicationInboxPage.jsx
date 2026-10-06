import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Inbox,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import { canonicalRoutes } from '../../routing/canonicalRoutes';
import { formatDateTime, registrationStage } from '../../domain/connectedProduct';
import styles from './ConnectedProduct.module.css';

const TABS = Object.freeze([
  { value: 'submitted', label: 'Pendientes' },
  { value: 'changes_requested', label: 'Con cambios pedidos' },
  { value: 'in_progress', label: 'En preparación' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'withdrawn', label: 'Retiradas' },
]);

// `defaultReason` is only what an approval says when the organizer leaves the message empty; it is shown as the
// placeholder, never prefilled (a prefilled text gets concatenated with what the organizer types).
const DECISIONS = Object.freeze({
  approved: {
    title: 'Aprobar solicitud', action: 'Aprobar', done: 'solicitud aprobada', icon: ShieldCheck,
    defaultReason: 'Inscripción aprobada. ¡Bienvenidos!',
  },
  changes_requested: {
    title: 'Pedir cambios', action: 'Pedir cambios', done: 'se pidieron cambios', icon: MessageSquareWarning, defaultReason: '',
  },
  rejected: { title: 'Rechazar solicitud', action: 'Rechazar', done: 'solicitud rechazada', icon: XCircle, defaultReason: '' },
});

const ROSTER_ERRORS = Object.freeze({
  minimum_players: 'Faltan jugadores',
  maximum_players: 'Sobran jugadores',
  minimum_goalkeepers: 'Falta arquero',
  shirt_number_required: 'Faltan dorsales',
  position_required: 'Faltan posiciones',
  duplicate_shirt_number: 'Dorsales repetidos',
  player_already_approved: 'Jugador en otro equipo aprobado',
  player_approval_required: 'Jugadores sin habilitar',
});

function DecisionDialog({ decision, application, onCancel, onConfirm }) {
  const meta = DECISIONS[decision];
  const [reason, setReason] = useState('');
  const [state, setState] = useState({ status: 'idle', error: '' });
  const textRef = useRef(null);
  useEffect(() => {
    textRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const message = reason.trim() || meta.defaultReason;
  const valid = message.length >= 3;
  const confirm = async (event) => {
    event.preventDefault();
    if (!valid) return;
    setState({ status: 'saving', error: '' });
    try {
      await onConfirm(message);
    } catch (error) {
      setState({ status: 'error', error: error?.message || 'No pudimos registrar la decisión.' });
    }
  };
  return createPortal(
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="decision-title" onSubmit={confirm}>
        <h2 id="decision-title"><meta.icon size={18} aria-hidden="true" /> {meta.title}</h2>
        <p>{application.teamName} · {application.categoryName}</p>
        <label className={styles.field}>
          <span>{decision === 'approved' ? 'Mensaje para el equipo (opcional)' : 'Motivo (lo recibe el equipo)'}</span>
          <textarea
            ref={textRef}
            rows={4}
            maxLength={1200}
            value={reason}
            placeholder={meta.defaultReason || undefined}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {decision === 'approved' && (
          <p className={styles.help}>Al aprobar, el equipo ocupa un cupo y su plantel queda aprobado. Antes de confirmar se vuelven a revisar el plantel y el cupo disponible.</p>
        )}
        {state.status === 'error' && <p className={styles.errorText} role="alert"><AlertCircle size={16} aria-hidden="true" /> {state.error}</p>}
        <div className={styles.formActions}>
          <button type="button" className={styles.secondaryAction} onClick={onCancel}>Cancelar</button>
          <button type="submit" className={styles.primaryAction} disabled={!valid || state.status === 'saving'}>
            {state.status === 'saving' ? <Loader2 className={styles.spin} size={16} aria-hidden="true" /> : <ClipboardCheck size={16} aria-hidden="true" />}
            {meta.action}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// The organizer's inbox of registration requests from Explorar: who, which category, who represents the team, what
// is still missing, and a decision with a message the team receives. The decision is the existing review RPC: plan,
// category, capacity and lifecycle rules all apply, and a repeated decision is refused by the backend.
export default function ApplicationInboxPage() {
  const { organizationId, tournamentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlighted = searchParams.get('equipo');
  const status = TABS.some((tab) => tab.value === searchParams.get('estado')) ? searchParams.get('estado') : 'submitted';
  const { service } = useTorneosWorkspace();
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const triggerRef = useRef(null);
  const noticeRef = useRef(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const data = await service.loadApplicationInbox({ organizationId, tournamentId, status, limit: 30, offset: 0 });
      if (requestRef.current === requestId) setState({ status: 'ready', data, error: '' });
    } catch (error) {
      if (requestRef.current === requestId) setState({ status: 'error', data: null, error: error?.message || 'No pudimos cargar las solicitudes.' });
    }
  }, [organizationId, service, status, tournamentId]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!highlighted || state.status !== 'ready') return;
    document.getElementById(`solicitud-${highlighted}`)?.scrollIntoView({ block: 'center' });
  }, [highlighted, state.status]);

  const closeDialog = () => {
    setDialog(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const confirmDecision = async (reason) => {
    await service.reviewTeamEntry({
      organizationId,
      teamEntryId: dialog.application.teamEntryId,
      decision: dialog.decision,
      reason,
    });
    setNotice(`${dialog.application.teamName}: ${DECISIONS[dialog.decision].done}. El equipo recibe el aviso en Torneos.`);
    setDialog(null);
    await load();
    // The decided card leaves this list, so focus goes to the confirmation instead of falling to the page.
    window.requestAnimationFrame(() => noticeRef.current?.focus());
  };

  const data = state.data;
  const items = data?.items || [];
  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to={canonicalRoutes.tournamentTeams(organizationId, tournamentId)}>
        <ArrowLeft size={17} aria-hidden="true" /> Equipos
      </Link>
      <header className={styles.pageHero}>
        <span className={styles.kicker}><Inbox size={15} aria-hidden="true" /> Solicitudes de inscripción</span>
        <h1>{data?.tournament?.name || 'Solicitudes'}</h1>
        <p>Equipos que pidieron inscribirse desde Explorar torneos. Sólo una solicitud aprobada ocupa un cupo.</p>
        <Link className={styles.textAction} to={canonicalRoutes.tournamentCatalogListing(organizationId, tournamentId)}>
          Convocatoria y cupos
        </Link>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Estado de las solicitudes">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => setSearchParams(tab.value === 'submitted' ? {} : { estado: tab.value })}
          >
            {tab.label}
            {Number(data?.counts?.[tab.value]) > 0 && <span className={styles.tabCount}>{data.counts[tab.value]}</span>}
          </button>
        ))}
      </div>

      {notice && (
        <p ref={noticeRef} tabIndex={-1} className={styles.successNotice} role="status">
          <CheckCircle2 size={16} aria-hidden="true" /> {notice}
        </p>
      )}

      {state.status === 'error' && (
        <section className={styles.stateCard} role="alert">
          <RefreshCw size={26} aria-hidden="true" />
          <h2>No pudimos cargar las solicitudes</h2>
          <p>{state.error}</p>
          <button type="button" className={styles.secondaryAction} onClick={load}>Reintentar</button>
        </section>
      )}
      {state.status === 'loading' && !data && <div className={styles.skeletonBlock} role="status"><span className={styles.srOnly}>Cargando solicitudes…</span></div>}
      {state.status === 'ready' && !items.length && (
        <section className={styles.stateCard}>
          <Inbox size={28} aria-hidden="true" />
          <h2>No hay solicitudes en este estado</h2>
          <p>Cuando un equipo envíe una solicitud desde Explorar torneos, aparece en «Pendientes» y te llega un aviso.</p>
        </section>
      )}

      <ul className={styles.applicationList}>
        {items.map((item) => {
          const stage = registrationStage(item.status);
          const roster = item.roster;
          const pending = (roster?.errors || []).map((code) => ROSTER_ERRORS[code] || code);
          return (
            <li key={item.teamEntryId} id={`solicitud-${item.teamEntryId}`} data-highlighted={highlighted === item.teamEntryId ? 'true' : 'false'}>
              <article className={styles.applicationCard}>
                <header>
                  <div>
                    <h2>{item.teamName}</h2>
                    <p>{item.categoryName} · {item.coreTeamLinked ? 'Equipo de Arma2' : 'Equipo nuevo'}</p>
                  </div>
                  <span className={styles.stateChip} data-tone={stage.tone}>{stage.label}</span>
                </header>
                <dl className={styles.applicationFacts}>
                  <div><dt>Responsable</dt><dd>{item.responsible?.displayName || '—'}</dd></div>
                  <div><dt>Enviada</dt><dd>{formatDateTime(item.submittedAt) || 'Todavía no'}</dd></div>
                  <div>
                    <dt>Plantel</dt>
                    <dd>
                      {roster?.counts ? `${roster.counts.players} de ${roster.counts.minimumPlayers} mínimo` : '—'}
                      {roster && (roster.valid ? ' · completo' : '')}
                    </dd>
                  </div>
                </dl>
                {pending.length > 0 && (
                  <p className={styles.warningText}>Pendiente: {pending.join(' · ')}</p>
                )}
                {item.message && <blockquote className={styles.applicantMessage}>«{item.message}»</blockquote>}
                {item.lastReview?.reason && (
                  <p className={styles.help}>Última respuesta: «{item.lastReview.reason}» ({formatDateTime(item.lastReview.createdAt)})</p>
                )}
                <footer className={styles.formActions}>
                  {item.status === 'submitted' && data.canApprove && (
                    <button type="button" className={styles.primaryAction} disabled={!roster?.valid}
                      title={roster?.valid ? undefined : 'El plantel todavía no cumple los requisitos.'}
                      onClick={(event) => { triggerRef.current = event.currentTarget; setDialog({ decision: 'approved', application: item }); }}>
                      <ShieldCheck size={16} aria-hidden="true" /> Aprobar
                    </button>
                  )}
                  {item.status === 'submitted' && data.canReview && (
                    <button type="button" className={styles.secondaryAction}
                      onClick={(event) => { triggerRef.current = event.currentTarget; setDialog({ decision: 'changes_requested', application: item }); }}>
                      <MessageSquareWarning size={16} aria-hidden="true" /> Pedir cambios
                    </button>
                  )}
                  {item.status === 'submitted' && data.canReject && (
                    <button type="button" className={styles.dangerAction}
                      onClick={(event) => { triggerRef.current = event.currentTarget; setDialog({ decision: 'rejected', application: item }); }}>
                      <XCircle size={16} aria-hidden="true" /> Rechazar
                    </button>
                  )}
                  <Link className={styles.textAction} to={canonicalRoutes.organizationTeamEntryRoster(organizationId, item.teamEntryId)}>
                    Ver plantel
                  </Link>
                </footer>
              </article>
            </li>
          );
        })}
      </ul>

      {dialog && (
        <DecisionDialog
          decision={dialog.decision}
          application={dialog.application}
          onCancel={closeDialog}
          onConfirm={confirmDecision}
        />
      )}
    </div>
  );
}
