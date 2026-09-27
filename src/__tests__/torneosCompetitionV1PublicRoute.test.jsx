// COMPETITION-V1 — /torneos/publico/:publicSlug is composed like /torneos: the gateway's anonymous
// public route in hybrid, and a closed page (no request at all) whenever Torneos or its public pages
// are off. The Core singleton is a trap: the public page never reads Torneos data from Core.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicTournamentRoute from '../features/torneos/components/PublicTournamentRoute';

const coreAccesses = [];
jest.mock('../lib/supabaseClient', () => {
  const trap = new Proxy({}, {
    get(_, property) {
      if (property === '__esModule') return false;
      if (property === 'then') return undefined;
      // eslint-disable-next-line no-undef
      coreAccesses.push(String(property));
      throw new Error(`Core singleton accessed from the public page: ${String(property)}`);
    },
  });
  return { supabase: trap, supabaseCore: trap, default: trap };
});

const page = {
  publicSlug: 'liga-devoto-copa',
  organization: { name: 'Liga Devoto', logoPath: 'org/logo.png' },
  season: { name: 'Temporada 2027' },
  tournament: { name: 'Copa Híbrida', description: null, status: 'active', sportModality: 'football_5', competitionFormat: 'league', genderCategory: 'open', logoPath: 't/logo.png' },
  categories: [{ name: 'Libre', slug: 'libre', hasPublishedFixture: true }],
  selectedCategory: { name: 'Libre', slug: 'libre' },
  hasPublishedFixture: true,
  matches: [],
  teams: [{ name: 'Napoli', shortName: 'NAP', status: 'active', shieldPath: 'napoli.png' }],
  competition: [{ scopeKey: 'phase-1', label: 'Fase regular', publishedAt: '2027-03-21T00:00:00.000Z', standings: [], players: [], discipline: [] }],
};
const hybridEnv = { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test' };

function renderRoute(props) {
  return render(
    <MemoryRouter initialEntries={['/torneos/publico/liga-devoto-copa']}>
      <Routes>
        <Route path="/torneos/publico/:publicSlug" element={<PublicTournamentRoute {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('COMPETITION-V1 public tournament route', () => {
  const originalFetch = window.fetch;
  beforeEach(() => {
    coreAccesses.length = 0;
    window.fetch = jest.fn(async () => ({ status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(page) }));
  });
  afterEach(() => {
    window.fetch = originalFetch;
    expect(coreAccesses).toEqual([]);
  });

  test.each([
    ['Torneos off', { torneosEnabled: false, publicPages: true }, hybridEnv],
    ['public pages off', { torneosEnabled: true, publicPages: false }, hybridEnv],
    ['no gateway (Production without hybrid)', { torneosEnabled: true, publicPages: true }, { REACT_APP_SUPABASE_URL: 'https://core.example.test' }],
  ])('%s → "Torneo no disponible" without any request', async (_, flags, env) => {
    renderRoute({ flags, env });
    await screen.findByText('Torneo no disponible');
    expect(window.fetch).not.toHaveBeenCalled();
  });

  test('hybrid → the gateway public route, anonymous, and the page renders without branding paths', async () => {
    renderRoute({ flags: { torneosEnabled: true, publicPages: true }, env: hybridEnv });
    await screen.findByRole('heading', { name: 'Copa Híbrida' });
    expect(window.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = window.fetch.mock.calls[0];
    expect(url).toBe('https://gateway.example.test/torneos/public/v1/rpc/get_public_tournament_page');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body)).toEqual({ p_public_slug: 'liga-devoto-copa', p_category_slug: null });
    await waitFor(() => expect(screen.queryByText('Cargando competencia oficial…')).toBeNull());
  });
});
