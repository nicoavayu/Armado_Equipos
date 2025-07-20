import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ size = 'medium' }) => {
  const sizeClass = `spinner-${size}`;
  
  return (
    <div className="spinner-container">
      <img 
        src="/spinner.svg" 
        alt="Loading..." 
        className={`spinner ${sizeClass}`}
      />
    </div>
  );
};

export default LoadingSpinner;