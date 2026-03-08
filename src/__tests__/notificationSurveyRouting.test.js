jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { extractNotificationMatchId } = require('../utils/notificationRoutes');
const { resolveSurveyNotificationRoute } = require('../utils/notificationRouter');

describe('survey notification routing', () => {
  test('prefers partido_id over team_match_id for survey notifications', () => {
    const notification = {
      type: 'survey_reminder',
      partido_id: 321,
      data: {
        team_match_id: 'tm-999',
      },
    };

    expect(extractNotificationMatchId(notification)).toBe(321);
  });

  test('keeps team_match_id priority for non-survey notifications', () => {
    const notification = {
      type: 'challenge_squad_open',
      partido_id: 321,
      data: {
        team_match_id: 'tm-999',
      },
    };

    expect(extractNotificationMatchId(notification)).toBe('tm-999');
  });

  test('never resolves invite links as survey destination', () => {
    const notification = {
      type: 'survey_reminder',
      partido_id: 654,
      data: {
        link: '/partido/654/invitacion?codigo=ABC',
      },
    };

    expect(resolveSurveyNotificationRoute(notification)).toBe('/encuesta/654');
  });

  test('accepts canonical survey link when present', () => {
    const notification = {
      type: 'survey_start',
      partido_id: 111,
      data: {
        link: '/encuesta/111',
      },
    };

    expect(resolveSurveyNotificationRoute(notification)).toBe('/encuesta/111');
  });

  test('normalizes legacy survey link to canonical route', () => {
    const notification = {
      type: 'survey_start',
      partido_id: 222,
      data: {
        link: '/partidos/222/encuesta?from=notif',
      },
    };

    expect(resolveSurveyNotificationRoute(notification)).toBe('/encuesta/222?from=notif');
  });
});
