import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TabBar from './TabBar';
import { useScrollResetContainer } from '../hooks/useScrollReset';

const MainLayout = () => {
  const location = useLocation();
  const mainScrollResetRef = useScrollResetContainer();
  const searchParams = new URLSearchParams(location.search);
  const isVotingShellRoute = (location.pathname === '/' || location.pathname === '/home')
    && (searchParams.has('codigo') || searchParams.has('partidoId'));
  const mainPaddingBottomClass = isVotingShellRoute
    ? 'pb-[env(safe-area-inset-bottom)] md:pb-[env(safe-area-inset-bottom)]'
    : 'pb-[104px] md:pb-[112px]';
  const mainPaddingTopClass = 'pt-[var(--safe-top,0px)]';
  // Home se comporta como dashboard: acotamos <main> al viewport para que solo
  // scrollee el panel "Actividad reciente" (scroll interno) y no toda la página.
  // Se limita SOLO al home para no cambiar el scroll global de otras rutas
  // (p.ej. el scroll-lock por teclado del chat depende del scroll de window).
  const isHomeDashboard = (location.pathname === '/' || location.pathname === '/home') && !isVotingShellRoute;

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.classList.toggle('home-dashboard-active', isHomeDashboard);
    body.classList.toggle('home-dashboard-active', isHomeDashboard);

    if (isHomeDashboard) {
      window.scrollTo(0, 0);
    }

    return () => {
      root.classList.remove('home-dashboard-active');
      body.classList.remove('home-dashboard-active');
    };
  }, [isHomeDashboard]);

  // Determine active tab based on current route
  const getActiveTab = () => {
    if (location.pathname === '/') return 'home';
    if (location.pathname === '/nuevo-partido') return 'votacion';
    if (location.pathname.includes('votacion')) return 'votacion';
    if (location.pathname.includes('/desafios')) return 'desafios';
    if (location.pathname.includes('/quiero-jugar/equipos')) return 'desafios';
    if (location.pathname.includes('quiero-jugar')) return 'quiero-jugar';
    if (location.pathname.includes('profile')) return 'profile';
    if (location.pathname.includes('notifications')) return 'notifications';
    if (location.pathname.includes('amigos')) return 'amigos';
    return 'home';
  };

  const handleTabChange = (_tab) => {
    // Navigation will be handled by TabBar component
  };

  return (
    // En home dashboard fijamos la altura al viewport (h-[100dvh] + overflow-hidden)
    // para que la cadena flex-1/min-h-0 realmente acote y el panel "Actividad reciente"
    // scrollee internamente, sin invadir nunca la TabBar fija. El resto de las rutas
    // mantiene min-h-[100dvh] (la página puede crecer y scrollear normalmente).
    <div className={`flex flex-col ${isHomeDashboard ? 'h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none' : 'min-h-[100dvh]'}`}>
      {/* App Shell / Main Content Container */}
      <main
        ref={mainScrollResetRef}
        className={`flex-1 flex flex-col ${mainPaddingTopClass} ${mainPaddingBottomClass} overflow-x-hidden ${isHomeDashboard ? 'min-h-0 overflow-y-hidden overscroll-none' : ''}`}
      >
        <Outlet />
      </main>

      {!isVotingShellRoute && (
        <TabBar
          activeTab={getActiveTab()}
          onTabChange={handleTabChange}
        />
      )}
    </div>
  );
};

export default MainLayout;
