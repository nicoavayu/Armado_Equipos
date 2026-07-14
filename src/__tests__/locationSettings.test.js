const mockIsNativePlatform = jest.fn();
const mockOpen = jest.fn();

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: (...args) => mockIsNativePlatform(...args) },
}));

jest.mock('capacitor-native-settings', () => ({
  AndroidSettings: { ApplicationDetails: 'application_details' },
  IOSSettings: { App: 'app' },
  NativeSettings: { open: (...args) => mockOpen(...args) },
}));

const { openNativeLocationSettings } = require('../utils/locationSettings');

describe('openNativeLocationSettings', () => {
  beforeEach(() => {
    mockIsNativePlatform.mockReset();
    mockOpen.mockReset();
  });

  test('opens app-specific settings for permanently blocked native permission', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    mockOpen.mockResolvedValue({ status: true });

    await expect(openNativeLocationSettings()).resolves.toBe(true);
    expect(mockOpen).toHaveBeenCalledWith({
      optionAndroid: 'application_details',
      optionIOS: 'app',
    });
  });

  test('does nothing on web', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await expect(openNativeLocationSettings()).resolves.toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
