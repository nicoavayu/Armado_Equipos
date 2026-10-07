import { isLabDeviceHost, resolveLabDeviceHost } from '../features/torneos/config/labDeviceHost';
import { resolveTorneosBackendIsolation, resolveTorneosFeatureFlags } from '../features/torneos/config/featureFlags';
import { assertTorneosGatewayUrl, readDualBackendConfig } from '../features/torneos/foundation/config';

// A phone on the same Wi-Fi reaches the local lab through the dev machine's private address: an explicit,
// development-server-only test setting. Production, staging and every other combination must ignore it.
const labPhoneEnv = {
  NODE_ENV: 'development',
  REACT_APP_DEPLOY_ENV: 'development',
  REACT_APP_TORNEOS_DATA_ENV: 'local',
  REACT_APP_LAB_DEVICE_HOST: '192.168.0.171',
  REACT_APP_SUPABASE_URL: 'http://192.168.0.171:58432',
  REACT_APP_SUPABASE_ANON_KEY: 'public',
  REACT_APP_TORNEOS_GATEWAY_URL: 'http://192.168.0.171:58433',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
};

describe('lab device host (explicit Wi-Fi phone test setting)', () => {
  test('the development server treats exactly that private address like loopback', () => {
    expect(resolveLabDeviceHost(labPhoneEnv)).toBe('192.168.0.171');
    expect(resolveTorneosBackendIsolation(labPhoneEnv).isIsolatedBackend).toBe(true);
    const flags = resolveTorneosFeatureFlags(labPhoneEnv);
    expect(flags.torneosEnabled).toBe(true);
    expect(flags.workspacesEnabled).toBe(true);
    expect(readDualBackendConfig(labPhoneEnv).torneos.gatewayUrl).toBe('http://192.168.0.171:58433');
  });

  test('a production build never honors it, even with every other variable set', () => {
    const env = { ...labPhoneEnv, NODE_ENV: 'production' };
    expect(resolveLabDeviceHost(env)).toBeNull();
    expect(resolveTorneosBackendIsolation(env).isIsolatedBackend).toBe(false);
    expect(resolveTorneosFeatureFlags(env).torneosEnabled).toBe(false);
    expect(() => readDualBackendConfig(env)).toThrow('TORNEOS_CONFIG_INVALID');
  });

  test.each([
    ['another deploy environment', { REACT_APP_DEPLOY_ENV: 'preview' }],
    ['staging data', { REACT_APP_TORNEOS_DATA_ENV: 'staging' }],
    ['a public address', { REACT_APP_LAB_DEVICE_HOST: '8.8.8.8', REACT_APP_SUPABASE_URL: 'http://8.8.8.8:58432' }],
    ['a hostname instead of an IPv4 literal', { REACT_APP_LAB_DEVICE_HOST: 'lab.local', REACT_APP_SUPABASE_URL: 'http://lab.local:58432' }],
    ['an out-of-range octet', { REACT_APP_LAB_DEVICE_HOST: '192.168.0.300' }],
    ['no setting at all', { REACT_APP_LAB_DEVICE_HOST: '' }],
  ])('%s keeps the guard closed', (_label, override) => {
    const env = { ...labPhoneEnv, ...override };
    expect(resolveTorneosBackendIsolation(env).isIsolatedBackend).toBe(false);
  });

  test('only the named address counts: a different private host stays outside', () => {
    const env = { ...labPhoneEnv, REACT_APP_SUPABASE_URL: 'http://192.168.0.172:58432' };
    expect(isLabDeviceHost('192.168.0.172', env)).toBe(false);
    expect(resolveTorneosBackendIsolation(env).isIsolatedBackend).toBe(false);
    expect(() => assertTorneosGatewayUrl('http://192.168.0.172:58433', { env })).toThrow('TORNEOS_CONFIG_INVALID');
  });

  test('Core and Torneos keep separate targets: the gateway may not be the Core origin', () => {
    expect(() => assertTorneosGatewayUrl('http://192.168.0.171:58432', { coreOrigin: 'http://192.168.0.171:58432', env: labPhoneEnv }))
      .toThrow('TORNEOS_CORE_TARGET_COLLISION');
  });
});
