import React from 'react';
import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react';
import styles from './TorneosShell.module.css';

export const SESSION_CHECK_DETAIL = 'Confirmamos tu sesión y membresías antes de mostrar información.';

// One loading pattern for every screen: what is being loaded, and only when it is true, that access is being checked
// (a "confirmamos tu sesión" under "Cargando tus partidos…" described something that was not happening).
export function WorkspaceLoading({ label = 'Validando tu espacio…', detail = null }) {
  return (
    <div
      className={styles.statePanel}
      role="status"
      aria-live="polite"
      data-torneos-loading="true"
    >
      <LoaderCircle className={styles.spinner} size={28} aria-hidden="true" />
      <strong>{label}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

// One error pattern: what failed (the screen, not "Torneos" as a whole), the reason in product language, and a retry
// when retrying can help. Access guards keep "No pudimos abrir Torneos": there, Torneos itself did not open.
export function WorkspaceError({ title = 'No pudimos cargar esta pantalla', message, onRetry }) {
  return (
    <div className={styles.statePanel} role="alert">
      <AlertCircle size={28} aria-hidden="true" />
      <strong>{title}</strong>
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
