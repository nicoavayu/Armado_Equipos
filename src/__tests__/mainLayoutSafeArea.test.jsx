import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MainLayout from '../components/MainLayout';

jest.mock('../hooks/useScrollReset', () => ({
  useScrollResetContainer: () => jest.fn(),
}));

jest.mock('../features/onboarding', () => ({
  OnboardingProvider: ({ children }) => <>{children}</>,
  OnboardingHost: () => null,
}));

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

jest.mock('../components/global-header/AwardsStoryContext', () => ({
  AwardsStoryProvider: ({ children }) => <>{children}</>,
}));

jest.mock('../components/TabBar', () => () => null);

const SAFE_TOP_CLASS = 'pt-[var(--safe-top,0px)]';

function renderMain(pathname) {
  const { container } = render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<h1>Home</h1>} />
          <Route path="*" element={<h1>Página interna</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return container.querySelector('main');
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
