import React from 'react';
import { act, render, screen } from '@testing-library/react';
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
  beforeEach(() => window.localStorage.clear());

  test('keeps the canonical root in Arma2 even when Torneos was the last space', async () => {
    window.localStorage.setItem('arma2:space-navigation:v1:user-123', JSON.stringify({
      lastSpace: 'torneos',
      lastRoute: { arma2: '/desafios', torneos: '/torneos/mis-torneos' },
    }));
    renderProvider('/');
    expect(await screen.findByText('/')).toBeInTheDocument();
    expect(screen.getByTestId('space')).toHaveTextContent('arma2');
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
