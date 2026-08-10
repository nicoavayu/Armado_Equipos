import { supabase } from '../services/api/supabase';
import {
  loadMyTournamentMemberships,
  loadTournamentExperienceRelations,
  loadPublishedTournamentMatches,
  loadPublishedTournamentStandings,
  loadPublishedTournamentStatistics,
  loadPublishedTournamentTeams,
  loadTournamentParticipantHub,
  loadTournamentParticipantMatch,
  setTournamentHubCategory,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

describe('participant hub service contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test('lists only the authenticated user memberships with bounded pagination', async () => {
    await loadMyTournamentMemberships({ limit: 18, offset: 36 });
    expect(supabase.rpc).toHaveBeenCalledWith('get_my_tournament_memberships', {
      p_limit: 18,
      p_offset: 36,
    });
  });

  test('resolves the unified entrypoint from every bounded membership page', async () => {
    supabase.rpc
      .mockResolvedValueOnce({
        data: {
          items: [{ tournamentId: 'admin-tournament', role: 'owner' }],
          pagination: { hasMore: true },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ tournamentId: 'player-tournament', role: 'player' }],
          pagination: { hasMore: false },
        },
        error: null,
      });

    await expect(loadTournamentExperienceRelations({ pageSize: 1 }))
      .resolves.toEqual(expect.objectContaining({
        items: [
          { tournamentId: 'admin-tournament', role: 'owner' },
          { tournamentId: 'player-tournament', role: 'player' },
        ],
      }));
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'get_my_tournament_memberships', {
      p_limit: 1,
      p_offset: 0,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'get_my_tournament_memberships', {
      p_limit: 1,
      p_offset: 1,
    });
  });

  test('loads the hub with tournament and optional category scope only', async () => {
    await loadTournamentParticipantHub({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      userId: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_tournament_participant_hub', {
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
    });
  });

  test('persists a category preference on the backend', async () => {
    await setTournamentHubCategory({
      tournamentId: 'tournament-a',
      categoryId: 'category-b',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('set_my_tournament_hub_category', {
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-b',
    });
  });

  test('uses an explicit published-match filter contract', async () => {
    await loadPublishedTournamentMatches({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      view: 'mine',
      teamEntryId: 'team-a',
      limit: 12,
      offset: 24,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_published_tournament_matches', {
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_view: 'mine',
      p_team_entry_id: 'team-a',
      p_limit: 12,
      p_offset: 24,
    });
  });

  test('loads one participant-safe match without client identity fields', async () => {
    await loadTournamentParticipantMatch('match-a');
    expect(supabase.rpc).toHaveBeenCalledWith('get_tournament_participant_match', {
      p_match_id: 'match-a',
    });
  });

  test('uses bounded pagination for the published team directory', async () => {
    await loadPublishedTournamentTeams({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      limit: 16,
      offset: 16,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_published_tournament_teams', {
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_limit: 16,
      p_offset: 16,
    });
  });

  test('loads participant standings from a published-only scope', async () => {
    await loadPublishedTournamentStandings({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      phaseId: 'phase-a',
      groupId: null,
      organizationId: 'forged-org',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_published_tournament_standings', {
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_phase_id: 'phase-a',
      p_group_id: null,
    });
  });

  test('loads participant statistics without an administrative organization id', async () => {
    await loadPublishedTournamentStatistics({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      phaseId: 'phase-a',
      groupId: 'group-a',
      organizationId: 'forged-org',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_published_tournament_statistics', {
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_phase_id: 'phase-a',
      p_group_id: 'group-a',
    });
  });

  test('maps access denial without leaking database details', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'TORNEOS_HUB_FORBIDDEN internal_table secret',
      },
    });

    await expect(loadTournamentParticipantHub({
      tournamentId: 'foreign',
    })).rejects.toEqual(expect.objectContaining({
      code: 'TORNEOS_HUB_FORBIDDEN',
      message: 'Ese torneo ya no está disponible para tu perfil.',
    }));
  });
});
