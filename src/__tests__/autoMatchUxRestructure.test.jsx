import React, { act } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mockUser = { id: 'me' };

// Estado mutable de los mocks del servicio: cada test lo configura.
let currentAvailability = null;
let currentProposals = [];
let membersById = {};

const mockSave = jest.fn(async () => { });
const mockCancel = jest.fn(async () => { currentAvailability = null; });
const mockRespond = jest.fn(async () => { });
const mockRespondSub = jest.fn(async () => 900);
const mockClaim = jest.fn(async () => { });
const mockSync = jest.fn(async () => []);
const mockGetAvailability = jest.fn(async () => currentAvailability);
const mockGetProposals = jest.fn(async () => currentProposals);
const mockGetMembers = jest.fn(async (proposalId) => membersById[proposalId] || []);

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

jest.mock('../services/db/availability', () => ({
  ALLOWED_FORMATS: ['F5', 'F6', 'F7', 'F8', 'F9', 'F11'],
  saveMyAvailability: (...args) => mockSave(...args),
  cancelMyAvailability: (...args) => mockCancel(...args),
  respondToAutoMatchProposal: (...args) => mockRespond(...args),
  respondToAutoMatchSubstitute: (...args) => mockRespondSub(...args),
  claimAutoMatchOrganizer: (...args) => mockClaim(...args),
  syncMyAutoMatchGestations: (...args) => mockSync(...args),
  getMyActiveAvailability: (...args) => mockGetAvailability(...args),
  getMyActiveProposals: (...args) => mockGetProposals(...args),
  getAutoMatchProposalMembers: (...args) => mockGetMembers(...args),
}));

// El detalle envuelve cada jugador en PlayerCardTrigger; su árbol real
// (ProfileCardModal → useAmigos → surveyConfig con import.meta) no carga bajo
// Jest, así que se stubea igual que en el resto de la suite.
jest.mock('../components/ProfileComponents', () => ({
  PlayerCardTrigger: ({ children }) => children,
}));

jest.mock('../components/jugar/AutoMatchOrganizeSheet', () => () => null);
jest.mock('../components/jugar/DistanceSlider', () => (props) => (
  <input
    type="range"
    aria-label={props.ariaLabel}
    min={props.min}
    max={props.max}
    value={props.value}
    disabled={props.disabled}
    onChange={(event) => props.onChange(Number(event.target.value))}
  />
));
jest.mock('../components/PageTitle', () => ({ children, onBack }) => (
  <header>
    {onBack ? <button type="button" aria-label="Volver" onClick={onBack} /> : null}
    <span>{children}</span>
  </header>
));

// eslint-disable-next-line import/first
import AvailabilityOpportunityCard from '../components/jugar/AvailabilityOpportunityCard';
// eslint-disable-next-line import/first
import { sortProposalsForList, proposalNeedsAction } from '../components/jugar/AvailabilityOpportunityCard';

const ACTIVE_AVAILABILITY = {
  days_of_week: [1, 3],
  time_start: '20:00:00',
  time_end: '23:00:00',
  formats: ['F5'],
  max_distance_km: 8,
  can_organize: true,
};

// 22 requiere acción (respuesta pendiente) pese a ser más lejano; 11 ya está confirmado.
const PROPOSALS = [
  {
    id: 11,
    format: 'F5',
    proposed_starts_at: '2026-07-20T21:00:00-03:00',
    max_players: 10,
    status: 'collecting',
    member_count: 6,
    accepted_count: 4,
    my_response: 'accepted',
    organizer_id: null,
  },
  {
    id: 22,
    format: 'F7',
    proposed_starts_at: '2026-07-25T20:00:00-03:00',
    max_players: 14,
    status: 'collecting',
    member_count: 14,
    accepted_count: 9,
    my_response: 'pending',
    organizer_id: null,
  },
];

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
};

const renderScreen = (initialEntry = '/quiero-jugar?auto=1') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <AvailabilityOpportunityCard />
    <LocationProbe />
  </MemoryRouter>,
);

beforeEach(() => {
  // El proyecto corre con resetMocks: true (react-scripts), así que las
  // implementaciones se limpian antes de cada test y hay que re-aplicarlas acá.
  currentAvailability = null;
  currentProposals = [];
  membersById = {};
  mockSave.mockImplementation(async () => { });
  mockCancel.mockImplementation(async () => { currentAvailability = null; });
  mockRespond.mockImplementation(async () => { });
  mockRespondSub.mockImplementation(async () => 900);
  mockClaim.mockImplementation(async () => { });
  mockSync.mockImplementation(async () => []);
  mockGetAvailability.mockImplementation(async () => currentAvailability);
  mockGetProposals.mockImplementation(async () => currentProposals);
  mockGetMembers.mockImplementation(async (proposalId) => membersById[proposalId] || []);
});

describe('sortProposalsForList', () => {
  test('action-required proposals come first, then soonest date', () => {
    const ordered = sortProposalsForList(PROPOSALS, 'me');
    expect(ordered.map((p) => p.id)).toEqual([22, 11]);
    expect(proposalNeedsAction(PROPOSALS[1], 'me')).toBe(true);
    expect(proposalNeedsAction(PROPOSALS[0], 'me')).toBe(false);
  });

  test('organizer with pending match data counts as action required', () => {
    const organizing = { ...PROPOSALS[0], status: 'ready', organizer_id: 'me', my_response: 'accepted' };
    expect(proposalNeedsAction(organizing, 'me')).toBe(true);
    expect(proposalNeedsAction(organizing, 'other')).toBe(false);
  });
});

describe('main screen structure', () => {
  test('search section renders without an outer card, before the gestation list', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = PROPOSALS;
    renderScreen();

    const searchSection = await screen.findByTestId('auto-search-section');
    const listSection = await screen.findByTestId('gestation-list-section');

    // La búsqueda va antes que la lista en el DOM.
    expect(
      // eslint-disable-next-line no-bitwise
      searchSection.compareDocumentPosition(listSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Sin card exterior: ni la sección ni sus wrappers usan la card grande.
    expect(searchSection.classList.contains('rounded-card')).toBe(false);
    expect(searchSection.querySelector('.rounded-card')).toBeNull();

    // Resumen compacto de búsqueda activa, fuera de cards.
    expect(within(searchSection).getByText('Tu búsqueda está activa')).toBeInTheDocument();
    expect(within(searchSection).getByText(/Te ofreciste para organizar/)).toBeInTheDocument();
    expect(within(searchSection).getByText('Dejar de buscar')).toBeInTheDocument();
  });

  test('inactive search keeps the same structure and CTA label', async () => {
    renderScreen();
    const searchSection = await screen.findByTestId('auto-search-section');
    expect(within(searchSection).getByText('Activar búsqueda')).toBeInTheDocument();
    expect(screen.queryByTestId('search-active-summary')).toBeNull();
    expect(searchSection.querySelector('.rounded-card')).toBeNull();
    // Sin gestaciones no hay una gran card vacía: la sección no se muestra.
    expect(screen.queryByTestId('gestation-list-section')).toBeNull();
  });

  test('activating the search never shows the green confirmation block', async () => {
    renderScreen();
    await screen.findByTestId('auto-search-section');

    fireEvent.click(screen.getByText('LU'));
    mockSave.mockImplementationOnce(async () => { currentAvailability = ACTIVE_AVAILABILITY; });
    fireEvent.click(screen.getByText('Activar búsqueda'));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    await screen.findByTestId('search-active-summary');

    expect(screen.queryByText(/Búsqueda activada\. Si ya hay una combinación viable/)).toBeNull();
    const status = screen.getByRole('status');
    expect(status).toHaveClass('sr-only');
    expect(status).toHaveTextContent('Búsqueda activada.');
  });
});

describe('compact gestation list', () => {
  test('renders one compact card per proposal, action-required first, without roster details', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = PROPOSALS;
    membersById = { 11: [{ user_id: 'a', nombre: 'Ana', response: 'accepted' }] };
    renderScreen();

    const listSection = await screen.findByTestId('gestation-list-section');
    const cards = within(listSection).getAllByTestId(/gestation-card-/);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-testid', 'gestation-card-22');
    expect(cards[1]).toHaveAttribute('data-testid', 'gestation-card-11');

    expect(within(cards[0]).getByText('9/14 confirmados')).toBeInTheDocument();
    expect(within(cards[1]).getByText('4/10 confirmados')).toBeInTheDocument();
    expect(within(listSection).queryByTestId('proposal-roster')).toBeNull();
    expect(within(listSection).queryByText('Me sumo')).toBeNull();
  });

  test('each card opens its own proposal detail', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = PROPOSALS;
    renderScreen();

    fireEvent.click(await screen.findByTestId('gestation-card-22'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/quiero-jugar?auto=1&proposal=22');

    const detail = await screen.findByTestId('gestation-detail-screen');
    expect(within(detail).getByText('PARTIDO F7')).toBeInTheDocument();
    expect(within(detail).getByText('9/14')).toBeInTheDocument();
  });

  test('actions inside the detail only touch that proposal, and back returns to the intact list', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = PROPOSALS;
    renderScreen();

    fireEvent.click(await screen.findByTestId('gestation-card-22'));
    const detail = await screen.findByTestId('gestation-detail-screen');

    await act(async () => {
      fireEvent.click(within(detail).getByText('Me sumo'));
    });
    await waitFor(() => expect(mockRespond).toHaveBeenCalledWith(22, 'accepted', { canOrganize: false }));
    expect(mockRespond).toHaveBeenCalledTimes(1);

    fireEvent.click(within(detail).getByLabelText('Volver'));
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent(/\?auto=1$/);
    });
    expect(screen.queryByTestId('gestation-detail-screen')).toBeNull();
    expect(screen.getByTestId('gestation-card-11')).toBeInTheDocument();
    expect(screen.getByTestId('gestation-card-22')).toBeInTheDocument();
  });
});

describe('proposal deep links', () => {
  test('a deep link with proposal id opens that detail directly', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = PROPOSALS;
    renderScreen('/quiero-jugar?auto=1&proposal=11');

    const detail = await screen.findByTestId('gestation-detail-screen');
    await waitFor(() => expect(within(detail).getByText('PARTIDO F5')).toBeInTheDocument());
    expect(within(detail).getByText('4/10')).toBeInTheDocument();
  });

  test('a missing proposal returns to the list with a discreet notice, not the generic error', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = PROPOSALS;
    renderScreen('/quiero-jugar?auto=1&proposal=999');

    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent(/\?auto=1$/);
    });
    expect(screen.getByText('Esa gestación ya no está disponible.')).toBeInTheDocument();
    expect(screen.queryByText(/No encontramos ese destino/)).toBeNull();
    expect(screen.getByTestId('gestation-card-11')).toBeInTheDocument();
  });
});

describe('overbooking and confirmation-order in the detail', () => {
  const OVERBOOKED = {
    id: 55,
    format: 'F5',
    proposed_starts_at: '2026-07-20T21:00:00-03:00',
    max_players: 10,
    invitation_capacity: 15,
    status: 'collecting',
    member_count: 12,
    accepted_count: 6,
    pending_count: 6,
    titular_slots_left: 4,
    my_response: 'accepted',
    my_seat: 'suplente',
    organizer_id: null,
  };

  test('shows convocados/capacity, titular slots left, order note and my seat', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [OVERBOOKED];
    renderScreen('/quiero-jugar?auto=1&proposal=55');

    const detail = await screen.findByTestId('gestation-detail-screen');
    await waitFor(() => expect(within(detail).getByText('6/10')).toBeInTheDocument());
    expect(within(detail).getByText('12 convocados · hasta 15')).toBeInTheDocument();
    expect(within(detail).getByText('Quedan 4 lugares titulares')).toBeInTheDocument();
    expect(within(detail).getByText(/Los lugares titulares se asignan por orden de confirmación/)).toBeInTheDocument();
    expect(within(detail).getByTestId('my-seat')).toHaveTextContent('Quedaste suplente');
  });

  test('a pending invite shows the response deadline', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    const soon = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    currentProposals = [{ ...OVERBOOKED, my_response: 'pending', my_seat: null, my_invite_expires_at: soon }];
    renderScreen('/quiero-jugar?auto=1&proposal=55');

    const detail = await screen.findByTestId('gestation-detail-screen');
    await waitFor(() => expect(within(detail).getByText(/Podés responder hasta/)).toBeInTheDocument());
  });
});

describe('gestation list visibility (§13)', () => {
  test('created and cancelled proposals do not appear as gestation cards', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [
      { id: 11, format: 'F5', proposed_starts_at: '2026-07-20T21:00:00-03:00', max_players: 10, status: 'collecting', member_count: 6, accepted_count: 4, my_response: 'accepted', organizer_id: null },
      { id: 33, format: 'F5', proposed_starts_at: '2026-07-20T21:00:00-03:00', max_players: 10, status: 'created', partido_id: 900, member_count: 10, accepted_count: 10, my_response: 'accepted', organizer_id: 'me' },
      { id: 44, format: 'F5', proposed_starts_at: '2026-07-20T21:00:00-03:00', max_players: 10, status: 'cancelled', cancelled_reason: 'expired', member_count: 3, accepted_count: 3, my_response: 'accepted', organizer_id: null },
    ];
    renderScreen();

    const listSection = await screen.findByTestId('gestation-list-section');
    expect(within(listSection).getByTestId('gestation-card-11')).toBeInTheDocument();
    expect(within(listSection).queryByTestId('gestation-card-33')).toBeNull();
    expect(within(listSection).queryByTestId('gestation-card-44')).toBeNull();
  });
});

describe('match invite after materialization (§6/§10/§12)', () => {
  const SUBSTITUTE = {
    id: 77,
    format: 'F5',
    proposed_starts_at: '2026-07-20T21:00:00-03:00',
    max_players: 10,
    status: 'created',
    partido_id: 900,
    member_count: 12,
    accepted_count: 10,
    my_response: 'pending',
    roster_slot_kind: 'suplente',
    organizer_id: 'someone',
  };
  const STARTER = { ...SUBSTITUTE, id: 78, roster_slot_kind: 'titular', partido_id: 901 };

  test('a materialised proposal where I am still pending shows a MATCH-INVITE card, not a gestation card', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [SUBSTITUTE];
    renderScreen();

    const inviteSection = await screen.findByTestId('match-invite-list-section');
    expect(within(inviteSection).getByTestId('match-invite-card-77')).toBeInTheDocument();
    // No aparece como card de gestación.
    expect(screen.queryByTestId('gestation-card-77')).toBeNull();
    expect(screen.queryByTestId('gestation-list-section')).toBeNull();
  });

  test('a stale ?proposal= deep link to a materialised proposal redirects to the match-invite view (never the gestation chat)', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [SUBSTITUTE];
    renderScreen('/quiero-jugar?auto=1&proposal=77');

    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/quiero-jugar?auto=1&invite=77');
    });
    // Nunca abre el detalle/chat de la gestación.
    expect(screen.queryByTestId('gestation-detail-screen')).toBeNull();
  });

  test('a stale ?proposal= deep link where I am already in the roster redirects to the real match', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [{ ...SUBSTITUTE, my_response: 'accepted' }];
    renderScreen('/quiero-jugar?auto=1&proposal=77');

    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/partido-publico/900');
    });
  });

  test('the suplente invite view differentiates the CTA and accepting redirects to the match', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [SUBSTITUTE];
    renderScreen('/quiero-jugar?auto=1&invite=77');

    const invite = await screen.findByTestId('match-invite-screen');
    await within(invite).findByText(/Los titulares ya están completos/);
    expect(within(invite).queryByText('Me sumo')).toBeNull();

    await act(async () => {
      fireEvent.click(within(invite).getByTestId('match-invite-accept'));
    });
    expect(mockRespondSub).toHaveBeenCalledWith(77, 'accepted');
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/partido-publico/900');
    });
  });

  test('the titular vacancy invite uses the "hay un lugar" wording (differentiated from suplente)', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [STARTER];
    renderScreen('/quiero-jugar?auto=1&invite=78');

    const invite = await screen.findByTestId('match-invite-screen');
    await within(invite).findByText(/Hay un lugar disponible/);
    expect(within(invite).getByTestId('match-invite-accept')).toHaveTextContent('Sumarme al partido');
  });

  test('declining the invite calls the service with declined', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    mockRespondSub.mockImplementation(async () => null);
    currentProposals = [SUBSTITUTE];
    renderScreen('/quiero-jugar?auto=1&invite=77');

    const invite = await screen.findByTestId('match-invite-screen');
    const declineBtn = await within(invite).findByText('No, gracias');
    await act(async () => {
      fireEvent.click(declineBtn);
    });
    expect(mockRespondSub).toHaveBeenCalledWith(77, 'declined');
  });
});
