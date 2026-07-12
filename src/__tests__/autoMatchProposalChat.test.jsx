import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUser = { id: 'me' };

let currentAvailability = null;
let currentProposals = [];
let membersById = {};

const mockGetAvailability = jest.fn(async () => currentAvailability);
const mockGetProposals = jest.fn(async () => currentProposals);
const mockGetMembers = jest.fn(async (proposalId) => membersById[proposalId] || []);
const mockNoop = jest.fn(async () => {});

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

// Cadena de supabase suficiente para loadLocation (.maybeSingle) y el contador
// de no leídos del chat (.gt), ambos best-effort.
const makeQuery = (result) => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    gt: () => Promise.resolve(result),
    maybeSingle: async () => result,
  };
  return query;
};
jest.mock('../lib/supabaseClient', () => ({
  supabase: { from: () => makeQuery({ data: [], error: null }) },
}));

jest.mock('../services/db/availability', () => ({
  ALLOWED_FORMATS: ['F5', 'F6', 'F7', 'F8', 'F9', 'F11'],
  saveMyAvailability: (...args) => mockNoop(...args),
  cancelMyAvailability: (...args) => mockNoop(...args),
  respondToAutoMatchProposal: (...args) => mockNoop(...args),
  claimAutoMatchOrganizer: (...args) => mockNoop(...args),
  syncMyAutoMatchGestations: (...args) => mockNoop(...args),
  getMyActiveAvailability: (...args) => mockGetAvailability(...args),
  getMyActiveProposals: (...args) => mockGetProposals(...args),
  getAutoMatchProposalMembers: (...args) => mockGetMembers(...args),
}));

jest.mock('../components/jugar/AutoMatchOrganizeSheet', () => () => null);
jest.mock('../components/jugar/DistanceSlider', () => () => null);
jest.mock('../components/PageTitle', () => ({ children, onBack }) => (
  <header>
    {onBack ? <button type="button" aria-label="Volver" onClick={onBack} /> : null}
    <span>{children}</span>
  </header>
));

// PlayerCardTrigger real arrastra un árbol que no carga bajo Jest; el stub
// expone el profile para verificar el mapeo miembro → perfil.
jest.mock('../components/ProfileComponents', () => ({
  PlayerCardTrigger: ({ profile, children }) => (
    <div
      data-testid={`player-trigger-${profile?.user_id}`}
      data-profile-id={profile?.id}
      data-profile-usuario={profile?.usuario_id}
      data-profile-user={profile?.user_id}
      data-profile-nombre={profile?.nombre}
    >
      {children}
    </div>
  ),
}));

// MatchChat se carga con React.lazy; el stub deja verificar que se abre con el
// scope de la propuesta.
jest.mock('../components/MatchChat', () => ({
  __esModule: true,
  default: (props) => (
    <div
      data-testid="mock-match-chat"
      data-proposal-id={String(props.proposalId)}
      data-title={props.title}
      data-can-send={String(props.canSend)}
    >
      {props.isOpen ? 'chat abierto' : null}
    </div>
  ),
}));

// eslint-disable-next-line import/first
import AvailabilityOpportunityCard from '../components/jugar/AvailabilityOpportunityCard';

const ACTIVE_AVAILABILITY = {
  days_of_week: [1, 3],
  time_start: '20:00:00',
  time_end: '23:00:00',
  formats: ['F5'],
  max_distance_km: 8,
  can_organize: true,
};

const baseProposal = (overrides = {}) => ({
  id: 55,
  format: 'F5',
  proposed_starts_at: '2026-07-20T21:00:00-03:00',
  max_players: 10,
  status: 'collecting',
  member_count: 3,
  accepted_count: 2,
  my_response: 'accepted',
  organizer_id: null,
  ...overrides,
});

const MEMBERS = [
  { user_id: 'org-1', nombre: 'Nixon', avatar_url: null, response: 'accepted', is_organizer: true },
  { user_id: 'acc-1', nombre: 'Ana', avatar_url: 'https://x/a.png', response: 'accepted', is_organizer: false },
  { user_id: 'pen-1', nombre: 'Beto', avatar_url: null, response: 'pending', is_organizer: false },
  { user_id: 'dec-1', nombre: 'Caro', avatar_url: null, response: 'declined', is_organizer: false },
];

const renderDetail = () => render(
  <MemoryRouter initialEntries={['/quiero-jugar?auto=1&proposal=55']}>
    <AvailabilityOpportunityCard />
  </MemoryRouter>,
);

beforeEach(() => {
  currentAvailability = ACTIVE_AVAILABILITY;
  currentProposals = [baseProposal()];
  membersById = { 55: MEMBERS };
  mockGetAvailability.mockImplementation(async () => currentAvailability);
  mockGetProposals.mockImplementation(async () => currentProposals);
  mockGetMembers.mockImplementation(async (proposalId) => membersById[proposalId] || []);
  mockNoop.mockImplementation(async () => {});
});

describe('gestation detail — flat layout', () => {
  test('renders the players on the background without the old outer card', async () => {
    renderDetail();
    const detail = await screen.findByTestId('gestation-detail-screen');
    await within(detail).findByText('PARTIDO F5');
    // Sin card exterior <article>: los elementos van sobre el fondo.
    expect(detail.querySelector('article')).toBeNull();
    expect(within(detail).getByText('2/10')).toBeInTheDocument();
  });

  test('every player is wrapped in a profile-card trigger carrying its account id', async () => {
    renderDetail();
    const detail = await screen.findByTestId('gestation-detail-screen');

    for (const member of MEMBERS) {
      const trigger = await within(detail).findByTestId(`player-trigger-${member.user_id}`);
      // El ProfileCard resuelve la cuenta desde usuario_id/user_id/id.
      expect(trigger).toHaveAttribute('data-profile-usuario', member.user_id);
      expect(trigger).toHaveAttribute('data-profile-user', member.user_id);
      expect(trigger).toHaveAttribute('data-profile-id', member.user_id);
      expect(trigger).toHaveAttribute('data-profile-nombre', member.nombre);
      // El tile del jugador vive dentro del trigger (tap → abre su perfil).
      expect(within(trigger).getByTestId(`gestation-player-${member.user_id}`)).toBeInTheDocument();
    }
  });
});

describe('gestation detail — group chat', () => {
  const openChat = async () => {
    const detail = await screen.findByTestId('gestation-detail-screen');
    await within(detail).findByText('PARTIDO F5');
    expect(screen.queryByTestId('mock-match-chat')).toBeNull();
    fireEvent.click(await within(detail).findByTestId('gestation-chat-button'));
    return { detail, chat: await screen.findByTestId('mock-match-chat') };
  };

  test('a confirmed member can open a chat scoped to the proposal and send', async () => {
    renderDetail();
    const { chat } = await openChat();
    expect(chat).toHaveAttribute('data-proposal-id', '55');
    expect(chat).toHaveTextContent('chat abierto');
    // Gestación viva (collecting): el composer queda habilitado.
    expect(chat).toHaveAttribute('data-can-send', 'true');
  });

  test('a pending member can also open the chat and send', async () => {
    currentProposals = [baseProposal({ my_response: 'pending' })];
    renderDetail();
    const { detail, chat } = await openChat();
    // El pendiente ve la entrada de chat…
    expect(within(detail).getByTestId('gestation-chat-button')).toBeInTheDocument();
    // …y puede escribir (no es solo lectura).
    expect(chat).toHaveAttribute('data-can-send', 'true');
  });

  test('declined members do not get the chat entry', async () => {
    currentProposals = [baseProposal({ my_response: 'declined' })];
    renderDetail();
    const detail = await screen.findByTestId('gestation-detail-screen');
    await within(detail).findByText('PARTIDO F5');

    expect(within(detail).queryByTestId('gestation-chat-button')).toBeNull();
  });

  test('a user with no membership (outsider) gets no chat entry', async () => {
    currentProposals = [baseProposal({ my_response: null })];
    renderDetail();
    const detail = await screen.findByTestId('gestation-detail-screen');
    await within(detail).findByText('PARTIDO F5');

    expect(within(detail).queryByTestId('gestation-chat-button')).toBeNull();
  });

  test('a cancelled proposal opens the chat read-only', async () => {
    currentProposals = [baseProposal({ my_response: 'accepted', status: 'cancelled' })];
    renderDetail();
    const { chat } = await openChat();
    // El historial se puede abrir, pero el envío queda bloqueado.
    expect(chat).toHaveTextContent('chat abierto');
    expect(chat).toHaveAttribute('data-can-send', 'false');
  });

  test('an expired proposal opens the chat read-only', async () => {
    currentProposals = [baseProposal({ my_response: 'accepted', status: 'expired' })];
    renderDetail();
    const { chat } = await openChat();
    expect(chat).toHaveAttribute('data-can-send', 'false');
  });

  test('a proposal past its expires_at window opens read-only even while collecting', async () => {
    currentProposals = [baseProposal({
      my_response: 'accepted',
      status: 'collecting',
      expires_at: '2020-01-01T00:00:00-03:00',
    })];
    renderDetail();
    const { chat } = await openChat();
    expect(chat).toHaveAttribute('data-can-send', 'false');
  });
});
