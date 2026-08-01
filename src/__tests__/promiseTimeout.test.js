import { OperationTimeoutError, withTimeout } from '../utils/promiseTimeout';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('resolves normally when the operation completes in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  test('rejects instead of leaving the caller pending forever', async () => {
    jest.useFakeTimers();
    const result = withTimeout(
      new Promise(() => {}),
      1000,
      'Supabase no respondió a tiempo.',
    );

    jest.advanceTimersByTime(1000);

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: OperationTimeoutError.name,
        message: 'Supabase no respondió a tiempo.',
      }),
    );
  });
});
