import { render, screen } from '@testing-library/react';
import TeamDisplay from '../components/TeamDisplay';

const staleTeams = [
  { id: 'equipoA', name: 'Equipo A', players: ['player-1', 'removed-player'], score: 10 },
  { id: 'equipoB', name: 'Equipo B', players: ['player-3', 'player-4'], score: 10 },
];

const currentRoster = [
  { id: 1, uuid: 'player-1', usuario_id: 'user-1', nombre: 'Ana' },
  { id: 3, uuid: 'player-3', usuario_id: 'user-3', nombre: 'Cami' },
  { id: 4, uuid: 'player-4', usuario_id: 'user-4', nombre: 'Dani' },
  { id: 5, uuid: 'player-5', usuario_id: 'user-5', nombre: 'Eva' },
];

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-5' } }),
}));

jest.mock('../components/PlayerCardTrigger', () => {
  const React = require('react');
  return { TeamDisplayContext: React.createContext(false) };
});

jest.mock('../components/ProfileComponents', () => ({
  AvatarFallback: ({ name }) => <span>{name}</span>,
}));

jest.mock('../hooks/useNativeFeatures', () => ({
  useNativeFeatures: () => ({ isNative: false }),
}));

jest.mock('../hooks/useShareTeamsCard', () => ({
  useShareTeamsCard: () => ({
    isSharing: false,
    shareTeamsCard: jest.fn(),
    cardData: null,
    cardRef: { current: null },
  }),
}));

jest.mock('../components/ChatButton', () => () => null);
jest.mock('../components/MatchInfoSection', () => () => null);
jest.mock('../components/PageTitle', () => ({ children }) => <h1>{children}</h1>);

jest.mock('../supabase', () => {
  const query = {
    select: jest.fn(() => query),
    update: jest.fn(() => query),
    delete: jest.fn(() => query),
    eq: jest.fn(() => query),
    maybeSingle: () => new Promise(() => {}),
    single: () => new Promise(() => {}),
  };
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: () => {},
  };

  return {
    saveTeamsToDatabase: jest.fn(async () => {}),
    getTeamsFromDatabase: () => new Promise(() => {}),
    subscribeToTeamsChanges: () => channel,
    unsubscribeFromTeamsChanges: jest.fn(),
    getVotantesIds: () => new Promise(() => {}),
    getVotantesConNombres: () => new Promise(() => {}),
    supabase: {
      from: jest.fn(() => query),
      channel: () => channel,
      removeChannel: jest.fn(),
    },
  };
});

describe('TeamDisplay with a stale roster', () => {
  test('hides old teams and never renders the unknown-player placeholder', () => {
    render(
      <TeamDisplay
        teams={staleTeams}
        players={currentRoster}
        onTeamsChange={jest.fn()}
        onBackToHome={jest.fn()}
        partidoId={123}
        partido={{ id: 123, estado: 'equipos_formados' }}
      />,
    );

    expect(screen.getByText('Los equipos quedaron desactualizados')).toBeInTheDocument();
    expect(screen.getByText(/Esperá a que el administrador resetee/)).toBeInTheDocument();
    expect(screen.queryByText(/Jugador desconocido/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Equipo A')).not.toBeInTheDocument();
    expect(screen.queryByText('Equipo B')).not.toBeInTheDocument();

  });
});
