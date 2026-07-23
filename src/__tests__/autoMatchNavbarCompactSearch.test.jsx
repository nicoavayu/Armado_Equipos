import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Cubre las mejoras de navegación/layout de Partido automático:
//  1. El overlay queda POR DEBAJO de la TabBar (z-[990] < z-[1000]) para que el
//     navbar inferior principal permanezca visible, y reserva su altura abajo
//     (pb-[104px]) para que la última card no quede tapada por el navbar.
//  2. Con la búsqueda inactiva se ve el formulario completo; al activarla el
//     formulario se contrae a un resumen compacto + "Dejar de buscar"; al
//     detenerla vuelve a desplegarse.
//  3. La animación de contracción/expansión respeta prefers-reduced-motion.

const mockUser = { id: 'me' };

let currentAvailability = null;
let currentProposals = [];
let mockProfileLocation = { latitud: -34.6, longitud: -58.4 };

const mockSave = jest.fn(async () => {});
const mockCancel = jest.fn(async () => { currentAvailability = null; });
const mockSync = jest.fn(async () => []);
const mockSyncLocation = jest.fn(async () => currentAvailability);
const mockGetAvailability = jest.fn(async () => currentAvailability);
const mockGetProposals = jest.fn(async () => currentProposals);
const mockGetMembers = jest.fn(async () => []);

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mockProfileLocation, error: null }),
        }),
      }),
    }),
  },
}));

jest.mock('../services/db/availability', () => ({
  ALLOWED_FORMATS: ['F5', 'F6', 'F7', 'F8', 'F9', 'F11'],
  saveMyAvailability: (...args) => mockSave(...args),
  cancelMyAvailability: (...args) => mockCancel(...args),
  respondToAutoMatchProposal: jest.fn(async () => {}),
  respondToAutoMatchSubstitute: jest.fn(async () => 900),
  claimAutoMatchOrganizer: jest.fn(async () => {}),
  syncMyAutoMatchGestations: (...args) => mockSync(...args),
  syncMyAutoMatchLocationFromProfile: (...args) => mockSyncLocation(...args),
  getMyActiveAvailability: (...args) => mockGetAvailability(...args),
  getMyActiveProposals: (...args) => mockGetProposals(...args),
  getAutoMatchProposalMembers: (...args) => mockGetMembers(...args),
}));

jest.mock('../utils/monitoring/sentry', () => ({
  captureException: jest.fn(),
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

const ACTIVE_AVAILABILITY = {
  id: 101,
  days_of_week: [1, 3],
  time_start: '20:00:00',
  time_end: '23:00:00',
  formats: ['F5'],
  max_distance_km: 8,
  latitude: -34.6,
  longitude: -58.4,
  can_organize: true,
};

// Invitación a un partido ya creado: NO depende de la fecha (isMatchInvite sólo
// mira status/my_response/partido_id), así que sirve para verificar el orden en
// el DOM sin caer en el gating temporal de las gestaciones vivas.
const MATCH_INVITE = {
  id: 77,
  format: 'F5',
  proposed_starts_at: '2030-01-01T21:00:00-03:00',
  max_players: 10,
  status: 'created',
  partido_id: 900,
  member_count: 12,
  accepted_count: 10,
  my_response: 'pending',
  roster_slot_kind: 'suplente',
  organizer_id: 'someone',
};

const CONFIG_LABELS = ['Días de la semana', 'Rango horario', 'Formatos aceptados', 'Distancia máxima', 'Puedo organizar el partido'];

// Reloj congelado: las gestaciones vivas dependen de que proposed_starts_at /
// expires_at sean futuros respecto de Date.now(). Fijamos el reloj y construimos
// las fechas de prueba RELATIVAS a ese instante, para que la suite se comporte
// igual cualquier día del año sin tocar los timers reales.
const FROZEN_NOW = Date.parse('2026-07-14T15:00:00.000Z');
const HOUR_MS = 3600 * 1000;
const isoFromFrozen = (ms) => new Date(FROZEN_NOW + ms).toISOString();

// Gestación viva (colecta, membresía activa) con arranque a futuro.
const liveGestation = (overrides = {}) => ({
  id: 55,
  format: 'F5',
  proposed_starts_at: isoFromFrozen(6 * HOUR_MS),
  max_players: 10,
  status: 'collecting',
  member_count: 6,
  accepted_count: 4,
  my_response: 'accepted',
  organizer_id: null,
  ...overrides,
});

const renderScreen = (initialEntry = '/quiero-jugar?auto=1') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <AvailabilityOpportunityCard />
  </MemoryRouter>,
);

const setReducedMotion = (matches) => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
};

beforeEach(() => {
  // resetMocks: true limpia el spy antes de cada test; se re-instala acá.
  jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  currentAvailability = null;
  currentProposals = [];
  mockProfileLocation = { latitud: -34.6, longitud: -58.4 };
  mockSave.mockImplementation(async () => {});
  mockCancel.mockImplementation(async () => { currentAvailability = null; });
  mockSync.mockImplementation(async () => []);
  mockSyncLocation.mockImplementation(async () => currentAvailability);
  mockGetAvailability.mockImplementation(async () => currentAvailability);
  mockGetProposals.mockImplementation(async () => currentProposals);
  mockGetMembers.mockImplementation(async () => []);
  delete window.matchMedia;
});

describe('navbar visibility and non-overlap', () => {
  test('the auto-match overlay sits BELOW the bottom TabBar (z-[990] < z-[1000]) so the navbar stays visible', async () => {
    renderScreen();
    const dialog = await screen.findByRole('dialog', { name: 'Partido automático' });

    // z-[990] queda por debajo de la TabBar (z-[1000]); NO usa el z-[1200] viejo
    // que la tapaba por completo.
    expect(dialog.className).toContain('z-[990]');
    expect(dialog.className).not.toContain('z-[1200]');
  });

  test('the scrollable content reserves the TabBar height so the last card is not covered', async () => {
    renderScreen();
    const dialog = await screen.findByRole('dialog', { name: 'Partido automático' });
    const main = dialog.querySelector('main');

    // Mismo padding inferior que MainLayout usa para el resto de las pantallas.
    expect(main.className).toContain('pb-[104px]');
    expect(main.className).toContain('md:pb-[112px]');
  });

  test('unmounting tears down the portal and leaves no leftover overlay or body class', async () => {
    const { unmount } = renderScreen();
    await screen.findByRole('dialog', { name: 'Partido automático' });

    // Mientras está abierto NO ensucia el body con clases temporales propias.
    expect(document.body.classList.contains('chat-open')).toBe(false);

    // Navegar a otra pestaña desmonta QuieroJugarPage → este componente. El
    // portal debe desaparecer del body: sin overlay invisible que bloquee la
    // pantalla siguiente ni clase temporal residual.
    unmount();
    expect(screen.queryByRole('dialog', { name: 'Partido automático' })).toBeNull();
    expect(document.querySelector('[aria-label="Partido automático"]')).toBeNull();
    expect(document.body.classList.contains('chat-open')).toBe(false);
  });
});

describe('search config collapses when active and expands when stopped', () => {
  test('inactive search shows the full editable configuration and the activate CTA', async () => {
    renderScreen();
    const section = await screen.findByTestId('auto-search-section');

    // El CTA "Activar búsqueda" aparece una vez resuelta la ubicación del perfil.
    expect(await within(section).findByText('Activar búsqueda')).toBeInTheDocument();
    for (const label of CONFIG_LABELS) {
      expect(within(section).getByText(label)).toBeInTheDocument();
    }
    expect(within(section).queryByText('Dejar de buscar')).toBeNull();
    expect(screen.queryByTestId('search-active-summary')).toBeNull();
  });

  test('active search compacts the config into a short summary that reflects the real criteria', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    renderScreen();

    const summary = await screen.findByTestId('search-active-summary');
    const section = screen.getByTestId('auto-search-section');

    // Encabezado de estado activo + "Dejar de buscar" siempre visible.
    expect(within(summary).getByText('Tu búsqueda está activa')).toBeInTheDocument();
    expect(within(section).getByText('Dejar de buscar')).toBeInTheDocument();

    // El formulario completo ya NO está: la configuración se contrajo.
    for (const label of CONFIG_LABELS) {
      expect(within(section).queryByText(label)).toBeNull();
    }
    expect(within(section).queryByText('Activar búsqueda')).toBeNull();

    // El resumen refleja los criterios reales: días + horario, formato y distancia.
    expect(within(summary).getByText((t) => t.includes('Lun') && t.includes('Mié') && t.includes('20:00'))).toBeInTheDocument();
    expect(within(summary).getByText('F5')).toBeInTheDocument();
    expect(within(summary).getByText(/hasta 8 km/)).toBeInTheDocument();
  });

  test('the active summary (and its cards) render above the match list', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [MATCH_INVITE];
    renderScreen();

    const section = await screen.findByTestId('auto-search-section');
    const inviteList = await screen.findByTestId('match-invite-list-section');

    // La búsqueda activa aparece ARRIBA de las cards de partidos.
    expect(
      // eslint-disable-next-line no-bitwise
      section.compareDocumentPosition(inviteList) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('activating then stopping the search collapses and then re-expands the full config', async () => {
    renderScreen();
    const section = await screen.findByTestId('auto-search-section');

    // Punto de partida: formulario completo (con el CTA ya resuelto).
    expect(await within(section).findByText('Días de la semana')).toBeInTheDocument();
    const activate = await within(section).findByText('Activar búsqueda');

    // Activar → se contrae. (Hace falta al menos un día seleccionado para habilitar el CTA.)
    fireEvent.click(within(section).getByText('LU'));
    mockSave.mockImplementationOnce(async () => { currentAvailability = ACTIVE_AVAILABILITY; });
    fireEvent.click(activate);

    await screen.findByTestId('search-active-summary');
    expect(within(section).queryByText('Días de la semana')).toBeNull();
    const stopButton = within(section).getByText('Dejar de buscar');
    expect(stopButton).toBeInTheDocument();

    // Dejar de buscar → se vuelve a desplegar.
    fireEvent.click(stopButton);

    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    await within(section).findByText('Días de la semana');
    expect(within(section).getByText('Activar búsqueda')).toBeInTheDocument();
    expect(screen.queryByTestId('search-active-summary')).toBeNull();
  });
});

describe('detail and invite screens stay navbar-safe', () => {
  test('the proposal detail screen reserves the navbar height and lives inside the base overlay (below the TabBar)', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [liveGestation({ id: 55 })];
    renderScreen('/quiero-jugar?auto=1&proposal=55');

    const dialog = await screen.findByRole('dialog', { name: 'Partido automático' });
    const detail = await screen.findByTestId('gestation-detail-screen');
    const detailMain = detail.querySelector('main');

    // Mismo padding inferior que el resto de las pantallas: la última fila no
    // queda tapada por el navbar, que permanece visible también en el detalle.
    expect(detailMain.className).toContain('pb-[104px]');
    expect(detailMain.className).toContain('md:pb-[112px]');
    // El detalle está anidado dentro del overlay base z-[990], por lo que queda
    // por debajo de la TabBar (z-[1000]) — el navbar sigue visible.
    expect(dialog.className).toContain('z-[990]');
    expect(dialog.contains(detail)).toBe(true);
  });

  test('the match-invite screen also reserves the navbar height and lives inside the base overlay', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [MATCH_INVITE];
    renderScreen('/quiero-jugar?auto=1&invite=77');

    const dialog = await screen.findByRole('dialog', { name: 'Partido automático' });
    const invite = await screen.findByTestId('match-invite-screen');
    const inviteMain = invite.querySelector('main');

    expect(inviteMain.className).toContain('pb-[104px]');
    expect(inviteMain.className).toContain('md:pb-[112px]');
    expect(dialog.contains(invite)).toBe(true);
  });
});

describe('date independence (frozen clock, relative fixtures)', () => {
  test('a future proposal is visible as a gestation card', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [liveGestation({ id: 55, proposed_starts_at: isoFromFrozen(6 * HOUR_MS) })];
    renderScreen();

    const list = await screen.findByTestId('gestation-list-section');
    expect(within(list).getByTestId('gestation-card-55')).toBeInTheDocument();
  });

  test('a past proposal is NOT visible (excluded, list is never rendered)', async () => {
    currentAvailability = ACTIVE_AVAILABILITY;
    currentProposals = [liveGestation({ id: 55, proposed_starts_at: isoFromFrozen(-2 * HOUR_MS) })];
    renderScreen();

    await screen.findByTestId('auto-search-section');
    await waitFor(() => expect(mockGetProposals).toHaveBeenCalled());
    expect(screen.queryByTestId('gestation-card-55')).toBeNull();
    expect(screen.queryByTestId('gestation-list-section')).toBeNull();
  });
});

describe('the search toggles cleanly across repeated cycles', () => {
  test('activating and stopping twice always lands on the right state', async () => {
    renderScreen();
    const section = await screen.findByTestId('auto-search-section');
    await within(section).findByText('Activar búsqueda');

    // Declarada fuera del loop (evita no-loop-func): al guardar, activa la búsqueda.
    const activateOnce = async () => { currentAvailability = ACTIVE_AVAILABILITY; };

    for (let cycle = 0; cycle < 2; cycle += 1) {
      // Activar → contrae al resumen compacto.
      if (within(section).queryByText('LU')) fireEvent.click(within(section).getByText('LU'));
      mockSave.mockImplementationOnce(activateOnce);
      fireEvent.click(within(section).getByText('Activar búsqueda'));
      await screen.findByTestId('search-active-summary');
      expect(within(section).queryByText('Días de la semana')).toBeNull();

      // Detener → re-despliega el formulario completo.
      fireEvent.click(within(section).getByText('Dejar de buscar'));
      await within(section).findByText('Días de la semana');
      expect(within(section).getByText('Activar búsqueda')).toBeInTheDocument();
      expect(screen.queryByTestId('search-active-summary')).toBeNull();
    }
  });
});

describe('reduced motion is respected', () => {
  test('with prefers-reduced-motion the reveal is not animated', async () => {
    setReducedMotion(true);
    currentAvailability = ACTIVE_AVAILABILITY;
    renderScreen();

    const reveal = await screen.findByTestId('auto-search-reveal');
    await waitFor(() => expect(reveal).toHaveAttribute('data-animated', 'false'));
    // La guarda estática de Tailwind también está presente.
    expect(reveal.className).toContain('motion-reduce:transition-none');
  });

  test('without the preference the reveal animates', async () => {
    setReducedMotion(false);
    currentAvailability = ACTIVE_AVAILABILITY;
    renderScreen();

    const reveal = await screen.findByTestId('auto-search-reveal');
    expect(reveal).toHaveAttribute('data-animated', 'true');
  });
});
