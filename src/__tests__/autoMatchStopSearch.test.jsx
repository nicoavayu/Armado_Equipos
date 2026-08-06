import React, { act } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUser = { id: 'me' };

let currentAvailability = null;
let currentProposals = [];
let membersById = {};

const mockSave = jest.fn(async () => {});
const mockCancel = jest.fn(async () => ({
  availabilityCancelled: 1,
  gestationMembershipsReleased: 0,
  createdInvitesWithdrawn: 0,
  createdMembershipsKept: 0,
}));
const mockRespond = jest.fn(async () => {});
const mockRespondSub = jest.fn(async () => 900);
const mockClaim = jest.fn(async () => {});
const mockSync = jest.fn(async () => []);
const mockSyncLocation = jest.fn(async () => currentAvailability);
const mockGetAvailability = jest.fn(async () => currentAvailability);
const mockGetProposals = jest.fn(async () => currentProposals);
const mockGetMembers = jest.fn(async (proposalId) => membersById[proposalId] || []);
const mockCaptureException = jest.fn();
const mockAddListener = jest.fn(() => Promise.resolve({ remove: jest.fn() }));

jest.mock('@capacitor/app', () => ({
  App: { addListener: (...args) => mockAddListener(...args) },
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { latitud: -34.6, longitud: -58.4 }, error: null }),
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
  syncMyAutoMatchLocationFromProfile: (...args) => mockSyncLocation(...args),
  getMyActiveAvailability: (...args) => mockGetAvailability(...args),
  getMyActiveProposals: (...args) => mockGetProposals(...args),
  getAutoMatchProposalMembers: (...args) => mockGetMembers(...args),
  getAutoMatchProposalResponseError: () => null,
}));

jest.mock('../utils/monitoring/sentry', () => ({
  captureException: (...args) => mockCaptureException(...args),
}));

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
import AvailabilityOpportunityCard, {
  ProposalDetail,
  isActiveMembershipResponse,
  iAmStillInProposal,
} from '../components/jugar/AvailabilityOpportunityCard';

const FROZEN_NOW = Date.parse('2026-07-14T15:00:00.000Z');

const ACTIVE_AVAILABILITY = {
  id: 101,
  days_of_week: [1, 3],
  time_start: '20:00:00',
  time_end: '23:00:00',
  formats: ['F5'],
  max_distance_km: 8,
  latitude: -34.6,
  longitude: -58.4,
  can_organize: false,
};

const LIVE_PROPOSAL = {
  id: 11,
  format: 'F5',
  proposed_starts_at: '2026-07-20T21:00:00-03:00',
  expires_at: '2026-07-20T20:30:00-03:00',
  max_players: 10,
  status: 'collecting',
  member_count: 6,
  accepted_count: 4,
  my_response: 'accepted',
  organizer_id: null,
};

const renderScreen = () => render(
  <MemoryRouter initialEntries={['/quiero-jugar?auto=1']}>
    <AvailabilityOpportunityCard />
  </MemoryRouter>,
);

// Espera a que la pantalla haya hecho su carga inicial (búsqueda activa).
const waitForActiveSearch = async () => {
  await screen.findByTestId('search-active-summary');
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  currentAvailability = ACTIVE_AVAILABILITY;
  currentProposals = [];
  membersById = {};
  mockSave.mockImplementation(async () => {});
  mockCancel.mockImplementation(async () => ({
    availabilityCancelled: 1,
    gestationMembershipsReleased: 0,
    createdInvitesWithdrawn: 0,
    createdMembershipsKept: 0,
  }));
  mockRespond.mockImplementation(async () => {});
  mockRespondSub.mockImplementation(async () => 900);
  mockClaim.mockImplementation(async () => {});
  mockSync.mockImplementation(async () => []);
  mockSyncLocation.mockImplementation(async () => currentAvailability);
  mockGetAvailability.mockImplementation(async () => currentAvailability);
  mockGetProposals.mockImplementation(async () => currentProposals);
  mockGetMembers.mockImplementation(async (proposalId) => membersById[proposalId] || []);
  mockAddListener.mockImplementation(() => Promise.resolve({ remove: jest.fn() }));
  mockCaptureException.mockClear();
});

// ---------------------------------------------------------------------------
// Estados terminales: nunca son participantes activos.
// ---------------------------------------------------------------------------
describe('estados terminales de una membresía', () => {
  const roster = [
    { user_id: 'a', nombre: 'Ana', response: 'accepted', confirmed_at: '2026-07-14T10:00:00Z' },
    { user_id: 'b', nombre: 'Bruno', response: 'pending' },
    { user_id: 'c', nombre: 'Caro', response: 'declined' },
    { user_id: 'd', nombre: 'Dami', response: 'expired' },
    { user_id: 'e', nombre: 'Eve', response: 'waitlisted' },
  ];

  const renderDetail = (overrides = {}) => render(
    <MemoryRouter>
      <ProposalDetail
        proposal={{ ...LIVE_PROPOSAL, ...overrides }}
        members={roster}
        userId="me"
        loading={false}
        onRespond={() => {}}
        onClaim={() => {}}
        onOrganize={() => {}}
        onOpenMatch={() => {}}
      />
    </MemoryRouter>,
  );

  test('el predicado de membresía activa excluye los tres estados', () => {
    expect(isActiveMembershipResponse('accepted')).toBe(true);
    expect(isActiveMembershipResponse('pending')).toBe(true);
    expect(isActiveMembershipResponse('declined')).toBe(false);
    expect(isActiveMembershipResponse('expired')).toBe(false);
    expect(isActiveMembershipResponse('waitlisted')).toBe(false);
  });

  test('un miembro expired no aparece como "Pendiente"', () => {
    renderDetail();
    const rosterNode = screen.getByTestId('proposal-roster');
    expect(within(rosterNode).queryByText('Dami')).toBeNull();
    // Sólo Bruno (pending) muestra el indicador de pendiente.
    expect(within(rosterNode).getAllByText('Pendiente')).toHaveLength(1);
  });

  test('un miembro declined no aparece en el roster', () => {
    renderDetail();
    const rosterNode = screen.getByTestId('proposal-roster');
    expect(within(rosterNode).queryByText('Caro')).toBeNull();
    // Y desaparece también el indicador "No juega".
    expect(screen.queryByText('No juega')).toBeNull();
  });

  test('un miembro waitlisted no aparece en el roster activo', () => {
    renderDetail();
    const rosterNode = screen.getByTestId('proposal-roster');
    expect(within(rosterNode).queryByText('Eve')).toBeNull();
    expect(within(rosterNode).getByText('Ana')).toBeInTheDocument();
    expect(within(rosterNode).getByText('Bruno')).toBeInTheDocument();
  });

  test.each(['declined', 'expired', 'waitlisted'])(
    'un miembro %s no conserva acceso al chat',
    (response) => {
      renderDetail({ my_response: response });
      expect(screen.queryByTestId('gestation-chat-button')).toBeNull();
    },
  );

  test('un miembro activo sí conserva el chat', () => {
    renderDetail({ my_response: 'accepted' });
    expect(screen.getByTestId('gestation-chat-button')).toBeInTheDocument();
    expect(iAmStillInProposal({ my_response: 'accepted' })).toBe(true);
    expect(iAmStillInProposal({ my_response: 'expired' })).toBe(false);
  });

  test('se eliminó la leyenda decorativa, no los botones de acción', () => {
    renderDetail({ my_response: 'pending' });
    expect(screen.queryByText('confirmado')).toBeNull();
    expect(screen.queryByText('pendiente')).toBeNull();
    expect(screen.queryByText('no juega')).toBeNull();
    // Los botones reales siguen ahí.
    expect(screen.getByRole('button', { name: 'Esta vez no' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Me sumo$/ })).toBeInTheDocument();
    // Y el indicador individual por jugador se conserva.
    expect(within(screen.getByTestId('proposal-roster')).getByText('Confirmado')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Modal de confirmación.
// ---------------------------------------------------------------------------
describe('modal de "Dejar de buscar"', () => {
  test('sin propuestas activas cancela directo, sin modal', async () => {
    renderScreen();
    await waitForActiveSearch();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    });

    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('¿Querés dejar de buscar?')).toBeNull();
  });

  test('con una propuesta en formación pide confirmación con los textos exactos', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-list-section');

    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));

    expect(await screen.findByText('¿Querés dejar de buscar?')).toBeInTheDocument();
    expect(screen.getByText(
      'Vas a dejar de aparecer en los partidos automáticos que todavía se están formando y tu lugar quedará disponible para otros jugadores.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir buscando' })).toBeInTheDocument();
    // El botón principal del modal, además del que abre el modal.
    expect(screen.getAllByRole('button', { name: 'Dejar de buscar' })).toHaveLength(2);
    // Sin confirmar todavía no se llamó al backend.
    expect(mockCancel).not.toHaveBeenCalled();
  });

  test('reutiliza el ConfirmModal de Arma2 (mismo contenedor y overlay)', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');

    const dialog = document.querySelector('[data-modal-root="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-modal-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('confirm-modal-message');
  });

  test('"Seguir buscando" no modifica ningún dato', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');

    fireEvent.click(screen.getByRole('button', { name: 'Seguir buscando' }));

    await waitFor(() => expect(screen.queryByText('¿Querés dejar de buscar?')).toBeNull());
    expect(mockCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId('search-active-summary')).toBeInTheDocument();
    expect(screen.getByTestId('gestation-list-section')).toBeInTheDocument();
  });

  test('Escape cierra el modal sin cancelar nada', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByText('¿Querés dejar de buscar?')).toBeNull());
    expect(mockCancel).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cuándo aparece y cuándo NO. El modal sólo tiene sentido si la baja se va a
  // llevar puesto algo: una gestación viva o una invitación pendiente a un
  // partido ya creado.
  // -------------------------------------------------------------------------
  const CREATED_INVITE = {
    ...LIVE_PROPOSAL,
    id: 21,
    status: 'created',
    partido_id: 55,
    my_response: 'pending',
    roster_slot_kind: 'titular',
  };

  // Al no haber modal, el clic cancela directo: mockCancel es la prueba.
  const expectNoModal = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('¿Querés dejar de buscar?')).toBeNull();
  };

  test.each(['declined', 'expired', 'waitlisted'])(
    'una propuesta donde soy %s NO cuenta: no aparece el modal',
    async (response) => {
      currentProposals = [{ ...LIVE_PROPOSAL, my_response: response }];
      renderScreen();
      await waitForActiveSearch();
      await expectNoModal();
    },
  );

  test('ser accepted en un partido YA creado no alcanza para el modal', async () => {
    // Esa membresía no se toca al dejar de buscar: el jugador ya pertenece al
    // partido real. No hay nada que advertir.
    currentProposals = [{ ...CREATED_INVITE, my_response: 'accepted' }];
    renderScreen();
    await waitForActiveSearch();
    await expectNoModal();
  });

  test('una invitación PENDIENTE de un partido ya creado SÍ pide confirmación', async () => {
    // Esa invitación sí se retira al dejar de buscar, así que se advierte.
    currentProposals = [CREATED_INVITE];
    renderScreen();
    await waitForActiveSearch();

    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));

    expect(await screen.findByText('¿Querés dejar de buscar?')).toBeInTheDocument();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  test('una gestación vencida no revive el modal', async () => {
    currentProposals = [{ ...LIVE_PROPOSAL, expires_at: '2026-07-10T20:30:00-03:00' }];
    renderScreen();
    await waitForActiveSearch();
    await expectNoModal();
  });

  test('el toque fuera del modal lo cierra sin modificar ningún dato', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-list-section');
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');

    const overlay = document.querySelector('[data-modal-root="true"]');
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);

    await waitFor(() => expect(screen.queryByText('¿Querés dejar de buscar?')).toBeNull());
    expect(mockCancel).not.toHaveBeenCalled();
    // Nada del estado local cambió: la búsqueda y las cards siguen ahí.
    expect(screen.getByTestId('search-active-summary')).toBeInTheDocument();
    expect(screen.getByTestId('gestation-list-section')).toBeInTheDocument();
    expect(mockGetProposals).toHaveBeenCalledTimes(1);
  });

  test('mientras se procesa, el modal bloquea el toque exterior y Escape', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-list-section');

    let resolveCancel;
    mockCancel.mockImplementation(() => new Promise((resolve) => { resolveCancel = resolve; }));

    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');
    const [, confirmButton] = screen.getAllByRole('button', { name: 'Dejar de buscar' });
    await act(async () => { fireEvent.click(confirmButton); });

    // El botón de confirmar queda deshabilitado y muestra el estado en curso.
    const processing = screen.getByRole('button', { name: 'Procesando…' });
    expect(processing).toBeDisabled();

    // Ni Escape ni el toque exterior interrumpen una baja ya en vuelo.
    fireEvent.keyDown(document, { key: 'Escape' });
    const overlay = document.querySelector('[data-modal-root="true"]');
    if (overlay) {
      fireEvent.mouseDown(overlay);
      fireEvent.click(overlay);
    }
    expect(mockCancel).toHaveBeenCalledTimes(1);

    currentAvailability = null;
    currentProposals = [];
    await act(async () => {
      resolveCancel({
        availabilityCancelled: 1,
        gestationMembershipsReleased: 1,
        createdInvitesWithdrawn: 0,
        createdMembershipsKept: 0,
      });
    });
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
  });

  test('registra el botón Atrás de Android mientras el modal está abierto', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    expect(mockAddListener).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');

    await waitFor(() => expect(mockAddListener).toHaveBeenCalledWith('backButton', expect.any(Function)));

    // Atrás equivale a "Seguir buscando": cierra el modal y no cancela nada.
    const handler = mockAddListener.mock.calls[0][1];
    await act(async () => { handler(); });
    await waitFor(() => expect(screen.queryByText('¿Querés dejar de buscar?')).toBeNull());
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Efecto de la cancelación sobre la interfaz.
// ---------------------------------------------------------------------------
describe('cancelación efectiva', () => {
  const openModalAndConfirm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');
    const [, confirmButton] = screen.getAllByRole('button', { name: 'Dejar de buscar' });
    await act(async () => { fireEvent.click(confirmButton); });
  };

  test('las cards desaparecen en el acto, sin esperar el próximo polling', async () => {
    currentProposals = [LIVE_PROPOSAL];
    membersById = { 11: [{ user_id: 'a', nombre: 'Ana', response: 'accepted' }] };
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-list-section');

    // El RPC queda pendiente a propósito: la limpieza tiene que ser optimista.
    let resolveCancel;
    mockCancel.mockImplementation(() => new Promise((resolve) => { resolveCancel = resolve; }));

    await openModalAndConfirm();

    await waitFor(() => expect(screen.queryByTestId('gestation-list-section')).toBeNull());
    expect(screen.queryByTestId('gestation-card-11')).toBeNull();
    // Todavía sin respuesta del backend: la limpieza no dependió del refresh.
    expect(mockGetProposals).toHaveBeenCalledTimes(1);

    currentAvailability = null;
    currentProposals = [];
    await act(async () => {
      resolveCancel({
        availabilityCancelled: 1,
        gestationMembershipsReleased: 1,
        createdInvitesWithdrawn: 0,
        createdMembershipsKept: 0,
      });
    });

    // Y después vuelve a consultar disponibilidad y propuestas.
    await waitFor(() => expect(mockGetAvailability).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockGetProposals).toHaveBeenCalledTimes(2));
    await screen.findByRole('heading', { name: '¿CUÁNDO PODÉS JUGAR?' });
  });

  test('un segundo clic no duplica la baja', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-list-section');

    let resolveCancel;
    mockCancel.mockImplementation(() => new Promise((resolve) => { resolveCancel = resolve; }));

    fireEvent.click(screen.getByRole('button', { name: 'Dejar de buscar' }));
    await screen.findByText('¿Querés dejar de buscar?');
    const [, confirmButton] = screen.getAllByRole('button', { name: 'Dejar de buscar' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    currentAvailability = null;
    currentProposals = [];
    await act(async () => {
      resolveCancel({
        availabilityCancelled: 1,
        gestationMembershipsReleased: 1,
        createdInvitesWithdrawn: 0,
        createdMembershipsKept: 0,
      });
    });

    await waitFor(() => expect(mockGetProposals).toHaveBeenCalledTimes(2));
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  test('un error del backend restaura el estado: nada queda contradictorio', async () => {
    currentProposals = [LIVE_PROPOSAL];
    membersById = { 11: [{ user_id: 'a', nombre: 'Ana', response: 'accepted' }] };
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-list-section');

    mockCancel.mockImplementation(async () => { throw new Error('boom'); });

    await openModalAndConfirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos detener la búsqueda. Tu búsqueda sigue activa.',
    );
    // La búsqueda nunca dejó de mostrarse activa y las cards vuelven.
    expect(screen.getByTestId('search-active-summary')).toBeInTheDocument();
    expect(screen.getByTestId('gestation-card-11')).toBeInTheDocument();
    // No se re-consultó el backend con un estado a medias.
    expect(mockGetProposals).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalled();
  });

  test('informa que sigue en los partidos ya creados cuando el backend lo conserva', async () => {
    currentProposals = [LIVE_PROPOSAL];
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-list-section');

    mockCancel.mockImplementation(async () => {
      currentAvailability = null;
      currentProposals = [];
      return {
        availabilityCancelled: 1,
        gestationMembershipsReleased: 1,
        createdInvitesWithdrawn: 1,
        createdMembershipsKept: 2,
      };
    });

    await openModalAndConfirm();

    expect(await screen.findByText('Búsqueda desactivada. Seguís en los partidos que ya se crearon.'))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Defensa adicional en cliente sobre lo que devuelve el backend.
// ---------------------------------------------------------------------------
describe('filtro defensivo del cliente', () => {
  test('una propuesta donde mi membresía es terminal no vuelve como card', async () => {
    currentProposals = [
      LIVE_PROPOSAL,
      { ...LIVE_PROPOSAL, id: 12, my_response: 'declined' },
      { ...LIVE_PROPOSAL, id: 13, my_response: 'expired' },
      { ...LIVE_PROPOSAL, id: 14, my_response: 'waitlisted' },
    ];
    renderScreen();
    await waitForActiveSearch();
    await screen.findByTestId('gestation-card-11');

    expect(screen.queryByTestId('gestation-card-12')).toBeNull();
    expect(screen.queryByTestId('gestation-card-13')).toBeNull();
    expect(screen.queryByTestId('gestation-card-14')).toBeNull();
    // Tampoco se piden sus rosters.
    expect(mockGetMembers).toHaveBeenCalledTimes(1);
    expect(mockGetMembers).toHaveBeenCalledWith(11);
  });
});
