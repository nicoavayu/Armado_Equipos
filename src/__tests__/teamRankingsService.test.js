import {
  getTeamChallengeRankings,
  searchChallengeableTeams,
} from '../services/db/teamRankings';

const mockRpc = jest.fn();

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe('team rankings service limits', () => {
  test('ranking never requests more than 20 rows', async () => {
    mockRpc.mockResolvedValue({
      data: Array.from({ length: 25 }, (_, index) => ({
        team_id: `team-${index + 1}`,
        team_name: `Team ${index + 1}`,
      })),
      error: null,
    });

    const rows = await getTeamChallengeRankings({ limit: 500 });

    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_get_team_challenge_rankings',
      expect.objectContaining({ p_limit: 20 }),
    );
    expect(rows).toHaveLength(20);
  });

  test('directory accepts incremental page limits', async () => {
    await searchChallengeableTeams({ limit: 42 });

    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_search_challengeable_teams',
      expect.objectContaining({ p_limit: 42 }),
    );
  });
});
