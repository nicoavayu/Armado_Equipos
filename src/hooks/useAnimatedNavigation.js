import { useNavigate } from 'react-router-dom';

export const useAnimatedNavigation = () => {
  const navigate = useNavigate();

  const navigateWithAnimation = (path, direction = 'forward') => {
    const currentPage = document.querySelector('.page-transition');
    if (currentPage) {
      currentPage.classList.add(direction === 'back' ? 'page-exit-back' : 'page-exit-forward');
    }
    
    setTimeout(() => {
      navigate(path);
    }, 300);
  };

  return { navigateWithAnimation };
};