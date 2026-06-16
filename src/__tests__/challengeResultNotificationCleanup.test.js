import { supabase } from '../lib/supabaseClient';
import { reportChallengeResult } from '../services/db/teamChallenges';

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatchSafe: jest.fn(),
}));

const makeNotificationUpdateBuilder = () => {
  const builder = {
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    or: jest.fn(() => Promise.resolve({ data: null, error: null })),
  };
  return builder;
};

describe('reportChallengeResult notification cleanup', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('marks challenge result survey notifications resolved only after the result is saved', async () => {
    const notificationBuilder = makeNotificationUpdateBuilder();
    supabase.rpc.mockResolvedValueOnce({
      data: { id: 'team-match-1', result_status: 'team_a_win' },
      error: null,
    });
    supabase.from.mockReturnValueOnce(notificationBuilder);

    await expect(reportChallengeResult({
      challengeId: 'challenge-1',
      resultStatus: 'team_a_win',
    })).resolves.toEqual({ id: 'team-match-1', result_status: 'team_a_win' });

    expect(supabase.from).toHaveBeenCalledWith('notifications');
    expect(notificationBuilder.update).toHaveBeenCalledWith({
      read: true,
      status: 'resolved',
    });
    expect(notificationBuilder.eq).toHaveBeenCalledWith('type', 'challenge_result_survey');
    expect(notificationBuilder.or).toHaveBeenCalledWith(
      'data->>challenge_id.eq.challenge-1,data->>team_match_id.eq.team-match-1',
    );
  });

  test('does not resolve notifications when the RPC fails', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'transicion de estado invalida: accepted -> completed' },
    });

    await expect(reportChallengeResult({
      challengeId: 'challenge-1',
      resultStatus: 'team_a_win',
    })).rejects.toThrow('transicion de estado invalida: accepted -> completed');

    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('for a provisional one-team report resolves only the current user notification', async () => {
    const notificationBuilder = makeNotificationUpdateBuilder();
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-a' } },
      error: null,
    });
    supabase.rpc.mockResolvedValueOnce({
      data: {
        id: 'team-match-1',
        result_status: 'team_a_win',
        result_confirmed: false,
        result_conflict: false,
      },
      error: null,
    });
    supabase.from.mockReturnValueOnce(notificationBuilder);

    await expect(reportChallengeResult({
      challengeId: 'challenge-1',
      resultStatus: 'team_a_win',
    })).resolves.toEqual({
      id: 'team-match-1',
      result_status: 'team_a_win',
      result_confirmed: false,
      result_conflict: false,
    });

    expect(notificationBuilder.eq).toHaveBeenCalledWith('type', 'challenge_result_survey');
    expect(notificationBuilder.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(notificationBuilder.or).toHaveBeenCalledWith(
      'data->>challenge_id.eq.challenge-1,data->>team_match_id.eq.team-match-1',
    );
  });
});
