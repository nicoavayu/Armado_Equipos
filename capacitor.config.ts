import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.teambalancer.app',
  appName: 'Team Balancer',
  webDir: 'build',
  // Match the app's dark base so the native WebView never flashes white
  // while a lazy route chunk loads or before the web content composites.
  backgroundColor: '#0c0a1d',
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
