import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = jest.fn();
const mockUseAuth = jest.fn();
const mockUseNotifications = jest.fn();
const mockMarkAsRead = jest.fn();
const mockSupabaseFrom = jest.fn();
const mockListMyTeamMatches = jest.fn(async () => []);

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../context/NotificationContext', () => ({
  useNotifications: () => mockUseNotifications(),
}));

jest.mock('../hooks/useInterval', () => ({
  useInterval: () => ({
    setIntervalSafe: jest.fn(),
    clearIntervalSafe: jest.fn(),
  }),
}));

jest.mock('../hooks/useRefreshOnVisibility', () => ({
  useRefreshOnVisibility: jest.fn(),
}));

jest.mock('../services/db/teamChallenges', () => ({
  listMyTeamMatches: (...args) => mockListMyTeamMatches(...args),
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: (...args) => mockSupabaseFrom(...args),
  },
  updateProfile: jest.fn(),
  addFreePlayer: jest.fn(),
  removeFreePlayer: jest.fn(),
}));

jest.mock('../utils/activityFeed', () => ({
  buildActivityFeed: jest.fn(),
}));

jest.mock('../utils/notificationRouter', () => ({
  openNotification: jest.fn(),
}));

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

jest.mock('../utils/routePrefetch', () => ({
  prefetchRoute: jest.fn(),
}));

jest.mock('../components/NotificationsBell', () => function MockNotificationsBell({ onClick }) {
  return <button type="button" onClick={onClick}>Notificaciones</button>;
});

jest.mock('../components/HomeWelcomeCard', () => function MockHomeWelcomeCard() {
  return <div data-testid="home-welcome-card" />;
});

jest.mock('../components/QuickAccessRail', () => function MockQuickAccessRail() {
  return <div data-testid="quick-access-rail" />;
});

jest.mock('../components/ProximosPartidos', () => function MockProximosPartidos() {
  return <div data-testid="proximos-partidos" />;
});

const FifaHomeContent = require('../components/FifaHomeContent').default;
const { buildActivityFeed } = require('../utils/activityFeed');

const activityItems = [
  {
    id: 'activity-friend_request-user-2',
    type: 'friend_request',
    title: 'Nueva solicitud de amistad',
    subtitle: 'Cami',
    createdAt: '2026-06-25T12:00:00.000Z',
    icon: 'UserPlus',
    route: '/amigos',
    count: 1,
    severity: 'warning',
    source: 'notification',
    unread: true,
  },
  {
    id: 'activity-match_today-9',
    type: 'match_today',
    partidoId: 9,
    title: 'Jugás hoy 21:00',
    subtitle: '"Noche" · Cancha Norte',
    createdAt: '2026-06-25T13:00:00.000Z',
    icon: 'CalendarClock',
    route: '/partido-publico/9',
    count: 1,
    severity: 'urgent',
    source: 'active',
    unread: false,
  },
];

const createSupabaseQuery = () => ({
  eq: jest.fn(async () => ({ data: [], error: null })),
  in: jest.fn(async () => ({ data: [], error: null })),
  not: jest.fn(async () => ({ data: [], error: null })),
  gte: jest.fn(async () => ({ data: [], error: null })),
  order: jest.fn(() => createSupabaseQuery()),
});

const renderHome = async (items = activityItems) => {
  buildActivityFeed.mockResolvedValue(items);

  render(
    <MemoryRouter>
      <FifaHomeContent />
    </MemoryRouter>,
  );

  await screen.findByText('Actividad reciente');
};

const firePointerEvent = (target, type, { pointerId, pointerType = 'touch', clientX, clientY }) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(target, event);
};

const swipe = (target, { pointerId = 1, from = 220, to, fromY = 20, toY = 22 }) => {
  firePointerEvent(target, 'pointerdown', {
    pointerId,
    pointerType: 'touch',
    clientX: from,
    clientY: fromY,
  });
  firePointerEvent(target, 'pointermove', {
    pointerId,
    pointerType: 'touch',
    clientX: to,
    clientY: toY,
  });
  firePointerEvent(target, 'pointerup', {
    pointerId,
    pointerType: 'touch',
    clientX: to,
    clientY: toY,
  });
};

describe('FifaHomeContent recent activity dismiss', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockNavigate.mockClear();
    mockMarkAsRead.mockClear();
    mockListMyTeamMatches.mockClear();
    buildActivityFeed.mockReset();
    mockSupabaseFrom.mockReset();
    mockSupabaseFrom.mockImplementation(() => ({
      select: jest.fn(() => createSupabaseQuery()),
    }));
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      profile: { nombre: 'Nico' },
      refreshProfile: jest.fn(),
    });
    mockUseNotifications.mockReturnValue({
      unreadCount: { friends: 1, matches: 0, total: 1 },
      notifications: [{ id: 'notification-real-1', type: 'friend_request', read: false }],
      markAsRead: mockMarkAsRead,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders recent activity normally and keeps normal tap navigation', async () => {
    await renderHome();

    expect(await screen.findByText('Nueva solicitud de amistad')).toBeInTheDocument();
    expect(screen.getByText('Jugás hoy 21:00')).toBeInTheDocument();
    expect(screen.queryByText(/Eliminar/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /jugás hoy 21:00/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/partido-publico/9');
  });

  test('sufficient left swipe removes only the Home activity item and persists it', async () => {
    await renderHome();
    const firstItem = await screen.findByRole('button', { name: /nueva solicitud de amistad/i });
    jest.useFakeTimers();

    swipe(firstItem, { to: 40 });

    expect(window.localStorage.getItem('arma2_recent_activity_dismissed_user-1')).toBe(
      JSON.stringify(['activity-friend_request-user-2']),
    );

    act(() => {
      jest.advanceTimersByTime(260);
    });

    await waitFor(() => {
      expect(screen.queryByText('Nueva solicitud de amistad')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Jugás hoy 21:00')).toBeInTheDocument();
    expect(mockMarkAsRead).not.toHaveBeenCalled();
    expect(mockSupabaseFrom.mock.calls.map(([table]) => table)).not.toContain('notifications');
  });

  test('sufficient right swipe also dismisses and persists', async () => {
    await renderHome();
    const firstItem = await screen.findByRole('button', { name: /nueva solicitud de amistad/i });
    jest.useFakeTimers();

    swipe(firstItem, { from: 40, to: 220 });

    expect(window.localStorage.getItem('arma2_recent_activity_dismissed_user-1')).toBe(
      JSON.stringify(['activity-friend_request-user-2']),
    );

    act(() => {
      jest.advanceTimersByTime(260);
    });

    await waitFor(() => {
      expect(screen.queryByText('Nueva solicitud de amistad')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Jugás hoy 21:00')).toBeInTheDocument();
  });

  test('does not show dismissed items on a fresh render and hides the correct grouped key', async () => {
    window.localStorage.setItem(
      'arma2_recent_activity_dismissed_user-1',
      JSON.stringify(['activity-match_today-9']),
    );

    await renderHome();

    expect(await screen.findByText('Nueva solicitud de amistad')).toBeInTheDocument();
    expect(screen.queryByText('Jugás hoy 21:00')).not.toBeInTheDocument();
  });

  test('vertical scroll gesture does not dismiss recent activity', async () => {
    await renderHome();
    const firstItem = await screen.findByRole('button', { name: /nueva solicitud de amistad/i });

    firePointerEvent(firstItem, 'pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 220,
      clientY: 20,
    });
    firePointerEvent(firstItem, 'pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 224,
      clientY: 96,
    });
    firePointerEvent(firstItem, 'pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 224,
      clientY: 96,
    });

    expect(screen.getByText('Nueva solicitud de amistad')).toBeInTheDocument();
    expect(window.localStorage.getItem('arma2_recent_activity_dismissed_user-1')).toBeNull();
  });

  test('short horizontal swipe returns without dismissing or navigating', async () => {
    await renderHome();
    const firstItem = await screen.findByRole('button', { name: /nueva solicitud de amistad/i });

    swipe(firstItem, { pointerId: 8, to: 172 });
    fireEvent.click(firstItem);

    expect(screen.getByText('Nueva solicitud de amistad')).toBeInTheDocument();
    expect(window.localStorage.getItem('arma2_recent_activity_dismissed_user-1')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
