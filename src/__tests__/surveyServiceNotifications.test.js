const mockFrom = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
  },
}));

jest.mock('../services/surveyCompletionService', () => ({
  finalizeIfComplete: jest.fn(async () => ({ done: false })),
}));

jest.mock('../services/awardsService', () => ({
  ensureAwards: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../utils/awardsReadiness', () => ({
  isAwardsNotEligibleStatus: jest.fn(() => false),
  isAwardsReadyStatus: jest.fn(() => false),
}));

jest.mock('../services/db/teamChallenges', () => ({
  listChallengeApprovedSquad: jest.fn(async () => ({ byTeamId: {} })),
  listTeamMatchMembers: jest.fn(async () => ({})),
}));

jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_REMINDER_12H_LEAD_MS: 12 * 60 * 60 * 1000,
  SURVEY_REMINDER_1H_LEAD_MS: 60 * 60 * 1000,
}));

const { createPostMatchSurveyNotifications } = require('../services/surveyService');

const buildSupabaseFromMock = ({
  confirmationRow = null,
  matchRow = null,
  teamMatchRow = null,
  insertedPayloads = [],
}) => (table) => {
  if (table === 'partido_team_confirmations') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: confirmationRow, error: null })),
        })),
      })),
    };
  }

  if (table === 'partidos') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: matchRow, error: null })),
        })),
      })),
    };
  }

  if (table === 'notifications') {
    return {
      insert: jest.fn((payload) => {
        insertedPayloads.push(...payload);
        return {
          select: jest.fn(async () => ({ data: payload, error: null })),
        };
      }),
    };
  }

  if (table === 'team_matches') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: teamMatchRow, error: null })),
        })),
      })),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
};

describe('surveyService notification recipients', () => {
  const originalUseJsFanout = process.env.USE_JS_FANOUT;
  const originalFanoutMode = process.env.REACT_APP_SURVEY_FANOUT_MODE;

  beforeEach(() => {
    process.env.USE_JS_FANOUT = '1';
    process.env.REACT_APP_SURVEY_FANOUT_MODE = 'js';
    mockFrom.mockReset();
  });

  afterAll(() => {
    process.env.USE_JS_FANOUT = originalUseJsFanout;
    process.env.REACT_APP_SURVEY_FANOUT_MODE = originalFanoutMode;
  });

  test('excludes non-effective substitutes from survey notifications by default', async () => {
    const insertedPayloads = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      confirmationRow: null,
      matchRow: {
        equipos_json: null,
        equipos: null,
        survey_team_a: [],
        survey_team_b: [],
        final_team_a: [],
        final_team_b: [],
      },
      insertedPayloads,
    }));

    const notifications = await createPostMatchSurveyNotifications({
      id: 501,
      nombre: 'Partido con suplente afuera',
      jugadores: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
      ],
    });

    const userIds = Array.from(new Set((notifications || []).map((row) => row.user_id))).sort();
    expect(userIds).toEqual(['u1', 'u2']);
    expect(Array.from(new Set(insertedPayloads.map((row) => row.user_id))).sort()).toEqual(['u1', 'u2']);
  });

  test('includes a substitute in survey notifications when confirmed as effective roster', async () => {
    const insertedPayloads = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      confirmationRow: {
        participants: [
          { user_id: 'u1', jugador: { usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno' } },
          { user_id: 'u3', jugador: { usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres' } },
        ],
        team_a: ['u1'],
        team_b: ['u3'],
        teams_json: null,
      },
      matchRow: {
        equipos_json: null,
        equipos: null,
        survey_team_a: [],
        survey_team_b: [],
        final_team_a: [],
        final_team_b: [],
      },
      insertedPayloads,
    }));

    const notifications = await createPostMatchSurveyNotifications({
      id: 502,
      nombre: 'Partido con cambio confirmado',
      jugadores: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
      ],
    });

    const userIds = Array.from(new Set((notifications || []).map((row) => row.user_id))).sort();
    expect(userIds).toEqual(['u1', 'u3']);
    expect(Array.from(new Set(insertedPayloads.map((row) => row.user_id))).sort()).toEqual(['u1', 'u3']);
  });

  test('uses persisted effective teams to exclude a non-effective substitute when no confirmation exists', async () => {
    const insertedPayloads = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      confirmationRow: null,
      matchRow: {
        equipos_json: [
          { players: ['u1'] },
          { players: ['u2'] },
        ],
        equipos: null,
        survey_team_a: [],
        survey_team_b: [],
        final_team_a: [],
        final_team_b: [],
      },
      insertedPayloads,
    }));

    const notifications = await createPostMatchSurveyNotifications({
      id: 503,
      nombre: 'Partido con equipos persistidos',
      jugadores: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
        { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
      ],
    });

    const userIds = Array.from(new Set((notifications || []).map((row) => row.user_id))).sort();
    expect(userIds).toEqual(['u1', 'u2']);
    expect(Array.from(new Set(insertedPayloads.map((row) => row.user_id))).sort()).toEqual(['u1', 'u2']);
  });

  test('does not create survey notifications for challenge/team_match partidos', async () => {
    const insertedPayloads = [];
    mockFrom.mockImplementation(buildSupabaseFromMock({
      confirmationRow: null,
      matchRow: {
        equipos_json: null,
        equipos: null,
        survey_team_a: [],
        survey_team_b: [],
        final_team_a: [],
        final_team_b: [],
      },
      teamMatchRow: {
        id: 'tm-504',
        partido_id: 504,
        origin_type: 'challenge',
      },
      insertedPayloads,
    }));

    const notifications = await createPostMatchSurveyNotifications({
      id: 504,
      nombre: 'Desafío: A vs B',
      jugadores: [
        { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Uno' },
        { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Dos' },
      ],
    });

    expect(notifications).toEqual([]);
    expect(insertedPayloads).toEqual([]);
  });
});
