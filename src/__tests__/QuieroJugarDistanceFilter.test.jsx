import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// jest.mock calls below are hoisted above this import.
import QuieroJugar from '../pages/QuieroJugar';

const mockNavigate = jest.fn();
const mockFetchOpenMatches = jest.fn();
const mockCountOpenMatches = jest.fn();
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

// A persistable dev location makes the distance filter active so the slider is
// enabled (canFilterByDistance === true) and reacts to user input.
jest.mock('../services/locationService', () => ({
  distanceInMeters: () => 1000,
  getCurrentPosition: () => Promise.reject(new Error('no-geo')),
  getLocalhostDevelopmentLocation: () => ({ lat: -34.6037, lng: -58.3816, source: 'dev' }),
  isPermissionDeniedError: () => false,
  shouldRefresh: () => false,
}));

jest.mock('../hooks/useAmigos', () => ({ useAmigos: () => mockAmigosApi }));
jest.mock('../hooks/useInterval', () => ({ useInterval: () => mockIntervalApi }));
jest.mock('../hooks/useSupabaseRealtime', () => ({ useSupabaseRealtime: jest.fn() }));
jest.mock('../hooks/useRefreshOnVisibility', () => ({ useRefreshOnVisibility: jest.fn() }));
jest.mock('../hooks/useSmartBackNavigation', () => ({ useSmartBackNavigation: () => jest.fn() }));
jest.mock('../hooks/useScrollReset', () => ({ useScrollResetOnChange: jest.fn() }));

jest.mock('../components/PlayerMiniCard', () => () => <div data-testid="player-mini-card" />);
jest.mock('../components/PlayerBadges', () => () => null);
jest.mock('../components/InviteAmigosModal', () => () => null);
jest.mock('../components/InviteToMatchModal', () => () => null);
jest.mock('../components/PlayerActionModal', () => () => null);
jest.mock('../components/ProfileCardModal', () => () => null);
jest.mock('../components/jugar/MatchesMapView', () => ({
  __esModule: true,
  default: () => <div data-testid="matches-map-view" />,
}));

const makeChainableQuery = () => {
  const query = {};
  ['select', 'eq', 'update', 'insert', 'order', 'in'].forEach((method) => {
    query[method] = jest.fn(() => query);
  });
  // No persisted profile coords → falls back to the dev location above.
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

describe('QuieroJugar — compact distance filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockFetchOpenMatches.mockResolvedValue(openMatches);
    mockCountOpenMatches.mockResolvedValue(1);
  });

  test('renderiza la UI compacta de distancia con el valor actual', async () => {
    renderPage();
    const slider = await screen.findByLabelText('Distancia máxima de partidos');
    // Compact label + default value pill present.
    expect(screen.getByText('Distancia')).toBeInTheDocument();
    expect(screen.getByText('30 km')).toBeInTheDocument();
    expect(slider).toHaveValue('30');
  });

  test('cambiar el slider actualiza el valor mostrado', async () => {
    renderPage();
    const slider = await screen.findByLabelText('Distancia máxima de partidos');
    expect(slider).not.toBeDisabled();

    fireEvent.change(slider, { target: { value: '12' } });

    expect(slider).toHaveValue('12');
    expect(screen.getByText('12 km')).toBeInTheDocument();
  });

  test('ya no muestra el párrafo explicativo largo', async () => {
    renderPage();
    await screen.findByLabelText('Distancia máxima de partidos');
    expect(screen.queryByText(/Con ubicacion activa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin ubicacion disponible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Activá la ubicacion del navegador/i)).not.toBeInTheDocument();
  });
});
