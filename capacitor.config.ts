import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.teambalancer.app',
  appName: 'Arma2',
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
      // iOS-only knob; Android resizing is handled by windowSoftInputMode.
      resize: "ionic"
      // resizeOnFullScreen intentionally NOT set: this app is not fullscreen,
      // and on Android that flag force-resizes the webview content on top of
      // the window's own adjustResize — that double resize is what painted a
      // huge gray band between the app and the keyboard.
    }
  }
};

export default config;
