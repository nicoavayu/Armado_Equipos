jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

describe('buildActivityFeed challenge copy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders challenge_squad_open with real team names and availability in two lines', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-challenge-open-1',
        type: 'challenge_squad_open',
        read: false,
        created_at: '2026-03-08T10:00:00.000Z',
        data: {
          team_match_id: 'tm-100',
          challenger_team_name: 'Napoli',
          accepted_team_name: 'Maturana',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Desafío planteado');
    expect(items[0].subtitle).toContain('Napoli desafió a Maturana');
    expect(items[0].subtitle).toContain('Revisá disponibilidad de tu equipo');
    expect(items[0].subtitle).toContain('\n');
  });

  test('never falls back to generic Equipo A/B labels in challenge activity copy', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-challenge-open-2',
        type: 'challenge_squad_open',
        read: false,
        created_at: '2026-03-08T10:00:00.000Z',
        data: {
          team_match_id: 'tm-101',
          challenger_team_name: 'Equipo A',
          accepted_team_name: 'Equipo B',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].subtitle).not.toContain('Equipo A');
    expect(items[0].subtitle).not.toContain('Equipo B');
  });
});
