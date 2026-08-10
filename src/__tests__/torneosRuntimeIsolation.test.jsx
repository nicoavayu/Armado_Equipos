import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import {
  PersonalGlobalNotice,
  PersonalRuntimeEffects,
  PlayerProductRouteBoundary,
  RouteScopedProviders,
  ScopedPublicVotingRouteIsolation,
  isPlayerProductRoute,
  isPublicSpecialWebRoute,
} from '../App';
import { initNativePushNotifications } from '../hooks/useNativeFeatures';
import { useNotificationRedirect } from '../hooks/useNotificationRedirect';
import { useRouteScrollReset } from '../hooks/useScrollReset';
import { loadGoogleMapsScript } from '../services/googleMapsLoader';
import { warmLikelyRoutes } from '../utils/routePrefetch';

let mockNativeRuntime = true;

jest.mock('../utils/runtimePlatform', () => ({
  isArma2NativeRuntime: () => mockNativeRuntime,
  getAuthenticatedProductHome: () => (mockNativeRuntime ? '/' : '/torneos'),
}));

jest.mock('../components/AuthProvider', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
  useAuth: () => ({
    user: { id: 'user-personal' },
    loading: false,
    authResolved: true,
  }),
}));

jest.mock('../components/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('../components/GlobalErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('../components/GlobalNoticeModal', () => ({
  __esModule: true,
  default: () => <div data-testid="global-notice" />,
}));

jest.mock('../components/PublicVotingRouteIsolation', () => ({
  __esModule: true,
  default: ({ children }) => (
    <div data-testid="public-voting-isolation">{children}</div>
  ),
}));

jest.mock('../context/NotificationContext', () => ({
  __esModule: true,
  NotificationProvider: ({ children }) => (
    <div data-testid="notification-provider">{children}</div>
  ),
}));

jest.mock('../context/BadgeContext', () => ({
  __esModule: true,
  BadgeProvider: ({ children }) => (
    <div data-testid="badge-provider">{children}</div>
  ),
}));

jest.mock('../hooks/useNativeFeatures', () => ({
  initNativePushNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../hooks/useNotificationRedirect', () => ({
  useNotificationRedirect: jest.fn(),
}));

jest.mock('../hooks/useScrollReset', () => ({
  useRouteScrollReset: jest.fn(),
}));

jest.mock('../services/googleMapsLoader', () => ({
  getGoogleMapsLoaderState: jest.fn(() => ({})),
  loadGoogleMapsScript: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/routePrefetch', () => ({
  warmLikelyRoutes: jest.fn(() => undefined),
}));

jest.mock('../utils/monitoring/analytics', () => ({
  track: jest.fn(),
}));

function CurrentPath() {
  return <span>{useLocation().pathname}</span>;
}

function RuntimeHarness() {
  return (
    <RouteScopedProviders>
      <PersonalRuntimeEffects />
      <ScopedPublicVotingRouteIsolation>
        <CurrentPath />
      </ScopedPublicVotingRouteIsolation>
      <PersonalGlobalNotice />
    </RouteScopedProviders>
  );
}

describe('Torneos global runtime isolation', () => {
  beforeEach(() => {
    mockNativeRuntime = true;
    jest.clearAllMocks();
    loadGoogleMapsScript.mockResolvedValue(undefined);
    initNativePushNotifications.mockResolvedValue(undefined);
    warmLikelyRoutes.mockReturnValue(undefined);
  });

  test('preserves personal providers and effects outside /torneos', async () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <RuntimeHarness />
      </MemoryRouter>,
    );

    expect(screen.getByText('/profile')).toBeInTheDocument();
    expect(screen.getByTestId('badge-provider')).toBeInTheDocument();
    expect(screen.getByTestId('notification-provider')).toBeInTheDocument();
    expect(screen.getByTestId('public-voting-isolation')).toBeInTheDocument();
    expect(screen.getByTestId('global-notice')).toBeInTheDocument();
    await waitFor(() => {
      expect(loadGoogleMapsScript).toHaveBeenCalledTimes(1);
      expect(initNativePushNotifications).toHaveBeenCalledTimes(1);
      expect(warmLikelyRoutes).toHaveBeenCalled();
    });
    expect(useNotificationRedirect).toHaveBeenCalledTimes(1);
    expect(useRouteScrollReset).toHaveBeenCalledTimes(1);
  });

  test('mounts none of the personal providers or effects inside /torneos', () => {
    render(
      <MemoryRouter initialEntries={['/torneos/organizacion/known/inicio']}>
        <RuntimeHarness />
      </MemoryRouter>,
    );

    expect(screen.getByText('/torneos/organizacion/known/inicio')).toBeInTheDocument();
    expect(screen.queryByTestId('badge-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notification-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('public-voting-isolation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('global-notice')).not.toBeInTheDocument();
    expect(loadGoogleMapsScript).not.toHaveBeenCalled();
    expect(initNativePushNotifications).not.toHaveBeenCalled();
    expect(warmLikelyRoutes).not.toHaveBeenCalled();
    expect(useNotificationRedirect).not.toHaveBeenCalled();
    expect(useRouteScrollReset).not.toHaveBeenCalled();
  });

  test('mounts no personal runtime while a browser player URL is redirected', () => {
    mockNativeRuntime = false;
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <RuntimeHarness />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('notification-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('global-notice')).not.toBeInTheDocument();
    expect(loadGoogleMapsScript).not.toHaveBeenCalled();
    expect(initNativePushNotifications).not.toHaveBeenCalled();
  });

  test.each([
    '/votar-equipos?codigo=H03G61',
    '/partido/42/invitacion?codigo=ABCD12&invite=0123456789abcdef0123456789abcdef',
    '/i/invite-token',
  ])('isolates the public/special web flow %s from the personal runtime', (entry) => {
    mockNativeRuntime = false;
    render(
      <MemoryRouter initialEntries={[entry]}>
        <RuntimeHarness />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('notification-provider')).not.toBeInTheDocument();
    expect(screen.getByTestId('public-voting-isolation')).toBeInTheDocument();
    expect(screen.queryByTestId('global-notice')).not.toBeInTheDocument();
    expect(loadGoogleMapsScript).not.toHaveBeenCalled();
    expect(initNativePushNotifications).not.toHaveBeenCalled();
    expect(warmLikelyRoutes).not.toHaveBeenCalled();
  });

  test.each([
    '/',
    '/home',
    '/profile',
    '/desafios/equipos/team-1',
  ])('blocks the player product route %s on web', (entry) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<PlayerProductRouteBoundary native={false} />}>
            <Route path="*" element={<div>Producto de jugadores</div>} />
          </Route>
          <Route path="/torneos" element={<div>Arma2 Torneos</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Arma2 Torneos')).toBeInTheDocument();
    expect(screen.queryByText('Producto de jugadores')).not.toBeInTheDocument();
  });

  test('preserves the traditional player product on native', () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route element={<PlayerProductRouteBoundary native />}>
            <Route path="/profile" element={<div>Perfil de jugador</div>} />
          </Route>
          <Route path="/torneos" element={<div>Arma2 Torneos</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Perfil de jugador')).toBeInTheDocument();
  });

  test.each([
    ['/votar-equipos?codigo=H03G61', '/votar-equipos'],
    [
      '/partido/42/invitacion?codigo=ABCD12&invite=0123456789abcdef0123456789abcdef',
      '/partido/:partidoId/invitacion',
    ],
    ['/i/invite-token', '/i/:token'],
    ['/partido-publico/42', '/partido-publico/:partidoId'],
  ])('preserves the special route %s on web', (entry, routePath) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<PlayerProductRouteBoundary native={false} />}>
            <Route path={routePath} element={<div>Flow especial</div>} />
          </Route>
          <Route path="/torneos" element={<div>Arma2 Torneos</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Flow especial')).toBeInTheDocument();
    expect(screen.queryByText('Arma2 Torneos')).not.toBeInTheDocument();
  });

  test('keeps public/special and player-product classifications disjoint', () => {
    const publicSpecialRoutes = [
      '/votar-equipos',
      '/partido/42/invitacion',
      '/i/invite-token',
      '/encuesta/42',
      '/resultados-encuesta/42',
      '/resultados/42',
      '/pagos/42',
      '/partido-publico/42',
    ];
    const playerProductRoutes = [
      '/',
      '/home',
      '/profile',
      '/nuevo-partido',
      '/desafios/equipos/team-1',
      '/admin/42',
      '/partido/42',
    ];

    publicSpecialRoutes.forEach((route) => {
      expect(isPublicSpecialWebRoute(route)).toBe(true);
      expect(isPlayerProductRoute(route)).toBe(false);
    });
    playerProductRoutes.forEach((route) => {
      expect(isPlayerProductRoute(route)).toBe(true);
      expect(isPublicSpecialWebRoute(route)).toBe(false);
    });
  });
});
