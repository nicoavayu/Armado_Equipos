import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useKeyboard } from '../hooks/useKeyboard';

const Modal = ({
  isOpen,
  onClose,
  children,
  title,
  footer,
  className = '',
  classNameContent = '',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = false,
  disableEnterAnimation = false,
}) => {
  const modalRef = useRef(null);
  const { keyboardHeight, isKeyboardOpen } = useKeyboard();

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isKeyboardOpen) return undefined;

    const timeoutId = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) return;
      if (!modalRef.current || !modalRef.current.contains(activeElement)) return;
      activeElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 90);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isKeyboardOpen, isOpen, keyboardHeight]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (closeOnEscape && e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, closeOnEscape]);

  const handleBackdropClick = (e) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;
  const hasHeader = Boolean(title) || showCloseButton;
  const keyboardInsetPx = Math.max(0, keyboardHeight || 0);

  const modalContent = (
    <div
      data-modal-root="true"
      className={`fixed inset-0 bg-[#0a0718]/80 backdrop-blur-[5px] z-[10001] flex justify-center overflow-y-auto ${disableEnterAnimation ? '' : 'animate-[fadeIn_0.2s_ease-out]'}`}
      style={{
        alignItems: isKeyboardOpen ? 'flex-start' : 'center',
        paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
        paddingRight: 'max(1.25rem, env(safe-area-inset-right))',
        paddingBottom: isKeyboardOpen
          ? `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${keyboardInsetPx}px)`
          : 'max(1.25rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1.25rem, env(safe-area-inset-left))',
        transition: 'padding-bottom 140ms ease-out',
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className={`bg-[linear-gradient(170deg,#221b4a_0%,#181334_55%,#141029_100%)] rounded-2xl shadow-[0_22px_56px_rgba(6,4,18,0.7),inset_0_1px_0_rgba(255,255,255,0.07)] max-w-[95vw] max-h-full w-auto flex flex-col overflow-hidden border border-white/10 ${disableEnterAnimation ? '' : 'animate-[scaleIn_0.2s_ease-out]'} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {hasHeader && (
          <div className={`flex items-center px-5 py-4 border-b border-white/[0.08] shrink-0 ${title ? 'justify-between' : 'justify-end'}`}>
            {title ? <h2 className="text-white text-lg font-semibold m-0 tracking-[0.01em]">{title}</h2> : null}
            <button
              className="bg-white/[0.05] border border-white/10 text-white/60 text-xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 hover:text-white hover:bg-white/10 focus:outline-none focus:text-white focus:bg-white/10"
              onClick={onClose}
              aria-label="Cerrar modal"
              type="button"
            >
              ×
            </button>
          </div>
        )}
        <div className={`p-5 overflow-y-auto flex-1 touch-pan-y ${classNameContent}`}>
          {children}
        </div>
        {footer && (
          <div className="px-5 py-4 border-t border-white/[0.08] shrink-0">
            {footer}
          </div>
        )}
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default Modal;
