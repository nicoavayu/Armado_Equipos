import {
  buildTournamentDraft,
  DEFAULT_TIEBREAKS,
  getDefaultFormatSettings,
  normalizeCompetitionSlug,
  validateSeasonDraft,
  validateTournamentStep,
} from '../features/torneos/domain/competitionCatalog';

describe('competition configuration domain helpers', () => {
  test('normalizes Spanish names into stable scoped slugs', () => {
    expect(normalizeCompetitionSlug('  Fútbol +30 — Núñez  ')).toBe('futbol-30-nunez');
  });

  test('rejects an inverted season date range', () => {
    expect(validateSeasonDraft({
      name: 'Apertura 2027',
      slug: 'apertura-2027',
      startDate: '2027-08-01',
      endDate: '2027-07-01',
    })).toEqual(expect.objectContaining({
      endDate: expect.stringMatching(/anterior/i),
    }));
  });

  test('builds a complete rules draft without fake competition data', () => {
    const draft = buildTournamentDraft({
      seasonId: 'season-a',
      modality: {
        code: 'football_5',
        teamSize: 5,
        recommendedSubstitutes: 3,
      },
      format: { code: 'league' },
    });
    expect(draft).toEqual(expect.objectContaining({
      seasonId: 'season-a',
      sportModality: 'football_5',
      teamSize: 5,
      substitutesLimit: 3,
      scoring: expect.objectContaining({
        pointsWin: 3,
        pointsDraw: 1,
        pointsLoss: 0,
      }),
      tiebreaks: [...DEFAULT_TIEBREAKS],
    }));
  });

  test('resets dependent settings when format changes', () => {
    expect(getDefaultFormatSettings('groups_and_playoffs')).toEqual({
      groupCount: 2,
      qualifiersPerGroup: 1,
      groupRounds: 'single',
      knockoutLegs: 'single',
    });
  });

  test('blocks review when no active category exists', () => {
    const errors = validateTournamentStep(4, buildTournamentDraft(), []);
    expect(errors.categories).toMatch(/al menos una/i);
  });

  test('rejects repeated tiebreak criteria in the rules step', () => {
    const draft = buildTournamentDraft();
    draft.tiebreaks = ['goals_for', 'goals_for'];
    expect(validateTournamentStep(3, draft)).toEqual(expect.objectContaining({
      tiebreaks: expect.stringMatching(/sin repetir/i),
    }));
  });
});
