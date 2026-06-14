import { updateChallenge, updateTeamMatchDetails } from '../services/db/teamChallenges';
import { supabase } from '../lib/supabaseClient';

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const buildChallengeUpdateMock = (result) => {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const query = {
    eq: jest.fn(() => query),
    select: jest.fn(() => ({ maybeSingle })),
  };
  const table = {
    update: jest.fn(() => query),
  };
  supabase.from.mockReturnValue(table);
  return { maybeSingle, query, table };
};

describe('challenge format editing', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('allows changing an F8 challenge with existing F8 team_matches to F5', async () => {
    const { table } = buildChallengeUpdateMock({
      data: {
        id: 'challenge-1',
        challenger_team_id: 'team-a',
        status: 'accepted',
        format: 5,
        match_format: 5,
        skill_level: 'intermedio',
        challenger_team: { id: 'team-a', format: 8 },
        accepted_team: { id: 'team-b', format: 8 },
      },
      error: null,
    });

    const result = await updateChallenge('user-1', 'challenge-1', {
      challenger_team_id: 'team-a',
      scheduled_at: '2026-07-10T22:00:00.000Z',
      mode: 'Masculino',
      location_name: 'Palermo',
      format: 5,
      skill_level: 'intermedio',
      field_price: 25000,
    });

    expect(result.format).toBe(5);
    expect(table.update).toHaveBeenCalledWith(expect.objectContaining({
      challenger_team_id: 'team-a',
      format: 5,
    }));
  });

  test('does not expose the technical team_matches/challenges format error', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'team_matches.format debe coincidir con challenges.format',
      },
    });

    let thrownError = null;
    try {
      await updateTeamMatchDetails({
        matchId: 'match-1',
        scheduledAt: '2026-07-10T22:00:00.000Z',
        location: 'Palermo',
        canchaCost: 25000,
        mode: 'Masculino',
        format: 5,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError?.message).toContain('No se pudo actualizar el formato del desafio');
    expect(thrownError?.message).not.toMatch(/team_matches|challenges\.format/);
  });

  test('sends the updated challenge format when editing the active team_match', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        id: 'match-1',
        challenge_id: 'challenge-1',
        origin_type: 'challenge',
        format: 5,
        mode: 'Masculino',
        scheduled_at: '2026-07-10T22:00:00.000Z',
        location: 'Palermo',
        status: 'confirmed',
        challenge: {
          id: 'challenge-1',
          format: 5,
          match_format: 5,
        },
      },
      error: null,
    });

    const result = await updateTeamMatchDetails({
      matchId: 'match-1',
      scheduledAt: '2026-07-10T22:00:00.000Z',
      location: 'Palermo',
      canchaCost: 25000,
      mode: 'Masculino',
      format: 5,
    });

    expect(result.format).toBe(5);
    expect(supabase.rpc).toHaveBeenCalledWith('rpc_update_team_match_details', expect.objectContaining({
      p_match_id: 'match-1',
      p_format: 5,
    }));
  });
});
