import {
  resolveDeployEnvironment,
  resolveTorneosFeatureFlags,
} from '../features/torneos/config/featureFlags';

describe('Arma2 Torneos feature flags', () => {
  test('defaults production builds to production and keeps every flag off', () => {
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'production',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: 'true',
    });

    expect(resolveDeployEnvironment({ NODE_ENV: 'production' })).toBe('production');
    expect(flags.isNonProduction).toBe(false);
    expect(flags.torneosEnabled).toBe(false);
    expect(flags.publicPages).toBe(false);
  });

  test('requires a literal opt-in in a known non-production environment', () => {
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'production',
      REACT_APP_DEPLOY_ENV: 'staging',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED: 'TRUE',
    });

    expect(flags.deployEnvironment).toBe('staging');
    expect(flags.torneosEnabled).toBe(true);
    expect(flags.notifications).toBe(false);
    expect(flags.deepLinks).toBe(false);
  });

  test('fails closed for an unknown environment', () => {
    const flags = resolveTorneosFeatureFlags({
      REACT_APP_DEPLOY_ENV: 'customer-production-copy',
      REACT_APP_TORNEOS_ENABLED: 'true',
    });

    expect(flags.isNonProduction).toBe(false);
    expect(flags.torneosEnabled).toBe(false);
  });
});
