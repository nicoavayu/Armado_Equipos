import { renderHook, waitFor } from '@testing-library/react';

jest.mock('../components/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../lib/supabaseClient', () => ({ __esModule: true, supabase: { from: jest.fn() } }));

const { useAuth } = require('../components/AuthProvider');
const { supabase } = require('../lib/supabaseClient');
const { useOnboardingChecklist } = require('../features/onboarding/useOnboardingChecklist');

// Chainable Supabase stub that resolves per (table, head, filters).
function installSupabase(resolve) {
  supabase.from.mockImplementation((table) => {
    const calls = { table, head: false, filters: [] };
    const builder = {
      select: (_cols, opts) => { if (opts?.head) calls.head = true; return builder; },
      eq: (k, v) => { calls.filters.push(['eq', k, v]); return builder; },
      neq: (k, v) => { calls.filters.push(['neq', k, v]); return builder; },
      in: (k, v) => { calls.filters.push(['in', k, v]); return builder; },
      limit: () => Promise.resolve(resolve(calls)),
      then: (onF, onR) => Promise.resolve(resolve(calls)).then(onF, onR),
    };
    return builder;
  });
}

afterEach(() => jest.clearAllMocks());

describe('useOnboardingChecklist — derives from real data', () => {
  test('organizer checklist reflects real actions, not screen visits', async () => {
    useAuth.mockReturnValue({ user: { id: 'u1' }, profile: { profile_completion: 80 } });
    installSupabase((calls) => {
      if (calls.table === 'partidos' && calls.head) return { count: 1, error: null };
      if (calls.table === 'partidos') return { data: [{ id: 5 }], error: null };
      if (calls.table === 'partidos_manuales') return { count: 0, error: null };
      if (calls.table === 'jugadores') return { data: [{ id: 99 }], error: null }; // someone invited
      if (calls.table === 'votos') return { data: [], error: null }; // not voted yet
      return { data: [], error: null };
    });

    const { result } = renderHook(() => useOnboardingChecklist('organizer'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const byKey = Object.fromEntries(result.current.items.map((i) => [i.key, i.done]));
    expect(byKey.profile).toBe(true);
    expect(byKey.create_match).toBe(true);
    expect(byKey.invite).toBe(true);
    expect(byKey.vote).toBe(false);
    expect(result.current.completedCount).toBe(3);
    expect(result.current.total).toBe(4);
    expect(result.current.allDone).toBe(false);
  });

  test('auto-match checklist marks availability + confirmed opportunity from real rows', async () => {
    useAuth.mockReturnValue({ user: { id: 'u2' }, profile: { profile_completion: 20, latitud: -34.6, longitud: -58.4 } });
    installSupabase((calls) => {
      if (calls.table === 'player_availability') return { data: [{ id: 1 }], error: null };
      if (calls.table === 'auto_match_proposal_members') return { data: [{ proposal_id: 7 }], error: null };
      return { data: [], error: null };
    });

    const { result } = renderHook(() => useOnboardingChecklist('auto_match'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const byKey = Object.fromEntries(result.current.items.map((i) => [i.key, i.done]));
    expect(byKey.profile).toBe(false); // completion 20 and no posicion
    expect(byKey.location).toBe(true); // coordinates present
    expect(byKey.availability).toBe(true);
    expect(byKey.confirm_opportunity).toBe(true);
  });

  test('a failing signal query never marks an item done (stays false)', async () => {
    useAuth.mockReturnValue({ user: { id: 'u3' }, profile: { profile_completion: 90 } });
    installSupabase((calls) => {
      if (calls.table === 'votos') throw new Error('boom');
      if (calls.table === 'partidos' && calls.head) return { count: 0, error: null };
      if (calls.table === 'partidos') return { data: [], error: null };
      if (calls.table === 'partidos_manuales') return { count: 0, error: null };
      return { data: [], error: null };
    });

    const { result } = renderHook(() => useOnboardingChecklist('organizer'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const byKey = Object.fromEntries(result.current.items.map((i) => [i.key, i.done]));
    expect(byKey.vote).toBe(false);
    expect(byKey.create_match).toBe(false);
  });

  test('all real signals complete => allDone true', async () => {
    useAuth.mockReturnValue({ user: { id: 'u4' }, profile: { profile_completion: 100 } });
    installSupabase((calls) => {
      if (calls.table === 'partidos' && calls.head) return { count: 2, error: null };
      if (calls.table === 'partidos') return { data: [{ id: 1 }], error: null };
      if (calls.table === 'partidos_manuales') return { count: 0, error: null };
      if (calls.table === 'jugadores') return { data: [{ id: 3 }], error: null };
      if (calls.table === 'votos') return { data: [{ id: 8 }], error: null };
      return { data: [], error: null };
    });

    const { result } = renderHook(() => useOnboardingChecklist('organizer'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allDone).toBe(true);
  });

  test('explore checklist uses only meaningful review interactions', async () => {
    useAuth.mockReturnValue({ user: { id: 'u5' }, profile: { profile_completion: 100 } });
    installSupabase(() => ({ data: [], error: null }));

    const trackedActions = {
      reviewedMatch: true,
      reviewedPlayer: false,
    };
    const { result } = renderHook(() => useOnboardingChecklist('overview', { trackedActions }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const byKey = Object.fromEntries(result.current.items.map((item) => [item.key, item.done]));
    expect(byKey.profile).toBe(true);
    expect(byKey.open_play).toBeUndefined();
    expect(byKey.review_match).toBe(true);
    expect(byKey.review_player).toBe(false);
    expect(result.current.allDone).toBe(false);
  });
});
