import React from 'react';


const LoadingSpinner = ({ size = 'medium', fullScreen = false, className = '' }) => {
  const sizeClasses = {
    small: 'w-6 h-6',
    medium: 'w-12 h-12',
    large: 'w-16 h-16',
  };

  const wrapperClasses = fullScreen
    ? 'fixed inset-0 flex items-center justify-center'
    : 'flex items-center justify-center w-full h-full';

  return (
    <div className={`${wrapperClasses} ${className}`.trim()}>
      <img
        src="/spinner.svg"
        alt="Loading..."
        className={`animate-spin ${sizeClasses[size] || sizeClasses.medium}`}
      />
    </div>
  );
};

export default LoadingSpinner;