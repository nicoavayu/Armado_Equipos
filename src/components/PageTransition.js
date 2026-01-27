import React, { useState, useEffect } from 'react';

const PageTransition = ({ children, direction = 'forward' }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div
      className={`w-full h-full overflow-x-hidden transition-all duration-300 ease-out ${isVisible
        ? 'opacity-100 translate-x-0'
        : 'opacity-0 translate-x-full'
      } ${direction === 'back' ? 'slide-back' : 'slide-forward'}`}
    >
      {children}
    </div>
  );
};

export default PageTransition;