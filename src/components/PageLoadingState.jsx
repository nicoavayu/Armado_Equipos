import React from 'react';
import LoadingSpinner from './LoadingSpinner';

const PageLoadingState = ({ className = '' }) => {
  return (
    <div className={`w-full min-h-[60vh] flex items-center justify-center ${className}`.trim()}>
      <LoadingSpinner size="large" />
    </div>
  );
};

export default PageLoadingState;
