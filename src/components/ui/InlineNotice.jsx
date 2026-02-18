import React, { useEffect } from 'react';

export default function InlineNotice({
  type = 'info',
  message = '',
  onClose,
  autoHideMs = 4000,
}) {
  useEffect(() => {
    if (!message) return undefined;
    if (typeof onClose !== 'function') return undefined;
    if (!(type === 'success' || type === 'info')) return undefined;
    if (!Number.isFinite(autoHideMs) || autoHideMs <= 0) return undefined;
    const timer = setTimeout(() => onClose(), autoHideMs);
    return () => clearTimeout(timer);
  }, [type, autoHideMs, onClose, message]);

  if (!message) return null;

  const toneClass = type === 'success'
    ? 'bg-emerald-500/14 border-emerald-300/35 text-emerald-100'
    : type === 'warning'
      ? 'bg-amber-500/14 border-amber-300/35 text-amber-100'
      : 'bg-sky-500/14 border-sky-300/35 text-sky-100';

  return (
    <div className={`w-full rounded-xl border px-4 py-3 text-sm font-oswald ${toneClass}`}>
      <div className="flex items-start gap-3">
        <p className="flex-1 leading-relaxed">{message}</p>
        {typeof onClose === 'function' && (
          <button
            type="button"
            onClick={onClose}
            className="text-white/75 hover:text-white transition-colors text-sm font-semibold"
            aria-label="Cerrar aviso"
          >
            Cerrar
          </button>
        )}
      </div>
    </div>
  );
}
