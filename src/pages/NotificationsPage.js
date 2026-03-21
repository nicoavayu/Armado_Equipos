import React from 'react';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import NotificationsView from '../components/NotificationsView';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';

const NotificationsPage = () => {
  const goBackSmart = useSmartBackNavigation({
    fallback: '/',
    forceFallback: true,
  });

  return (
    <PageTransition>
      <div className="min-h-[100dvh] pt-[80px]">
        <PageTitle onBack={() => goBackSmart()}>
          NOTIFICACIONES
        </PageTitle>
        <div className="w-full flex flex-col items-center px-4 pt-0">
          <div className="w-full max-w-[600px]">
            <NotificationsView />
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default NotificationsPage;
