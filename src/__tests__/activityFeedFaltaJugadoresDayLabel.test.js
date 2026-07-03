jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildHomeNotificationText } = require('../utils/activityFeed');

const localDateString = (daysFromToday = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const notification = { type: 'falta_jugadores', data: { missingPlayers: 5 } };

describe('buildHomeNotificationText falta_jugadores day label', () => {
  test('today match: subtitle carries "hoy" before the hour', () => {
    const copy = buildHomeNotificationText(notification, {
      nombre: 'Yumi',
      fecha: localDateString(0),
      hora: '19:30',
    });

    expect(copy.title).toBe('Quedan 5 lugares');
    expect(copy.subtitle).toBe('"Yumi" · hoy 19:30');
  });

  test('tomorrow match: subtitle carries "mañana" before the hour', () => {
    const copy = buildHomeNotificationText(notification, {
      nombre: 'Yumi',
      fecha: localDateString(1),
      hora: '19:30',
    });

    expect(copy.subtitle).toBe('"Yumi" · mañana 19:30');
  });

  test('without a parseable date the hour shows alone (no "próximamente" noise)', () => {
    const copy = buildHomeNotificationText(notification, {
      nombre: 'Yumi',
      hora: '19:30',
    });

    expect(copy.subtitle).toBe('"Yumi" · 19:30');
  });
});
