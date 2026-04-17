// import './HomeStyleKit.css'; // Removed in Tailwind migration
import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams, Outlet } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

import ErrorBoundary from './components/ErrorBoundary';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import AuthProvider, { useAuth } from './components/AuthProvider';
import usePendingAuthFlow from './hooks/usePendingAuthFlow';
import LoadingSpinner from './components/LoadingSpinner';
import GlobalNoticeModal from './components/GlobalNoticeModal';
// NotificationsDebugPanel removed

import MainLayout from './components/MainLayout';
import { initNativePushNotifications } from './hooks/useNativeFeatures';
import { useNotificationRedirect } from './hooks/useNotificationRedirect';
import { useRouteScrollReset } from './hooks/useScrollReset';
import { setAuthReturnTo } from './utils/authReturnTo';
import {
  clearPendingAuthFlow,
  markPendingAuthCallbackReceived,
  readPendingAuthFlow,
  setAuthFlowResult,
} from './utils/authFlowState';
import { track } from './utils/monitoring/analytics';


import { NotificationProvider } from './context/NotificationContext';
import { BadgeProvider } from './context/BadgeContext';

// Lazy load pages
const EncuestaPartido = lazy(() => import('./pages/EncuestaPartido'));
const ResultadosEncuestaView = lazy(() => import('./pages/ResultadosEncuestaView'));
const HealthCheck = lazy(() => import('./pages/HealthCheck'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const AccountDeletionInfoPage = lazy(() => import('./pages/AccountDeletionInfoPage'));
const VotarEquiposPage = lazy(() => import('./pages/VotarEquiposPage'));
const AuthHome = lazy(() => import('./components/AuthHome'));
const AuthCallback = lazy(() => import('./components/AuthCallback'));
const InviteLanding = lazy(() => import('./components/InviteLanding'));

const HomePage = lazy(() => import('./pages/HomePage'));
const NuevoPartidoPage = lazy(() => import('./pages/NuevoPartidoPage'));
const QuieroJugarPage = lazy(() => import('./pages/QuieroJugarPage'));
const DesafiosPage = lazy(() => import('./pages/DesafiosPage'));
const EquipoDetallePage = lazy(() => import('./pages/EquipoDetallePage'));
const TeamChatPage = lazy(() => import('./pages/TeamChatPage'));
const TeamMatchDetailPage = lazy(() => import('./pages/TeamMatchDetailPage'));
const AmigosPage = lazy(() => import('./pages/AmigosPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const FrecuentesPage = lazy(() => import('./pages/FrecuentesPage'));
const TemplateDetailsPage = lazy(() => import('./pages/TemplateDetailsPage'));
const TemplateHistoryPage = lazy(() => import('./pages/TemplateHistoryPage'));
const AdminPanelPage = lazy(() => import('./pages/AdminPanelPage'));
const PartidoInvitacion = lazy(() => import('./pages/PartidoInvitacion'));

// Dev-only diagnostics (excluded in production builds)
if (process.env.NODE_ENV === 'development') {
  try { require('./utils/testNotificationsView'); } catch {
    // Silently fail if file not available
  }
  try { require('./utils/testNotifications'); } catch {
    // Silently fail if file not available
  }
  try { require('./utils/debugProximosPartidos'); } catch {
    // Silently fail if file not available
  }
}

export default function App() {
  return (
    <GlobalErrorBoundary>
      <ErrorBoundary>
        <AuthProvider>
          <BadgeProvider>
            <NotificationProvider>
              <Router>
                <GoogleMapsScriptBootstrap />
                <NativePushBootstrap />
                <NotificationRedirectBootstrap />
                <NativeAuthDeepLinkBootstrap />
                <ScrollToTop />
                <RouteAnalyticsTracker />
                <Routes>
                  <Route path="/health" element={<HealthRoute />} />
                  <Route path="/terms" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <TermsPage />
                    </Suspense>
                  } />
                  <Route path="/privacy" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <PrivacyPage />
                    </Suspense>
                  } />
                  <Route path="/account-deletion" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <AccountDeletionInfoPage />
                    </Suspense>
                  } />
                  <Route path="/encuesta/:partidoId" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <EncuestaPartido />
                    </Suspense>
                  } />
                  <Route path="/resultados-encuesta/:partidoId" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <ResultadosEncuestaView />
                    </Suspense>
                  } />
                  <Route path="/resultados/:partidoId" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <ResultadosEncuestaView />
                    </Suspense>
                  } />
                  <Route path="/login" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <AuthHome />
                    </Suspense>
                  } />
                  <Route path="/login/email" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <AuthHome />
                    </Suspense>
                  } />
                  <Route path="/auth/callback" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <AuthCallback />
                    </Suspense>
                  } />
                  <Route path="/i/:token" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <InviteLanding />
                    </Suspense>
                  } />
                  
                  {/* Ruta pública: invitación a partido (sin auth requerido) */}
                  <Route path="/partido/:partidoId/invitacion" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <PartidoInvitacion />
                    </Suspense>
                  } />
                  
                  {/* Ruta pública: votación de equipos (sin auth requerido) */}
                  <Route path="/votar-equipos" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <VotarEquiposPage />
                    </Suspense>
                  } />

                  <Route path="/" element={<AppAuthWrapper />}>
                    <Route path="" element={<MainLayout />}>
                      <Route index element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <HomePage />
                        </Suspense>
                      } />
                      <Route path="home" element={<Navigate to="/" replace />} />
                      <Route path="nuevo-partido" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <NuevoPartidoPage />
                        </Suspense>
                      } />
                      <Route path="quiero-jugar" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <QuieroJugarPage />
                        </Suspense>
                      } />
                      <Route path="desafios" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <DesafiosPage />
                        </Suspense>
                      } />
                      <Route path="desafios/equipos/:teamId" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <EquipoDetallePage />
                        </Suspense>
                      } />
                      <Route path="desafios/equipos/:teamId/chat" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <TeamChatPage />
                        </Suspense>
                      } />
                      <Route path="desafios/equipos/partidos/:matchId" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <TeamMatchDetailPage />
                        </Suspense>
                      } />
                      {/* Backward-compatible aliases for old equipos routes */}
                      <Route path="quiero-jugar/equipos/:teamId" element={<LegacyTeamDetailRedirect />} />
                      <Route path="quiero-jugar/equipos/:teamId/chat" element={<LegacyTeamChatRedirect />} />
                      <Route path="quiero-jugar/equipos/partidos/:matchId" element={<LegacyTeamMatchRedirect />} />
                      <Route path="amigos" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <AmigosPage />
                        </Suspense>
                      } />
                      <Route path="profile" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <ProfilePage />
                        </Suspense>
                      } />
                      <Route path="notifications" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <NotificationsPage />
                        </Suspense>
                      } />
                      <Route path="stats" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <StatsPage />
                        </Suspense>
                      } />
                      <Route path="frecuentes" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <FrecuentesPage />
                        </Suspense>
                      } />
                      <Route path="frecuentes/:templateId" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <TemplateDetailsPage />
                        </Suspense>
                      } />
                      <Route path="frecuentes/:templateId/historial" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <TemplateHistoryPage />
                        </Suspense>
                      } />
                      {/* Backward compatible aliases */}
                      <Route path="historial" element={<Navigate to="/frecuentes" replace />} />
                      <Route path="historial/:templateId" element={<LegacyTemplateRedirect />} />
                      <Route path="historial/:templateId/historial" element={<LegacyTemplateHistoryRedirect />} />
                      <Route path="admin/:partidoId" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <AdminPanelPage />
                        </Suspense>
                      } />
                      <Route path="partido/:partidoId" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <AdminPanelPage />
                        </Suspense>
                      } />
                      <Route path="partido-publico/:partidoId" element={
                        <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                          <PartidoInvitacion mode="public" />
                        </Suspense>
                      } />
                    </Route>
                  </Route>
                </Routes>
                <GlobalNoticeModal />
              </Router>
              {/* Debug panel removed */}
            </NotificationProvider>
          </BadgeProvider>
        </AuthProvider>
      </ErrorBoundary>
    </GlobalErrorBoundary>
  );
}

function GoogleMapsScriptBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const webKey = String(process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '').trim();
    const mobileKey = String(process.env.REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE || '').trim();
    const isNative = Capacitor?.isNativePlatform?.();
    const selectedKey = (isNative ? mobileKey : webKey) || mobileKey || webKey;

    if (!selectedKey) {
      console.warn('[MAPS] Missing Google Maps API key (web/mobile).');
      return undefined;
    }

    const desiredSrc = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(selectedKey)}&libraries=places&loading=async`;

    const existingScript = Array.from(document.querySelectorAll('script[src]'))
      .find((node) => String(node.src || '').includes('maps.googleapis.com/maps/api/js'));

    if (existingScript) {
      let currentKey = '';
      try {
        currentKey = String(new URL(existingScript.src).searchParams.get('key') || '');
      } catch {
        currentKey = '';
      }

      if (currentKey === selectedKey) {
        return undefined;
      }

      existingScript.remove();
    }

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = desiredSrc;
    script.setAttribute('data-google-maps-loader', 'runtime');
    script.onerror = () => {
      console.warn('[MAPS] Failed to load Google Maps JS runtime script.', {
        isNative,
        usingMobileKey: isNative && Boolean(mobileKey),
      });
    };

    document.head.appendChild(script);
    return undefined;
  }, []);

  return null;
}

function NativePushBootstrap() {
  useEffect(() => {
    initNativePushNotifications().catch((error) => {
      console.warn('[PUSH] NativePushBootstrap init failed', error);
    });
  }, []);

  return null;
}

function NotificationRedirectBootstrap() {
  useNotificationRedirect();
  return null;
}

function NativeAuthDeepLinkBootstrap() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    const BROWSER_CANCEL_GRACE_MS = 1200;
    let isDisposed = false;
    let listenerHandle = null;
    let browserHandle = null;
    let browserFinishedTimeoutId = null;
    const handledUrls = new Set();
    const clearBrowserFinishedTimeout = () => {
      if (browserFinishedTimeoutId === null) return;
      window.clearTimeout(browserFinishedTimeoutId);
      browserFinishedTimeoutId = null;
    };
    const stringifyAuthDetails = (details) => {
      try {
        return JSON.stringify(details, (_key, value) => {
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
            };
          }
          if (typeof value === 'undefined') return null;
          return value;
        });
      } catch (error) {
        return JSON.stringify({
          serializationError: error?.message || String(error),
        });
      }
    };
    const logAuth = (event, details = {}) => {
      console.info(`[AUTH] ${event} ${stringifyAuthDetails(details)}`);
    };
    const warnAuth = (event, details = {}) => {
      console.warn(`[AUTH] ${event} ${stringifyAuthDetails(details)}`);
    };

    const handleUrl = (incomingUrl) => {
      const rawUrl = String(incomingUrl || '').trim();
      const alreadyHandled = handledUrls.has(rawUrl);
      const rawUrlWithoutFragment = rawUrl.split('#')[0] || '';
      const rawUrlWithoutQuery = rawUrlWithoutFragment.split('?')[0] || '';
      const normalizedRawCallbackUrl = rawUrlWithoutQuery.replace(/\/+$/, '');
      const isOauthCallback = (
        normalizedRawCallbackUrl === 'com.teambalancer.app://auth/callback'
        || normalizedRawCallbackUrl === 'com.teambalancer.app:///auth/callback'
      );
      logAuth('handleUrl_called', {
        rawUrl,
        normalizedRawCallbackUrl,
        isOauthCallback,
        alreadyHandled,
      });
      if (isOauthCallback) {
        clearBrowserFinishedTimeout();
      }
      if (!rawUrl || alreadyHandled) return;

      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch (error) {
        warnAuth('handleUrl_parse_failed', {
          rawUrl,
          message: error?.message || String(error),
        });
        return;
      }

      const protocol = String(parsed.protocol || '');
      const hostname = String(parsed.hostname || '');
      const pathname = String(parsed.pathname || '');
      const search = String(parsed.search || '');
      const hash = String(parsed.hash || '');

      logAuth('handleUrl_parsed', {
        rawUrl,
        protocol,
        hostname,
        pathname,
        search,
        hash,
        normalizedRawCallbackUrl,
        alreadyHandled,
      });

      logAuth('handleUrl_match', {
        rawUrl,
        protocol,
        hostname,
        pathname,
        search,
        hash,
        normalizedRawCallbackUrl,
        isOauthCallback,
        alreadyHandled,
      });

      if (!isOauthCallback) return;

      handledUrls.add(rawUrl);
      markPendingAuthCallbackReceived({ callbackUrl: rawUrl });
      logAuth('browser_close_requested', { rawUrl });
      try {
        Browser.close()
          .then(() => {
            logAuth('browser_close_done', { rawUrl });
          })
          .catch((error) => {
            warnAuth('browser_close_failed', {
              rawUrl,
              message: error?.message || String(error),
            });
          });
      } catch (error) {
        warnAuth('browser_close_failed', {
          rawUrl,
          message: error?.message || String(error),
        });
      }

      const callbackRoute = `/auth/callback${search}${hash}`;
      const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      logAuth('callback_route', {
        rawUrl,
        protocol,
        hostname,
        pathname,
        search,
        hash,
        normalizedRawCallbackUrl,
        isOauthCallback,
        callbackRoute,
        currentRoute,
      });

      if (currentRoute === callbackRoute) {
        logAuth('callback_route_already_current', {
          callbackRoute,
        });
        return;
      }

      window.setTimeout(() => {
        logAuth('callback_route_replace', {
          callbackRoute,
          rawUrl,
        });
        window.location.replace(callbackRoute);
      }, 0);
    };

    (async () => {
      try {
        browserHandle = await Browser.addListener('browserFinished', () => {
          if (isDisposed) return;

          const pendingFlow = readPendingAuthFlow();
          if (!pendingFlow) return;
          if (pendingFlow.status === 'callback_received' || pendingFlow.status === 'session_restored') {
            return;
          }

          clearBrowserFinishedTimeout();
          warnAuth('browser_finished_waiting_for_callback', {
            provider: pendingFlow.provider,
            status: pendingFlow.status,
          });
          const pendingFlowId = pendingFlow.id;

          browserFinishedTimeoutId = window.setTimeout(() => {
            browserFinishedTimeoutId = null;
            if (isDisposed) return;

            const latestPendingFlow = readPendingAuthFlow();
            if (!latestPendingFlow) return;
            if (latestPendingFlow.id !== pendingFlowId) return;
            if (
              latestPendingFlow.status === 'callback_received'
              || latestPendingFlow.status === 'session_restored'
            ) {
              return;
            }

            warnAuth('browser_finished_without_callback_after_grace', {
              provider: latestPendingFlow.provider,
              status: latestPendingFlow.status,
              graceMs: BROWSER_CANCEL_GRACE_MS,
            });
            clearPendingAuthFlow();
            setAuthFlowResult({
              type: 'cancelled',
              provider: latestPendingFlow.provider,
              message: 'Inicio de sesión cancelado.',
            });
          }, BROWSER_CANCEL_GRACE_MS);
        });
      } catch (error) {
        warnAuth('browser_listener_failed', {
          message: error?.message || String(error),
        });
      }

      try {
        logAuth('appUrlOpen_listener_ready');
        listenerHandle = await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
          logAuth('appUrlOpen_received', { url: String(url || '') });
          if (isDisposed) return;
          handleUrl(url);
        });
      } catch (error) {
        warnAuth('appUrlOpen_listener_failed', {
          message: error?.message || String(error),
        });
      }

      try {
        const launch = await CapacitorApp.getLaunchUrl();
        logAuth('app_launch_url', {
          url: launch?.url || null,
        });
        if (!isDisposed && launch?.url) {
          handleUrl(launch.url);
        }
      } catch (error) {
        warnAuth('app_launch_url_failed', {
          message: error?.message || String(error),
        });
      }
    })();

    return () => {
      isDisposed = true;
      clearBrowserFinishedTimeout();
      if (listenerHandle?.remove) {
        listenerHandle.remove();
      }
      if (browserHandle?.remove) {
        browserHandle.remove();
      }
    };
  }, []);

  return null;
}

// Wrapper para controlar la autenticación en la ruta principal
export function AppAuthWrapper() {
  const { user, loading, authResolved } = useAuth();
  const location = useLocation();
  const pendingAuthFlow = usePendingAuthFlow();
  const localEditMode = process.env.NODE_ENV === 'development' && process.env.REACT_APP_LOCAL_EDIT_MODE !== 'false';
  const shouldPassThroughWhileLoading = loading && process.env.NODE_ENV !== 'production';
  const isCompletingAuth = Boolean(!user && pendingAuthFlow);

  if (shouldPassThroughWhileLoading) {
    return <Outlet />;
  }

  if (isCompletingAuth) {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  // Local development shortcut: avoid external auth redirects while editing UI.
  if (localEditMode) {
    return <Outlet />;
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    setAuthReturnTo(returnTo);
    console.info('[AUTH] app_auth_wrapper_redirect_login', {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      returnTo,
      authResolved,
      loading,
    });
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Outlet />;
}

function LegacyTemplateRedirect() {
  const { templateId } = useParams();
  return <Navigate to={`/frecuentes/${templateId}`} replace />;
}

function LegacyTemplateHistoryRedirect() {
  const { templateId } = useParams();
  return <Navigate to={`/frecuentes/${templateId}/historial`} replace />;
}

function LegacyTeamDetailRedirect() {
  const { teamId } = useParams();
  return <Navigate to={`/desafios/equipos/${teamId}`} replace />;
}

function LegacyTeamChatRedirect() {
  const { teamId } = useParams();
  return <Navigate to={`/desafios/equipos/${teamId}/chat`} replace />;
}

function LegacyTeamMatchRedirect() {
  const { matchId } = useParams();
  return <Navigate to={`/desafios/equipos/partidos/${matchId}`} replace />;
}

function HealthRoute() {
  if (process.env.NODE_ENV !== 'development') {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
      <HealthCheck />
    </Suspense>
  );
}

function ScrollToTop() {
  useRouteScrollReset();
  return null;
}

function RouteAnalyticsTracker() {
  const location = useLocation();
  const lastTrackedRef = React.useRef('');

  React.useEffect(() => {
    const routeKey = `${location.pathname}${location.search}`;
    if (lastTrackedRef.current === routeKey) return;

    const match = location.pathname.match(
      /^\/(?:admin|partido|partido-publico|encuesta|resultados(?:-encuesta)?)\/(\d+)(?:\/invitacion)?$/,
    );
    if (!match) return;

    lastTrackedRef.current = routeKey;
    const matchId = Number(match[1]);
    track('view_match', {
      match_id: Number.isNaN(matchId) ? match[1] : matchId,
      path: location.pathname,
    });
  }, [location.pathname, location.search]);

  return null;
}
