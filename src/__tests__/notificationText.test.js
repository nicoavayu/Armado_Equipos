import {
  applyMatchNameQuotes,
  formatMatchReminderMessage,
  resolveNotificationMatchName,
} from '../utils/notificationText';

describe('notificationText', () => {
  test('does not inject quotes inside words when match name is a single letter', () => {
    const source = 'Recordatorio de partido';
    expect(applyMatchNameQuotes(source, 'd')).toBe(source);
  });

  test('falls back when resolved match name is too short', () => {
    const notification = {
      data: {
        match_name: 'd',
      },
    };

    expect(resolveNotificationMatchName(notification, 'este partido')).toBe('este partido');
  });

  test('formats match reminder message with the match name', () => {
    const notification = {
      data: {
        match_name: 'Futbol martes',
      },
    };

    expect(formatMatchReminderMessage(notification)).toBe('Futbol martes empieza en aproximadamente 1 hora.');
  });
});
