import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// jest.mock calls below are hoisted above this import, so QuieroJugar's
// transitive deps still resolve to the mocks.
import QuieroJugar from '../pages/QuieroJugar';

const mockNavigate = jest.fn();
const mockFetchOpenMatches = jest.fn();
const mockCountOpenMatches = jest.fn();
// Stable references — the real hooks return stable values, so mirror that here.
// (A fresh object each render would re-fire effects and trap the page in loading.)
const mockUser = { id: 'me' };
const mockAmigosApi = {
  getRelationshipStatus: jest.fn().mockResolvedValue(null),
  sendFriendRequest: jest.fn().mockResolvedValue({ success: true }),
};
const mockIntervalApi = { setIntervalSafe: jest.fn(), clearIntervalSafe: jest.fn() };

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../services/db/openMatches', () => ({
  fetchOpenMatchesForQuieroJugar: (...args) => mockFetchOpenMatches(...args),
  countOperationallyOpenMatches: (...args) => mockCountOpenMatches(...args),
}));

jest.mock('../services/locationService', () => ({
  distanceInMeters: () => 1000,
  getCurrentPosition: () => Promise.reject(new Error('no-geo')),
  getLocalhostDevelopmentLocation: () => null,
  isPermissionDeniedError: () => false,
  shouldRefresh: () => false,
}));

jest.mock('../hooks/useAmigos', () => ({
  useAmigos: () => mockAmigosApi,
}));

jest.mock('../hooks/useInterval', () => ({
  useInterval: () => mockIntervalApi,
}));

jest.mock('../hooks/useSupabaseRealtime', () => ({ useSupabaseRealtime: jest.fn() }));
jest.mock('../hooks/useRefreshOnVisibility', () => ({ useRefreshOnVisibility: jest.fn() }));
jest.mock('../hooks/useSmartBackNavigation', () => ({ useSmartBackNavigation: () => jest.fn() }));
jest.mock('../hooks/useScrollReset', () => ({ useScrollResetOnChange: jest.fn() }));

// Stub heavy children unrelated to this test's assertions.
jest.mock('../components/PlayerMiniCard', () => () => <div data-testid="player-mini-card" />);
jest.mock('../components/PlayerBadges', () => () => null);
jest.mock('../components/InviteAmigosModal', () => () => null);
jest.mock('../components/InviteToMatchModal', () => () => null);
jest.mock('../components/PlayerActionModal', () => () => null);
jest.mock('../components/ProfileCardModal', () => () => null);

// Lazy map view is replaced by a light stub so we never load MapLibre/WebGL in jsdom.
jest.mock('../components/jugar/MatchesMapView', () => ({
  __esModule: true,
  default: ({ matches }) => <div data-testid="matches-map-view">{`MAP_VIEW:${matches.length}`}</div>,
}));

const makeChainableQuery = () => {
  const query = {};
  ['select', 'eq', 'update', 'insert', 'order', 'in'].forEach((method) => {
    query[method] = jest.fn(() => query);
  });
  query.single = jest.fn(() => Promise.resolve({ data: null, error: null }));
  query.order = jest.fn(() => Promise.resolve({ data: [], error: null }));
  query.in = jest.fn(() => Promise.resolve({ data: [], error: null }));
  query.then = (resolve) => resolve({ data: [], error: null, count: 0 });
  return query;
};

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(() => makeChainableQuery()) },
}));

const openMatches = [
  {
    id: 'match-1',
    fecha: '2026-07-01',
    hora: '20:00',
    modalidad: 'F5',
    tipo_partido: 'Mixto',
    sede: 'La Terraza Fútbol',
    sede_place_id: 'place-1',
    sede_latitud: -34.6037,
    sede_longitud: -58.3816,
    cupo_jugadores: 10,
    jugadores: [],
    jugadores_count: 6,
    falta_jugadores: 4,
    creado_por: 'someone-else',
    distanceKm: 3,
  },
];

const renderPage = () => render(
  <MemoryRouter>
    <QuieroJugar />
  </MemoryRouter>,
);

describe('QuieroJugar — PARTIDOS Lista/Mapa toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockFetchOpenMatches.mockResolvedValue(openMatches);
    mockCountOpenMatches.mockResolvedValue(1);
  });

  test('mantiene las pestañas PARTIDOS y JUGADORES', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'PARTIDOS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JUGADORES' })).toBeInTheDocument();
  });

  test('PARTIDOS tiene el toggle Lista/Mapa con Lista por defecto', async () => {
    renderPage();
    const listaToggle = await screen.findByRole('button', { name: /Lista/ });
    const mapaToggle = screen.getByRole('button', { name: /Mapa/ });
    expect(listaToggle).toHaveAttribute('aria-pressed', 'true');
    expect(mapaToggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('la Lista sigue funcionando (renderiza las cards de partidos)', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Ver partido' })).toBeInTheDocument();
    expect(screen.getByText('La Terraza Fútbol')).toBeInTheDocument();
    expect(screen.queryByTestId('matches-map-view')).not.toBeInTheDocument();
  });

  test('al elegir Mapa se renderiza la vista de mapa (lazy)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Mapa/ }));
    expect(await screen.findByTestId('matches-map-view')).toHaveTextContent('MAP_VIEW:1');
  });

  test('JUGADORES no cambia: muestra el listado de jugadores', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'JUGADORES' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no hay jugadores disponibles/i })).toBeInTheDocument();
    });
    // No Lista/Mapa toggle inside JUGADORES.
    expect(screen.queryByRole('button', { name: /Mapa/ })).not.toBeInTheDocument();
  });
});
