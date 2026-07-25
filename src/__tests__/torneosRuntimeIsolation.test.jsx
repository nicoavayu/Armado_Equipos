import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  PersonalGlobalNotice,
  PersonalRuntimeEffects,
  RouteScopedProviders,
  ScopedPublicVotingRouteIsolation,
} from '../App';
import { initNativePushNotifications } from '../hooks/useNativeFeatures';
import { useNotificationRedirect } from '../hooks/useNotificationRedirect';
import { useRouteScrollReset } from '../hooks/useScrollReset';
import { loadGoogleMapsScript } from '../services/googleMapsLoader';
import { warmLikelyRoutes } from '../utils/routePrefetch';

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
});
