import './HomeStyleKit.css';
import React, { useState, useEffect } from "react";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { MODES, ADMIN_STEPS } from "./constants";
import { LOADING_STATES } from "./appConstants";
import ErrorBoundary from "./components/ErrorBoundary";
import AuthProvider from "./components/AuthProvider";
import Button from "./components/Button";
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import AdminPanel from "./AdminPanel";
import FormularioNuevoPartido from "./FormularioNuevoPartido";
import PartidoInfoBox from "./PartidoInfoBox";
import ListaPartidosFrecuentes from "./ListaPartidosFrecuentes";
import EditarPartidoFrecuente from "./EditarPartidoFrecuente";
import { getPartidoPorCodigo, updateJugadoresPartido, crearPartidoDesdeFrec, updateJugadoresFrecuentes } from "./supabase";
import { toast } from 'react-toastify';
import IngresoAdminPartido from "./IngresoAdminPartido";
const SeleccionarTipoPartido = ({ onNuevo, onExistente }) => (
  <div className="voting-bg">
    <div className="voting-modern-card">
      <div className="match-name" style={{ marginBottom: 16 }}>¿QUÉ QUERÉS HACER?</div>
      <button className="voting-confirm-btn wipe-btn" style={{marginBottom: 18}} onClick={onNuevo}>
        PARTIDO NUEVO
      </button>
      <button className="voting-confirm-btn wipe-btn" onClick={onExistente}>
        PARTIDO FRECUENTE
      </button>
    </div>
  </div>
);

export default function App() {

  const [modo, setModo] = useState(MODES.HOME);
  const [partidoActual, setPartidoActual] = useState(undefined);
  const [stepPartido, setStepPartido] = useState(ADMIN_STEPS.SELECT_TYPE);
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);

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

  if (modo === MODES.ADMIN) {
    if (stepPartido === ADMIN_STEPS.SELECT_TYPE) {
      return (
        <SeleccionarTipoPartido
          onNuevo={() => setStepPartido(ADMIN_STEPS.CREATE_MATCH)}
          onExistente={() => setStepPartido(ADMIN_STEPS.SELECT_FREQUENT)}
        />
      );
    }
    if (stepPartido === ADMIN_STEPS.CREATE_MATCH) {
      return (
        <FormularioNuevoPartido
          onConfirmar={async (partido) => {
            setPartidoActual(partido);
            setStepPartido(ADMIN_STEPS.MANAGE);
            return partido;
          }}
          onVolver={() => setStepPartido(ADMIN_STEPS.SELECT_TYPE)}
        />
      );
    }
    if (stepPartido === ADMIN_STEPS.SELECT_FREQUENT) {
      return (
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
    if (stepPartido === ADMIN_STEPS.EDIT_FREQUENT && partidoFrecuenteEditando) {
      return (
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

    if (stepPartido === ADMIN_STEPS.MANAGE && partidoActual) {
      return (
        <div className="voting-bg">
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
        </div>
      );
    }
    if (stepPartido === ADMIN_STEPS.MANAGE && !partidoActual) {
      setStepPartido(ADMIN_STEPS.SELECT_TYPE);
      return null;
    }
  }

  if (modo === MODES.HOME) return (
    <AuthProvider>
      <div className="voting-bg">
        <div className="voting-modern-card" style={{maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center"}}>
          <Home onModoSeleccionado={(m) => {
            setModo(m);
            if (m === MODES.ADMIN) setStepPartido(ADMIN_STEPS.SELECT_TYPE);
          }} />
        </div>
      </div>
    </AuthProvider>
  );

  if (modo === MODES.SIMPLE) return (
    <AuthProvider>
      <AppNormal onBack={() => setModo(MODES.HOME)} />
    </AuthProvider>
  );
  if (modo === MODES.VOTING) {
    setModo(MODES.ADMIN);
    return null;
  }
  if (modo === MODES.PLAYER) return (
    <div>
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
    </div>
  );

  return (
    <ErrorBoundary>
      <AuthProvider>
        <div className="voting-bg">
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
          </div>
        </div>
      </AuthProvider>
    </ErrorBoundary>
  );
}
