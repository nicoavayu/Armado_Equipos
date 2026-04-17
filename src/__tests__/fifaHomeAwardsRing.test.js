jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));
jest.mock('../components/AuthProvider', () => ({
  useAuth: jest.fn(() => ({})),
}));
jest.mock('../context/NotificationContext', () => ({
  useNotifications: jest.fn(() => ({
    unreadCount: { friends: 0, matches: 0, total: 0 },
    notifications: [],
    markAsRead: jest.fn(),
  })),
}));
jest.mock('../hooks/useInterval', () => ({
  useInterval: jest.fn(() => ({
    setIntervalSafe: jest.fn(),
    clearIntervalSafe: jest.fn(),
  })),
}));
jest.mock('../supabase', () => ({
  supabase: {},
  updateProfile: jest.fn(),
  addFreePlayer: jest.fn(),
  removeFreePlayer: jest.fn(),
}));
jest.mock('../services/db/teamChallenges', () => ({
  listMyTeamMatches: jest.fn(async () => []),
}));
jest.mock('../hooks/useRefreshOnVisibility', () => ({
  useRefreshOnVisibility: jest.fn(),
}));

import { isAwardsRingNotificationType } from '../components/FifaHomeContent';
import { getDirectAwardsRingMatchIds } from '../components/FifaHomeContent';

describe('FifaHome awards ring notification guard', () => {
  test('solo tipos de premios habilitan el ring', () => {
    expect(isAwardsRingNotificationType('awards_ready')).toBe(true);
    expect(isAwardsRingNotificationType('award_won')).toBe(true);
    expect(isAwardsRingNotificationType('survey_results_ready')).toBe(false);
  });

  test('award_won habilita el ring directo para su partido', () => {
    expect(getDirectAwardsRingMatchIds([
      { type: 'award_won', partido_id: 101 },
      { type: 'awards_ready', partido_id: 202 },
      { type: 'award_won', data: { match_id: '303' } },
    ])).toEqual(['101', '303']);
  });
});
