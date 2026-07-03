import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = jest.fn();
const mockUseAuth = jest.fn();
const mockUseNotifications = jest.fn();
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
    id: 'activity-falta_jugadores-9',
    type: 'falta_jugadores',
    partidoId: 9,
    title: 'Quedan 5 lugares',
    subtitle: '"Yumi" · hoy 19:30',
    createdAt: '2026-06-25T13:00:00.000Z',
    icon: 'AlertTriangle',
    route: '/partido-publico/9',
    count: 1,
    severity: 'urgent',
    source: 'active',
    unread: false,
  },
  {
    id: 'activity-match_player_joined-9',
    type: 'match_player_joined',
    partidoId: 9,
    title: 'Cami se sumó',
    subtitle: '"Yumi" · hoy 19:30',
    createdAt: '2026-06-25T12:00:00.000Z',
    icon: 'Users',
    route: '/partido-publico/9',
    count: 1,
    severity: 'neutral',
    source: 'notification',
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

describe('FifaHomeContent next-step card vs recent activity dedup', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockNavigate.mockClear();
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
      unreadCount: { friends: 0, matches: 0, total: 0 },
      notifications: [],
      markAsRead: jest.fn(),
    });
  });

  test('the promoted item shows only in the card; other events of the match stay in activity', async () => {
    buildActivityFeed.mockResolvedValue(activityItems);

    render(
      <MemoryRouter>
        <FifaHomeContent />
      </MemoryRouter>,
    );

    await screen.findByText('Actividad reciente');

    // The card renders the promoted action (whole-card button with rich label)…
    expect(await screen.findByRole('button', { name: /Quedan 5 lugares\. "Yumi" · hoy 19:30/ })).toBeInTheDocument();
    // …and that copy appears exactly once: the activity row was hidden.
    expect(screen.getAllByText('Quedan 5 lugares')).toHaveLength(1);
    // Other events of the same match still show in Recent Activity.
    expect(screen.getByText('Cami se sumó')).toBeInTheDocument();
  });
});
