import React, { useRef, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';

export default function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  isDeleting = false,
  singleButton = false,
  danger = false,
}) {
  const overlayRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const [visible, setVisible] = useState(false);

  // Debug logs
  useEffect(() => {
    console.log('[CONFIRM_MODAL] State changed:', { isOpen, visible, isDeleting });
  }, [isOpen, visible, isDeleting]);

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
        console.log('[CONFIRM_MODAL] Escape key pressed, calling onCancel');
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

  if (!isOpen) {
    console.log('[CONFIRM_MODAL] Not open, returning null');
    return null;
  }

  const handleOverlayClick = (e) => {
    console.log('[CONFIRM_MODAL] Backdrop clicked');
    if (isDeleting) {
      console.log('[CONFIRM_MODAL] isDeleting=true, not closing');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    console.log('[CONFIRM_MODAL] Calling onCancel from backdrop');
    onCancel && onCancel();
  };

  const handleCancelClick = (e) => {
    console.log('[CONFIRM_MODAL] Cancel button clicked');
    e.preventDefault();
    e.stopPropagation();
    onCancel && onCancel();
  };

  const handleConfirmClick = (e) => {
    console.log('[CONFIRM_MODAL] Confirm button clicked, isDeleting:', isDeleting);
    e.preventDefault();
    e.stopPropagation();
    if (isDeleting) {
      console.log('[CONFIRM_MODAL] isDeleting=true, ignoring click');
      return;
    }
    onConfirm && onConfirm();
  };

  const modalContent = (
    <div
      ref={overlayRef}
      className={`
        fixed inset-0 bg-black/80 z-[20000] flex items-center justify-center p-4 
        transition-opacity duration-200 backdrop-blur-md
        ${visible ? 'opacity-100' : 'opacity-0'}
      `}
      style={{ pointerEvents: 'auto' }}
      onMouseDown={handleOverlayClick}
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
        style={{ pointerEvents: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div id="confirm-modal-title" className="text-2xl leading-none font-oswald font-semibold tracking-[0.01em] mb-2 text-white">
            {title}
          </div>
        )}
        <div id="confirm-modal-message" className="text-base leading-relaxed text-white/85 mb-6 font-oswald">
          {message}
        </div>
        <div className="flex gap-3 justify-end">
          {!singleButton && (
            <button
              ref={cancelRef}
              className="min-h-[52px] min-w-[128px] px-6 rounded-2xl text-[16px] font-semibold tracking-[0.01em] font-oswald whitespace-nowrap cursor-pointer border border-slate-600 bg-white/[0.06] text-white hover:bg-white/10 hover:border-slate-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-default transition-all"
              onMouseDown={handleCancelClick}
              onClick={handleCancelClick}
              disabled={false}
              aria-disabled={false}
            >
              {cancelText}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`min-h-[52px] min-w-[132px] px-6 rounded-2xl text-[16px] font-semibold tracking-[0.01em] font-oswald whitespace-nowrap cursor-pointer border-0 text-white hover:shadow-lg hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-default transition-all ${danger ? 'bg-[#f44336]' : 'bg-[#8178e5]'}`}
            onMouseDown={handleConfirmClick}
            onClick={handleConfirmClick}
            disabled={isDeleting}
            aria-disabled={isDeleting}
          >
            {isDeleting ? 'Procesando…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  // Renderizar via portal a document.body para escapar de overlays
  return ReactDOM.createPortal(modalContent, document.body);
}
