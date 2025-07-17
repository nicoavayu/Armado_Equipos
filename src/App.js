import './HomeStyleKit.css';
import React, { useState, useEffect } from "react";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { MODES, ADMIN_STEPS } from "./constants";
import { LOADING_STATES } from "./appConstants";
import ErrorBoundary from "./components/ErrorBoundary";
import AuthProvider from "./components/AuthProvider";
import DirectFix from "./components/DirectFix";
import Button from "./components/Button";
import NetworkStatus from "./components/NetworkStatus";
import TabBar from "./components/TabBar";
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import AdminPanel from "./AdminPanel";
import FormularioNuevoPartidoFlow from "./FormularioNuevoPartidoFlow";
import PartidoInfoBox from "./PartidoInfoBox";
import ListaPartidosFrecuentes from "./ListaPartidosFrecuentes";
import EditarPartidoFrecuente from "./EditarPartidoFrecuente";
import QuieroJugar from "./QuieroJugar";
import ProfileEditor from "./components/ProfileEditor";
import { getPartidoPorCodigo, updateJugadoresPartido, crearPartidoDesdeFrec, updateJugadoresFrecuentes } from "./supabase";
import { toast } from 'react-toastify';
import IngresoAdminPartido from "./IngresoAdminPartido";

const SeleccionarTipoPartido = ({ onNuevo, onExistente }) => (
  <div className="voting-bg content-with-tabbar">
    <div className="voting-modern-card">
      <div className="match-name" style={{ marginBottom: 24 }}>¿QUÉ QUERÉS HACER?</div>
      <button className="voting-confirm-btn wipe-btn" style={{marginBottom: 12}} onClick={onNuevo}>
        PARTIDO NUEVO
      </button>
      <button className="voting-confirm-btn wipe-btn" style={{marginBottom: 16}} onClick={onExistente}>
        PARTIDO FRECUENTE
      </button>
      {/* Botón de volver eliminado ya que ahora tenemos el TabBar */}
    </div>
  </div>
);

export default function App() {
  const [modo, setModo] = useState(MODES.HOME);
  const [partidoActual, setPartidoActual] = useState(undefined);
  const [stepPartido, setStepPartido] = useState(ADMIN_STEPS.SELECT_TYPE);
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get("codigo");
    if (codigo) {
      console.log('Loading match from URL code:', codigo);
      setModo(MODES.PLAYER); // Set player mode immediately
      getPartidoPorCodigo(codigo)
        .then(partido => {
          console.log('Match loaded successfully:', partido);
          setPartidoActual(partido);
        })
        .catch(error => {
          console.error('Error loading match from code:', error);
          // Keep in player mode but with null partido to show error
          setPartidoActual(null);
        });
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

  // Renderizar el contenido según el modo seleccionado
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
                setModo(MODES.HOME);
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
  else if (modo === MODES.HOME) {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center"}}>
          <Home onModoSeleccionado={(m) => {
            setModo(m);
            if (m === MODES.ADMIN) setStepPartido(ADMIN_STEPS.SELECT_TYPE);
          }} />
        </div>
      </div>
    );
  } else if (modo === 'simple') {
    content = <AppNormal onBack={() => setModo(MODES.HOME)} />;
  } else if (modo === 'votacion') {
    setModo(MODES.ADMIN);
    setStepPartido(ADMIN_STEPS.SELECT_TYPE);
    return null;
  } else if (modo === 'quiero-jugar') {
    content = <QuieroJugar onVolver={() => setModo(MODES.HOME)} />;
  } else if (modo === 'profile') {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card" style={{maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center"}}>
          <ProfileEditor 
            isOpen={true} 
            onClose={() => setModo(MODES.HOME)} 
          />
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
            setModo(MODES.HOME); 
            setPartidoActual(null);
            setPartidoFrecuenteEditando(null);
            setStepPartido(ADMIN_STEPS.SELECT_TYPE); 
          }}
        />
      </div>
    );
  }
  
  // Mostrar el TabBar en todos los modos
  showTabBar = true;

  if (modo === MODES.VOTING) {
    setModo(MODES.ADMIN);
    return null;
  }

  // Renderizado para modos no disponibles
  if (!content) {
    content = (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card">
          <div className="match-name">MODO NO DISPONIBLE</div>
          <div style={{color:"#fff", padding: "20px", fontSize: "18px", textAlign: "center"}}>
            El modo seleccionado no está disponible o ha ocurrido un error.
          </div>
          <Button
            onClick={() => setModo(MODES.HOME)}
            style={{marginTop: "34px", marginBottom: "0", width: '100%', maxWidth: '400px', fontSize: '1.5rem', height: '64px', borderRadius: '9px'}}
            ariaLabel="Volver al inicio"
          >
            VOLVER AL INICIO
          </Button>
        </div>
      </div>
    );
  }
  
  // Renderizado principal con TabBar
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DirectFix />
        {content}
        {showTabBar && (
          <TabBar 
            activeTab={activeTab} 
            onTabChange={(tab) => {
              setModo(tab);
              if (tab === 'votacion') setStepPartido(ADMIN_STEPS.SELECT_TYPE);
            }} 
          />
        )}
        <ToastContainer
          position="top-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
      </AuthProvider>
    </ErrorBoundary>
  );
}