import './HomeStyleKit.css';
import React, { useState, useEffect } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, useLocation, Outlet } from 'react-router-dom';
import { MODES, ADMIN_STEPS } from './constants';
import AmigosView from './components/AmigosView';
import { LOADING_STATES } from './appConstants';
import ErrorBoundary from './components/ErrorBoundary';
import AuthProvider, { useAuth } from './components/AuthProvider';
import DirectFix from './components/DirectFix';
import Button from './components/Button';
import LoadingSpinner from './components/LoadingSpinner';
import NetworkStatus from './components/NetworkStatus';
import TabBar from './components/TabBar';
import FifaHome from './FifaHome';
import SurveyManager from './components/SurveyManager';
import TestSurvey from './TestSurvey';
import EncuestaPartido from './pages/EncuestaPartido';
import ResultadosEncuesta from './pages/ResultadosEncuesta';

import VotingView from './VotingView';
import AdminPanel from './AdminPanel';
import FormularioNuevoPartidoFlow from './FormularioNuevoPartidoFlow';
import MainLayout from './components/MainLayout';

import PartidoInfoBox from './PartidoInfoBox';
import ListaPartidosFrecuentes from './ListaPartidosFrecuentes';
import EditarPartidoFrecuente from './EditarPartidoFrecuente';
import QuieroJugar from './QuieroJugar';
import ProfileEditor from './components/ProfileEditor';
import NotificationsView from './components/NotificationsView';
import PageTitle from './components/PageTitle';

import { NotificationProvider } from './context/NotificationContext';
import { TutorialProvider } from './context/TutorialContext';
import { BadgeProvider } from './context/BadgeContext';
import Tutorial from './components/Tutorial';
import WelcomeModal from './components/WelcomeModal';
import { getPartidoPorCodigo, getPartidoPorId, updateJugadoresPartido, crearPartidoDesdeFrec, updateJugadoresFrecuentes, getJugadoresDelPartido, refreshJugadoresPartido } from './supabase';
import IngresoAdminPartido from './IngresoAdminPartido';
import AuthPage from './components/AuthPage';
import ResetPassword from './components/ResetPassword';
import { useSurveyScheduler } from './hooks/useSurveyScheduler';
import matchScheduler from './services/matchScheduler';

const HomePage = () => {
  const location = useLocation();
  const [partidoActual, setPartidoActual] = useState(null);
  const [showVotingView, setShowVotingView] = useState(false);
  
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codigo = params.get('codigo');
    if (codigo) {
      console.log('[HOME_PAGE] Found codigo parameter:', codigo);
      setShowVotingView(true);
      getPartidoPorCodigo(codigo)
        .then((partido) => {
          console.log('[HOME_PAGE] Match found:', partido);
          setPartidoActual(partido);
        })
        .catch((error) => {
          console.error('[HOME_PAGE] Error loading match:', error);
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
  const navigate = useNavigate();
  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ maxWidth: 650 }}>
        <FormularioNuevoPartidoFlow
          onConfirmar={async (partido) => {
            console.log('[NUEVO_PARTIDO_PAGE] Match created, navigating to admin panel:', {
              matchId: partido.id,
              hasJugadores: !!partido.jugadores,
              jugadoresCount: partido.jugadores?.length || 0,
            });
            
            // Navegar al AdminPanel con el partido creado
            navigate(`/admin/${partido.id}`);
            return partido;
          }}
          onVolver={() => navigate('/')}
        />
      </div>
    </div>
  );
};

const QuieroJugarPage = () => {
  const navigate = useNavigate();
  return <QuieroJugar onVolver={() => navigate('/')} />;
};

const AmigosPage = () => {
  const navigate = useNavigate();
  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ maxWidth: 1200, padding: '20px' }}>
        <PageTitle onBack={() => navigate('/')}>AMIGOS</PageTitle>
        <AmigosView />
      </div>
    </div>
  );
};

const ProfilePage = () => {
  const navigate = useNavigate();
  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <PageTitle onBack={() => navigate('/')}>PERFIL</PageTitle>
        <ProfileEditor 
          isOpen={true} 
          onClose={() => navigate('/')} 
        />
      </div>
    </div>
  );
};

const NotificationsPage = () => {
  const navigate = useNavigate();
  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ maxWidth: 600, padding: '20px' }}>
        <PageTitle onBack={() => navigate('/')}>NOTIFICACIONES</PageTitle>
        <NotificationsView />
      </div>
    </div>
  );
};

const AdminPanelPage = () => {
  const navigate = useNavigate();
  const { partidoId } = useParams();
  const [partidoActual, setPartidoActual] = useState(null);
  const [jugadoresDelPartido, setJugadoresDelPartido] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargarPartido = async () => {
      try {
        console.log('[ADMIN_PANEL_PAGE] Loading match:', partidoId);
        const partido = await getPartidoPorId(partidoId);
        if (partido) {
          setPartidoActual(partido);
          
          // Cargar jugadores específicos del partido desde la tabla jugadores
          console.log('[ADMIN_PANEL_PAGE] Loading match players from jugadores table');
          const jugadores = await getJugadoresDelPartido(partidoId);
          console.log('[ADMIN_PANEL_PAGE] Match players loaded:', {
            count: jugadores.length,
            players: jugadores.map((j) => ({ nombre: j.nombre, uuid: j.uuid })),
          });
          setJugadoresDelPartido(jugadores);
          
          // Si no hay jugadores en la tabla jugadores pero sí en el partido, hacer refresh
          if (jugadores.length === 0 && partido.jugadores && partido.jugadores.length > 0) {
            console.log('[ADMIN_PANEL_PAGE] No players in jugadores table, but found in partido.jugadores, refreshing...');
            try {
              const refreshedPlayers = await refreshJugadoresPartido(partidoId);
              setJugadoresDelPartido(refreshedPlayers);
            } catch (refreshError) {
              console.error('[ADMIN_PANEL_PAGE] Error refreshing players:', refreshError);
            }
          }
        } else {
          toast.error('Partido no encontrado');
          navigate('/');
        }
      } catch (error) {
        console.error('[ADMIN_PANEL_PAGE] Error loading match:', error);
        toast.error('Error al cargar el partido');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    if (partidoId) {
      cargarPartido();
    }
  }, [partidoId, navigate]);

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
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ maxWidth: 650 }}>
        <AdminPanel
          partidoActual={partidoActual}
          jugadores={jugadoresDelPartido}
          onJugadoresChange={(nuevosJugadores) => {
            console.log('[ADMIN_PANEL_PAGE] Updating match players:', {
              matchId: partidoActual.id,
              newCount: nuevosJugadores.length,
            });
            handleJugadoresChange(nuevosJugadores);
            setJugadoresDelPartido(nuevosJugadores);
          }}
          onBackToHome={() => navigate('/')}
        />
      </div>
    </div>
  );
};

const HistorialPage = () => {
  const navigate = useNavigate();
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);
  const [step, setStep] = useState('list');
  
  if (step === 'edit' && partidoFrecuenteEditando) {
    return (
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
    );
  }
  
  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ maxWidth: 650 }}>
        <ListaPartidosFrecuentes
          onEntrar={async (partidoFrecuente) => {
            // Crear partido desde frecuente y navegar al AdminPanel
            try {
              const hoy = new Date().toISOString().split('T')[0];
              const partido = await crearPartidoDesdeFrec(partidoFrecuente, hoy);
              navigate(`/admin/${partido.id}`);
            } catch (error) {
              toast.error('Error al crear el partido');
            }
          }}
          onEditar={(partido) => {
            setPartidoFrecuenteEditando(partido);
            setStep('edit');
          }}
          onVolver={() => navigate('/')}
        />
      </div>
    </div>
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

function MainAppContent({ user }) {
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
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

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
            console.log('[MAIN_APP] Match created in admin flow:', {
              matchId: partido.id,
              hasJugadores: !!partido.jugadores,
              jugadoresCount: partido.jugadores?.length || 0,
            });
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

  const handleProfileClick = () => {
    setShowProfileEditor(true);
    setModo('profile');
  };

  return (
    <>
      <DirectFix />
      {content}
      {showTabBar && (
        <TabBar 
          activeTab={activeTab} 
          onTabChange={(tab) => {
            setModo(tab);
            setShowNotifications(false);
            setShowProfileEditor(false);
            if (tab === 'votacion') setStepPartido(ADMIN_STEPS.SELECT_TYPE);
          }} 
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BadgeProvider>
          <NotificationProvider>
            <TutorialProvider>
              <Router>
                <Routes>
                  <Route path="/test-survey" element={<TestSurvey />} />
                  <Route path="/test-survey/:partidoId/:userId" element={<TestSurvey />} />
                  <Route path="/encuesta/:partidoId" element={<EncuestaPartido />} />
                  <Route path="/resultados/:partidoId" element={<ResultadosEncuesta />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/" element={<AppAuthWrapper />}>
                    <Route path="" element={<MainLayout />}>
                        <Route index element={<HomePage />} />
                        <Route path="nuevo-partido" element={<NuevoPartidoPage />} />
                        <Route path="quiero-jugar" element={<QuieroJugarPage />} />
                        <Route path="amigos" element={<AmigosPage />} />
                        <Route path="profile" element={<ProfilePage />} />
                        <Route path="notifications" element={<NotificationsPage />} />
                        <Route path="historial" element={<HistorialPage />} />
                        <Route path="admin/:partidoId" element={<AdminPanelPage />} />
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
  );
}

// Wrapper para controlar la autenticación en la ruta principal
function AppAuthWrapper() {
  const { user } = useAuth();
  const location = useLocation();
  
  // Permitir acceso sin login si hay un código de partido (para votación)
  const params = new URLSearchParams(location.search);
  const codigo = params.get('codigo');
  
  if (!user && !codigo) {
    // Si no está logueado y no hay código, muestra login/register
    return <AuthPage />;
  }
  // Si está logueado o hay código de partido, muestra el outlet
  return <Outlet />;
}
