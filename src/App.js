// src/App.js
import './HomeStyleKit.css';
import React, { useState, useEffect } from "react";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import AdminPanel from "./AdminPanel";
import { getJugadores, subscribeToChanges } from "./supabase";

export default function App() {
  const [modo, setModo] = useState(null);
  const [jugadores, setJugadores] = useState([]);

  useEffect(() => {
    const fetchJugadores = async () => {
      try {
        const jugadoresDb = await getJugadores();
        setJugadores(jugadoresDb || []);
      } catch (error) {
        console.error("Error cargando jugadores en App:", error);
      }
    };

    fetchJugadores();

    // Suscribirse a cambios en tiempo real
    const subscription = subscribeToChanges((payload) => {
      console.log("Cambio detectado, volviendo a cargar jugadores:", payload);
      fetchJugadores();
    });

    // Limpiar la suscripción al desmontar el componente
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  function handleModoSeleccionado(selected) {
    if (selected === "simple") setModo("simple");
    if (selected === "votacion") setModo("admin");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("modo") === "jugador") setModo("jugador");
  }, []);

  const handleJugadoresChange = (nuevosJugadores) => {
    setJugadores(nuevosJugadores);
  };

  if (!modo) return <Home onModoSeleccionado={handleModoSeleccionado} />;
  if (modo === "simple") return <AppNormal onBack={() => setModo(null)} />;
  if (modo === "admin") return <AdminPanel onBackToHome={() => setModo(null)} jugadores={jugadores} onJugadoresChange={handleJugadoresChange} />;
  if (modo === "jugador") return <VotingView onReset={() => setModo(null)} jugadores={jugadores} />;
  return (
    <>
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
      {
        !modo ? <Home onModoSeleccionado={handleModoSeleccionado} /> :
        modo === "simple" ? <AppNormal onBack={() => setModo(null)} /> :
        modo === "admin" ? <AdminPanel onBackToHome={() => setModo(null)} jugadores={jugadores} onJugadoresChange={handleJugadoresChange} /> :
        modo === "jugador" ? <VotingView onReset={() => setModo(null)} jugadores={jugadores} /> :
        null
      }
    </>
  );
}
