import React from 'react';

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = 'CONFIRMAR', cancelText = 'CANCELAR' }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px',
    }}>
      <div style={{
        background: 'rgba(30, 30, 30, 0.95)',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '400px',
        width: '90vw',
        border: '2px solid rgba(255, 255, 255, 0.2)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      }}>
        {title && (
          <div style={{
            color: '#fff',
            fontSize: '20px',
            fontWeight: 'bold',
            marginBottom: '16px',
            textAlign: 'center',
            fontFamily: 'Bebas Neue, Arial, sans-serif',
            letterSpacing: '0.5px',
          }}>
            {title}
          </div>
        )}
        
        <div style={{
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: '16px',
          marginBottom: '24px',
          textAlign: 'center',
          fontFamily: 'Oswald, Arial, sans-serif',
          lineHeight: '1.4',
        }}>
          {message}
        </div>
        
        <div style={{
          display: 'flex',
          gap: '12px',
          width: '100%',
        }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              background: 'transparent',
              border: '2px solid rgba(255, 255, 255, 0.4)',
              borderRadius: '6px',
              color: 'rgba(255, 255, 255, 0.8)',
              fontFamily: 'Bebas Neue, Arial, sans-serif',
              fontSize: '16px',
              padding: '12px 16px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.1)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.6)';
              e.target.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.4)';
              e.target.style.color = 'rgba(255, 255, 255, 0.8)';
            }}
          >
            {cancelText}
          </button>
          
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              background: '#DE1C49',
              border: '2px solid #DE1C49',
              borderRadius: '6px',
              color: '#fff',
              fontFamily: 'Bebas Neue, Arial, sans-serif',
              fontSize: '16px',
              padding: '12px 16px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#c41841';
              e.target.style.borderColor = '#c41841';
              e.target.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#DE1C49';
              e.target.style.borderColor = '#DE1C49';
              e.target.style.transform = 'translateY(0)';
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;