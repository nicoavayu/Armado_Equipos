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
      className={`fixed inset-0 bg-[#0a0718]/85 z-[10001] flex justify-center overflow-y-auto ${disableEnterAnimation ? '' : 'animate-[fadeIn_0.2s_ease-out]'}`}
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
        className={`relative bg-[linear-gradient(168deg,#241c52_0%,#171234_52%,#110d26_100%)] rounded-3xl shadow-[0_24px_64px_rgba(5,3,16,0.75),inset_0_1px_0_rgba(255,255,255,0.08)] max-w-[95vw] max-h-full w-auto flex flex-col overflow-hidden border border-[rgba(148,134,255,0.22)] ${disableEnterAnimation ? '' : 'animate-[scaleIn_0.2s_ease-out]'} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accent hairline: violet→magenta sweep along the top edge */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 right-0 h-[2px] bg-[linear-gradient(90deg,transparent_2%,rgba(139,92,255,0.85)_30%,rgba(236,0,125,0.7)_72%,transparent_98%)]"
        />
        {hasHeader && (
          <div className={`flex items-center px-5 py-4 border-b border-white/[0.07] shrink-0 ${title ? 'justify-between' : 'justify-end'}`}>
            {title ? (
              <h2 className="text-white text-[17px] font-bold m-0 tracking-[0.01em] flex items-center gap-2.5">
                <span aria-hidden="true" className="w-1 h-[18px] rounded-full bg-[linear-gradient(180deg,#ec007d,#8b5cff)] shadow-[0_0_10px_rgba(236,0,125,0.45)] shrink-0" />
                {title}
              </h2>
            ) : null}
            <button
              className="bg-white/[0.06] border border-white/10 text-white/60 text-xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:text-white hover:bg-white/[0.12] focus:outline-none focus:text-white focus:bg-white/[0.12]"
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
          <div className="px-5 py-4 border-t border-white/[0.07] shrink-0 bg-[rgba(12,10,29,0.45)]">
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
