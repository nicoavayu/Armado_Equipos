import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MainLayout from '../components/MainLayout';
import { useTopSafeAreaApplied } from '../context/TopSafeAreaContext';

jest.mock('../hooks/useScrollReset', () => ({
  useScrollResetContainer: () => jest.fn(),
}));

jest.mock('../features/onboarding/OnboardingProvider', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('../features/onboarding/LazyOnboardingHost', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

jest.mock('../components/global-header/AwardsStoryContext', () => ({
  AwardsStoryProvider: ({ children }) => <>{children}</>,
}));

jest.mock('../components/TabBar', () => () => null);

const SAFE_TOP_CLASS = 'pt-[var(--safe-top,0px)]';

function SafeAreaProbe({ label }) {
  return <h1 data-top-safe-area-applied={String(useTopSafeAreaApplied())}>{label}</h1>;
}

function renderLayout(pathname) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<SafeAreaProbe label="Home" />} />
          <Route path="*" element={<SafeAreaProbe label="Página interna" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function renderMain(pathname) {
  return renderLayout(pathname).container.querySelector('main');
}

// Exactly one layer owns the top safe area per route: never zero (title under
// the Android 15+/iOS status bar), never two (double gap).
describe('MainLayout top safe area', () => {
  beforeEach(() => {
    window.scrollTo = jest.fn();
  });

  test.each([
    '/quiero-jugar',
    '/amigos',
    '/profile',
    '/notifications',
    '/desafios',
    '/desafios/equipos/partidos/match-1',
    '/partido/123',
    '/frecuentes/tpl-1',
    '/stats',
  ])('internal route %s pads <main> with the safe area', (pathname) => {
    const main = renderMain(pathname);
    expect(main).toHaveClass(SAFE_TOP_CLASS);
    expect(main).not.toHaveClass('pt-0');
  });

  test.each(['/', '/home'])('Home %s leaves it to the GlobalHeader', (pathname) => {
    const main = renderMain(pathname);
    expect(main).toHaveClass('pt-0');
    expect(main).not.toHaveClass(SAFE_TOP_CLASS);
  });

  test('the immersive /nuevo-partido wizard handles its own inset', () => {
    const main = renderMain('/nuevo-partido');
    expect(main).toHaveClass('pt-0');
  });

  test('the voting shell handles its own inset', () => {
    const main = renderMain('/?codigo=ABC123');
    expect(main).toHaveClass('pt-0');
  });
});

// Scrolling window carries the PageTitle away (it lives in a transformed
// ancestor), so without protection search boxes and cards scrolled under the
// clock and system icons. The scrim exists exactly where <main> owns the inset.
describe('MainLayout status bar scrim', () => {
  beforeEach(() => {
    window.scrollTo = jest.fn();
  });

  test.each(['/quiero-jugar', '/amigos', '/profile', '/partido/123'])(
    '%s renders a fixed, non-interactive scrim as tall as the inset, and tells children the inset is applied',
    (pathname) => {
      const { getByTestId, getByRole } = renderLayout(pathname);
      const scrim = getByTestId('status-bar-scrim');
      expect(scrim).toHaveClass('fixed', 'top-0', 'h-[var(--safe-top,0px)]', 'pointer-events-none');
      expect(scrim).toHaveAttribute('aria-hidden', 'true');
      // Above PageTitle/TabBar (z-1000), below GlobalHeader/loaders (z-1200).
      expect(scrim).toHaveClass('z-[1001]');
      expect(getByRole('heading')).toHaveAttribute('data-top-safe-area-applied', 'true');
    },
  );

  test.each(['/', '/nuevo-partido', '/?codigo=ABC123'])(
    '%s owns its inset elsewhere: no scrim and children must pad themselves',
    (pathname) => {
      const { queryByTestId, getByRole } = renderLayout(pathname);
      expect(queryByTestId('status-bar-scrim')).not.toBeInTheDocument();
      expect(getByRole('heading')).toHaveAttribute('data-top-safe-area-applied', 'false');
    },
  );
});
