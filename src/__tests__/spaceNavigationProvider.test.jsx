import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { SpaceNavigationProvider, useSpaceNavigation } from '../features/space-navigation';

const mockUser = { id: 'user-123', email: 'ana@example.com' };
jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser, authResolved: true }),
}));
let mockPendingPush = null;
jest.mock('../hooks/useNativeFeatures', () => ({
  peekPendingNativePushRedirect: () => mockPendingPush,
}));

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentSpace, switchSpace } = useSpaceNavigation();
  return (
    <>
      <output data-testid="pathname">{location.pathname}</output>
      <output data-testid="space">{currentSpace}</output>
      <button type="button" onClick={() => switchSpace('torneos')}>Torneos</button>
      <button type="button" onClick={() => switchSpace('arma2')}>Arma2</button>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
      <button type="button" onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function renderProvider(initialEntry = '/', options = {}) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SpaceNavigationProvider native torneosAvailable {...options}>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </SpaceNavigationProvider>
    </MemoryRouter>,
  );
}

describe('SpaceNavigationProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockPendingPush = null;
  });

  const remember = (preference, userId = 'user-123') => window.localStorage.setItem(
    `arma2:space-navigation:v1:${userId}`, JSON.stringify(preference),
  );

  test('a normal opening returns to Torneos when the app was closed there, at its last screen', async () => {
    remember({ lastSpace: 'torneos', lastRoute: { arma2: '/desafios', torneos: '/torneos/mis-torneos' } });
    renderProvider('/');
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/torneos/mis-torneos'));
    expect(screen.getByTestId('space')).toHaveTextContent('torneos');
  });

  test('a normal opening returns to Arma2 when the app was closed there, at its last screen', async () => {
    remember({ lastSpace: 'arma2', lastRoute: { arma2: '/desafios', torneos: '/torneos/mis-torneos' } });
    renderProvider('/');
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/desafios'));
    expect(screen.getByTestId('space')).toHaveTextContent('arma2');
  });

  test('a normal opening never lands on a form that creates something', async () => {
    remember({ lastSpace: 'arma2', lastRoute: { arma2: '/nuevo-partido', torneos: '/torneos' } });
    renderProvider('/');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
  });

  test('a push tap waiting to open is never overridden by the restored product', async () => {
    mockPendingPush = { route: '/partido/42' };
    remember({ lastSpace: 'torneos', lastRoute: { arma2: '/', torneos: '/torneos/mis-torneos' } });
    renderProvider('/');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
  });

  test("another account's preference is never used", async () => {
    remember({ lastSpace: 'torneos', lastRoute: { arma2: '/', torneos: '/torneos/mis-torneos' } }, 'someone-else');
    renderProvider('/');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
  });

  test('a stored route outside the allowlist is never restored (falls back to the product start)', async () => {
    remember({ lastSpace: 'torneos', lastRoute: { arma2: '/', torneos: '/torneos/invitacion/token-secreto' } });
    renderProvider('/');
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/torneos$/));
  });

  // Found in the iOS simulator: a tournament's screen carries `?categoria=` and was never remembered, so closing the
  // app inside a tournament reopened Torneos at its start.
  test("remembers a tournament screen with its category, and never a query outside the allowlist", async () => {
    const tournamentScreen = '/torneos/torneo/tournament-1/partidos?categoria=category-1';
    renderProvider(tournamentScreen);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('arma2:space-navigation:v1:user-123')))
      .toMatchObject({ lastSpace: 'torneos', lastRoute: { torneos: tournamentScreen } }));

    window.localStorage.clear();
    renderProvider('/torneos/torneo/tournament-1/partidos?categoria=category-1&token=secret');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(window.localStorage.getItem('arma2:space-navigation:v1:user-123')).toBeNull();
  });

  test('a normal opening restores that tournament screen with its category', async () => {
    remember({ lastSpace: 'torneos', lastRoute: { arma2: '/', torneos: '/torneos/torneo/tournament-1/partidos?categoria=category-1' } });
    function Search() { return <output data-testid="search">{useLocation().search}</output>; }
    render(
      <MemoryRouter initialEntries={['/']}>
        <SpaceNavigationProvider native torneosAvailable>
          <Routes><Route path="*" element={<><Probe /><Search /></>} /></Routes>
        </SpaceNavigationProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/torneos/torneo/tournament-1/partidos'));
    expect(screen.getByTestId('search')).toHaveTextContent('?categoria=category-1');
  });

  test('respects an explicit deep link', async () => {
    window.localStorage.setItem('arma2:space-navigation:v1:user-123', JSON.stringify({
      lastSpace: 'torneos',
      lastRoute: { arma2: '/', torneos: '/torneos/mis-torneos' },
    }));
    renderProvider('/desafios');
    expect(await screen.findByText('/desafios')).toBeInTheDocument();
  });

  test('switches repeatedly with replace semantics and restores each route', async () => {
    window.localStorage.setItem('arma2:space-navigation:v1:user-123', JSON.stringify({
      lastSpace: 'arma2',
      lastRoute: { arma2: '/desafios', torneos: '/torneos/mis-partidos' },
    }));
    renderProvider('/desafios');
    act(() => screen.getByRole('button', { name: 'Torneos' }).click());
    expect(await screen.findByText('/torneos/mis-partidos')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Arma2' }).click());
    expect(await screen.findByText('/desafios')).toBeInTheDocument();
  });

  test('feature gate fails closed and does not navigate to Torneos', async () => {
    renderProvider('/desafios', { torneosAvailable: false });
    act(() => screen.getByRole('button', { name: 'Torneos' }).click());
    expect(await screen.findByText('/desafios')).toBeInTheDocument();
  });

  test('keeps the personal root when persisted Torneos is unavailable', async () => {
    window.localStorage.setItem('arma2:space-navigation:v1:user-123', JSON.stringify({
      lastSpace: 'torneos',
      lastRoute: { arma2: '/amigos', torneos: '/torneos/mis-torneos' },
    }));
    renderProvider('/', { torneosAvailable: false });
    expect(await screen.findByText('/')).toBeInTheDocument();
    expect(screen.getByTestId('space')).toHaveTextContent('arma2');
  });

  test('restores the persisted Torneos route after returning through the selector', async () => {
    window.localStorage.setItem('arma2:space-navigation:v1:user-123', JSON.stringify({
      lastSpace: 'torneos',
      lastRoute: { arma2: '/desafios', torneos: '/torneos/mis-partidos' },
    }));
    renderProvider('/');
    act(() => screen.getByRole('button', { name: 'Torneos' }).click());
    expect(await screen.findByText('/torneos/mis-partidos')).toBeInTheDocument();
  });

  test('falls back to Torneos on web when the personal product is unavailable', async () => {
    window.localStorage.setItem('arma2:space-navigation:v1:user-123', JSON.stringify({
      lastSpace: 'arma2',
      lastRoute: { arma2: '/desafios', torneos: '/torneos/mis-torneos' },
    }));
    renderProvider('/', { native: false });
    expect(await screen.findByText('/torneos/mis-torneos')).toBeInTheDocument();
  });

  test('space replacement does not add an accidental Back step', async () => {
    window.localStorage.setItem('arma2:space-navigation:v1:user-123', JSON.stringify({
      lastSpace: 'arma2',
      lastRoute: { arma2: '/desafios', torneos: '/torneos/mis-partidos' },
    }));
    render(
      <MemoryRouter initialEntries={['/profile', '/desafios']} initialIndex={1}>
        <SpaceNavigationProvider native torneosAvailable>
          <Routes><Route path="*" element={<Probe />} /></Routes>
        </SpaceNavigationProvider>
      </MemoryRouter>,
    );

    act(() => screen.getByRole('button', { name: 'Torneos' }).click());
    expect(await screen.findByText('/torneos/mis-partidos')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Back' }).click());
    expect(await screen.findByText('/profile')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Forward' }).click());
    expect(await screen.findByText('/torneos/mis-partidos')).toBeInTheDocument();
  });
});
