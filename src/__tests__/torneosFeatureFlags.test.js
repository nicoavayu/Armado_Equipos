import {
  resolveDeployEnvironment,
  resolveTorneosBackendIsolation,
  resolveTorneosFeatureFlags,
} from '../features/torneos/config/featureFlags';

const stagingRef = 'hhyvmhgpapyuzjgxfnqv';

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
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: stagingRef,
      REACT_APP_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
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
    const productionFixtureRef = 'rcyuuoaqfwcembdajcss';
    const flags = resolveTorneosFeatureFlags({
      NODE_ENV: 'production',
      REACT_APP_DEPLOY_ENV: 'preview',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: productionFixtureRef,
      REACT_APP_PRODUCTION_PROJECT_REF: productionFixtureRef,
      REACT_APP_SUPABASE_URL: `https://${productionFixtureRef}.supabase.co`,
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
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: stagingRef,
    };
    [
      `https://${stagingRef}.supabase.co.evil.example`,
      `https://${stagingRef}.supabase.co:444`,
      `https://user@${stagingRef}.supabase.co`,
      `https://${stagingRef}.supabase.co/rest/v1`,
      `http://${stagingRef}.supabase.co`,
    ].forEach((supabaseUrl) => {
      expect(resolveTorneosBackendIsolation({
        ...base,
        REACT_APP_SUPABASE_URL: supabaseUrl,
      }).isIsolatedBackend).toBe(false);
    });
  });

  test('keeps media upload fail-closed until every operational gate is explicit', () => {
    const base = {
      NODE_ENV: 'production',
      REACT_APP_DEPLOY_ENV: 'staging',
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: stagingRef,
      REACT_APP_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'true',
    };

    expect(resolveTorneosFeatureFlags(base).mediaEnabled).toBe(true);
    expect(resolveTorneosFeatureFlags(base).mediaUploadEnabled).toBe(false);
    expect(resolveTorneosFeatureFlags(base).mediaOperationalReady).toBe(false);

    const ready = resolveTorneosFeatureFlags({
      ...base,
      REACT_APP_TORNEOS_MEDIA_SIGNER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_WORKER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_AV_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_CLEANUP_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY: 'true',
    });
    expect(ready.mediaOperationalReady).toBe(true);
    expect(ready.mediaUploadEnabled).toBe(true);
  });

  test('media cannot bypass the parent Torneos or gallery flags', () => {
    const base = {
      NODE_ENV: 'test',
      REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_SUPABASE_URL: 'http://localhost:54321',
      REACT_APP_TORNEOS_MEDIA_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_SIGNER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_WORKER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_AV_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_CLEANUP_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY: 'true',
    };

    expect(resolveTorneosFeatureFlags(base).mediaEnabled).toBe(false);
    expect(resolveTorneosFeatureFlags(base).mediaUploadEnabled).toBe(false);
    expect(resolveTorneosFeatureFlags({
      ...base,
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_ENABLED: 'false',
    }).mediaUploadEnabled).toBe(false);
  });
});
