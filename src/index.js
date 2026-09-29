import logger from './utils/logger';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import './utils/updateExistingMatches'; // Importar script para actualizar partidos existentes
import { initSentry } from 'utils/monitoring/sentry';
import { cleanupLegacyServiceWorkers } from './utils/legacyServiceWorkerCleanup';
import { installHorizontalSwipeGuard } from './utils/horizontalSwipeGuard';

// Global mobile guard: prevent accidental horizontal drag/side-scroll of the
// page; real horizontal scrollers (tabs, chips, tables) keep their swipe.
if (typeof window !== 'undefined' && 'ontouchstart' in window) {
  installHorizontalSwipeGuard(window);
}

// Herramientas de debug solo en desarrollo.
if (process.env.NODE_ENV !== 'production') {
  import('./utils/debugNotifications').catch((error) => {
    logger.warn('[DEBUG] Could not load debugNotifications:', error);
  });

  if (process.env.REACT_APP_NETLOG !== 'false') {
    import('./lib/networkLogger')
      .then(({ initNetworkLogger }) => {
        initNetworkLogger();
      })
      .catch((error) => {
        logger.warn('[DEBUG] Could not initialize network logger:', error);
      });
  }
}

if (process.env.NODE_ENV === 'production') {
  cleanupLegacyServiceWorkers();
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Init Sentry off the synchronous startup path: the SDK is lazy-loaded and
// kicked off after the first paint. captureException/setSentryUser calls made
// before it's ready are buffered and flushed on init, so no early error is lost.
if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
  window.requestAnimationFrame(() => initSentry());
} else {
  initSentry();
}

// Service worker deshabilitado temporalmente para evitar conflictos
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js')
//       .then((registration) => {
//         logger.log('SW registered: ', registration);
//       })
//       .catch((registrationError) => {
//         logger.log('SW registration failed: ', registrationError);
//       });
//   });
// }

reportWebVitals();
