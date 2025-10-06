import './HomeStyleKit.css';
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, useLocation, Outlet } from 'react-router-dom';
import PageTransition from './components/PageTransition';
import { useAnimatedNavigation } from './hooks/useAnimatedNavigation';
import { MODES, ADMIN_STEPS } from './constants';
import AmigosView from './components/AmigosView';

import ErrorBoundary from './components/ErrorBoundary';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import AuthProvider, { useAuth } from './components/AuthProvider';
import DirectFix from './components/DirectFix';
import Button from './components/Button';
import LoadingSpinner from './components/LoadingSpinner';
import NetworkStatus from './components/NetworkStatus';
import TabBar from './components/TabBar';
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
import { useSurveyScheduler } from './hooks/useSurveyScheduler';
import matchScheduler from './services/matchScheduler';
import { supabase } from './supabase';
import { useNotifications } from './context/NotificationContext';
import { forceSurveyResultsNow } from './services/notificationService';
import { toBigIntId } from './utils';
import './utils/testNotificationsView';
import './utils/testNotifications';
import './utils/debugProximosPartidos';

const HomePage = () => {
  const location = useLocation();
  const [partidoActual, setPartidoActual] = useState(null);
  const [showVotingView, setShowVotingView] = useState(false);
  
  // Version indicator for deployment verification
  const VERSION = 'v1.2.4';
  
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
            window.location.href = '/';
          }}
        />
      </div>
    );
  }
  
  return (
    <>
      <div style={{ position: 'fixed', top: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', zIndex: 9999 }}>
        {VERSION}
      </div>
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 0 }}>
          <FifaHome onModoSeleccionado={(modo) => {
            if (modo === 'admin-historial') {
              // Navegar directamente a la lista de partidos frecuentes
              window.location.href = '/?admin=historial';
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

const SeleccionarTipoPartido = ({ onNuevo, onExistente }) => (
  <div className="voting-bg content-with-tabbar">
    <div className="voting-modern-card">
      <div className="match-name" style={{ marginBottom: 24 }}>ARMAR EQUIPOS</div>
      <button className="voting-confirm-btn" style={{ marginBottom: 12, background: '#8178e5', borderRadius: '50px' }} onClick={onNuevo}>
        ARMAR PARTIDO NUEVO
      </button>
      <button className="voting-confirm-btn" style={{ marginBottom: 16, background: '#8178e5', borderRadius: '50px' }} onClick={onExistente}>
        HISTORIAL
      </button>
    </div>
  </div>
);

function _MainAppContent({ _user }) {
  useSurveyScheduler();
  
  // Initialize match scheduler
  useEffect(() => {
    matchScheduler.start();
    matchScheduler.loadActiveMatches();
    
    return () => {
      matchScheduler.stop();
    };
  }, []);
  
  const [modo, setModo] = useState('home');
  const [partidoActual, setPartidoActual] = useState(undefined);
  const [stepPartido, setStepPartido] = useState(ADMIN_STEPS.SELECT_TYPE);
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get('codigo');
    if (codigo) {
      setModo(MODES.PLAYER);
      getPartidoPorCodigo(codigo)
        .then((partido) => setPartidoActual(partido))
        .catch(() => setPartidoActual(null));
    }
  }, []);

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

  let content;
  let showTabBar = true;
  let activeTab = modo;

  if (modo === MODES.ADMIN) {
    activeTab = 'votacion';
    if (stepPartido === ADMIN_STEPS.SELECT_TYPE) {
      content = (
        <SeleccionarTipoPartido
          onNuevo={() => setStepPartido(ADMIN_STEPS.CREATE_MATCH)}
          onExistente={() => setStepPartido(ADMIN_STEPS.SELECT_FREQUENT)}
        />
      );
    }
    else if (stepPartido === ADMIN_STEPS.CREATE_MATCH) {
      content = (
        <FormularioNuevoPartidoFlow
          onConfirmar={async (partido) => {
            console.log('Match created from flow:', partido.id);
            setPartidoActual(partido);
            setStepPartido(ADMIN_STEPS.MANAGE);
            return partido;
          }}
          onVolver={() => setStepPartido(ADMIN_STEPS.SELECT_TYPE)}
        />
      );
    }
    else if (stepPartido === ADMIN_STEPS.SELECT_FREQUENT) {
      content = (
        <ListaPartidosFrecuentes
          onEntrar={async (partidoFrecuente) => {
            try {
              const hoy = new Date().toISOString().split('T')[0];
              const partido = await crearPartidoDesdeFrec(partidoFrecuente, hoy);
              partido.from_frequent_match_id = partidoFrecuente.id;
              setPartidoActual(partido);
              setStepPartido(ADMIN_STEPS.MANAGE);
            } catch (error) {
              toast.error('Error al crear el partido');
            }
          }}
          onEditar={(partido) => {
            setPartidoFrecuenteEditando(partido);
            setStepPartido(ADMIN_STEPS.EDIT_FREQUENT);
          }}
          onVolver={() => setStepPartido(ADMIN_STEPS.SELECT_TYPE)}
        />
      );
    }
    else if (stepPartido === ADMIN_STEPS.EDIT_FREQUENT && partidoFrecuenteEditando) {
      content = (
        <EditarPartidoFrecuente
          partido={partidoFrecuenteEditando}
          onGuardado={() => {
            setPartidoFrecuenteEditando(null);
            setStepPartido(ADMIN_STEPS.SELECT_FREQUENT);
          }}
          onVolver={() => {
            setPartidoFrecuenteEditando(null);
            setStepPartido(ADMIN_STEPS.SELECT_FREQUENT);
          }}
        />
      );
    }
    else if (stepPartido === ADMIN_STEPS.MANAGE && partidoActual) {
      content = (
        <div className="voting-bg content-with-tabbar">
          <div className="voting-modern-card" style={{ maxWidth: 650 }}>
            <AdminPanel
              partidoActual={partidoActual}
              jugadores={partidoActual?.jugadores || []}
              onJugadoresChange={handleJugadoresChange}
              onBackToHome={() => {
                setModo('home');
                setPartidoActual(null);
                setPartidoFrecuenteEditando(null);
                setStepPartido(ADMIN_STEPS.SELECT_TYPE);
              }}
            />
          </div>
        </div>
      );
    }
    else if (stepPartido === ADMIN_STEPS.MANAGE && !partidoActual) {
      setStepPartido(ADMIN_STEPS.SELECT_TYPE);
      return null;
    }
  }
  else if (modo === 'home') {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 0 }}>
          <FifaHome onModoSeleccionado={(m, tab) => {
            setModo(m);
            if (m === MODES.ADMIN) setStepPartido(ADMIN_STEPS.SELECT_TYPE);
            if (m === 'quiero-jugar' && tab) {
              sessionStorage.setItem('quiero-jugar-tab', tab);
            }
          }} />
        </div>
      </div>
    );
  } else if (modo === 'votacion') {
    setModo(MODES.ADMIN);
    setStepPartido(ADMIN_STEPS.SELECT_TYPE);
    return null;
  } else if (modo === 'quiero-jugar') {
    content = <QuieroJugar onVolver={() => setModo(MODES.HOME)} />;
  } else if (modo === 'profile') {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <PageTitle onBack={() => setModo('home')}>PERFIL</PageTitle>
          <ProfileEditor 
            isOpen={true} 
            onClose={() => setModo('home')} 
          />
        </div>
      </div>
    );
  } else if (modo === 'notifications') {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 600, padding: '20px' }}>
          <PageTitle onBack={() => setModo('home')}>NOTIFICACIONES</PageTitle>
          <NotificationsView />
        </div>
      </div>
    );
  } else if (modo === 'amigos') {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{ maxWidth: 1200, padding: '20px' }}>
          <PageTitle onBack={() => setModo('home')}>AMIGOS</PageTitle>
          <AmigosView />
        </div>
      </div>
    );
  } else if (modo === MODES.PLAYER) {
    activeTab = 'quiero-jugar';
    content = (
      <div className="content-with-tabbar">
        <NetworkStatus />
        <VotingView
          jugadores={partidoActual ? partidoActual.jugadores : []}
          partidoActual={partidoActual}
          onReset={() => { 
            setModo('home'); 
            setPartidoActual(null);
            setPartidoFrecuenteEditando(null);
            setStepPartido(ADMIN_STEPS.SELECT_TYPE);
          }}
        />
      </div>
    );
  }

  if (!content) {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card">
          <div className="match-name">MODO NO DISPONIBLE</div>
          <div style={{ color:'#fff', padding: '20px', fontSize: '18px', textAlign: 'center' }}>
            El modo seleccionado no está disponible o ha ocurrido un error.
          </div>
          <Button
            onClick={() => setModo('home')}
            style={{ marginTop: '34px', marginBottom: '0', width: '100%', maxWidth: '400px', fontSize: '1.5rem', height: '64px', borderRadius: '9px' }}
            ariaLabel="Volver al inicio"
          >
            VOLVER AL INICIO
          </Button>
        </div>
      </div>
    );
  }



  return (
    <>
      <DirectFix />
      {content}
      {showTabBar && (
        <TabBar 
          activeTab={activeTab} 
          onTabChange={(tab) => {
            setModo(tab);
            console.log('Tab changed to:', tab);
            if (tab === 'votacion') {
              setStepPartido(ADMIN_STEPS.SELECT_TYPE);
            }
          }} 
        />
      )}
    </>
  );
}

// Hook de notificaciones integrado directamente
function AppWithSchedulers() {
  const { createNotification } = useNotifications();

  useEffect(() => {
    let timer = null;

    const qs = new URLSearchParams(window.location.search);
    const FAST = qs.get('fastResults') === '1' || localStorage.getItem('SURVEY_RESULTS_TEST_FAST') === '1';

    async function tick() {
      try {
        console.log('[Scheduler] run FAST=', FAST, 'at', new Date().toISOString());
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('status', 'pending')
          .lte('send_at', new Date().toISOString())
          .limit(20);

        if (!error && data && data.length) {
          for (const notif of data) {
            if (notif.type === 'survey_results_ready') {
              await supabase
                .from('survey_results')
                .update({ results_ready: true, updated_at: new Date().toISOString() })
                .eq('partido_id', notif.partido_id);

              const { data: jugadores, error: jErr } = await supabase
                .from('jugadores')
                .select('usuario_id')
                .eq('partido_id', notif.partido_id);

              const nowIso = new Date().toISOString();
              const rows = (jugadores || [])
                .filter(j => j.usuario_id)
                .map(j => ({
                  user_id: j.usuario_id,
                  type: 'survey_results_ready',
                  title: 'Resultados listos',
                  message: 'Los resultados de la encuesta ya están listos.',
                  data: { matchId: toBigIntId(notif.partido_id) },
                  read: false,
                  created_at: nowIso,
                }));
              if (rows.length) {
                console.log('[SURVEY RESULTS NOTIFICATIONS] payload:', rows);
                await supabase.from('notifications').insert(rows);
              }

              await supabase.from('notifications').update({ status: 'sent' }).eq('id', notif.id);
            } else {
              await supabase
                .from('notifications')
                .update({ status: 'sent' })
                .eq('id', notif.id);
            }
          }
        }
      } catch (error) {
        console.error('Error processing notifications:', error);
      }
    }

    timer = setInterval(tick, FAST ? 5000 : 60000);
    tick();

    return () => clearInterval(timer);
  }, [createNotification]);

  // === TEST: helper global para forzar resultados ahora ===
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__forceResultsNowResults = async (matchId) => {
        const id = toBigIntId ? toBigIntId(matchId) : Number(matchId);
        const res = await forceSurveyResultsNow(id);
        console.log('[TEST] forceSurveyResultsNow →', res);
        return res;
      };
    }
  }, []);

  return null;
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
                  <AppWithSchedulers />
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
