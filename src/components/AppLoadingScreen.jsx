import React from 'react';
import LoadingSpinner from './LoadingSpinner';
import logo from '../Logo.png';

// Full-screen loading state shared by app boot (AuthProvider) and route-level
// Suspense fallbacks. Reuses the auth premium background so the loading screen
// matches the approved Arma2 visual identity.
const AppLoadingScreen = ({ message = 'Cargando...' }) => (
  <div className="auth-premium-bg fixed inset-0 z-[1200] flex min-h-[100dvh] w-full flex-col items-center justify-center gap-7 overflow-hidden px-6">
    <div className="auth-premium-noise" aria-hidden="true" />
    <img
      src={logo}
      alt="ARMA2"
      className="h-[96px] w-auto max-w-[60vw] object-contain drop-shadow-[0_0_24px_rgba(118,78,255,0.35)]"
    />
    <LoadingSpinner size="large" />
    {message ? (
      <p className="font-oswald text-[13px] font-medium uppercase tracking-[0.32em] text-white/55">{message}</p>
    ) : null}
  </div>
);

export default AppLoadingScreen;
