import React from 'react';
import { ChevronLeft, X } from 'lucide-react';

/**
 * Top of every survey step: back, which match, how much is left, close.
 * The segmented bar shows one segment per step of the current path.
 */
const SurveyStepHeader = ({
  matchLabel = '',
  stepNumber = 1,
  stepCount = 1,
  isDone = false,
  onBack = null,
  onClose = null,
}) => {
  const segments = Math.max(stepCount, 1);
  const reached = isDone ? segments : Math.min(Math.max(stepNumber, 1), segments);
  const iconButtonClass = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80';

  return (
    <div className="w-full shrink-0 pt-1.5">
      <div className="flex items-center gap-1">
        {onBack ? (
          <button type="button" aria-label="Volver a la pregunta anterior" onClick={onBack} className={iconButtonClass}>
            <ChevronLeft size={24} strokeWidth={2.4} aria-hidden="true" />
          </button>
        ) : (
          <span className="h-10 w-10 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1 text-center">
          <span className="section-eyebrow !mb-0 truncate">
            {matchLabel ? `Encuesta · ${matchLabel}` : 'Encuesta del partido'}
          </span>
          <div className="font-oswald text-[12px] tabular-nums text-white/65" aria-live="polite">
            {isDone ? 'Encuesta completa' : `Paso ${reached} de ${segments}`}
          </div>
        </div>
        {onClose ? (
          <button type="button" aria-label="Cerrar encuesta" onClick={onClose} className={iconButtonClass}>
            <X size={22} strokeWidth={2.4} aria-hidden="true" />
          </button>
        ) : (
          <span className="h-10 w-10 shrink-0" aria-hidden="true" />
        )}
      </div>
      <div
        className="mt-2 flex w-full gap-1 px-1"
        role="progressbar"
        aria-label="Avance de la encuesta"
        aria-valuemin={0}
        aria-valuemax={segments}
        aria-valuenow={reached}
      >
        {Array.from({ length: segments }, (_, index) => {
          const filled = index < reached;
          const current = !isDone && index === reached - 1;
          return (
            <span key={index} className="relative h-[5px] flex-1 overflow-hidden rounded-pill bg-white/[0.12]">
              <span
                className={`absolute inset-y-0 left-0 rounded-pill bg-[linear-gradient(90deg,#8b5cff_0%,#b9a6ff_60%,#ec007d_100%)] transition-[width] duration-[380ms] ease-out ${current ? 'shadow-[0_0_10px_rgba(139,92,255,0.65)]' : ''}`}
                style={{ width: filled ? '100%' : '0%' }}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default SurveyStepHeader;
