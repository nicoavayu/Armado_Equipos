import React from 'react';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import AmigosView from '../components/AmigosView';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';

const AmigosPage = () => {
  const goBackSmart = useSmartBackNavigation({
    fallback: '/',
  });

  return (
    <PageTransition>
      <div className="w-full pt-[80px]">
        <PageTitle title="AMIGOS" onBack={() => goBackSmart()}>AMIGOS</PageTitle>
        <div className="w-full flex flex-col items-center px-4 pt-0">
          <div className="w-full max-w-[500px]">
            <AmigosView />
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default AmigosPage;
