import React, { useState, useEffect } from 'react';
import './PageTransition.css';

const PageTransition = ({ children, direction = 'forward' }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className={`page-transition ${isVisible ? 'page-enter' : ''} ${direction === 'back' ? 'slide-back' : 'slide-forward'}`}>
      {children}
    </div>
  );
};

export default PageTransition;