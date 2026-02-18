/*
 * Web push is intentionally disabled until a real Firebase Web config is provided.
 * Native mobile push is handled by Capacitor plugins.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification?.close();
});
