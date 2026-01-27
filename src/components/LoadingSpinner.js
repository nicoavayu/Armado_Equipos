import React from 'react';


const LoadingSpinner = ({ size = 'medium' }) => {
  const sizeClasses = {
    small: 'w-6 h-6',
    medium: 'w-12 h-12',
    large: 'w-16 h-16',
  };

  return (
    <div className="flex justify-center items-center w-full h-full min-h-[100px]">
      <img
        src="/spinner.svg"
        alt="Loading..."
        className={`animate-spin ${sizeClasses[size] || sizeClasses.medium}`}
      />
    </div>
  );
};

export default LoadingSpinner;