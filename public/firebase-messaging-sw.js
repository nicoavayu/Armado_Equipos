// Service Worker para notificaciones push
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Configuración de Firebase (reemplazar con tus valores)
firebase.initializeApp({
  apiKey: 'your-api-key',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project-id',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '123456789',
  appId: 'your-app-id',
});

const messaging = firebase.messaging();

// Manejar notificaciones en background
messaging.onBackgroundMessage((payload) => {
  console.log('Background message received:', payload);
  
  const { title, body, data } = payload;
  
  // Si es invitación a partido, preparar redirect
  if (data?.type === 'match_invite' && data?.matchId) {
    const notificationOptions = {
      title: title || 'Invitación a partido',
      body: body || 'Te han invitado a un partido',
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      data: {
        url: `/admin/${data.matchId}`, // URL para redirect
        matchId: data.matchId,
      },
      actions: [
        {
          action: 'accept',
          title: 'Ver partido',
        },
        {
          action: 'dismiss',
          title: 'Cerrar',
        },
      ],
    };
    
    return self.registration.showNotification(title, notificationOptions);
  }
});

// Manejar click en notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const { data } = event.notification;
  
  if (data?.url) {
    // Abrir la app en la URL específica
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Si ya hay una ventana abierta, navegar ahí
          for (const client of clientList) {
            if (client.url.includes(window.location.origin)) {
              client.postMessage({
                type: 'NAVIGATE_TO',
                url: data.url,
              });
              return client.focus();
            }
          }
          // Si no hay ventana abierta, abrir nueva
          return clients.openWindow(data.url);
        }),
    );
  }
});