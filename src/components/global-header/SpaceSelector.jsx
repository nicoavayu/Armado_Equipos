import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { APP_SPACE, useSpaceNavigation } from '../../features/space-navigation';
import SpaceBrand from './SpaceBrand';
import styles from './GlobalHeader.module.css';

const SPACE_OPTIONS = Object.freeze({
  [APP_SPACE.ARMA2]: {
    title: 'Arma2',
    description: 'Partidos con amigos',
  },
  [APP_SPACE.TORNEOS]: {
    title: 'Torneos',
    description: 'Competencias, fixture, posiciones y gestión',
  },
});

export default function SpaceSelector() {
  const chevronGradientId = `space-chevron-${useId().replace(/:/g, '')}`;
  const { currentSpace, switchSpace, isSpaceAvailable } = useSpaceNavigation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);

  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    dialogRef.current?.querySelector('[data-initial-focus="true"]')?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) || []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const chooseSpace = (space) => {
    if (space === currentSpace || !isSpaceAvailable(space)) return;
    const changed = switchSpace(space);
    if (changed) setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={styles.spaceTrigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Abrir selector de espacio. Espacio actual: ${SPACE_OPTIONS[currentSpace].title}`}
        onClick={() => setOpen(true)}
      >
        <SpaceBrand space={currentSpace} />
        <svg
          className={styles.spaceAffordance}
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
          data-space-affordance="chevron"
        >
          <defs>
            <linearGradient id={chevronGradientId} x1="3" y1="4" x2="13" y2="12" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ec007d" />
              <stop offset="1" stopColor="#8b5cff" />
            </linearGradient>
          </defs>
          <path
            d="M3.5 6 8 10.5 12.5 6"
            fill="none"
            stroke={`url(#${chevronGradientId})`}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.35"
          />
        </svg>
      </button>

      {open && createPortal(
        <div
          className={styles.selectorBackdrop}
          data-testid="space-selector-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onTouchStart={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            ref={dialogRef}
            className={styles.selectorDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="space-selector-title"
          >
            <div className={styles.selectorHeading}>
              <div>
                <span>Tus espacios</span>
                <h2 id="space-selector-title">¿Dónde querés estar?</h2>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                aria-label="Cerrar selector"
                data-initial-focus="true"
                onClick={close}
              >
                <X size={19} />
              </button>
            </div>

            <div className={styles.spaceOptions}>
              {Object.values(APP_SPACE).map((space) => {
                const option = SPACE_OPTIONS[space];
                const current = space === currentSpace;
                const available = isSpaceAvailable(space);
                return (
                  <button
                    key={space}
                    type="button"
                    className={`${styles.spaceOption} ${current ? styles.spaceOptionCurrent : ''}`}
                    aria-current={current ? 'true' : undefined}
                    disabled={current || !available}
                    onClick={() => chooseSpace(space)}
                  >
                    <span className={styles.optionBrand}><SpaceBrand space={space} /></span>
                    <span className={styles.optionCopy}>
                      <small>{option.description}</small>
                      <span className={`${styles.optionAction} ${current ? styles.optionActionCurrent : ''}`}>
                        {current ? (
                          'Actual'
                        ) : available ? (
                          `Ir a ${option.title}`
                        ) : (
                          'No disponible en este entorno'
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
