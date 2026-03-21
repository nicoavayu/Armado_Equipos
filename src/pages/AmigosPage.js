import React from 'react';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import AmigosView from '../components/AmigosView';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';

const AmigosPage = () => {
  const goBackSmart = useSmartBackNavigation({
    fallback: '/',
  });

  console.debug('[AMIGOS_DEBUG][AmigosPage][render]');

  return (
    <PageTransition>
      <div className="w-full pt-[80px]">
        {process.env.NODE_ENV !== 'production' && (
          <div className="fixed right-3 top-3 z-[16000] rounded border-4 border-red-950 bg-red-600 px-3 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-white shadow-[0_12px_32px_rgba(127,29,29,0.55)]">
            AMIGOS PAGE RENDER
          </div>
        )}
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
