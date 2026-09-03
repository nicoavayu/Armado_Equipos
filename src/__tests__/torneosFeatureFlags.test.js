import {
  resolveDeployEnvironment,
  resolveTorneosBackendIsolation,
  resolveTorneosFeatureFlags,
  resolveTorneosProductionEnablement,
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

// Fixture ref only: it never has to match the real production project, because
// the contract is self-referential -- the ref has to match the configured
// Supabase host, whatever that pair is.
const productionRef = 'a2prodfixtureref0001';
const productionUrl = `https://${productionRef}.supabase.co`;

const productionEnv = (overrides = {}) => ({
  NODE_ENV: 'production',
  REACT_APP_DEPLOY_ENV: 'production',
  REACT_APP_TORNEOS_DATA_ENV: 'production',
  REACT_APP_PRODUCTION_PROJECT_REF: productionRef,
  REACT_APP_SUPABASE_URL: productionUrl,
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  ...overrides,
});

const localEnv = (overrides = {}) => ({
  NODE_ENV: 'development',
  REACT_APP_TORNEOS_DATA_ENV: 'local',
  REACT_APP_SUPABASE_URL: 'http://127.0.0.1:54321',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  ...overrides,
});

const stagingEnv = (overrides = {}) => ({
  NODE_ENV: 'production',
  REACT_APP_DEPLOY_ENV: 'staging',
  REACT_APP_TORNEOS_DATA_ENV: 'staging',
  REACT_APP_TORNEOS_STAGING_PROJECT_REF: stagingRef,
  REACT_APP_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  ...overrides,
});

describe('Arma2 Torneos production enablement', () => {
  test('local and staging keep the behaviour they had before the production path', () => {
    expect(resolveTorneosFeatureFlags(localEnv()).torneosEnabled).toBe(true);
    expect(resolveTorneosFeatureFlags(localEnv({
      REACT_APP_SUPABASE_URL: 'https://someremote.supabase.co',
    })).torneosEnabled).toBe(false);

    expect(resolveTorneosFeatureFlags(stagingEnv()).torneosEnabled).toBe(true);
    expect(resolveTorneosFeatureFlags(stagingEnv({
      REACT_APP_TORNEOS_STAGING_PROJECT_REF: 'anotherref12345',
    })).torneosEnabled).toBe(false);

    // The production opt-in changes nothing outside production.
    expect(resolveTorneosFeatureFlags(localEnv({
      REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
    })).torneosEnabled).toBe(true);
    expect(resolveTorneosFeatureFlags(stagingEnv({
      REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
    })).productionEnablementAllowed).toBe(false);
  });

  test('stays closed when the production opt-in is missing', () => {
    const flags = resolveTorneosFeatureFlags(productionEnv());

    expect(flags.productionOptIn).toBe(false);
    expect(flags.productionEnablementAllowed).toBe(false);
    expect(flags.canEnableTorneos).toBe(false);
    expect(flags.torneosEnabled).toBe(false);
    expect(flags.workspacesEnabled).toBe(false);
  });

  test('stays closed for false or malformed opt-in values', () => {
    ['false', '', ' ', '1', 'TRUE', 'True', ' true ', 'yes', 'on', 'enabled'].forEach((value) => {
      const flags = resolveTorneosFeatureFlags(productionEnv({
        REACT_APP_TORNEOS_PRODUCTION_ENABLED: value,
      }));

      expect(flags.productionOptIn).toBe(false);
      expect(flags.productionEnablementAllowed).toBe(false);
      expect(flags.torneosEnabled).toBe(false);
    });
  });

  test('stays closed when the opt-in points at a backend that is not production', () => {
    const backends = {
      staging: {
        REACT_APP_TORNEOS_DATA_ENV: 'staging',
        REACT_APP_TORNEOS_STAGING_PROJECT_REF: stagingRef,
        REACT_APP_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
      },
      localhost: {
        REACT_APP_TORNEOS_DATA_ENV: 'local',
        REACT_APP_SUPABASE_URL: 'http://127.0.0.1:54321',
      },
      unknown: {
        REACT_APP_PRODUCTION_PROJECT_REF: '',
        REACT_APP_SUPABASE_URL: 'https://unknownproject.supabase.co',
      },
      mismatchedRef: {
        REACT_APP_SUPABASE_URL: 'https://anotherproject.supabase.co',
      },
      lookalike: {
        REACT_APP_SUPABASE_URL: `https://${productionRef}.supabase.co.evil.example`,
      },
      plainHttp: {
        REACT_APP_SUPABASE_URL: `http://${productionRef}.supabase.co`,
      },
      customPort: {
        REACT_APP_SUPABASE_URL: `https://${productionRef}.supabase.co:444`,
      },
      withPath: {
        REACT_APP_SUPABASE_URL: `https://${productionRef}.supabase.co/rest/v1`,
      },
      withCredentials: {
        REACT_APP_SUPABASE_URL: `https://user@${productionRef}.supabase.co`,
      },
      unparseable: {
        REACT_APP_SUPABASE_URL: 'not-a-url',
      },
    };

    Object.entries(backends).forEach(([label, overrides]) => {
      const flags = resolveTorneosFeatureFlags(productionEnv({
        REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
        ...overrides,
      }));

      expect([label, flags.productionEnablementAllowed]).toEqual([label, false]);
      expect([label, flags.torneosEnabled]).toEqual([label, false]);
      expect([label, flags.workspacesEnabled]).toEqual([label, false]);
    });
  });

  test('stays closed when the build or the declared environment is not production', () => {
    [
      { NODE_ENV: 'development' },
      { NODE_ENV: 'test' },
      { REACT_APP_DEPLOY_ENV: 'staging' },
      { REACT_APP_DEPLOY_ENV: 'preview' },
      { REACT_APP_DEPLOY_ENV: 'production-copy' },
      { REACT_APP_TORNEOS_DATA_ENV: '' },
      { REACT_APP_TORNEOS_DATA_ENV: 'disabled' },
      { REACT_APP_TORNEOS_DATA_ENV: 'staging' },
    ].forEach((overrides) => {
      const flags = resolveTorneosFeatureFlags(productionEnv({
        REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
        ...overrides,
      }));

      expect([overrides, flags.productionEnablementAllowed]).toEqual([overrides, false]);
      expect([overrides, flags.torneosEnabled]).toEqual([overrides, false]);
    });
  });

  test('opens only with the whole production contract satisfied', () => {
    const env = productionEnv({ REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true' });
    const flags = resolveTorneosFeatureFlags(env);

    expect(resolveTorneosProductionEnablement(env)).toEqual({
      productionOptIn: true,
      productionEnablementAllowed: true,
    });
    expect(flags.isNonProduction).toBe(false);
    expect(flags.isIsolatedBackend).toBe(false);
    expect(flags.isKnownProductionBackend).toBe(true);
    expect(flags.isCertifiedProductionBackend).toBe(true);
    expect(flags.canEnableTorneos).toBe(true);
    expect(flags.torneosEnabled).toBe(true);
    expect(flags.workspacesEnabled).toBe(true);
  });

  test('each production surface still needs its own literal opt-in', () => {
    const flags = resolveTorneosFeatureFlags(productionEnv({
      REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: '1',
    }));

    expect(flags.torneosEnabled).toBe(true);
    expect(flags.workspaceSwitcher).toBe(false);
    expect(flags.deepLinks).toBe(false);
    expect(flags.notifications).toBe(false);
    expect(flags.officialStats).toBe(false);
    expect(flags.publicPages).toBe(false);
  });

  test('keeps media and the social generator closed in production even when every variable says true', () => {
    const flags = resolveTorneosFeatureFlags(productionEnv({
      REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
      REACT_APP_TORNEOS_DEEP_LINKS_ENABLED: 'true',
      REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED: 'true',
      REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED: 'true',
      REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'true',
      REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_SIGNER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_WORKER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_AV_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_CLEANUP_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY: 'true',
    }));

    expect(flags.torneosEnabled).toBe(true);
    expect(flags.workspacesEnabled).toBe(true);
    expect(flags.workspaceSwitcher).toBe(true);
    expect(flags.deepLinks).toBe(true);
    expect(flags.notifications).toBe(true);
    expect(flags.officialStats).toBe(true);
    expect(flags.publicPages).toBe(true);

    expect(flags.mediaEnabled).toBe(false);
    expect(flags.mediaUploadEnabled).toBe(false);
    expect(flags.mediaOperationalReady).toBe(false);
    expect(flags.socialContentGenerator).toBe(false);
  });

  test('the isolated-backend path still opens every surface it opened before', () => {
    const flags = resolveTorneosFeatureFlags(localEnv({
      REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_SIGNER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_WORKER_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_AV_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_CLEANUP_READY: 'true',
      REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY: 'true',
    }));

    expect(flags.socialContentGenerator).toBe(true);
    expect(flags.mediaEnabled).toBe(true);
    expect(flags.mediaUploadEnabled).toBe(true);
    expect(flags.mediaOperationalReady).toBe(true);
  });
});
