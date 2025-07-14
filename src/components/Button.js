import React from 'react';
import { motion } from 'framer-motion';
import LoadingSpinner from './LoadingSpinner';

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
    <motion.button
      className={`voting-confirm-btn wipe-btn ${getVariantClass()} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        opacity: disabled || loading ? 0.6 : 1,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        ...style
      }}
      aria-label={ariaLabel}
      whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || loading ? 1 : 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      {...props}
    >
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LoadingSpinner size="sm" message="" />
          {loadingText}
        </div>
      ) : children}
    </motion.button>
  );
};

export default Button;