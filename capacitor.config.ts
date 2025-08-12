import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.teambalancer.app',
  appName: 'Team Balancer',
  webDir: 'build',
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    Camera: {
      permissions: ["camera", "photos"]
    },
    Geolocation: {
      permissions: ["location"]
    },
    Keyboard: {
      resize: "ionic",
      resizeOnFullScreen: true
    }
  }
};

export default config;
