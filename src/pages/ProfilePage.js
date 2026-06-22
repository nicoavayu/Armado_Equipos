import logger from '../utils/logger';
import React, { useEffect } from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import ProfileEditor from '../components/ProfileEditor';

const ProfilePage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();

  // Debug: Monitor horizontal overflow offenders in DEV mode
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const checkOverflow = () => {
        const offenders = [];
        document.querySelectorAll('*').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.right > window.innerWidth + 1 || rect.left < -1) {
            offenders.push({
              element: el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : ''),
              right: rect.right,
              viewport: window.innerWidth,
              left: rect.left,
            });
          }
        });
        if (offenders.length > 0) {
          logger.warn('⚠️ Horizontal Overflow Detected:', offenders.length, 'offenders');
          logger.table(offenders);
        }
      };

      const timer = setTimeout(checkOverflow, 2000);
      window.addEventListener('resize', checkOverflow);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', checkOverflow);
      };
    }
  }, []);

  return (
    <PageTransition>
      <div
        className="w-full min-h-full relative flex flex-col text-white selection:bg-primary/30 overflow-x-hidden"
        style={{
          background: 'var(--app-bg-gradient)',
          backgroundAttachment: 'fixed',
          overflowX: 'clip',
        }}
      >
        <PageTitle position="static" onBack={() => navigateWithAnimation('/', 'back')}>
          EDITAR PERFIL
        </PageTitle>

        <main className="w-full flex-1 overflow-visible">
          <ProfileEditor
            isOpen={true}
            onClose={() => navigateWithAnimation('/', 'back')}
            isEmbedded={true}
          />
        </main>
      </div>
    </PageTransition>
  );
};

export default ProfilePage;
