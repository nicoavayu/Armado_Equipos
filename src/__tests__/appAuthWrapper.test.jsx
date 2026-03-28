import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppAuthWrapper } from '../App';

const mockUseAuth = jest.fn();
const mockSetAuthReturnTo = jest.fn();

jest.mock('../components/AuthProvider', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}));

jest.mock('../utils/authReturnTo', () => ({
  setAuthReturnTo: (...args) => mockSetAuthReturnTo(...args),
}));

jest.mock('../components/MainLayout', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('../components/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('../components/GlobalErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('../components/LoadingSpinner', () => ({
  __esModule: true,
  default: () => <div>Loading</div>,
}));

jest.mock('../components/GlobalNoticeModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../context/NotificationContext', () => ({
  __esModule: true,
  NotificationProvider: ({ children }) => <>{children}</>,
}));

jest.mock('../context/BadgeContext', () => ({
  __esModule: true,
  BadgeProvider: ({ children }) => <>{children}</>,
}));

jest.mock('../hooks/useNativeFeatures', () => ({
  initNativePushNotifications: jest.fn(),
}));

jest.mock('../hooks/useNotificationRedirect', () => ({
  useNotificationRedirect: jest.fn(),
}));

jest.mock('../hooks/useScrollReset', () => ({
  useRouteScrollReset: jest.fn(),
}));

jest.mock('../utils/monitoring/analytics', () => ({
  track: jest.fn(),
}));

describe('AppAuthWrapper', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockSetAuthReturnTo.mockReset();
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      authResolved: true,
    });
  });

  test('does not allow private routes to bypass auth with codigo query param', () => {
    render(
      <MemoryRouter initialEntries={['/admin/123?codigo=QT97MX']}>
        <Routes>
          <Route element={<AppAuthWrapper />}>
            <Route path="/admin/:partidoId" element={<div>Admin privada</div>} />
          </Route>
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.queryByText('Admin privada')).not.toBeInTheDocument();
    expect(mockSetAuthReturnTo).toHaveBeenCalledWith('/admin/123?codigo=QT97MX');
  });
});
