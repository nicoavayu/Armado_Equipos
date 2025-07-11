import './HomeStyleKit.css';
import React, { useState, useEffect } from "react";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { MODES, ADMIN_STEPS } from "./constants";
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import AdminPanel from "./AdminPanel";
import FormularioNuevoPartido from "./FormularioNuevoPartido";
import PartidoInfoBox from "./PartidoInfoBox";
import ListaPartidosFrecuentes from "./ListaPartidosFrecuentes";
import EditarPartidoFrecuente from "./EditarPartidoFrecuente";
import { crearPartido, getPartidoPorCodigo, updateJugadoresPartido } from "./supabase";
import IngresoAdminPartido from "./IngresoAdminPartido";

const SeleccionarTipoPartido = ({ onNuevo, onExistente }) => (
  <div className="voting-bg">
    <div className="voting-modern-card">
      <div className="voting-title-modern" style={{marginBottom: 16}}>¿QUÉ QUERÉS HACER?</div>
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
  const [partidoActual, setPartidoActual] = useState(null);
  const [stepPartido, setStepPartido] = useState(ADMIN_STEPS.SELECT_TYPE);
  const [showIngresoAdmin, setShowIngresoAdmin] = useState(false);
  const [partidoFrecuenteEditando, setPartidoFrecuenteEditando] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get("codigo");
    if (codigo) {
      getPartidoPorCodigo(codigo)
        .then(partido => {
          setPartidoActual(partido);
          setModo(MODES.PLAYER);
        })
        .catch(() => setModo(MODES.HOME));
    }
  }, []);

  const handleJugadoresChange = async (nuevosJugadores) => {
    if (!partidoActual) return;
    await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
    setPartidoActual({ ...partidoActual, jugadores: nuevosJugadores });
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
          onConfirmar={async (data) => {
            try {
              const partido = await crearPartido(data);
              if (!partido) throw new Error("No se pudo crear el partido. Intenta nuevamente.");
              setPartidoActual(partido);
              setStepPartido(ADMIN_STEPS.MANAGE);
              return partido;
            } catch (error) {
              console.error("Error creating match:", error);
              throw error;
            }
          }}
        />
      );
    }
    if (stepPartido === ADMIN_STEPS.SELECT_FREQUENT) {
      return (
        <ListaPartidosFrecuentes
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
          onPartidoCreado={(partido) => {
            setPartidoActual(partido);
            setPartidoFrecuenteEditando(null);
            setStepPartido(ADMIN_STEPS.MANAGE);
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
        </div>
      );
    }
    if (stepPartido === ADMIN_STEPS.MANAGE && !partidoActual) {
      setStepPartido(ADMIN_STEPS.SELECT_TYPE);
      return null;
    }
  }

  // HOME: el botón ahora está más arriba, con aire.
  if (modo === MODES.HOME) return (
    <div className="voting-bg">
      <div className="voting-modern-card" style={{maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center"}}>
        <Home onModoSeleccionado={(m) => {
          setModo(m);
          if (m === MODES.ADMIN) setStepPartido(ADMIN_STEPS.SELECT_TYPE);
        }} />
        {/* Ajustá marginTop según prefieras (ej: 36, 44, 56) */}
        <button
          className="voting-confirm-btn wipe-btn"
          style={{marginTop: -150, width: "100%"}}
          onClick={() => setShowIngresoAdmin(true)}
        >
          ADMIN. PARTIDO
        </button>
      </div>
      {showIngresoAdmin && (
        <IngresoAdminPartido
          onAcceder={(partido) => {
            setPartidoActual(partido);
            setModo(MODES.ADMIN);
            setStepPartido(ADMIN_STEPS.MANAGE);
            setShowIngresoAdmin(false);
          }}
          onCancelar={() => setShowIngresoAdmin(false)}
        />
      )}
    </div>
  );

  if (modo === MODES.SIMPLE) return <AppNormal onBack={() => setModo(MODES.HOME)} />;
  if (modo === MODES.VOTING) {
    setModo(MODES.ADMIN);
    return null;
  }
  if (modo === MODES.PLAYER) return (
    <VotingView
      jugadores={partidoActual ? partidoActual.jugadores : []}
      onReset={() => { 
        setModo(MODES.HOME); 
        setPartidoActual(null);
        setPartidoFrecuenteEditando(null);
        setStepPartido(ADMIN_STEPS.SELECT_TYPE); 
      }}
    />
  );

  return (
    <div className="voting-bg">
      <div className="voting-modern-card">
        <div className="voting-title-modern">MODO NO DISPONIBLE</div>
        <div style={{color:"#fff", padding: "20px", fontSize: "18px", textAlign: "center"}}>
          El modo seleccionado no está disponible o ha ocurrido un error.
        </div>
        <button
          className="voting-confirm-btn"
          onClick={() => setModo(MODES.HOME)}
          style={{marginTop: "20px"}}
        >
          VOLVER AL INICIO
        </button>
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
  );
}
