import './HomeStyleKit.css';
import React, { useState, useEffect } from "react";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import AdminPanel from "./AdminPanel";
import FormularioNuevoPartido from "./FormularioNuevoPartido";
import PartidoInfoBox from "./PartidoInfoBox";
import { crearPartido, getPartidoPorCodigo, updateJugadoresPartido } from "./supabase";
import IngresoAdminPartido from "./IngresoAdminPartido";

function SeleccionarTipoPartido({ onNuevo, onExistente }) {
  return (
    <div className="voting-bg">
      <div className="voting-modern-card">
        <div className="voting-title-modern" style={{marginBottom: 16}}>¿QUÉ QUERÉS HACER?</div>
        <button className="voting-confirm-btn wipe-btn" style={{marginBottom: 18}} onClick={onNuevo}>
          PARTIDO NUEVO
        </button>
        <button className="voting-confirm-btn wipe-btn" disabled style={{opacity:0.5}} onClick={onExistente}>
          PARTIDO FRECUENTE (Próximamente)
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [modo, setModo] = useState(null);
  const [partidoActual, setPartidoActual] = useState(null);
  const [stepPartido, setStepPartido] = useState(0);
  const [showIngresoAdmin, setShowIngresoAdmin] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get("codigo");
    if (codigo) {
      getPartidoPorCodigo(codigo)
        .then(partido => {
          setPartidoActual(partido);
          setModo("jugador");
        })
        .catch(() => setModo(null));
    }
  }, []);

  const handleJugadoresChange = async (nuevosJugadores) => {
    if (!partidoActual) return;
    await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
    setPartidoActual({ ...partidoActual, jugadores: nuevosJugadores });
  };

  if (modo === "admin") {
    if (stepPartido === 0) {
      return (
        <SeleccionarTipoPartido
          onNuevo={() => setStepPartido(1)}
          onExistente={() => alert("Próximamente partidos frecuentes")}
        />
      );
    }
    if (stepPartido === 1) {
      return (
        <FormularioNuevoPartido
          onConfirmar={async (data) => {
            try {
              const partido = await crearPartido(data);
              if (!partido) throw new Error("No se pudo crear el partido. Intenta nuevamente.");
              setPartidoActual(partido);
              setStepPartido(2);
            } catch (error) {
              console.error("Error creating match:", error);
              throw error;
            }
          }}
        />
      );
    }
    if (stepPartido === 2 && partidoActual) {
      return (
        <div className="voting-bg">
          <div className="voting-modern-card" style={{ maxWidth: 650 }}>
            
            <AdminPanel
              partidoActual={partidoActual}
              jugadores={partidoActual?.jugadores || []}
              onJugadoresChange={handleJugadoresChange}
              onBackToHome={() => {
                setModo(null);
                setPartidoActual(null);
                setStepPartido(0);
              }}
            />
          </div>
        </div>
      );
    }
    if (stepPartido === 2 && !partidoActual) {
      setStepPartido(0);
      return null;
    }
  }

  // HOME: el botón ahora está más arriba, con aire.
  if (!modo) return (
    <div className="voting-bg">
      <div className="voting-modern-card" style={{maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center"}}>
        <Home onModoSeleccionado={(m) => {
          setModo(m);
          if (m === "admin") setStepPartido(0);
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
            setModo("admin");
            setStepPartido(2);
            setShowIngresoAdmin(false);
          }}
          onCancelar={() => setShowIngresoAdmin(false)}
        />
      )}
    </div>
  );

  if (modo === "simple") return <AppNormal onBack={() => setModo(null)} />;
  if (modo === "votacion") {
    setModo("admin");
    return null;
  }
  if (modo === "jugador") return (
    <VotingView
      jugadores={partidoActual ? partidoActual.jugadores : []}
      onReset={() => { setModo(null); setPartidoActual(null); setStepPartido(0); }}
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
          onClick={() => setModo(null)}
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
