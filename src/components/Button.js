import React from 'react';

const Button = ({ 
  children, 
  onClick, 
  disabled = false, 
  loading = false, 
  variant = 'primary', 
  className = '', 
  style = {},
  loadingText = 'CARGANDO...',
  ariaLabel,
  ...props 
}) => {
  const getVariantClass = () => {
    switch (variant) {
      case 'whatsapp': return 'admin-btn-whatsapp';
      case 'danger': return 'admin-btn-danger';
      case 'secondary': return 'admin-btn-secondary';
      default: return 'admin-btn-primary';
    }
  };

  return (
    <button
      className={`voting-confirm-btn wipe-btn ${getVariantClass()} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        opacity: disabled || loading ? 0.6 : 1,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        ...style
      }}
      aria-label={ariaLabel}
      {...props}
    >
      {loading ? loadingText : children}
    </button>
  );
};

export default Button;