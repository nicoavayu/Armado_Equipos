import {
  resolveDeployEnvironment,
  resolveTorneosBackendIsolation,
  resolveTorneosFeatureFlags,
} from '../features/torneos/config/featureFlags';

describe('Arma2 Torneos feature flags', () => {
  test('defaults production builds to production and keeps every flag off', () => {
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'production',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
      REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: 'true',
      REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_SUPABASE_URL: 'http://127.0.0.1:54321',
    });

    expect(resolveDeployEnvironment({ NODE_ENV: 'production' })).toBe('production');
    expect(flags.isNonProduction).toBe(false);
    expect(flags.torneosEnabled).toBe(false);
    expect(flags.workspacesEnabled).toBe(false);
    expect(flags.publicPages).toBe(false);
  });

  test('requires a literal opt-in in a known non-production environment', () => {
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'production',
      REACT_APP_DEPLOY_ENV: 'staging',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
      REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED: 'TRUE',
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: 'stagingref123',
      REACT_APP_SUPABASE_URL: 'https://stagingref123.supabase.co',
    });

    expect(flags.deployEnvironment).toBe('staging');
    expect(flags.torneosEnabled).toBe(true);
    expect(flags.workspacesEnabled).toBe(true);
    expect(flags.notifications).toBe(false);
    expect(flags.deepLinks).toBe(false);
  });

  test('fails closed for an unknown environment', () => {
    const flags = resolveTorneosFeatureFlags({
      REACT_APP_DEPLOY_ENV: 'customer-production-copy',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_SUPABASE_URL: 'http://localhost:54321',
    });

    expect(flags.isNonProduction).toBe(false);
    expect(flags.torneosEnabled).toBe(false);
  });

  test('keeps workspaces and the switcher off when variables are missing or invalid', () => {
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'test',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACES_ENABLED: '1',
      REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'yes',
      REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_SUPABASE_URL: 'http://localhost:54321',
    });

    expect(flags.torneosEnabled).toBe(true);
    expect(flags.workspacesEnabled).toBe(false);
    expect(flags.workspaceSwitcher).toBe(false);
  });

  test('fails closed when staging metadata does not match the Supabase URL', () => {
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'production',
      REACT_APP_DEPLOY_ENV: 'preview',
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: 'expectedref123',
      REACT_APP_SUPABASE_URL: 'https://differentref456.supabase.co',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
    });

    expect(flags.isNonProduction).toBe(true);
    expect(flags.isIsolatedBackend).toBe(false);
    expect(flags.torneosEnabled).toBe(false);
    expect(flags.workspacesEnabled).toBe(false);
  });

  test('accepts local Supabase only on a loopback hostname', () => {
    expect(resolveTorneosBackendIsolation({
      REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_SUPABASE_URL: 'http://127.0.0.1:54321',
    }).isIsolatedBackend).toBe(true);
    expect(resolveTorneosBackendIsolation({
      REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_SUPABASE_URL: 'https://production-project.supabase.co',
    }).isIsolatedBackend).toBe(false);
  });

  test('rejects the known production project even when staging flags are forged', () => {
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'production',
      REACT_APP_DEPLOY_ENV: 'preview',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: 'rcyuuoaqfwcembdajcss',
      REACT_APP_SUPABASE_URL: 'https://RCYUUOAQFWCEMBDAJCSS.supabase.co',
    });

    expect(flags.isKnownProductionBackend).toBe(true);
    expect(flags.isIsolatedBackend).toBe(false);
    expect(flags.torneosEnabled).toBe(false);
    expect(flags.workspacesEnabled).toBe(false);
    expect(flags.workspaceSwitcher).toBe(false);
  });

  test('rejects staging URL lookalikes, credentials, paths and non-default ports', () => {
    const base = {
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: 'stagingref123',
    };
    [
      'https://stagingref123.supabase.co.evil.example',
      'https://stagingref123.supabase.co:444',
      'https://user@stagingref123.supabase.co',
      'https://stagingref123.supabase.co/rest/v1',
      'http://stagingref123.supabase.co',
    ].forEach((supabaseUrl) => {
      expect(resolveTorneosBackendIsolation({
        ...base,
        REACT_APP_SUPABASE_URL: supabaseUrl,
      }).isIsolatedBackend).toBe(false);
    });
  });
});
