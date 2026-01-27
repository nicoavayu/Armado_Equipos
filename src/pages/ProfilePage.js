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
          console.warn('⚠️ Horizontal Overflow Detected:', offenders.length, 'offenders');
          console.table(offenders);
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
        className="min-h-[100svh] h-[100svh] w-full overflow-x-clip flex flex-col relative text-white"
        style={{
          minHeight: '100svh',
          backgroundImage: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
          backgroundAttachment: 'fixed',
        }}
      >
        {/* Fixed Top Title */}
        <div className="flex-none h-[72px] relative z-[1000]">
          <PageTitle onBack={() => navigateWithAnimation('/', 'back')}>EDITAR PERFIL</PageTitle>
        </div>

        {/* Main scrollable layout managed by ProfileEditor's internal logic for isEmbedded */}
        <ProfileEditor
          isOpen={true}
          onClose={() => navigateWithAnimation('/', 'back')}
          isEmbedded={true}
        />
      </div>
    </PageTransition>
  );
};

export default ProfilePage;
