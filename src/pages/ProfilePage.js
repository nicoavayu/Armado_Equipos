import React, { useEffect } from 'react';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import PageTransition from '../components/PageTransition';
import PageTitle from '../components/PageTitle';
import ProfileEditor from '../components/ProfileEditor';

const ProfilePage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();

  const headerRef = React.useRef(null);
  const [headerHeight, setHeaderHeight] = React.useState(72);

  // Measure real header height (safe area / font / device differences)
  React.useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().height;
      if (next && Math.abs(next - headerHeight) > 0.5) setHeaderHeight(next);
    });
    ro.observe(el);

    // Initial sync
    const initial = el.getBoundingClientRect().height;
    if (initial && Math.abs(initial - headerHeight) > 0.5) setHeaderHeight(initial);

    return () => ro.disconnect();
  }, [headerHeight]);

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
        className="h-screen w-full relative text-white selection:bg-primary/30 overflow-x-hidden"
        style={{
          backgroundImage: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
          backgroundAttachment: 'fixed',
        }}
      >
        {/* 1. FIXED HEADER (Z-50) */}
        <header
          ref={headerRef}
          className="fixed top-0 left-0 right-0 h-[72px] z-50 bg-[#1e1b4b]/95 backdrop-blur-md border-b border-white/10 flex items-center"
        >
          <PageTitle onBack={() => navigateWithAnimation('/', 'back')}>EDITAR PERFIL</PageTitle>
        </header>

        {/* 2. MAIN SCROLLABLE BODY (Z-10) */}
        <main
          className="absolute left-0 right-0 bottom-0 overflow-y-auto overflow-x-hidden custom-scrollbar"
          style={{ top: 0, paddingTop: headerHeight }}
        >
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
