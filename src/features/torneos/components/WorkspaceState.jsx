import React from 'react';
import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react';
import styles from './TorneosShell.module.css';

export function WorkspaceLoading({ label = 'Validando tu espacio…' }) {
  return (
    <div
      className={styles.statePanel}
      role="status"
      aria-live="polite"
      data-torneos-loading="true"
    >
      <LoaderCircle className={styles.spinner} size={28} aria-hidden="true" />
      <strong>{label}</strong>
      <span>Confirmamos tu sesión y membresías antes de mostrar información.</span>
    </div>
  );
}

export function WorkspaceError({ message, onRetry }) {
  return (
    <div className={styles.statePanel} role="alert">
      <AlertCircle size={28} aria-hidden="true" />
      <strong>No pudimos abrir Torneos</strong>
      <span>{message || 'Revisá la conexión y volvé a intentar.'}</span>
      {onRetry && (
        <button className={styles.secondaryButton} type="button" onClick={onRetry}>
          <RotateCcw size={17} aria-hidden="true" />
          Reintentar
        </button>
      )}
    </div>
  );
}
