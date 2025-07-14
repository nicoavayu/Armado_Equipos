import React from 'react';
import { motion } from 'framer-motion';

const LoadingSpinner = ({ size = 'md', message = 'Cargando...', variant = 'spinner' }) => {
  const sizeClasses = {
    sm: 'loading-spinner-sm',
    md: 'loading-spinner-md', 
    lg: 'loading-spinner-lg'
  };

  if (variant === 'shimmer') {
    return (
      <div className="shimmer-container">
        <div className="shimmer-item"></div>
        <div className="shimmer-item"></div>
        <div className="shimmer-item"></div>
      </div>
    );
  }

  return (
    <div className="loading-spinner-container">
      <motion.div 
        className={`loading-spinner ${sizeClasses[size]}`}
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      ></motion.div>
      {message && <p className="loading-message">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;