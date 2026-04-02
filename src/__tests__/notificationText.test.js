import {
  applyMatchNameQuotes,
  formatMatchCancelledMessage,
  formatMatchReminderMessage,
  resolveNotificationMatchName,
  sanitizeNotificationMatchName,
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

  test('falls back when persisted match name is numeric only', () => {
    expect(sanitizeNotificationMatchName('1', 'este partido')).toBe('este partido');
  });

  test('formats match reminder message with the match name', () => {
    const notification = {
      data: {
        match_name: 'Futbol martes',
      },
    };

    expect(formatMatchReminderMessage(notification)).toBe('Futbol martes empieza en aproximadamente 1 hora.');
  });

  test('formats match cancellation with the persisted match name', () => {
    const notification = {
      data: {
        match_name: 'Futbol jueves',
      },
    };

    expect(formatMatchCancelledMessage(notification)).toBe('Futbol jueves fue cancelado por el administrador.');
  });

  test('does not leak numeric match ids when the match name is unavailable', () => {
    const notification = {
      data: {
        match_id: 494,
      },
    };

    expect(formatMatchCancelledMessage(notification, { fallbackLabel: 'el partido' })).toBe('el partido fue cancelado por el administrador.');
  });
});
