import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TabBar from './TabBar';
import DirectFix from './DirectFix';

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

  const handleTabChange = (tab) => {
    // Navigation will be handled by TabBar component
  };

  return (
    <>
      <DirectFix />
      <Outlet />
      <TabBar 
        activeTab={getActiveTab()} 
        onTabChange={handleTabChange}
      />
    </>
  );
};

export default MainLayout;