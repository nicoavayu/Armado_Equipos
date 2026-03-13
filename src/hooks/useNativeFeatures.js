import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  ensurePushTokenAuthSync,
  flushPendingPushToken,
  getLastKnownNativePushToken,
  syncNativePushToken,
} from '../services/pushTokenService';
import { track } from '../utils/monitoring/analytics';

let pushBootstrapPromise = null;
let pushListenersAttached = false;
let lastRegistrationToken = '';

export const initNativePushNotifications = async () => {
  if (!Capacitor.isNativePlatform()) return;

  if (!pushBootstrapPromise) {
    pushBootstrapPromise = (async () => {
      ensurePushTokenAuthSync();

      if (!pushListenersAttached) {
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action?.notification?.data || action?.notification?.extra || {};
          const notificationType = String(
            data?.notificationType
            || data?.notification_type
            || data?.type
            || action?.actionId
            || action?.notification?.title
            || '',
          ).trim();

          const route = String(
            data?.route
            || data?.url
            || data?.link
            || data?.target_route
            || data?.targetUrl
            || '',
          ).trim();

          track('push_opened', {
            notification_type: notificationType || undefined,
            route: route || undefined,
            opened_from_push: true,
            source: 'capacitor_push',
          });
        });

        await PushNotifications.addListener('registration', async (token) => {
          const currentToken = String(token?.value || '').trim();
          if (!currentToken) return;

          try {
            const previousToken = lastRegistrationToken || await getLastKnownNativePushToken();
            lastRegistrationToken = currentToken;
            await syncNativePushToken(currentToken, { previousToken });
          } catch (error) {
            console.warn('[PUSH] Failed to sync native registration token', error);
          }
        });

        await PushNotifications.addListener('registrationError', (error) => {
          console.warn('[PUSH] Native registration error', error);
        });

        pushListenersAttached = true;
      }

      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') {
        console.info('[PUSH] Permission not granted');
        return;
      }

      await PushNotifications.register();
      await flushPendingPushToken();
    })().catch((error) => {
      console.warn('[PUSH] bootstrapNativePush failed', error);
    });
  }

  await pushBootstrapPromise;
};

export const useNativeFeatures = () => {
  const [isNative] = useState(Capacitor.isNativePlatform());
  const [networkStatus, setNetworkStatus] = useState({ connected: true });

  useEffect(() => {
    if (!isNative) return undefined;

    let networkListenerHandle = null;

    Network.addListener('networkStatusChange', (status) => {
      setNetworkStatus(status);
    })
      .then((handle) => {
        networkListenerHandle = handle;
      })
      .catch((error) => {
        console.warn('[NATIVE] Failed to attach network listener', error);
      });

    initNativePushNotifications();

    return () => {
      if (networkListenerHandle?.remove) {
        networkListenerHandle.remove().catch(() => null);
      }
    };
  }, [isNative]);

  const shareContent = async (title, text, url) => {
    try {
      await Share.share({ title, text, url });
    } catch (error) {
      // Fallback to web share only (never copy to clipboard automatically).
      if (navigator.share) {
        await navigator.share({ title, text, url });
      } else {
        throw error;
      }
    }
  };

  const takePicture = async () => {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
      });
      return image.dataUrl;
    } catch (error) {
      console.log('Camera not available');
      return null;
    }
  };

  const saveData = async (key, value) => {
    try {
      await Preferences.set({ key, value: JSON.stringify(value) });
    } catch (error) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  };

  const getData = async (key) => {
    try {
      const { value } = await Preferences.get({ key });
      return value ? JSON.parse(value) : null;
    } catch (error) {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }
  };

  const getCurrentLocation = async () => {
    try {
      const coordinates = await Geolocation.getCurrentPosition();
      return coordinates;
    } catch (error) {
      console.log('Geolocation not available');
      return null;
    }
  };

  const vibrate = async (type = 'light') => {
    try {
      const style = type === 'heavy' ? ImpactStyle.Heavy
        : type === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
      await Haptics.impact({ style });
    } catch (error) {
      // Fallback to web vibration
      if (navigator.vibrate) {
        navigator.vibrate(type === 'heavy' ? 200 : type === 'medium' ? 100 : 50);
      }
    }
  };

  const sendNotification = async (title, body) => {
    try {
      await PushNotifications.schedule({
        notifications: [{
          title,
          body,
          id: Date.now(),
          schedule: { at: new Date(Date.now() + 1000) },
        }],
      });
    } catch (error) {
      // Fallback to web notification
      if ('Notification' in window && Notification.permission === 'granted') {
        // eslint-disable-next-line no-new
        new Notification(title, { body });
      }
    }
  };

  return {
    isNative,
    networkStatus,
    shareContent,
    takePicture,
    saveData,
    getData,
    getCurrentLocation,
    vibrate,
    sendNotification,
  };
};
