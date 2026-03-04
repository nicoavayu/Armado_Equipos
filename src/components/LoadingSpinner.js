import React from 'react';
import ReactDOM from 'react-dom';


const LoadingSpinner = ({ size = 'medium', fullScreen = false, className = '' }) => {
  const sizeClasses = {
    xs: 'w-4 h-4',
    sm: 'w-6 h-6',
    small: 'w-6 h-6',
    md: 'w-12 h-12',
    medium: 'w-12 h-12',
    lg: 'w-16 h-16',
    large: 'w-16 h-16',
  };

  const spinnerClasses = `animate-spin ${sizeClasses[String(size).toLowerCase()] || sizeClasses.medium} ${className}`.trim();

  if (fullScreen) {
    const fullscreenSpinner = (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center pointer-events-none">
        <img
          src="/spinner.svg"
          alt="Loading..."
          className={spinnerClasses}
        />
      </div>
    );

    if (typeof document !== 'undefined' && document.body) {
      return ReactDOM.createPortal(fullscreenSpinner, document.body);
    }

    return fullscreenSpinner;
  }

  return (
    <img
      src="/spinner.svg"
      alt="Loading..."
      className={spinnerClasses}
    />
  );
};

export default LoadingSpinner;
