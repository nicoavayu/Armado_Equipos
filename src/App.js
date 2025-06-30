// src/App.js
import React, { useState, useEffect } from "react";
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import AdminPanel from "./AdminPanel";

// Función para leer el modo desde el URL
function getModoFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("modo") === "jugador") return "jugador";
  if (params.get("modo") === "simple") return "simple";
  if (params.get("modo") === "admin") return "admin";
  return null;
}

export default function App() {
  const [modo, setModo] = useState(getModoFromUrl());

  useEffect(() => {
    const modoFromUrl = getModoFromUrl();
    if (modoFromUrl && modoFromUrl !== modo) setModo(modoFromUrl);
    // eslint-disable-next-line
  }, [modo]);

  function handleReset() {
    setModo(null);
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Render según el modo
  if (!modo) return <Home onSelectModo={setModo} />;
  if (modo === "simple") return <AppNormal onBackToHome={handleReset} />;
  if (modo === "jugador") return <VotingView onReset={handleReset} />;
  if (modo === "admin") return <AdminPanel onBackToHome={handleReset} />;

  // Fallback por si el modo es inválido
  return (
    <div style={{ textAlign: "center", marginTop: 100, color: "#0EA9C6" }}>
      <h1>¡Ups! Algo salió mal</h1>
      <button onClick={handleReset}>Volver al inicio</button>
    </div>
  );
}
