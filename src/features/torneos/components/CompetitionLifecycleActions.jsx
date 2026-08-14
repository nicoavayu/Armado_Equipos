import React, { useState } from 'react';
import { Flag, PlayCircle, RotateCcw, ShieldAlert } from 'lucide-react';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import {
  canRunLifecycleAction,
  getCompetitionErrorContext,
  getCompetitionLifecycleAction,
  getLifecycleErrorMessage,
} from '../domain/competitionLifecycle';
import styles from './TorneosShell.module.css';

const ACTION_ICONS = {
  start: PlayCircle,
  finish: Flag,
  reopen: RotateCcw,
};

export default function CompetitionLifecycleActions({ organization, tournament }) {
  const {
    startCompetition,
    finishCompetition,
    reopenCompetition,
  } = useTorneosCompetition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const action = getCompetitionLifecycleAction(tournament?.status);
  if (!action || !canRunLifecycleAction(organization, action)) return null;

  const Icon = ACTION_ICONS[action.id];
  const reasonMissing = action.requiresReason && reason.trim().length < 3;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const input = { tournamentId: tournament.id };
      if (action.id === 'start') await startCompetition(input);
      if (action.id === 'finish') await finishCompetition(input);
      if (action.id === 'reopen') {
        await reopenCompetition({ ...input, reason: reason.trim() });
      }
      setConfirming(false);
      setReason('');
    } catch (runError) {
      setError(getLifecycleErrorMessage(
        runError,
        undefined,
        getCompetitionErrorContext(organization, tournament),
      ));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.lifecycleActions}>
      {!confirming ? (
        <button
          type="button"
          className={styles.lifecycleActionButton}
          onClick={() => { setConfirming(true); setError(''); }}
        >
          {Icon && <Icon size={18} aria-hidden="true" />}
          {action.label}
        </button>
      ) : (
        <section
          className={styles.lifecycleConfirmation}
          role="alertdialog"
          aria-labelledby={`lifecycle-${action.id}-title`}
        >
          <ShieldAlert size={22} aria-hidden="true" />
          <div>
            <h3 id={`lifecycle-${action.id}-title`}>{action.title}</h3>
            <p>{action.description}</p>
            <ul>
              {action.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
            {action.requiresReason && (
              <label className={styles.lifecycleReason}>
                <span>{action.reasonLabel}</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Ej.: se cargó mal el resultado de la última fecha"
                />
                <small>{action.reasonHelp}</small>
              </label>
            )}
            {error && (
              <p className={styles.lifecycleError} role="alert">{error}</p>
            )}
            <div className={styles.lifecycleConfirmationActions}>
              <button
                type="button"
                className={styles.lifecycleSecondaryButton}
                onClick={() => { setConfirming(false); setError(''); setReason(''); }}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.lifecycleActionButton}
                onClick={run}
                disabled={busy || reasonMissing}
              >
                {busy ? 'Aplicando…' : action.confirmLabel}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
