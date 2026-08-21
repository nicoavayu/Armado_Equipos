import { supabase } from '../services/api/supabase';
import {
  loadEffectiveTournamentEntitlements,
  loadTournamentCreationEligibility,
} from '../features/torneos/api/tournamentWorkspaceService';
import {
  CORE_SPORT_ENTITLEMENTS,
  hasEffectiveTournamentEntitlement,
  normalizeTournamentEntitlements,
  TOURNAMENT_ENTITLEMENTS,
  TOURNAMENT_PLANS,
} from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const TOURNAMENT_ID = '30000000-0000-4000-8000-000000000001';

describe('Torneos FREE/PREMIUM frontend contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads only the server-side edition scope and never sends a client plan', async () => {
    supabase.rpc.mockResolvedValue({
      data: tournamentEntitlementsFixture(),
      error: null,
    });
    await loadEffectiveTournamentEntitlements({
      organizationId: ORGANIZATION_ID,
      tournamentId: TOURNAMENT_ID,
      plan: 'PREMIUM',
      assignmentSource: 'purchase',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_effective_tournament_entitlements',
      { p_organization_id: ORGANIZATION_ID, p_tournament_id: TOURNAMENT_ID },
    );
  });

  test('loads first-Free eligibility from the domain decision', async () => {
    supabase.rpc.mockResolvedValue({
      data: { status: 'free_available', hasConsumedFreeTournament: false },
      error: null,
    });
    await loadTournamentCreationEligibility({ organizationId: ORGANIZATION_ID });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_tournament_creation_eligibility',
      { p_organization_id: ORGANIZATION_ID },
    );
  });

  test.each([
    ['FREE', 'first_free'],
    ['PREMIUM', 'legacy_grant'],
    ['PREMIUM', 'purchase'],
  ])('%s with source %s resolves as a trusted edition plan', (plan, assignmentSource) => {
    const normalized = normalizeTournamentEntitlements(tournamentEntitlementsFixture({
      plan,
      assignmentSource,
    }), {
      organizationId: ORGANIZATION_ID,
      tournamentId: TOURNAMENT_ID,
    });
    expect(normalized.isTrusted).toBe(true);
    expect(normalized.plan).toBe(plan);
    expect(normalized.assignmentSource).toBe(assignmentSource);
  });

  test('fails closed for unknown plans, invalid sources or mismatched edition scope', () => {
    const unknown = normalizeTournamentEntitlements({
      ...tournamentEntitlementsFixture(),
      plan: 'ENTERPRISE',
    });
    const forgedPremium = normalizeTournamentEntitlements({
      ...tournamentEntitlementsFixture({ plan: TOURNAMENT_PLANS.PREMIUM }),
      assignmentSource: 'first_free',
    });
    const crossTournament = normalizeTournamentEntitlements(
      tournamentEntitlementsFixture(),
      { organizationId: ORGANIZATION_ID, tournamentId: 'another-tournament' },
    );
    expect(unknown.isTrusted).toBe(false);
    expect(forgedPremium.isTrusted).toBe(false);
    expect(crossTournament.isTrusted).toBe(false);
    expect(crossTournament.plan).toBe(TOURNAMENT_PLANS.FREE);
  });

  test('core sporting capabilities remain available in FREE and PREMIUM', () => {
    for (const plan of [TOURNAMENT_PLANS.FREE, TOURNAMENT_PLANS.PREMIUM]) {
      const normalized = normalizeTournamentEntitlements(tournamentEntitlementsFixture({ plan }));
      for (const capability of CORE_SPORT_ENTITLEMENTS) {
        expect(hasEffectiveTournamentEntitlement(normalized, capability)).toBe(true);
      }
    }
  });

  test('advanced capabilities are Premium-only and unknown keys fail closed', () => {
    const free = normalizeTournamentEntitlements(tournamentEntitlementsFixture());
    const premium = normalizeTournamentEntitlements(tournamentEntitlementsFixture({
      plan: TOURNAMENT_PLANS.PREMIUM,
    }));
    for (const capability of [
      TOURNAMENT_ENTITLEMENTS.ADVANCED_STATISTICS,
      TOURNAMENT_ENTITLEMENTS.SPONSORS,
      TOURNAMENT_ENTITLEMENTS.PREMIUM_SOCIAL_STUDIO,
      TOURNAMENT_ENTITLEMENTS.PROFESSIONAL_EXPORTS,
    ]) {
      expect(hasEffectiveTournamentEntitlement(free, capability)).toBe(false);
      expect(hasEffectiveTournamentEntitlement(premium, capability)).toBe(true);
    }
    expect(hasEffectiveTournamentEntitlement(premium, 'future.root')).toBe(false);
  });

  test('pricing and limits are normalized from the one server response', () => {
    const free = normalizeTournamentEntitlements(tournamentEntitlementsFixture());
    const premium = normalizeTournamentEntitlements(tournamentEntitlementsFixture({
      plan: TOURNAMENT_PLANS.PREMIUM,
    }));
    expect(free.pricing).toEqual({
      currency: 'ARS',
      listPrice: 49900,
      launchPrice: 39900,
      billingModel: 'one_time',
      scope: 'tournament_edition',
    });
    expect(free.media).toEqual({
      galleryAssetLimit: 100,
      essentialAssetsCountTowardLimit: false,
    });
    expect(free.administration.administrativeSeatLimit).toBe(1);
    expect(premium.media.galleryAssetLimit).toBe(10000);
    expect(premium.administration.administrativeSeatLimit).toBe(10);
    expect(premium.administration.ownerCountsTowardLimit).toBe(false);
  });
});
