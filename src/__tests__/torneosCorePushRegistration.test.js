// Arma2's push for people who also use Torneos: while the app runs in Torneos the device's registration is refreshed
// ONLY when the permission was already granted (in Arma2). Torneos never asks for it and never registers without it.
const mockPermissions = { receive: 'prompt' };
const mockCalls = [];
let mockNative = true;

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockNative, getPlatform: () => (mockNative ? 'ios' : 'web') },
}));
// The other plugins useNativeFeatures imports: inert here (their ESM builds need the native bridge).
jest.mock('@capacitor/share', () => ({ Share: {} }));
jest.mock('@capacitor/camera', () => ({ Camera: {}, CameraResultType: {}, CameraSource: {} }));
jest.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} } }));
jest.mock('@capacitor/geolocation', () => ({ Geolocation: {} }));
jest.mock('@capacitor/haptics', () => ({ Haptics: {}, ImpactStyle: {} }));
jest.mock('@capacitor/network', () => ({ Network: { addListener: async () => ({ remove: () => {} }), getStatus: async () => ({ connected: true }) } }));
jest.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: async () => { mockCalls.push('checkPermissions'); return { ...mockPermissions }; },
    requestPermissions: async () => { mockCalls.push('requestPermissions'); return { receive: 'granted' }; },
    register: async () => { mockCalls.push('register'); },
    addListener: async (name) => { mockCalls.push(`listener:${name}`); return { remove: () => {} }; },
  },
}));
jest.mock('../services/pushTokenService', () => ({
  getLastKnownNativePushToken: async () => null,
  syncNativePushToken: async () => ({ success: true }),
  flushPendingPushToken: async (options) => { mockCalls.push(`flush:${options?.source}`); return null; },
}));
jest.mock('../supabase', () => ({ supabase: {} }));
// Routing helpers of the tap handler (they pull Vite-era config that Jest cannot parse); not part of registration.
jest.mock('../utils/notificationRouter', () => ({ debugNotificationEvent: () => {}, resolveSurveyNotificationNavigation: () => null }));
jest.mock('../utils/notificationRoutes', () => ({ buildNotificationFallbackRoute: () => null, isSurveyFormNotificationType: () => false }));
jest.mock('../utils/matchInviteRoute', () => ({ resolveMatchInviteRoute: () => null }));
jest.mock('../utils/globalNoticeModal', () => ({ showGlobalNotice: () => {} }));
jest.mock('../utils/monitoring/analytics', () => ({ track: () => {} }));

const { refreshGrantedNativePushRegistration } = require('../hooks/useNativeFeatures');

beforeEach(() => {
  mockCalls.length = 0;
  mockNative = true;
  mockPermissions.receive = 'prompt';
});

test('without a granted permission nothing happens: no prompt, no registration', async () => {
  for (const receive of ['prompt', 'prompt-with-rationale', 'denied']) {
    mockPermissions.receive = receive;
    await expect(refreshGrantedNativePushRegistration()).resolves.toEqual({ status: receive });
  }
  expect(mockCalls.filter((call) => call !== 'checkPermissions')).toEqual([]);
});

test('with the permission granted in Arma2: the registration is refreshed and the known token re-synced', async () => {
  mockPermissions.receive = 'granted';
  await expect(refreshGrantedNativePushRegistration({ source: 'torneos_runtime' })).resolves.toEqual({ status: 'granted' });
  expect(mockCalls).toEqual(expect.arrayContaining(['listener:registration', 'register', 'flush:torneos_runtime']));
  expect(mockCalls).not.toContain('requestPermissions');
  // A second refresh never attaches the registration listener twice.
  mockCalls.length = 0;
  await refreshGrantedNativePushRegistration();
  expect(mockCalls.filter((call) => call.startsWith('listener:'))).toEqual([]);
  expect(mockCalls).toContain('register');
});

test('on the web there is nothing to refresh', async () => {
  mockNative = false;
  mockPermissions.receive = 'granted';
  await expect(refreshGrantedNativePushRegistration()).resolves.toEqual({ status: 'web' });
  expect(mockCalls).toEqual([]);
});
