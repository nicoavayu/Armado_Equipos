import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';


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
}) => {
  const modalRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen]);

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

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-[4px] z-[10001] flex items-center justify-center animate-[fadeIn_0.2s_ease-out]"
      style={{
        paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
        paddingRight: 'max(1.25rem, env(safe-area-inset-right))',
        paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1.25rem, env(safe-area-inset-left))',
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className={`bg-[#1a1a1a] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] max-w-[95vw] max-h-full w-auto flex flex-col overflow-hidden border border-[#333] animate-[scaleIn_0.2s_ease-out] ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex justify-between items-center p-5 border-b border-[#333] shrink-0">
            <h2 className="text-white text-xl font-semibold m-0">{title}</h2>
            <button
              className="bg-transparent border-none text-[#999] text-2xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:text-white hover:bg-white/10 focus:outline-none focus:text-white focus:bg-white/10"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        )}
        <div className={`p-6 overflow-y-auto flex-1 touch-pan-y ${classNameContent}`}>
          {children}
        </div>
        {footer && (
          <div className="p-6 border-t border-[#333] shrink-0">
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
