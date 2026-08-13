import {
  ARMA2_RUNTIME,
  resolvePersonalSpaceAvailability,
} from '../utils/runtimePlatform';
import {
  classifyPublicMatch,
  countScheduledMatches,
  PUBLIC_MATCH_KIND,
} from '../features/torneos/domain/matchSchedule';

const localFlags = {
  isNonProduction: true,
  isIsolatedBackend: true,
  torneosEnabled: true,
  workspacesEnabled: true,
};

describe('LOCAL review blockers', () => {
  test('exposes personal space on an isolated LOCAL/QA web runtime', () => {
    expect(resolvePersonalSpaceAvailability({
      runtime: ARMA2_RUNTIME.WEB,
      featureFlags: localFlags,
    })).toBe(true);
  });

  test('keeps the production web boundary closed', () => {
    expect(resolvePersonalSpaceAvailability({
      runtime: ARMA2_RUNTIME.WEB,
      featureFlags: {
        ...localFlags,
        isNonProduction: false,
        isIsolatedBackend: false,
      },
    })).toBe(false);
  });

  test('counts persisted schedules from their real timestamps', () => {
    const matches = [
      { status: 'ready', scheduledAt: '2026-06-06T17:00:00Z' },
      { status: 'postponed', scheduledAt: '2026-09-05T20:00:00Z' },
      { status: 'ready', scheduledAt: null },
      { status: 'scheduled', scheduledAt: 'invalid' },
    ];
    expect(countScheduledMatches(matches)).toBe(2);
  });

  test('does not classify a historical ready match as upcoming', () => {
    expect(classifyPublicMatch({
      status: 'ready',
      scheduledAt: '2026-06-06T17:00:00Z',
      result: null,
    }, new Date('2026-08-12T18:00:00Z').getTime())).toBe(PUBLIC_MATCH_KIND.HISTORICAL);

    expect(classifyPublicMatch({
      status: 'postponed',
      scheduledAt: '2026-09-05T20:00:00Z',
      result: null,
    }, new Date('2026-08-12T18:00:00Z').getTime())).toBe(PUBLIC_MATCH_KIND.UPCOMING);
  });
});
