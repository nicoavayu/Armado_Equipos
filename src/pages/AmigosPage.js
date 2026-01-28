import React from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import AmigosView from '../components/AmigosView';

const AmigosPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <PageTransition>
      <div className="min-h-[100dvh] pb-24 pt-[80px]">
        <div className="w-full max-w-7xl mx-auto px-4">
          <PageTitle title="AMIGOS" onBack={() => navigateWithAnimation('/', 'back')}>AMIGOS</PageTitle>
          <AmigosView />
        </div>
      </div>
    </PageTransition>
  );
};

export default AmigosPage;
