import React, { useCallback, useEffect, useState } from 'react';
import { BellOff, BellRing, Loader2 } from 'lucide-react';
import ContentReportDialog, { ReportTrigger } from './ContentReportDialog';
import styles from './ContentModeration.module.css';

// MODERATION (0022) inside a communication a participant received: report it to Arma2 (the organization wrote it, so
// the platform reviews it) and mute the organization (its new communications arrive archived, emergencies excepted).
// Only with the aliases of the mounted composition; without them nothing renders and nothing is requested.
export function CommunicationModerationBar({ service, detail, onMuted }) {
  const [reporting, setReporting] = useState(false);
  const [state, setState] = useState({ status: 'idle', message: '' });
  const canReport = typeof service?.reportContent === 'function';
  const canMute = typeof service?.setCommunicationsMuted === 'function';
  if (!detail?.id || (!canReport && !canMute)) return null;
  const organizationName = detail.organization?.name || 'esta organización';
  const mute = async () => {
    setState({ status: 'saving', message: '' });
    try {
      await service.setCommunicationsMuted({ announcementId: detail.id, muted: true });
      setState({
        status: 'done',
        message: `Silenciaste los comunicados de ${organizationName}. Los nuevos van directo al archivo; los de emergencia te siguen llegando. Podés reactivarlos desde tus comunicados.`,
      });
      onMuted?.();
    } catch (error) {
      setState({ status: 'error', message: error?.message || 'No pudimos silenciar esta organización.' });
    }
  };
  return (
    <div className={styles.inline} data-moderation="communication">
      {canReport && <ReportTrigger label="Reportar comunicado" onClick={() => setReporting(true)} />}
      {canMute && state.status !== 'done' && (
        <button type="button" className={styles.reportTrigger} disabled={state.status === 'saving'} onClick={mute}>
          {state.status === 'saving' ? <Loader2 className={styles.spin} size={14} aria-hidden="true" /> : <BellOff size={14} aria-hidden="true" />}
          Silenciar a {organizationName}
        </button>
      )}
      {state.message && <p className={state.status === 'error' ? styles.errorText : styles.help} role="status">{state.message}</p>}
      {canReport && (
        <ContentReportDialog
          open={reporting}
          onClose={() => setReporting(false)}
          targets={[{ kind: 'announcement', targetId: detail.id, title: `«${detail.title}», de ${organizationName}` }]}
          submit={(input) => service.reportContent(input)}
        />
      )}
    </div>
  );
}

/** The organizations the person muted, each with «Reactivar». Renders nothing when there are none. */
export function MutedOrganizations({ service }) {
  const [mutes, setMutes] = useState([]);
  const [busy, setBusy] = useState('');
  const available = typeof service?.loadCommunicationMutes === 'function' && typeof service?.setCommunicationsMuted === 'function';
  const load = useCallback(async () => {
    if (!available) return;
    try {
      const data = await service.loadCommunicationMutes();
      setMutes(Array.isArray(data?.mutes) ? data.mutes : []);
    } catch {
      setMutes([]);
    }
  }, [available, service]);
  useEffect(() => { load(); }, [load]);
  if (!available || mutes.length === 0) return null;
  const unmute = async (organizationId) => {
    setBusy(organizationId);
    try {
      await service.setCommunicationsMuted({ organizationId, muted: false });
      await load();
    } finally {
      setBusy('');
    }
  };
  return (
    <section className={styles.card} aria-label="Organizaciones silenciadas">
      <strong>Organizaciones silenciadas</strong>
      <p className={styles.help}>Sus comunicados nuevos van al archivo. Los de emergencia te siguen llegando.</p>
      <ul className={styles.list}>
        {mutes.map((mute) => (
          <li key={mute.organizationId} className={styles.cardHead}>
            <span>{mute.organizationName}</span>
            <button type="button" className={styles.reportTrigger} disabled={busy === mute.organizationId} onClick={() => unmute(mute.organizationId)}>
              <BellRing size={14} aria-hidden="true" /> Reactivar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
