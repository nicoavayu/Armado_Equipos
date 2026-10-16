import React, { useState } from 'react';
import { AlertCircle, Ban, Loader2 } from 'lucide-react';
import ContentReportDialog, { ReportTrigger } from './ContentReportDialog';
import styles from './ContentModeration.module.css';

// MODERATION (0022) on a registration request the organization received: report it to Arma2 (the applicant is another
// user, so the platform reviews it) and block the applicant (that person can no longer request a place in any tournament
// of this organization; reversible from Moderación). Only owners and administrators may block — the database decides.
export default function ApplicationModeration({ service, organizationId, application }) {
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });
  const canReport = typeof service?.reportContent === 'function';
  const canBlock = typeof service?.blockApplicant === 'function';
  if (!application?.teamEntryId || (!canReport && !canBlock)) return null;
  const valid = reason.trim().length >= 3 && reason.trim().length <= 300;
  const block = async (event) => {
    event.preventDefault();
    if (!valid) return;
    setState({ status: 'saving', message: '' });
    try {
      const result = await service.blockApplicant({ organizationId, teamEntryId: application.teamEntryId, reason });
      setBlocking(false);
      setState({
        status: 'done',
        message: result?.alreadyBlocked
          ? 'Ese solicitante ya estaba bloqueado.'
          : 'Bloqueado: no puede volver a pedir lugar en los torneos de tu organización. Lo podés deshacer desde Moderación.',
      });
    } catch (error) {
      setState({ status: 'error', message: error?.message || 'No pudimos bloquear al solicitante.' });
    }
  };
  return (
    <div className={styles.inline} data-moderation="application">
      {canReport && <ReportTrigger label="Reportar a Arma2" onClick={() => setReporting(true)} />}
      {canBlock && state.status !== 'done' && !blocking && (
        <button type="button" className={styles.reportTrigger} onClick={() => setBlocking(true)}>
          <Ban size={14} aria-hidden="true" /> Bloquear solicitante
        </button>
      )}
      {blocking && (
        <form className={styles.inline} onSubmit={block} aria-label="Bloquear solicitante">
          <label className={styles.field}>
            <span>Motivo del bloqueo (no lo ve el solicitante)</span>
            <textarea rows={2} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="button" className={styles.secondaryAction} onClick={() => setBlocking(false)}>Cancelar</button>
          <button type="submit" className={styles.dangerAction} disabled={!valid || state.status === 'saving'}>
            {state.status === 'saving' ? <Loader2 className={styles.spin} size={16} aria-hidden="true" /> : <Ban size={16} aria-hidden="true" />}
            Bloquear
          </button>
        </form>
      )}
      {state.message && (
        <p className={state.status === 'error' ? styles.errorText : styles.help} role="status">
          {state.status === 'error' && <AlertCircle size={14} aria-hidden="true" />} {state.message}
        </p>
      )}
      {canReport && (
        <ContentReportDialog
          open={reporting}
          onClose={() => setReporting(false)}
          targets={[{ kind: 'application', targetId: application.teamEntryId, title: `La solicitud de «${application.teamName}»` }]}
          submit={(input) => service.reportContent(input)}
        />
      )}
    </div>
  );
}
