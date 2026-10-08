import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TabBar from './TabBar';
import { useScrollResetContainer } from '../hooks/useScrollReset';
// Direct imports, not the feature barrel: the barrel re-exports every onboarding surface
// (and framer-motion with them) into the initial bundle.
import OnboardingProvider from '../features/onboarding/OnboardingProvider';
import LazyOnboardingHost from '../features/onboarding/LazyOnboardingHost';
import GlobalHeader from './global-header/GlobalHeader';
import { AwardsStoryProvider } from './global-header/AwardsStoryContext';
import { isArma2SpaceRoot } from '../features/space-navigation/spaceNavigation';
import { TopSafeAreaAppliedContext } from '../context/TopSafeAreaContext';

const MainLayout = () => {
  const location = useLocation();
  const mainScrollResetRef = useScrollResetContainer();
  const searchParams = new URLSearchParams(location.search);
  const isVotingShellRoute = (location.pathname === '/' || location.pathname === '/home')
    && (searchParams.has('codigo') || searchParams.has('partidoId'));
  const isImmersiveNewMatchRoute = location.pathname === '/nuevo-partido';
  const mainPaddingBottomClass = isVotingShellRoute || isImmersiveNewMatchRoute
    ? 'pb-[env(safe-area-inset-bottom)] md:pb-[env(safe-area-inset-bottom)]'
    : 'pb-[104px] md:pb-[112px]';
  // Home se comporta como dashboard: acotamos <main> al viewport para que solo
  // scrollee el panel "Actividad reciente" (scroll interno) y no toda la página.
  // Se limita SOLO al home para no cambiar el scroll global de otras rutas
  // (p.ej. el scroll-lock por teclado del chat depende del scroll de window).
  const isHomeDashboard = (location.pathname === '/' || location.pathname === '/home') && !isVotingShellRoute;
  const showSpaceHeader = isArma2SpaceRoot(location.pathname) && !isVotingShellRoute;
  // La safe area superior la resuelve UNA sola capa por ruta:
  // - Home: el GlobalHeader (padding con --safe-top).
  // - Voting shell y /nuevo-partido: sus propias vistas inmersivas.
  // - Resto: <main>. Sus PageTitle `fixed` viven dentro de un ancestro con
  //   transform (PageTransition / translateZ(0)), que es su containing block,
  //   así que este padding baja header y contenido juntos debajo de status bar y
  //   cutout. Sin él (pt-0), el título queda debajo de la status bar en Android
  //   15+ edge-to-edge (targetSdk 35/36) y en iOS.
  const mainOwnsTopSafeArea = !(showSpaceHeader || isVotingShellRoute || isImmersiveNewMatchRoute);
  const mainPaddingTopClass = mainOwnsTopSafeArea ? 'pt-[var(--safe-top,0px)]' : 'pt-0';

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
    // OnboardingProvider wraps only the authenticated shell, so onboarding never
    // mounts on public routes (voting/invitation/login). OnboardingHost portals
    // the fullscreen flow to <body>; a failure inside it can't break the app.
    <OnboardingProvider>
      <AwardsStoryProvider>
        {/* En home dashboard fijamos la altura al viewport (h-[100dvh] + overflow-hidden)
          para que la cadena flex-1/min-h-0 realmente acote y el panel "Actividad reciente"
          scrollee internamente, sin invadir nunca la TabBar fija. El resto de las rutas
          mantiene min-h-[100dvh] (la página puede crecer y scrollear normalmente). */}
        <div className={`flex flex-col ${isHomeDashboard ? 'h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none' : 'min-h-[100dvh]'}`}>
          {showSpaceHeader && <GlobalHeader />}
          {/* App Shell / Main Content Container */}
          <main
            ref={mainScrollResetRef}
            className={`flex-1 flex flex-col ${mainPaddingTopClass} ${mainPaddingBottomClass} overflow-x-hidden ${isHomeDashboard ? 'min-h-0 overflow-y-hidden overscroll-none' : ''}`}
          >
            <TopSafeAreaAppliedContext.Provider value={mainOwnsTopSafeArea}>
              <Outlet />
            </TopSafeAreaAppliedContext.Provider>
          </main>

          {/* Protección de status bar: el padding de <main> sólo ubica bien el
            estado inicial. Al scrollear window, el PageTitle (dentro de un
            ancestro transformado) se va con el contenido y buscador/tarjetas
            pasaban debajo del reloj e íconos del sistema (Android 15+
            edge-to-edge / iOS). Esta franja fija del alto del inset, con el color
            del PageTitle, se funde con el header en reposo y tapa lo que scrollea
            debajo. z-[1001]: sobre PageTitle/TabBar (1000), bajo GlobalHeader
            (1200), loaders y modales. En web sin inset mide 0. */}
          {mainOwnsTopSafeArea && (
            <div
              aria-hidden="true"
              data-testid="status-bar-scrim"
              className="fixed inset-x-0 top-0 z-[1001] h-[var(--safe-top,0px)] pointer-events-none bg-[rgba(18,14,40,0.96)]"
            />
          )}

          {!isVotingShellRoute && !isImmersiveNewMatchRoute && (
            <TabBar
              activeTab={getActiveTab()}
              onTabChange={handleTabChange}
            />
          )}
        </div>
      </AwardsStoryProvider>
      <LazyOnboardingHost />
    </OnboardingProvider>
  );
};

export default MainLayout;
