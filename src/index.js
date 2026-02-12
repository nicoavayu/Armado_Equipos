import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import './utils/updateExistingMatches'; // Importar script para actualizar partidos existentes

// Global mobile guard: prevent accidental horizontal drag/side-scroll.
if (typeof window !== 'undefined' && 'ontouchstart' in window) {
  let startX = 0;
  let startY = 0;
  let edgeGesture = false;

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    edgeGesture = touch.clientX <= 24 || touch.clientX >= (window.innerWidth - 24);
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1 || edgeGesture) return;

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - startX);
    const deltaY = Math.abs(touch.clientY - startY);

    // If gesture is mainly horizontal, block it unless explicitly allowed.
    if (deltaX > deltaY + 4) {
      const target = event.target instanceof Element
        ? event.target.closest('[data-allow-horizontal-scroll="true"]')
        : null;
      if (!target) event.preventDefault();
    }
  }, { passive: false });
}

// Herramientas de debug solo en desarrollo.
if (process.env.NODE_ENV !== 'production') {
  import('./utils/debugNotifications').catch((error) => {
    console.warn('[DEBUG] Could not load debugNotifications:', error);
  });

  if (process.env.REACT_APP_NETLOG !== 'false') {
    import('./lib/networkLogger')
      .then(({ initNetworkLogger }) => {
        initNetworkLogger();
      })
      .catch((error) => {
        console.warn('[DEBUG] Could not initialize network logger:', error);
      });
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service worker deshabilitado temporalmente para evitar conflictos
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js')
//       .then((registration) => {
//         console.log('SW registered: ', registration);
//       })
//       .catch((registrationError) => {
//         console.log('SW registration failed: ', registrationError);
//       });
//   });
// }

reportWebVitals();
