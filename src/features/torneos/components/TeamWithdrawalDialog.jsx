import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import {
  getCompetitionErrorContext,
  getLifecycleErrorMessage,
  isWithdrawalNoteRequired,
  TEAM_WITHDRAWAL_CONSEQUENCES,
  WITHDRAWAL_REASONS,
} from '../domain/competitionLifecycle';
import styles from './TeamRegistration.module.css';

export default function TeamWithdrawalDialog({
  organization,
  tournament,
  entry,
  onClose,
  onWithdrawn,
}) {
  const { withdrawCompetitionParticipant } = useTorneosCompetition();
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const noteRequired = isWithdrawalNoteRequired(reasonCode);
  const blocked = !reasonCode || (noteRequired && note.trim().length < 3);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await withdrawCompetitionParticipant({
        tournamentId: tournament.id,
        teamEntryId: entry.id,
        reasonCode,
        reasonText: note.trim() ? note.trim() : null,
      });
      if (onWithdrawn) await onWithdrawn();
      onClose();
    } catch (withdrawError) {
      setError(getLifecycleErrorMessage(
        withdrawError,
        'No pudimos retirar el equipo.',
        getCompetitionErrorContext(organization, tournament),
      ));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={styles.withdrawalDialog}
      role="alertdialog"
      aria-labelledby="team-withdrawal-title"
    >
      <ShieldAlert size={22} aria-hidden="true" />
      <div>
        <h2 id="team-withdrawal-title">{TEAM_WITHDRAWAL_CONSEQUENCES.title}</h2>
        <p>
          <strong>{entry.name}</strong>
          {' — '}
          {TEAM_WITHDRAWAL_CONSEQUENCES.description}
        </p>
        <ul>
          {TEAM_WITHDRAWAL_CONSEQUENCES.changes.map(
            (change) => <li key={change}>{change}</li>,
          )}
        </ul>

        <fieldset className={styles.withdrawalReasons}>
          <legend>Motivo</legend>
          {WITHDRAWAL_REASONS.map((reason) => (
            <label key={reason.code}>
              <input
                type="radio"
                name="withdrawal-reason"
                value={reason.code}
                checked={reasonCode === reason.code}
                onChange={() => setReasonCode(reason.code)}
              />
              <span>{reason.label}</span>
            </label>
          ))}
        </fieldset>

        <label className={styles.withdrawalNote}>
          <span>
            Observación
            {noteRequired ? ' (obligatoria)' : ' (opcional)'}
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Detalle que quede registrado junto al retiro"
          />
        </label>

        {error && <p className={styles.withdrawalError} role="alert">{error}</p>}

        <div className={styles.withdrawalActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={confirm}
            disabled={busy || blocked}
          >
            {busy ? 'Retirando…' : TEAM_WITHDRAWAL_CONSEQUENCES.confirmLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
