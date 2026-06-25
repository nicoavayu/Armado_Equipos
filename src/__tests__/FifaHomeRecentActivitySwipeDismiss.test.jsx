import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FifaHomeContent, { getRecentActivityDismissedStorageKey } from '../components/FifaHomeContent';

const mockNavigate = jest.fn();
const mockBuildActivityFeed = jest.fn();
const mockUseAuth = jest.fn();
const mockUseNotifications = jest.fn();
const mockSupabaseDelete = jest.fn();
const mockListMyTeamMatches = jest.fn(async () => []);
const mockMarkAsRead = jest.fn();

jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 2,
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/', state: null }),
}));

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

jest.mock('../supabase', () => ({
  supabase: {
    from: () => {
      const query = {};
      query.select = jest.fn(() => query);
      query.eq = jest.fn(() => query);
      query.in = jest.fn(() => query);
      query.order = jest.fn(() => query);
      query.gte = jest.fn(() => query);
      query.not = jest.fn(() => query);
      query.delete = (...args) => mockSupabaseDelete(...args);
      query.then = (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return query;
    },
  },
  updateProfile: jest.fn(),
  addFreePlayer: jest.fn(),
  removeFreePlayer: jest.fn(),
}));

jest.mock('../services/db/teamChallenges', () => ({
  listMyTeamMatches: (...args) => mockListMyTeamMatches(...args),
}));

jest.mock('../utils/activityFeed', () => ({
  buildActivityFeed: (...args) => mockBuildActivityFeed(...args),
}));

jest.mock('../components/HomeWelcomeCard', () => () => null);
jest.mock('../components/QuickAccessRail', () => () => null);
jest.mock('../components/NotificationsBell', () => () => (
  <button type="button" aria-label="Notificaciones" />
));

const userId = 'user-swipe-1';
const activityItems = [
  {
    id: 'activity-friend_request-1',
    type: 'friend_request',
    title: 'Nueva solicitud de amistad',
    subtitle: 'Nico',
    icon: 'UserPlus',
    route: '/amigos',
    count: 1,
    severity: 'warning',
  },
  {
    id: 'activity-match_cancelled-2',
    type: 'match_cancelled',
    title: 'Partido cancelado',
    subtitle: 'El partido fue cancelado',
    icon: 'AlertTriangle',
    route: null,
    count: 1,
    severity: 'warning',
  },
];

const renderHome = () => render(<FifaHomeContent />);

const waitForActivity = async (title = 'Nueva solicitud de amistad') => {
  await screen.findByText(title);
  return screen.getByTestId(`recent-activity-item-${activityItems[0].id}`);
};

const swipe = (element, { from = 0, to, y = 0 }) => {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    button: 0,
    clientX: from,
    clientY: y,
    timeStamp: 0,
  });
  fireEvent.pointerMove(element, {
    pointerId: 1,
    clientX: to,
    clientY: y + 2,
    timeStamp: 30,
  });
  fireEvent.pointerUp(element, {
    pointerId: 1,
    clientX: to,
    clientY: y + 2,
    timeStamp: 60,
  });
};

describe('FifaHomeContent recent activity swipe dismiss', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockNavigate.mockClear();
    mockBuildActivityFeed.mockReset();
    mockSupabaseDelete.mockClear();
    mockListMyTeamMatches.mockClear();
    mockMarkAsRead.mockClear();
    mockUseAuth.mockReturnValue({
      user: { id: userId, email: 'nico@example.com' },
      profile: { nombre: 'Nico', acepta_invitaciones: true },
      refreshProfile: jest.fn(),
    });
    mockUseNotifications.mockReturnValue({
      unreadCount: { friends: 0, matches: 0, total: 0 },
      notifications: [{ id: 'notif-1', type: 'friend_request' }],
      markAsRead: mockMarkAsRead,
    });
    mockBuildActivityFeed.mockResolvedValue(activityItems);
    window.matchMedia = jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
    window.PointerEvent = window.MouseEvent;
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  });

  test('does not render a trash affordance or Eliminar action', async () => {
    renderHome();
    await waitForActivity();

    expect(screen.queryByText(/Eliminar/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Eliminar/i)).not.toBeInTheDocument();
  });

  test('short horizontal swipe returns and does not dismiss or navigate', async () => {
    renderHome();
    const item = await waitForActivity();

    swipe(item, { to: -58 });
    fireEvent.click(item);

    expect(screen.getByText('Nueva solicitud de amistad')).toBeInTheDocument();
    expect(item).toHaveStyle('transform: translate3d(0px, 0, 0) rotate(0deg)');
    expect(window.localStorage.getItem(getRecentActivityDismissedStorageKey(userId))).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('sufficient left swipe removes the item and persists local dismiss', async () => {
    renderHome();
    const item = await waitForActivity();

    swipe(item, { to: -180 });

    await waitFor(() => {
      expect(screen.queryByText('Nueva solicitud de amistad')).not.toBeInTheDocument();
    });

    const persisted = JSON.parse(window.localStorage.getItem(getRecentActivityDismissedStorageKey(userId)));
    expect(persisted).toContain(activityItems[0].id);
    expect(screen.getByText('Partido cancelado')).toBeInTheDocument();
    expect(mockSupabaseDelete).not.toHaveBeenCalled();
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });

  test('sufficient right swipe dismisses toward the right', async () => {
    renderHome();
    const item = await waitForActivity();

    swipe(item, { to: 190 });

    await waitFor(() => {
      expect(screen.queryByText('Nueva solicitud de amistad')).not.toBeInTheDocument();
    });

    const persisted = JSON.parse(window.localStorage.getItem(getRecentActivityDismissedStorageKey(userId)));
    expect(persisted).toContain(activityItems[0].id);
  });

  test('dismissed item stays hidden after re-render', async () => {
    const { unmount } = renderHome();
    const item = await waitForActivity();

    swipe(item, { to: -180 });
    await waitFor(() => {
      expect(screen.queryByText('Nueva solicitud de amistad')).not.toBeInTheDocument();
    });

    unmount();
    renderHome();

    await screen.findByText('Partido cancelado');
    expect(screen.queryByText('Nueva solicitud de amistad')).not.toBeInTheDocument();
  });

  test('normal tap still navigates to the activity route', async () => {
    renderHome();
    const item = await waitForActivity();

    fireEvent.click(item);

    expect(mockNavigate).toHaveBeenCalledWith('/amigos');
  });

  test('vertical gesture does not dismiss recent activity', async () => {
    renderHome();
    const item = await waitForActivity();

    fireEvent.pointerDown(item, {
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
      timeStamp: 0,
    });
    fireEvent.pointerMove(item, {
      pointerId: 1,
      clientX: 4,
      clientY: 96,
      timeStamp: 30,
    });
    fireEvent.pointerUp(item, {
      pointerId: 1,
      clientX: 4,
      clientY: 96,
      timeStamp: 60,
    });

    await act(async () => {});

    expect(screen.getByText('Nueva solicitud de amistad')).toBeInTheDocument();
    expect(window.localStorage.getItem(getRecentActivityDismissedStorageKey(userId))).toBeNull();
  });
});
