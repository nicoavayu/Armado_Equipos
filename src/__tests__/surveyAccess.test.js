jest.mock('../config/surveyConfig', () => ({
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

jest.mock('../services/db/teamChallenges', () => ({
  listChallengeApprovedSquad: jest.fn(async () => ({ byTeamId: {} })),
  listTeamMatchMembers: jest.fn(async () => ({})),
}));

const {
  listChallengeApprovedSquad,
} = require('../services/db/teamChallenges');
const { resolveSurveyAccess, resolveSurveyLifecycleBlock } = require('../utils/surveyAccess');

const buildSupabaseClient = ({
  partidoRow = null,
  teamMatchRow = null,
  rosterRows = [],
  confirmationRow = null,
}) => ({
  from: jest.fn((table) => {
    if (table === 'partidos') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({ data: partidoRow, error: null })),
          })),
        })),
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

    if (table === 'jugadores') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(async () => ({ data: rosterRows, error: null })),
        })),
      };
    }

    if (table === 'partido_team_confirmations') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({ data: confirmationRow, error: null })),
          })),
        })),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }),
});

describe('surveyAccess lifecycle guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('blocks closed surveys', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'finalizado',
        survey_status: 'closed',
        result_status: 'finished',
        finished_at: '2026-03-16T10:00:00.000Z',
      },
      now: new Date('2026-03-16T12:00:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('survey_closed');
  });

  test('blocks unavailable cancelled matches', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'cancelado',
        survey_status: 'open',
        result_status: 'pending',
      },
      now: new Date('2026-03-16T12:00:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('match_unavailable');
  });

  test('allows open surveys while deadline is pending', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'pendiente',
        survey_status: 'open',
        survey_closes_at: '2030-03-16T18:00:00.000Z',
        result_status: 'pending',
        finished_at: null,
      },
      now: new Date('2026-03-16T12:00:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('ok');
  });

  test('does not close survey only because match is finished', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'finalizado',
        survey_status: 'open',
        survey_closes_at: '2030-03-16T18:00:00.000Z',
        result_status: 'pending',
        finished_at: '2026-03-16T10:00:00.000Z',
      },
      now: new Date('2026-03-16T12:00:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('ok');
  });

  test('ignores stale survey_closes_at that predates the actual match start window', () => {
    const result = resolveSurveyLifecycleBlock({
      partidoRow: {
        estado: 'pendiente',
        survey_status: 'open',
        survey_closes_at: '2026-03-14T05:12:35.170149Z',
        result_status: 'pending',
        finished_at: null,
      },
      matchStartAt: '2026-03-18T01:00:00.000Z',
      now: new Date('2026-03-18T03:05:00.000Z').getTime(),
    });

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('ok');
  });

  test('resolveSurveyAccess keeps the pre-open block stable across runtime timezones', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-18T01:30:00.000Z'));

    const supabaseClient = buildSupabaseClient({
      partidoRow: {
        id: 77,
        fecha: '2026-03-17',
        hora: '22:00',
        estado: 'pendiente',
        survey_status: 'open',
        survey_opened_at: null,
        survey_closes_at: null,
        result_status: 'pending',
        finished_at: null,
      },
      teamMatchRow: null,
      rosterRows: [{ usuario_id: 'u1' }],
    });

    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utcAccess = await resolveSurveyAccess({
        supabaseClient,
        matchId: 77,
        userId: 'u1',
      });

      process.env.TZ = 'America/Los_Angeles';
      const laAccess = await resolveSurveyAccess({
        supabaseClient,
        matchId: 77,
        userId: 'u1',
      });

      expect(utcAccess.allowed).toBe(false);
      expect(utcAccess.reason).toBe('survey_not_open_yet');
      expect(laAccess.allowed).toBe(false);
      expect(laAccess.reason).toBe('survey_not_open_yet');
      expect(laAccess.message).toBe(utcAccess.message);
    } finally {
      process.env.TZ = originalTz;
      jest.useRealTimers();
    }
  });

  test('blocks a registered challenge roster user who is outside the approved squad', async () => {
    listChallengeApprovedSquad.mockResolvedValueOnce({
      byTeamId: {
        ta: [{ user_id: 'u1', jugador: { usuario_id: 'u1' } }],
        tb: [{ user_id: 'u2', jugador: { usuario_id: 'u2' } }],
      },
    });

    const access = await resolveSurveyAccess({
      supabaseClient: buildSupabaseClient({
        partidoRow: {
          id: 91,
          fecha: '2026-03-17',
          hora: '22:00',
          estado: 'pendiente',
          survey_status: 'open',
          survey_opened_at: '2026-03-18T02:00:00.000Z',
          survey_closes_at: '2026-03-19T02:00:00.000Z',
          result_status: 'pending',
          finished_at: null,
          survey_team_a: [],
          survey_team_b: [],
          final_team_a: [],
          final_team_b: [],
        },
        teamMatchRow: {
          id: 91,
          origin_type: 'challenge',
          challenge_id: 'c91',
          team_a_id: 'ta',
          team_b_id: 'tb',
          scheduled_at: '2026-03-18T01:00:00.000Z',
        },
        rosterRows: [
          { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Uno' },
          { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Dos' },
          { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Tres' },
        ],
      }),
      matchId: 91,
      userId: 'u3',
    });

    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('user_not_participant');
  });

  test('blocks a substitute from post-match survey access when they never entered the effective roster', async () => {
    const access = await resolveSurveyAccess({
      supabaseClient: buildSupabaseClient({
        partidoRow: {
          id: 92,
          fecha: '2026-03-17',
          hora: '22:00',
          estado: 'pendiente',
          survey_status: 'open',
          survey_opened_at: '2026-03-18T02:00:00.000Z',
          survey_closes_at: '2026-03-19T02:00:00.000Z',
          result_status: 'pending',
          finished_at: null,
        },
        teamMatchRow: null,
        rosterRows: [
          { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Titular Uno', is_substitute: false },
          { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Titular Dos', is_substitute: false },
          { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Suplente Tres', is_substitute: true },
        ],
      }),
      matchId: 92,
      userId: 'u3',
    });

    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('user_not_participant');
  });

  test('allows challenge surveys from scheduled_at for logged roster substitutes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-30T01:20:00.000Z'));

    listChallengeApprovedSquad.mockResolvedValueOnce({
      byTeamId: {
        ta: [
          { user_id: 'u1', jugador: { usuario_id: 'u1' } },
          { user_id: 'u3', jugador: { usuario_id: 'u3' } },
        ],
        tb: [{ user_id: 'u2', jugador: { usuario_id: 'u2' } }],
      },
    });

    try {
      const access = await resolveSurveyAccess({
        supabaseClient: buildSupabaseClient({
          partidoRow: {
            id: 477,
            fecha: '2026-03-29',
            hora: '22:19',
            estado: 'finalizado',
            survey_status: 'open',
            survey_opened_at: '2026-03-30T01:19:00.000Z',
            survey_closes_at: '2026-03-31T01:19:00.000Z',
            result_status: 'pending',
            finished_at: '2026-03-30T01:19:00.000Z',
            survey_team_a: [],
            survey_team_b: [],
            final_team_a: [],
            final_team_b: [],
          },
          teamMatchRow: {
            id: 'tm-477',
            origin_type: 'challenge',
            challenge_id: 'c-477',
            team_a_id: 'ta',
            team_b_id: 'tb',
            scheduled_at: '2026-03-30T01:19:00.000Z',
          },
          rosterRows: [
            { id: 1, usuario_id: 'u1', uuid: 'u1', nombre: 'Uno', is_substitute: false },
            { id: 2, usuario_id: 'u2', uuid: 'u2', nombre: 'Dos', is_substitute: false },
            { id: 3, usuario_id: 'u3', uuid: 'u3', nombre: 'Tres', is_substitute: true },
          ],
        }),
        matchId: 477,
        userId: 'u3',
      });

      expect(access.allowed).toBe(true);
      expect(access.reason).toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });
});
