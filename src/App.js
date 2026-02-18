// import './HomeStyleKit.css'; // Removed in Tailwind migration
import React, { lazy, Suspense } from 'react';
import { ToastContainer } from 'react-toastify';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams, Outlet } from 'react-router-dom';
import { installGlobalToastPolicy } from './lib/toastPolicy';

import ErrorBoundary from './components/ErrorBoundary';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import AuthProvider, { useAuth } from './components/AuthProvider';
import LoadingSpinner from './components/LoadingSpinner';
// NotificationsDebugPanel removed

import MainLayout from './components/MainLayout';
import AuthPage from './components/AuthPage';
import { setAuthReturnTo } from './utils/authReturnTo';
import ResetPassword from './components/ResetPassword'; // Import corrected


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
const EmailMagicLinkLogin = lazy(() => import('./components/EmailMagicLinkLogin'));
const AuthCallback = lazy(() => import('./components/AuthCallback'));
const InviteLanding = lazy(() => import('./components/InviteLanding'));

const HomePage = lazy(() => import('./pages/HomePage'));
const NuevoPartidoPage = lazy(() => import('./pages/NuevoPartidoPage'));
const QuieroJugarPage = lazy(() => import('./pages/QuieroJugarPage'));
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

installGlobalToastPolicy();

export default function App() {
  return (
    <GlobalErrorBoundary>
      <ErrorBoundary>
        <AuthProvider>
          <BadgeProvider>
            <NotificationProvider>
              <Router>
                <ScrollToTop />
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
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/login" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <AuthHome />
                    </Suspense>
                  } />
                  <Route path="/login/password" element={<PasswordLoginRoute />} />
                  <Route path="/login/email" element={
                    <Suspense fallback={<div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                      <EmailMagicLinkLogin />
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
                <ToastContainer
                  position="top-right"
                  autoClose={5000}
                  newestOnTop
                  limit={3}
                />
              </Router>
              {/* Debug panel removed */}
            </NotificationProvider>
          </BadgeProvider>
        </AuthProvider>
      </ErrorBoundary>
    </GlobalErrorBoundary>
  );
}

// Wrapper para controlar la autenticación en la ruta principal
function AppAuthWrapper() {
  const { user } = useAuth();
  const location = useLocation();

  // Permitir acceso sin login si hay un código de partido (para votación)
  const search = new URLSearchParams(location.search);
  const isVotingView = search.has('codigo');

  if (isVotingView) {
    console.debug('[RouteGuard] allowVotingView');
    return <Outlet />;
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    setAuthReturnTo(returnTo);
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

function PasswordLoginRoute() {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocalhost) {
    return <Navigate to="/login" replace />;
  }
  return <AuthPage />;
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
  const location = useLocation();

  React.useEffect(() => {
    const reset = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    requestAnimationFrame(reset);
  }, [location.pathname, location.search]);

  return null;
}
