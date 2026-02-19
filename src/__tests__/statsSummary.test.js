import { getPointsEfficiencySummary } from '../utils/statsSummary';

describe('statsSummary', () => {
  test('returns friendly empty copy when there are no closed matches', () => {
    const summary = getPointsEfficiencySummary({ cerrados: 0, puntos: 0, puntosPct: 0 });
    expect(summary).toEqual({
      hasClosedMatches: false,
      scoreText: 'Sin partidos cerrados',
      percentText: '-',
    });
  });

  test('returns points and percentage for closed matches', () => {
    const summary = getPointsEfficiencySummary({ cerrados: 4, puntos: 8, puntosPct: 66.6 });
    expect(summary).toEqual({
      hasClosedMatches: true,
      scoreText: '8 / 12',
      percentText: '66.6%',
    });
  });
});

