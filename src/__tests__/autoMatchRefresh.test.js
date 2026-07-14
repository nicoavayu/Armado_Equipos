import {
  AUTO_MATCH_REFRESH_STEPS,
  getAutoMatchRefreshMessage,
  getAutoMatchRetryDelay,
  runAutoMatchRefreshStep,
} from '../utils/autoMatchRefresh';

describe('auto-match refresh policy', () => {
  test('uses bounded exponential-style backoff online', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => getAutoMatchRetryDelay(attempt)))
      .toEqual([5000, 15000, 30000, 60000, 60000]);
  });

  test('backs off more while the device is offline', () => {
    expect([1, 2, 3].map((attempt) => getAutoMatchRetryDelay(attempt, { online: false })))
      .toEqual([30000, 60000, 60000]);
    expect(getAutoMatchRefreshMessage({ online: false })).toMatch(/Revisá tu conexión/);
  });

  test('wraps a failure with the exact operation and request target', async () => {
    const cause = new TypeError('Failed to fetch');
    await expect(runAutoMatchRefreshStep(
      AUTO_MATCH_REFRESH_STEPS.proposals,
      async () => { throw cause; },
    )).rejects.toMatchObject({
      name: 'AutoMatchRefreshError',
      cause,
      operation: 'load_active_proposals',
      target: 'rpc:get_my_auto_match_proposals',
      method: 'POST',
    });
  });
});
