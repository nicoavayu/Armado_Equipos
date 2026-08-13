import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MainLayout from '../components/MainLayout';
import {
  isArma2SpaceRoot,
  shouldShowTorneosSpaceHeader,
} from '../features/space-navigation/spaceNavigation';

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

function renderPersonalRoute(pathname) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<h1>Home</h1>} />
          <Route path="*" element={<h1>Header contextual</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('SpaceHeader root-only mounting', () => {
  beforeEach(() => {
    window.scrollTo = jest.fn();
  });

  test.each(['/', '/home'])('mounts on the Arma2 root %s', (pathname) => {
    renderPersonalRoute(pathname);
    expect(screen.getByTestId('global-header')).toBeInTheDocument();
    expect(isArma2SpaceRoot(pathname)).toBe(true);
  });

  test.each([
    '/quiero-jugar',
    '/profile',
    '/desafios',
    '/notifications',
    '/nuevo-partido',
  ])('does not mount on the Arma2 internal route %s', (pathname) => {
    renderPersonalRoute(pathname);
    expect(screen.queryByTestId('global-header')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Header contextual' })).toBeInTheDocument();
    expect(isArma2SpaceRoot(pathname)).toBe(false);
  });

  test.each([
    ['/torneos', true],
    ['/torneos/', true],
    ['/torneos/mis-torneos', true],
    ['/torneos/mis-partidos', true],
    ['/torneos/comunicados', true],
    ['/torneos/nueva-organizacion', true],
    ['/torneos/organizacion/org-1/inicio', true],
    ['/torneos/organizacion/org-1/fixture', true],
    ['/torneos/organizacion/org-1/competencia/tabla', true],
    ['/torneos/organizacion/org-1/fixture/grupos', false],
    ['/torneos/organizacion/org-1/torneos/nuevo', false],
    ['/torneos/mis-partidos/partido-1', false],
    ['/torneos/torneo/torneo-1', false],
  ])('defines Torneos route %s header visibility as %s', (pathname, expected) => {
    expect(shouldShowTorneosSpaceHeader(pathname)).toBe(expected);
  });
});
