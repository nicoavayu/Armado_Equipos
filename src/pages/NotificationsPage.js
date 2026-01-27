import React from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import NotificationsView from '../components/NotificationsView';

const NotificationsPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <>
      <PageTitle onBack={() => navigateWithAnimation('/', 'back')}>NOTIFICACIONES</PageTitle>
      <PageTransition>
        <div className="min-h-screen w-full overflow-y-auto" style={{ paddingTop: 'calc(64px + 10px + env(safe-area-inset-top))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <NotificationsView />
        </div>
      </PageTransition>
    </>
  );
};

export default NotificationsPage;
