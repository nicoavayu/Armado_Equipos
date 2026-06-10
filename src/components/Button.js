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
  const getVariantClasses = () => {
    switch (variant) {
      case 'whatsapp':
        return 'bg-[#25D366] border border-white/25 text-white shadow-elev-1';
      case 'danger':
        return 'bg-fifa-accent border border-white/25 text-white shadow-elev-1';
      case 'secondary':
        return 'bg-white/[0.05] border border-[rgba(148,134,255,0.28)] text-white/90 backdrop-blur-sm hover:bg-white/[0.09] hover:border-[rgba(148,134,255,0.5)] hover:text-white';
      case 'primary':
      default:
        return 'bg-cta-gradient border border-white/15 text-white shadow-cta hover:brightness-110';
    }
  };

  return (
    <motion.button
      className={`
        w-full h-12 text-lg rounded-2xl flex items-center justify-center gap-2
        font-bebas font-semibold tracking-[0.8px] uppercase transition-all duration-200
        ${getVariantClasses()}
        ${className}
      `}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        opacity: disabled || loading ? 0.6 : 1,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        ...style,
      }}
      aria-label={ariaLabel}
      whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || loading ? 1 : 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      {...props}
    >
      {loading ? (
        <>
          <LoadingSpinner size="sm" />
          {loadingText}
        </>
      ) : children}
    </motion.button>
  );
};

export default Button;
