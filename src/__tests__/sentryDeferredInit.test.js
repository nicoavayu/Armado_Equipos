/**
 * Sentry is now lazy-loaded and initialized off the synchronous startup path.
 * These tests lock in the buffering contract: captures/user intent issued before
 * init must be flushed once the SDK is ready, and dropped when Sentry is disabled.
 */
describe('monitoring/sentry deferred init', () => {
  const ORIGINAL_ENV = process.env;
  let sentryMock;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      REACT_APP_SENTRY_DSN: 'https://examplePublicKey@o0.ingest.sentry.io/0',
      REACT_APP_SENTRY_ENVIRONMENT: 'test',
      REACT_APP_SENTRY_RELEASE: '1.0.0-test',
    };
    sentryMock = {
      init: jest.fn(),
      getClient: jest.fn(() => null),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      setUser: jest.fn(),
    };
    jest.doMock('@sentry/react', () => sentryMock);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  test('buffers exceptions issued before init and flushes them once ready', async () => {
    const sentry = require('../utils/monitoring/sentry');
    const err = new Error('early boom');

    sentry.captureException(err, { foo: 'bar', empty: '' });
    expect(sentryMock.captureException).not.toHaveBeenCalled();

    await sentry.initSentry();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledWith(err, { extra: { foo: 'bar' } });
  });

  test('captures synchronously once ready', async () => {
    const sentry = require('../utils/monitoring/sentry');
    await sentry.initSentry();

    sentry.captureMessage('hello', 'info', { a: 1 });
    expect(sentryMock.captureMessage).toHaveBeenCalledWith('hello', { level: 'info', extra: { a: 1 } });
  });

  test('applies the pending user once init completes', async () => {
    const sentry = require('../utils/monitoring/sentry');

    sentry.setSentryUser({ id: '42', segment: 'beta' });
    expect(sentryMock.setUser).not.toHaveBeenCalled();

    await sentry.initSentry();
    expect(sentryMock.setUser).toHaveBeenCalledWith({ id: '42', segment: 'beta' });
  });

  test('drops buffered work and no-ops when Sentry is disabled (missing DSN)', async () => {
    process.env.REACT_APP_SENTRY_DSN = '';
    const sentry = require('../utils/monitoring/sentry');

    sentry.captureException(new Error('boom'));
    const ready = await sentry.initSentry();

    expect(ready).toBe(false);
    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();

    sentry.captureException(new Error('again'));
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });
});
