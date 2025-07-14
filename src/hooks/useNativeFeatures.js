import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { PushNotifications } from '@capacitor/push-notifications';

export const useNativeFeatures = () => {
  const [isNative] = useState(Capacitor.isNativePlatform());
  const [networkStatus, setNetworkStatus] = useState({ connected: true });

  useEffect(() => {
    if (isNative) {
      // Monitor network status
      Network.addListener('networkStatusChange', status => {
        setNetworkStatus(status);
      });

      // Initialize push notifications
      initPushNotifications();
    }
  }, [isNative]);

  const initPushNotifications = async () => {
    try {
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive === 'granted') {
        await PushNotifications.register();
      }
    } catch (error) {
      console.log('Push notifications not available');
    }
  };

  const shareContent = async (title, text, url) => {
    try {
      await Share.share({ title, text, url });
    } catch (error) {
      // Fallback to web share or copy
      if (navigator.share) {
        await navigator.share({ title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    }
  };

  const takePicture = async () => {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt
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
      const style = type === 'heavy' ? ImpactStyle.Heavy : 
                   type === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
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
          schedule: { at: new Date(Date.now() + 1000) }
        }]
      });
    } catch (error) {
      // Fallback to web notification
      if ('Notification' in window && Notification.permission === 'granted') {
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
    sendNotification
  };
};