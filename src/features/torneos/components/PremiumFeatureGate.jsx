import React, { useEffect, useRef } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import styles from './PremiumFeatureGate.module.css';

export default function PremiumFeatureGate({ open, onClose, onViewPremium }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll('button')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="premium-feature-title"
        aria-describedby="premium-feature-copy"
      >
        <button
          type="button"
          className={styles.closeIcon}
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X size={18} aria-hidden="true" />
        </button>
        <span className={styles.icon}><LockKeyhole size={22} aria-hidden="true" /></span>
        <p>ESTILOS DE RESULTADOS</p>
        <h2 id="premium-feature-title">Disponible con Premium</h2>
        <span id="premium-feature-copy">
          Sumá más estilos profesionales para tus placas de resultados.
        </span>
        <div className={styles.actions}>
          <button type="button" onClick={onViewPremium}>Ver Premium</button>
          <button type="button" className={styles.secondary} onClick={onClose}>Cerrar</button>
        </div>
      </section>
    </div>
  );
}
