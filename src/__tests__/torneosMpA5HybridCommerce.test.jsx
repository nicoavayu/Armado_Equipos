// MP-A5 — Plan / Comprar Premium / PurchaseStatus in the hybrid (staging-v1) composition with the
// billing TEST overlay. Everything reaches the backend through the injected service → transport: the
// Core singleton is a trap and so are the legacy commerce functions. Premium is shown only from the
// server's effective entitlements, never from a redirect route, a Preference or MP query params.
import React from 'react';
import {
  act, fireEvent, render, screen, waitFor, within,
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
    // COMMERCE-PRODUCTION: Mi plan's purchase list (none by default) and the buyer's refresh.
    loadSeasonPurchases: jest.fn().mockResolvedValue(seasonPurchases([], { canManageBilling: ['owner', 'admin'].includes(role) })),
    refreshPurchase: jest.fn().mockResolvedValue({ purchase: purchase('pending'), refresh: 'no_payment' }),
  };
}
function seasonPurchases(purchases, { canManageBilling = true, checkoutAvailable = true } = {}) {
  return { schemaVersion: 1, organizationId: ORG, seasonId: SEASON, canManageBilling, checkoutAvailable, purchases };
}

let currentPath = '';
function LocationProbe() {
  const location = useLocation();
  currentPath = `${location.pathname}${location.search}`;
  return null;
}

function renderHybrid(path, {
  adapter = createAdapter(), billingMode = 'test', planRead = false, features = undefined, checkoutRedirect = jest.fn(),
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
              planRead={planRead}
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
    const nav = await screen.findByRole('navigation', { name: 'Secciones de configuración' });
    const link = within(nav).getByRole('link', { name: 'Mi plan' });
    await waitFor(() => expect(link.getAttribute('href')).toBe(PLAN_PATH));
  });

  test('plan without billing shows the plan but offers no purchase', async () => {
    const adapter = createAdapter();
    renderHybrid(PLAN_PATH, { adapter, features: { ...stagingV1Features, entitlements: true, plan: true, billing: false } });
    expect(await screen.findByRole('heading', { name: 'FREE · Apertura 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comprar Premium/i })).toBeNull();
    expect(screen.getByText(/compra de Premium todavía no está disponible/i)).toBeInTheDocument();
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
});

test('independent plan read survives billing OFF without enabling any purchase operation', async () => {
  const adapter = createAdapter();
  renderHybrid(PLAN_PATH, { adapter, billingMode: 'off', planRead: true });
  await screen.findByRole('heading', { name: 'FREE · Apertura 2026' });
  expect(adapter.loadSeasonEntitlements).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON });
  expect(adapter.loadPurchase).not.toHaveBeenCalled();
  expect(adapter.createCheckout).not.toHaveBeenCalled();
});

// Pre-PR gate: before REACT_APP_TORNEOS_PLAN_READ_MODE=on the plan UX does not exist in the hybrid
// composition (nav, header context, selector badge); with it on, the certified states all render.
describe('PLAN READ gate — Mi plan exists only with the read opt-in', () => {
  const OVERVIEW = `/torneos/organizacion/${ORG}/torneos`;
  const orgNavLinks = () => within(screen.getAllByRole('navigation', { name: /Navegación de la organización/ })[0])
    .getAllByRole('link').map((link) => link.textContent);
  const planBadges = (label) => screen.queryAllByRole('link', { name: `Mi plan: ${label} · Apertura 2026` });

  test('OFF: no Mi plan in nav or settings, no header context, no badge, no read', async () => {
    const adapter = createAdapter();
    renderHybrid(OVERVIEW, { adapter, billingMode: 'off' });
    await screen.findByRole('combobox', { name: 'Temporada activa' });
    expect(orgNavLinks()).not.toContain('Mi plan');
    expect(document.getElementById('torneos-plan-context')).toBeNull();
    expect(screen.queryAllByRole('link', { name: /^Mi plan:/ })).toHaveLength(0);
    expect(document.querySelector('[data-plan]')).toBeNull();
    renderHybrid(`/torneos/organizacion/${ORG}/configuracion`, { adapter, billingMode: 'off' });
    const settings = await screen.findByRole('navigation', { name: 'Secciones de configuración' });
    expect(within(settings).queryByRole('link', { name: 'Mi plan' })).toBeNull();
    renderHybrid(`/torneos/organizacion/${ORG}/mi-plan`, { adapter, billingMode: 'off' });
    expect(await screen.findByText(/todavía no está habilitada/)).toBeInTheDocument();
    for (const name of ['loadSeasonEntitlements', 'loadPurchase', 'createCheckout']) expect(adapter[name]).not.toHaveBeenCalled();
  });

  test.each(['FREE', 'PREMIUM'])('ON: Mi plan in nav, header context and selector badge confirm %s', async (plan) => {
    const adapter = createAdapter({ seasonEntitlements: entitlements({ plan }) });
    renderHybrid(OVERVIEW, { adapter, billingMode: 'off', planRead: true });
    await waitFor(() => expect(planBadges(plan)).toHaveLength(2));
    expect(orgNavLinks()).toContain('Mi plan');
    expect(document.getElementById('torneos-plan-context')).toHaveTextContent(`${plan} · Apertura 2026`);
    // Mobile discoverability: the header entry names Mi plan and carries the plan as its badge.
    const headerEntry = document.querySelector('#torneos-plan-context a');
    expect(headerEntry).toHaveTextContent(/^Mi plan/);
    expect(headerEntry.querySelector('strong')).toHaveTextContent(new RegExp(`^${plan}$`));
    for (const badge of planBadges(plan)) expect(badge.getAttribute('href')).toBe(PLAN_PATH);
    expect(adapter.loadSeasonEntitlements).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON });
    expect(adapter.loadPurchase).not.toHaveBeenCalled();
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });

  test.each([
    ['TORNEOS_FORBIDDEN', 'Lectura no disponible'],
    ['TORNEOS_UNAVAILABLE', 'Error transitorio'],
  ])('ON: a failed read (%s) is shown honestly as «%s», never as a plan', async (code, label) => {
    const adapter = createAdapter();
    adapter.loadSeasonEntitlements.mockRejectedValue(new TournamentWorkspaceError(code, 'detalle interno'));
    renderHybrid(OVERVIEW, { adapter, billingMode: 'off', planRead: true });
    await waitFor(() => expect(planBadges(label)).toHaveLength(2));
    expect(orgNavLinks()).toContain('Mi plan');
    expect(planBadges('FREE')).toHaveLength(0);
    expect(planBadges('PREMIUM')).toHaveLength(0);
    expect(document.body).not.toHaveTextContent('detalle interno');
  });
});

describe('COMMERCE-PRODUCTION: Mi plan sells Premium with the purchase overlay (TEST lab or production web)', () => {
  const later = () => new Date(Date.now() + 20 * 60_000).toISOString();

  test('FREE: the server price, the season scope and one-time payment; one checkout for a double tap', async () => {
    const adapter = createAdapter();
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    expect(await screen.findByRole('heading', { name: 'FREE · Apertura 2026' })).toBeInTheDocument();
    const panel = await screen.findByRole('region', { name: 'Pasá Apertura 2026 a Premium' });
    expect(panel).toHaveTextContent(/41\.000/);
    expect(panel).toHaveTextContent(/51\.000/);
    expect(panel).toHaveTextContent('ARS · por temporada');
    expect(panel).toHaveTextContent('Pago único. No es una suscripción: no se renueva ni se vuelve a cobrar.');
    expect(panel).toHaveTextContent('Incluye todos los torneos de esta temporada.');
    expect(panel).toHaveTextContent('Entorno de prueba: no se cobra dinero real.');
    const pay = within(panel).getByRole('button', { name: 'Pagar con Mercado Pago' });
    fireEvent.click(pay);
    fireEvent.click(pay);
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(CHECKOUT_URL));
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
    expect(adapter.createCheckout).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY });
    expect(adapter.loadSeasonPurchases).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON });
  });

  test('PREMIUM: confirmation of the paid season, no purchase offered', async () => {
    const adapter = createAdapter({ seasonEntitlements: premium() });
    adapter.loadSeasonPurchases.mockResolvedValue(seasonPurchases([purchase('approved', { approvedAt: '2026-10-01T15:00:00Z' })]));
    renderHybrid(PLAN_PATH, { adapter });
    const panel = await screen.findByRole('region', { name: 'Premium activo en Apertura 2026' });
    expect(panel).toHaveTextContent('No es una suscripción: no se renueva ni se vuelve a cobrar.');
    await waitFor(() => expect(panel).toHaveTextContent('Mercado Pago'));
    expect(screen.queryByRole('button', { name: 'Pagar con Mercado Pago' })).toBeNull();
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });

  test('an open purchase is continued or consulted, never bought twice', async () => {
    const adapter = createAdapter();
    adapter.loadSeasonPurchases.mockResolvedValue(seasonPurchases([purchase('preference_created', { preferenceExpiresAt: later() })]));
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    const panel = await screen.findByRole('region', { name: 'Esperando el pago' });
    expect(within(panel).getByRole('link', { name: 'Ver estado de la compra' }).getAttribute('href')).toBe(statusPath('pendiente'));
    expect(screen.queryByRole('button', { name: 'Pagar con Mercado Pago' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Continuar el pago' }));
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(CHECKOUT_URL));
  });

  test('a payment in process (cash) offers no new payment', async () => {
    const adapter = createAdapter();
    adapter.loadSeasonPurchases.mockResolvedValue(seasonPurchases([purchase('pending')]));
    renderHybrid(PLAN_PATH, { adapter });
    const panel = await screen.findByRole('region', { name: 'Pago en proceso' });
    expect(panel).toHaveTextContent('No hace falta volver a pagar');
    expect(within(panel).queryByRole('button')).toBeNull();
  });

  test('a returned payment: the season is FREE again, nothing was deleted, Premium can be bought again', async () => {
    const adapter = createAdapter();
    adapter.loadSeasonPurchases.mockResolvedValue(seasonPurchases([purchase('refunded', { refundedAt: '2026-10-02T12:00:00Z' })]));
    renderHybrid(PLAN_PATH, { adapter });
    expect(await screen.findByText(/fue devuelto el .*2026\. La temporada volvió a FREE y no se borró nada/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar con Mercado Pago' })).toBeEnabled();
  });

  test('a disputed payment suspends the purchase surface', async () => {
    const adapter = createAdapter();
    adapter.loadSeasonPurchases.mockResolvedValue(seasonPurchases([purchase('charged_back')]));
    renderHybrid(PLAN_PATH, { adapter });
    expect(await screen.findByRole('region', { name: 'Hay un contracargo en revisión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar con Mercado Pago' })).toBeNull();
  });

  test('only managers may buy: a collaborator sees why', async () => {
    const adapter = createAdapter({ role: 'collaborator' });
    renderHybrid(PLAN_PATH, { adapter });
    const pay = await screen.findByRole('button', { name: 'Pagar con Mercado Pago' });
    await waitFor(() => expect(pay).toBeDisabled());
    expect(screen.getByText('Sólo el Propietario o un Administrador de esta temporada pueden comprar Premium.')).toBeInTheDocument();
  });

  test.each([
    [new TournamentWorkspaceError('TORNEOS_BILLING_DISABLED', 'La compra de Premium todavía no está habilitada para esta organización. No se realizó ningún cobro.'), /todavía no está habilitada para esta organización/],
    [new TournamentWorkspaceError('TORNEOS_PAYMENTS_UNAVAILABLE', 'El servicio de pagos no está disponible en este momento y no se realizó ningún cobro.'), /no se realizó ningún cobro/],
  ])('checkout refused → a plain message, no redirect (%#)', async (error, message) => {
    const adapter = createAdapter();
    adapter.createCheckout.mockRejectedValue(error);
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar con Mercado Pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(checkoutRedirect).not.toHaveBeenCalled();
  });

  test('a checkout URL outside Mercado Pago is never followed', async () => {
    const adapter = createAdapter();
    adapter.createCheckout.mockResolvedValue({ purchase: purchase('created'), preference: { provider: 'MERCADO_PAGO', preferenceId: 'x', checkoutUrl: 'https://evil.example.com/pay', expiresAt: later() } });
    const { checkoutRedirect } = renderHybrid(PLAN_PATH, { adapter });
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar con Mercado Pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/dirección de pago inválida/);
    expect(checkoutRedirect).not.toHaveBeenCalled();
  });

  test('production: the button exists only where the server says this organization can buy now', async () => {
    const closed = createAdapter();
    closed.loadSeasonPurchases.mockResolvedValue(seasonPurchases([], { checkoutAvailable: false }));
    renderHybrid(PLAN_PATH, { adapter: closed, billingMode: { mode: 'production' } });
    expect(await screen.findByText('La compra de Premium todavía no está disponible para esta organización.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar con Mercado Pago' })).toBeNull();
    expect(screen.queryByText(/Entorno de prueba/)).toBeNull();
    const open = createAdapter();
    open.loadSeasonPurchases.mockResolvedValue(seasonPurchases([], { checkoutAvailable: true }));
    renderHybrid(PLAN_PATH, { adapter: open, billingMode: { mode: 'production' } });
    expect(await screen.findByRole('button', { name: 'Pagar con Mercado Pago' })).toBeEnabled();
  });

  test('without billing the plan stays informational (production web before the switch)', async () => {
    const adapter = createAdapter();
    renderHybrid(PLAN_PATH, { adapter, billingMode: 'off', planRead: true });
    expect(await screen.findByRole('heading', { name: 'FREE · Apertura 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar con Mercado Pago' })).toBeNull();
    expect(adapter.loadSeasonPurchases).not.toHaveBeenCalled();
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
});

describe('COMMERCE-PRODUCTION: back from Mercado Pago', () => {
  test('an open purchase is reconciled once on arrival; "Consultar de nuevo" asks again', async () => {
    const adapter = createAdapter({ seasonEntitlements: premium() });
    adapter.loadPurchase.mockResolvedValue(purchase('preference_created'));
    adapter.refreshPurchase.mockResolvedValueOnce({ purchase: purchase('preference_created'), refresh: 'no_payment' })
      .mockResolvedValue({ purchase: purchase('approved'), refresh: 'verified' });
    renderHybrid(statusPath('exito', '?collection_status=approved'), { adapter });
    await waitFor(() => expect(adapter.refreshPurchase).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: /esperando confirmación/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Consultar de nuevo' }));
    expect(await screen.findByRole('heading', { name: 'Premium ya está activo' })).toBeInTheDocument();
    expect(adapter.refreshPurchase).toHaveBeenCalledTimes(2);
  });

  test('polling stops after 3 minutes and says so; the plan-changed event fires once Premium is confirmed', async () => {
    jest.useFakeTimers();
    const events = [];
    const listener = (event) => events.push(event.detail);
    window.addEventListener('torneos:plan-changed', listener);
    try {
      const adapter = createAdapter({ seasonEntitlements: premium() });
      adapter.loadPurchase.mockResolvedValue(purchase('pending'));
      adapter.refreshPurchase.mockResolvedValue({ purchase: purchase('pending'), refresh: 'no_payment' });
      renderHybrid(statusPath('pendiente'), { adapter });
      expect(await screen.findByRole('heading', { name: /esperando confirmación/i })).toBeInTheDocument();
      for (let i = 0; i < 47; i += 1) await act(async () => { jest.advanceTimersByTime(4000); });
      expect(await screen.findByText(/Todavía no tenemos la confirmación de Mercado Pago/)).toBeInTheDocument();
      const calls = adapter.loadPurchase.mock.calls.length;
      await act(async () => { jest.advanceTimersByTime(20000); });
      expect(adapter.loadPurchase.mock.calls.length).toBe(calls);
      adapter.refreshPurchase.mockResolvedValue({ purchase: purchase('approved'), refresh: 'verified' });
      fireEvent.click(screen.getByRole('button', { name: 'Consultar de nuevo' }));
      expect(await screen.findByRole('heading', { name: 'Premium ya está activo' })).toBeInTheDocument();
      await waitFor(() => expect(events).toEqual([{ organizationId: ORG, seasonId: SEASON, plan: 'PREMIUM' }]));
    } finally {
      window.removeEventListener('torneos:plan-changed', listener);
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
      get_tournament_season_purchases: seasonPurchases([]),
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
    await screen.findByRole('heading', { name: 'FREE · Apertura 2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Ver Premium' }));
    expect(checkoutRedirect).not.toHaveBeenCalled();
    expect(calls.filter(([kind]) => kind === 'commerce')).toHaveLength(0);
    expect(calls).toContainEqual(['rpc', 'get_effective_tournament_season_entitlements', { p_organization_id: ORG, p_season_id: SEASON }]);
    // The purchase panel reads the season's purchases in its own effect, after the plan: awaited, never assumed (CI load).
    await waitFor(() => expect(calls).toContainEqual(['rpc', 'get_tournament_season_purchases', { p_organization_id: ORG, p_season_id: SEASON }]));
    // Pagar con Mercado Pago: exactly the fixed checkout route with the three UUIDs, then the validated redirect.
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar con Mercado Pago' }));
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(CHECKOUT_URL));
    const commerceCalls = calls.filter(([kind]) => kind === 'commerce');
    expect(commerceCalls).toHaveLength(1);
    expect(commerceCalls[0][1]).toBe('/commerce/v1/season-checkout');
    expect(Object.keys(commerceCalls[0][2]).sort()).toEqual(['idempotencyKey', 'organizationId', 'seasonId']);
  });
});
