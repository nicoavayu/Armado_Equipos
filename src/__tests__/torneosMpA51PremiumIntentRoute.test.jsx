// MP-A5.1 — Premium intent after creating a tournament from the wizard. In the hybrid
// (staging-v1) composition the legacy, tournament-scoped Plan routes stay off
// (`plan_legacy_routes: false`), so the wizard must land on the canonical season Plan of the
// season the server returned for the new tournament. Legacy-local keeps its previous target.
import React from 'react';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import StagingV1TorneosApp from '../features/torneos/stagingV1/StagingV1TorneosApp';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { stagingV1FeaturesFor } from '../features/torneos/stagingV1/stagingV1Features';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import { PREMIUM_INTENT_STORAGE_KEY } from '../features/torneos/domain/premiumIntent';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const coreAccesses = [];
jest.mock('../lib/supabaseClient', () => {
  const trap = new Proxy({}, {
    get(_, property) {
      if (property === '__esModule') return false;
      if (property === 'then') return undefined;
      // eslint-disable-next-line no-undef
      coreAccesses.push(String(property));
      throw new Error(`Core singleton accessed: ${String(property)}`);
    },
  });
  return { supabase: trap, supabaseCore: trap, default: trap };
});
jest.mock('../components/global-header/GlobalHeader', () => () => <header data-testid="global-header" />);

const ORG = '91000000-0000-4000-8000-000000000011';
const SEASON_A = '92000000-0000-4000-8000-000000000011';
const SEASON_B = '92000000-0000-4000-8000-000000000012';
const EXISTING = '93000000-0000-4000-8000-000000000011';
const CREATED = '93000000-0000-4000-8000-000000000012';
const BASE = `/torneos/organizacion/${ORG}`;
const WIZARD = `${BASE}/torneos/nuevo`;
const WIZARD_PREMIUM = `${WIZARD}?intent=premium`;
const seasonPlanPath = (seasonId) => `${BASE}/temporada/${seasonId}/plan`;
const legacyTournamentPlanPath = (tournamentId) => `${BASE}/torneo/${tournamentId}/plan`;
const configurationPath = (tournamentId) => `${BASE}/torneo/${tournamentId}/configuracion?step=0`;

const createdRow = {
  id: CREATED, organizationId: ORG, seasonId: SEASON_B, name: 'Copa Premium', slug: 'copa-premium', status: 'draft',
  sportModality: 'football_7', competitionFormat: 'league', genderCategory: 'mixed', categories: [],
  checklist: { ready: false, checks: {} }, logoPath: null, organizationLogoPath: null,
};

function competition({ withCreated = false } = {}) {
  return {
    // The active season is A on purpose: a Plan target derived from the active season (the legacy
    // redirect) instead of the created tournament's season would land on A.
    preference: { organizationId: ORG, activeSeasonId: SEASON_A, activeTournamentId: EXISTING },
    seasons: [
      { id: SEASON_A, organizationId: ORG, name: 'Apertura 2026', slug: 'apertura-2026', status: 'active' },
      { id: SEASON_B, organizationId: ORG, name: 'Clausura 2026', slug: 'clausura-2026', status: 'active' },
    ],
    tournaments: [{
      id: EXISTING, organizationId: ORG, seasonId: SEASON_A, name: 'Liga Híbrida', slug: 'liga-hibrida', status: 'registration',
      sportModality: 'football_7', competitionFormat: 'league', genderCategory: 'mixed', categories: [],
      checklist: { ready: true, checks: {} }, logoPath: null, organizationLogoPath: null,
    }, ...(withCreated ? [createdRow] : [])],
    modalities: [{
      code: 'football_7', name: 'Fútbol 7', teamSize: 7, recommendedSubstitutes: 5, suggestedDurationMinutes: 50,
    }],
    formats: [{ code: 'league', name: 'Liga', description: 'Todos compiten por puntos.' }],
  };
}

// The hybrid RPC `create_tournament_with_defaults` answers { id, seasonId, ... } — the season of
// the row it inserted. Nothing else is a valid Plan season.
function createService({ commerce = true, created = { id: CREATED, organizationId: ORG, seasonId: SEASON_B } } = {}) {
  // The refresh after the mutation returns the new tournament, as the backend does.
  let persisted = false;
  const organization = {
    id: ORG, name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', status: 'active', capabilities: getCapabilitiesForRole('owner'),
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
    loadCompetitionContext: jest.fn(() => Promise.resolve(competition({ withCreated: persisted }))),
    loadTeamsContext: jest.fn().mockResolvedValue({ settings: {}, entries: [] }),
    createTournament: jest.fn(() => { persisted = true; return Promise.resolve(created); }),
    updateTournament: jest.fn().mockResolvedValue({}),
    saveCategory: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => '97000000-0000-4000-8000-000000000011'),
  };
  if (!commerce) return base;
  return {
    ...base,
    loadSeasonEntitlements: jest.fn(({ seasonId }) => Promise.resolve(tournamentEntitlementsFixture({
      organizationId: ORG, seasonId, tournamentId: null,
    }))),
    loadPurchase: jest.fn(),
    createCheckout: jest.fn(),
  };
}

let visited = [];
function LocationProbe() {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  if (visited[visited.length - 1] !== path) visited.push(path);
  return null;
}
const currentPath = () => visited[visited.length - 1];

function renderHybrid(path, { service, billingMode = 'test' }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/torneos/*"
          element={<StagingV1TorneosApp gatewayUrl="http://127.0.0.1:58423" service={service} billingMode={billingMode} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderLegacy(path, { service }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function createFromWizard({ seasonId = SEASON_B, name = 'Copa Premium' } = {}) {
  const nameInput = await screen.findByRole('textbox', { name: /nombre del torneo/i }, { timeout: 5000 });
  fireEvent.change(screen.getByRole('combobox', { name: 'Temporada' }), { target: { value: seasonId } });
  fireEvent.change(nameInput, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
}

beforeEach(() => {
  visited = [];
  coreAccesses.length = 0;
  window.sessionStorage.clear();
});
afterEach(() => {
  expect(coreAccesses).toEqual([]);
});

describe('MP-A5.1 premium intent → hybrid season Plan', () => {
  test('the hybrid TEST overlay keeps the legacy Plan routes off (precondition)', () => {
    expect(stagingV1FeaturesFor('test')).toEqual(expect.objectContaining({ plan: true, plan_legacy_routes: false }));
  });

  test('hybrid + premium intent: after creating the tournament it opens the canonical Plan of the returned season', async () => {
    const service = createService();
    renderHybrid(WIZARD_PREMIUM, { service });
    await createFromWizard();

    await waitFor(() => expect(currentPath()).toBe(seasonPlanPath(SEASON_B)), { timeout: 5000 });
    expect(service.createTournament).toHaveBeenCalledTimes(1);
    expect(service.createTournament.mock.calls[0][0]).toEqual(expect.objectContaining({ organizationId: ORG, seasonId: SEASON_B }));
    // Never the legacy tournament plan, never the tournament id as a season, no query authority.
    expect(visited).not.toContain(legacyTournamentPlanPath(CREATED));
    expect(visited.some((path) => path.includes(`/temporada/${CREATED}`))).toBe(false);
    expect(currentPath()).not.toContain('?');
    // The real shell route renders the Plan (not «no disponible») and reads the returned season
    // through the injected service.
    expect(await screen.findByRole('heading', { name: /^FREE ·/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/todavía no está habilitada/)).toBeNull();
    await waitFor(() => expect(service.loadSeasonEntitlements).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON_B }));
    expect(service.createCheckout).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PREMIUM_INTENT_STORAGE_KEY)).toBeNull();
  }, 20_000);

  test('hybrid + premium intent without a returned seasonId: no Plan guess, the tournament configuration opens', async () => {
    const service = createService({ created: { id: CREATED, organizationId: ORG } });
    renderHybrid(WIZARD_PREMIUM, { service });
    await createFromWizard();

    await waitFor(() => expect(currentPath()).toBe(configurationPath(CREATED)), { timeout: 5000 });
    expect(visited.some((path) => path.includes('/plan'))).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  }, 20_000);

  test('hybrid without premium intent: the current flow (tournament configuration) is kept', async () => {
    const service = createService();
    renderHybrid(WIZARD, { service });
    await createFromWizard();

    await waitFor(() => expect(currentPath()).toBe(configurationPath(CREATED)), { timeout: 5000 });
    expect(visited.some((path) => path.includes('/plan'))).toBe(false);
    expect(service.createCheckout).not.toHaveBeenCalled();
  }, 20_000);

  test('billing OFF + premium intent opens informational Mi plan without checkout', async () => {
    const service = createService({ commerce: false });
    renderHybrid(WIZARD_PREMIUM, { service, billingMode: 'off' });
    await createFromWizard();

    await waitFor(() => expect(currentPath()).toBe(seasonPlanPath(SEASON_B)), { timeout: 5000 });
    expect(await screen.findByRole('heading', { name: 'Lectura no disponible' })).toBeInTheDocument();
    expect(screen.queryByText(/todavía no está habilitada/)).toBeNull();
  }, 20_000);

  test('legacy-local + premium intent: the previous tournament-scoped Plan target is kept', async () => {
    const service = createService({ commerce: false, created: { id: CREATED } });
    renderLegacy(WIZARD_PREMIUM, { service });
    await createFromWizard();

    // Unchanged legacy behavior: the wizard targets the tournament plan route; its legacy
    // redirect (`plan_legacy_routes`, on in legacy) then resolves the season Plan.
    await waitFor(() => expect(visited).toContain(legacyTournamentPlanPath(CREATED)), { timeout: 5000 });
    await waitFor(() => expect(currentPath()).toBe(seasonPlanPath(SEASON_B)));
    expect(visited.indexOf(legacyTournamentPlanPath(CREATED))).toBe(visited.indexOf(WIZARD_PREMIUM) + 1);
  }, 20_000);
});
