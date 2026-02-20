import React from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import AmigosView from '../components/AmigosView';

const AmigosPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <PageTransition>
      <div className="min-h-[100dvh] pt-[84px]">
        <PageTitle title="AMIGOS" onBack={() => navigateWithAnimation('/', 'back')}>AMIGOS</PageTitle>
        <div className="w-full flex flex-col items-center px-4">
          <div className="w-full max-w-[500px]">
            <AmigosView />
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default AmigosPage;
