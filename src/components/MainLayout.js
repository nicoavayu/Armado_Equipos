import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TabBar from './TabBar';

const MainLayout = () => {
  const location = useLocation();

  // Determine active tab based on current route
  const getActiveTab = () => {
    if (location.pathname === '/') return 'home';
    if (location.pathname === '/nuevo-partido') return 'votacion';
    if (location.pathname.includes('votacion')) return 'votacion';
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
    <div className="flex flex-col min-h-[100dvh]">
      {/* App Shell / Main Content Container */}
      <main className="flex-1 flex flex-col pt-[var(--safe-top,0px)] pb-[calc(var(--safe-bottom,0px)+70px)] md:pb-[calc(var(--safe-bottom,0px)+80px)] overflow-x-hidden">
        <Outlet />
      </main>

      <TabBar
        activeTab={getActiveTab()}
        onTabChange={handleTabChange}
      />
    </div>
  );
};

export default MainLayout;
