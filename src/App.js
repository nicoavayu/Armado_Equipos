import './HomeStyleKit.css';
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, useLocation, Outlet } from 'react-router-dom';
import PageTransition from './components/PageTransition';
import { useAnimatedNavigation } from './hooks/useAnimatedNavigation';
import AmigosView from './components/AmigosView';

import ErrorBoundary from './components/ErrorBoundary';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import AuthProvider, { useAuth } from './components/AuthProvider';
import Button from './components/Button';
import LoadingSpinner from './components/LoadingSpinner';
import NetworkStatus from './components/NetworkStatus';
import FifaHome from './FifaHome';


const EncuestaPartido = lazy(() => import('./pages/EncuestaPartido'));
const ResultadosEncuestaView = lazy(() => import('./pages/ResultadosEncuestaView'));
const HealthCheck = lazy(() => import('./pages/HealthCheck'));

import VotingView from './VotingView';
const AdminPanel = lazy(() => import('./AdminPanel'));
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';
import MainLayout from './components/MainLayout';


import ListaPartidosFrecuentes from './ListaPartidosFrecuentes';
import EditarPartidoFrecuente from './EditarPartidoFrecuente';
import QuieroJugar from './QuieroJugar';
import ProfileEditor from './components/ProfileEditor';
import NotificationsView from './components/NotificationsView';
import StatsView from './components/StatsView';
import PageTitle from './components/PageTitle';

import { NotificationProvider } from './context/NotificationContext';
import { TutorialProvider } from './context/TutorialContext';
import { BadgeProvider } from './context/BadgeContext';

import { getPartidoPorCodigo, getPartidoPorId, updateJugadoresPartido, crearPartidoDesdeFrec, updateJugadoresFrecuentes, getJugadoresDelPartido, refreshJugadoresPartido } from './supabase';

import AuthPage from './components/AuthPage';
import ResetPassword from './components/ResetPassword';

// Dev-only diagnostics (excluded in production builds)
if (process.env.NODE_ENV === 'development') {
  try { require('./utils/testNotificationsView'); } catch {}
  try { require('./utils/testNotifications'); } catch {}
  try { require('./utils/debugProximosPartidos'); } catch {}
}

const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [partidoActual, setPartidoActual] = useState(null);
  const [showVotingView, setShowVotingView] = useState(false);
  
  // (Se eliminó el indicador de versión)
  
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codigo = params.get('codigo');
    if (codigo) {

      setShowVotingView(true);
      getPartidoPorCodigo(codigo)
        .then((partido) => {

          setPartidoActual(partido);
        })
        .catch((error) => {
          console.error('Error loading match:', error);
          setPartidoActual(null);
        });
    } else {
      setShowVotingView(false);
      setPartidoActual(null);
    }
  }, [location.search]);
  
  if (showVotingView) {
    return (
      <div className="content-with-tabbar">
        <NetworkStatus />
        <VotingView
          jugadores={partidoActual ? partidoActual.jugadores : []}
          partidoActual={partidoActual}
          onReset={() => { 
            setShowVotingView(false);
            setPartidoActual(null);
            // Navegar al home limpio
            navigate('/');
          }}
        />
      </div>
    );
  }
  
  return (
    <>
      {/* Indicador de versión removido */}
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 0 }}>
          <FifaHome onModoSeleccionado={(modo) => {
            if (modo === 'admin-historial') {
              // Navegar directamente a la lista de partidos frecuentes
              navigate('/?admin=historial');
            }
          }} />
        </div>
      </div>
    </>
  );
};

const NuevoPartidoPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <PageTransition>
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 650 }}>
          <FormularioNuevoPartidoFlow
            onConfirmar={async (partido) => {
              console.log('Match created:', partido.id);
              navigateWithAnimation(`/admin/${partido.id}`);
              return partido;
            }}
            onVolver={() => navigateWithAnimation('/', 'back')}
          />
        </div>
      </div>
    </PageTransition>
  );
};

const QuieroJugarPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <PageTransition>
      <QuieroJugar onVolver={() => navigateWithAnimation('/', 'back')} />
    </PageTransition>
  );
};

const AmigosPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <PageTransition>
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 1200, padding: '20px' }}>
          <PageTitle onBack={() => navigateWithAnimation('/', 'back')}>AMIGOS</PageTitle>
          <AmigosView />
        </div>
      </div>
    </PageTransition>
  );
};

const ProfilePage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  
  return (
    <PageTransition>
      <div className="voting-bg content-with-tabbar" style={{ padding: '0' }}>
        <PageTitle onBack={() => navigateWithAnimation('/', 'back')}>EDITAR PERFIL</PageTitle>
        
        <ProfileEditor 
          isOpen={true} 
          onClose={() => navigateWithAnimation('/', 'back')}
          isEmbedded={true}
        />
      </div>
    </PageTransition>
  );
};

const NotificationsPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <PageTransition>
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 600, padding: '20px' }}>
          <PageTitle onBack={() => navigateWithAnimation('/', 'back')}>NOTIFICACIONES</PageTitle>
          <NotificationsView />
        </div>
      </div>
    </PageTransition>
  );
};

const StatsPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  return (
    <PageTransition>
      <StatsView onVolver={() => navigateWithAnimation('/', 'back')} />
    </PageTransition>
  );
};

const AdminPanelPage = () => {
  const navigate = useNavigate();
  const { navigateWithAnimation } = useAnimatedNavigation();
  const { partidoId } = useParams();
  const { user } = useAuth();
  const [partidoActual, setPartidoActual] = useState(null);
  const [jugadoresDelPartido, setJugadoresDelPartido] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.has('codigo')) return;
    
    const cargarPartido = async () => {
      try {
        const partido = await getPartidoPorId(partidoId);
        if (partido) {
          setPartidoActual(partido);
          
          const jugadores = await getJugadoresDelPartido(partidoId);
          setJugadoresDelPartido(jugadores);
          
          if (jugadores.length === 0 && partido.jugadores && partido.jugadores.length > 0) {
            console.log('Refreshing players for match:', partidoId);
            try {
              const refreshedPlayers = await refreshJugadoresPartido(partidoId);
              setJugadoresDelPartido(refreshedPlayers);
            } catch (refreshError) {
              console.error('Error refreshing players:', refreshError);
            }
          }
        } else {
          toast.error('Partido no encontrado');
          navigate('/');
        }
      } catch (error) {
        console.error('Error loading match:', error);
        toast.error('Error al cargar el partido');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    if (partidoId) {
      cargarPartido();
    }
  }, [partidoId, navigate, user]);

  const handleJugadoresChange = async (nuevosJugadores) => {
    if (!partidoActual) return;
    await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
    setPartidoActual({ ...partidoActual, jugadores: nuevosJugadores });
    if (partidoActual.from_frequent_match_id) {
      try {
        await updateJugadoresFrecuentes(partidoActual.from_frequent_match_id, nuevosJugadores);
      } catch (error) {
        toast.error('Error actualizando partido frecuente');
      }
    }
  };

  if (loading) {
    return (
      <div className="voting-bg content-with-tabbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (!partidoActual) {
    return (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card">
          <div className="match-name">PARTIDO NO ENCONTRADO</div>
          <Button onClick={() => navigate('/')}>VOLVER AL INICIO</Button>
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 650 }}>
          <AdminPanel
            partidoActual={partidoActual}
            jugadores={jugadoresDelPartido}
            onJugadoresChange={(nuevosJugadores) => {
              console.log('Players changed:', nuevosJugadores.length);
              handleJugadoresChange(nuevosJugadores);
              setJugadoresDelPartido(nuevosJugadores);
            }}
            onBackToHome={() => navigateWithAnimation('/', 'back')}
          />
        </div>
      </div>
    </PageTransition>
  );
};

const HistorialPage = () => {
  const { navigateWithAnimation } = useAnimatedNavigation();
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);
  const [step, setStep] = useState('list');
  
  if (step === 'edit' && partidoFrecuenteEditando) {
    return (
      <PageTransition>
        <div className="voting-bg content-with-tabbar">
          <div className="voting-modern-card" style={{ maxWidth: 650 }}>
            <EditarPartidoFrecuente
              partido={partidoFrecuenteEditando}
              onGuardado={() => {
                setPartidoFrecuenteEditando(null);
                setStep('list');
              }}
              onVolver={() => {
                setPartidoFrecuenteEditando(null);
                setStep('list');
              }}
            />
          </div>
        </div>
      </PageTransition>
    );
  }
  
  return (
    <PageTransition>
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 650 }}>
          <ListaPartidosFrecuentes
            onEntrar={async (partidoFrecuente) => {
              try {
                const hoy = new Date().toISOString().split('T')[0];
                const partido = await crearPartidoDesdeFrec(partidoFrecuente, hoy);
                navigateWithAnimation(`/admin/${partido.id}`);
              } catch (error) {
                toast.error('Error al crear el partido');
              }
            }}
            onEditar={(partido) => {
              setPartidoFrecuenteEditando(partido);
              setStep('edit');
            }}
            onVolver={() => navigateWithAnimation('/', 'back')}
          />
        </div>
      </div>
    </PageTransition>
  );
};


// AppWithSchedulers eliminado: procesamiento de notificaciones debe vivir en backend/DB

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
                    <Suspense fallback={<div className="voting-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><LoadingSpinner size="large" /></div>}>
                      <HealthCheck />
                    </Suspense>
                  } />
                  <Route path="/encuesta/:partidoId" element={
                    <Suspense fallback={<div className="voting-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><LoadingSpinner size="large" /></div>}>
                      <EncuestaPartido />
                    </Suspense>
                  } />
                  <Route path="/resultados-encuesta/:partidoId" element={
                    <Suspense fallback={<div className="voting-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><LoadingSpinner size="large" /></div>}>
                      <ResultadosEncuestaView />
                    </Suspense>
                  } />
                  <Route path="/resultados/:partidoId" element={
                    <Suspense fallback={<div className="voting-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><LoadingSpinner size="large" /></div>}>
                      <ResultadosEncuestaView />
                    </Suspense>
                  } />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/" element={<AppAuthWrapper />}>
                    <Route path="" element={<MainLayout />}>
                      <Route index element={<HomePage />} />
                      <Route path="nuevo-partido" element={<NuevoPartidoPage />} />
                      <Route path="quiero-jugar" element={<QuieroJugarPage />} />
                      <Route path="amigos" element={<AmigosPage />} />
                      <Route path="profile" element={<ProfilePage />} />
                      <Route path="notifications" element={<NotificationsPage />} />
                      <Route path="stats" element={<StatsPage />} />
                      <Route path="historial" element={<HistorialPage />} />
                      <Route path="admin/:partidoId" element={
                        <Suspense fallback={<div className="voting-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><LoadingSpinner size="large" /></div>}>
                          <AdminPanelPage />
                        </Suspense>
                      } />
                      <Route path="partido/:partidoId" element={
                        <Suspense fallback={<div className="voting-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><LoadingSpinner size="large" /></div>}>
                          <AdminPanelPage />
                        </Suspense>
                      } />
                    </Route>
                  </Route>
                  </Routes>
                  <ToastContainer position="top-right" autoClose={5000} />
                </Router>
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
