// MP-A5 — Plan / Comprar Premium / PurchaseStatus in the hybrid (staging-v1) composition with the
// billing TEST overlay. Everything reaches the backend through the injected service → transport: the
// Core singleton is a trap and so are the legacy commerce functions. Premium is shown only from the
// server's effective entitlements, never from a redirect route, a Preference or MP query params.
import React from 'react';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import StagingV1TorneosApp from '../features/torneos/stagingV1/StagingV1TorneosApp';
import { stagingV1Features } from '../features/torneos/stagingV1/stagingV1Features';
import { createStagingV1WorkspaceService } from '../features/torneos/stagingV1/stagingV1WorkspaceService';
import { TournamentWorkspaceError } from '../features/torneos/api/tournamentWorkspaceErrors';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import { TOURNAMENT_PLANS, TOURNAMENT_PLAN_SOURCES } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const coreAccesses = [];
jest.mock('../lib/supabaseClient', () => {
  const trap = new Proxy({}, {
    get(_, property) {
      if (property === '__esModule') return false;
      if (property === 'then') return undefined;
      // eslint-disable-next-line no-undef
      coreAccesses.push(String(property));
      throw new Error(`Core singleton accessed from the hybrid commerce composition: ${String(property)}`);
    },
  });
  return { supabase: trap, supabaseCore: trap, default: trap };
});
const mockLegacyCalls = [];
jest.mock('../features/torneos/api/tournamentWorkspaceService', () => {
  const actual = jest.requireActual('../features/torneos/api/tournamentWorkspaceService');
  const trap = (name) => (...args) => {
    mockLegacyCalls.push(name);
    throw new Error(`legacy commerce reached from the hybrid composition: ${name}(${args.length})`);
  };
  return {
    ...actual,
    createIdempotencyKey: trap('createIdempotencyKey'),
    createTournamentCheckout: trap('createTournamentCheckout'),
    loadTournamentPurchase: trap('loadTournamentPurchase'),
    loadEffectiveTournamentSeasonEntitlements: trap('loadEffectiveTournamentSeasonEntitlements'),
    loadEffectiveTournamentEntitlements: trap('loadEffectiveTournamentEntitlements'),
  };
});
jest.mock('../components/global-header/GlobalHeader', () => () => <header data-testid="global-header" />);

const ORG = '91000000-0000-4000-8000-000000000001';
const SEASON = '92000000-0000-4000-8000-000000000001';
const TOURNAMENT = '93000000-0000-4000-8000-000000000001';
const PURCHASE = '96000000-0000-4000-8000-000000000001';
const KEY = '97000000-0000-4000-8000-000000000001';
const CHECKOUT_URL = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=lab-pref-1';
const PLAN_PATH = `/torneos/organizacion/${ORG}/temporada/${SEASON}/plan`;
const statusPath = (result, search = '') => `${PLAN_PATH}/compra/${PURCHASE}/${result}${search}`;

function competition() {
  return {
    preference: { organizationId: ORG, activeSeasonId: SEASON, activeTournamentId: TOURNAMENT },
    seasons: [{ id: SEASON, organizationId: ORG, name: 'Apertura 2026', status: 'active' }],
    tournaments: [{
      id: TOURNAMENT, organizationId: ORG, seasonId: SEASON, name: 'Liga Híbrida', slug: 'liga-hibrida', status: 'registration',
      sportModality: 'football_5', competitionFormat: 'league', genderCategory: 'mixed', categories: [],
      checklist: { ready: true, checks: {} }, logoPath: null, organizationLogoPath: null,
    }],
    modalities: [],
    formats: [],
  };
}

function entitlements({ plan = TOURNAMENT_PLANS.FREE, listPrice = 51000, launchPrice = 41000, assignmentSource } = {}) {
  const payload = tournamentEntitlementsFixture({
    organizationId: ORG,
    seasonId: SEASON,
    tournamentId: null,
    plan,
    ...(assignmentSource ? { assignmentSource } : {}),
  });
  // Server projection prices that differ from any launch constant: the page must print these.
  return { ...payload, pricing: { ...payload.pricing, listPrice, launchPrice } };
}
const premium = () => entitlements({ plan: TOURNAMENT_PLANS.PREMIUM, assignmentSource: TOURNAMENT_PLAN_SOURCES.PURCHASE });

function purchase(status, overrides = {}) {
  return {
    schemaVersion: 3, id: PURCHASE, organizationId: ORG, seasonId: SEASON, tournamentId: null, status,
    amount: 41000, listAmount: 51000, currency: 'ARS', provider: 'MERCADO_PAGO', providerEnvironment: 'test', ...overrides,
  };
}

function createAdapter({ role = 'owner', commerce = true, seasonEntitlements = entitlements() } = {}) {
  const organization = {
    id: ORG, name: 'Liga Devoto', slug: 'liga-devoto', role, status: 'active', capabilities: getCapabilitiesForRole(role),
  };
  const base = {
    loadContext: jest.fn().mockResolvedValue({ preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG }, organizations: [organization] }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    createOrganization: jest.fn(),
    checkSlugAvailability: jest.fn(),
    updateOrganization: jest.fn(),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    loadMyTournaments: jest.fn().mockResolvedValue({ items: [], pagination: { hasMore: false } }),
    loadExperienceRelations: jest.fn().mockResolvedValue({ items: [], pagination: { hasMore: false } }),
    listMembers: jest.fn().mockResolvedValue([]),
    listSeasonMemberAssignments: jest.fn().mockResolvedValue([]),
    assignSeasonMember: jest.fn(),
    removeSeasonMemberAssignment: jest.fn(),
    loadCompetitionContext: jest.fn().mockResolvedValue(competition()),
    loadTeamsContext: jest.fn().mockResolvedValue({ settings: {}, entries: [] }),
    createIdempotencyKey: jest.fn(() => KEY),
  };
  if (!commerce) return base;
  return {
    ...base,
    loadSeasonEntitlements: jest.fn().mockResolvedValue(seasonEntitlements),
    loadPurchase: jest.fn().mockResolvedValue(purchase('pending')),
    createCheckout: jest.fn().mockResolvedValue({
      purchase: purchase('created', { providerPreferenceId: null }),
      preference: { provider: 'MERCADO_PAGO', preferenceId: 'lab-pref-1', checkoutUrl: CHECKOUT_URL, expiresAt: '2026-09-24T00:00:00Z' },
    }),
  };
}

let currentPath = '';
function LocationProbe() {
  const location = useLocation();
  currentPath = `${location.pathname}${location.search}`;
  return null;
}

function renderHybrid(path, {
  adapter = createAdapter(), billingMode = 'test', features = undefined, checkoutRedirect = jest.fn(),
} = {}) {
  currentPath = path;
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/torneos/*"
          element={(
            <StagingV1TorneosApp
              gatewayUrl="http://127.0.0.1:58423"
              service={adapter}
              billingMode={billingMode}
              features={features}
              checkoutRedirect={checkoutRedirect}
            />
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, adapter, checkoutRedirect };
}

const buyButton = () => screen.findByRole('button', { name: /Comprar Premium/i });

beforeEach(() => {
  coreAccesses.length = 0;
  mockLegacyCalls.length = 0;
});
afterEach(() => {
  expect(coreAccesses).toEqual([]);
  expect(mockLegacyCalls).toEqual([]);
  jest.useRealTimers();
});

describe('MP-A5 feature gating in the hybrid composition', () => {
  test('default hybrid (billing off): Plan and purchase routes are unavailable and no commerce method is ever called', async () => {
    const adapter = createAdapter();
    renderHybrid(PLAN_PATH, { adapter, billingMode: 'off' });
    await screen.findByText(/todavía no está habilitada/);
    renderHybrid(statusPath('exito'), { adapter, billingMode: 'off' });
    await waitFor(() => expect(screen.getAllByText(/todavía no está habilitada/).length).toBe(2));
    for (const name of ['loadSeasonEntitlements', 'loadPurchase', 'createCheckout']) expect(adapter[name]).not.toHaveBeenCalled();
  });

  test('the TEST overlay keeps the legacy Plan redirects off', async () => {
    renderHybrid(`/torneos/organizacion/${ORG}/configuracion/plan`);
    await screen.findByText(/todavía no está habilitada/);
    renderHybrid(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/plan`);
    await waitFor(() => expect(screen.getAllByText(/todavía no está habilitada/).length).toBe(2));
  });

  test('organization settings link Plan to the season plan route, not to the legacy redirect', async () => {
    renderHybrid(`/torneos/organizacion/${ORG}/configuracion`);
    const link = await screen.findByRole('link', { name: 'Plan' });
    expect(link.getAttribute('href')).toBe(PLAN_PATH);
  });

  test('plan without billing shows the plan but offers no purchase', async () => {
    const adapter = createAdapter();
    renderHybrid(PLAN_PATH, { adapter, features: { ...stagingV1Features, entitlements: true, plan: true, billing: false } });
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comprar Premium/i })).toBeNull();
    expect(screen.getByText(/compra no está habilitada en este entorno/i)).toBeInTheDocument();
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
});

describe('MP-A5 Plan page', () => {
  test('FREE shows the server-side list and launch prices, one-time payment and the current plan', async () => {
    const { adapter } = renderHybrid(PLAN_PATH);
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' })).toBeInTheDocument();
    expect(screen.getByText(/Precio habitual:/)).toHaveTextContent(/51\.000/);
    expect(screen.getByText('Precio lanzamiento').nextElementSibling).toHaveTextContent(/41\.000/);
    expect(document.body).not.toHaveTextContent(/39\.900|49\.900/);
    expect(screen.getByText('Pago único para esta temporada · Sin suscripción')).toBeInTheDocument();
    expect(await buyButton()).toBeEnabled();
    expect(adapter.loadSeasonEntitlements).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON });
  });

  test('PREMIUM (server entitlement) shows Premium as the current plan and no purchase button', async () => {
    renderHybrid(PLAN_PATH, { adapter: createAdapter({ seasonEntitlements: premium() }) });
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comprar Premium/i })).toBeNull();
  });

  test('a collaborator without billing.manage sees the plan but cannot buy', async () => {
    const { adapter } = renderHybrid(PLAN_PATH, { adapter: createAdapter({ role: 'collaborator' }) });
    expect(await buyButton()).toBeDisabled();
    expect(screen.getByText(/Sólo el Propietario o un Administrador pueden comprar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Comprar Premium/i }));
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });

  test('loading, then an entitlement error fails closed with a retry and without Premium', async () => {
    const adapter = createAdapter();
    let reject;
    adapter.loadSeasonEntitlements.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    renderHybrid(PLAN_PATH, { adapter });
    expect(await screen.findByText(/Cargando el plan de esta temporada/)).toBeInTheDocument();
    await act(async () => reject(new TournamentWorkspaceError('TORNEOS_UNAVAILABLE', 'Torneos no está disponible en este momento.')));
    expect(await screen.findByText('No pudimos cargar el plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comprar Premium/i })).toBeNull();
    expect(document.body).not.toHaveTextContent('Arma2 Torneos Premium');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' })).toBeInTheDocument();
  });

  test('G1 stale purchase: status `created` + a valid preference redirects to Checkout Pro and grants nothing', async () => {
    const { adapter, checkoutRedirect } = renderHybrid(PLAN_PATH);
    fireEvent.click(await buyButton());
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(CHECKOUT_URL));
    expect(checkoutRedirect).toHaveBeenCalledTimes(1);
    expect(adapter.createCheckout).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY });
    expect(Object.keys(adapter.createCheckout.mock.calls[0][0])).toEqual(['organizationId', 'seasonId', 'idempotencyKey']);
    expect(screen.getByRole('heading', { name: 'Arma2 Torneos Free' })).toBeInTheDocument();
    expect(currentPath).toBe(PLAN_PATH);
    expect(adapter.loadPurchase).not.toHaveBeenCalled();
  });

  test('a double click creates one checkout request', async () => {
    const adapter = createAdapter();
    let resolve;
    adapter.createCheckout.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    const button = await buyButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ purchase: purchase('created'), preference: { provider: 'MERCADO_PAGO', preferenceId: 'p', checkoutUrl: CHECKOUT_URL, expiresAt: 'x' } }));
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledTimes(1));
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
  });

  test('a retry after an error reuses the same idempotency key (no new key per attempt)', async () => {
    const adapter = createAdapter();
    adapter.createCheckout.mockRejectedValueOnce(new TournamentWorkspaceError('TORNEOS_PAYMENTS_UNAVAILABLE', 'El servicio de pagos no está disponible en este momento. Volvé a intentar.'));
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    fireEvent.click(await buyButton());
    expect(await screen.findByText(/servicio de pagos no está disponible/)).toBeInTheDocument();
    expect(checkoutRedirect).not.toHaveBeenCalled();
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
    fireEvent.click(await buyButton());
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(CHECKOUT_URL));
    expect(adapter.createCheckout).toHaveBeenCalledTimes(2);
    expect(adapter.createCheckout.mock.calls[1][0].idempotencyKey).toBe(adapter.createCheckout.mock.calls[0][0].idempotencyKey);
    expect(adapter.createIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  test('TORNEOS_SEASON_PREMIUM_SUSPENDED explains the suspension and offers no new purchase', async () => {
    const adapter = createAdapter();
    adapter.createCheckout.mockRejectedValueOnce(new TournamentWorkspaceError('TORNEOS_SEASON_PREMIUM_SUSPENDED', 'El Premium de esta temporada está suspendido por un contracargo en disputa.'));
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    fireEvent.click(await buyButton());
    expect(await screen.findByText(/Premium de esta temporada está suspendido/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comprar Premium/i })).toBeNull();
    const blocked = screen.getByRole('button', { name: /Compra no disponible/i });
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
    expect(checkoutRedirect).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('Arma2 Torneos Premium');
  });

  test('TORNEOS_SEASON_ALREADY_PREMIUM re-reads the server plan instead of claiming Premium locally', async () => {
    const adapter = createAdapter();
    adapter.createCheckout.mockRejectedValueOnce(new TournamentWorkspaceError('TORNEOS_SEASON_ALREADY_PREMIUM', 'Esta temporada ya tiene Premium activo.'));
    renderHybrid(PLAN_PATH, { adapter });
    fireEvent.click(await buyButton());
    adapter.loadSeasonEntitlements.mockResolvedValue(premium());
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' })).toBeInTheDocument();
    expect(adapter.loadSeasonEntitlements).toHaveBeenCalledTimes(2);
  });

  test('a purchase that is no longer open (preference null) opens its status page; the server decides', async () => {
    const adapter = createAdapter();
    adapter.createCheckout.mockResolvedValueOnce({ purchase: purchase('pending'), preference: null });
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    fireEvent.click(await buyButton());
    await waitFor(() => expect(currentPath).toBe(statusPath('pendiente')));
    expect(checkoutRedirect).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: /esperando confirmación/i })).toBeInTheDocument();
  });

  test.each([
    ['plain http', 'http://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x'],
    ['lookalike host', 'https://mercadopago.com.ar.lab-attacker.invalid/checkout/v1/redirect?pref_id=x'],
    ['suffix host', 'https://evilmercadopago.com.ar/checkout/v1/redirect?pref_id=x'],
    ['subdomain spoof', 'https://www.mercadopago.com.ar.evil.example/checkout'],
    ['userinfo', 'https://www.mercadopago.com.ar@evil.example/checkout'],
    ['userinfo on the real host', 'https://attacker:secret@www.mercadopago.com.ar/checkout'],
    ['explicit port', 'https://www.mercadopago.com.ar:8443/checkout'],
    // eslint-disable-next-line no-script-url
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['relative path', '/checkout/v1/redirect'],
    ['malformed', 'https://'],
    ['not a string', 42],
  ])('redirect security — %s is refused before any navigation', async (_, checkoutUrl) => {
    const adapter = createAdapter();
    adapter.createCheckout.mockResolvedValueOnce({
      purchase: purchase('created'), preference: { provider: 'MERCADO_PAGO', preferenceId: 'p', checkoutUrl, expiresAt: 'x' },
    });
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    fireEvent.click(await buyButton());
    expect(await screen.findByText(/dirección de pago inválida/)).toBeInTheDocument();
    expect(checkoutRedirect).not.toHaveBeenCalled();
    expect(currentPath).toBe(PLAN_PATH);
  });

  test('redirect security — the Checkout Pro HTTPS hosts are accepted', async () => {
    for (const url of [CHECKOUT_URL, 'https://www.mercadopago.com/checkout/v1/redirect?pref_id=x', 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=x']) {
      const adapter = createAdapter();
      adapter.createCheckout.mockResolvedValueOnce({
        purchase: purchase('created'), preference: { provider: 'MERCADO_PAGO', preferenceId: 'p', checkoutUrl: url, expiresAt: 'x' },
      });
      const { checkoutRedirect, unmount } = renderHybrid(PLAN_PATH, { adapter });
      fireEvent.click(await buyButton());
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(url));
      unmount();
    }
  });
});

describe('MP-A5 PurchaseStatus page', () => {
  test('pending: reads the purchase, polls every ~4 s while open and never shows Premium', async () => {
    jest.useFakeTimers();
    const adapter = createAdapter();
    adapter.loadPurchase.mockResolvedValue(purchase('pending'));
    renderHybrid(statusPath('pendiente'), { adapter });
    expect(await screen.findByRole('heading', { name: /esperando confirmación/i })).toBeInTheDocument();
    expect(adapter.loadPurchase).toHaveBeenCalledWith(expect.objectContaining({ purchaseId: PURCHASE, organizationId: ORG, seasonId: SEASON }));
    const before = adapter.loadPurchase.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(4000); });
    await waitFor(() => expect(adapter.loadPurchase.mock.calls.length).toBe(before + 1));
    expect(screen.getByText('Mercado Pago')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test('approved + server entitlement PREMIUM → Premium visible, then polling stops', async () => {
    jest.useFakeTimers();
    const adapter = createAdapter({ seasonEntitlements: premium() });
    adapter.loadPurchase.mockResolvedValueOnce(purchase('pending')).mockResolvedValue(purchase('approved'));
    renderHybrid(statusPath('pendiente'), { adapter });
    expect(await screen.findByRole('heading', { name: /esperando confirmación/i })).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(4000); });
    expect(await screen.findByRole('heading', { name: 'Premium ya está activo' })).toBeInTheDocument();
    expect(currentPath).toBe(statusPath('exito'));
    expect(screen.getByText('Plan de la temporada').nextElementSibling).toHaveTextContent('Premium');
    const calls = adapter.loadPurchase.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(12000); });
    expect(adapter.loadPurchase.mock.calls.length).toBe(calls);
  });

  test('approved but the server entitlement is not Premium → no Premium claim', async () => {
    const adapter = createAdapter({ seasonEntitlements: entitlements() });
    adapter.loadPurchase.mockResolvedValue(purchase('approved'));
    renderHybrid(statusPath('exito'), { adapter });
    expect(await screen.findByRole('heading', { name: /verificando/i })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
    expect(screen.getByText('Plan de la temporada').nextElementSibling).toHaveTextContent('Free');
  });

  test('the /exito redirect URL and MP query params grant nothing: a pending purchase is shown as pending', async () => {
    const adapter = createAdapter({ seasonEntitlements: premium() });
    adapter.loadPurchase.mockResolvedValue(purchase('pending'));
    renderHybrid(statusPath('exito', '?collection_status=approved&status=approved&payment_id=123&preference_id=lab-pref-1'), { adapter });
    await waitFor(() => expect(currentPath).toBe(statusPath('pendiente')));
    expect(await screen.findByRole('heading', { name: /esperando confirmación/i })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test('refunded → failure view and the plan is back to Free', async () => {
    const adapter = createAdapter({ seasonEntitlements: entitlements() });
    adapter.loadPurchase.mockResolvedValue(purchase('refunded'));
    renderHybrid(statusPath('exito'), { adapter });
    expect(await screen.findByRole('heading', { name: /pago fue reembolsado/i })).toBeInTheDocument();
    expect(currentPath).toBe(statusPath('fallo'));
    expect(screen.getByText('Plan de la temporada').nextElementSibling).toHaveTextContent('Free');
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test('charged_back → contracargo, Premium is not effective', async () => {
    const adapter = createAdapter({ seasonEntitlements: entitlements() });
    adapter.loadPurchase.mockResolvedValue(purchase('charged_back'));
    renderHybrid(statusPath('fallo'), { adapter });
    expect(await screen.findByRole('heading', { name: /contracargo/i })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
    expect(screen.getByText('Plan de la temporada').nextElementSibling).not.toHaveTextContent('Premium');
  });

  test.each([
    ['expired', /solicitud venció/i],
    ['cancelled', /pago no fue aprobado|cancelada/i],
    ['rejected', /pago no fue aprobado/i],
  ])('%s is final: failure view, no Premium, no polling', async (status, title) => {
    jest.useFakeTimers();
    const adapter = createAdapter();
    adapter.loadPurchase.mockResolvedValue(purchase(status));
    renderHybrid(statusPath('fallo'), { adapter });
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    const calls = adapter.loadPurchase.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(12000); });
    expect(adapter.loadPurchase.mock.calls.length).toBe(calls);
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test('a rejected attempt on a still-open purchase (MP-A2.1) opens the pending route with a rejection notice, never Premium', async () => {
    const adapter = createAdapter({ seasonEntitlements: premium() });
    adapter.loadPurchase.mockResolvedValue(purchase('preference_created', { providerStatus: 'rejected', providerStatusDetail: 'cc_rejected_other_reason' }));
    renderHybrid(statusPath('fallo', '?collection_status=rejected&status=rejected'), { adapter });
    await waitFor(() => expect(currentPath).toBe(statusPath('pendiente')));
    expect(await screen.findByRole('heading', { name: /último intento de pago no fue aprobado/i })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });

  test('a purchase of another season fails closed', async () => {
    const adapter = createAdapter();
    adapter.loadPurchase.mockRejectedValue(new TournamentWorkspaceError('TORNEOS_PURCHASE_FORBIDDEN', 'No encontramos esa compra o no tenés permiso para verla.'));
    renderHybrid(statusPath('exito'), { adapter });
    expect(await screen.findByText(/No encontramos esa compra/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium ya está activo');
  });
});

describe('MP-A5 service injected → hybrid transport (no Core singleton, no legacy service)', () => {
  test('Plan + Comprar Premium run through the real staging-v1 service and the transport commerce channel only', async () => {
    const calls = [];
    const organization = { id: ORG, name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', status: 'active', capabilities: getCapabilitiesForRole('owner') };
    const answers = {
      get_tournament_workspace_context: { preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG }, organizations: [organization] },
      get_tournament_competition_context: competition(),
      get_effective_tournament_season_entitlements: entitlements(),
    };
    const transport = {
      rpc: async (name, params) => { calls.push(['rpc', name, params]); return answers[name] ?? null; },
      select: async (table) => { calls.push(['select', table]); return []; },
      commerce: async (path, body, options) => {
        calls.push(['commerce', path, body, typeof options?.timeoutMs]);
        return { purchase: { ...purchase('created'), id: PURCHASE }, preference: { provider: 'MERCADO_PAGO', preferenceId: 'lab-pref-1', checkoutUrl: CHECKOUT_URL, expiresAt: '2026-09-24T00:00:00Z' } };
      },
      clear() {}, dispose() {},
    };
    const service = createStagingV1WorkspaceService({ transport, commerce: true });
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter: service });
    fireEvent.click(await buyButton());
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(CHECKOUT_URL));
    const commerce = calls.filter(([kind]) => kind === 'commerce');
    expect(commerce).toHaveLength(1);
    expect(commerce[0][1]).toBe('/commerce/v1/season-checkout');
    expect(Object.keys(commerce[0][2])).toEqual(['organizationId', 'seasonId', 'idempotencyKey']);
    expect(commerce[0][2]).toMatchObject({ organizationId: ORG, seasonId: SEASON });
    expect(commerce[0][2].idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(commerce[0][3]).toBe('number');
    expect(calls).toContainEqual(['rpc', 'get_effective_tournament_season_entitlements', { p_organization_id: ORG, p_season_id: SEASON }]);
  });
});
