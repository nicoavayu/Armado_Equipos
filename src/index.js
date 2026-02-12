import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import './utils/updateExistingMatches'; // Importar script para actualizar partidos existentes

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
