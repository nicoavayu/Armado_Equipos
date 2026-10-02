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
  };
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

describe('Mi plan stays informational with the TEST overlay', () => {
  test.each(['FREE', 'PREMIUM'])('%s is read but no purchase is offered', async (plan) => {
    const adapter = createAdapter();
    adapter.loadSeasonEntitlements.mockResolvedValue(entitlements({ plan }));
    renderHybrid(PLAN_PATH, { adapter });
    expect(await screen.findByRole('heading', { name: `${plan} · Apertura 2026` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver Premium' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comprar Premium/ })).toBeNull();
    expect(adapter.createCheckout).not.toHaveBeenCalled();
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
    await screen.findByRole('heading', { name: 'FREE · Apertura 2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Ver Premium' }));
    expect(checkoutRedirect).not.toHaveBeenCalled();
    expect(calls.filter(([kind]) => kind === 'commerce')).toHaveLength(0);
    expect(calls).toContainEqual(['rpc', 'get_effective_tournament_season_entitlements', { p_organization_id: ORG, p_season_id: SEASON }]);
  });
});
