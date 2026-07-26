import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  ShieldCheck,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { SquadEditor } from './MatchOperationsPage';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './MatchOperations.module.css';

export default function CaptainMatchSquadPage() {
  const { matchId } = useParams();
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: 'loading',
    context: null,
    error: '',
    notice: '',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async ({ notice = '' } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({
      status: 'loading',
      context: null,
      error: '',
      notice,
    });
    try {
      const context = await service.loadMyManagedMatchSquad(matchId);
      if (requestRef.current !== requestId) return;
      setState({
        status: 'ready',
        context,
        error: '',
        notice,
      });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        context: null,
        error: error.message,
        notice: '',
      });
    }
  }, [matchId, service]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const run = async (action, players = null) => {
    if (busy || !state.context) return;
    setBusy(true);
    try {
      const scope = {
        organizationId: state.context.organizationId,
        matchId,
        teamEntryId: state.context.teamEntryId,
      };
      if (action === 'save') await service.saveMatchSquad({ ...scope, players });
      if (action === 'submit') await service.submitMatchSquad(scope);
      await load({
        notice: action === 'submit'
          ? 'Convocatoria presentada. El organizador podrá copiarla al acta.'
          : 'Borrador guardado.',
      });
    } catch (error) {
      setState((current) => ({ ...current, error: error.message, notice: '' }));
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') return <WorkspaceLoading label="Cargando tu plantel habilitado…" />;
  if (!state.context) return <WorkspaceError message={state.error || 'No administrás un equipo en este partido.'} />;

  const date = state.context.scheduledAt
    ? new Date(state.context.scheduledAt).toLocaleString('es-AR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    : 'Horario a confirmar';
  const readOnly = Boolean(
    state.context.status === 'postponed'
      || (state.context.squad?.status && state.context.squad.status !== 'draft'),
  );

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to={`/torneos/mis-partidos/${matchId}`}>
        <ArrowLeft size={16} /> Volver al partido
      </Link>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.kicker}>Capitán / delegado</span>
          <h1>Convocatoria</h1>
          <p>
            {state.context.homeName} vs. {state.context.awayName} · {date}
            {' · '}{[state.context.venue, state.context.court].filter(Boolean).join(' · ') || 'Sede a confirmar'}
          </p>
        </div>
        <div className={styles.headerStamp}>
          <ShieldCheck size={19} />
          <span>Sólo tu equipo</span>
        </div>
      </header>
      {state.notice && <div className={styles.successNotice} role="status">{state.notice}</div>}
      {state.error && <div className={styles.errorNotice} role="alert">{state.error}</div>}
      {state.context.status === 'postponed' && (
        <div className={styles.errorNotice}>
          <CalendarClock size={17} /> El partido está postergado; la convocatoria se conserva.
        </div>
      )}
      <SquadEditor
        context={state.context}
        readOnly={readOnly}
        busy={busy}
        onSave={(players) => run('save', players)}
        onSubmit={() => run('submit')}
      />
    </div>
  );
}
