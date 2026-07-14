import { Capacitor } from '@capacitor/core';
import {
  AndroidSettings,
  IOSSettings,
  NativeSettings,
} from 'capacitor-native-settings';

export const openNativeLocationSettings = async () => {
  if (!Capacitor.isNativePlatform()) return false;
  const result = await NativeSettings.open({
    optionAndroid: AndroidSettings.ApplicationDetails,
    optionIOS: IOSSettings.App,
  });
  return result?.status !== false;
};
