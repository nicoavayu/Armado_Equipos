import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useOutletContext } from 'react-router-dom';
import TournamentApplicationPage from '../features/torneos/components/connected/TournamentApplicationPage';
import ApplicationInboxPage from '../features/torneos/components/connected/ApplicationInboxPage';
import TorneosInboxPage from '../features/torneos/components/connected/TorneosInboxPage';
import TorneosProfilePage from '../features/torneos/components/connected/TorneosProfilePage';
import TorneosInboxBell from '../features/torneos/components/connected/TorneosInboxBell';
import TorneosAccountMenu from '../features/torneos/components/connected/TorneosAccountMenu';
import { TorneosInboxSummaryProvider } from '../features/torneos/components/connected/useTorneosInboxSummary';
import TournamentCatalog from '../features/torneos/components/connected/TournamentCatalog';
import ParticipantTeamRoute from '../features/torneos/components/connected/ParticipantTeamRoute';

// CONNECTED-V1 screens on their own: what each one asks the backend for, what it never decides on the client, and the
// Torneos-only boundaries (bell, account menu, profile). The backend rules themselves are certified on Postgres
// (scripts/db-integration/torneos-connected-product.mjs) and on the hybrid lab (connected.test.mjs).

let mockWorkspace;
let mockCatalog;
const mockAuth = { user: { id: 'user-1', email: 'capi@example.test', user_metadata: { full_name: 'Nombre Core' } }, profile: { nombre: 'Nombre Core' } };

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => mockWorkspace,
}));
jest.mock('../components/AuthContext', () => ({
  useOptionalAuth: () => mockAuth,
}));
jest.mock('../features/torneos/components/connected/useCatalogService', () => ({
  useCatalogService: () => mockCatalog,
}));
jest.mock('../features/torneos/components/MyCommunicationsPage', () => () => <p>Comunicados oficiales</p>);
// Core's push preference of the common account (server-side; Torneos only shows and changes it).
const mockCorePush = { enabled: true, fail: false, saved: [], available: true };
jest.mock('../services/corePushPreferenceService', () => ({
  loadMyCorePushPreference: async () => ({ available: mockCorePush.available, pushEnabled: mockCorePush.enabled }),
  saveMyCorePushPreference: async (enabled) => {
    if (mockCorePush.fail) throw new Error('offline');
    mockCorePush.saved.push(enabled);
    mockCorePush.enabled = enabled;
    return { pushEnabled: enabled };
  },
}));

const SLUG = 'liga-norte-copa-abierta-1a2b3c';
const ENTRY = {
  publicSlug: SLUG,
  tournamentName: 'Copa Abierta',
  organizationName: 'Liga Norte',
  state: 'open',
  categories: [
    { slug: 'primera', name: 'Primera', accepting: true, capacity: 8, approvedTeams: 1 },
    { slug: 'senior', name: 'Senior', accepting: false, capacity: 2, approvedTeams: 2 },
  ],
  entryFee: { amountCents: 1500000, currency: 'ARS', includes: 'Árbitro' },
};

function Location() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderAt(path, pattern, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

function baseService(overrides = {}) {
  return {
    loadTorneosProfile: jest.fn().mockResolvedValue({ displayName: null, notifyRegistrationRequests: true, channels: { inbox: true, push: false, email: false } }),
    updateTorneosProfile: jest.fn().mockResolvedValue({}),
    loadMyRegistrations: jest.fn().mockResolvedValue({ items: [] }),
    loadExperienceRelations: jest.fn().mockResolvedValue({ items: [] }),
    searchApplicableCoreTeams: jest.fn().mockResolvedValue({ items: [{ id: 'core-team-1', name: 'Halcones' }] }),
    startTournamentApplication: jest.fn().mockResolvedValue({ organizationId: 'org-1', teamEntryId: 'entry-1', status: 'in_progress' }),
    createIdempotencyKey: () => 'key-1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.useRealTimers();
  mockCatalog = {
    loadEntry: jest.fn().mockResolvedValue(ENTRY),
    search: jest.fn().mockResolvedValue({ total: 0, items: [], pagination: { page: 1, pages: 1 } }),
    loadFacets: jest.fn().mockResolvedValue({ localities: [], sports: [] }),
  };
  mockWorkspace = { status: 'ready', service: baseService(), availableOrganizations: [] };
});

describe('Explorar → solicitud de inscripción', () => {
  async function chooseTeam() {
    fireEvent.change(screen.getByLabelText('Nombre de tu equipo'), { target: { value: 'Halc' } });
    const option = await screen.findByRole('radio', { name: /Halcones/ });
    fireEvent.click(option);
  }

  test('the team comes from the server search and the request is only created after accepting the conditions', async () => {
    renderAt(`/torneos/explorar/${SLUG}/solicitar`, '/torneos/explorar/:publicSlug/solicitar', <TournamentApplicationPage />);

    expect(await screen.findByRole('heading', { name: 'Copa Abierta' })).toBeInTheDocument();
    // The Torneos name starts from the shared identity as a read-only fallback.
    await waitFor(() => expect(screen.getByLabelText('Nombre de presentación en Torneos')).toHaveValue('Nombre Core'));
    // A full category is not selectable.
    expect(screen.getByRole('radio', { name: /Senior/ })).toBeDisabled();

    await chooseTeam();
    expect(mockWorkspace.service.searchApplicableCoreTeams).toHaveBeenCalledWith({ publicSlug: SLUG, query: 'Halc', limit: 8 });
    const create = screen.getByRole('button', { name: /Crear solicitud/ });
    expect(create).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Leí y acepto las condiciones/ }));
    expect(create).toBeEnabled();
    fireEvent.click(create);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/torneos/mis-equipos/org-1/entry-1/plantel'));
    expect(mockWorkspace.service.updateTorneosProfile).toHaveBeenCalledWith({ displayName: 'Nombre Core', notifyRegistrationRequests: true });
    expect(mockWorkspace.service.startTournamentApplication).toHaveBeenCalledWith({
      publicSlug: SLUG,
      categorySlug: 'primera',
      coreTeamId: 'core-team-1',
      teamName: null,
      message: null,
      acceptConditions: true,
      idempotencyKey: 'key-1',
    });
  });

  test('a refused request keeps the applicant on the form with the domain message', async () => {
    const refusal = Object.assign(new Error('Ese equipo ya está inscripto en la categoría.'), { code: 'TORNEOS_TEAM_ALREADY_REGISTERED' });
    mockWorkspace.service.startTournamentApplication.mockRejectedValueOnce(refusal);
    renderAt(`/torneos/explorar/${SLUG}/solicitar`, '/torneos/explorar/:publicSlug/solicitar', <TournamentApplicationPage />);
    await screen.findByRole('heading', { name: 'Copa Abierta' });
    await chooseTeam();
    fireEvent.click(screen.getByRole('checkbox', { name: /Leí y acepto las condiciones/ }));
    fireEvent.click(screen.getByRole('button', { name: /Crear solicitud/ }));
    expect(await screen.findByText('Ese equipo ya está inscripto en la categoría.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`/torneos/explorar/${SLUG}/solicitar`);
  });

  test('a call that does not accept requests offers no form', async () => {
    mockCatalog.loadEntry.mockResolvedValueOnce({ ...ENTRY, state: 'closed' });
    renderAt(`/torneos/explorar/${SLUG}/solicitar`, '/torneos/explorar/:publicSlug/solicitar', <TournamentApplicationPage />);
    await screen.findByRole('heading', { name: 'Copa Abierta' });
    expect(screen.queryByRole('button', { name: /Crear solicitud/ })).not.toBeInTheDocument();
    expect(mockWorkspace.service.searchApplicableCoreTeams).not.toHaveBeenCalled();
  });
});

describe('Tus equipos de Arma2 en la solicitud', () => {
  const TEAMS = {
    items: [
      { id: 'team-free', name: 'Halcones', crestUrl: null, canRegister: true, registrations: [] },
      { id: 'team-taken', name: 'Halcones B', crestUrl: null, canRegister: true,
        registrations: [{ categorySlug: 'primera', categoryName: 'Primera', status: 'approved' }] },
      { id: 'team-member', name: 'Vecinos', crestUrl: null, canRegister: false, registrations: [] },
    ],
    hasMore: false,
  };

  function renderWithTeams(listMyCoreTeamsForApplication) {
    mockWorkspace.service = baseService({ listMyCoreTeamsForApplication });
    return renderAt(`/torneos/explorar/${SLUG}/solicitar`, '/torneos/explorar/:publicSlug/solicitar', <TournamentApplicationPage />);
  }

  test('your teams are listed without typing; members are explained; a team already in the category cannot be chosen', async () => {
    renderWithTeams(jest.fn().mockResolvedValue(TEAMS));
    expect(await screen.findByRole('radio', { name: /Halcones Podés inscribirlo/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Halcones B.*Ya está en Primera/ })).toBeDisabled();
    // A team they only belong to: no way to register it, the call can be shared with its responsible.
    expect(screen.queryByRole('radio', { name: /Vecinos/ })).not.toBeInTheDocument();
    expect(screen.getByText('Vecinos')).toBeInTheDocument();
    expect(screen.getByText(/Sos integrante: no podés inscribirlo/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de tu equipo')).not.toBeInTheDocument();
    expect(mockWorkspace.service.listMyCoreTeamsForApplication).toHaveBeenCalledWith({ publicSlug: SLUG });
  });

  test('the disabled button says what is missing, next to it, and each item takes you to its field', async () => {
    renderWithTeams(jest.fn().mockResolvedValue(TEAMS));
    await screen.findByRole('radio', { name: /Halcones Podés inscribirlo/ });
    const create = screen.getByRole('button', { name: /Crear solicitud/ });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('aria-describedby', 'application-missing');
    const missing = document.getElementById('application-missing');
    expect(missing).toHaveTextContent('Para crear la solicitud falta:');
    fireEvent.click(within(missing).getByRole('button', { name: 'Aceptar las condiciones' }));
    expect(screen.getByRole('checkbox', { name: /Leí y acepto las condiciones/ })).toHaveFocus();

    fireEvent.click(screen.getByRole('radio', { name: /Halcones Podés inscribirlo/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Leí y acepto las condiciones/ }));
    expect(create).toBeEnabled();
    expect(document.getElementById('application-missing')).toBeNull();
    fireEvent.click(create);
    await waitFor(() => expect(mockWorkspace.service.startTournamentApplication)
      .toHaveBeenCalledWith(expect.objectContaining({ coreTeamId: 'team-free', categorySlug: 'primera' })));
  });

  test('without teams it offers a new team; a failed load is an error with retry, never «no teams»', async () => {
    const list = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('No pudimos cargar tus equipos.'), { code: 'TORNEOS_UNAVAILABLE' }))
      .mockResolvedValueOnce({ items: [], hasMore: false });
    renderWithTeams(list);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos cargar tus equipos.');
    expect(screen.queryByText(/No tenés equipos en Arma2/)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText(/No tenés equipos en Arma2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inscribir un equipo nuevo' }));
    expect(screen.getByLabelText('Nombre del equipo')).toBeInTheDocument();
  });
});

describe('La solicitud desde el espacio del equipo', () => {
  function SendButton() {
    const { onRegistrationChanged } = useOutletContext();
    return <button type="button" onClick={() => onRegistrationChanged()}>Enviar (simulado)</button>;
  }

  test('after sending, the stage is re-read from the server and the creation notice goes away', async () => {
    const statuses = ['in_progress', 'submitted'];
    mockWorkspace.service = {
      loadTeamRegistration: jest.fn().mockResolvedValue({ tournament: { name: 'Copa Abierta' } }),
      loadMyRegistrations: jest.fn(async () => ({
        items: [{ teamEntryId: 'entry-1', status: statuses.shift() || 'submitted', tournamentId: 't-1', categoryId: 'c-1' }],
      })),
    };
    render(
      <MemoryRouter initialEntries={[{ pathname: '/torneos/mis-equipos/org-1/entry-1', state: { notice: 'Solicitud creada.' } }]}>
        <Routes>
          <Route path="/torneos/mis-equipos/:organizationId/:teamEntryId" element={<ParticipantTeamRoute />}>
            <Route index element={<SendButton />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const banner = await screen.findByRole('region', { name: 'Estado de la inscripción' });
    expect(banner).toHaveTextContent('En preparación');
    expect(screen.getByText('Solicitud creada.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar (simulado)' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Estado de la inscripción' })).toHaveTextContent('Solicitud enviada'));
    expect(screen.queryByText('Solicitud creada.')).not.toBeInTheDocument();
    expect(mockWorkspace.service.loadMyRegistrations).toHaveBeenCalledTimes(2);
  });
});

describe('Bandeja de solicitudes del organizador', () => {
  const APPLICATION = {
    teamEntryId: 'entry-1',
    teamName: 'Halcones',
    categoryName: 'Primera',
    coreTeamLinked: true,
    status: 'submitted',
    submittedAt: '2026-10-06T12:00:00Z',
    responsible: { displayName: 'Capi Halcones', role: 'captain' },
    roster: { valid: true, counts: { players: 5, minimumPlayers: 5 }, errors: [] },
    message: 'Jugamos los sábados',
  };

  function renderInbox(items = [APPLICATION]) {
    mockWorkspace.service = {
      loadApplicationInbox: jest.fn().mockResolvedValue({
        tournament: { name: 'Copa Abierta' }, items, counts: { submitted: items.length }, canApprove: true, canReview: true, canReject: true,
      }),
      reviewTeamEntry: jest.fn().mockResolvedValue({}),
    };
    return renderAt('/torneos/organizacion/org-1/torneo/t-1/solicitudes', '/torneos/organizacion/:organizationId/torneo/:tournamentId/solicitudes', <ApplicationInboxPage />);
  }

  test('shows team, category, responsible, roster and message', async () => {
    renderInbox();
    const card = (await screen.findByRole('heading', { name: 'Halcones' })).closest('article');
    expect(within(card).getByText('Primera · Equipo de Arma2')).toBeInTheDocument();
    expect(within(card).getByText('Capi Halcones')).toBeInTheDocument();
    expect(within(card).getByText(/5 de 5 mínimo · completo/)).toBeInTheDocument();
    expect(within(card).getByText('«Jugamos los sábados»')).toBeInTheDocument();
  });

  test('approving without a message sends the default text; a typed message is sent as typed', async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: /Aprobar/ }));
    const dialog = screen.getByRole('dialog', { name: /Aprobar solicitud/ });
    const message = within(dialog).getByLabelText(/Mensaje para el equipo/);
    expect(message).toHaveValue('');
    expect(message).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aprobar' }));
    await waitFor(() => expect(mockWorkspace.service.reviewTeamEntry).toHaveBeenCalledWith({
      organizationId: 'org-1', teamEntryId: 'entry-1', decision: 'approved', reason: 'Inscripción aprobada. ¡Bienvenidos!',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Halcones: solicitud aprobada. El equipo recibe el aviso en Torneos.');
    // The decided card may leave the list: focus lands on the confirmation, not on the page.
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());

    fireEvent.click(await screen.findByRole('button', { name: /Aprobar/ }));
    const second = screen.getByRole('dialog', { name: /Aprobar solicitud/ });
    fireEvent.change(within(second).getByLabelText(/Mensaje para el equipo/), { target: { value: 'Primer partido el sábado' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Aprobar' }));
    await waitFor(() => expect(mockWorkspace.service.reviewTeamEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'Primer partido el sábado' }),
    ));
  });

  test('a rejection needs a reason and a refused decision stays in the dialog', async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar/ }));
    const dialog = screen.getByRole('dialog', { name: /Rechazar solicitud/ });
    const confirm = within(dialog).getByRole('button', { name: 'Rechazar' });
    expect(confirm).toBeDisabled();
    mockWorkspace.service.reviewTeamEntry.mockRejectedValueOnce(new Error('La solicitud ya fue respondida.'));
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'Cupo completo' } });
    fireEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('La solicitud ya fue respondida.');
  });

  test('a roster that does not meet the requirements cannot be approved from the inbox', async () => {
    renderInbox([{ ...APPLICATION, roster: { valid: false, counts: { players: 3, minimumPlayers: 5 }, errors: ['minimum_players'] } }]);
    expect(await screen.findByRole('button', { name: /Aprobar/ })).toBeDisabled();
    expect(screen.getByText('Pendiente: Faltan jugadores')).toBeInTheDocument();
  });
});

describe('Avisos de Torneos', () => {
  const NOTICE = {
    id: 'n-1', kind: 'registration.approved', audience: 'team', title: 'Solicitud aprobada', body: 'Halcones · Primera',
    message: 'Bienvenidos', tournamentName: 'Copa Abierta', organizationId: 'org-1', tournamentId: 't-1', teamEntryId: 'entry-1',
    createdAt: '2026-10-06T12:00:00Z', readAt: null,
  };

  test('opening a notice marks it read and opens its Torneos resource', async () => {
    mockWorkspace.service = {
      loadTorneosNotifications: jest.fn().mockResolvedValue({ items: [NOTICE], pagination: { hasMore: false } }),
      markTorneosNotificationsRead: jest.fn().mockResolvedValue({}),
    };
    renderAt('/torneos/avisos', '/torneos/avisos', <TorneosInboxPage />);
    const notice = await screen.findByRole('button', { name: /Solicitud aprobada/ });
    expect(screen.getByText(/Torneos todavía no envía notificaciones push ni emails/)).toBeInTheDocument();
    fireEvent.click(notice);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/torneos/mis-equipos/org-1/entry-1'));
    expect(mockWorkspace.service.markTorneosNotificationsRead).toHaveBeenCalledWith({ notificationIds: ['n-1'] });
  });

  test('an organizer notice opens the request inbox of that tournament', async () => {
    mockWorkspace.service = {
      loadTorneosNotifications: jest.fn().mockResolvedValue({
        items: [{ ...NOTICE, id: 'n-2', kind: 'registration.submitted', audience: 'organization', title: 'Nueva solicitud de inscripción', readAt: '2026-10-06T13:00:00Z' }],
        pagination: { hasMore: false },
      }),
      markTorneosNotificationsRead: jest.fn(),
    };
    renderAt('/torneos/avisos', '/torneos/avisos', <TorneosInboxPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Nueva solicitud de inscripción/ }));
    await waitFor(() => expect(screen.getByTestId('location'))
      .toHaveTextContent('/torneos/organizacion/org-1/torneo/t-1/solicitudes?equipo=entry-1'));
    expect(mockWorkspace.service.markTorneosNotificationsRead).not.toHaveBeenCalled();
  });

  test('a rescheduled match says the previous and the new time, never a reason, and opens the match', async () => {
    const previous = '2030-10-17T18:00:00.000Z';
    const next = '2030-10-18T20:30:00.000Z';
    const kickoff = (value) => {
      const date = new Date(value);
      const day = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
      return `${day}, ${new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
    };
    mockWorkspace.service = {
      loadTorneosNotifications: jest.fn().mockResolvedValue({
        items: [{
          ...NOTICE, id: 'n-3', kind: 'match.rescheduled', title: 'Partido reprogramado', message: null,
          body: 'Halcones vs. Pumas · Copa Abierta · Primera', matchId: 'match-1', previousScheduledAt: previous, scheduledAt: next,
        }],
        pagination: { hasMore: false },
      }),
      markTorneosNotificationsRead: jest.fn().mockResolvedValue({}),
    };
    renderAt('/torneos/avisos', '/torneos/avisos', <TorneosInboxPage />);
    const notice = await screen.findByRole('button', { name: /Partido reprogramado/ });
    expect(notice).toHaveTextContent(`Antes: ${kickoff(previous)} · Ahora: ${kickoff(next)}`);
    expect(notice.querySelector('q')).toBeNull();
    fireEvent.click(notice);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/torneos/mis-partidos/match-1'));
    expect(mockWorkspace.service.markTorneosNotificationsRead).toHaveBeenCalledWith({ notificationIds: ['n-3'] });
  });

  test('a postponed match says the time it had, that the new date is to be confirmed, and opens the match', async () => {
    mockWorkspace.service = {
      loadTorneosNotifications: jest.fn().mockResolvedValue({
        items: [{
          ...NOTICE, id: 'n-4', kind: 'match.postponed', title: 'Partido postergado', message: null,
          body: 'Halcones vs. Pumas · Copa Abierta · Primera', matchId: 'match-2', previousScheduledAt: '2030-10-17T18:00:00.000Z', scheduledAt: null,
        }],
        pagination: { hasMore: false },
      }),
      markTorneosNotificationsRead: jest.fn().mockResolvedValue({}),
    };
    renderAt('/torneos/avisos', '/torneos/avisos', <TorneosInboxPage />);
    const notice = await screen.findByRole('button', { name: /Partido postergado/ });
    expect(notice).toHaveTextContent(/Antes: .+ · Nueva fecha: a confirmar/);
    fireEvent.click(notice);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/torneos/mis-partidos/match-2'));
  });
});

describe('Perfil de Torneos', () => {
  test('saves the Torneos name on the server, never in the browser, and offers only the channels that exist', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    // The server keeps the profile: a reload returns what was saved.
    let stored = { displayName: null, notifyRegistrationRequests: true, channels: { inbox: true, push: false, email: false } };
    mockWorkspace.service.loadTorneosProfile = jest.fn(async () => stored);
    mockWorkspace.service.updateTorneosProfile = jest.fn(async (input) => {
      stored = { ...stored, ...input };
      return stored;
    });
    renderAt('/torneos/perfil', '/torneos/perfil', <TorneosProfilePage />);
    // The form starts from the server profile: edit only once it has loaded.
    await waitFor(() => expect(mockWorkspace.service.loadTorneosProfile).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByText('Todavía no disponibles en Torneos')).toBeInTheDocument();
    expect(screen.getByText('Todavía no disponible en Torneos')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nombre en Torneos'), { target: { value: '  Capi Halcones  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Perfil de Torneos guardado.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Capi Halcones' })).toBeInTheDocument();
    expect(mockWorkspace.service.updateTorneosProfile).toHaveBeenCalledWith({ displayName: 'Capi Halcones', notifyRegistrationRequests: true });
    expect(setItem.mock.calls.filter(([key]) => /perfil|profile|display/i.test(key))).toEqual([]);
    setItem.mockRestore();
  });

  test('Arma2 notices on the phone: a server-side account preference, without touching Torneos or the session', async () => {
    Object.assign(mockCorePush, { enabled: true, fail: false, saved: [], available: true });
    mockWorkspace.service.loadTorneosProfile = jest.fn(async () => ({ displayName: 'Capi', notifyRegistrationRequests: true, channels: { inbox: true, push: false, email: false } }));
    renderAt('/torneos/perfil', '/torneos/perfil', <TorneosProfilePage />);
    const toggle = await screen.findByRole('checkbox', { name: 'Recibir notificaciones de Arma2 en el teléfono' });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/Se aplica a toda tu cuenta, en todos tus dispositivos\. No cambia tus avisos de Torneos ni cierra tu sesión/);
    expect(toggle).not.toHaveAccessibleDescription(/servidor/);
    fireEvent.click(toggle);
    expect(await screen.findByText(/Arma2 deja de enviarte notificaciones al teléfono\. Tus avisos de Torneos siguen/)).toBeInTheDocument();
    expect(mockCorePush.saved).toEqual([false]);
    expect(toggle).not.toBeChecked();
    // A failed save keeps the previous value and says so.
    mockCorePush.fail = true;
    fireEvent.click(toggle);
    expect(await screen.findByText('No pudimos guardar el cambio. Volvé a intentar.')).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  // A frontend deployed before Core's migration (20261008120000): the RPC does not exist yet, so the control is not
  // offered at all — never an error on the profile and never a switch that cannot work.
  test('without Core\'s preference contract yet, the profile hides the control', async () => {
    Object.assign(mockCorePush, { enabled: true, fail: false, saved: [], available: false });
    mockWorkspace.service.loadTorneosProfile = jest.fn(async () => ({ displayName: 'Capi', notifyRegistrationRequests: true, channels: { inbox: true, push: false, email: false } }));
    renderAt('/torneos/perfil', '/torneos/perfil', <TorneosProfilePage />);
    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Cargando tu preferencia…')).not.toBeInTheDocument());
    expect(screen.queryByRole('checkbox', { name: 'Recibir notificaciones de Arma2 en el teléfono' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No pudimos leer esta preferencia/)).not.toBeInTheDocument();
  });
});

describe('Header de Torneos', () => {
  test('the bell counts only the Torneos inbox and opens it', async () => {
    mockWorkspace.service = { loadTorneosInboxSummary: jest.fn().mockResolvedValue({ total: 2, notificationsUnread: 1, communicationsUnread: 1 }) };
    renderAt('/torneos', '/torneos', <TorneosInboxSummaryProvider><TorneosInboxBell /></TorneosInboxSummaryProvider>);
    const bell = await screen.findByRole('button', { name: 'Abrir avisos de Torneos, 2 sin leer' });
    fireEvent.click(bell);
    expect(screen.getByTestId('location')).toHaveTextContent('/torneos/avisos');
    expect(mockWorkspace.service.loadTorneosInboxSummary).toHaveBeenCalledTimes(1);
  });

  test('without the connected summary the bell has no counter and still opens the Torneos inbox', async () => {
    mockWorkspace.service = {};
    renderAt('/torneos', '/torneos', <TorneosInboxSummaryProvider><TorneosInboxBell /></TorneosInboxSummaryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir avisos de Torneos' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/torneos/avisos');
  });

  test('the account menu only leads to Torneos places', async () => {
    renderAt('/torneos', '/torneos', <TorneosAccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir tu cuenta de Torneos' }));
    const menu = await screen.findByRole('dialog');
    expect(within(menu).getAllByRole('button').filter((item) => item.textContent).length).toBe(3);
    // «Torneos» in this one item is the official wordmark; its accessible name stays complete.
    const profileItem = within(menu).getByRole('button', { name: /^Mi perfil de Torneos/ });
    expect(within(profileItem).getByRole('img', { name: 'Torneos' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /^Avisos de Torneos/ })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /^Explorar torneos/ })).toBeInTheDocument();
    fireEvent.click(profileItem);
    expect(screen.getByTestId('location')).toHaveTextContent('/torneos/perfil');
  });
});

describe('Catálogo', () => {
  test('starts with open calls, can include closed ones, and links each call inside Torneos', async () => {
    mockCatalog.search.mockResolvedValue({
      total: 1,
      items: [{ ...ENTRY, locality: 'Palermo', sportModality: 'football_5', competitionFormat: 'league', genderCategory: 'open', categories: ENTRY.categories }],
      pagination: { page: 1, pages: 1 },
    });
    renderAt('/torneos/explorar', '/torneos/explorar', (
      <TournamentCatalog service={mockCatalog} entryPath={(item) => `/torneos/explorar/${item.publicSlug}`} />
    ));
    expect(await screen.findByRole('link', { name: 'Ver convocatoria de Copa Abierta' })).toHaveAttribute('href', `/torneos/explorar/${SLUG}`);
    expect(mockCatalog.search).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'open', sort: 'closing' }));

    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Sólo con inscripción abierta' }));
    });
    await waitFor(() => expect(mockCatalog.search).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'all' })));
    expect(screen.getByTestId('location')).toHaveTextContent('/torneos/explorar?todas=1');
  });
});
