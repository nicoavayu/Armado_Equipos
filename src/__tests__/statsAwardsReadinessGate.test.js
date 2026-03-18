import { shouldIncludeSurveyResultForAwardsStats } from '../components/StatsView';

describe('Stats awards readiness gate', () => {
  test('counts awards only when awards status is ready', () => {
    expect(shouldIncludeSurveyResultForAwardsStats({
      awards_status: 'ready',
      awards: { mvp: { player_id: '11' } },
    })).toBe(true);

    expect(shouldIncludeSurveyResultForAwardsStats({
      awards_status: 'pending',
      awards: { mvp: { player_id: '11' } },
    })).toBe(false);

    expect(shouldIncludeSurveyResultForAwardsStats({
      awards_status: 'not_eligible',
      awards: { mvp: { player_id: '11' } },
    })).toBe(false);

    expect(shouldIncludeSurveyResultForAwardsStats({
      awards_status: null,
      awards_generated: true,
    })).toBe(true);
  });
});
