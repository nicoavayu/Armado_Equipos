// import './HomeStyleKit.css'; // Removed in Tailwind migration
import React, { lazy, Suspense } from 'react';
import { ToastContainer } from 'react-toastify';
import { BrowserRouter as Router, Routes, Route, useLocation, Outlet } from 'react-router-dom';

import ErrorBoundary from './components/ErrorBoundary';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import AuthProvider, { useAuth } from './components/AuthProvider';
import LoadingSpinner from './components/LoadingSpinner';
// NotificationsDebugPanel removed

import MainLayout from './components/MainLayout';
import AuthPage from './components/AuthPage';
import ResetPassword from './components/ResetPassword'; // Import corrected


import { NotificationProvider } from './context/NotificationContext';
import { TutorialProvider } from './context/TutorialContext';
import { BadgeProvider } from './context/BadgeContext';

// Lazy load pages
const EncuestaPartido = lazy(() => import('./pages/EncuestaPartido'));
const ResultadosEncuestaView = lazy(() => import('./pages/ResultadosEncuestaView'));
const HealthCheck = lazy(() => import('./pages/HealthCheck'));

const HomePage = lazy(() => import('./pages/HomePage'));
const NuevoPartidoPage = lazy(() => import('./pages/NuevoPartidoPage'));
const QuieroJugarPage = lazy(() => import('./pages/QuieroJugarPage'));
const AmigosPage = lazy(() => import('./pages/AmigosPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const HistorialPage = lazy(() => import('./pages/HistorialPage'));
const TemplateDetailsPage = lazy(() => import('./pages/TemplateDetailsPage'));
const TemplateHistoryPage = lazy(() => import('./pages/TemplateHistoryPage'));
const AdminPanelPage = lazy(() => import('./pages/AdminPanelPage'));

// Dev-only diagnostics (excluded in production builds)
if (process.env.NODE_ENV === 'development') {
  try { require('./utils/testNotificationsView'); } catch { }
  try { require('./utils/testNotifications'); } catch { }
  try { require('./utils/debugProximosPartidos'); } catch { }
}

export default function App() {
  return (
    <GlobalErrorBoundary>
      <ErrorBoundary>
        <AuthProvider>
          <BadgeProvider>
            <NotificationProvider>
              <TutorialProvider>
                <Router>
                  <Routes>
                    <Route path="/health" element={
                      <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                        <HealthCheck />
                      </Suspense>
                    } />
                    <Route path="/encuesta/:partidoId" element={
                      <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                        <EncuestaPartido />
                      </Suspense>
                    } />
                    <Route path="/resultados-encuesta/:partidoId" element={
                      <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                        <ResultadosEncuestaView />
                      </Suspense>
                    } />
                    <Route path="/resultados/:partidoId" element={
                      <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                        <ResultadosEncuestaView />
                      </Suspense>
                    } />
                    <Route path="/reset-password" element={<ResetPassword />} />

                    <Route path="/" element={<AppAuthWrapper />}>
                      <Route path="" element={<MainLayout />}>
                        <Route index element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <HomePage />
                          </Suspense>
                        } />
                        <Route path="nuevo-partido" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <NuevoPartidoPage />
                          </Suspense>
                        } />
                        <Route path="quiero-jugar" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <QuieroJugarPage />
                          </Suspense>
                        } />
                        <Route path="amigos" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <AmigosPage />
                          </Suspense>
                        } />
                        <Route path="profile" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <ProfilePage />
                          </Suspense>
                        } />
                        <Route path="notifications" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <NotificationsPage />
                          </Suspense>
                        } />
                        <Route path="stats" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <StatsPage />
                          </Suspense>
                        } />
                        <Route path="historial" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <HistorialPage />
                          </Suspense>
                        } />
                        <Route path="historial/:templateId" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <TemplateDetailsPage />
                          </Suspense>
                        } />
                        <Route path="historial/:templateId/historial" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <TemplateHistoryPage />
                          </Suspense>
                        } />
                        <Route path="admin/:partidoId" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <AdminPanelPage />
                          </Suspense>
                        } />
                        <Route path="partido/:partidoId" element={
                          <Suspense fallback={<div className="min-h-screen w-screen bg-fifa-gradient flex items-center justify-center"><LoadingSpinner size="large" /></div>}>
                            <AdminPanelPage />
                          </Suspense>
                        } />
                      </Route>
                    </Route>
                  </Routes>
                  <ToastContainer position="top-right" autoClose={5000} />
                </Router>
                {/* Debug panel removed */}
              </TutorialProvider>
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
    return <AuthPage />;
  }

  return <Outlet />;
}
