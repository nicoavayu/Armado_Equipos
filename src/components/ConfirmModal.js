import React, { useRef, useEffect, useState } from 'react';

export default function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'CONFIRMAR',
  cancelText = 'CANCELAR',
  isDeleting = false,
}) {
  const overlayRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const focusTarget = cancelRef.current || confirmRef.current;
    try { focusTarget && focusTarget.focus(); } catch {
      // Focus attempt failed, continue anyway
    }

    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        if (isDeleting) return;
        e.preventDefault();
        onCancel && onCancel();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = [cancelRef.current, confirmRef.current].filter(Boolean);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', keyHandler, true);
    return () => document.removeEventListener('keydown', keyHandler, true);
  }, [isOpen, isDeleting, onCancel]);

  if (!isOpen) return null;



  const handleOverlayClick = () => {
    if (isDeleting) return;
    onCancel && onCancel();
  };

  return (
    <div
      ref={overlayRef}
      className={`
        fixed inset-0 bg-black/80 z-[2000] flex items-center justify-center p-4 
        transition-opacity duration-200 backdrop-blur-md
        ${visible ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'confirm-modal-title' : undefined}
      aria-describedby={message ? 'confirm-modal-message' : undefined}
    >
      <div
        className={`
          w-full max-w-[500px] bg-white/5 backdrop-blur-2xl rounded-[1.5rem] p-8 shadow-[0_32px_64px_rgba(0,0,0,0.5)] 
          border border-white/10 text-white transition-all duration-180 ease-[cubic-bezier(.2,.9,.3,1)]
          ${visible ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0'}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div id="confirm-modal-title" className="text-lg font-bold mb-2 font-['Oswald'] text-white">
            {title}
          </div>
        )}
        <div id="confirm-modal-message" className="text-sm text-white/85 mb-4">
          {message}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            ref={cancelRef}
            className="px-3.5 py-2.5 rounded-lg font-bold cursor-pointer border-none font-['Oswald'] bg-white/[0.06] text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-default"
            onClick={() => { if (isDeleting) return; onCancel && onCancel(); }}
            disabled={isDeleting}
            aria-disabled={isDeleting}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            className="px-3.5 py-2.5 rounded-lg font-bold cursor-pointer border-none font-['Oswald'] bg-gradient-to-tr from-[#f4d03f] to-[#f7dc6f] text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-default"
            onClick={() => { if (isDeleting) return; onConfirm && onConfirm(); }}
            disabled={isDeleting}
            aria-disabled={isDeleting}
          >
            {isDeleting ? (confirmText || 'ELIMINANDO…') : (confirmText || 'ELIMINAR')}
          </button>
        </div>
      </div>
    </div>
  );
}