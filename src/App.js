// src/App.js
import './HomeStyleKit.css';
import React, { useState } from "react";
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import AdminPanel from "./AdminPanel";

export default function App() {
  const [modo, setModo] = useState(null);

  function handleModoSeleccionado(selected) {
    if (selected === "simple") setModo("simple");
    if (selected === "votacion") setModo("admin"); // <-- ACA CAMBIA
  }

  // Detectar si se entra por link para jugador
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("modo") === "jugador") setModo("jugador");
  }, []);

  if (!modo) return <Home onModoSeleccionado={handleModoSeleccionado} />;
  if (modo === "simple") return <AppNormal onBack={() => setModo(null)} />;
  if (modo === "admin") return <AdminPanel onBackToHome={() => setModo(null)} />;
  if (modo === "jugador") return <VotingView onReset={() => setModo(null)} />;
  return null;
}
