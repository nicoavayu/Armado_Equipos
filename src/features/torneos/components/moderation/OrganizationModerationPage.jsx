import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, Check, Loader2, ShieldAlert, Unlock, X } from 'lucide-react';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import OrganizationSettingsNav from '../OrganizationSettingsNav';
import { WorkspaceError, WorkspaceLoading } from '../WorkspaceState';
import {
  ORGANIZATION_ACTIONS,
  REPORT_KIND_LABELS,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
} from '../../domain/contentModeration';
import shell from '../TorneosShell.module.css';
import styles from './ContentModeration.module.css';

const FILTERS = Object.freeze([
  ['pending', 'Para revisar'],
  ['resolved', 'Resueltos'],
  ['dismissed', 'Descartados'],
]);

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(value));
}

function contentLine(report) {
  const content = report.content || {};
  if (report.targetKind === 'team') return content.teamName || report.targetLabel;
  if (report.targetKind === 'player') return `${content.playerName || report.targetLabel}${content.teamName ? ` · ${content.teamName}` : ''}`;
  return report.targetLabel;
}

// One report of the organization: what was reported (the server's copy), why, and the decision. The reporter is never
// shown — the RPC does not even return it.
function ReportCard({ report, onDecide, busy }) {
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const actions = ORGANIZATION_ACTIONS[report.targetKind] || [];
  const text = note.trim();
  const noteOk = text.length >= 3 && text.length <= 500;
  return (
    <li className={styles.card} data-report-status={report.status}>
      <div className={styles.cardHead}>
        <strong>{REPORT_KIND_LABELS[report.targetKind] || 'Contenido'}</strong>
        <span className={styles.chip} data-status={report.status}>
          {report.escalated ? 'Escalado a Arma2' : REPORT_STATUS_LABELS[report.status] || report.status}
        </span>
      </div>
      <p className={styles.quote}>{contentLine(report)}</p>
      <p className={styles.meta}>
        {REPORT_REASON_LABELS[report.reason] || 'Otro motivo'}
        {report.tournamentName ? ` · ${report.tournamentName}` : ''}
        {` · ${formatDate(report.createdAt)}`}
      </p>
      {report.detail && <p className={styles.meta}>«{report.detail}»</p>}
      {report.resolutionNote && <p className={styles.meta}>Decisión: {report.resolutionNote}</p>}
      {report.canHandle && (
        <form
          className={styles.inline}
          onSubmit={(event) => { event.preventDefault(); if (noteOk) onDecide(report, 'resolved', action || null, text); }}
        >
          {actions.length > 0 && (
            <label className={styles.field}>
              <span>Acción</span>
              <select value={action} onChange={(event) => setAction(event.target.value)}>
                <option value="">Sin cambios en el contenido</option>
                {actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          )}
          <label className={styles.field}>
            <span>Nota de la decisión (queda en el registro)</span>
            <textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className={styles.cardActions}>
            {report.status === 'open' && (
              <button type="button" className={styles.secondaryAction} disabled={busy} onClick={() => onDecide(report, 'under_review', null, null)}>
                En revisión
              </button>
            )}
            <button type="submit" className={styles.primaryAction} disabled={busy || !noteOk}>
              {busy ? <Loader2 className={styles.spin} size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Resolver
            </button>
            <button type="button" className={styles.secondaryAction} disabled={busy || !noteOk} onClick={() => onDecide(report, 'dismissed', null, text)}>
              <X size={16} aria-hidden="true" /> Descartar
            </button>
            <button type="button" className={styles.secondaryAction} disabled={busy} onClick={() => onDecide(report, 'escalated', null, text || null)}>
              <ArrowUpRight size={16} aria-hidden="true" /> Escalar a Arma2
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

// MODERATION (0022): Configuración → Moderación. Owners and administrators review what people reported about the teams
// and players of the organization's tournaments (Arma2 reviews the rest), and undo applicant blocks. Target: a first look
// within 24 hours and a decision within 48 (the Terms say it as a goal).
export default function OrganizationModerationPage() {
  const { organization } = useOutletContext();
  const { service } = useTorneosWorkspace();
  const [filter, setFilter] = useState('pending');
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState({ tone: 'ok', text: '' });
  const requestRef = useRef(0);
  const available = typeof service?.loadContentReports === 'function';

  const load = useCallback(async () => {
    if (!available) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, status: current.data ? 'refreshing' : 'loading', error: '' }));
    try {
      const data = await service.loadContentReports({ organizationId: organization.id, status: filter });
      if (requestRef.current === requestId) setState({ status: 'ready', data, error: '' });
    } catch (error) {
      if (requestRef.current === requestId) setState({ status: 'error', data: null, error: error?.message || 'No pudimos cargar los reportes.' });
    }
  }, [available, filter, organization.id, service]);

  useEffect(() => { load(); return () => { requestRef.current += 1; }; }, [load]);

  if (!available) return <WorkspaceError message="La moderación no está disponible en este entorno." />;
  if (state.status === 'loading') return <WorkspaceLoading label="Cargando reportes…" />;
  if (state.status === 'error') return <WorkspaceError message={state.error} onRetry={load} />;

  const decide = async (report, status, action, note) => {
    setBusy(report.id);
    setNotice({ tone: 'ok', text: '' });
    try {
      await service.handleContentReport({ reportId: report.id, status, action, note });
      setNotice({
        tone: 'ok',
        text: status === 'escalated' ? 'Lo pasamos al equipo de Arma2.'
          : status === 'under_review' ? 'Marcado en revisión.'
            : action ? 'Listo: el contenido ya se muestra con el valor neutro.' : 'Decisión guardada.',
      });
      await load();
    } catch (error) {
      setNotice({ tone: 'error', text: error?.message || 'No pudimos guardar la decisión.' });
    } finally {
      setBusy('');
    }
  };
  const unblock = async (block) => {
    setBusy(block.id);
    try {
      await service.unblockApplicant({ organizationId: organization.id, blockId: block.id });
      setNotice({ tone: 'ok', text: 'Bloqueo quitado: puede volver a pedir lugar.' });
      await load();
    } catch (error) {
      setNotice({ tone: 'error', text: error?.message || 'No pudimos quitar el bloqueo.' });
    } finally {
      setBusy('');
    }
  };

  const reports = state.data?.reports || [];
  const blocks = state.data?.applicantBlocks || [];
  return (
    <div className={shell.membersPage}>
      <header className={shell.pageHeader}>
        <span className={shell.eyebrow}>Contenido de tus torneos</span>
        <h1>Moderación</h1>
        <p>
          Lo que reportaron sobre nombres y escudos de equipos y jugadores de tus torneos. Revisalo dentro de las 24 a
          48 horas. No mostramos quién reportó. El resto (nombre o logo de la organización, torneos, convocatorias,
          comunicados y solicitudes) lo revisa Arma2.
        </p>
      </header>
      <OrganizationSettingsNav />
      <div className={styles.tabs} role="group" aria-label="Filtrar reportes">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      {notice.text && (
        <p className={notice.tone === 'error' ? styles.errorText : styles.successText} role="status">
          {notice.tone === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} {notice.text}
        </p>
      )}
      {reports.length ? (
        <ul className={styles.list}>
          {reports.map((report) => <ReportCard key={report.id} report={report} onDecide={decide} busy={busy === report.id} />)}
        </ul>
      ) : (
        <p className={styles.empty}><ShieldAlert size={18} aria-hidden="true" /> No hay reportes en esta vista.</p>
      )}
      <section className={styles.card} aria-labelledby="applicant-blocks-title">
        <strong id="applicant-blocks-title">Solicitantes bloqueados</strong>
        <p className={styles.help}>No pueden pedir lugar en tus torneos. Se bloquean desde la bandeja de solicitudes.</p>
        {blocks.length ? (
          <ul className={styles.list}>
            {blocks.map((block) => (
              <li key={block.id} className={styles.cardHead}>
                <span>{block.teamName || 'Solicitud'} · {block.reason}{block.byPlatform ? ' (Arma2)' : ''}</span>
                <button type="button" className={styles.reportTrigger} disabled={busy === block.id} onClick={() => unblock(block)}>
                  <Unlock size={14} aria-hidden="true" /> Desbloquear
                </button>
              </li>
            ))}
          </ul>
        ) : <p className={styles.meta}>Nadie bloqueado.</p>}
      </section>
    </div>
  );
}
