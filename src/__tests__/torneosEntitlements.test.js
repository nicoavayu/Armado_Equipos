import { supabase } from '../services/api/supabase';
import { loadEffectiveTournamentEntitlements } from '../features/torneos/api/tournamentWorkspaceService';
import {
  hasEffectiveTournamentEntitlement,
  normalizeTournamentEntitlements,
  TOURNAMENT_ENTITLEMENTS,
} from '../features/torneos/domain/entitlements';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

describe('Torneos effective entitlements frontend foundation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads only the server-side scope and never sends a client plan', async () => {
    supabase.rpc.mockResolvedValue({
      data: { schemaVersion: 1, plan: 'PRO', capabilities: {}, media: {} },
      error: null,
    });
    await loadEffectiveTournamentEntitlements({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      plan: 'PRO',
      capabilities: { higher_limits: true },
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_effective_tournament_entitlements',
      { p_organization_id: 'org-a', p_tournament_id: 'tournament-a' },
    );
  });

  test('fails closed for unknown plans, missing and unknown capabilities', () => {
    const normalized = normalizeTournamentEntitlements({
      plan: 'ENTERPRISE',
      capabilities: { advanced_stats: true, 'future.root': true },
    });
    expect(normalized.plan).toBe('FREE');
    expect(hasEffectiveTournamentEntitlement(
      normalized,
      TOURNAMENT_ENTITLEMENTS.ADVANCED_STATS,
    )).toBe(false);
    expect(hasEffectiveTournamentEntitlement(normalized, 'future.root')).toBe(false);
    expect(hasEffectiveTournamentEntitlement(null, 'advanced_stats')).toBe(false);
  });

  test('does not infer authorization from a PRO badge', () => {
    expect(hasEffectiveTournamentEntitlement(
      { plan: 'PRO', capabilities: {} },
      TOURNAMENT_ENTITLEMENTS.SOCIAL_STUDIO_FULL,
    )).toBe(false);
  });

  test('requires the canonical schema and expected organization scope', () => {
    const clientForged = normalizeTournamentEntitlements({
      plan: 'PRO',
      subscriptionStatus: 'active',
      capabilities: { advanced_stats: true },
    });
    expect(clientForged.plan).toBe('FREE');
    expect(clientForged.isTrusted).toBe(false);

    const crossOrganization = normalizeTournamentEntitlements({
      schemaVersion: 1,
      plan: 'PRO',
      subscriptionStatus: 'active',
      capabilities: { advanced_stats: true },
      scope: { organizationId: 'org-b', tournamentId: null },
    }, { organizationId: 'org-a', tournamentId: null });
    expect(crossOrganization.plan).toBe('FREE');
    expect(hasEffectiveTournamentEntitlement(
      crossOrganization,
      TOURNAMENT_ENTITLEMENTS.ADVANCED_STATS,
    )).toBe(false);
  });
});
