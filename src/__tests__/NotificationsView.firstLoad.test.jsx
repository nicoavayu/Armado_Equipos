import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseNotifications = jest.fn();

jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_REMINDER_12H_LEAD_MS: 12 * 60 * 60 * 1000,
  SURVEY_REMINDER_1H_LEAD_MS: 60 * 60 * 1000,
  SURVEY_REMINDER_LEAD_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
  SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE: 3,
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../context/NotificationContext', () => ({
  useNotifications: () => mockUseNotifications(),
}));

jest.mock('../hooks/useAmigos', () => ({
  useAmigos: () => ({ acceptFriendRequest: jest.fn(), rejectFriendRequest: jest.fn() }),
}));

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const NotificationsView = require('../components/NotificationsView').default;

const baseContext = {
  notifications: [],
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  fetchNotifications: jest.fn(),
  unreadCount: { total: 0 },
};

const renderView = () => render(<MemoryRouter><NotificationsView /></MemoryRouter>);

test('while the first fetch is in flight the inbox shows it is loading, not that it is empty', () => {
  mockUseNotifications.mockReturnValue({ ...baseContext, notificationsReady: false });
  renderView();
  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getAllByTestId('notification-skeleton')).toHaveLength(3);
  expect(screen.queryByText(/sin notificaciones/i)).not.toBeInTheDocument();
});

test('once loaded, an empty inbox says so', () => {
  mockUseNotifications.mockReturnValue({ ...baseContext, notificationsReady: true });
  renderView();
  expect(screen.getByText(/sin notificaciones/i)).toBeInTheDocument();
  expect(screen.queryByTestId('notification-skeleton')).not.toBeInTheDocument();
});

test('without the flag (older providers) the view behaves as before', () => {
  mockUseNotifications.mockReturnValue(baseContext);
  renderView();
  expect(screen.getByText(/sin notificaciones/i)).toBeInTheDocument();
});
