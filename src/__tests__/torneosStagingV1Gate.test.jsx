// The feature gate mounts the hybrid composition when a gateway is configured,
// and the whole chain — Core session bridge → exchange → adapter → provider →
// landing — runs against a scripted gateway through window.fetch. The Core
// singleton is a fake whose ONLY usable surface is the session; any other access
// is recorded and would fail the test.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

// Plain functions, not jest.fn: CRA resets mock implementations between tests.
const coreDataAccesses = [];
let authListener = null;
let coreAccessToken = 'core-access-placeholder';
const coreAuthCalls = { getSession: 0, onAuthStateChange: 0 };
const mockCore = {
  auth: {
    getSession: async () => { coreAuthCalls.getSession += 1; return { data: { session: { access_token: coreAccessToken, expires_at: 9999999999, user: { id: 'core-user' } } }, error: null }; },
    onAuthStateChange: (listener) => { coreAuthCalls.onAuthStateChange += 1; authListener = listener; return { data: { subscription: { unsubscribe: () => {} } } }; },
  },
};
jest.mock('../lib/supabaseClient', () => {
  const trap = new Proxy(mockCore, {
    get(target, property) {
      if (property === '__esModule') return false;
      if (property === 'auth') return target.auth;
      if (property === 'then') return undefined;
      coreDataAccesses.push(String(property));
      throw new Error(`Core singleton data access: ${String(property)}`);
    },
  });
  return { supabase: trap, supabaseCore: trap, default: trap };
});
jest.mock('../components/global-header/GlobalHeader', () => () => <header data-testid="global-header" />);
jest.mock('../features/torneos/TorneosApp', () => () => <main data-testid="legacy-torneos-app" />);

const GATEWAY = 'https://gateway.example.test/functions/v1/torneos-gateway';
const ORG = 'a1000000-0000-4000-8000-000000000001';

function jsonResponse(status, body, headers = {}) {
  const all = { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers };
  return { status, ok: status >= 200 && status < 300, headers: { get: (n) => all[n.toLowerCase()] ?? null, has: (n) => n.toLowerCase() in all }, text: async () => JSON.stringify(body) };
}

const SEASON = 'a2000000-0000-4000-8000-000000000001';

function scriptedGateway(plan = null) {
  const calls = [];
  const organization = { id: ORG, name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', status: 'active', membershipStatus: 'active', capabilities: getCapabilitiesForRole('owner') };
  const fetchImpl = jest.fn(async (url, init = {}) => {
    calls.push({ url, init });
    if (url === `${GATEWAY}/exchange`) return jsonResponse(200, { access_token: 'bridge-bearer-placeholder', token_type: 'Bearer', expires_in: 120 });
    if (url === `${GATEWAY}/torneos/rest/v1/rpc/get_tournament_workspace_context`) {
      return jsonResponse(200, { organizations: [organization], preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG } });
    }
    if (url === `${GATEWAY}/torneos/rest/v1/rpc/get_my_tournament_memberships`) return jsonResponse(200, { items: [], pagination: { hasMore: false } });
    if (url === `${GATEWAY}/torneos/rest/v1/rpc/set_tournament_workspace_preference`) return jsonResponse(200, { activeOrganizationId: ORG });
    if (url === `${GATEWAY}/torneos/rest/v1/rpc/get_tournament_competition_context`) return jsonResponse(200, { seasons: plan ? [{ id: SEASON, organizationId: ORG, name: 'Apertura 2026', status: 'active' }] : [], tournaments: [], modalities: [], formats: [], preference: { organizationId: ORG, activeSeasonId: SEASON } });
    if (url === `${GATEWAY}/torneos/rest/v1/rpc/get_effective_tournament_season_entitlements`) return jsonResponse(200, tournamentEntitlementsFixture({ organizationId: ORG, seasonId: SEASON, tournamentId: null, plan }));
    return jsonResponse(404, { error: 'not found' });
  });
  return { calls, fetchImpl };
}

function renderGate(backendMode, extra = {}, initialPath = '/torneos') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled backendMode={backendMode} native={false} {...extra} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TorneosFeatureGate — backend mode', () => {
  const originalFetch = window.fetch;
  afterEach(() => {
    window.fetch = originalFetch; coreDataAccesses.length = 0; authListener = null;
    coreAccessToken = 'core-access-placeholder'; coreAuthCalls.getSession = 0; coreAuthCalls.onAuthStateChange = 0;
  });

  test('hybrid: Core session → exchange → RPCs with the bridge bearer → landing; no Core data access, no request outside the gateway', async () => {
    const gateway = scriptedGateway();
    window.fetch = gateway.fetchImpl;
    renderGate({ mode: 'hybrid', reason: null, gatewayUrl: GATEWAY });
    await screen.findByRole('heading', { name: 'Tus organizaciones' });
    expect(screen.getByText('Liga Devoto')).toBeTruthy();

    const urls = gateway.calls.map((c) => c.url);
    expect(urls[0]).toBe(`${GATEWAY}/exchange`);
    expect(gateway.calls[0].init.method).toBe('POST');
    expect(gateway.calls[0].init.headers.Authorization).toBe('Bearer core-access-placeholder');
    expect(gateway.calls[0].init.body).toBeUndefined();
    expect(urls.filter((u) => u === `${GATEWAY}/exchange`)).toHaveLength(1);
    expect(urls).toContain(`${GATEWAY}/torneos/rest/v1/rpc/get_tournament_workspace_context`);
    expect(urls).toContain(`${GATEWAY}/torneos/rest/v1/rpc/get_my_tournament_memberships`);
    for (const call of gateway.calls.slice(1)) {
      expect(call.url.startsWith(`${GATEWAY}/torneos/rest/v1/rpc/`)).toBe(true);
      expect(call.init.headers.Authorization).toBe('Bearer bridge-bearer-placeholder');
      expect(call.init.credentials).toBe('omit');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.redirect).toBe('error');
    }
    expect(urls.some((u) => u.includes('supabase.co') || u.includes('example.supabase'))).toBe(false);
    expect(coreAuthCalls.getSession).toBeGreaterThan(0);
    expect(coreAuthCalls.onAuthStateChange).toBe(1);
    expect(coreDataAccesses).toEqual([]);
    // the bridge bearer never touches storage
    expect(Object.keys(window.localStorage).some((key) => /torneos.*(bearer|token)/i.test(key))).toBe(false);
    expect(Object.values(window.localStorage).some((value) => String(value).includes('bridge-bearer-placeholder'))).toBe(false);
  });

  test('hybrid: a Core logout clears the bridge and the next request re-exchanges with the new Core token', async () => {
    const gateway = scriptedGateway();
    window.fetch = gateway.fetchImpl;
    renderGate({ mode: 'hybrid', reason: null, gatewayUrl: GATEWAY });
    await screen.findByRole('heading', { name: 'Tus organizaciones' });
    const before = gateway.calls.filter((c) => c.url.endsWith('/exchange')).length;
    expect(before).toBe(1);
    coreAccessToken = 'core-access-placeholder-2';
    authListener('TOKEN_REFRESHED');
    // Any subsequent use of the service re-exchanges: drive one through the UI (organization card → setPreference).
    screen.getByRole('button', { name: /Liga Devoto/ }).click();
    await waitFor(() => expect(gateway.calls.filter((c) => c.url.endsWith('/exchange')).length).toBe(2));
    expect(gateway.calls.filter((c) => c.url.endsWith('/exchange'))[1].init.headers.Authorization).toBe('Bearer core-access-placeholder-2');
  });

  test('disabled: staging/preview without a gateway never mounts Torneos (no fallback to the Core project)', () => {
    window.fetch = jest.fn();
    renderGate({ mode: 'disabled', reason: 'TORNEOS_GATEWAY_NOT_CONFIGURED', gatewayUrl: '' });
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-torneos-backend-mode')).toBe('disabled');
    expect(alert.getAttribute('data-torneos-backend-reason')).toBe('TORNEOS_GATEWAY_NOT_CONFIGURED');
    expect(window.fetch).not.toHaveBeenCalled();
    expect(coreAuthCalls.onAuthStateChange).toBe(0);
  });

  test('legacy-local: the single-project LOCAL QA stack keeps the legacy composition; an injected service always does', async () => {
    window.fetch = jest.fn();
    renderGate({ mode: 'legacy-local', reason: null, gatewayUrl: '' });
    await screen.findByTestId('legacy-torneos-app');
    renderGate({ mode: 'hybrid', reason: null, gatewayUrl: GATEWAY }, { service: { loadContext: async () => ({ organizations: [], preference: {} }) } });
    await waitFor(() => expect(screen.getAllByTestId('legacy-torneos-app')).toHaveLength(2));
    expect(window.fetch).not.toHaveBeenCalled();
  });
});

// Drive the actual gate → bridge → transport → adapter → Mi plan chain with the read opt-in.
test.each(['FREE', 'PREMIUM'])('gate opt-in confirms %s with Billing OFF and no commercial request', async (plan) => {
  const previousMode = process.env.REACT_APP_TORNEOS_PLAN_READ_MODE;
  const originalFetch = window.fetch;
  process.env.REACT_APP_TORNEOS_PLAN_READ_MODE = 'on';
  try {
    const gateway = scriptedGateway(plan);
    window.fetch = gateway.fetchImpl;
    renderGate({ mode: 'hybrid', gatewayUrl: GATEWAY }, { billingMode: 'off' },
      `/torneos/organizacion/${ORG}/temporada/${SEASON}/plan`);
    await screen.findByRole('heading', { name: `${plan} · Apertura 2026` });
    const read = gateway.calls.find(c => c.url.endsWith('/rpc/get_effective_tournament_season_entitlements'));
    expect(JSON.parse(read.init.body)).toEqual({ p_organization_id: ORG, p_season_id: SEASON });
    expect(read.init.headers.Authorization).toBe('Bearer bridge-bearer-placeholder');
    expect(gateway.calls.some(c => /commerce|purchase|payment|preference_created/.test(c.url))).toBe(false);
    expect(screen.queryByRole('button', { name: /Comprar Premium/i })).toBeNull();
    expect(coreDataAccesses).toEqual([]);
  } finally {
    window.fetch = originalFetch;
    if (previousMode === undefined) delete process.env.REACT_APP_TORNEOS_PLAN_READ_MODE;
    else process.env.REACT_APP_TORNEOS_PLAN_READ_MODE = previousMode;
  }
});
