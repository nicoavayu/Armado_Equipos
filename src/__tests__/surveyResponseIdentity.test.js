jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
  SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE: 3,
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../api/supabaseWrapper', () => ({
  db: {
    fetchMany: jest.fn(async () => []),
  },
}));

jest.mock('../services/db/awards', () => ({
  grantAwardsForMatch: jest.fn(async () => ({ ok: true })),
  notifyAwardWinnersForMatch: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../services/db/penalties', () => ({
  ensureNoShowRanking: jest.fn(async () => ({ error: null })),
}));

jest.mock('../services/historySnapshotService', () => ({
  ensureParticipantsSnapshot: jest.fn(async () => null),
  ensureSurveyResultsSnapshot: jest.fn(async () => null),
}));

jest.mock('../services/db/userIdentity', () => ({
  resolveStablePlayerRef: jest.fn(async () => null),
}));

const {
  hasExistingSurveyResponse,
  listExistingSurveyResponsePlayerIds,
  normalizeSurveyPlayerIds,
  resolveCanonicalSurveyPlayerId,
} = require('../services/surveyCompletionService');

const buildSurveyClient = ({ rows = [], error = null, observedPlayerIds = null } = {}) => ({
  from: jest.fn((table) => {
    if (table !== 'post_match_surveys') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: jest.fn((columns) => {
        expect(columns).toBe('votante_id');
        return {
          eq: jest.fn((field, partidoId) => {
            expect(field).toBe('partido_id');
            expect(partidoId).toBe(77);
            return {
              in: jest.fn(async (inField, playerIds) => {
                expect(inField).toBe('votante_id');
                if (typeof observedPlayerIds === 'function') {
                  observedPlayerIds(playerIds);
                }
                return { data: rows, error };
              }),
            };
          }),
        };
      }),
    };
  }),
});

describe('survey response identity helpers', () => {
  test('normalizeSurveyPlayerIds dedupes ids and filters invalid values', () => {
    expect(normalizeSurveyPlayerIds([11, '11', null, 0, -4, ['12', 'abc', 12]])).toEqual([11, 12]);
  });

  test('listExistingSurveyResponsePlayerIds checks every alias jugador id for the same user', async () => {
    let queriedPlayerIds = [];
    const client = buildSurveyClient({
      rows: [{ votante_id: 204 }],
      observedPlayerIds: (playerIds) => {
        queriedPlayerIds = playerIds;
      },
    });

    const result = await listExistingSurveyResponsePlayerIds({
      partidoId: 77,
      playerIds: [101, 204, 204],
      client,
    });

    expect(queriedPlayerIds).toEqual([101, 204]);
    expect(result).toEqual([204]);
  });

  test('hasExistingSurveyResponse returns true when any alias jugador id already answered', async () => {
    const client = buildSurveyClient({
      rows: [{ votante_id: 302 }],
    });

    await expect(hasExistingSurveyResponse({
      partidoId: 77,
      playerIds: [301, 302],
      client,
    })).resolves.toBe(true);
  });

  test('resolveCanonicalSurveyPlayerId prefers the primary player id when available', () => {
    expect(resolveCanonicalSurveyPlayerId({
      primaryPlayerId: 204,
      playerIds: [101, 204, 305],
    })).toBe(204);
  });

  test('resolveCanonicalSurveyPlayerId falls back to the lowest alias id when there is no primary row', () => {
    expect(resolveCanonicalSurveyPlayerId({
      primaryPlayerId: null,
      playerIds: [305, '101', 204, 204],
    })).toBe(101);
  });

  test('listExistingSurveyResponsePlayerIds short-circuits when there are no valid player ids', async () => {
    const client = {
      from: jest.fn(() => {
        throw new Error('from should not be called');
      }),
    };

    await expect(listExistingSurveyResponsePlayerIds({
      partidoId: 77,
      playerIds: [null, 0, ''],
      client,
    })).resolves.toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });
});
