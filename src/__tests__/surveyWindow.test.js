jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const {
  deriveSurveyWindowFromMatch,
  isSurveyWindowConsistentWithKickoff,
  isSurveyWindowInvalidForKickoff,
} = require('../utils/surveyWindow');

describe('surveyWindow kickoff anchoring', () => {
  test('keeps deterministic AR kickoff window across runtime timezones', () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utcResult = deriveSurveyWindowFromMatch({
        fecha: '2026-03-17',
        hora: '22:00',
      });

      process.env.TZ = 'America/Los_Angeles';
      const laResult = deriveSurveyWindowFromMatch({
        fecha: '2026-03-17',
        hora: '22:00',
      });

      expect(utcResult.source).toBe('kickoff');
      expect(laResult.source).toBe('kickoff');
      expect(laResult.openedAtIso).toBe(utcResult.openedAtIso);
      expect(laResult.closesAtIso).toBe(utcResult.closesAtIso);
      expect(utcResult.openedAtIso).toBe('2026-03-18T02:00:00.000Z');
      expect(utcResult.closesAtIso).toBe('2026-03-19T02:00:00.000Z');
    } finally {
      process.env.TZ = originalTz;
    }
  });

  test('derives survey window from kickoff even when fallback now is provided', () => {
    const fallbackNowIso = '2026-03-13T02:12:35.170Z';

    const result = deriveSurveyWindowFromMatch({
      fecha: '2026-03-17',
      hora: '22:00',
      fallbackNowIso,
    });

    expect(result.source).toBe('kickoff');
    expect(result.openedAtIso).toBe('2026-03-18T02:00:00.000Z');
    expect(result.closesAtIso).toBe('2026-03-19T02:00:00.000Z');
    expect(result.openedAtIso).not.toBe(fallbackNowIso);
  });

  test('flags stale survey windows that do not match current kickoff', () => {
    const canonical = deriveSurveyWindowFromMatch({
      fecha: '2026-03-17',
      hora: '22:00',
    });

    const staleOpenedAt = '2026-03-13T02:12:35.170Z';
    const staleClosesAt = '2026-03-14T02:12:35.170Z';

    expect(isSurveyWindowConsistentWithKickoff({
      openedAt: staleOpenedAt,
      closesAt: staleClosesAt,
      expectedOpenedAt: canonical.openedAtIso,
      expectedClosesAt: canonical.closesAtIso,
    })).toBe(false);

    expect(isSurveyWindowInvalidForKickoff({
      closesAt: staleClosesAt,
      expectedOpenedAt: canonical.openedAtIso,
    })).toBe(true);
  });

  test('flags stale windows even when close is after open but off canonical schedule', () => {
    const canonical = deriveSurveyWindowFromMatch({
      fecha: '2026-03-17',
      hora: '22:00',
    });

    const shiftedOpenAt = '2026-03-18T04:00:00.000Z';
    const shiftedCloseAt = '2026-03-19T04:00:00.000Z';

    expect(isSurveyWindowConsistentWithKickoff({
      openedAt: shiftedOpenAt,
      closesAt: shiftedCloseAt,
      expectedOpenedAt: canonical.openedAtIso,
      expectedClosesAt: canonical.closesAtIso,
    })).toBe(false);

    expect(isSurveyWindowInvalidForKickoff({
      closesAt: shiftedCloseAt,
      expectedOpenedAt: canonical.openedAtIso,
    })).toBe(false);
  });

  test('falls back to now only when no kickoff fields exist', () => {
    const fallbackNowIso = '2026-03-18T00:00:00.000Z';

    const result = deriveSurveyWindowFromMatch({
      fecha: null,
      hora: null,
      scheduledAt: null,
      fallbackNowIso,
    });

    expect(result.source).toBe('fallback_now');
    expect(result.openedAtIso).toBe(fallbackNowIso);
  });
});
