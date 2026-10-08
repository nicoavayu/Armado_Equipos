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


const notificationsState = { current: null };

describe('FifaHomeContent first activity load', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
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
    notificationsState.current = {
      unreadCount: { friends: 0, matches: 0, total: 0 },
      notifications: [],
      notificationsReady: false,
      markAsRead: jest.fn(),
    };
    mockUseNotifications.mockImplementation(() => notificationsState.current);
  });

  test('does not claim "Sin notificaciones" while the account\'s notifications are still loading', async () => {
    buildActivityFeed.mockResolvedValue([]);
    const view = render(<MemoryRouter><FifaHomeContent /></MemoryRouter>);
    await screen.findByText('Actividad reciente');
    await act(async () => {});

    expect(screen.queryByText('Sin notificaciones')).not.toBeInTheDocument();
    expect(buildActivityFeed).not.toHaveBeenCalled();

    // The first fetch settles with real activity: the feed is built once, from it.
    buildActivityFeed.mockResolvedValue(activityItems);
    notificationsState.current = {
      ...notificationsState.current,
      notifications: [{ id: 'notification-real-1', type: 'friend_request', read: false }],
      notificationsReady: true,
    };
    view.rerender(<MemoryRouter><FifaHomeContent /></MemoryRouter>);

    expect(await screen.findByText('Nueva solicitud de amistad')).toBeInTheDocument();
    expect(buildActivityFeed).toHaveBeenCalledWith(
      [{ id: 'notification-real-1', type: 'friend_request', read: false }],
      expect.anything(),
    );
    expect(screen.queryByText('Sin notificaciones')).not.toBeInTheDocument();
  });

  test('a cached empty feed does not stand in for the real one while it loads', async () => {
    window.localStorage.setItem('home:snapshot:v1:user-1', JSON.stringify({ activeMatches: [], activityItems: [] }));
    buildActivityFeed.mockResolvedValue([]);
    render(<MemoryRouter><FifaHomeContent /></MemoryRouter>);
    await screen.findByText('Actividad reciente');
    await act(async () => {});

    expect(screen.queryByText('Sin notificaciones')).not.toBeInTheDocument();
  });

  test('a cached non-empty feed shows at once, before the fresh one', async () => {
    window.localStorage.setItem('home:snapshot:v1:user-1', JSON.stringify({ activeMatches: [], activityItems }));
    buildActivityFeed.mockResolvedValue(activityItems);
    render(<MemoryRouter><FifaHomeContent /></MemoryRouter>);

    expect(await screen.findByText('Nueva solicitud de amistad')).toBeInTheDocument();
  });

  test('an account with nothing new still gets the empty state once loading settled', async () => {
    buildActivityFeed.mockResolvedValue([]);
    notificationsState.current = { ...notificationsState.current, notificationsReady: true };
    render(<MemoryRouter><FifaHomeContent /></MemoryRouter>);

    expect(await screen.findByText('Sin notificaciones')).toBeInTheDocument();
  });
});
