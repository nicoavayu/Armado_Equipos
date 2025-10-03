import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import { useTimeout } from './useTimeout';

export const useAnimatedNavigation = () => {
  const navigate = useNavigate();
  const { setTimeoutSafe } = useTimeout();
  const isNavigatingRef = useRef(false);

  const navigateWithAnimation = (path, direction = 'forward') => {
    if (isNavigatingRef.current) return; // Anti-double-activation guard
    
    const currentPage = document.querySelector('.page-transition');
    if (currentPage) {
      currentPage.classList.add(direction === 'back' ? 'page-exit-back' : 'page-exit-forward');
    }
    
    isNavigatingRef.current = true;
    
    setTimeoutSafe(() => {
      navigate(path);
      isNavigatingRef.current = false;
    }, 300);
  };

  return { navigateWithAnimation };
};