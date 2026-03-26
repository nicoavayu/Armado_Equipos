const {
  normalizeYmd,
  resolveNextTemplateDate,
  todayYmdLocal,
} = require('../utils/frequentTemplateDate');

describe('frequent template local-date helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('advances template reference date by full weeks until it is in the future', () => {
    jest.setSystemTime(new Date('2026-03-18T10:00:00-03:00'));

    const resolved = resolveNextTemplateDate({
      fecha: '2026-03-10',
      dia_semana: 2,
    });

    expect(resolved.referenceDate).toBe('2026-03-10');
    expect(resolved.targetDate).toBe('2026-03-24');
  });

  test('keeps local date around UTC boundary when resolving next weekday', () => {
    // Use a local wall-clock timestamp so the assertion does not depend on the runner timezone.
    jest.setSystemTime(new Date('2026-03-16T23:30:00'));

    const resolved = resolveNextTemplateDate({
      fecha: null,
      dia_semana: 2, // Tuesday
    });

    expect(todayYmdLocal()).toBe('2026-03-16');
    expect(resolved.targetDate).toBe('2026-03-17');
  });

  test('normalizes ISO datetime strings without timezone day drift', () => {
    expect(normalizeYmd('2026-03-17T23:30:00-03:00')).toBe('2026-03-17');
    expect(normalizeYmd('2026-03-18T02:30:00.000Z')).toBe('2026-03-18');
  });
});
